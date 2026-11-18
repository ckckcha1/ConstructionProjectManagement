import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import './GanttChart.css';

// Reusable Gantt chart used by both charts in ResourceOverview.
// Rows are either group headers or items with bars; ResourceOverview builds them.

// Width of the sticky label column on the left of each chart
export const LABEL_WIDTH = 200;

// Days never get narrower than this, longer ranges scroll horizontally instead
const MIN_DAY_WIDTH = 8;
// When fitting to a project, days can get this narrow (a multi-year project still fits)
const MIN_FIT_DAY_WIDTH = 0.25;
// Narrower weeks than this get no week header cells or week gridlines, only months
const MIN_WEEK_CELL_WIDTH = 14;
const BAR_HEIGHT = 20;
const LANE_GAP = 20;
const MIN_ROW_HEIGHT = 40;
const ROW_PADDING_Y = 18;
const BAR_GAP = 2; // surface gap between bars that touch
const BAR_LABEL_PADDING = 6; // space on each side of the text inside a bar
const MIN_WEEK_LABEL_WIDTH = 40;
const TOOLTIP_WIDTH = 240;

const formatMonth = d3.timeFormat('%B %Y');
const formatMonthShort = d3.timeFormat('%b');
const MONTH_LABEL_PADDING = 16;

// Full month name if it fits in the segment, else "Apr", else nothing
function monthLabel(segment) {
  const full = formatMonth(segment.from);
  if (textWidth(full) + MONTH_LABEL_PADDING <= segment.width) return full;
  const short = formatMonthShort(segment.from);
  return textWidth(short) + MONTH_LABEL_PADDING <= segment.width ? short : '';
}
const formatWeek = d3.timeFormat('%d %b');

// Shared x-axis for both charts. end is inclusive (the last day shown).
// Days stretch to fill availableWidth, but never below MIN_DAY_WIDTH, unless fit is
// true (fitting the charts to a project), where days shrink so the whole range fits.
export function buildTimeline(start, end, availableWidth, { fit = false } = {}) {
  const first = d3.timeDay.floor(start);
  const stop = d3.timeDay.offset(d3.timeDay.floor(end), 1);
  const days = Math.max(1, d3.timeDay.count(first, stop));
  const minDayWidth = fit ? MIN_FIT_DAY_WIDTH : MIN_DAY_WIDTH;
  // Rounded down so a range that fits never overflows by a fraction of a pixel
  const dayWidth = Math.max(minDayWidth, Math.floor((availableWidth / days) * 100) / 100);
  // Counting days (not ms) keeps every day the same width across daylight-saving changes
  const x = (date) => d3.timeDay.count(first, date) * dayWidth;
  return { start: first, stop, dayWidth, width: days * dayWidth, x };
}

// The timeline cut at every interval boundary (each month, each week) into [from, to) pieces
function segments(interval, timeline) {
  const cuts = interval.range(d3.timeDay.offset(timeline.start, 1), timeline.stop);
  return d3.pairs([timeline.start, ...cuts, timeline.stop], (from, to) => ({
    from,
    left: timeline.x(from),
    width: timeline.x(to) - timeline.x(from),
  }));
}

