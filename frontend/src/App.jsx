import React, { useEffect, useMemo, useState } from 'react'
import {
  subscribe, getState, remainingSeconds,
  addToQueueByDelegate, addToQueueDirect, removeFromQueue,
  setTypeDuration, loadDelegates,
  startNext, startSpecific, pauseTimer, resumeTimer,
  skipCurrent, resetTimer, normalizeType
} from './store/bus.js'

function useStore(){
  const [, setTick] = useState(0)
  useEffect(() => subscribe(() => setTick(t => t+1)), [])
  return getState()
}
function useHash(){
  const get = () => {
    const h = (location.hash || '').toLowerCase()
    return h && h !== '#' ? h : '#admin'
  }
  const [hash, setHash] = useState(get)
  useEffect(() => {
    const on = () => setHash(get())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
function useTimerRerender(enabled){
  const [, setBeat] = useState(0)
  useEffect(() => { if(!enabled) return; const id=setInterval(()=>setBeat(b=>b+1), 200); return ()=>clearInterval(id) }, [enabled])
}

export default function App(){
  const state = useStore()
  const hash = useHash()
  useTimerRerender(hash === '#timer')

  if (hash === '#timer') return <TimerFull state={state} />
  if (hash === '#queue') return <QueueFull state={state} />
  return <AdminView state={state} />
}

// ---- CSV utils ----
function parseCSV(text){
  // very small CSV parser (no quoted commas). Assumes headers in first row.
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim())
    const row = {}
    headers.forEach((h, i) => row[h] = cells[i] ?? '')
    // normalize common header names
    return {
      number: row['number'] || row['nr'] || row['delegatenummer'] || row['delegate number'] || row['delegatenr'] || row['id'] || '',
      name: row['name'] || row['navn'] || '',
      org: row['org'] || row['organisasjon'] || row['kommune'] || row['representerer'] || row['org.'] || ''
    }
  })
}

