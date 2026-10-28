import * as d3 from 'd3';

// Part that handles all the data process
// Data comes from the Express + PostgreSQL backend in /server

// HARD CODED VALUE for the demo on Prototype demo Monday
// Decent data point to use as it has 3 project that overlap on this day period
// NEED TO replace with new Date() for live data later!!!
export const DEMO_TODAY = new Date(2026, 5, 10);

// The API sends dates as 'YYYY-MM-DD' strings
const parseDate = d3.timeParse('%Y-%m-%d');

// Relative URL, src/setupProxy.js forwards /api to the backend (localhost:5000)
const apiUrl = (path) => `/api/${path}`;

const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

// HARD CODED!!! color palette values 
// for the project colors to be used in the dashboard
const PROJECT_PALETTE = ['#76B7B2', '#59A14F', '#4E79A7', '#F28E2B', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F'];

// Sorted IDs get palette colours in order, wrapping when there are more
function buildProjectColors(projects) {
  const ids = projects.map((p) => p.id).sort();
  return new Map(ids.map((id, i) => [id, PROJECT_PALETTE[i % PROJECT_PALETTE.length]]));
}

export async function loadData() {
  // The API already uses these field names, only the dates need parsing.
  // assignments: { id, phaseId, projectId, resourceId, resourceType }
  const [rawProjects, rawPhases, assignments, workers, tools, materials] = await Promise.all(
    ['projects', 'phases', 'phase-resources', 'workers', 'tools', 'materials'].map((path) =>
      d3.json(apiUrl(path))
    )
  );

  const withDates = (row) => ({
    ...row,
    startDate: parseDate(row.startDate),
    endDate: parseDate(row.endDate),
  });
  const projects = rawProjects.map(withDates);
  const phases = rawPhases.map(withDates);

  const projectsById = byId(projects);
  const workersById = byId(workers);
  const toolsById = byId(tools);
  const materialsById = byId(materials);

  // Data checks, for now.........
  // Unknown resources/phases and phases ending before they start are blocked by the database
  for (const p of projects) {
    if (p.startDate && p.year !== p.startDate.getFullYear()) {
      console.warn(
        `Project ${p.id} Year (${p.year}) doesn't match its start date year (${p.startDate.getFullYear()})`,
        p
      );
    }
  }

  return {
    projects,
    phases,
    assignments,
    workers,
    tools,
    materials,
    projectsById,
    workersById,
    toolsById,
    materialsById,
    // Every view (details, timeline, Gantt, map) must read colors from
    // data.projectColorById so projects keep one color everywhere
    projectColorById: buildProjectColors(projects),
  };
}

// Date helper function
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Clamps to the target month's last day 
export function addMonths(date, n) {
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

// Inclusive on both ends
export function overlaps(start, end, rangeStart, rangeEnd) {
  return start <= rangeEnd && end >= rangeStart;
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

export function toInputValue(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Builds a LOCAL date from new Date would parse as UTC
// Returns null for empty or partial input
export function fromInputValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); // year, month, day order
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  date.setFullYear(y); // new Date() maps years 0–99 to 1900–1999
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getResourcesInRange(data, rangeStart, rangeEnd) {
  const empty = { projects: [], workers: [], tools: [], materials: [] };
  if (!data) return empty;

  const phasesInRange = data.phases.filter(
    (p) => p.startDate && p.endDate && overlaps(p.startDate, p.endDate, rangeStart, rangeEnd)
  );
  const phaseIds = new Set(phasesInRange.map((p) => p.id));

  // Projects come from the phases, so a phase with no assignments still counts.
  // spanStart/spanEnd cover the project's phases that fall in the range.
  const spans = new Map();
  for (const p of phasesInRange) {
    const span = spans.get(p.projectId);
    if (!span) {
      spans.set(p.projectId, { spanStart: p.startDate, spanEnd: p.endDate });
    } else {
      if (p.startDate < span.spanStart) span.spanStart = p.startDate;
      if (p.endDate > span.spanEnd) span.spanEnd = p.endDate;
    }
  }

  const ids = { worker: new Set(), tool: new Set(), material: new Set() };
  for (const a of data.assignments) {
    if (phaseIds.has(a.phaseId) && ids[a.resourceType]) ids[a.resourceType].add(a.resourceId);
  }

  const collect = (idSet, map) => [...idSet].map((id) => map.get(id)).filter(Boolean);
  const byText = (key) => (a, b) => a[key].localeCompare(b[key]);

  return {
    projects: [...spans]
      .filter(([id]) => data.projectsById.has(id))
      .map(([id, span]) => ({ ...data.projectsById.get(id), ...span }))
      .sort((a, b) => a.startDate - b.startDate),
    workers: collect(ids.worker, data.workersById).sort(byText('name')),
    tools: collect(ids.tool, data.toolsById).sort(byText('description')),
    materials: collect(ids.material, data.materialsById).sort(byText('description')),
  };
}

// Counts for the KPI values in the heading
// Depend on the date range ONLY, the filter checkboxes doesn't affect
export function getPeriodSummary(inRange) {
  const materialNames = new Set(
    inRange.materials.map((m) => (m.name || '').trim().toLowerCase())
  );
  return {
    projects: inRange.projects.length,
    people: inRange.workers.length,
    tools: inRange.tools.length,
    materialTypes: materialNames.size,
  };
}

// The in-range project that ends soonest
export function getDefaultProject(inRange) {
  if (!inRange.projects.length) return null;
  return [...inRange.projects].sort(
    (a, b) =>
      a.endDate - b.endDate || a.startDate - b.startDate || a.id.localeCompare(b.id)
  )[0];
}