// Puts bars in lanes so overlapping bars don't cover each other.
// A bar starting the day the previous one ends (a handoff) stays in the same lane,
// and the later bar gets the shared day.
function packLanes(bars) {
  const sorted = [...bars].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds = [];
  const lanes = [];
  for (const bar of sorted) {
    let lane = laneEnds.findIndex((end) => end <= bar.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.end;
    (lanes[lane] ??= []).push(bar);
  }
  return lanes;
}

// layout 'stacked' (the staircase view): every bar gets its own lane, in the order given.
// Otherwise bars are packed into as few lanes as possible.
function layoutBars(bars, timeline, layout) {
  const lanes =
    layout === 'stacked'
      ? bars.map((bar) => [bar])
      : [
          // What-if preview bars always go in lanes below the saved bars, so the conflict
          // banner drawn above a saved bar never covers a preview bar
          ...packLanes(bars.filter((bar) => !bar.isPreview)),
          ...packLanes(bars.filter((bar) => bar.isPreview)),
        ];

  const placed = [];
  lanes.forEach((laneBars, lane) => {
    laneBars.forEach((bar, i) => {
      const next = laneBars[i + 1];
      const stop = d3.timeDay.offset(bar.end, 1); // end date is inclusive
      const clippedStart = bar.start < timeline.start;
      const clippedEnd = stop > timeline.stop;
      const left = timeline.x(clippedStart ? timeline.start : bar.start);
      let right = timeline.x(clippedEnd ? timeline.stop : stop);
      if (next && next.start < stop) right = Math.min(right, timeline.x(next.start));
      placed.push({
        ...bar,
        lane,
        left,
        width: Math.max(2, right - left - BAR_GAP),
        clippedStart,
        clippedEnd,
      });
    });
  });
  return { bars: placed, laneCount: Math.max(1, lanes.length) };
}

let measureContext;
function textWidth(text) {
  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext?.('2d') ?? null;
    if (measureContext) {
      measureContext.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
    }
  }
  return measureContext ? measureContext.measureText(text).width : Infinity;
}


function Tooltip({ tooltip }) {
  const { bar, x, y } = tooltip;
  const left = Math.max(8, Math.min(x + 12, window.innerWidth - TOOLTIP_WIDTH - 8));
  const below = y + 120 < window.innerHeight;
  return (
    <div
      className="gantt-tooltip"
      role="tooltip"
      style={{
        left,
        top: below ? y + 16 : y - 12,
        width: TOOLTIP_WIDTH,
        transform: below ? undefined : 'translateY(-100%)',
      }}
    >
      <div className="gantt-tooltip-title">
        <span className="gantt-tooltip-key" style={{ background: bar.color }} aria-hidden="true" />
        {bar.tooltip.title}
      </div>
      {bar.tooltip.lines.map((line) => (
        <div key={line} className="gantt-tooltip-line">
          {line}
        </div>
      ))}
    </div>
  );
}

