# Construction Project Management Dashboard

## Overview
A React-based dashboard for visualizing construction project timelines, locations, and resources.

## Features
- Project timeline visualization (Gantt chart)
- Map visualization for construction sites and resources
- Resource management and availability
- Scheduling and conflict detection

## Setup Instructions

### Step 1: Check Node.js and npm
Open your terminal and run:

```bash
node -v
npm -v
```

If either command is not recognized, install the LTS version of [Node.js](https://nodejs.org/).

### Step 2: Navigate to the React App
If the React app is inside the `construction_project_management` folder:

```bash
cd construction_project_management
```

Run this command only if you are not already inside that folder.

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Start the Application
```bash
npm start
```

### Step 5: Open in Your Browser
Visit http://localhost:3000 to view the application.

## Backend Setup (Express + PostgreSQL)

The backend lives in the `server` folder. It loads the CSV files in `data/` into a PostgreSQL database and serves them through a REST API on http://localhost:5000.

### Step 1: Install PostgreSQL
Install [PostgreSQL](https://www.postgresql.org/download/) and remember the password you set for the `postgres` user.

### Step 2: Configure the Connection
From the project root, copy the example environment file:

```bash
cd server
cp .env.example .env
```

Open `server/.env` and set `PGPASSWORD` to your PostgreSQL password. Don't commit `.env`; it's already gitignored.

### Step 3: Install Dependencies
```bash
npm install
```

### Step 4: Create and Load the Database
```bash
npm run db:setup
```

This creates the `construction_pm` database if it doesn't exist, creates the tables from `db/schema.sql`, and loads the CSVs from `data/`. Running it again resets the tables to the CSV data, which erases any changes made through the API.

### Step 5: Start the Server
```bash
npm run dev
```

`npm run dev` restarts the server when files change; `npm start` runs it without restarting. Visit http://localhost:5000/api/health to check that the server can reach the database. Run the React app (`npm start` in `construction_project_management`) at the same time in a second terminal.

### Database Tables
| Table | Description |
| --- | --- |
| `projects` | One row per project |
| `project_phases` | Each phase belongs to one project; a project has one or more phases |
| `workers`, `tools`, `materials` | The resources that can be assigned to phases |
| `phase_resources` | Links phases to resources (many-to-many). Each row has a `phase_id` and exactly one of `worker_id`, `tool_id`, or `material_id` |

### API Endpoints
All responses are JSON. Dates are `YYYY-MM-DD` strings.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/projects` | All projects |
| GET | `/api/projects/:id` | One project |
| GET | `/api/projects/:id/phases` | A project's phases |
| POST | `/api/projects` | Create a project with its phases: `{ name, description, year, startDate, endDate, location, city, phases: [{ startDate, endDate }] }`. IDs are generated if not given |
| PATCH | `/api/projects/:id` | Update project fields |
| DELETE | `/api/projects/:id` | Delete a project, its phases, and their assignments |
| GET | `/api/phases?start=&end=` | All phases, or only those overlapping the optional date range |
| GET | `/api/phases/:id` | One phase |
| POST | `/api/phases` | Add a phase to a project: `{ projectId, startDate, endDate }` |
| PATCH | `/api/phases/:id` | Update phase fields |
| DELETE | `/api/phases/:id` | Delete a phase (not allowed for a project's only phase) |
| GET | `/api/phases/:id/resources` | `{ workers, tools, materials }` assigned to the phase |
| POST | `/api/phases/:id/resources` | Assign a resource: `{ resourceType: "worker" \| "tool" \| "material", resourceId }` |
| DELETE | `/api/phases/:id/resources/:resourceType/:resourceId` | Remove a resource from a phase |
| GET | `/api/phase-resources` | Every assignment as `{ id, phaseId, projectId, resourceId, resourceType }` |
| GET, POST | `/api/workers`, `/api/tools`, `/api/materials` | List or create (`id` is required) |
| GET, PATCH, DELETE | `/api/workers/:id` (and `/tools/:id`, `/materials/:id`) | Read, update, or delete one |
| GET | `/api/workers/:id/phases` (and `/tools/:id/phases`, `/materials/:id/phases`) | Phases the resource is assigned to |
