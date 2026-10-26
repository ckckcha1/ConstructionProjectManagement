import { useState, useRef, useEffect } from 'react'
import './AddProject.css'

// Add project / What-if card. Demo data is hardcoded for now.
const PHASE_COLORS = ['#F59E0B', '#2563EB', '#16A34A', '#7C3AED', '#EC4899']

const RESOURCES = [
  { id: 'w-020', name: 'Alexis J.', role: 'Skilled', busy: false, note: 'Free Nov 9 - Dec 11' },
  { id: 'w-004', name: 'Victor E.', role: 'Roofer', busy: false, note: 'Free Nov 9 - Dec 11' },
  { id: 'w-021', name: 'Miguel A.', role: 'Helper', busy: false, note: 'Free Nov 9 - Dec 11' },
  {
    id: 'w-027',
    name: 'Jose C.',
    role: 'Painter',
    busy: true,
    note: 'Busy until Dec 1 - P-001, P-008',
    reason: 'Overlaps P-001 and P-008 until Dec 1',
  },
]

const START_PHASES = [
  { id: 1, name: 'Phase 1', start: 'Nov 9', end: 'Nov 20' },
  { id: 2, name: 'Phase 2', start: 'Nov 20', end: 'Dec 11' },
]
const START_ASSIGNED = { 'w-020': [1], 'w-027': [1, 2] }
const STEP_LABELS = ['1 Details', '2 Resources', '3 Review']
const TABS = ['People', 'Tools', 'Materials']

