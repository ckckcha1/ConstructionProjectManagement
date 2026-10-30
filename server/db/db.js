const { Pool, types } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, so dates
// don't shift a day when converted to UTC in JSON responses.
types.setTypeParser(types.builtins.DATE, (value) => value);

// Connection settings shared by the app pool and the setup script.
const config = {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
};

// Shared connection pool used by every query in the backend.
const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err);
});

module.exports = {
  config,
  pool,
  query: (text, params) => pool.query(text, params),
};
