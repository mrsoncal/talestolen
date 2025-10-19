import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  subscribe, getState, remainingSeconds,
  addToQueueByDelegate, addToQueueDirect, removeFromQueue,
  setTypeDuration, loadDelegates, updateDelegate, deleteDelegate, saveDelegatesToLocalStorageRaw,
  startNext, startSpecific, pauseTimer, resumeTimer,
  skipCurrent, resetTimer, normalizeType
} from './store/bus.js'

import DelegatesTable from './components/DelegatesTable.jsx'
import './app-extra.css'

const LIVE_SYNC_TAB_CSS = `

/* --- Live Sync tabs styling --- */
.btn[data-active="false"],
.btn.secondary[data-active="false"] {
  background-color: #1b2638;
  color: #d8e1f0;
}
.btn[data-active="true"],
.btn.active {
  background-color: #3b82f6;
  color: #fff;
}
.btn[data-active="false"]:hover {
  filter: brightness(1.2);
  background-color: #22324a;
}
.btn.secondary.active,
.btn.secondary[data-active="true"] {
  background-color: #3b82f6 !important;
  color: #fff !important;
}

`;

/* ============================
   Tiny built-in WebRTC sync
   ============================ */
class LiveSync {
  constructor({ onMessage } = {}) {
    this.onMessage = onMessage || (() => {})
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    this.channel = null

    // incoming datachannel
    this.pc.ondatachannel = (e) => {
      this.channel = e.channel
      this._bind()
    }
  }
  _bind() {
    if (!this.channel) return
    this.channel.onopen = () => console.log('[LiveSync] channel open')
    this.channel.onclose = () => console.log('[LiveSync] channel closed')
    this.channel.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)) }
      catch (err) { console.warn('[LiveSync] bad message', err) }
    }
  }
  async host() {
    this.channel = this.pc.createDataChannel('talestolen')
    this._bind()
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await this._awaitIceComplete()
    return JSON.stringify(this.pc.localDescription)
  }
  async acceptAnswer(answerStr) {
    const answer = JSON.parse(answerStr)
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
  }
  async joinWithOffer(offerStr) {
    const offer = JSON.parse(offerStr)
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    await this._awaitIceComplete()
    return JSON.stringify(this.pc.localDescription)
  }
  async _awaitIceComplete(timeoutMs = 3000) {
    if (this.pc.iceGatheringState === 'complete') return
    await new Promise((resolve) => {
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') {
          cleanup('event')
        }
      }
      const cleanup = () => {
        try { this.pc.removeEventListener('icegatheringstatechange', onChange) } catch {}
        resolve()
      }
      this.pc.addEventListener('icegatheringstatechange', onChange)
      setTimeout(() => cleanup('timeout'), timeoutMs)
    })
  }
  
  send(obj) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(obj))
    }
  }
  close() {
    try { this.channel?.close() } catch {}
    try { this.pc?.close() } catch {}
  }
}

/* ============================
   Store / hash / timer helpers
   ============================ */
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
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setBeat(b => b + 1), 200)
    return () => clearInterval(id)
  }, [enabled])
}

/* ============================
   App (routes)
   ============================ */
export default function App(){
  const state = useStore()
  const hash = useHash()
  useTimerRerender(hash === '#timer')

  if (hash === '#timer') return <TimerFull state={state} />
  if (hash === '#queue') return <QueueFull state={state} />
  return <AdminView state={state} />
}

/* ============================
   CSV utils
   ============================ */
