import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import './ResourceOverview.css';
import GanttChart, { LABEL_WIDTH, buildTimeline } from './GanttChart';
import { formatDate, overlaps } from '../data';

const formatShort = d3.timeFormat('%b %-d');

const quantityText = (quantity) => (quantity == null ? '—' : quantity.toLocaleString('en-US'));

// details: extra tooltip lines about the resource itself, shown above the assignment lines
const RESOURCE_GROUPS = [
  { type: 'workers', title: 'People', label: (w) => w.name, meta: (w) => w.role, details: () => [] },
  {
    type: 'tools',
    title: 'Tools',
    label: (t) => t.description,
    meta: (t) => t.id,
    details: (t) => [`Quantity: ${quantityText(t.quantity)}`],
  },
  
  {
    type: 'materials',
    title: 'Materials',
    label: (m) => m.description,
    meta: (m) => m.unit,
    details: (m) => [`Quantity: ${quantityText(m.quantity)} · Unit: ${m.unit || '—'}`],
  },
];
// ADD THE NEW CODE HERE, OUTSIDE THE ARRAY
const PREVIEW_RESOURCE_TYPES = {
  workers: 'worker',
  tools: 'tool',
  materials: 'material',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dayCount = (start, end) => d3.timeDay.count(start, end) + 1; // inclusive
const previewDate = (value) => {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
};

const phaseDates = (phase) =>
  `${formatDate(phase.startDate)} – ${formatDate(phase.endDate)} · ${plural(
    dayCount(phase.startDate, phase.endDate),
    'day'
  )}`;

// Rows for both charts, from the projects and resources checked in the filter panel.
// Bars are the phases that overlap the date range; a resource gets one bar per phase it's assigned to.
function buildRows({ data, whatIfPreview, inRange, excludedIds, dateRange, collapsedGroups, onSelectProject, onToggleGroup, selectedProjectId }) {
  const projects = inRange.projects.filter((p) => !excludedIds.projects.has(p.id));
  const projectIds = new Set(projects.map((p) => p.id));
  const colorOf = (projectId) => data.projectColorById.get(projectId);

  const phases = data.phases.filter(
    (ph) =>
      projectIds.has(ph.projectId) &&
      ph.startDate &&
      ph.endDate &&
      overlaps(ph.startDate, ph.endDate, dateRange.start, dateRange.end)
  );
  const phaseById = new Map(phases.map((ph) => [ph.id, ph]));
  const phasesByProject = d3.group(phases, (ph) => ph.projectId);
  // Include all phases when checking conflicts, even if their
// projects are not currently selected in the filters.
const allPhaseById = new Map(data.phases.map((ph) => [ph.id, ph]));

const conflictingAssignmentIds = new Set();

const allAssignmentsByResource = d3.group(
  data.assignments,
  (a) => a.resourceId
);

for (const assignments of allAssignmentsByResource.values()) {
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const first = assignments[i];
      const second = assignments[j];

      const firstPhase = allPhaseById.get(first.phaseId);
      const secondPhase = allPhaseById.get(second.phaseId);

      if (!firstPhase || !secondPhase) continue;
      if (firstPhase.projectId === secondPhase.projectId) continue;

      if (
        firstPhase.startDate &&
        firstPhase.endDate &&
        secondPhase.startDate &&
        secondPhase.endDate &&
        overlaps(
          firstPhase.startDate,
          firstPhase.endDate,
          secondPhase.startDate,
          secondPhase.endDate
        )
      ) {
        conflictingAssignmentIds.add(first.id);
        conflictingAssignmentIds.add(second.id);
      }
    }
  }
}

  const resourcesPerProject = d3.rollup(
    data.assignments,
    (v) => new Set(v.map((a) => a.resourceId)).size,
    (a) => a.projectId
  );
  const resourcesPerPhase = d3.rollup(data.assignments, (v) => v.length, (a) => a.phaseId);

  const projectRows = projects.map((project) => ({
    type: 'item',
    key: project.id,
    title: `${project.id} · ${project.name}`,
    meta: `${formatShort(project.startDate)} – ${formatShort(project.endDate)} · ${plural(
      resourcesPerProject.get(project.id) ?? 0,
      'resource'
    )}`,
    swatch: colorOf(project.id),
    selected: project.id === selectedProjectId,
    onClick: () => onSelectProject(project.id),
    bars: (phasesByProject.get(project.id) ?? []).map((phase) => ({
      key: phase.id,
      start: phase.startDate,
      end: phase.endDate,
      color: colorOf(project.id),
      label: `Phase ${phase.phaseNumber}`,
      tooltip: {
        title: `${project.name} · Phase ${phase.phaseNumber}`,
        lines: [phaseDates(phase), plural(resourcesPerPhase.get(phase.id) ?? 0, 'resource')],
      },
      onClick: () => onSelectProject(project.id),
    })),
  }));

    // Add the temporary what-if project to the project timeline.
  if (whatIfPreview) {
    projectRows.push({
      type: 'item',
      key: 'what-if-preview',
      title: whatIfPreview.name || 'New project',
      meta: whatIfPreview.place || 'Proposed project',
      swatch: '#7c3aed',
      selected: false,
      bars:
     whatIfPreview.phases
  ?.filter((phase) => {
    if (!phase.start || !phase.end) return false;

    const start = new Date(`${phase.start}T00:00:00`);
    const end = new Date(`${phase.end}T00:00:00`);

    return (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start <= end
    );
  })
  .map((phase, index) => ({
    key: `what-if-phase-${phase.id ?? index}`,
    start: new Date(`${phase.start}T00:00:00`),
    end: new Date(`${phase.end}T00:00:00`),
    color: '#c4b5fd',
    isPreview: true,
    label: phase.name || `Phase ${index + 1}`,
    tooltip: {
      title: `${whatIfPreview.name || 'New project'} — ${phase.name || `Phase ${index + 1}`}`,
      lines: [
        whatIfPreview.place || 'Proposed project',
        `${phase.start} – ${phase.end}`,
      ],
    },
  })) ?? [],
  });
  }

  const assignmentsByResource = d3.group(
    data.assignments.filter((a) => phaseById.has(a.phaseId)),
    (a) => a.resourceId
  );
  const previewAssignmentsByResource = d3.group(
  (whatIfPreview?.assignments ?? []).filter((assignment) => {
    const start = previewDate(assignment.startDate);
    const end = previewDate(assignment.endDate);

    return start && end && start <= end;
  }),
  (assignment) => `${assignment.resourceType}:${assignment.resourceId}`
);

  const resourceRows = [];

