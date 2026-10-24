import './Header.css';
import houseIcon from '../icons/house_icon.png';
import calendarIcon from '../icons/calendar_icon.png';
import kpiHomeIcon from '../icons/kpi_home.png';
import kpiPeopleIcon from '../icons/kpi_people.png';
import kpiMaterialIcon from '../icons/kpi_material.png';
import kpiToolsIcon from '../icons/kpi_tools.png';
import { formatDate } from '../data';

const KPIS = [
  { key: 'projects', label: 'Active projects', icon: kpiHomeIcon },
  { key: 'people', label: 'People on site', icon: kpiPeopleIcon },
  { key: 'materialTypes', label: 'Material types', icon: kpiMaterialIcon },
  { key: 'tools', label: 'Tools in use', icon: kpiToolsIcon },
];

// "Jun 10 – Aug 10, 2026", or both years when the range crosses one.
function formatPeriod({ start, end }) {
  const startText =
    start.getFullYear() === end.getFullYear()
      ? formatDate(start).replace(/, \d+$/, '')
      : formatDate(start);
  return `${startText} – ${formatDate(end)}`;
}

function Header({ today: todayDate, summary, dateRange, loading }) {
  const today = todayDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const period = formatPeriod(dateRange);

  return (
    <header className="header">
      <div className="header-brand">
        <div className="logo-tile">
          <img className="header-icon logo-icon" src={houseIcon} alt="" />
        </div>
        <h1>Construction Project Management Dashboard</h1>
      </div>

      <div className="header-right">
        <div className="kpi-group" role="group" aria-label={`Totals for ${period}`}>
          {KPIS.map(({ key, label, icon }) => (
            <div key={key} className="kpi-tile" title={period}>
              <div className="kpi-icon">
                <img src={icon} alt="" />
              </div>
              <div className="kpi-text">
                <span className="kpi-value">
                  {loading ? '–' : summary[key].toLocaleString('en-US')}
                </span>
                <span className="kpi-label">{label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="today-tile">
          <img className="header-icon today-icon" src={calendarIcon} alt="" />
          <div className="today-text">
            <span className="today-label">Today</span>
            <span className="today-date">{today}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
