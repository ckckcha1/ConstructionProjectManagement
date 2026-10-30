import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import './GanttChart.css';

// Reusable Gantt chart used by both charts in ResourceOverview.
// Rows are either group headers or items with bars; ResourceOverview builds them.

// Width of the sticky label column on the left of each chart
export const LABEL_WIDTH = 200;

// Days never get narrower than this, longer ranges scroll horizontally instead
const MIN_DAY_WIDTH = 8;
const BAR_HEIGHT = 20;
const LANE_GAP = 4;
const MIN_ROW_HEIGHT = 40;
const ROW_PADDING_Y = 8;
const BAR_GAP = 2; // surface gap between bars that touch
const BAR_LABEL_PADDING = 6; // space on each side of the text inside a bar
const MIN_WEEK_LABEL_WIDTH = 40;
const TOOLTIP_WIDTH = 240;
const DARK_TEXT = '#0F172A';

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
// Days stretch to fill availableWidth, but never below MIN_DAY_WIDTH.
export function buildTimeline(start, end, availableWidth) {
  const first = d3.timeDay.floor(start);
  const stop = d3.timeDay.offset(d3.timeDay.floor(end), 1);
  const days = Math.max(1, d3.timeDay.count(first, stop));
  // Rounded down so a range that fits never overflows by a fraction of a pixel
  const dayWidth = Math.max(MIN_DAY_WIDTH, Math.floor((availableWidth / days) * 100) / 100);
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
function layoutBars(bars, timeline) {
  const sorted = [...bars].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds = [];
  const lanes = [];
  for (const bar of sorted) {
    let lane = laneEnds.findIndex((end) => end <= bar.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.end;
    (lanes[lane] ??= []).push(bar);
  }

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

const relativeLuminance = (color) => {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = d3.rgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

// White or dark text, whichever has more contrast on the bar color
const labelColors = new Map();
function labelColorOn(color) {
  if (!labelColors.has(color)) {
    const fill = relativeLuminance(color);
    const onWhite = 1.05 / (fill + 0.05);
    const onDark = (fill + 0.05) / (relativeLuminance(DARK_TEXT) + 0.05);
    labelColors.set(color, onWhite >= onDark ? '#FFFFFF' : DARK_TEXT);
  }
  return labelColors.get(color);
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

function GanttChart({ timeline, today, labelHeader, rows, emptyMessage, scrollRef, onScroll, ariaLabel }) {
  const [tooltip, setTooltip] = useState(null);

  const months = useMemo(() => segments(d3.timeMonth, timeline), [timeline]);
  const weeks = useMemo(() => segments(d3.timeMonday, timeline), [timeline]);

  const laidOutRows = useMemo(
    () =>
      rows.map((row) => {
        if (row.type === 'group') return row;
        const { bars, laneCount } = layoutBars(row.bars, timeline);
        const contentHeight = laneCount * (BAR_HEIGHT + LANE_GAP) - LANE_GAP;
        const height = Math.max(MIN_ROW_HEIGHT, contentHeight + 2 * ROW_PADDING_Y);
        const top = (height - contentHeight) / 2;
        return { ...row, height, bars: bars.map((bar) => ({ ...bar, top: top + bar.lane * (BAR_HEIGHT + LANE_GAP) })) };
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
      className="gantt-scroll"
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
              {weeks.map((w) => {
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
            {weeks.slice(1).map((w) => (
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
                    const textColor = labelColorOn(bar.color);
                    const showLabel = textWidth(bar.label) + 2 * BAR_LABEL_PADDING <= bar.width;
                    const className = [
                      'gantt-bar',
                      bar.clippedStart && 'is-clipped-start',
                      bar.clippedEnd && 'is-clipped-end',
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
                          color: textColor,
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

function RowLabel({ row }) {
  const content = (
    <>
      {row.swatch && <span className="gantt-swatch" style={{ background: row.swatch }} aria-hidden="true" />}
      <span className="gantt-label-text">
        <span className="gantt-label-title" title={row.title}>
          {row.title}
        </span>
        <span className="gantt-label-meta" title={row.meta}>
          {row.meta}
        </span>
      </span>
    </>
  );
  return row.onClick ? (
    <button type="button" className="gantt-label is-clickable" onClick={row.onClick}>
      {content}
    </button>
  ) : (
    <div className="gantt-label">{content}</div>
  );
}

export default GanttChart;