for (const group of RESOURCE_GROUPS) {
  const resources = data[group.type].filter((r) => {
    const previewKey = `${PREVIEW_RESOURCE_TYPES[group.type]}:${r.id}`;

    const hasSavedAssignments =
      inRange[group.type].some((item) => item.id === r.id) &&
      assignmentsByResource.has(r.id);

    const hasPreviewAssignments =
      previewAssignmentsByResource.has(previewKey);

    return (
      !excludedIds[group.type].has(r.id) &&
      (hasSavedAssignments || hasPreviewAssignments)
    );
  });
    if (resources.length === 0) continue;

    const collapsed = collapsedGroups.has(group.type);
    resourceRows.push({
      type: 'group',
      key: group.type,
      title: group.title,
      count: resources.length,
      collapsed,
      onToggle: () => onToggleGroup(group.type),
    });
    if (collapsed) continue;

    for (const resource of resources) {
      resourceRows.push({
        type: 'item',
        key: resource.id,
        title: group.label(resource),
        meta: group.meta(resource),
        bars: [
  ...(assignmentsByResource.get(resource.id) ?? []).map((a) => {
    const phase = phaseById.get(a.phaseId);
    const project = data.projectsById.get(phase.projectId);

    return {
      key: a.id,
      start: phase.startDate,
      end: phase.endDate,
      color: colorOf(project.id),
      isConflict: conflictingAssignmentIds.has(a.id),
      label: project.id,
      tooltip: {
        title: group.label(resource),
        lines: [
          ...group.details(resource),
          `${project.id} ${project.name} · Phase ${phase.phaseNumber}`,
          phaseDates(phase),
        ],
      },
      onClick: () => onSelectProject(project.id),
    };
  }), 
  // Temporary What-if resource assignment bars
...(previewAssignmentsByResource.get(
  `${PREVIEW_RESOURCE_TYPES[group.type]}:${resource.id}`
) ?? []).map((assignment) => ({
  key: `preview-${assignment.resourceType}-${assignment.resourceId}-${assignment.phaseId}`,
  start: previewDate(assignment.startDate),
  end: previewDate(assignment.endDate),
  color: '#c4b5fd',
  isPreview: true,
  label: assignment.phaseName || 'What-if',
  tooltip: {
    title: `${whatIfPreview?.name || 'New project'} — ${assignment.phaseName || 'Phase'}`,
    lines: [
      group.label(resource),
      `${assignment.startDate} – ${assignment.endDate}`,
      'Temporary resource assignment',
    ],
  },
})),
  
],
      });
    }
  }

  return { projectRows, resourceRows };
}

