import { useState } from 'react';
import './Filters.css';
import searchIcon from '../icons/search_icon.png';
import { addMonths, formatDate, fromInputValue, toInputValue } from '../data';

const QUICK_MONTHS = [1, 2, 3];
const VISIBLE_ROWS = 5;

const formatShort = (date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// date display
const formatRange = (start, end) =>
  start.getFullYear() === end.getFullYear()
    ? `${formatShort(start)} – ${formatDate(end)}`
    : `${formatDate(start)} – ${formatDate(end)}`;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const GROUPS = [
  {
    type: 'projects',
    title: 'Projects',
    noun: 'projects',
    empty: 'No active or upcoming projects for this date range',
    label: (p) => p.name,
    meta: (p) => `${p.id}`,
    color: (p, colors) => colors?.get(p.id),
    searchText: (p) => [p.name, p.description, p.id],
  },
  {
    type: 'workers',
    title: 'People',
    noun: 'people',
    label: (w) => w.name,
    meta: (w) => w.role,
    searchText: (w) => [w.name, w.id],
  },
  {
    type: 'tools',
    title: 'Tools',
    noun: 'tools',
    label: (t) => t.description,
    meta: (t) => `×${t.quantity}`,
    searchText: (t) => [t.name, t.description, t.id],
  },
  {
    type: 'materials',
    title: 'Materials',
    noun: 'materials',
    label: (m) => m.description,
    meta: (m) => `${m.quantity} ${m.unit}`,
    searchText: (m) => [m.name, m.description, m.id],
  },
];

function SearchIcon() {
  return (
    <img className="filters-search-icon" src={searchIcon} width="14" height="14" alt="" aria-hidden="true" />
  );
}

function FilterGroup({ group, items, totalCount, excluded, searching, onToggle, onSetGroup, colors, isOutside }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const showAll = searching || expanded;
  const visible = showAll ? items : items.slice(0, VISIBLE_ROWS);
  const hiddenCount = items.length - VISIBLE_ROWS;
  const ids = items.map((item) => item.id);
  const listId = `filter-group-${group.type}`;

  return (
    <section className="filter-group">
      <div className="filter-group-header">
        <button
          type="button"
          className="filter-group-toggle"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="filter-chevron" aria-hidden="true" />
          <span className="label-caps">{group.title}</span>
          <span className="count-pill">{totalCount}</span>
        </button>
        <div className="filter-group-actions">
          <button
            type="button"
            className="text-button"
            disabled={ids.length === 0}
            onClick={() => onSetGroup(group.type, ids, true)}
            aria-label={`Select all ${group.noun}`}
          >
            All
          </button>
          <span className="filter-group-sep" aria-hidden="true">/</span>
          <button
            type="button"
            className="text-button"
            disabled={ids.length === 0}
            onClick={() => onSetGroup(group.type, ids, false)}
            aria-label={`Select no ${group.noun}`}
          >
            None
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id={listId}>
          {items.length === 0 ? (
            <p className="filters-muted filter-empty">
              {searching ? 'No matches' : group.empty ?? `No ${group.noun} in this period`}
            </p>
          ) : (
            <ul className="filter-list">
              {visible.map((item) => {
                const color = group.color?.(item, colors);
                const outside = isOutside?.(item);
                return (
                  <li key={item.id}>
                    <label
                      className={`filter-row${color ? ' has-color' : ''}${outside ? ' is-outside' : ''}`}
                      style={color ? { '--item-color': color } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.has(item.id)}
                        onChange={() => onToggle(group.type, item.id)}
                      />
                      {color && <span className="filter-dot" aria-hidden="true" />}
                      <span className="filter-row-text">
                        <span className="filter-row-name">{group.label(item)}</span>
                        <span className="filter-row-meta">
                          {group.meta(item)}
                          {outside && ' · Outside date range'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {!searching && hiddenCount > 0 && (
            <button
              type="button"
              className="text-button show-more"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Filters({
  dateRange,
  onDateRangeChange,
  searchQuery,
  onSearchChange,
  inRange,
  listedProjects,
  excludedIds,
  onToggle,
  onSetGroup,
  onReset,
  loading,
  error,
  projectColorById,
}) {
  const { start, end } = dateRange;

  // Projects list ONLY ongoing and upcoming projects 
  // sorted by start date in App,
  // upcoming projects with no phase in the range are marked and showed as "outside date range".
  const inRangeProjectIds = new Set(inRange.projects.map((p) => p.id));
  const isOutsideRange = (project) => !inRangeProjectIds.has(project.id);
  const itemsFor = (type) => (type === 'projects' ? listedProjects : inRange[type]);
  const query = searchQuery.trim().toLowerCase();
  const searching = query !== '';

  const matches = (group, item) =>
    !searching ||
    group.searchText(item).some((text) => text && text.toLowerCase().includes(query));

  // If From ends up after To, guidance To follows From.
  const changeStart = (value) => {
    const date = fromInputValue(value);
    if (!date) return;
    onDateRangeChange({ start: date, end: date > end ? date : end });
  };

  const changeEnd = (value) => {
    const date = fromInputValue(value);
    if (!date) return;
    onDateRangeChange({ start, end: date < start ? start : date });
  };

  const activeMonths = QUICK_MONTHS.find(
    (n) => addMonths(start, n).getTime() === end.getTime()
  );

  let listContent;
  if (loading) {
    listContent = <p className="filters-muted">Loading data…</p>;
  } else if (error) {
    listContent = (
      <p className="filters-error" role="alert">
        {error}
      </p>
    );
  } else {
    listContent = GROUPS.map((group) => (
      <FilterGroup
        key={group.type}
        group={group}
        items={itemsFor(group.type).filter((item) => matches(group, item))}
        totalCount={itemsFor(group.type).length}
        excluded={excludedIds[group.type]}
        searching={searching}
        onToggle={onToggle}
        onSetGroup={onSetGroup}
        colors={projectColorById}
        isOutside={group.type === 'projects' ? isOutsideRange : undefined}
      />
    ));
  }

  return (
    <aside className="panel panel-filters">
      <h2>Filters</h2>

      <div className="filters-search">
        <label htmlFor="filters-search-input" className="sr-only">
          Search
        </label>
        <SearchIcon />
        <input
          id="filters-search-input"
          type="search"
          placeholder="Search projects, people, tools, materials…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <section className="filters-dates" aria-labelledby="filters-dates-title">
        <div id="filters-dates-title" className="label-caps filters-section-title">
          Date range
        </div>

        <div className="date-inputs">
          <div className="date-field">
            <label htmlFor="filters-date-from">From</label>
            <input
              id="filters-date-from"
              type="date"
              value={toInputValue(start)}
              onChange={(e) => changeStart(e.target.value)}
            />
          </div>
          <div className="date-field">
            <label htmlFor="filters-date-to">To</label>
            <input
              id="filters-date-to"
              type="date"
              value={toInputValue(end)}
              onChange={(e) => changeEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="quick-range" role="group" aria-label="Quick range">
          {QUICK_MONTHS.map((n) => (
            <button
              key={n}
              type="button"
              className={`quick-button${activeMonths === n ? ' is-active' : ''}`}
              aria-pressed={activeMonths === n}
              onClick={() => onDateRangeChange({ start, end: addMonths(start, n) })}
            >
              {plural(n, 'month')}
            </button>
          ))}
        </div>

        <p className="filters-muted filters-summary">
          {formatRange(start, end)}
          {!loading && !error && ` · ${plural(inRange.projects.length, 'project')}`}
        </p>
      </section>

      <div className="filters-body">{listContent}</div>

      <div className="filters-footer">
        <button type="button" className="reset-button" onClick={onReset}>
          Reset filters
        </button>
      </div>
    </aside>
  );
}

export default Filters;
