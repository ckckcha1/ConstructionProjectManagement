import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './ProjectSites.css';
import { overlaps } from '../data';

const MAX_LISTED = 10;            // projects shown in the right-hand list
const FIT_MAX_ZOOM = 17;         // max zoom when framing all projects
const SELECT_ZOOM = 16;          // zoom when a project (or the warehouse) is selected
const FALLBACK_VIEW = { center: [8.55, -80.1], zoom: 7 }; // all of Panama, [lat, lon]

// Projects sharing the same coordinates are spread on a tiny ring (~75 m)
// so each one stays visible and clickable. Set to 0 to disable.
const SPREAD_DEG = 0.0007;

// Main warehouse, [lon, lat]. Update with the exact point: every drive time depends on it.
const WAREHOUSE = {
  name: 'Warehouse',
  address: 'Urbanización Los Angeles',
  coordinates: [-79.52400, 9.00300],
};

// Warehouse star (map marker and locations list)
const WAREHOUSE_COLOR = '#FFC400';
const WAREHOUSE_OUTLINE = '#182033';
const STAR_POINTS =
  '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';

// Drive-time estimate (used instantly, and if the routing service is unreachable)
const ROAD_FACTOR = 1.35;        // straight line -> road distance
const AVG_SPEED_KMH = 25;        // average city speed
// Routing service (OSRM public demo server) returns drive time WITHOUT traffic.
// Raise this (e.g. 1.5) to approximate rush hour.
const TRAFFIC_FACTOR = 3;
const OSRM_URL = 'https://router.project-osrm.org';

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
// The first match wins, so specific places go before general ones.
const LOCATION_COORDINATES = [
  { match: 'warehouse', coordinates: WAREHOUSE.coordinates },
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
  { match: 'ave balboa', coordinates: [-79.52900, 8.97100] },
  { match: 'paitilla', coordinates: [-79.51590, 8.98060] },
  { match: 'santa maria', coordinates: [-79.45000, 9.01500] },
  { match: 'casco viejo', coordinates: [-79.53520, 8.95350] },
  { match: 'obarrio', coordinates: [-79.52330, 8.98870] },
  { match: 'marbella', coordinates: [-79.52600, 8.98250] },
  { match: 'bella vista', coordinates: [-79.52700, 8.97800] },
  { match: 'punta pacifica', coordinates: [-79.50980, 8.97280] },
  { match: 'costa del este', coordinates: [-79.46500, 9.00420] },
  { match: 'panama viejo', coordinates: [-79.49810, 8.99470] },
  { match: 'albrook', coordinates: [-79.55270, 8.97350] },
  { match: 'curundu', coordinates: [-79.54610, 8.97090] },

  { match: 'panama city', coordinates: [-79.52000, 8.98000] }, // fallback
];

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// Straight-line distance in km between two [lon, lat] points.
function haversineKm([lon1, lat1], [lon2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Instant estimate: straight line x road factor at an average city speed.
function estimateDriveMinutes(coordinates) {
  const km = haversineKm(WAREHOUSE.coordinates, coordinates) * ROAD_FACTOR;
  return (km / AVG_SPEED_KMH) * 60;
}

function formatDriveTime(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'At the warehouse';
  return `~${Math.round(minutes)} min from warehouse`;
}

// One request for all projects: drive time (minutes) from the warehouse to each.
async function fetchDriveMinutes(projects, signal) {
  const coords = [WAREHOUSE.coordinates, ...projects.map((p) => p.coordinates)]
    .map(([lon, lat]) => `${lon},${lat}`)
    .join(';');
  const response = await fetch(
    `${OSRM_URL}/table/v1/driving/${coords}?sources=0&annotations=duration`,
    { signal }
  );
  if (!response.ok) throw new Error(`Routing failed: ${response.status}`);
  const json = await response.json();
  if (json.code !== 'Ok') throw new Error('Routing failed');

  const row = json.durations?.[0] || [];
  const minutes = new Map();
  projects.forEach((project, i) => {
    const seconds = row[i + 1]; // index 0 is the warehouse itself
    if (Number.isFinite(seconds)) {
      minutes.set(project.id, (seconds / 60) * TRAFFIC_FACTOR);
    }
  });
  return minutes;
}

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

// Yellow star that marks the warehouse on the map.
function buildWarehouseIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'warehouse-pin');
  svg.setAttribute('aria-hidden', 'true');

  const star = document.createElementNS(NS, 'polygon');
  star.setAttribute('points', STAR_POINTS);
  star.setAttribute('fill', WAREHOUSE_COLOR);
  star.setAttribute('stroke', WAREHOUSE_OUTLINE);
  star.setAttribute('stroke-width', '1.5');
  star.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(star);

  return L.divIcon({
    className: 'warehouse-pin-wrapper',
    html: svg,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Same star for the locations list.
function WarehouseStar({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points={STAR_POINTS}
        fill={WAREHOUSE_COLOR}
        stroke={WAREHOUSE_OUTLINE}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Always-visible label next to a pin (just the project code).
function buildCompactLabel(project) {
  const label = document.createElement('span');
  label.textContent = String(project.id);
  return label;
}

// Hover label: code, name, location and drive time from the warehouse.
function buildDetailLabel(project, minutes) {
  const box = document.createElement('div');
  box.className = 'project-label-detail';

  const title = document.createElement('strong');
  title.textContent = `${project.id}${project.name ? ` · ${project.name}` : ''}`;

  const place = document.createElement('div');
  place.textContent = project.location || project.city || 'Panama';

  const drive = document.createElement('div');
  drive.className = 'detail-drive';
  drive.textContent = formatDriveTime(minutes);

  box.append(title, place, drive);
  return box;
}

function buildWarehouseCompactLabel() {
  const label = document.createElement('span');
  label.textContent = 'Warehouse';
  return label;
}

function buildWarehouseDetailLabel() {
  const box = document.createElement('div');
  box.className = 'project-label-detail';

  const title = document.createElement('strong');
  title.textContent = WAREHOUSE.name;

  const place = document.createElement('div');
  place.textContent = WAREHOUSE.address;

  box.append(title, place);
  return box;
}

// Permanent compact label that expands on hover. The builders are called each time,
// so the hover content (e.g. drive time) is always current.
function bindExpandableLabel(marker, buildCompact, buildDetail, offsetX) {
  marker.bindTooltip(buildCompact(), {
    permanent: true,
    direction: 'auto', // opens to the left near the right edge, so it never gets clipped
    offset: [offsetX, 0],
    opacity: 1,
    className: 'project-label',
  });

  marker.on('mouseover', () => {
    marker.setTooltipContent(buildDetail());
    marker.getTooltip()?.getElement()?.classList.add('project-label-expanded');
  });
  marker.on('mouseout', () => {
    marker.setTooltipContent(buildCompact());
    marker.getTooltip()?.getElement()?.classList.remove('project-label-expanded');
  });
}

function flyToWarehouse(map) {
  if (!map) return;
  const [lon, lat] = WAREHOUSE.coordinates;
  map.flyTo([lat, lon], Math.max(map.getZoom(), SELECT_ZOOM), { duration: 0.6 });
}

// inRangeProjects: projects in the date range that are checked in the filter panel
// (from App, the same projects the project Gantt chart shows).
// The selected project is shared with the Gantt charts and Project Details, so it lives in App:
// selectedId is the project they show, isDefaultSelection is true when nobody picked it
// (App's default project), and onSelectProject(id or null) changes it.
function ProjectSites({
  data,
  projects: inRangeProjects,
  dateRange,
  selectedProjectId: selectedId,
  isDefaultSelection,
  onSelectProject,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(new Map()); // project id -> { marker, project }
  const prevFlyTargetRef = useRef(null);
  const driveMinutesRef = useRef(new Map()); // project id -> minutes (from the routing service)

  // Leaflet handlers are attached once, so they call the latest callback through a ref
  const onSelectRef = useRef(onSelectProject);
  useEffect(() => {
    onSelectRef.current = onSelectProject;
  }, [onSelectProject]);

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

  // Fetch real drive times once per project (cached). The estimate covers the gap
  // and stays in place if the routing service is unreachable.
  useEffect(() => {
    const missing = projects.filter(
      (p) => p.coordinates && !driveMinutesRef.current.has(p.id)
    );
    if (missing.length === 0) return undefined;

    const controller = new AbortController();
    fetchDriveMinutes(missing, controller.signal)
      .then((minutes) => {
        driveMinutesRef.current = new Map([
          ...driveMinutesRef.current,
          ...minutes,
        ]);
      })
      .catch(() => {}); // keep the estimates
    return () => controller.abort();
  }, [projects]);

  // 1) Create the map once (and the warehouse star, which doesn't depend on the projects).
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

    // Clicking empty map clears the selection (the dashboard falls back to its default project).
    map.on('click', () => onSelectRef.current?.(null));

    // Warehouse star. It sits above the project pins but below the selected one.
    const [wLon, wLat] = WAREHOUSE.coordinates;
    const warehouseMarker = L.marker([wLat, wLon], {
      icon: buildWarehouseIcon(),
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: 500,
    });
    bindExpandableLabel(
      warehouseMarker,
      buildWarehouseCompactLabel,
      buildWarehouseDetailLabel,
      16
    );
    warehouseMarker.on('click', () => flyToWarehouse(map));
    warehouseMarker.addTo(map);
    warehouseMarker
      .getElement()
      ?.setAttribute('aria-label', `${WAREHOUSE.name}, ${WAREHOUSE.address}`);

    // Keep tiles correct when the dashboard layout resizes.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      observer.disconnect();
      map.remove(); // also removes the warehouse marker
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

      // No `title` option: the browser would show its own native tooltip
      // on top of the expanded label. The accessible name is set below instead.
      const marker = L.marker([lat, lon], {
        icon: buildIcon(project),
        keyboard: true,
        riseOnHover: true,
      });

      // Label with just the code; on hover it expands to code, name, location
      // and minutes from the warehouse.
      bindExpandableLabel(
        marker,
        () => buildCompactLabel(project),
        () =>
          buildDetailLabel(
            project,
            driveMinutesRef.current.get(project.id) ??
              estimateDriveMinutes(project.coordinates)
          ),
        12
      );

      marker.on('click', () => onSelectRef.current?.(project.id));
      marker.addTo(group);
      marker
        .getElement()
        ?.setAttribute(
          'aria-label',
          `${project.id}${project.name ? ` ${project.name}` : ''}, ${
            project.location || project.city || 'Panama'
          }`
        );
      entries.set(project.id, { marker, project });
    });

    layerRef.current = group;
    markersRef.current = entries;

    if (visibleProjects.length > 0) {
      // Frame every project and the warehouse
      const [wLon, wLat] = WAREHOUSE.coordinates;
      const points = visibleProjects.map((p) => [p.position[1], p.position[0]]);
      points.push([wLat, wLon]);
      map.fitBounds(L.latLngBounds(points), {
        padding: [40, 40],
        maxZoom: FIT_MAX_ZOOM,
      });
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

    // Fly only to a project someone picked (here, in the Gantt, ...), not App's default
    // project, so on load the map keeps framing every project
    const flyTarget = isDefaultSelection ? null : selectedId;
    const map = mapRef.current;
    if (map && flyTarget != null && flyTarget !== prevFlyTargetRef.current) {
      const entry = markersRef.current.get(flyTarget);
      if (entry) {
        map.flyTo(
          entry.marker.getLatLng(),
          Math.max(map.getZoom(), SELECT_ZOOM),
          { duration: 0.6 }
        );
      }
    }
    prevFlyTargetRef.current = flyTarget;
  }, [selectedId, isDefaultSelection, visibleProjects]);

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

          {/* The warehouse is always listed first. It is not a project, so
              clicking it only moves the map, it doesn't change the selection. */}
          <button
            type="button"
            className="site-item site-item-warehouse"
            onClick={() => flyToWarehouse(mapRef.current)}
          >
            <WarehouseStar className="site-star" />

            <span className="site-info">
              <strong>{WAREHOUSE.name}</strong>
              <span>{WAREHOUSE.address}</span>
            </span>
          </button>

          {summaryProjects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={`site-item ${
                selectedId === project.id ? 'site-item-selected' : ''
              }`}
              onClick={() => onSelectProject(project.id)}
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