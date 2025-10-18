// src/store/bus.js — adds delegates, speaking types, and type durations
const CHANNEL = 'talestolen';
const SNAPSHOT_KEY = 'talestolen_state_v2';

const bc = new BroadcastChannel(CHANNEL);
const subs = new Set();

function nowMs(){ return Date.now(); }
function uid(){ return Math.random().toString(36).slice(2,10); }

const initialState = {
  // Delegates map: { [number]: { number, name, org } }
  delegates: {},
  // Queue items include delegate references and speaking type
  queue: [], // {id, delegateNumber, name, org, type, requestedAt}
  // Current speaker carries the same fields + timing
  currentSpeaker: null, // {..., baseDurationSec, startTimeMs, endTimeMs, paused, pausedAtMs, accPauseMs}
  // Speaking type defaults (seconds)
  typeDurations: {
    innlegg: 90,       // 1.5 minutes
    replikk: 60,       // 1 minute
    svar_replikk: 60,  // 1 minute
  },
  version: 0,
  updatedAt: nowMs(),
};

let state = loadSnapshot() || initialState;

function notify(){ subs.forEach(fn => { try { fn(); } catch{} }); }
function saveSnapshot(s){ localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s)); }
function loadSnapshot(){ const raw = localStorage.getItem(SNAPSHOT_KEY); if(!raw) return null; try{ return JSON.parse(raw); } catch{ return null; } }
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

// ---- Actions ----
export function loadDelegates(arr){
  // arr: [{number,name,org}] or object map
  let map = {};
  if (Array.isArray(arr)){
    for (const row of arr){
      if (!row) continue;
      const num = String(row.number ?? row.delegateNumber ?? row.delegatenummer ?? row.nr ?? '').trim();
      const name = String(row.name ?? row.navn ?? '').trim();
      const org = String(row.org ?? row.organisasjon ?? row.kommune ?? row.representerer ?? '').trim();
      if (!num) continue;
      map[num] = { number: num, name, org };
    }
  } else if (arr && typeof arr === 'object'){
    map = arr;
  }
  const next = bump({ ...state, delegates: map });
  publish(next);
}

export function setTypeDuration(type, seconds){
  const sec = Math.max(5, Math.round(Number(seconds)||0));
  const next = bump({ ...state, typeDurations: { ...state.typeDurations, [type]: sec } });
  publish(next);
}

export function addToQueueByDelegate({ delegateNumber, type }){
  const num = String(delegateNumber||'').trim();
  if (!num) return;
  const t = normalizeType(type);
  const info = state.delegates[num] || { number: num, name: `#${num}`, org: '' };
  const item = {
    id: uid(),
    delegateNumber: num,
    name: info.name || `#${num}`,
    org: info.org || '',
    type: t,
    requestedAt: nowMs()
  };
  const next = bump({ ...state, queue: [...state.queue, item] });
  publish(next);
}

export function addToQueueDirect({ name, org, type }){
  const item = {
    id: uid(),
    delegateNumber: '',
    name: String(name||'').trim(),
    org: String(org||'').trim(),
    type: normalizeType(type),
    requestedAt: nowMs()
  };
  const next = bump({ ...state, queue: [...state.queue, item] });
  publish(next);
}

export function removeFromQueue(id){ const next = bump({ ...state, queue: state.queue.filter(x => x.id !== id) }); publish(next); }

export function startNext(){ if (state.currentSpeaker) return; const nextUp = state.queue[0]; if (!nextUp) return; startSpecific(nextUp.id); }

export function startSpecific(id){
  if (state.currentSpeaker) return;
  const idx = state.queue.findIndex(x => x.id === id); if (idx === -1) return;
  const copy = state.queue.slice(); const person = copy.splice(idx, 1)[0];
  const dur = state.typeDurations[person.type] ||  state.typeDurations.innlegg || 90;
  const start = nowMs(); const end = start + dur*1000;
  const next = bump({
    ...state,
    queue: copy,
    currentSpeaker: {
      ...person,
      baseDurationSec: dur,
      startTimeMs: start,
      endTimeMs: end,
      paused:false, pausedAtMs:null, accPauseMs:0
    }
  });
  publish(next);
}

export function skipCurrent(){ if (!state.currentSpeaker) return; const next = bump({ ...state, currentSpeaker: null }); publish(next); }

export function resetTimer(){
  if (!state.currentSpeaker) return;
  const dur = state.currentSpeaker.baseDurationSec || state.typeDurations[state.currentSpeaker.type] || 90;
  const start = nowMs();
  const next = bump({ ...state, currentSpeaker: { ...state.currentSpeaker, startTimeMs:start, endTimeMs:start+dur*1000, paused:false, pausedAtMs:null, accPauseMs:0 } });
  publish(next);
}

export function pauseTimer(){ const cur = state.currentSpeaker; if (!cur || cur.paused) return; const next = bump({ ...state, currentSpeaker: { ...cur, paused:true, pausedAtMs: nowMs() } }); publish(next); }
export function resumeTimer(){
  const cur = state.currentSpeaker; if (!cur || !cur.paused) return;
  const delta = Date.now() - (cur.pausedAtMs || Date.now());
  const next = bump({ ...state, currentSpeaker: { ...cur, paused:false, pausedAtMs:null, accPauseMs:(cur.accPauseMs||0)+delta, endTimeMs:(cur.endTimeMs||Date.now()) + delta } });
  publish(next);
}

// ---- Selectors / hooks helpers ----
export function getState(){ return state; }
export function subscribe(fn){ subs.add(fn); return () => subs.delete(fn); }
export function remainingSeconds(cur){
  if (!cur) return 0;
  if (cur.paused){ const untilPauseLeft = (cur.endTimeMs - cur.pausedAtMs)/1000; return Math.max(0, untilPauseLeft); }
  return Math.max(0, (cur.endTimeMs - Date.now())/1000);
}
export function normalizeType(t){
  const v = String(t||'').toLowerCase().trim();
  if (v.startsWith('inn')) return 'innlegg';
  if (v.startsWith('svar')) return 'svar_replikk';
  if (v.startsWith('rep')) return 'replikk';
  return 'innlegg';
}
