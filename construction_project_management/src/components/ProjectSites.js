import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './ProjectSites.css';
import { overlaps } from '../data';

const MAX_LISTED = 10;            // projects shown in the right-hand list
const FIT_MAX_ZOOM = 17;         // max zoom when framing all projects
const SELECT_ZOOM = 16;          // zoom when a project is selected
const FALLBACK_VIEW = { center: [8.55, -80.1], zoom: 7 }; // all of Panama, [lat, lon]

// Projects sharing the same coordinates are spread on a tiny ring (~75 m)
// so each one stays visible and clickable. Set to 0 to disable.
const SPREAD_DEG = 0.0007;

const TILE_LAYERS = {
  Streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  Satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    },
  },
};

// Approximate [lon, lat] fallbacks, used only when a project has no
// latitude/longitude of its own. Add the real locations from your CSVs here.
const LOCATION_COORDINATES = [
  { match: 'via cincuentenario', coordinates: [-79.48500, 9.00500] },
  { match: 'via brasil', coordinates: [-79.51772, 8.99038] },
  { match: 'samaria', coordinates: [-79.50000, 9.03333] },
  { match: 'bethania', coordinates: [-79.52756, 9.01235] },
  { match: 'el cangrejo', coordinates: [-79.52880, 8.98805] },
  { match: 'utp', coordinates: [-79.53200, 9.02800] },
  { match: 'calidonia', coordinates: [-79.53586, 8.96726] },
  { match: 'san francisco', coordinates: [-79.50818, 8.99235] },
  { match: 'rio abajo', coordinates: [-79.49361, 9.02397] },
  { match: 'boca la caja', coordinates: [-79.50580, 8.98453] },
  { match: 'coco del mar', coordinates: [-79.49674, 8.99645] },
  { match: 'ancon', coordinates: [-79.55000, 8.96000] },
  // { match: 'colon', coordinates: [-79.90070, 9.35470] },
  { match: 'ave balboa', coordinates: [-79.52900, 8.97100] },
  // { match: 'los santos', coordinates: [-80.41667, 7.93333] },
  // { match: 'don bosco', coordinates: [-79.40500, 9.07500] },
  { match: 'panama city', coordinates: [-79.52000, 8.98000] }, // fallback
];

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function getCoordinates(project) {
  // 1) Prefer real coordinates if the project data has them.
  const lat = parseFloat(project.latitude ?? project.lat);
  const lon = parseFloat(
    project.longitude ?? project.lng ?? project.lon ?? project.long
  );
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  ) {
    return [lon, lat];
  }

  // 2) Fall back to the approximate lookup by city/location text.
  const text = normalize(`${project.city || ''} ${project.location || ''}`);
  const match = LOCATION_COORDINATES.find((item) =>
    text.includes(normalize(item.match))
  );
  return match ? match.coordinates : null;
}

// Spread projects that share exactly the same coordinates.
function withMapPositions(projects) {
  const groups = new Map();
  projects.forEach((project) => {
    const key = project.coordinates.map((c) => c.toFixed(5)).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  });

  const result = [];
  groups.forEach((group) => {
    if (group.length === 1 || SPREAD_DEG === 0) {
      group.forEach((p) => result.push({ ...p, position: p.coordinates }));
      return;
    }
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2;
      const [lon, lat] = p.coordinates;
      result.push({
        ...p,
        position: [
          lon + (SPREAD_DEG * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180),
          lat + SPREAD_DEG * Math.sin(angle),
        ],
      });
    });
  });
  return result;
}

// Counts only the resources on the project's phases inside the date range.
function getProjectCounts(data, projectId, dateRange) {
  const projectPhases = new Set(
    data.phases
      .filter(
        (phase) =>
          phase.projectId === projectId &&
          phase.startDate &&
          phase.endDate &&
          overlaps(phase.startDate, phase.endDate, dateRange.start, dateRange.end)
      )
      .map((phase) => phase.id)
  );

  const resourceIds = new Set(
    data.assignments
      .filter(
        (assignment) =>
          assignment.projectId === projectId &&
          projectPhases.has(assignment.phaseId)
      )
      .map((assignment) => assignment.resourceId)
  );

  let people = 0;
  let tools = 0;
  let materials = 0;

  resourceIds.forEach((id) => {
    if (data.workersById.has(id)) people += 1;
    if (data.toolsById.has(id)) tools += 1;
    if (data.materialsById.has(id)) materials += 1;
  });

  return { people, tools, materials };
}

