import React, { useEffect, useMemo, useState } from 'react'
import {
  subscribe, getState, remainingSeconds,
  addToQueue, removeFromQueue, setDefaultDuration,
  startNext, startSpecific, pauseTimer, resumeTimer,
  skipCurrent, resetTimer
} from './store/bus.js'

function useStore(){
  const [, setTick] = useState(0)
  useEffect(() => subscribe(() => setTick(t => t+1)), [])
  return getState()
}

function useHash(){
  const [hash, setHash] = useState(() => (location.hash || '#admin').toLowerCase())
  useEffect(() => {
    const on = () => setHash((location.hash || '#admin').toLowerCase())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

// lightweight timer re-render for the countdown (every 200ms)
function useTimerRerender(enabled){
  const [, setBeat] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setBeat(b => b+1), 200)
    return () => clearInterval(id)
  }, [enabled])
}

export default function App(){
  const state = useStore()
  const hash = useHash()
  useTimerRerender(hash === '#timer') // only force re-render on the timer view

  return (
    <div className="container">
      <nav className="nav">
        <a className="btn ghost" href="#admin">Admin</a>
        <a className="btn ghost" href="#timer">Timer</a>
        <a className="btn ghost" href="#queue">Queue</a>
      </nav>

      {hash === '#admin' && <AdminView state={state} />}
      {hash === '#timer' && <TimerView state={state} />}
      {hash === '#queue' && <QueueOnlyView state={state} />}

      <div className="spacer" />
      <div className="hint">Open three tabs: <code>#admin</code>, <code>#timer</code>, and <code>#queue</code>. All tabs will stay in sync.</div>
    </div>
  )
}

function AdminView({ state }){
  const [name, setName] = useState('')
  const [defDur, setDefDur] = useState(state.defaultDurationSec)

  useEffect(() => setDefDur(state.defaultDurationSec), [state.defaultDurationSec])

  const cur = state.currentSpeaker
  const remain = useMemo(() => (cur ? fmt(remainingSeconds(cur)) : '00:00'), [cur])

  return (
    <section className="card">
      <div className="title">Talestolen · Admin</div>
      <div className="muted">This tab controls the state for all tabs on this device.</div>
      <div className="spacer"></div>

      <div className="split">
        <div className="card">
          <div className="title">Add to queue</div>
          <div className="row">
            <input className="input" placeholder="Name (speaker)" value={name}
              onChange={e=>setName(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ handleAdd(); }}} />
            <button className="btn" onClick={handleAdd}>Add</button>
          </div>
          <div className="spacer"></div>
          <div className="row">
            <label className="row-center"><span className="badge">Default duration (sec)</span></label>
            <input className="input" type="number" min="10" step="5" value={defDur}
              onChange={e=>{ setDefDur(e.target.value); setDefaultDuration(e.target.value); }} />
          </div>
        </div>

        <div className="card">
          <div className="title">Current Speaker</div>
          <div className="list" id="currentSpeakerBlock">
            {cur ? (
              <div className="row" style={{justifyContent:'space-between', alignItems:'center'}}>
                <div>
                  <div className="big">{cur.name}</div>
                  <div className="muted">Base: {cur.baseDurationSec}s • {cur.paused ? 'Paused' : 'Running'}</div>
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
      </div>

      <div className="spacer"></div>
      <div className="card">
        <div className="title">Queue</div>
        <div className="list" id="queueList">
          {state.queue.length === 0 ? (
            <div className="muted">Queue is empty.</div>
          ) : (
            state.queue.map((q, i) => (
              <div key={q.id} className="queue-item">
                <div>
                  <div className={"big " + (i===0 ? 'next' : '')}>{i===0 ? 'Next: ' : ''}{q.name}</div>
                  <div className="muted">Requested {new Date(q.requestedAt).toLocaleTimeString()}</div>
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
    </section>
  )

  function handleAdd(){
    if (!name.trim()) return;
    addToQueue(name);
    setName('');
  }
}

function TimerView({ state }){
  const cur = state.currentSpeaker
  const secs = cur ? remainingSeconds(cur) : 0
  const text = fmt(secs)
  return (
    <section>
      <div className="hint" id="timerName">{cur ? `Speaking: ${cur.name}` : ''}</div>
      <div className="timer" id="timer">{text}</div>
      <div className="hint" id="timerStatus">{cur ? (cur.paused ? 'Paused' : 'Live') : 'Waiting for the next speaker…'}</div>
    </section>
  )
}

function QueueOnlyView({ state }){
  const cur = state.currentSpeaker
  return (
    <section className="card">
      <div className="title">Speaking Queue</div>
      <div className="muted">Auto-updates from the admin tab.</div>
      <div className="spacer"></div>
      <div className="list" id="queueOnlyList">
        {cur && (
          <div className="queue-item">
            <div className="big">Now: {cur.name}</div>
            <span className="badge">On stage</span>
          </div>
        )}
        {state.queue.length === 0 ? (
          <div className="queue-item">
            <div className="muted">No one in queue.</div>
          </div>
        ) : (
          state.queue.map((q, i) => (
            <div key={q.id} className="queue-item">
              <div className={"big " + (i===0 ? 'next' : '')}>{i===0 ? 'Next: ' : ''}{q.name}</div>
              <span className="badge">#{i+1}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function fmt(s){
  const sec = Math.max(0, Math.floor(s))
  const m = Math.floor(sec/60).toString().padStart(2,'0')
  const ss = (sec % 60).toString().padStart(2,'0')
  return `${m}:${ss}`
}
