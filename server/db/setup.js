// Creates the database (if needed), rebuilds the tables from schema.sql, and
// loads the CSV files from the data folder. Run with: npm run db:setup
// WARNING: this erases any existing data in the tables.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { parse } = require('csv-parse/sync');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readCsv(file) {
  return parse(fs.readFileSync(path.join(DATA_DIR, file)), {
    columns: (header) => header.map((name) => name.trim()),
    bom: true,
    skip_empty_lines: true,
    trim: true, // some names have trailing spaces
  });
}

// '5/6/2026' -> '2026-05-06'
function toIsoDate(value) {
  if (!value) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Unrecognized date "${value}"`);
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const toInt = (value) => (value === '' ? null : Number.parseInt(value, 10));

async function createDatabaseIfMissing() {
  const admin = new Client({ ...db.config, database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      db.config.database,
    ]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${db.config.database.replace(/"/g, '""')}"`);
      console.log(`Created database "${db.config.database}"`);
    }
  } finally {
    await admin.end();
  }
}

async function insertRows(client, table, columns, rows) {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  for (const row of rows) {
    await client.query(sql, row);
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

async function loadData(client) {
  const projects = readCsv('projects.csv');
  const phases = readCsv('project_phases.csv');
  const workers = readCsv('workers.csv');
  const tools = readCsv('tools.csv');
  const materials = readCsv('materials.csv');
  const phaseResources = readCsv('phase_resources.csv');

  await insertRows(
    client,
    'projects',
    ['project_id', 'project_name', 'project_description', 'year', 'start_date', 'end_date', 'location', 'city'],
    projects.map((r) => [
      r['Project ID'],
      r['Project Name'],
      r['Project Description'],
      toInt(r['Year']),
      toIsoDate(r['Start Date']),
      toIsoDate(r['End Date']),
      r['Location'],
      r['City'],
    ])
  );

  await insertRows(
    client,
    'project_phases',
    ['phase_id', 'project_id', 'phase_number', 'start_date', 'end_date'],
    phases.map((r) => [
      r['Phase ID'],
      r['Project ID'],
      toInt(r['Phase']),
      toIsoDate(r['Start Date']),
      toIsoDate(r['End Date']),
    ])
  );

  await insertRows(
    client,
    'workers',
    ['worker_id', 'name', 'role'],
    workers.map((r) => [r['Worker ID'], r['Name'], r['Role']])
  );

  await insertRows(
    client,
    'tools',
    ['tool_id', 'tool_name', 'tool_description', 'quantity', 'location'],
    tools.map((r) => [r['Tool ID'], r['Tool Name'], r['Tool Description'], toInt(r['Quantity']), r['Location']])
  );

  await insertRows(
    client,
    'materials',
    ['material_id', 'material_name', 'material_description', 'unit', 'quantity', 'location'],
    materials.map((r) => [
      r['Material ID'],
      r['Material Name'],
      r['Material Description'],
      r['Unit'],
      toInt(r['Quantity']),
      r['Location'],
    ])
  );

  // The CSV's Resource ID can be a worker, tool, or material; put it in the matching column.
  // Its Project ID column is not stored because the phase already determines the project.
  const workerIds = new Set(workers.map((r) => r['Worker ID']));
  const toolIds = new Set(tools.map((r) => r['Tool ID']));
  const materialIds = new Set(materials.map((r) => r['Material ID']));

  const seen = new Set();
  const links = [];
  for (const r of phaseResources) {
    const phaseId = r['Phase ID'];
    const resourceId = r['Resource ID'];
    const key = `${phaseId}|${resourceId}`;
    if (seen.has(key)) {
      console.log(`  Skipping duplicate assignment of ${resourceId} to ${phaseId}`);
      continue;
    }
    seen.add(key);

    if (workerIds.has(resourceId)) links.push([phaseId, resourceId, null, null]);
    else if (toolIds.has(resourceId)) links.push([phaseId, null, resourceId, null]);
    else if (materialIds.has(resourceId)) links.push([phaseId, null, null, resourceId]);
    else throw new Error(`phase_resources.csv references unknown resource "${resourceId}"`);
  }

  await insertRows(client, 'phase_resources', ['phase_id', 'worker_id', 'tool_id', 'material_id'], links);
}

async function setup() {
  if (!db.config.database) {
    throw new Error('PGDATABASE is not set. Copy server/.env.example to server/.env and fill it in.');
  }
  await createDatabaseIfMissing();

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Created tables. Loading CSV data...');
    await loadData(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

setup()
  .then(() => console.log('Database setup complete.'))
  .catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