// Built with DOM elements (not HTML strings) so project data is never injected as HTML.
function buildIcon(project) {
  const pin = document.createElement('span');
  pin.className = 'project-pin';
  pin.style.backgroundColor = project.color;

  return L.divIcon({
    className: 'project-pin-wrapper',
    html: pin,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// inRangeProjects is the date-filtered list from App (same one Filters shows).
function ProjectSites({ data, projects: inRangeProjects, dateRange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(new Map()); // project id -> { marker, project }
  const prevSelectedRef = useRef(null);

  const [selectedId, setSelectedId] = useState(null);

  const projects = useMemo(() => {
    if (!data || !inRangeProjects) return [];

    return inRangeProjects
      .map((project) => ({
        ...project,
        coordinates: getCoordinates(project),
        color: data.projectColorById?.get(project.id) || '#4E79A7',
        counts: getProjectCounts(data, project.id, dateRange),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }, [data, inRangeProjects, dateRange]);

  // A range change that drops the selected project clears the selection.
  useEffect(() => {
    if (selectedId != null && !projects.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [projects, selectedId]);

  const visibleProjects = useMemo(
    () => withMapPositions(projects.filter((project) => project.coordinates)),
    [projects]
  );

  // First MAX_LISTED projects; if the selected one isn't among them
  // (e.g. clicked on the map), it takes the last slot.
  const summaryProjects = useMemo(() => {
    const top = projects.slice(0, MAX_LISTED);
    if (selectedId == null || top.some((p) => p.id === selectedId)) return top;
    const selected = projects.find((p) => p.id === selectedId);
    return selected ? [...top.slice(0, MAX_LISTED - 1), selected] : top;
  }, [projects, selectedId]);

  // 1) Create the map once.
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: FALLBACK_VIEW.center,
      zoom: FALLBACK_VIEW.zoom,
      zoomSnap: 0.5,
    });

    const baseLayers = {};
    Object.entries(TILE_LAYERS).forEach(([name, { url, options }]) => {
      baseLayers[name] = L.tileLayer(url, options);
    });
    baseLayers.Streets.addTo(map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    // Don't hijack page scrolling: wheel zoom only after the map is clicked.
    map.scrollWheelZoom.disable();
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    // Clicking empty map clears the selection.
    map.on('click', () => setSelectedId(null));

    // Keep tiles correct when the dashboard layout resizes.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersRef.current = new Map();
    };
  }, []);

  // 2) Draw the markers and frame them when the projects change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const group = L.layerGroup().addTo(map);
    const entries = new Map();

    visibleProjects.forEach((project) => {
      const [lon, lat] = project.position;

      const marker = L.marker([lat, lon], {
        icon: buildIcon(project),
        title: `${project.id} — ${project.city || project.location || 'Panama'}`,
        keyboard: true,
        riseOnHover: true,
      });

      const label = document.createElement('span');
      label.textContent = String(project.id);
      marker.bindTooltip(label, {
        permanent: true,
        direction: 'right',
        offset: [12, 0],
        opacity: 1,
        className: 'project-label',
      });

      marker.on('click', () => setSelectedId(project.id));
      marker.addTo(group);
      entries.set(project.id, { marker, project });
    });

    layerRef.current = group;
    markersRef.current = entries;

    if (visibleProjects.length > 0) {
      const bounds = L.latLngBounds(
        visibleProjects.map((p) => [p.position[1], p.position[0]])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: FIT_MAX_ZOOM });
    } else {
      map.setView(FALLBACK_VIEW.center, FALLBACK_VIEW.zoom);
    }

    return () => {
      group.remove();
    };
  }, [visibleProjects]);

  // 3) Highlight the selected marker and fly to it when the selection changes.
  useEffect(() => {
    markersRef.current.forEach(({ marker }, id) => {
      const selected = id === selectedId;
      marker
        .getElement()
        ?.querySelector('.project-pin')
        ?.classList.toggle('project-pin-selected', selected);
      marker.setZIndexOffset(selected ? 1000 : 0);
    });

    const map = mapRef.current;
    if (map && selectedId != null && selectedId !== prevSelectedRef.current) {
      const entry = markersRef.current.get(selectedId);
      if (entry) {
        map.flyTo(
          entry.marker.getLatLng(),
          Math.max(map.getZoom(), SELECT_ZOOM),
          { duration: 0.6 }
        );
      }
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId, visibleProjects]);

  return (
    <section className="panel panel-sites">
      <h2>Project sites</h2>

      <div className="sites-content">
        <div className="sites-map">
          <div
            ref={containerRef}
            className="sites-map-canvas"
            aria-label="Map showing construction project locations"
          />

          {projects.length > visibleProjects.length && (
            <p className="map-message">
              {projects.length - visibleProjects.length} project(s) need
              location coordinates.
            </p>
          )}
        </div>

        <aside className="sites-list">
          <h3>LOCATIONS</h3>

          {summaryProjects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={`site-item ${
                selectedId === project.id ? 'site-item-selected' : ''
              }`}
              onClick={() => setSelectedId(project.id)}
            >
              <span
                className="site-pin"
                style={{ backgroundColor: project.color }}
              />

              <span className="site-info">
                <strong>
                  {project.id}
                  {project.name ? ` · ${project.name}` : ''}
                </strong>
                <span>{project.location || project.city || 'Panama'}</span>
              </span>

              <span className="site-counts">
                <span>PEOPLE <b>{project.counts.people}</b></span>
                <span>TOOLS <b>{project.counts.tools}</b></span>
                <span>MATERIAL <b>{project.counts.materials}</b></span>
              </span>
            </button>
          ))}

          {summaryProjects.length === 0 && (
            <p className="map-message">No projects in the selected date range.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

export default ProjectSites;