function parseCSV(text){
  if (!text) return []
  let s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1)
  const lines = s.split('\n').filter(Boolean)
  if (!lines.length) return []

  const delim = detectDelimiter(lines[0])
  const split = (line) => splitRow(line, delim)
  const sample = lines[0]
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
    for (const line of lines) {
      const [number='', name='', org=''] = split(line).map(x => (x ?? '').trim())
      rows.push({ number, name, org })
    }
  }
  return rows.filter(r => String(r.number || '').trim() !== '')
}
function detectDelimiter(line){
  const counts = {
    ',': (line.match(/,/g) || []).length,
    ';': (line.match(/;/g) || []).length,
    '\t': (line.match(/\t/g) || []).length
  }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0] || ','
}
function splitRow(line, delim){
  const out = []; let cur = ''; let inQuotes = false
  for (let i=0;i<line.length;i++){
    const ch = line[i]
    if (ch === '"'){
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

/* ============================
   Admin
   ============================ */
function AdminView({ state }) {
  // Add by delegate number + type
  const [num, setNum] = useState('');
  const [type, setType] = useState('innlegg');
  const [manualName, setManualName] = useState('');
  const [manualOrg, setManualOrg] = useState('');

  // type durations
  const [dInnlegg, setDInnlegg] = useState(state.typeDurations.innlegg);
  const [dReplikk, setDReplikk] = useState(state.typeDurations.replikk);
  const [dSvar, setDSvar] = useState(state.typeDurations.svar_replikk);
  useEffect(() => {
    setDInnlegg(state.typeDurations.innlegg);
    setDReplikk(state.typeDurations.replikk);
    setDSvar(state.typeDurations.svar_replikk);
  }, [state.typeDurations]);

  const cur = state.currentSpeaker;
  const remain = useMemo(() => (cur ? fmt(remainingSeconds(cur)) : '00:00'), [cur]);
  const delegate = state.delegates[String((num || '').trim())];
  const previewName = delegate?.name || (num ? `#${num}` : '');
  const previewOrg = delegate?.org || '';

  /* ---- Live sync wiring ---- */
  const [syncMode, setSyncMode] = useState('idle'); // idle | host | join | connected
  const [offerText, setOfferText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const syncRef = useRef(null);

  const resetSync = (next = 'idle') => {
    try { syncRef.current?.close(); } catch {}
    syncRef.current = null;
    setOfferText('');
    setAnswerText('');
    setSyncMode(next);
    console.log('[LiveSyncUI] mode ->', next);
  };

  useEffect(() => () => { try { syncRef.current?.close(); } catch {} }, []);

  // Incoming sync messages -> call existing actions
  function onSyncMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'timer:startNext':       startNext(); break;
      case 'timer:startSpecific':   if (msg.payload?.id) startSpecific(msg.payload.id); break;
      case 'timer:pause':           pauseTimer(); break;
      case 'timer:resume':          resumeTimer(); break;
      case 'timer:reset':           resetTimer(); break;
      case 'timer:setDurations': {
        const p = msg.payload || {};
        if (p.innlegg != null)      setTypeDuration('innlegg', p.innlegg);
        if (p.replikk != null)      setTypeDuration('replikk', p.replikk);
        if (p.svar_replikk != null) setTypeDuration('svar_replikk', p.svar_replikk);
        break;
      }
      default: break;
    }
  }
  function sendSync(type, payload) {
    syncRef.current?.send({ type, payload: payload || null });
  }

  async function hostSync() {
    syncRef.current?.close();
    syncRef.current = new LiveSync({ onMessage: onSyncMessage });
    const sdp = await syncRef.current.host();
    setOfferText(sdp);
    setAnswerText('');
    setSyncMode('host');
    console.log('[LiveSyncUI] mode -> host');
  }
  async function acceptAnswer() {
    if (!answerText.trim()) return;
    await syncRef.current.acceptAnswer(answerText.trim());
    setSyncMode('connected');
  }
  async function startJoin() {
    syncRef.current?.close();
    syncRef.current = new LiveSync({ onMessage: onSyncMessage });
    setOfferText('');
    setAnswerText('');
    setSyncMode('join');
    console.log('[LiveSyncUI] mode -> join');
  }
  async function pasteOfferAndCreateAnswer() {
    if (!offerText.trim()) return;
    const sdp = await syncRef.current.joinWithOffer(offerText.trim());
    setAnswerText(sdp);
    // user copies answer back to host; connection becomes "open" automatically
  }

  /* ---- handlers ---- */
  function handleCSV(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const rows = parseCSV(text);
        if (rows.length) {
          try { saveDelegatesToLocalStorageRaw(text); } catch {}
          loadDelegates(rows);
        }
      } catch (err) {
        console.error('[CSV] parse error:', err);
      }
    };
    reader.onerror = (err) => console.error('[CSV] FileReader error:', err);
    reader.readAsText(file, 'utf-8');
  }
  function handleAddByNum() {
    if (!num.trim()) return;
    addToQueueByDelegate({ delegateNumber: num.trim(), type });
    setNum('');
  }
  function handleAddManual() {
    if (!manualName.trim()) return;
    addToQueueDirect({ name: manualName.trim(), org: manualOrg.trim(), type });
    setManualName('');
    setManualOrg('');
  }

  return (<>
    <style dangerouslySetInnerHTML={ __html=LIVE_SYNC_TAB_CSS } />
    <div className="container">
      <nav className="nav">
        <a className="btn ghost" href="#admin">Admin</a>
        <a className="btn ghost" href="#timer" target="talestolen-timer">Timer</a>
        <a className="btn ghost" href="#queue" target="talestolen-queue">Queue</a>
      </nav>

      <section className="card">
        <div className="title">Talestolen · Admin</div>
        <div className="muted">
          Add speakers by <span className="mono">delegatenummer</span> and choose speaking type.
          Upload the delegates CSV to enable auto lookup.
        </div>
        <div className="spacer"></div>

        {/* Live Sync card */}
<div className="card" style={{ marginBottom: 12 }}>
  <div className="title">Live Sync (LAN / P2P)</div>

  {/* Tabs */}
  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
    <button
      type="button"
      className={`btn ${syncMode === 'host' ? 'active' : ''}`}
      onClick={() => {
        if (syncMode !== 'host') hostSync();
      }}
      aria-pressed={syncMode === 'host'}
      data-active={syncMode === 'host'}
    >
      Host
    </button>
    <button
      type="button"
      className={`btn secondary ${syncMode === 'join' ? 'active' : ''}`}
      onClick={() => {
        if (syncMode !== 'join') startJoin();
      }}
      aria-pressed={syncMode === 'join'}
      data-active={syncMode === 'join'}
    >
      Join
    </button>

    {syncMode === 'connected' && <span className="badge">Connected</span>}
    {(syncMode === 'host' || syncMode === 'join') && (
      <button
        type="button"
        className="btn ghost"
        onClick={() => resetSync('idle')}
        style={{ marginLeft: 'auto' }}
      >
        Back
      </button>
    )}
  </div>

  {/* Host body */}
  {syncMode === 'host' && (
    <>
      <div className="muted">1) Share this Offer with the joining device</div>
      <textarea
        className="input"
        rows={6}
        value={offerText}
        readOnly
        style={{ minHeight: 120, display: 'block' }}
      />

      <div className="muted" style={{ marginTop: 8 }}>2) Paste their Answer here</div>
      <textarea
        className="input"
        rows={6}
        value={answerText}
        onChange={e => setAnswerText(e.target.value)}
        style={{ minHeight: 120, display: 'block' }}
      />

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={acceptAnswer}>Connect</button>
      </div>
    </>
  )}

  {/* Join body */}
  {syncMode === 'join' && (
    <>
      <div className="muted">1) Paste Host’s Offer here</div>
      <textarea
        className="input"
        rows={6}
        value={offerText}
        onChange={e => setOfferText(e.target.value)}
        style={{ minHeight: 120, display: 'block' }}
      />

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={pasteOfferAndCreateAnswer}>
          Create Answer
        </button>
      </div>

      <div className="muted" style={{ marginTop: 8 }}>2) Send this Answer back to the Host</div>
      <textarea
        className="input"
        rows={6}
        value={answerText}
        readOnly
        style={{ minHeight: 120, display: 'block' }}
      />
    </>
  )}
