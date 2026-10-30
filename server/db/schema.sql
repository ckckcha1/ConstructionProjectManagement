-- Construction Project Management schema.
-- Running this file drops and recreates every table, so it erases existing data.

DROP TABLE IF EXISTS phase_resources;
DROP TABLE IF EXISTS project_phases;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS workers;
DROP TABLE IF EXISTS tools;
DROP TABLE IF EXISTS materials;

CREATE TABLE projects (
  project_id          TEXT PRIMARY KEY,
  project_name        TEXT NOT NULL,
  project_description TEXT,
  year                INTEGER,
  start_date          DATE,
  end_date            DATE,
  location            TEXT,
  city                TEXT,
  CHECK (end_date >= start_date)
);

-- Each project has one or many phases; each phase belongs to exactly one project.
CREATE TABLE project_phases (
  phase_id     TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL CHECK (phase_number > 0),
  start_date   DATE,
  end_date     DATE,
  UNIQUE (project_id, phase_number),
  CHECK (end_date >= start_date)
);

CREATE TABLE workers (
  worker_id TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  role      TEXT
);

CREATE TABLE tools (
  tool_id          TEXT PRIMARY KEY,
  tool_name        TEXT NOT NULL,
  tool_description TEXT,
  quantity         INTEGER CHECK (quantity >= 0),
  location         TEXT
);

CREATE TABLE materials (
  material_id          TEXT PRIMARY KEY,
  material_name        TEXT NOT NULL,
  material_description TEXT,
  unit                 TEXT,
  quantity             INTEGER CHECK (quantity >= 0),
  location             TEXT
);

-- Intermediate table for the many-to-many link between phases and resources.
-- Each row assigns exactly one worker, tool, or material to a phase.
-- The project is not stored here; it comes from the phase.
CREATE TABLE phase_resources (
  phase_resource_id SERIAL PRIMARY KEY,
  phase_id          TEXT NOT NULL REFERENCES project_phases (phase_id) ON DELETE CASCADE,
  worker_id         TEXT REFERENCES workers (worker_id) ON DELETE CASCADE,
  tool_id           TEXT REFERENCES tools (tool_id) ON DELETE CASCADE,
  material_id       TEXT REFERENCES materials (material_id) ON DELETE CASCADE,
  CHECK (num_nonnulls(worker_id, tool_id, material_id) = 1),
  UNIQUE (phase_id, worker_id),
  UNIQUE (phase_id, tool_id),
  UNIQUE (phase_id, material_id)
);

CREATE INDEX idx_project_phases_project ON project_phases (project_id);
CREATE INDEX idx_project_phases_dates   ON project_phases (start_date, end_date);
CREATE INDEX idx_phase_resources_worker   ON phase_resources (worker_id);
CREATE INDEX idx_phase_resources_tool     ON phase_resources (tool_id);
CREATE INDEX idx_phase_resources_material ON phase_resources (material_id);
