import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import Header from './components/Header';
import Filters from './components/Filters';
import ResourceOverview from './components/ResourceOverview';
import ProjectSites from './components/ProjectSites';
import ProjectDetails from './components/ProjectDetails';
import AddProject from './components/AddProject';
import { TODAY, addMonths, getDefaultProject, getPeriodSummary, getResourcesInRange, loadData,} from './data';

// 3 months with today near the middle (starts 1.5 months back).
// end = addMonths(start, 3) so the "3 months" quick-range button shows as active.
const defaultRange = () => {
  const monthBack = addMonths(TODAY, -1);
  const start = new Date(monthBack.getFullYear(), monthBack.getMonth(), monthBack.getDate() - 15);
  return { start, end: addMonths(start, 3) };
};

// Stores the UNCHECKED items, so anything new that appears when the range
// changes starts out checked.
const emptyExclusions = () => ({
  projects: new Set(),
  workers: new Set(),
  tools: new Set(),
  materials: new Set(),
});

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [dateRange, setDateRange] = useState(defaultRange);
  const [searchQuery, setSearchQuery] = useState('');
  const [excludedIds, setExcludedIds] = useState(emptyExclusions);
  // Set by clicking a project in ResourceOverview (Gantt) or ProjectSites (map or Locations list).
  // Null means nobody picked one, so the views show getDefaultProject instead.
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [whatIfPreview, setWhatIfPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

    // Refresh dashboard data after a new project is saved
  const refreshData = useCallback(async (newProjectId) => {
  setLoading(true);
  try {
    const result = await loadData();
    setData(result);

    if (newProjectId) {
      setSelectedProjectId(newProjectId);
    }

    setError(null);
  } catch (err) {
    setError(err.message || 'Failed to refresh data');
  } finally {
    setLoading(false);
  }
}, []);

  const inRange = useMemo(
    () => getResourcesInRange(data, dateRange.start, dateRange.end),
    [data, dateRange]
  );

  const summary = useMemo(() => getPeriodSummary(inRange), [inRange]);

  // The filter panel lists every project, not just the ones in the date range
  const allProjects = useMemo(
    () =>
      data
        ? [...data.projects].sort((a, b) => a.startDate - b.startDate || a.id.localeCompare(b.id))
        : [],
    [data]
  );

  // Projects in the date range that are checked in the filter panel,
  // the same projects the project Gantt chart shows
  const visibleProjects = useMemo(
    () => inRange.projects.filter((p) => !excludedIds.projects.has(p.id)),
    [inRange, excludedIds]
  );

  const selectedProject = useMemo(
    () =>
      selectedProjectId == null
        ? null
        : inRange.projects.find((p) => p.id === selectedProjectId) ?? null,
    [inRange, selectedProjectId]
  );
  const displayedProject = selectedProject ?? getDefaultProject(inRange);

  // A range change that drops the selected project falls back to the default.
  // Skipped until data loads, when inRange is empty for every project.
  useEffect(() => {
    if (data && selectedProjectId != null && !selectedProject) setSelectedProjectId(null);
  }, [data, selectedProjectId, selectedProject]);

  const handleToggle = useCallback((type, id) => {
    setExcludedIds((prev) => {
      const next = new Set(prev[type]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [type]: next };
    });
  }, []);

  // Checks (checked = true) or unchecks every id in the list for one group.
  const handleSetGroup = useCallback((type, ids, checked) => {
    setExcludedIds((prev) => {
      const next = new Set(prev[type]);
      ids.forEach((id) => (checked ? next.delete(id) : next.add(id)));
      return { ...prev, [type]: next };
    });
  }, []);

  const handleReset = useCallback(() => {
    setDateRange(defaultRange());
    setSearchQuery('');
    setExcludedIds(emptyExclusions());
  }, []);

  return (
    <div className="app">
      <Header today={TODAY} summary={summary} dateRange={dateRange} loading={loading} />

      <main className="app-body">
        <Filters
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          inRange={inRange}
          allProjects={allProjects}
          excludedIds={excludedIds}
          onToggle={handleToggle}
          onSetGroup={handleSetGroup}
          onReset={handleReset}
          loading={loading}
          error={error}
          projectColorById={data?.projectColorById}
        />

        <div className="column column-middle">
          <ResourceOverview
            data={data}
            whatIfPreview={whatIfPreview}
            inRange={inRange}
            excludedIds={excludedIds}
            dateRange={dateRange}
            today={TODAY}
            loading={loading}
            error={error}
            selectedProjectId={displayedProject?.id ?? null}
            onSelectProject={setSelectedProjectId}
          />
          <ProjectSites
            data={data}
            projects={visibleProjects}
            dateRange={dateRange}
            selectedProjectId={displayedProject?.id ?? null}
            isDefaultSelection={selectedProjectId == null}
            onSelectProject={setSelectedProjectId}
          />
        </div>

        <div className="column column-right">
          <ProjectDetails
            project={displayedProject}
            isDefault={selectedProjectId == null}
            data={data}
            loading={loading}
            error={error}
          />
          <AddProject
              data={data}
              onSaved={refreshData}
              onPreviewChange={setWhatIfPreview}
          />
        </div>
      </main>
    </div>
  );
}

export default App;