import './ResourceOverview.css';

function ResourceOverview() {
  return (
    <section className="panel panel-resource">
      <h2>Resource overview</h2>
      <div className="resource-sections">
        <div className="timeline-section">
          <h3>Project timeline</h3>
          <div className="chart-area dev-outline" />
        </div>

        <div className="section-divider" />

        <div className="gantt-section">
          <h3>Resource Gantt</h3>
          <div className="chart-area dev-outline" />
        </div>
      </div>
    </section>
  );
}

export default ResourceOverview;
