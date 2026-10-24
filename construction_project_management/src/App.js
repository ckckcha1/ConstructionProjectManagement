import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import Header from './components/Header';
import Filters from './components/Filters';
import ResourceOverview from './components/ResourceOverview';
import ProjectSites from './components/ProjectSites';
import ProjectDetails from './components/ProjectDetails';
import AddProject from './components/AddProject';
import { DEMO_TODAY, addMonths, getResourcesInRange, loadData } from './data';

const defaultRange = () => ({ start: DEMO_TODAY, end: addMonths(DEMO_TODAY, 2) });

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

  const inRange = useMemo(
    () => getResourcesInRange(data, dateRange.start, dateRange.end),
    [data, dateRange]
  );

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
      <Header today={DEMO_TODAY} />

      <main className="app-body">
        <Filters
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          inRange={inRange}
          excludedIds={excludedIds}
          onToggle={handleToggle}
          onSetGroup={handleSetGroup}
          onReset={handleReset}
          loading={loading}
          error={error}
        />

        <div className="column column-middle">
          <ResourceOverview />
          <ProjectSites />
        </div>

        <div className="column column-right">
          <ProjectDetails />
          <AddProject />
        </div>
      </main>
    </div>
  );
}

export default App;