// focusPreview: a what-if project is being built, so saved bars are dimmed to make it stand out
function GanttChart({ timeline, today, labelHeader, rows, focusPreview, emptyMessage, scrollRef, onScroll, ariaLabel }) {
  const [tooltip, setTooltip] = useState(null);

  const months = useMemo(() => segments(d3.timeMonth, timeline), [timeline]);
  const weeks = useMemo(() => segments(d3.timeMonday, timeline), [timeline]);
  // A long range fitted into the view makes weeks too narrow to show; months only then
  const showWeeks = timeline.dayWidth * 7 >= MIN_WEEK_CELL_WIDTH;
  const gridSegments = showWeeks ? weeks : months;

  const laidOutRows = useMemo(
    () =>
      rows.map((row) => {
        if (row.type === 'group') return row;
        const { bars, laneCount } = layoutBars(row.bars, timeline, row.layout);
        const contentHeight = laneCount * (BAR_HEIGHT + LANE_GAP) - LANE_GAP;
        const height = Math.max(MIN_ROW_HEIGHT, contentHeight + 2 * ROW_PADDING_Y);
        const top = (height - contentHeight) / 2;
        // Saved bars overlapping a what-if bar in this row compete with the new project
        // for this resource, so they stay undimmed in what-if mode
        const previews = bars.filter((bar) => bar.isPreview);
        return {
          ...row,
          height,
          // Top of each lane, so a stacked row's labels line up with their bars
          laneTops: d3.range(laneCount).map((lane) => top + lane * (BAR_HEIGHT + LANE_GAP)),
          bars: bars.map((bar) => ({
            ...bar,
            top: top + bar.lane * (BAR_HEIGHT + LANE_GAP),
            overlapsPreview:
              !bar.isPreview && previews.some((p) => bar.start <= p.end && p.start <= bar.end),
          })),
        };
      }),
    [rows, timeline]
  );

  const todayDay = today ? d3.timeDay.floor(today) : null;
  const showToday = todayDay && todayDay >= timeline.start && todayDay < timeline.stop;
  const todayX = showToday ? timeline.x(todayDay) + timeline.dayWidth / 2 : null;

  const showTooltip = (bar, x, y) => setTooltip({ bar, x, y });
  const hideTooltip = () => setTooltip(null);

  return (
    <div
      className={`gantt-scroll${focusPreview ? ' is-what-if' : ''}`}
      ref={scrollRef}
      onScroll={() => {
        hideTooltip();
        onScroll?.();
      }}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{ '--label-width': `${LABEL_WIDTH}px` }}
    >
      <div className="gantt-content" style={{ width: LABEL_WIDTH + timeline.width }}>
        <div className="gantt-header">
          <div className="gantt-corner">{labelHeader}</div>
          <div className="gantt-axis" style={{ width: timeline.width }}>
            <div className="gantt-months">
              {months.map((m) => (
                <div key={+m.from} className="gantt-month" style={{ width: m.width }}>
                  <span>{monthLabel(m)}</span>
                </div>
              ))}
            </div>
            <div className="gantt-weeks">
              {showWeeks && weeks.map((w) => {
                const current = showToday && todayX >= w.left && todayX < w.left + w.width;
                return (
                  <div
                    key={+w.from}
                    className={`gantt-week${current ? ' is-current' : ''}`}
                    style={{ left: w.left, width: w.width }}
                  >
                    {w.width >= MIN_WEEK_LABEL_WIDTH && <span>{formatWeek(w.from)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="gantt-body">
          <svg className="gantt-grid" style={{ left: LABEL_WIDTH, width: timeline.width }} aria-hidden="true">
            {gridSegments.slice(1).map((w) => (
              <line key={+w.from} x1={w.left + 0.5} x2={w.left + 0.5} y1="0" y2="100%" />
            ))}
          </svg>

          {laidOutRows.length === 0 && <p className="gantt-empty">{emptyMessage}</p>}

          {laidOutRows.map((row) =>
            row.type === 'group' ? (
              <div key={row.key} className="gantt-group">
                <button
                  type="button"
                  className="gantt-group-toggle"
                  aria-expanded={!row.collapsed}
                  onClick={row.onToggle}
                >
                  <span className={`gantt-chevron${row.collapsed ? ' is-collapsed' : ''}`} aria-hidden="true" />
                  <span className="gantt-group-title">{row.title}</span>
                  <span className="gantt-group-count">
                    {row.count} {row.count === 1 ? 'resource' : 'resources'}
                  </span>
                </button>
              </div>
            ) : (
              <div
                key={row.key}
                className={`gantt-row${row.selected ? ' is-selected' : ''}`}
                style={{ height: row.height }}
              >
                <RowLabel row={row} />
                <div className="gantt-track" style={{ width: timeline.width }}>
                  {row.bars.map((bar) => {
                    const showLabel = textWidth(bar.label) + 2 * BAR_LABEL_PADDING <= bar.width;
                    const className = [
                      'gantt-bar',
                      bar.isSummary && 'is-summary',
                      bar.isPreview && 'is-preview',
                      bar.previewStatus && `is-preview-${bar.previewStatus}`,
                      bar.overlapsPreview && 'overlaps-preview',
                      bar.clippedStart && 'is-clipped-start',
                      bar.clippedEnd && 'is-clipped-end',
                      bar.isConflict && 'is-conflict',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={bar.key}
                        type="button"
                        className={className}
                        style={{
                          left: bar.left,
                          top: bar.top,
                          width: bar.width,
                          height: BAR_HEIGHT,
                          background: bar.color,
                        }}
                        aria-label={`${bar.tooltip.title}: ${bar.tooltip.lines.join(', ')}`}
                        onClick={bar.onClick}
                        onPointerMove={(e) => showTooltip(bar, e.clientX, e.clientY)}
                        onPointerLeave={hideTooltip}
                        onFocus={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          showTooltip(bar, rect.left + rect.width / 2, rect.bottom);
                        }}
                        onBlur={hideTooltip}
                      >
                        {bar.isConflict && (
                            <span className="gantt-conflict-banner">
                                ⚠ Conflict
                            </span>
                        )}
                        {showLabel && <span className="gantt-bar-label">{bar.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {showToday && (
            <div className="gantt-today-line" style={{ left: LABEL_WIDTH + todayX }} aria-hidden="true" />
          )}
        </div>
      </div>

      {tooltip && <Tooltip tooltip={tooltip} />}
    </div>
  );
}

// Arrow that switches a project row between one line and the staircase view
function ExpandToggle({ row }) {
  if (!row.onToggleExpand) return null;
  return (
    <button
      type="button"
      className="gantt-expand"
      aria-expanded={row.expanded}
      aria-label={`${row.expanded ? 'Collapse' : 'Expand'} the phases of ${row.title}`}
      title={row.expanded ? 'Show on one line' : 'Show each phase on its own line'}
      onClick={row.onToggleExpand}
    >
      <span className={`gantt-chevron${row.expanded ? '' : ' is-collapsed'}`} aria-hidden="true" />
    </button>
  );
}

// Button that fits the charts' date range to this project's whole timeline
function FitButton({ row }) {
  if (!row.onFit) return null;
  return (
    <button
      type="button"
      className={`gantt-fit${row.fitActive ? ' is-active' : ''}`}
      aria-pressed={Boolean(row.fitActive)}
      aria-label={`Fit the timeline to ${row.title}`}
      title={row.fitTitle ?? 'Fit the timeline to this project'}
      onClick={row.onFit}
    >
      {/* |←→| : stretch to fit */}
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2 3v10M14 3v10M4.5 8h7M6.5 5.5 4 8l2.5 2.5M9.5 5.5 12 8l-2.5 2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function RowLabel({ row }) {
  const swatch = row.swatch && (
    <span className="gantt-swatch" style={{ background: row.swatch }} aria-hidden="true" />
  );
  // The clickable part (selects the project) is separate from the arrow, since buttons can't nest
  const Main = row.onClick ? 'button' : 'div';
  const mainProps = row.onClick ? { type: 'button', onClick: row.onClick } : {};
  const mainClass = `gantt-label-main${row.onClick ? ' is-clickable' : ''}`;

  if (row.layout === 'stacked') {
    // Staircase view: the title sits beside the first lane (the summary bar)
    // and each phase's name beside its own lane
    return (
      <div className="gantt-label is-stacked">
        <div className="gantt-lane-label is-title" style={{ top: row.laneTops[0] }}>
          <ExpandToggle row={row} />
          <Main className={mainClass} {...mainProps}>
            {swatch}
            <span className="gantt-label-title" title={row.title}>
              {row.title}
            </span>
          </Main>
          <FitButton row={row} />
        </div>
        {row.laneLabels?.map(
          (text, lane) =>
            text && (
              <span key={lane} className="gantt-lane-label" style={{ top: row.laneTops[lane] }} title={text}>
                {text}
              </span>
            )
        )}
      </div>
    );
  }

  return (
    <div className="gantt-label">
      <ExpandToggle row={row} />
      <Main className={mainClass} {...mainProps}>
        {swatch}
        <span className="gantt-label-text">
          <span className="gantt-label-title" title={row.title}>
            {row.title}
          </span>
          <span className="gantt-label-meta" title={row.meta}>
            {row.meta}
          </span>
        </span>
      </Main>
      <FitButton row={row} />
    </div>
  );
}

export default GanttChart;
