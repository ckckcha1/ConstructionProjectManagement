import './Header.css';
import houseIcon from './house_icon.png';
import calendarIcon from './calendar_icon.png';

function Header() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <header className="header">
      <div className="header-brand">
        <div className="logo-tile">
          <img className="header-icon logo-icon" src={houseIcon} alt="" />
        </div>
        <h1>Construction Project Management Dashboard</h1>
      </div>

      <div className="today-tile">
        <img className="header-icon today-icon" src={calendarIcon} alt="" />
        <div className="today-text">
          <span className="today-label">Today</span>
          <span className="today-date">{today}</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
