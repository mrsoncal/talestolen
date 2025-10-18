import React, { useEffect, useMemo, useState } from 'react'
import {
  subscribe, getState, remainingSeconds,
  addToQueueByDelegate, addToQueueDirect, removeFromQueue,
  setTypeDuration, loadDelegates, updateDelegate, deleteDelegate, saveDelegatesToLocalStorageRaw,
  startNext, startSpecific, pauseTimer, resumeTimer,
  skipCurrent, resetTimer, normalizeType
} from './store/bus.js'

import DelegatesTable from './components/DelegatesTable.jsx'
import './app-extra.css'

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
)
}

export default function App(){
  console.debug('[Talestolen] render App');
  const state = useStore()
  const hash = useHash()
  console.debug('[Talestolen] hash', hash)
  console.debug('[Talestolen] delegates count', Object.keys(state.delegates||{}).length)
  useTimerRerender(hash === '#timer')

  if (hash === '#timer') return <TimerFull state={state} />
  if (hash === '#queue') return <QueueFull state={state} />
  return <AdminView state={state} />
}

// ---- CSV utils (robust, headerless or headered; , ; or \t) ----
function parseCSV(text){
  if (!text) return []

  // Normalize line endings + strip BOM
  let s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1) // remove BOM

  const lines = s.split('\n').filter(Boolean)

  if (!lines.length) return []

  // Detect delimiter using the first non-empty line
  const sample = lines[0]
  const delim = detectDelimiter(sample)
  // Quick & safe splitter (no full RFC quoting, but handles simple quotes)
  const split = (line) => splitRow(line, delim)

  // Decide if file has a header row
  // Heuristic: if first row contains any letters (e.g., "name","org"), treat as header.
  // Your file is numbers+names only -> no header.
  const hasHeader = /[A-Za-z]/.test(sample.split(delim)[0]) && /[A-Za-z]/.test(sample)

  let rows = []
  if (hasHeader) {
    const headers = split(lines[0]).map(h => h.trim().toLowerCase())
    for (let i = 1; i < lines.length; i++) {
      const cells = split(lines[i])
      const row = {}
      headers.forEach((h, idx) => row[h] = (cells[idx] ?? '').trim())
      rows.push(normalizeRow(row))
    }
  } else {
    // Assume positional: number, name, org
    for (const line of lines) {
      const [number='', name='', org=''] = split(line).map(x => (x ?? '').trim())
      rows.push({ number, name, org })
    }
  }

  // Filter out empty numbers
  rows = rows.filter(r => String(r.number || '').trim() !== '')

  console.log('[CSV] Parsed rows:', rows.length, { delim, hasHeader })
  return rows
}

function detectDelimiter(line){
  const counts = {
    ',': (line.match(/,/g) || []).length,
    ';': (line.match(/;/g) || []).length,
    '\t': (line.match(/\t/g) || []).length
  }
  // Pick the most frequent delimiter
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] || ','
}

// Simple splitter supporting minimal quoted fields (no multi-line quotes)
function splitRow(line, delim){
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i=0;i<line.length;i++){
    const ch = line[i]
    if (ch === '"'){
      // toggle quotes or handle escaped ""
      if (inQuotes && line[i+1] === '"'){ cur += '"'; i++; }
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes){
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// Normalize headered rows to {number,name,org}
function normalizeRow(row){
  const r = {}
  const get = (keys) => {
    for (const k of keys){
      const v = row[k]; if (v != null && String(v).trim() !== '') return String(v).trim()
    }
    return ''
  }
  r.number = get(['number','nr','delegatenummer','delegate number','delegatenr','id'])
  r.name   = get(['name','navn'])
  r.org    = get(['org','organisasjon','kommune','representerer','org.'])
  return r
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
            <div className="spacer"></div>
            {/* DEBUG: Inline Delegates table */}
            <div className="card">
              <div className="title">Delegates</div>
              <div className="muted">Inline table (no extra CSS). If you see this, the table is rendering.</div>
              <div className="tableWrap">
                <table className="table">
                  <thead><tr><th>Nr</th><th>Name</th><th>Representerer</th></tr></thead>
                  <tbody>
                    {Object.values(state.delegates||{}).length === 0 ? (
                      <tr><td colSpan={3} className="muted">No delegates loaded yet.</td></tr>
                    ) : Object.values(state.delegates).sort((a,b)=>{
                      const ai = parseInt(a.number,10); const bi = parseInt(b.number,10);
                      if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
                      return String(a.number||'').localeCompare(String(b.number||''));
                    }).map(row => (
                      <tr key={row.number}>
                        <td>#{row.number}</td>
                        <td>{row.name||'—'}</td>
                        <td>{row.org||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
    
            <div className="spacer"></div>
            {/* DEBUG: Inline Delegates table */}
            <div className="card">
              <div className="title">Delegates</div>
              <div className="muted">Inline table (no extra CSS). If you see this, the table is rendering.</div>
              <div className="tableWrap">
                <table className="table">
                  <thead><tr><th>Nr</th><th>Name</th><th>Representerer</th></tr></thead>
                  <tbody>
                    {Object.values(state.delegates||{}).length === 0 ? (
                      <tr><td colSpan={3} className="muted">No delegates loaded yet.</td></tr>
                    ) : Object.values(state.delegates).sort((a,b)=>{
                      const ai = parseInt(a.number,10); const bi = parseInt(b.number,10);
                      if (!Number.isNaN(ai) && !Number.isNaN(bi)) return ai - bi;
                      return String(a.number||'').localeCompare(String(b.number||''));
                    }).map(row => (
                      <tr key={row.number}>
                        <td>#{row.number}</td>
                        <td>{row.name||'—'}</td>
                        <td>{row.org||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
    
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
      
          <DelegatesTable state={state} />
</section>
    </div>
  )

  function handleCSV(e){
    console.debug('[CSV] handleCSV start')
    const file = e.target.files?.[0]
    if (!file) {
      console.log('[CSV] No file selected')
      return
    }
    console.log('[CSV] Selected:', { name: file.name, size: file.size, type: file.type })

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const rows = parseCSV(text)
        console.debug('[CSV] parsed rows', rows.length)
        if (!rows.length) {
          console.warn('[CSV] Parsed 0 rows. Check delimiter or headers.')
        } else {
          
          // Save raw CSV and load delegates into state
          try { saveDelegatesToLocalStorageRaw(text) } catch {}
          console.debug('[CSV] loadDelegates called');
          loadDelegates(rows)
        
        }
        // Convert to map and load
        const map = {}
        rows.forEach(r => {
          const num = String(r.number || '').trim()
          if (num) map[num] = { number: num, name: r.name || `#${num}`, org: r.org || '' }
        })
        console.log('[CSV] Loading delegates (count):', Object.keys(map).length)
        loadDelegates(map)
      } catch (err){
        console.error('[CSV] Failed to parse:', err)
      }
    }
    reader.onerror = (err) => {
      console.error('[CSV] FileReader error:', err)
    }
    reader.readAsText(file, 'utf-8') // handles UTF-8 and UTF-8-BOM
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