export default function AddProject({ initialStep = 0 }) {
  const [step, setStep] = useState(initialStep) // 0 = start, 1-3 = steps
  const [name, setName] = useState('P-022 - Cielo')
  const [place, setPlace] = useState('San Francisco, Panamá')
  const [description, setDescription] = useState('Roof waterproofing')
  const [projectStart, setProjectStart] = useState('Nov 9, 2026')
  const [projectEnd, setProjectEnd] = useState('Dec 11, 2026')
  const [phases, setPhases] = useState(START_PHASES)
  const [nextId, setNextId] = useState(3)
  const [assigned, setAssigned] = useState(START_ASSIGNED)
  const [tab, setTab] = useState('People')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const bodyRef = useRef(null)

  // Scroll the middle area back to the top whenever the step changes
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])

  const colorOf = (phaseId) => {
    const i = phases.findIndex((p) => p.id === phaseId)
    return PHASE_COLORS[Math.max(i, 0) % PHASE_COLORS.length]
  }

  const goTo = (n) => {
    setError('')
    setStep(n)
  }

  const resetData = () => {
    setName('P-022 - Cielo')
    setPlace('San Francisco, Panamá')
    setDescription('Roof waterproofing')
    setProjectStart('Nov 9, 2026')
    setProjectEnd('Dec 11, 2026')
    setPhases(START_PHASES)
    setNextId(3)
    setAssigned(START_ASSIGNED)
    setTab('People')
    setError('')
  }

  // ---------- Phase actions ----------
  const updatePhase = (id, field, value) =>
    setPhases(phases.map((p) => (p.id === id ? { ...p, [field]: value } : p)))

  const addPhase = () => {
    setPhases([...phases, { id: nextId, name: 'Phase ' + (phases.length + 1), start: '', end: '' }])
    setNextId(nextId + 1)
    setError('')
  }

  const deletePhase = (id) => {
    setPhases(phases.filter((p) => p.id !== id))
    const cleaned = {}
    Object.keys(assigned).forEach((rid) => {
      cleaned[rid] = assigned[rid].filter((pid) => pid !== id)
    })
    setAssigned(cleaned)
  }

  const toggleChip = (resourceId, phaseId) => {
    const current = assigned[resourceId] || []
    const updated = current.includes(phaseId)
      ? current.filter((pid) => pid !== phaseId)
      : [...current, phaseId]
    setAssigned({ ...assigned, [resourceId]: updated })
    setError('')
  }

  // ---------- Derived values ----------
  const assignedRows = RESOURCES.filter((r) => (assigned[r.id] || []).length > 0)
  const conflictRows = assignedRows.filter((r) => r.busy)

  // ---------- Navigation with validation ----------
  const nextFromDetails = () => {
    if (!name.trim()) return setError('Enter a project name.')
    if (phases.length === 0) return setError('Add at least one phase.')
    goTo(2)
  }
  const nextFromResources = () => {
    if (assignedRows.length === 0) return setError('Assign at least one resource to a phase.')
    goTo(3)
  }
  const handleSave = () => {
    resetData()
    setSaved(true)
    setStep(0)
  }
  const handleDiscard = () => {
    resetData()
    setSaved(false)
    setStep(0)
  }

  // ---------- Screens (plain functions, so inputs keep focus) ----------
  const renderStart = () => (
    <div className="ap-start">
      <div className="ap-start-icon">+</div>
      <h3 className="ap-start-title">Test a new project</h3>
      <p className="ap-start-text">Try a project before saving it. See how it fits your timeline and resources.</p>
      <button type="button" className="ap-btn primary full" onClick={() => { setSaved(false); goTo(1) }}>
        + New project
      </button>
      {saved && (
        <div className="ap-notice ok">Project saved (demo). Any conflicts would appear in the Resource Gantt.</div>
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
      <input className="ap-input" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="ap-label">Location</div>
      <input className="ap-input" value={place} onChange={(e) => setPlace(e.target.value)} />
      <div className="ap-label">Description</div>
      <textarea className="ap-input area" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="ap-row2">
        <div>
          <div className="ap-label">Project start</div>
          <input className="ap-input" value={projectStart} onChange={(e) => setProjectStart(e.target.value)} />
        </div>
        <div>
          <div className="ap-label">Project end</div>
          <input className="ap-input" value={projectEnd} onChange={(e) => setProjectEnd(e.target.value)} />
        </div>
      </div>

      <h3 className="ap-section spaced">Phases</h3>
      {phases.map((p) => (
        <div className="ap-phase-card" key={p.id}>
          <div className="ap-phase-top">
            <span className="ap-dot" style={{ background: colorOf(p.id) }} />
            <input className="ap-input" value={p.name} onChange={(e) => updatePhase(p.id, 'name', e.target.value)} />
            <button type="button" className="ap-x" aria-label="Delete phase" onClick={() => deletePhase(p.id)}>×</button>
          </div>
          <div className="ap-phase-dates">
            <input className="ap-input" value={p.start} placeholder="Start" onChange={(e) => updatePhase(p.id, 'ap-start', e.target.value)} />
            <span className="ap-arrow">→</span>
            <input className="ap-input" value={p.end} placeholder="End" onChange={(e) => updatePhase(p.id, 'end', e.target.value)} />
          </div>
        </div>
      ))}
      <button type="button" className="ap-add-phase" onClick={addPhase}>+ Add phase</button>
      {error && <div className="ap-error">{error}</div>}
    </>
  )

  const renderResourceRow = (r) => {
    const mine = assigned[r.id] || []
    return (
      <div className={'ap-res' + (r.busy ? ' busy' : '')} key={r.id}>
        <div className="ap-res-top">
          <span className={'ap-status ' + (r.busy ? 'red' : 'green')} />
          <span className="ap-res-name">{r.name}</span>
          <span className="ap-res-role">{r.role}</span>
        </div>
        <div className="ap-res-note">{r.note}</div>
        <div className="ap-chips">
          {phases.map((p) => {
            const on = mine.includes(p.id)
            let cls = 'ap-chip'
            let style = {}
            if (on && r.busy) cls += ' conflict'
            else if (on) style = { background: colorOf(p.id), borderColor: colorOf(p.id), color: '#fff' }
            return (
              <button type="button" key={p.id} className={cls} style={style} onClick={() => toggleChip(r.id, p.id)}>
                {p.name}
              </button>
            )
          })}
        </div>
        {r.busy && mine.length > 0 && <div className="ap-warn">⚠ Conflicting dates</div>}
      </div>
    )
  }

  const renderResources = () => {
    const available = RESOURCES.filter((r) => !r.busy)
    const unavailable = RESOURCES.filter((r) => r.busy)
    return (
      <>
        <h3 className="ap-section">Assign resources</h3>
        <input className="ap-input" placeholder="Search people, tools..." readOnly />
        <div className="ap-tabs">
          {TABS.map((t) => (
            <button type="button" key={t} className={'ap-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'People' ? (
          <>
            <div className="ap-group-title">Available</div>
            {available.map(renderResourceRow)}
            <div className="ap-group-title">Not available</div>
            {unavailable.map(renderResourceRow)}
          </>
        ) : (
          <div className="ap-notice">{tab} use the same layout as People (demo data shows People only).</div>
        )}
        {error && <div className="ap-error">{error}</div>}
      </>
    )
  }

  const renderReviewRow = (r) => {
    const mine = assigned[r.id] || []
    return (
      <div className={'ap-res review' + (r.busy ? ' busy' : '')} key={r.id}>
        <div className="ap-res-top">
          <span className={'ap-status ' + (r.busy ? 'red' : 'green')} />
          <span className="ap-res-name">{r.name}</span>
          <span className="ap-pills">
            {mine.map((pid) => {
              const p = phases.find((x) => x.id === pid)
              if (!p) return null
              return (
                <span key={pid} className="ap-pill" style={{ background: r.busy ? '#EF4444' : colorOf(pid) }}>
                  {p.name}
                </span>
              )
            })}
          </span>
          <span className={'ap-badge ' + (r.busy ? 'bad' : 'good')}>{r.busy ? 'conflict' : 'ok'}</span>
        </div>
        {r.busy && <div className="ap-warn">⚠ {r.reason}</div>}
      </div>
    )
  }

  const renderReview = () => {
    const okRows = assignedRows.filter((r) => !r.busy)
    return (
      <>
        <h3 className="ap-section">Review and confirm</h3>
        <div className="ap-summary-name">{name || 'Untitled project'}</div>
        <div className="ap-summary-sub">{place} - {projectStart} to {projectEnd}</div>
        <div className="ap-phase-list">
          {phases.map((p) => (
            <div className="ap-phase-line" key={p.id}>
              <span className="ap-dot" style={{ background: colorOf(p.id) }} />
              <span className="ap-phase-name">{p.name}</span>
              <span className="ap-phase-range">{p.start} - {p.end}</span>
            </div>
          ))}
        </div>
        {okRows.length > 0 && <div className="ap-group-title">Available</div>}
        {okRows.map(renderReviewRow)}
        {conflictRows.length > 0 && <div className="ap-group-title">Not available</div>}
        {conflictRows.map(renderReviewRow)}
        {conflictRows.length > 0 ? (
          <div className="ap-conflict-box">
            <strong>{conflictRows.length} conflict{conflictRows.length > 1 ? 's' : ''}</strong>
            <div>You can still save it. It will appear in the Resource Gantt to resolve.</div>
          </div>
        ) : (
          <div className="ap-notice ok">No conflicts. Everything assigned is free for these dates.</div>
        )}
      </>
    )
  }

  const renderFooter = () => {
    if (step === 0) return null
    const back = () => goTo(step - 1)
    if (step === 1) {
      return (
        <div className="ap-btn-row">
          <button type="button" className="ap-btn ghost" onClick={back}>Back</button>
          <button type="button" className="ap-btn primary grow" onClick={nextFromDetails}>Next: resources</button>
        </div>
      )
    }
    if (step === 2) {
      return (
        <div className="ap-btn-row">
          <button type="button" className="ap-btn ghost" onClick={back}>Back</button>
          <button type="button" className="ap-btn primary grow" onClick={nextFromResources}>Next: review</button>
        </div>
      )
    }
    const hasConflict = conflictRows.length > 0
    return (
      <>
        <button type="button" className="ap-link" onClick={handleDiscard}>Discard what-if</button>
        <div className="ap-btn-row">
          <button type="button" className="ap-btn ghost" onClick={back}>Back</button>
          <button type="button" className={'ap-btn grow ' + (hasConflict ? 'amber' : 'green')} onClick={handleSave}>
            {hasConflict ? 'Save anyway' : 'Save project'}
          </button>
        </div>
      </>
    )
  }

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

      {step > 0 && <div className="ap-card-footer">{renderFooter()}</div>}
    </div>
  )
}
