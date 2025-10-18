import React, { useEffect, useMemo, useState } from 'react'
import {
  subscribe, getState, remainingSeconds,
  addToQueue, removeFromQueue, setDefaultDuration,
  startNext, startSpecific, pauseTimer, resumeTimer,
  skipCurrent, resetTimer
} from './store/bus.js'

/** ---------- small hooks ---------- */
function useStore(){
  const [, setTick] = useState(0)
  useEffect(() => subscribe(() => setTick(t => t+1)), [])
  return getState()
}
function useHash(){
  const get = () => {
    const h = (location.hash || '').toLowerCase()
    return h && h !== '#' ? h : '#home'
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
    const id = setInterval(() => setBeat(b => b+1), 200)
    return () => clearInterval(id)
  }, [enabled])
}

/** ---------- open helpers (stable targets so we focus existing tabs) ---------- */
function openAdmin(){ window.open('/#admin', 'talestolen-admin') }
function openTimer(){ window.open('/#timer', 'talestolen-timer') }
function openQueue(){ window.open('/#queue', 'talestolen-queue') }
function openAllThree(){ openAdmin(); openTimer(); openQueue(); }

/** ---------- root ---------- */
export default function App(){
  const state = useStore()
  const hash = useHash()
  useTimerRerender(hash === '#timer') // only tick the timer screen

  if (hash === '#home') return <HomeView />
  if (hash === '#timer') return <TimerFull state={state} />
  if (hash === '#queue') return <QueueFull state={state} />
  return <AdminView state={state} />
}

/** ---------- Home: buttons that open the three dedicated tabs ---------- */
function HomeView(){
  return (
    <div className="full" style={{gap: 16}}>
      <div className="title">Talestolen</div>
      <div className="muted">Open the three live-synced tabs on this device</div>
      <div className="row" style={{flexWrap:'wrap', justifyContent:'center'}}>
        <button className="btn" onClick={openAdmin}>Open Admin</button>
        <button className="btn secondary" onClick={openTimer}>Open Timer</button>
        <button className="btn ghost" onClick={openQueue}>Open Queue</button>
      </div>
      <div className="spacer"></div>
      <button className="btn" onClick={openAllThree}>Open all three</button>
      <div className="spacer"></div>
      <div className="hint">You can also navigate directly to <code>#admin</code>, <code>#timer</code>, or <code>#queue</code>.</div>
    </div>
  )
}

/** ---------- Admin (controls only) ---------- */
function AdminView({ state }){
  const [name, setName] = useState('')
  const [defDur, setDefDur] = useState(state.defaultDurationSec)
  useEffect(() => setDefDur(state.defaultDurationSec), [state.defaultDurationSec])
  const cur = state.currentSpeaker
  const remain = useMemo(() => (cur ? fmt(remainingSeconds(cur)) : '00:00'), [cur])

  return (
    <div className="container">
      <nav className="nav">
        <a className="btn ghost" href="#home">Home</a>
        <a className="btn ghost" href="#admin">Admin</a>
        <a className="btn ghost" href="#timer" target="talestolen-timer">Timer</a>
        <a className="btn ghost" href="#queue" target="talestolen-queue">Queue</a>
      </nav>

      <section className="card">
        <div className="title">Talestolen · Admin</div>
        <div className="muted">Control queue and timer here; other tabs auto-update.</div>
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
            <div className="spacer"></div>
            <div className="row">
              <button className="btn ghost" onClick={()=>setDefaultDuration(30)}>30s</button>
              <button className="btn ghost" onClick={()=>setDefaultDuration(60)}>1m</button>
              <button className="btn ghost" onClick={()=>setDefaultDuration(120)}>2m</button>
              <button className="btn ghost" onClick={()=>setDefaultDuration(180)}>3m</button>
            </div>
          </div>

          <div className="card">
            <div className="title">Current Speaker</div>
            <div className="list">
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
          <div className="list">
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
    </div>
  )

  function handleAdd(){
    if (!name.trim()) return
    addToQueue(name)
    setName('')
  }
}

/** ---------- Timer (fullscreen, clean) ---------- */
function TimerFull({ state }){
  const cur = state.currentSpeaker
  const secs = cur ? remainingSeconds(cur) : 0
  const text = fmt(secs)
  return (
    <div className="full">
      <div className="name">{cur ? `Speaking: ${cur.name}` : ''}</div>
      <div className="timer">{text}</div>
      <div className="status">{cur ? (cur.paused ? 'Paused' : 'Live') : 'Waiting for the next speaker…'}</div>
    </div>
  )
}

/** ---------- Queue (fullscreen, clean) ---------- */
function QueueFull({ state }){
  const cur = state.currentSpeaker
  return (
    <div className="full" style={{alignItems:'stretch'}}>
      <div className="header">Speaking Queue</div>
      <div className="queue">
        {cur && (
          <div className="queueRow queueNow">
            <div className="big">Now: {cur.name}</div>
            <span className="pill">On stage</span>
          </div>
        )}
        {state.queue.length === 0 ? (
          <div className="queueRow"><div className="muted">No one in queue.</div></div>
        ) : (
          state.queue.map((q, i) => (
            <div key={q.id} className="queueRow">
              <div className={"big " + (i===0 ? 'next' : '')}>{i===0 ? 'Next: ' : ''}{q.name}</div>
              <span className="pill">#{i+1}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** ---------- fmt helper ---------- */
function fmt(s){
  const sec = Math.max(0, Math.floor(s))
  const m = Math.floor(sec/60).toString().padStart(2,'0')
  const ss = (sec % 60).toString().padStart(2,'0')
  return `${m}:${ss}`
}
