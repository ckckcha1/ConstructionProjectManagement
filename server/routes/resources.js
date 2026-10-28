const express = require('express');
const queries = require('../db/queries');

// Builds the routes for one resource type. Mounted at /api/workers, /api/tools, and /api/materials.
// type is 'worker', 'tool', or 'material'.
function resourceRouter(type) {
  const router = express.Router();
  const label = type[0].toUpperCase() + type.slice(1);

  // GET /api/workers
  router.get('/', async (req, res) => {
    res.json(await queries.getResources(type));
  });

  // GET /api/workers/:id
  router.get('/:id', async (req, res) => {
    const resource = await queries.getResourceById(type, req.params.id);
    if (!resource) return res.status(404).json({ error: `${label} not found` });
    res.json(resource);
  });

  // GET /api/workers/:id/phases  -> phases this resource is assigned to
  router.get('/:id/phases', async (req, res) => {
    const resource = await queries.getResourceById(type, req.params.id);
    if (!resource) return res.status(404).json({ error: `${label} not found` });
    res.json(await queries.getPhasesForResource(type, req.params.id));
  });

  // POST /api/workers  body: { id, name, ... }
  router.post('/', async (req, res) => {
    res.status(201).json(await queries.createResource(type, req.body ?? {}));
  });

  // PATCH /api/workers/:id  body: any fields to change
  router.patch('/:id', async (req, res) => {
    const resource = await queries.updateResource(type, req.params.id, req.body ?? {});
    if (!resource) return res.status(404).json({ error: `${label} not found` });
    res.json(resource);
  });

  // DELETE /api/workers/:id
  router.delete('/:id', async (req, res) => {
    const deleted = await queries.deleteResource(type, req.params.id);
    if (!deleted) return res.status(404).json({ error: `${label} not found` });
    res.status(204).end();
  });

  return router;
}

// GET /api/phase-resources  -> every phase/resource assignment
const phaseResourcesRouter = express.Router();
phaseResourcesRouter.get('/', async (req, res) => {
  res.json(await queries.getAllPhaseResources());
});

module.exports = { resourceRouter, phaseResourcesRouter };