</div>


{/* Row: upload + type defaults */}
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
                <input
                  className="input"
                  type="number" min="10" step="5"
                  value={dInnlegg}
                  onChange={e => {
                    const val = e.target.value; setDInnlegg(val); setTypeDuration('innlegg', val);
                    sendSync('timer:setDurations', { innlegg: val });
                  }}
                />
              </div>
              <div>
                <div className="muted">Replikk (sec)</div>
                <input
                  className="input"
                  type="number" min="10" step="5"
                  value={dReplikk}
                  onChange={e => {
                    const val = e.target.value; setDReplikk(val); setTypeDuration('replikk', val);
                    sendSync('timer:setDurations', { replikk: val });
                  }}
                />
              </div>
              <div>
                <div className="muted">Svar-replikk (sec)</div>
                <input
                  className="input"
                  type="number" min="10" step="5"
                  value={dSvar}
                  onChange={e => {
                    const val = e.target.value; setDSvar(val); setTypeDuration('svar_replikk', val);
                    sendSync('timer:setDurations', { svar_replikk: val });
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="spacer"></div>

        {/* Row: add by number + manual add */}
        <div className="split">
          <div className="card">
            <div className="title">Add by delegatenummer</div>
            <div className="row">
              <input className="input" placeholder="Delegatenummer" value={num} onChange={e => setNum(e.target.value)} />
              <select className="input" value={type} onChange={e => setType(e.target.value)}>
                <option value="innlegg">Innlegg</option>
                <option value="replikk">Replikk</option>
                <option value="svar_replikk">Svar-replikk</option>
              </select>
              <button className="btn" onClick={handleAddByNum} disabled={!num.trim()}>Legg til</button>
            </div>
            <div className="spacer"></div>
            <div className="muted">
              Preview: <b>{previewName}</b>{previewOrg ? ` — ${previewOrg}` : ''} · <span className="badge">{labelFor(type)}</span>
            </div>
          </div>

          <div className="card">
            <div className="title">Add manually (fallback)</div>
            <div className="row">
              <input className="input" placeholder="Navn" value={manualName} onChange={e => setManualName(e.target.value)} />
              <input className="input" placeholder="Organisasjon" value={manualOrg} onChange={e => setManualOrg(e.target.value)} />
              <select className="input" value={type} onChange={e => setType(e.target.value)}>
                <option value="innlegg">Innlegg</option>
                <option value="replikk">Replikk</option>
                <option value="svar_replikk">Svar-replikk</option>
              </select>
              <button className="btn" onClick={handleAddManual} disabled={!manualName.trim()}>Legg til</button>
            </div>
          </div>
        </div>

        <div className="spacer"></div>

        {/* Row: current speaker + queue */}
        <div className="split">
          <div className="card">
            <div className="title">Current Speaker</div>
            <div className="list">
              {cur ? (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="big">
                      {cur.name} <span className="muted">({cur.delegateNumber ? `#${cur.delegateNumber}` : '–'})</span>
                    </div>
                    <div className="muted">{cur.org || ' '}</div>
                    <div className="muted">
                      Type: <b>{labelFor(cur.type)}</b> • Base: {cur.baseDurationSec}s • {cur.paused ? 'Paused' : 'Running'}
                    </div>
                  </div>
                  <div className="badge">Remaining: {remain}</div>
                </div>
              ) : (
                <div className="muted">No one is speaking.</div>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={() => { startNext(); sendSync('timer:startNext'); }} disabled={!!state.currentSpeaker || state.queue.length === 0}>Start next</button>
              <button className="btn secondary" onClick={() => { pauseTimer();  sendSync('timer:pause');  }} disabled={!cur || cur.paused}>Pause</button>
              <button className="btn secondary" onClick={() => { resumeTimer(); sendSync('timer:resume'); }} disabled={!cur || !cur.paused}>Resume</button>
              <button className="btn danger"    onClick={() => { skipCurrent(); sendSync('timer:reset');  }} disabled={!cur}>Skip</button>
              <button className="btn ghost"     onClick={() => { resetTimer(); sendSync('timer:reset');  }} disabled={!cur}>Reset</button>
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
                      <div className={'big ' + (i === 0 ? 'next' : '')}>
                        {i === 0 ? 'Next: ' : ''}{q.name} <span className="muted">({q.delegateNumber ? `#${q.delegateNumber}` : '–'})</span>
                      </div>
                      <div className="muted">{q.org || ' '}</div>
                      <div className="muted">Type: <b>{labelFor(q.type)}</b></div>
                    </div>
                    <div className="row">
                      <button className="btn secondary" onClick={() => { startSpecific(q.id); sendSync('timer:startSpecific', { id: q.id }); }}>Start</button>
                      <button className="btn ghost" onClick={() => removeFromQueue(q.id)}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Single, real delegates table at the very end */}
        <DelegatesTable state={state} />
      </section>
    </div>
  </>
  );
}


/* ============================
   Timer & Queue views
   ============================ */

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

function QueueFull({ state }) {
  const cur = state?.currentSpeaker ?? null
  const queue = Array.isArray(state?.queue) ? state.queue : []

  return (
    <div className="full" style={{ alignItems: 'stretch' }}>
      <div className="header">Speaking Queue</div>

      <div className="queue">
        {cur ? (
          <div className="queueRow queueNow">
            <div className="big">
              Now: {cur.name} {cur.delegateNumber ? `(#${cur.delegateNumber})` : ''}
            </div>
            <span className="pill">{labelFor(cur.type)}</span>
          </div>
        ) : null}

        {queue.length === 0 ? (
          <div className="queueRow">
            <div className="muted">No one in queue.</div>
          </div>
        ) : (
          queue.map((q, i) => (
            <div key={q.id ?? `${q.name || 'anon'}-${i}`} className="queueRow">
              <div className={'big ' + (i === 0 ? 'next' : '')}>
                {i === 0 ? 'Next: ' : ''}
                {q.name} {q.delegateNumber ? `(#${q.delegateNumber})` : ''}
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

/* ============================
   helpers
   ============================ */
function labelFor(t) {
  const v = (typeof normalizeType === 'function' ? normalizeType(t) : t) || ''
  if (v === 'replikk') return 'Replikk'
  if (v === 'svar_replikk') return 'Svar-replikk'
  return 'Innlegg'
}
function fmt(s) {
  const sec = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0
  const m = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `${m}:${ss}`
}
