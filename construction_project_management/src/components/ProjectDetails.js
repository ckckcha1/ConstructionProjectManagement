import './ProjectDetails.css';
import locationIcon from '../icons/location.png';
import { formatDate } from '../data';

// Days in millisec
const DAY_MS = 24 * 60 * 60 * 1000;

// Inclusive of both ends
// Rounding absorbs daylight-saving shifts
const daysBetween = (start, end) => Math.round((end - start) / DAY_MS) + 1;

function DetailsBody({ project, isDefault, data, loading, error }) {
  if (loading) return <p className="details-message">Loading…</p>;
  if (error) return <p className="details-message">{error}</p>;
  if (!project) {
    return (
      <p className="details-message">No projects in this period. Try a different date range.</p>
    );
  }

  const phaseCount = data.phases.filter((p) => p.projectId === project.id).length;
  const days = daysBetween(project.startDate, project.endDate);

  return (
    <>
      <div className="details-heading">
        <div className="details-title">
          <span
            className="details-dot"
            style={{ background: data.projectColorById.get(project.id) }}
            aria-hidden="true"
          />
          <span>{project.name}</span>
        </div>
        <div className="details-id">{project.id}</div>
      </div>

      <div className="details-section">
        <div className="label-caps">Timeline</div>
        <div className="details-timeline details-value">
          <span>{formatDate(project.startDate)}</span>
          <span className="details-arrow" aria-hidden="true">→</span>
          <span>{formatDate(project.endDate)}</span>
        </div>
        <div className="details-meta">
          {phaseCount} {phaseCount === 1 ? 'phase' : 'phases'} · {days} days
        </div>
      </div>

      <div className="details-section">
        <div className="label-caps">Location</div>
        <div className="details-location details-value">
          <img className="details-location-icon" src={locationIcon} alt="" />
          <span>
            {project.location}, {project.city}
          </span>
        </div>
      </div>

      <div className="details-section">
        <div className="label-caps">Description</div>
        <p className="details-description">{project.description}</p>
      </div>
    </>
  );
}

function ProjectDetails(props) {
  return (
    <section className="panel panel-details">
      <h2 className="label-caps">Project details</h2>
      <div className="panel-body details-body">
        <DetailsBody {...props} />
      </div>
    </section>
  );
}

export default ProjectDetails;
