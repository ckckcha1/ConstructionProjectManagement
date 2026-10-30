const express = require('express');
const queries = require('../db/queries');

const router = express.Router();

// GET /api/phases  optional ?start=YYYY-MM-DD&end=YYYY-MM-DD to get phases overlapping that range
router.get('/', async (req, res) => {
  res.json(await queries.getPhases({ start: req.query.start, end: req.query.end }));
});

// GET /api/phases/:id
router.get('/:id', async (req, res) => {
  const phase = await queries.getPhaseById(req.params.id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });
  res.json(phase);
});

// POST /api/phases  body: { projectId, startDate, endDate, phaseNumber? }
router.post('/', async (req, res) => {
  res.status(201).json(await queries.createPhase(req.body ?? {}));
});

// PATCH /api/phases/:id  body: any phase fields to change (except projectId)
router.patch('/:id', async (req, res) => {
  const phase = await queries.updatePhase(req.params.id, req.body ?? {});
  if (!phase) return res.status(404).json({ error: 'Phase not found' });
  res.json(phase);
});

// DELETE /api/phases/:id
router.delete('/:id', async (req, res) => {
  const deleted = await queries.deletePhase(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Phase not found' });
  res.status(204).end();
});

// GET /api/phases/:id/resources  -> { workers, tools, materials }
router.get('/:id/resources', async (req, res) => {
  const phase = await queries.getPhaseById(req.params.id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });
  res.json(await queries.getResourcesByPhase(req.params.id));
});

// POST /api/phases/:id/resources  body: { resourceType: 'worker' | 'tool' | 'material', resourceId }
router.post('/:id/resources', async (req, res) => {
  const { resourceType, resourceId } = req.body ?? {};
  res.status(201).json(await queries.assignResourceToPhase(req.params.id, resourceType, resourceId));
});

// DELETE /api/phases/:id/resources/:resourceType/:resourceId
router.delete('/:id/resources/:resourceType/:resourceId', async (req, res) => {
  const { id, resourceType, resourceId } = req.params;
  const removed = await queries.removeResourceFromPhase(id, resourceType, resourceId);
  if (!removed) return res.status(404).json({ error: 'Assignment not found' });
  res.status(204).end();
});

module.exports = router;
