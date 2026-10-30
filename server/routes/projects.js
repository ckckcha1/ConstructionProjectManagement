const express = require('express');
const queries = require('../db/queries');

const router = express.Router();

// GET /api/projects
router.get('/', async (req, res) => {
  res.json(await queries.getAllProjects());
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  const project = await queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// GET /api/projects/:id/phases
router.get('/:id/phases', async (req, res) => {
  const project = await queries.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(await queries.getPhasesByProject(req.params.id));
});

// POST /api/projects  body: { name, ..., phases: [{ startDate, endDate }, ...] }
router.post('/', async (req, res) => {
  res.status(201).json(await queries.createProject(req.body ?? {}));
});

// PATCH /api/projects/:id  body: any project fields to change
router.patch('/:id', async (req, res) => {
  const project = await queries.updateProject(req.params.id, req.body ?? {});
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  const deleted = await queries.deleteProject(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Project not found' });
  res.status(204).end();
});

module.exports = router;