function AdminView({ state }){
  // Add by delegate number + type
  const [num, setNum] = useState('')
  const [type, setType] = useState('innlegg')
  // Optional direct add (fallback if someone not in list needs to speak)
  const [manualName, setManualName] = useState('')
  const [manualOrg, setManualOrg] = useState('')

  // type duration controls
  const [dInnlegg, setDInnlegg] = useState(state.typeDurations.innlegg)
  const [dReplikk, setDReplikk] = useState(state.typeDurations.replikk)
  const [dSvar, setDSvar] = useState(state.typeDurations.svar_replikk)

  useEffect(() => { setDInnlegg(state.typeDurations.innlegg); setDReplikk(state.typeDurations.replikk); setDSvar(state.typeDurations.svar_replikk); }, [state.typeDurations])

  const cur = state.currentSpeaker
  const remain = useMemo(() => (cur ? fmt(remainingSeconds(cur)) : '00:00'), [cur])

  const delegate = state.delegates[String(num||'').trim()]
  const previewName = delegate?.name || (num ? `#${num}` : '')
  const previewOrg = delegate?.org || ''

  return (
    <div className="container">
      <nav className="nav">
        <a className="btn ghost" href="#admin">Admin</a>
        <a className="btn ghost" href="#timer" target="talestolen-timer">Timer</a>
        <a className="btn ghost" href="#queue" target="talestolen-queue">Queue</a>
      </nav>

      <section className="card">
        <div className="title">Talestolen · Admin</div>
        <div className="muted">Add speakers by <span className="mono">delegatenummer</span> and choose speaking type. Upload the delegates CSV to enable auto lookup.</div>
        <div className="spacer"></div>

        <div className="split">
          <div className="card">
            <div className="title">Upload delegates CSV</div>
            <input className="input wide" type="file" accept=".csv" onChange={handleCSV} />
            <div className="spacer"></div>
            <div className="muted">Loaded delegates: <b>{Object.keys(state.delegates).length}</b></div>
          </div>

          <div className="card">
            <div className="title">Speaking type defaults</div>
            <div className="grid-3">
              <div>
                <div className="muted">Innlegg (sec)</div>
                <input className="input" type="number" min="10" step="5" value={dInnlegg} onChange={e=>{ setDInnlegg(e.target.value); setTypeDuration('innlegg', e.target.value); }} />
              </div>
              <div>
                <div className="muted">Replikk (sec)</div>
                <input className="input" type="number" min="10" step="5" value={dReplikk} onChange={e=>{ setDReplikk(e.target.value); setTypeDuration('replikk', e.target.value); }} />
              </div>
              <div>
                <div className="muted">Svar-replikk (sec)</div>
                <input className="input" type="number" min="10" step="5" value={dSvar} onChange={e=>{ setDSvar(e.target.value); setTypeDuration('svar_replikk', e.target.value); }} />
              </div>
            </div>
          </div>
        </div>

        <div className="spacer"></div>

        <div className="split">
          <div className="card">
            <div className="title">Add by delegatenummer</div>
            <div className="row">
              <input className="input" placeholder="Delegatenummer" value={num} onChange={e=>setNum(e.target.value)} />
              <select className="input" value={type} onChange={e=>setType(e.target.value)}>
                <option value="innlegg">Innlegg</option>
                <option value="replikk">Replikk</option>
                <option value="svar_replikk">Svar-replikk</option>
              </select>
              <button className="btn" onClick={handleAddByNum} disabled={!num.trim()}>Legg til</button>
            </div>
            <div className="spacer"></div>
            <div className="muted">Preview: <b>{previewName}</b>{previewOrg ? ` — ${previewOrg}` : ''} · <span className="badge">{labelFor(type)}</span></div>
          </div>

          <div className="card">
            <div className="title">Add manually (fallback)</div>
            <div className="row">
              <input className="input" placeholder="Navn" value={manualName} onChange={e=>setManualName(e.target.value)} />
              <input className="input" placeholder="Organisasjon" value={manualOrg} onChange={e=>setManualOrg(e.target.value)} />
              <select className="input" value={type} onChange={e=>setType(e.target.value)}>
                <option value="innlegg">Innlegg</option>
                <option value="replikk">Replikk</option>
                <option value="svar_replikk">Svar-replikk</option>
              </select>
              <button className="btn" onClick={handleAddManual} disabled={!manualName.trim()}>Legg til</button>
            </div>
          </div>
        </div>

        <div className="spacer"></div>

        <div className="split">
          <div className="card">
            <div className="title">Current Speaker</div>
            <div className="list">
              {cur ? (
                <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                  <div>
                    <div className="big">{cur.name} <span className="muted">({cur.delegateNumber ? `#${cur.delegateNumber}` : '–'})</span></div>
                    <div className="muted">{cur.org || ' '}</div>
                    <div className="muted">Type: <b>{labelFor(cur.type)}</b> • Base: {cur.baseDurationSec}s • {cur.paused ? 'Paused' : 'Running'}</div>
                  </div>
                  <div className="badge">Remaining: {remain}</div>
                </div>
              ) : (
                <div className="muted">No one is speaking.</div>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={startNext} disabled={!!state.currentSpeaker || state.queue.length===0}>Start next</button>
              <button className="btn secondary" onClick={pauseTimer} disabled={!cur || cur.paused}>Pause</button>
              <button className="btn secondary" onClick={resumeTimer} disabled={!cur || !cur.paused}>Resume</button>
              <button className="btn danger" onClick={skipCurrent} disabled={!cur}>Skip</button>
              <button className="btn ghost" onClick={resetTimer} disabled={!cur}>Reset</button>
            </div>
          </div>

          <div className="card">
            <div className="title">Queue</div>
            <div className="list">
              {state.queue.length === 0 ? (
                <div className="muted">Queue is empty.</div>
              ) : (
                state.queue.map((q, i) => (
                  <div key={q.id} className="queue-item">
                    <div>
                      <div className={"big " + (i===0 ? 'next' : '')}>
                        {i===0 ? 'Next: ' : ''}{q.name} <span className="muted">({q.delegateNumber ? `#${q.delegateNumber}` : '–'})</span>
                      </div>
                      <div className="muted">{q.org || ' '}</div>
                      <div className="muted">Type: <b>{labelFor(q.type)}</b></div>
                    </div>
                    <div className="row">
                      <button className="btn secondary" onClick={()=>startSpecific(q.id)}>Start</button>
                      <button className="btn ghost" onClick={()=>removeFromQueue(q.id)}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )

  function handleCSV(e){
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCSV(String(reader.result||''))
      loadDelegates(rows)
    }
    reader.readAsText(file, 'utf-8')
  }
  function handleAddByNum(){
    if (!num.trim()) return
    addToQueueByDelegate({ delegateNumber: num.trim(), type })
    setNum('')
  }
  function handleAddManual(){
    if (!manualName.trim()) return
    addToQueueDirect({ name: manualName.trim(), org: manualOrg.trim(), type })
    setManualName(''); setManualOrg('')
  }
}

function TimerFull({ state }){
  const cur = state.currentSpeaker
  const secs = cur ? remainingSeconds(cur) : 0
  const text = fmt(secs)
  const typeLabel = cur ? labelFor(cur.type) : ''
  return (
    <div className="full">
      <div className="name">{cur ? `${cur.name} ${cur.delegateNumber?`(#${cur.delegateNumber})`:''}` : ''}</div>
      <div className="name">{cur?.org || ''}</div>
      <div className="timer">{text}</div>
      <div className="status">{cur ? typeLabel + (cur.paused ? ' · Paused' : ' · Live') : 'Waiting for the next speaker…'}</div>
    </div>
  )
}

function QueueFull({ state }){
  const cur = state.currentSpeaker
  return (
    <div className="full" style={{alignItems:'stretch'}}>
      <div className="header">Speaking Queue</div>
      <div className="queue">
        {cur && (
          <div className="queueRow queueNow">
            <div className="big">Now: {cur.name} {cur.delegateNumber?`(#${cur.delegateNumber})`:''}</div>
            <span className="pill">{labelFor(cur.type)}</span>
          </div>
        )}
        {state.queue.length === 0 ? (
          <div className="queueRow"><div className="muted">No one in queue.</div></div>
        ) : (
          state.queue.map((q, i) => (
            <div key={q.id} className="queueRow">
              <div className={"big " + (i===0 ? 'next' : '')}>
                {i===0 ? 'Next: ' : ''}{q.name} {q.delegateNumber?`(#${q.delegateNumber})`:''}
                <div className="muted">{q.org || ' '}</div>
              </div>
              <span className="pill">{labelFor(q.type)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function labelFor(t){
  const v = normalizeType(t)
  if (v === 'replikk') return 'Replikk'
  if (v === 'svar_replikk') return 'Svar-replikk'
  return 'Innlegg'
}

function fmt(s){
  const sec = Math.max(0, Math.floor(s))
  const m = Math.floor(sec/60).toString().padStart(2,'0')
  const ss = (sec % 60).toString().padStart(2,'0')
  return `${m}:${ss}`
}
