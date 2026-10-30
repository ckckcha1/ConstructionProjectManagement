// All database functions used by the API routes.
// Results use the same field names as the objects built in the frontend's
// src/data.js (id, name, startDate, projectId, ...), so the frontend can switch
// from reading CSVs to calling this API with few changes.

const db = require('./db');

// API field name -> database column, for each table.
const FIELDS = {
  projects: {
    id: 'project_id',
    name: 'project_name',
    description: 'project_description',
    year: 'year',
    startDate: 'start_date',
    endDate: 'end_date',
    location: 'location',
    city: 'city',
  },
  project_phases: {
    id: 'phase_id',
    phaseNumber: 'phase_number',
    startDate: 'start_date',
    endDate: 'end_date',
    projectId: 'project_id',
  },
  workers: { id: 'worker_id', name: 'name', role: 'role' },
  tools: {
    id: 'tool_id',
    name: 'tool_name',
    description: 'tool_description',
    quantity: 'quantity',
    location: 'location',
  },
  materials: {
    id: 'material_id',
    name: 'material_name',
    description: 'material_description',
    unit: 'unit',
    quantity: 'quantity',
    location: 'location',
  },
};

// Table, phase_resources column, and sort order for each resource type.
const RESOURCE_TYPES = {
  worker: { table: 'workers', column: 'worker_id', orderBy: 'name' },
  tool: { table: 'tools', column: 'tool_id', orderBy: 'tool_id' },
  material: { table: 'materials', column: 'material_id', orderBy: 'material_id' },
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function resourceType(type) {
  const info = RESOURCE_TYPES[type];
  if (!info) {
    throw httpError(400, `Unknown resource type "${type}". Use one of: ${Object.keys(RESOURCE_TYPES).join(', ')}`);
  }
  return info;
}

// e.g. `p.project_id AS "id", p.project_name AS "name", ...`
function selectList(table, alias) {
  const prefix = alias ? `${alias}.` : '';
  return Object.entries(FIELDS[table])
    .map(([field, column]) => `${prefix}${column} AS "${field}"`)
    .join(', ');
}

// [column, value] pairs for the API fields present in data.
function columnValues(table, data, exclude = []) {
  return Object.entries(FIELDS[table])
    .filter(([field]) => data[field] !== undefined && !exclude.includes(field))
    .map(([field, column]) => [column, data[field]]);
}

async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Generic table helpers ----------

async function findAll(table, orderBy) {
  const { rows } = await db.query(`SELECT ${selectList(table)} FROM ${table} ORDER BY ${orderBy}`);
  return rows;
}

async function findById(table, id, client = db) {
  const { rows } = await client.query(
    `SELECT ${selectList(table)} FROM ${table} WHERE ${FIELDS[table].id} = $1`,
    [id]
  );
  return rows[0] || null;
}

async function insert(table, data, client = db) {
  const pairs = columnValues(table, data);
  if (pairs.length === 0) throw httpError(400, 'No valid fields provided');
  const columns = pairs.map(([column]) => column).join(', ');
  const placeholders = pairs.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING ${selectList(table)}`,
    pairs.map(([, value]) => value)
  );
  return rows[0];
}

// Updates only the fields present in data. Returns null if the row doesn't exist.
async function update(table, id, data, readOnly = []) {
  const pairs = columnValues(table, data, ['id', ...readOnly]);
  if (pairs.length === 0) return findById(table, id);
  const sets = pairs.map(([column], i) => `${column} = $${i + 2}`).join(', ');
  const { rows } = await db.query(
    `UPDATE ${table} SET ${sets} WHERE ${FIELDS[table].id} = $1 RETURNING ${selectList(table)}`,
    [id, ...pairs.map(([, value]) => value)]
  );
  return rows[0] || null;
}

// Returns true if a row was deleted.
async function remove(table, id, client = db) {
  const { rowCount } = await client.query(`DELETE FROM ${table} WHERE ${FIELDS[table].id} = $1`, [id]);
  return rowCount > 0;
}

// Next sequential ID such as P-021 or Ph_040, based on the highest existing number.
async function nextId(table, prefix, client) {
  const idColumn = FIELDS[table].id;
  const pattern = `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(substring(${idColumn} FROM '[0-9]+$')::int), 0) + 1 AS n
     FROM ${table} WHERE ${idColumn} LIKE $1`,
    [pattern]
  );
  return prefix + String(rows[0].n).padStart(3, '0');
}

// ---------- Projects ----------

const getAllProjects = () => findAll('projects', 'start_date, project_id');

const getProjectById = (id) => findById('projects', id);

// Every project needs at least one phase, so a project is created together with
// its phases: { name, ..., phases: [{ startDate, endDate }, ...] }.
// The project ID and phase IDs/numbers are generated when not provided.
async function createProject({ phases, ...project }) {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw httpError(400, 'A project needs at least one phase in "phases"');
  }
  return withTransaction(async (client) => {
    const data = { ...project };
    if (!data.id) data.id = await nextId('projects', 'P-', client);
    const created = await insert('projects', data, client);
    created.phases = [];
    for (const phase of phases) {
      created.phases.push(await insertPhase({ ...phase, projectId: created.id }, client));
    }
    return created;
  });
}

const updateProject = (id, data) => update('projects', id, data);

// Also deletes the project's phases and their resource assignments.
const deleteProject = (id) => remove('projects', id);

async function getPhasesByProject(projectId) {
  const { rows } = await db.query(
    `SELECT ${selectList('project_phases')} FROM project_phases
     WHERE project_id = $1 ORDER BY phase_number`,
    [projectId]
  );
  return rows;
}

// ---------- Project phases ----------

// Optionally only phases overlapping the date range (inclusive): { start, end } as 'YYYY-MM-DD'.
async function getPhases({ start, end } = {}) {
  const { rows } = await db.query(
    `SELECT ${selectList('project_phases')} FROM project_phases
     WHERE ($1::date IS NULL OR end_date >= $1::date)
       AND ($2::date IS NULL OR start_date <= $2::date)
     ORDER BY start_date, phase_id`,
    [start || null, end || null]
  );
  return rows;
}

const getPhaseById = (id) => findById('project_phases', id);

// The phase ID and phase number are generated when not provided.
async function insertPhase(phase, client = db) {
  if (!phase.projectId) throw httpError(400, 'projectId is required');
  const data = { ...phase };
  if (!data.id) data.id = await nextId('project_phases', 'Ph_', client);
  if (data.phaseNumber === undefined) {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(phase_number), 0) + 1 AS n FROM project_phases WHERE project_id = $1',
      [data.projectId]
    );
    data.phaseNumber = rows[0].n;
  }
  return insert('project_phases', data, client);
}

const createPhase = (phase) => insertPhase(phase);

// A phase can't be moved to another project, since that could leave its project with no phases.
const updatePhase = (id, data) => update('project_phases', id, data, ['projectId']);

// Also deletes the phase's resource assignments. Refuses to delete a project's only phase.
function deletePhase(id) {
  return withTransaction(async (client) => {
    // Lock the project's phases so two deletes can't remove the last two at once.
    const { rows: siblings } = await client.query(
      `SELECT phase_id FROM project_phases
       WHERE project_id = (SELECT project_id FROM project_phases WHERE phase_id = $1)
       FOR UPDATE`,
      [id]
    );
    if (siblings.length === 0) return false;
    if (siblings.length === 1) {
      throw httpError(409, 'Cannot delete the only phase of a project. Delete the project instead.');
    }
    return remove('project_phases', id, client);
  });
}

// ---------- Workers, tools, and materials ----------
// type is 'worker', 'tool', or 'material'.

function getResources(type) {
  const { table, orderBy } = resourceType(type);
  return findAll(table, orderBy);
}

function getResourceById(type, id) {
  return findById(resourceType(type).table, id);
}

function createResource(type, data) {
  if (!data.id) throw httpError(400, 'id is required');
  return insert(resourceType(type).table, data);
}

function updateResource(type, id, data) {
  return update(resourceType(type).table, id, data);
}

// Also removes the resource from every phase it was assigned to.
function deleteResource(type, id) {
  return remove(resourceType(type).table, id);
}

// Phases a worker, tool, or material is assigned to, with each phase's project name.
async function getPhasesForResource(type, id) {
  const { column } = resourceType(type);
  const { rows } = await db.query(
    `SELECT ${selectList('project_phases', 'pp')}, p.project_name AS "projectName"
     FROM phase_resources pr
     JOIN project_phases pp ON pp.phase_id = pr.phase_id
     JOIN projects p ON p.project_id = pp.project_id
     WHERE pr.${column} = $1
     ORDER BY pp.start_date, pp.phase_id`,
    [id]
  );
  return rows;
}

// ---------- Phase resources (assignments) ----------

// Every assignment, shaped like the "assignments" list in the frontend's data.js.
async function getAllPhaseResources() {
  const { rows } = await db.query(
    `SELECT pr.phase_resource_id AS "id",
            pr.phase_id AS "phaseId",
            pp.project_id AS "projectId",
            COALESCE(pr.worker_id, pr.tool_id, pr.material_id) AS "resourceId",
            CASE WHEN pr.worker_id IS NOT NULL THEN 'worker'
                 WHEN pr.tool_id IS NOT NULL THEN 'tool'
                 ELSE 'material' END AS "resourceType"
     FROM phase_resources pr
     JOIN project_phases pp ON pp.phase_id = pr.phase_id
     ORDER BY pr.phase_id, "resourceType", "resourceId"`
  );
  return rows;
}

// The workers, tools, and materials assigned to a phase: { workers, tools, materials }.
async function getResourcesByPhase(phaseId) {
  const result = {};
  for (const [type, { table, column }] of Object.entries(RESOURCE_TYPES)) {
    const { rows } = await db.query(
      `SELECT ${selectList(table, 'r')}
       FROM phase_resources pr
       JOIN ${table} r ON r.${column} = pr.${column}
       WHERE pr.phase_id = $1
       ORDER BY r.${column}`,
      [phaseId]
    );
    result[`${type}s`] = rows;
  }
  return result;
}

async function assignResourceToPhase(phaseId, type, resourceId) {
  const { column } = resourceType(type);
  if (!resourceId) throw httpError(400, 'resourceId is required');
  const { rows } = await db.query(
    `INSERT INTO phase_resources (phase_id, ${column}) VALUES ($1, $2)
     RETURNING phase_resource_id AS "id", phase_id AS "phaseId"`,
    [phaseId, resourceId]
  );
  return { ...rows[0], resourceId, resourceType: type };
}

// Returns true if the assignment existed and was removed.
async function removeResourceFromPhase(phaseId, type, resourceId) {
  const { column } = resourceType(type);
  const { rowCount } = await db.query(
    `DELETE FROM phase_resources WHERE phase_id = $1 AND ${column} = $2`,
    [phaseId, resourceId]
  );
  return rowCount > 0;
}

module.exports = {
  RESOURCE_TYPES,
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getPhasesByProject,
  getPhases,
  getPhaseById,
  createPhase,
  updatePhase,
  deletePhase,
  getResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
  getPhasesForResource,
  getAllPhaseResources,
  getResourcesByPhase,
  assignResourceToPhase,
  removeResourceFromPhase,
};
