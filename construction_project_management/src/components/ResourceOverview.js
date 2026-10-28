import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import './ResourceOverview.css';
import GanttChart, { LABEL_WIDTH, buildTimeline } from './GanttChart';
import { formatDate, overlaps } from '../data';

const formatShort = d3.timeFormat('%b %-d');

const RESOURCE_GROUPS = [
  { type: 'workers', title: 'People', label: (w) => w.name, meta: (w) => w.role },
  { type: 'tools', title: 'Tools', label: (t) => t.description, meta: (t) => t.id },
  { type: 'materials', title: 'Materials', label: (m) => m.description, meta: (m) => m.unit },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dayCount = (start, end) => d3.timeDay.count(start, end) + 1; // inclusive

const phaseDates = (phase) =>
  `${formatDate(phase.startDate)} – ${formatDate(phase.endDate)} · ${plural(
    dayCount(phase.startDate, phase.endDate),
    'day'
  )}`;

// Rows for both charts, from the projects and resources checked in the filter panel.
// Bars are the phases that overlap the date range; a resource gets one bar per phase it's assigned to.
function buildRows({ data, inRange, excludedIds, dateRange, collapsedGroups, onSelectProject, onToggleGroup, selectedProjectId }) {
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

  const assignmentsByResource = d3.group(
    data.assignments.filter((a) => phaseById.has(a.phaseId)),
    (a) => a.resourceId
  );

  const resourceRows = [];
  for (const group of RESOURCE_GROUPS) {
    const resources = inRange[group.type].filter(
      (r) => !excludedIds[group.type].has(r.id) && assignmentsByResource.has(r.id)
    );
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
        bars: assignmentsByResource.get(resource.id).map((a) => {
          const phase = phaseById.get(a.phaseId);
          const project = data.projectsById.get(phase.projectId);
          return {
            key: a.id,
            start: phase.startDate,
            end: phase.endDate,
            color: colorOf(project.id),
            label: project.id,
            tooltip: {
              title: group.label(resource),
              lines: [`${project.id} ${project.name} · Phase ${phase.phaseNumber}`, phaseDates(phase)],
            },
            onClick: () => onSelectProject(project.id),
          };
        }),
      });
    }
  }

  return { projectRows, resourceRows };
}

function ResourceOverview({
  data,
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

  const { projectRows, resourceRows } = useMemo(
    () =>
      data
        ? buildRows({
            data,
            inRange,
            excludedIds,
            dateRange,
            collapsedGroups,
            onSelectProject,
            onToggleGroup: toggleGroup,
            selectedProjectId,
          })
        : { projectRows: [], resourceRows: [] },
    [data, inRange, excludedIds, dateRange, collapsedGroups, onSelectProject, toggleGroup, selectedProjectId]
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
