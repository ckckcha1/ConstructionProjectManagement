
import { useState, useRef, useEffect, useCallback } from 'react'
import './AddProject.css'

const PHASE_COLORS = ['#F59E0B', '#2563EB', '#16A34A', '#7C3AED', '#EC4899']

const START_PHASES = [
  { id: 1, name: 'Phase 1', start: '', end: '' },
]

const STEP_LABELS = ['1 Details', '2 Resources', '3 Review']
const TABS = ['People', 'Tools', 'Materials']

const RESOURCE_TYPES = {
  People: 'worker',
  Tools: 'tool',
  Materials: 'material',
}

const RESOURCE_ENDPOINTS = {
  worker: 'workers',
  tool: 'tools',
  material: 'materials',
}

const resourceKey = (resource) =>
  `${resource.resourceType}:${resource.id}`

export default function AddProject({ initialStep = 0, onSaved, onPreviewChange }) {
  const [step, setStep] = useState(initialStep)
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [description, setDescription] = useState('')
  const [projectStart, setProjectStart] = useState('')
  const [projectEnd, setProjectEnd] = useState('')  
  const [phases, setPhases] = useState(START_PHASES)
  const [nextId, setNextId] = useState(2)
  const [assigned, setAssigned] = useState({})
  const [resources, setResources] = useState([])
  const [workerSchedules, setWorkerSchedules] = useState({})
  const [schedulesLoaded, setSchedulesLoaded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [tab, setTab] = useState('People')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const bodyRef = useRef(null)

  // Scroll to the top whenever the step changes.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])


  // Load workers, tools, and materials from the backend.
  useEffect(() => {
    let cancelled = false

    async function loadResources() {
      try {
        const types = [
          { key: 'worker', endpoint: 'workers' },
          { key: 'tool', endpoint: 'tools' },
          { key: 'material', endpoint: 'materials' },
        ]

        const results = await Promise.all(
          types.map(async (type) => {
            const response = await fetch(
              `http://localhost:5000/api/${type.endpoint}`
            )

            if (!response.ok) {
              throw new Error(`Failed to load ${type.endpoint}.`)
            }

            const data = await response.json()

            if (!Array.isArray(data)) {
              throw new Error(`Unexpected response when loading ${type.endpoint}.`)
            }

            return data.map((resource) => ({
              ...resource,
              resourceType: type.key,
            }))
          })
        )

        if (!cancelled) {
          setResources(results.flat())
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load resources.')
        }
      }
    }

    loadResources()

    return () => {
      cancelled = true
    }
  }, [])

  // Load existing schedules for every resource.
  useEffect(() => {
    let cancelled = false

    async function loadResourceSchedules() {
      try {
        setSchedulesLoaded(false)

        const results = await Promise.all(
          resources.map(async (resource) => {
            const endpoint = RESOURCE_ENDPOINTS[resource.resourceType]

            const response = await fetch(
              `http://localhost:5000/api/${endpoint}/${encodeURIComponent(resource.id)}/phases`
            )

            if (!response.ok) {
              throw new Error(
                `Failed to load schedule for ${resource.name}.`
              )
            }

            const existingPhases = await response.json()

            return [resourceKey(resource), existingPhases]
          })
        )

        if (!cancelled) {
          setWorkerSchedules(Object.fromEntries(results))
          setSchedulesLoaded(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not load resource schedules.')
          setSchedulesLoaded(false)
        }
      }
    }

    if (resources.length === 0) {
      setWorkerSchedules({})
      setSchedulesLoaded(false)
      return
    }

    loadResourceSchedules()

    return () => {
      cancelled = true
    }
  }, [resources])

  const colorOf = (phaseId) => {
    const i = phases.findIndex((p) => p.id === phaseId)
    return PHASE_COLORS[Math.max(i, 0) % PHASE_COLORS.length]
  }

  const goTo = (n) => {
    setError('')
    setStep(n)
  }

  const resetData = () => {
  setName('')
  setPlace('')
  setDescription('')
  setProjectStart('')
  setProjectEnd('')
  setPhases(START_PHASES)
  setNextId(2)
  setAssigned({})
  setSearchTerm('')
  setTab('People')
  setError('')
}

  // ---------- Phase actions ----------

  const updatePhase = (id, field, value) => {
    setPhases((current) =>
      current.map((p) =>
        p.id === id ? { ...p, [field]: value } : p
      )
    )
  }

  const addPhase = () => {
    setPhases((current) => [
      ...current,
      {
        id: nextId,
        name: 'Phase ' + (current.length + 1),
        start: '',
        end: '',
      },
    ])

    setNextId((current) => current + 1)
    setError('')
  }

  const deletePhase = (id) => {
    setPhases((current) => current.filter((p) => p.id !== id))

    setAssigned((current) => {
      const cleaned = {}

      Object.keys(current).forEach((key) => {
        cleaned[key] = current[key].filter((phaseId) => phaseId !== id)
      })

      return cleaned
    })
  }

  // ---------- Resource assignment ----------

  const toggleChip = (resource, phaseId) => {
    const key = resourceKey(resource)

    setAssigned((current) => {
      const selected = current[key] || []

      const updated = selected.includes(phaseId)
        ? selected.filter((id) => id !== phaseId)
        : [...selected, phaseId]

      return {
        ...current,
        [key]: updated,
      }
    })

    setError('')
  }

  // ---------- Date and conflict helpers ----------

  const parsePhaseDate = useCallback((value) => {
  if (!value) return null

  const parsed = new Date(`${value}T00:00:00Z`)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}, [])

    // Send the current what-if draft to the dashboard.
  const hasResourceConflict = useCallback((resource) => {
  const key = resourceKey(resource)
  const selectedPhaseIds = assigned[key] || []
  const existingPhases = workerSchedules[key] || []

  return selectedPhaseIds.some((phaseId) => {
    const selectedPhase = phases.find((p) => p.id === phaseId)

    if (!selectedPhase || !selectedPhase.start || !selectedPhase.end) {
      return false
    }

    const selectedStart = parsePhaseDate(selectedPhase.start)
    const selectedEnd = parsePhaseDate(selectedPhase.end)

    if (!selectedStart || !selectedEnd) return false

    return existingPhases.some((existing) => {
      const existingStart = new Date(existing.startDate)
      const existingEnd = new Date(existing.endDate)

      if (
        Number.isNaN(existingStart.getTime()) ||
        Number.isNaN(existingEnd.getTime())
      ) {
        return false
      }

      return (
        selectedStart <= existingEnd &&
        selectedEnd >= existingStart
      )
    })
  })
}, [assigned, workerSchedules, phases, parsePhaseDate])

    useEffect(() => {
  if (step === 0 || saved || !onPreviewChange) {
    onPreviewChange?.(null)
    return
  }

  const previewAssignments = resources.flatMap((resource) => {
    const selectedPhaseIds = assigned[resourceKey(resource)] || []

    return selectedPhaseIds.flatMap((phaseId) => {
      const phase = phases.find((p) => p.id === phaseId)

      if (!phase) return []

      const start = parsePhaseDate(phase.start)
      const end = parsePhaseDate(phase.end)

      if (!start || !end || start > end) return []

      return [{
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
        phaseId: phase.id,
        phaseName: phase.name,
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
        isConflict: hasResourceConflict(resource),
        // False until existing schedules load; the Gantt shows the bar as "checking" until then
        conflictChecked: schedulesLoaded,
      }]
    })
  })

  onPreviewChange({
    name,
    place,
    projectStart: projectStart || null,
    projectEnd: projectEnd || null,
    phases: phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      start: phase.start && parsePhaseDate(phase.start)
        ? parsePhaseDate(phase.start).toISOString().split('T')[0]
        : null,
      end: phase.end && parsePhaseDate(phase.end)
        ? parsePhaseDate(phase.end).toISOString().split('T')[0]
        : null,
    })),
    assignments: previewAssignments,
  })
}, [
  step,
  saved,
  name,
  place,
  projectStart,
  projectEnd,
  phases,
  assigned,
  resources,
  workerSchedules,
  schedulesLoaded,
  parsePhaseDate,
  hasResourceConflict,
  onPreviewChange,
])

  // ---------- Derived values ----------

  const assignedRows = resources.filter(
    (resource) => (assigned[resourceKey(resource)] || []).length > 0
  )

  const conflictRows = assignedRows.filter(hasResourceConflict)

  const availableRows = assignedRows.filter(
    (resource) => !hasResourceConflict(resource)
  )

  const currentResourceType = RESOURCE_TYPES[tab]

  const filteredResources = resources.filter((resource) => {
    const matchesType = resource.resourceType === currentResourceType

    const search = searchTerm.trim().toLowerCase()

    const matchesSearch =
      !search ||
      String(resource.name || '').toLowerCase().includes(search) ||
      String(resource.role || '').toLowerCase().includes(search) ||
      String(resource.type || '').toLowerCase().includes(search)

    return matchesType && matchesSearch
  })

  // ---------- Navigation ----------

  const nextFromDetails = () => {
    if (!name.trim()) return setError('Enter a project name.')

    if (phases.length === 0) {
      return setError('Add at least one phase.')
    }

    goTo(2)
  }

  const nextFromResources = () => {
    if (assignedRows.length === 0) {
      return setError('Assign at least one resource to a phase.')
    }

    if (!schedulesLoaded) {
      return setError(
        'Please wait until existing resource schedules have loaded.'
      )
    }

    goTo(3)
  }

  // ---------- Save project and assignments ----------


  const handleSave = async () => {
    if (saving) return

    setError('')
    setSaved(false)
    setSaving(true)

    try {
      const toISODate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
          throw new Error(`Invalid or missing date: ${value || 'empty'}`)
        }

        const parsed = new Date(`${value}T00:00:00Z`)

        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== value
        ) {
          throw new Error(`Invalid date: ${value}`)
        }

        return value
      }

      const startDate = toISODate(projectStart)
      const endDate = toISODate(projectEnd)
      const projectYear = new Date(`${startDate}T00:00:00Z`).getUTCFullYear()

      if (endDate < startDate) {
        throw new Error('Project end date cannot be before the start date.')
      }

      for (const phase of phases) {
        const phaseStart = toISODate(phase.start)
        const phaseEnd = toISODate(phase.end)

        if (phaseEnd < phaseStart) {
          throw new Error(`${phase.name}: End date cannot be before start date.`)
        }

        if (phaseStart < startDate || phaseEnd > endDate) {
          throw new Error(
            `${phase.name}: Phase dates must be within the project dates.`
          )
        }
      }

      const projectData = {
        name,
        description,
        year: projectYear,
        startDate,
        endDate,
        location: place,
        city: place,
        phases: phases.map((phase, index) => ({
          name: phase.name,
          startDate: toISODate(phase.start),
          endDate: toISODate(phase.end),
          phaseNumber: index + 1,
        })),
      }

      // 1. Create the project and its phases.
      const response = await fetch('http://localhost:5000/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to save project.')
      }

      const createdProject = await response.json()
      const createdPhases = createdProject.phases

      if (
        !Array.isArray(createdPhases) ||
        createdPhases.length !== phases.length ||
        createdPhases.some((phase) => !phase.id)
      ) {
        throw new Error(
          'Project was created, but the server did not return all phase IDs. Check the saved project before retrying.'
        )
      }

      // 2. Save every selected worker, tool, and material.
      for (const resource of resources) {
        const selectedPhaseIds = assigned[resourceKey(resource)] || []

        for (const localPhaseId of selectedPhaseIds) {
          const phaseIndex = phases.findIndex(
            (phase) => phase.id === localPhaseId
          )

          if (phaseIndex === -1) continue

          const phaseId = createdPhases[phaseIndex].id

          const assignmentResponse = await fetch(
            `http://localhost:5000/api/phases/${encodeURIComponent(phaseId)}/resources`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                resourceType: resource.resourceType,
                resourceId: resource.id,
              }),
            }
          )

          if (!assignmentResponse.ok) {
            const message = await assignmentResponse.text()

            throw new Error(
              `Project was created, but assigning ${resource.name} failed: ${message || assignmentResponse.statusText}. Check the saved project before retrying.`
            )
          }
        }
      }

      // 3. Refresh dashboard data.
      if (onSaved) {
        await onSaved(createdProject.id)
      }

      setSaved(true)
      setStep(0)
    } catch (err) {
      setError(
        err.message || 'Failed to save project or resource assignments.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    resetData()
    setSaved(false)
    setStep(0)
  }

  // ---------- Screens ----------

  const renderStart = () => (
    <div className="ap-start">
      <div className="ap-start-icon">+</div>

      <h3 className="ap-start-title">Test a new project</h3>

      <p className="ap-start-text">
        Try a project before saving it. See how it fits your timeline and resources.
      </p>

      <button
        type="button"
        className="ap-btn primary full"
        onClick={() => {
          resetData()
          setSaved(false)
          goTo(1)
      }}
      >
        + New project
      </button>

      {saved && (
        <div className="ap-notice ok">
          Project saved successfully! The dashboard has been refreshed.
        </div>
      )}

      <ul className="ap-start-list">
        <li><span className="ap-num">1</span>Name, dates, and phases</li>
        <li><span className="ap-num">2</span>Assign people, tools, and materials</li>
        <li><span className="ap-num">3</span>Review conflicts, then save or discard</li>
      </ul>
    </div>
  )

  const renderDetails = () => (
    <>
      <h3 className="ap-section">Project details</h3>

      <div className="ap-label">Project name</div>
      <input
        className="ap-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="ap-label">Location</div>
      <input
        className="ap-input"
        value={place}
        onChange={(e) => setPlace(e.target.value)}
      />

      <div className="ap-label">Description</div>
      <textarea
        className="ap-input area"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="ap-row2">
  <div>
    <div className="ap-label">Project start</div>
    <input
      type="date"
      className="ap-input"
      value={projectStart}
      onChange={(e) => setProjectStart(e.target.value)}
    />
  </div>

  <div>
    <div className="ap-label">Project end</div>
    <input
      type="date"
      className="ap-input"
      value={projectEnd}
      min={projectStart || undefined}
      onChange={(e) => setProjectEnd(e.target.value)}
    />
  </div>
</div>

      <h3 className="ap-section spaced">Phases</h3>

      {phases.map((p) => (
        <div className="ap-phase-card" key={p.id}>
          <div className="ap-phase-top">
            <span
              className="ap-dot"
              style={{ background: colorOf(p.id) }}
            />

            <input
              className="ap-input"
              value={p.name}
              onChange={(e) => updatePhase(p.id, 'name', e.target.value)}
            />

            <button
              type="button"
              className="ap-x"
              aria-label="Delete phase"
              onClick={() => deletePhase(p.id)}
            >
              ×
            </button>
          </div>

          <div className="ap-phase-dates">
  <input
    type="date"
    className="ap-input"
    value={p.start}
    min={projectStart || undefined}
    max={projectEnd || undefined}
    onChange={(e) => updatePhase(p.id, 'start', e.target.value)}
  />

  <span className="ap-arrow">→</span>

  <input
    type="date"
    className="ap-input"
    value={p.end}
    min={p.start || projectStart || undefined}
    max={projectEnd || undefined}
    onChange={(e) => updatePhase(p.id, 'end', e.target.value)}
  />
</div>
</div>
))}

      <button type="button" className="ap-add-phase" onClick={addPhase}>
        + Add phase
      </button>

      {error && <div className="ap-error">{error}</div>}
    </>
  )

  // ---------- Resource rows ----------

  const renderResourceRow = (resource) => {
    const key = resourceKey(resource)
    const mine = assigned[key] || []
    const hasConflict = hasResourceConflict(resource)

    return (
      <div className="ap-res" key={key}>
        <div className="ap-res-top">
          <span
            className={`ap-status ${
              !schedulesLoaded ? '' : hasConflict ? 'red' : 'green'
            }`}
          />

          <span className="ap-res-name">{resource.name}</span>

          <span className="ap-res-role">
            {resource.role || resource.type || resource.resourceType}
          </span>
        </div>

        <div className="ap-res-note">
          {!schedulesLoaded
            ? 'Checking existing schedule...'
            : hasConflict
              ? 'This resource has an overlapping assignment.'
              : 'No overlapping assignment found.'}
        </div>

        <div className="ap-chips">
          {phases.map((p) => {
            const on = mine.includes(p.id)

            // Selected chips use the purple of the what-if phase bars (AddProject.css)
            return (
              <button
                type="button"
                key={p.id}
                className={`ap-chip${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleChip(resource, p.id)}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const renderResources = () => {
    const selectedCount = assignedRows.length

    return (
      <>
        <h3 className="ap-section">Assign resources</h3>

        {error && <div className="ap-error">{error}</div>}

        {resources.length === 0 ? (
          <div className="ap-notice">
            Loading resources, or no resources were returned. Check the backend connection.
          </div>
        ) : (
          <div className="ap-notice">
            Loaded {resources.length} resources from the database.
            {schedulesLoaded
              ? ' Existing schedules have been checked.'
              : ' Checking existing schedules...'}
          </div>
        )}

        <div className="ap-notice">
          {selectedCount} resource{selectedCount === 1 ? '' : 's'} assigned.
        </div>

        <input
          className="ap-input"
          placeholder="Search resources..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <div className="ap-tabs">
          {TABS.map((t) => (
            <button
              type="button"
              key={t}
              className={'ap-tab' + (tab === t ? ' active' : '')}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ap-group-title">
          {tab} ({filteredResources.length})
        </div>

        <div className="ap-resource-list">
  {filteredResources.length > 0 ? (
    filteredResources.map(renderResourceRow)
  ) : (
    <div className="ap-notice">
      No {tab.toLowerCase()} found.
    </div>
  )}
</div>
      </>
    )
  }

  // ---------- Review ----------

  const renderReviewRow = (resource) => {
    const key = resourceKey(resource)
    const mine = assigned[key] || []
    const hasConflict = hasResourceConflict(resource)

    return (
      <div className="ap-res review" key={key}>
        <div className="ap-res-top">
          <span className={`ap-status ${hasConflict ? 'red' : 'green'}`} />

          <span className="ap-res-name">{resource.name}</span>

          <span className="ap-pills">
            {mine.map((pid) => {
              const p = phases.find((x) => x.id === pid)

              if (!p) return null

              return (
                <span
                  key={pid}
                  className="ap-pill"
                  style={{ background: colorOf(pid) }}
                >
                  {p.name}
                </span>
              )
            })}
          </span>

          <span className="ap-badge">
            {hasConflict ? 'Schedule conflict' : 'No conflict detected'}
          </span>
        </div>
      </div>
    )
  }

  const renderReview = () => (
    <>
      <h3 className="ap-section">Review and confirm</h3>

      <div className="ap-summary-name">
        {name || 'Untitled project'}
      </div>

      <div className="ap-summary-sub">
        {place} - {projectStart} to {projectEnd}
      </div>

      <div className="ap-phase-list">
        {phases.map((p) => (
          <div className="ap-phase-line" key={p.id}>
            <span
              className="ap-dot"
              style={{ background: colorOf(p.id) }}
            />

            <span className="ap-phase-name">{p.name}</span>

            <span className="ap-phase-range">
              {p.start} - {p.end}
            </span>
          </div>
        ))}
      </div>

      {!schedulesLoaded && (
        <div className="ap-notice">
          Resource schedules have not finished loading. Please go back and wait before reviewing.
        </div>
      )}

      {schedulesLoaded && availableRows.length > 0 && (
        <>
          <div className="ap-group-title">Available</div>
          {availableRows.map(renderReviewRow)}
        </>
      )}

      {schedulesLoaded && conflictRows.length > 0 && (
        <>
          <div className="ap-group-title">Not available</div>
          {conflictRows.map(renderReviewRow)}

          <div className="ap-conflict-box">
            <strong>
              {conflictRows.length} conflict{conflictRows.length > 1 ? 's' : ''}
            </strong>

            <div>
              You can still save it. It will appear in the Resource Gantt to resolve.
            </div>
          </div>
        </>
      )}

      {schedulesLoaded && conflictRows.length === 0 && (
        <div className="ap-notice">
          No overlapping assignments were found for the selected resources.
        </div>
      )}
    </>
  )

  // ---------- Footer ----------

  const renderFooter = () => {
    if (step === 0) return null

    const back = () => goTo(step - 1)

    if (step === 1) {
      return (
        <div className="ap-btn-row">
          <button
            type="button"
            className="ap-btn ghost"
            onClick={back}
          >
            Back
          </button>

          <button
            type="button"
            className="ap-btn primary grow"
            onClick={nextFromDetails}
          >
            Next: resources
          </button>
        </div>
      )
    }

    if (step === 2) {
      return (
        <div className="ap-btn-row">
          <button
            type="button"
            className="ap-btn ghost"
            onClick={back}
          >
            Back
          </button>

          <button
            type="button"
            className="ap-btn primary grow"
            onClick={nextFromResources}
            disabled={!schedulesLoaded}
          >
            Next: review
          </button>
        </div>
      )
    }

    const hasConflict = conflictRows.length > 0

    return (
      <>
        <button
          type="button"
          className="ap-link"
          onClick={handleDiscard}
          disabled={saving}
        >
          Discard what-if
        </button>

        <div className="ap-btn-row">
          <button
            type="button"
            className="ap-btn ghost"
            onClick={back}
            disabled={saving}
          >
            Back
          </button>

          <button
            type="button"
            className={'ap-btn grow ' + (hasConflict ? 'amber' : 'green')}
            onClick={handleSave}
            disabled={saving || !schedulesLoaded}
          >
            {saving
              ? 'Saving...'
              : hasConflict
                ? 'Save anyway'
                : 'Save project'}
          </button>
        </div>
      </>
    )
  }

  // ---------- Main render ----------

  return (
    <div className="ap-card">
      <div className="ap-card-header">
        <h2 className="ap-title">Add project / What-if</h2>

        {step > 0 && (
          <div className="ap-steps">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1
              const state = n < step ? 'done' : n === step ? 'current' : ''

              return (
                <div className={'ap-step ' + state} key={label}>
                  <div className="ap-bar" />
                  <div className="ap-step-label">{label}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="ap-card-body" ref={bodyRef}>
        {step === 0 && renderStart()}
        {step === 1 && renderDetails()}
        {step === 2 && renderResources()}
        {step === 3 && renderReview()}
      </div>

      {step > 0 && (
        <div className="ap-card-footer">
          {renderFooter()}
        </div>
      )}
    </div>
  )
}
