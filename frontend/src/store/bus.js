// src/store/bus.js (same as V1, included for completeness)
const CHANNEL = 'talestolen';
const SNAPSHOT_KEY = 'talestolen_state_v1';
const bc = new BroadcastChannel(CHANNEL);
const subs = new Set();

function nowMs(){ return Date.now(); }
function uid(){ return Math.random().toString(36).slice(2,10); }

const initialState = {
  queue: [],
  currentSpeaker: null,
  defaultDurationSec: 120,
  version: 0,
  updatedAt: nowMs(),
};

let state = loadSnapshot() || initialState;

function notify(){ subs.forEach(fn => { try { fn(); } catch{} }); }
function saveSnapshot(s){ localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s)); }
function loadSnapshot(){ const raw = localStorage.getItem(SNAPSHOT_KEY); if(!raw) return null; try{ return JSON.parse(raw); }catch{ return null; } }
function bump(s){ return { ...s, version:(s.version||0)+1, updatedAt: nowMs() }; }

function publish(next){
  state = next;
  saveSnapshot(state);
  try { bc.postMessage({ type:'STATE', payload: state }); } catch{}
  notify();
}

function applyIncoming(next){
  if (!next || typeof next !== 'object') return;
  if ((next.version ?? 0) > (state.version ?? 0)){
    state = next;
    saveSnapshot(state);
    notify();
  }
}

bc.onmessage = (e) => { if (e?.data?.type === 'STATE') applyIncoming(e.data.payload); };
window.addEventListener('storage', (e) => { if (e.key === SNAPSHOT_KEY && e.newValue){ try { applyIncoming(JSON.parse(e.newValue)); } catch{} } });

export function addToQueue(name){
  const clean = (name||'').trim(); if (!clean) return;
  const next = bump({ ...state, queue: [...state.queue, { id: uid(), name: clean, requestedAt: nowMs() }] });
  publish(next);
}
export function removeFromQueue(id){ const next = bump({ ...state, queue: state.queue.filter(x => x.id !== id) }); publish(next); }
export function setDefaultDuration(sec){ const n = Math.max(5, Math.round(Number(sec)||0)); const next = bump({ ...state, defaultDurationSec: n }); publish(next); }
export function startNext(){ if (state.currentSpeaker) return; const nextUp = state.queue[0]; if (!nextUp) return; startSpecific(nextUp.id); }
export function startSpecific(id){
  if (state.currentSpeaker) return;
  const idx = state.queue.findIndex(x => x.id === id); if (idx === -1) return;
  const copy = state.queue.slice(); const person = copy.splice(idx, 1)[0];
  const dur = state.defaultDurationSec || 120; const start = nowMs(); const end = start + dur*1000;
  const next = bump({ ...state, queue: copy, currentSpeaker: { id: person.id, name: person.name, startTimeMs: start, endTimeMs: end, baseDurationSec: dur, paused:false, pausedAtMs:null, accPauseMs:0 } });
  publish(next);
}
export function skipCurrent(){ if (!state.currentSpeaker) return; const next = bump({ ...state, currentSpeaker: null }); publish(next); }
export function resetTimer(){
  if (!state.currentSpeaker) return;
  const dur = state.currentSpeaker.baseDurationSec || state.defaultDurationSec || 120; const start = nowMs();
  const next = bump({ ...state, currentSpeaker: { ...state.currentSpeaker, startTimeMs: start, endTimeMs: start + dur*1000, paused:false, pausedAtMs:null, accPauseMs:0 } });
  publish(next);
}
export function pauseTimer(){ const cur = state.currentSpeaker; if (!cur || cur.paused) return; const next = bump({ ...state, currentSpeaker: { ...cur, paused:true, pausedAtMs: nowMs() } }); publish(next); }
export function resumeTimer(){
  const cur = state.currentSpeaker; if (!cur || !cur.paused) return;
  const delta = Date.now() - (cur.pausedAtMs || Date.now());
  const next = bump({ ...state, currentSpeaker: { ...cur, paused:false, pausedAtMs:null, accPauseMs:(cur.accPauseMs||0)+delta, endTimeMs:(cur.endTimeMs||Date.now()) + delta } });
  publish(next);
}
export function getState(){ return state; }
export function subscribe(fn){ subs.add(fn); return () => subs.delete(fn); }
export function remainingSeconds(cur){
  if (!cur) return 0;
  if (cur.paused){ const untilPauseLeft = (cur.endTimeMs - cur.pausedAtMs)/1000; return Math.max(0, untilPauseLeft); }
  return Math.max(0, (cur.endTimeMs - Date.now())/1000);
}
