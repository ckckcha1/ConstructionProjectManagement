import './Header.css';

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
          <svg className="header-icon logo-icon" aria-hidden="true" />
        </div>
        <h1>Construction Project Management Dashboard</h1>
      </div>

      <div className="today-tile">
        <svg className="header-icon today-icon" aria-hidden="true" />
        <div className="today-text">
          <span className="today-label">Today</span>
          <span className="today-date">{today}</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
