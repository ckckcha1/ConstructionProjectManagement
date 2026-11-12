import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import './ResourceOverview.css';
import GanttChart, { LABEL_WIDTH, buildTimeline } from './GanttChart';
import { formatDate, overlaps } from '../data';

const formatShort = d3.timeFormat('%b %-d');

// What-if resource bars match the status dots in Add project: red when the resource
// already has an overlapping assignment, green when it's free, grey while still checking.
// color is the bar fill (GanttChart.css adds the matching dashed border per status).
const WHAT_IF_STATUS = {
  conflict: { color: '#fecaca', text: 'Conflicts with an existing assignment' },
  clear: { color: '#bbf7d0', text: 'No conflict with existing assignments' },
  checking: { color: '#e5e7eb', text: 'Checking existing schedule…' },
};

const whatIfStatusOf = (assignment) => {
  if (!assignment.conflictChecked) return 'checking';
  return assignment.isConflict ? 'conflict' : 'clear';
};

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
function buildRows({ data, whatIfPreview, inRange, excludedIds, dateRange, collapsedGroups, expandOverrides, onSelectProject, onToggleGroup, onToggleProjectExpand, onFitToRange, selectedProjectId }) {
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

  // A project row is shown either on one line (all phases packed together) or in the
  // staircase view: a summary bar for the whole project, then each phase on its own line.
  // By default only a lone project, or the what-if project, uses the staircase view;
  // the arrow on each row overrides that (expandOverrides).
  const isExpanded = (key, byDefault) =>
    expandOverrides.has(key) ? expandOverrides.get(key) : byDefault;

  // phases: [{ bar, label }] in start order; summaryBar is null when there's nothing to span
  const projectRow = ({ key, expanded, summaryBar, phases: rowPhases, ...rest }) => {
    const base = {
      type: 'item',
      key,
      expanded,
      onToggleExpand: () => onToggleProjectExpand(key, expanded),
      ...rest,
    };
    if (!expanded || !summaryBar) {
      return { ...base, bars: rowPhases.map((phase) => phase.bar) };
    }
    return {
      ...base,
      layout: 'stacked',
      bars: [summaryBar, ...rowPhases.map((phase) => phase.bar)],
      laneLabels: [null, ...rowPhases.map((phase) => phase.label)], // lane 0 shows the title
    };
  };

  const dateRangeText = (start, end) => `${formatShort(start)} – ${formatShort(end)}`;
  const tint = (color) => d3.color(d3.interpolateRgb(color, '#ffffff')(0.55)).formatHex();
  const byStart = (a, b) => a.startDate - b.startDate || a.phaseNumber - b.phaseNumber;

  const singleProjectView = projects.length === 1 && !whatIfPreview;

  // Fit button on a project row: sets the date range to the project's whole timeline.
  // fitActive marks the row whose timeline the range is currently fitted to.
  const fitProps = (start, end, projectId) => {
    if (!start || !end || !onFitToRange) return {};
    return {
      onFit: () => onFitToRange(start, end, projectId),
      fitTitle: `Fit the timeline to this project (${formatDate(start)} – ${formatDate(end)})`,
      fitActive:
        Boolean(dateRange.fit) &&
        +dateRange.start === +d3.timeDay.floor(start) &&
        +dateRange.end === +d3.timeDay.floor(end),
    };
  };

  // A project's whole timeline: earliest to latest date of the project and all its
  // phases (not just the phases in the current range)
  const allPhasesByProject = d3.group(data.phases, (ph) => ph.projectId);
  const projectSpan = (project) => {
    const dates = [project, ...(allPhasesByProject.get(project.id) ?? [])]
      .flatMap((d) => [d.startDate, d.endDate])
      .filter(Boolean);
    return [d3.min(dates), d3.max(dates)];
  };

  const projectRows = projects.map((project) => {
    const expanded = isExpanded(project.id, singleProjectView);
    const resourceCount = plural(resourcesPerProject.get(project.id) ?? 0, 'resource');
    const projectPhases = [...(phasesByProject.get(project.id) ?? [])].sort(byStart);

    return projectRow({
      key: project.id,
      expanded,
      title: `${project.id} · ${project.name}`,
      meta: `${dateRangeText(project.startDate, project.endDate)} · ${resourceCount}`,
      swatch: colorOf(project.id),
      selected: project.id === selectedProjectId,
      onClick: () => onSelectProject(project.id),
      ...fitProps(...projectSpan(project), project.id),
      summaryBar: {
        key: `${project.id}-summary`,
        start: project.startDate,
        end: project.endDate,
        color: tint(colorOf(project.id)),
        isSummary: true,
        label: dateRangeText(project.startDate, project.endDate),
        tooltip: {
          title: `${project.id} · ${project.name}`,
          lines: [phaseDates(project), `${plural(projectPhases.length, 'phase')} in range · ${resourceCount}`],
        },
        onClick: () => onSelectProject(project.id),
      },
      phases: projectPhases.map((phase) => ({
        label: `Phase ${phase.phaseNumber}`,
        bar: {
          key: phase.id,
          start: phase.startDate,
          end: phase.endDate,
          color: colorOf(project.id),
          // On its own line the phase name is in the label column, so the bar shows its dates
          label: expanded ? dateRangeText(phase.startDate, phase.endDate) : `Phase ${phase.phaseNumber}`,
          tooltip: {
            title: `${project.name} · Phase ${phase.phaseNumber}`,
            lines: [phaseDates(phase), plural(resourcesPerPhase.get(phase.id) ?? 0, 'resource')],
          },
          onClick: () => onSelectProject(project.id),
        },
      })),
    });
  });

  // Add the temporary what-if project to the project timeline (staircase view by default).
  if (whatIfPreview) {
    const whatIfName = whatIfPreview.name || 'New project';
    const expanded = isExpanded('what-if-preview', true);

    const whatIfPhases = (whatIfPreview.phases ?? [])
      .map((phase, index) => ({
        phase,
        name: phase.name || `Phase ${index + 1}`,
        startDate: previewDate(phase.start),
        endDate: previewDate(phase.end),
      }))
      .filter((p) => p.startDate && p.endDate && p.startDate <= p.endDate)
      .sort((a, b) => a.startDate - b.startDate);

    // The duration bar uses the project dates if entered, otherwise the span of its phases
    const spanStart = previewDate(whatIfPreview.projectStart) ?? d3.min(whatIfPhases, (p) => p.startDate);
    const spanEnd = previewDate(whatIfPreview.projectEnd) ?? d3.max(whatIfPhases, (p) => p.endDate);
    const hasSpan = spanStart && spanEnd && spanStart <= spanEnd;

    projectRows.push(
      projectRow({
        key: 'what-if-preview',
        expanded,
        title: whatIfName,
        meta: whatIfPreview.place || 'Proposed project',
        swatch: '#7c3aed', // purple, matching the phase bars (--what-if-stroke in App.css)
        selected: false,
        ...(hasSpan ? fitProps(spanStart, spanEnd, null) : {}),
        summaryBar: hasSpan
          ? {
              key: 'what-if-summary',
              start: spanStart,
              end: spanEnd,
              color: '#ede9fe', // GanttChart.css .is-preview-summary
              isPreview: true,
              previewStatus: 'summary',
              label: dateRangeText(spanStart, spanEnd),
              tooltip: {
                title: whatIfName,
                lines: [whatIfPreview.place || 'Proposed project', `${formatDate(spanStart)} – ${formatDate(spanEnd)}`],
              },
            }
          : null,
        phases: whatIfPhases.map((p, index) => ({
          label: p.name,
          bar: {
            key: `what-if-phase-${p.phase.id ?? index}`,
            start: p.startDate,
            end: p.endDate,
            color: '#c4b5fd', // --what-if-fill in App.css
            isPreview: true,
            previewStatus: 'phase',
            label: expanded ? dateRangeText(p.startDate, p.endDate) : p.name,
            tooltip: {
              title: `${whatIfName} — ${p.name}`,
              lines: [whatIfPreview.place || 'Proposed project', `${p.phase.start} – ${p.phase.end}`],
            },
          },
        })),
      })
    );
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

    // Show resources selected in What-if first, then sort the rest alphabetically.
    resources.sort((a, b) => {
      const aSelected = previewAssignmentsByResource.has(
        `${PREVIEW_RESOURCE_TYPES[group.type]}:${a.id}`
      );
      const bSelected = previewAssignmentsByResource.has(
        `${PREVIEW_RESOURCE_TYPES[group.type]}:${b.id}`
      );

      if (aSelected !== bSelected) {
        return aSelected ? -1 : 1;
      }

      return group.label(a).localeCompare(group.label(b));
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
) ?? []).map((assignment) => {
  const status = whatIfStatusOf(assignment);
  return {
    key: `preview-${assignment.resourceType}-${assignment.resourceId}-${assignment.phaseId}`,
    start: previewDate(assignment.startDate),
    end: previewDate(assignment.endDate),
    color: WHAT_IF_STATUS[status].color,
    isPreview: true,
    previewStatus: status,
    label: assignment.phaseName || 'What-if',
    tooltip: {
      title: `${whatIfPreview?.name || 'New project'} — ${assignment.phaseName || 'Phase'}`,
      lines: [
        group.label(resource),
        `${assignment.startDate} – ${assignment.endDate}`,
        WHAT_IF_STATUS[status].text,
        'Temporary resource assignment',
      ],
    },
  };
}),
  
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
  onFitToRange,
}) {
  const projectsScrollRef = useRef(null);
  const resourcesScrollRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  // Project rows switched with their arrow: key -> expanded (staircase) or not.
  // Rows without an entry use the default (see buildRows).
  const [expandOverrides, setExpandOverrides] = useState(() => new Map());

  const toggleProjectExpand = useCallback((key, expanded) => {
    setExpandOverrides((prev) => new Map(prev).set(key, !expanded));
  }, []);

  // Each new what-if starts in the staircase view, even if the last one was collapsed
  useEffect(() => {
    if (whatIfPreview) return;
    setExpandOverrides((prev) => {
      if (!prev.has('what-if-preview')) return prev;
      const next = new Map(prev);
      next.delete('what-if-preview');
      return next;
    });
  }, [whatIfPreview]);

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
    () => buildTimeline(dateRange.start, dateRange.end, availableWidth, { fit: dateRange.fit }),
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
            expandOverrides,
            onSelectProject,
            onToggleGroup: toggleGroup,
            onToggleProjectExpand: toggleProjectExpand,
            onFitToRange,
            selectedProjectId,
          })
        : { projectRows: [], resourceRows: [] },
    [data, whatIfPreview, inRange, excludedIds, dateRange, collapsedGroups, expandOverrides, onSelectProject, toggleGroup, toggleProjectExpand, onFitToRange, selectedProjectId]
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
              focusPreview={Boolean(whatIfPreview)}
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
              focusPreview={Boolean(whatIfPreview)}
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
