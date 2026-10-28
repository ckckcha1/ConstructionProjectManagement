require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const express = require('express');
const cors = require('cors');
const db = require('./db/db');
const projectsRouter = require('./routes/projects');
const phasesRouter = require('./routes/phases');
const { resourceRouter, phaseResourcesRouter } = require('./routes/resources');

const app = express();
const PORT = process.env.PORT || 5000;

// Allow the React dev server to call this API.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

// Health check: confirms the server is up and can reach the database.
app.get('/api/health', async (req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
});

app.use('/api/projects', projectsRouter);
app.use('/api/phases', phasesRouter);
app.use('/api/workers', resourceRouter('worker'));
app.use('/api/tools', resourceRouter('tool'));
app.use('/api/materials', resourceRouter('material'));
app.use('/api/phase-resources', phaseResourcesRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// PostgreSQL error codes caused by bad request data, and the HTTP status to send for each.
const PG_ERROR_STATUS = {
  23505: 409, // unique_violation, e.g. duplicate ID or resource already assigned
  23503: 400, // foreign_key_violation, e.g. projectId or resourceId doesn't exist
  23502: 400, // not_null_violation
  23514: 400, // check_violation, e.g. end date before start date
  '22P02': 400, // invalid_text_representation, e.g. "abc" for a number
  22007: 400, // invalid_datetime_format
  22008: 400, // datetime_field_overflow
};

app.use((err, req, res, next) => {
  const status = err.status || PG_ERROR_STATUS[err.code] || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.detail || err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