function ResourceOverview({
  data,
  whatIfPreview,
  inRange,
  excludedIds,
  dateRange,
  today,
  loading,
  error,
  selectedProjectId,
  onSelectProject,
}) {
  const projectsScrollRef = useRef(null);
  const resourcesScrollRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  // Days stretch to fill the chart width, so track it as the window resizes
  useLayoutEffect(() => {
    const el = projectsScrollRef.current;
    if (!el) return undefined;
    const measure = () => setAvailableWidth(Math.max(0, el.clientWidth - LABEL_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep both charts at the same horizontal scroll position
  const syncScroll = useCallback((fromRef, toRef) => {
    const from = fromRef.current;
    const to = toRef.current;
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  }, []);

  const toggleGroup = useCallback((type) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const timeline = useMemo(
    () => buildTimeline(dateRange.start, dateRange.end, availableWidth),
    [dateRange, availableWidth]
  );

  // When the range changes, scroll both charts so today is in the middle of the view
  // (if today is in the range and the range is wider than the view)
  useLayoutEffect(() => {
    const el = projectsScrollRef.current;
    if (!el || !today || today < timeline.start || today >= timeline.stop) return;
    const viewWidth = el.clientWidth - LABEL_WIDTH;
    const left = Math.max(0, timeline.x(d3.timeDay.floor(today)) - viewWidth / 2);
    el.scrollLeft = left;
    if (resourcesScrollRef.current) resourcesScrollRef.current.scrollLeft = left;
    // Only on a new range, not every re-render, so it doesn't undo the user's scrolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.start, dateRange.end, timeline.dayWidth]);

  const { projectRows, resourceRows } = useMemo(
    () =>
      data
        ? buildRows({
            data,
            whatIfPreview,
            inRange,
            excludedIds,
            dateRange,
            collapsedGroups,
            onSelectProject,
            onToggleGroup: toggleGroup,
            selectedProjectId,
          })
        : { projectRows: [], resourceRows: [] },
    [data, whatIfPreview, inRange, excludedIds, dateRange, collapsedGroups, onSelectProject, toggleGroup, selectedProjectId]
  );

  let projectsEmpty = 'No projects selected in this period.';
  let resourcesEmpty = 'No resources assigned to the selected projects in this period.';
  if (loading) projectsEmpty = resourcesEmpty = 'Loading…';
  else if (error) projectsEmpty = resourcesEmpty = error;

  return (
    <section className="panel panel-resource">
      <h2>Resource overview</h2>
      <div className="resource-sections">
        <div className="timeline-section">
          <h3>Project timeline</h3>
          <div className="chart-area">
            <GanttChart
              timeline={timeline}
              today={today}
              labelHeader="Project"
              rows={projectRows}
              emptyMessage={projectsEmpty}
              scrollRef={projectsScrollRef}
              onScroll={() => syncScroll(projectsScrollRef, resourcesScrollRef)}
              ariaLabel="Project timeline"
            />
          </div>
        </div>

        <div className="section-divider" />

        <div className="gantt-section">
          <h3>Resource Gantt</h3>
          <div className="chart-area">
            <GanttChart
              timeline={timeline}
              today={today}
              labelHeader="Resource"
              rows={resourceRows}
              emptyMessage={resourcesEmpty}
              scrollRef={resourcesScrollRef}
              onScroll={() => syncScroll(resourcesScrollRef, projectsScrollRef)}
              ariaLabel="Resource Gantt"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default ResourceOverview;
