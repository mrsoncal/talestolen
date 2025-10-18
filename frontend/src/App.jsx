
import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

/**
 * Talestolen – Realtime Debate Timer (Controller + Display)
 * --------------------------------------------------------
 * - Works with a lightweight Socket.IO backend (no DB required).
 * - Controller edits state; Display mirrors instantly via websockets.
 * - Slots: INNLEGG, REPLIKK x2, SVAR_REPLIKK.
 * - Keyboard: Space=start/pause, R=reset, 1/2=select replikk, S=svar, N=next.
 *
 * ENV:
 *   VITE_RT_BASE = https://<your-render-backend>.onrender.com
 *
 * Styling expects TailwindCSS (CDN is fine in index.html).
 */

// ---- Socket connection ----
const RT_BASE = import.meta.env.VITE_RT_BASE || "https://your-backend.onrender.com";
const socket = io(RT_BASE, { transports: ["websocket"] });

/** Utility helpers */
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pad2 = (n) => String(n).padStart(2, "0");
const formatMMSS = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};

// ---- Countdown Hook (pure; NO socket calls here) ----
function useCountdown(initialSeconds, { onComplete } = {}) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const lastTickRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    let raf;
    const loop = () => {
      const now = performance.now();
      if (!lastTickRef.current) lastTickRef.current = now;
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setSeconds((prev) => {
        const next = prev - delta;
        if (next <= 0) {
          onComplete && onComplete();
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, onComplete]);

  const pause = () => setRunning(false);
  const toggle = () => setRunning((r) => !r);
  const reset = (to) => {
    setRunning(false);
    lastTickRef.current = null;
    setSeconds(to ?? initialSeconds);
  };

  return { seconds, running, pause, toggle, reset, setSeconds, setRunning, lastTickRef };
}

// ---- UI bits ----
function Badge({ children, tone = "default" }) {
  const map = {
    default: "bg-gray-100 text-gray-800",
    live: "bg-green-100 text-green-800",
    warn: "bg-yellow-100 text-yellow-800",
    danger: "bg-red-100 text-red-800",
    info: "bg-blue-100 text-blue-800",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[tone]}`}>{children}</span>;
}

function ControlButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-2 rounded-xl shadow-sm border text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:shadow transition"
    >
      {label}
    </button>
  );
}

function ProgressRing({ value, max, size = 180, stroke = 12, tone = "default" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = clamp(value / max, 0, 1);
  const dash = c * progress;
  const color =
    tone === "danger" ? "text-red-500" : tone === "warn" ? "text-yellow-500" : tone === "live" ? "text-blue-600" : "text-blue-600";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-gray-200" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        className={`fill-none stroke-current ${color}`}
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

// ---- Demo data (can be replaced with external queue) ----
const demoQueue = [
  {
    id: "a1",
    name: "Ola Nordmann",
    party: "Uavh.",
    topic: "Kommunebudsjett 2026",
    durations: { INNLEGG: 180, REPLIKK: 60, SVAR_REPLIKK: 30 },
    replikker: [null, null],
    svarReplikk: null,
  },
  {
    id: "b2",
    name: "Kari Nordmann",
    party: "Parti A",
    topic: "Samferdsel",
    durations: { INNLEGG: 180, REPLIKK: 60, SVAR_REPLIKK: 30 },
    replikker: [null, null],
    svarReplikk: null,
  },
];

export default function App() {
  // Mode (display hides controls)
  const isDisplayMode = new URLSearchParams(location.search).get("display") === "1";

  // Room join
  const [roomId, setRoomId] = useState(localStorage.getItem("talestolen.room") || "");

  // Queue & selection
  const [queue, setQueue] = useState(demoQueue);
  const [currentIdx, setCurrentIdx] = useState(0);
  const current = queue[currentIdx];

  // Active slot + which replikk slot is in focus
  const [activeSlot, setActiveSlot] = useState("INNLEGG"); // "INNLEGG" | "REPLIKK" | "SVAR_REPLIKK"
  const [selectedReplikkIndex, setSelectedReplikkIndex] = useState(0);

  // Durations derived
  const totalSeconds = current?.durations?.[activeSlot] ?? 1;

  // Timer
  const { seconds, running, toggle, reset, setSeconds, setRunning } = useCountdown(totalSeconds, {
    onComplete: () => {
      // auto-advance logic
      if (activeSlot === "INNLEGG") {
        const idx = (current?.replikker ?? []).findIndex((r) => r);
        if (idx >= 0) {
          setActiveSlot("REPLIKK");
          setSelectedReplikkIndex(idx);
          reset(current.durations.REPLIKK);
          setTimeout(push, 0);
        } else if (current?.svarReplikk) {
          setActiveSlot("SVAR_REPLIKK");
          reset(current.durations.SVAR_REPLIKK);
          setTimeout(push, 0);
        } else {
          gotoNextAndPush();
        }
      } else if (activeSlot === "REPLIKK") {
        const nextIdx = findNextReplikkIndex(current, selectedReplikkIndex + 1);
        if (nextIdx !== -1) {
          setSelectedReplikkIndex(nextIdx);
          reset(current.durations.REPLIKK);
          setTimeout(push, 0);
        } else if (current?.svarReplikk) {
          setActiveSlot("SVAR_REPLIKK");
          reset(current.durations.SVAR_REPLIKK);
          setTimeout(push, 0);
        } else {
          gotoNextAndPush();
        }
      } else if (activeSlot === "SVAR_REPLIKK") {
        gotoNextAndPush();
      }
    },
  });

  function findNextReplikkIndex(item, fromIdx = 0) {
    if (!item) return -1;
    for (let i = fromIdx; i < 2; i++) if (item.replikker[i]) return i;
    return -1;
  }

  // Progress/tone
  const progress = useMemo(() => 1 - clamp(seconds / totalSeconds, 0, 1), [seconds, totalSeconds]);
  const tone = seconds === 0 ? "danger" : seconds <= 10 ? "warn" : running ? "live" : "default";

  // ---- Build/apply realtime payloads ----
  function buildState() {
    return {
      activeSlot,
      selectedReplikkIndex,
      secondsRemaining: Math.round(seconds),
      totalSeconds,
      running,
      current: current
        ? {
            id: current.id,
            name: current.name,
            party: current.party,
            topic: current.topic,
            replikker: [current.replikker[0] || null, current.replikker[1] || null],
            svarReplikk: current.svarReplikk || null,
          }
        : null,
    };
  }

  function applyIncomingState(st) {
    if (!st) return;
    setActiveSlot(st.activeSlot);
    setSelectedReplikkIndex(st.selectedReplikkIndex ?? 0);
    setSeconds(st.secondsRemaining ?? seconds);
    setRunning(!!st.running);
    // We keep totalSeconds derived from local durations.
    // For display-only sessions, this is fine; for perfect parity you could setSeconds and also override durations if sent.
  }

  const push = () => {
    if (roomId && socket?.connected) {
      socket.emit("state:push", { roomId, state: buildState() });
    }
  };

  const toggleAndPush = () => {
    toggle();
    setTimeout(push, 0);
  };
  const resetAndPush = (to) => {
    reset(to);
    setTimeout(push, 0);
  };
  const gotoNext = () => {
    setActiveSlot("INNLEGG");
    setSelectedReplikkIndex(0);
    setCurrentIdx((i) => (i + 1 >= queue.length ? i : i + 1));
  };
  const gotoNextAndPush = () => {
    gotoNext();
    setTimeout(push, 0);
  };

  // ---- Room join on connect ----
  useEffect(() => {
    if (!roomId) return;
    const join = () => socket.emit("join", roomId);
    if (socket.connected) join();
    else socket.on("connect", join);
    return () => socket.off("connect", join);
  }, [roomId]);

  // ---- Listen for incoming updates ----
  useEffect(() => {
    const onSync = (st) => applyIncomingState(st);
    const onUpdate = (st) => applyIncomingState(st);
    socket.on("state:sync", onSync);
    socket.on("state:update", onUpdate);
    return () => {
      socket.off("state:sync", onSync);
      socket.off("state:update", onUpdate);
    };
  }, []);

  // ---- Periodic push while running for smoothness ----
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => push(), 300);
    return () => clearInterval(t);
  }, [running, seconds, activeSlot, selectedReplikkIndex, totalSeconds, roomId]);

  // ---- Keyboard shortcuts + push ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        toggleAndPush();
      } else if (e.key.toLowerCase() === "r") {
        resetAndPush(totalSeconds);
      } else if (e.key === "1") {
        setActiveSlot("REPLIKK");
        setSelectedReplikkIndex(0);
        resetAndPush(current?.durations?.REPLIKK ?? 60);
      } else if (e.key === "2") {
        setActiveSlot("REPLIKK");
        setSelectedReplikkIndex(1);
        resetAndPush(current?.durations?.REPLIKK ?? 60);
      } else if (e.key.toLowerCase() === "s") {
        setActiveSlot("SVAR_REPLIKK");
        resetAndPush(current?.durations?.SVAR_REPLIKK ?? 30);
      } else if (e.key.toLowerCase() === "n") {
        gotoNextAndPush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAndPush, resetAndPush, totalSeconds, current, gotoNextAndPush]);

  // ---- Edit helpers ----
  const updateDuration = (slot, secs) => {
    setQueue((q) => {
      const copy = structuredClone(q);
      if (!copy[currentIdx]) return q;
      copy[currentIdx].durations[slot] = clamp(Number(secs) || 0, 5, 1200);
      return copy;
    });
    if (slot === activeSlot) {
      resetAndPush(clamp(Number(secs) || 0, 5, 1200));
    } else {
      push();
    }
  };

  const setReplikk = (idx, value) => {
    setQueue((q) => {
      const copy = structuredClone(q);
      copy[currentIdx].replikker[idx] = value;
      return copy;
    });
    push();
  };
  const setSvarReplikk = (value) => {
    setQueue((q) => {
      const copy = structuredClone(q);
      copy[currentIdx].svarReplikk = value;
      return copy;
    });
    push();
  };

  // ---- UI helpers ----
  const Card = ({ children, highlight = false }) => (
    <div className={`rounded-2xl p-4 shadow-sm border bg-white ${highlight ? "ring-2 ring-blue-500" : ""}`}>{children}</div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Talestolen – Realtime</h1>
          <div className="ml-4 flex items-center gap-2">
            <input
              className="px-2 py-1 border rounded text-sm"
              placeholder="Room…"
              value={roomId}
              onChange={(e) => {
                const v = e.target.value.trim();
                setRoomId(v);
                if (v) localStorage.setItem("talestolen.room", v);
              }}
            />
            {!isDisplayMode && <Badge tone={running ? "live" : seconds === 0 ? "danger" : "default"}>
              {running ? "LIVE" : seconds === 0 ? "TIDEN UTE" : "KLAR"}
            </Badge>}
            <Badge>{activeSlot === "INNLEGG" ? "Innlegg" : activeSlot === "REPLIKK" ? `Replikk #${selectedReplikkIndex + 1}` : "Svar‑replikk"}</Badge>
          </div>
          <div className="ml-auto text-xs text-slate-500">Space=start/pause · R=reset · 1/2=replikk · S=svar · N=Neste</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-3 gap-6">
        {/* LEFT: Current & Timer */}
        <section className="lg:col-span-2 space-y-4">
          <Card highlight>
            {current ? (
              <div className="grid md:grid-cols-[220px,1fr] gap-6 items-center">
                <div className="text-center">
                  <div className="text-sm text-slate-500 mb-1">Taler</div>
                  <div className="text-xl font-semibold">{current.name}</div>
                  <div className="text-sm text-slate-500">{current.party}</div>
                </div>

                <div className="grid md:grid-cols-[220px,1fr] gap-6 items-center">
                  <div className="flex flex-col items-center">
                    <div className="text-sm text-slate-500">Tema</div>
                    <div className="font-medium text-center">{current.topic}</div>
                    <div className="mt-4 relative">
                      <ProgressRing value={seconds} max={totalSeconds} tone={tone} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className={`text-4xl font-mono tabular-nums ${tone === "danger" ? "text-red-600" : ""}`}>{formatMMSS(seconds)}</div>
                      </div>
                    </div>
                    {!isDisplayMode && (
                      <div className="mt-3 flex gap-2">
                        <ControlButton label={running ? "Pause" : "Start"} onClick={toggleAndPush} />
                        <ControlButton label="Reset" onClick={() => resetAndPush(totalSeconds)} />
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mt-2">{isDisplayMode ? "Display mode" : "Space: start/pause · R: reset"}</div>
                  </div>

                  {!isDisplayMode && (
                    <div className="space-y-4">
                      {/* Duration inputs */}
                      <div className="grid grid-cols-3 gap-3">
                        {["INNLEGG", "REPLIKK", "SVAR_REPLIKK"].map((k) => (
                          <label key={k} className={`p-3 rounded-xl border ${activeSlot === k ? "ring-2 ring-blue-500" : ""}`}>
                            <div className="text-xs text-slate-500 mb-1">
                              {k === "INNLEGG" ? "Innlegg" : k === "REPLIKK" ? "Replikk" : "Svar‑replikk"}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={5}
                                max={1200}
                                className="w-20 px-2 py-1 rounded border"
                                value={current.durations[k]}
                                onChange={(e) => updateDuration(k, e.target.value)}
                              />
                              <span className="text-sm">sek</span>
                              <button
                                type="button"
                                className="ml-auto text-xs underline"
                                onClick={() => {
                                  setActiveSlot(k);
                                  resetAndPush(current.durations[k]);
                                }}
                              >
                                Bruk
                              </button>
                            </div>
                          </label>
                        ))}
                      </div>

                      {/* Replies editor */}
                      <div className="grid md:grid-cols-2 gap-3">
                        {[0, 1].map((i) => (
                          <div
                            key={i}
                            className={`p-3 rounded-xl border ${
                              activeSlot === "REPLIKK" && selectedReplikkIndex === i ? "ring-2 ring-blue-500" : ""
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">Replikk #{i + 1}</div>
                              <div className="flex gap-2 items-center">
                                <button
                                  type="button"
                                  className="text-xs underline"
                                  onClick={() => {
                                    setActiveSlot("REPLIKK");
                                    setSelectedReplikkIndex(i);
                                    resetAndPush(current.durations.REPLIKK);
                                  }}
                                >
                                  Tidsstyr
                                </button>
                                {current.replikker[i] && <Badge tone="info">klar</Badge>}
                              </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <input
                                className="px-2 py-1 rounded border"
                                placeholder="Navn"
                                value={current.replikker[i]?.name || ""}
                                onChange={(e) => setReplikk(i, { ...(current.replikker[i] || {}), name: e.target.value })}
                              />
                              <input
                                className="px-2 py-1 rounded border"
                                placeholder="Parti/rolle"
                                value={current.replikker[i]?.party || ""}
                                onChange={(e) => setReplikk(i, { ...(current.replikker[i] || {}), party: e.target.value })}
                              />
                            </div>
                          </div>
                        ))}

                        {/* Svar-replikk */}
                        <div className={`p-3 rounded-xl border ${activeSlot === "SVAR_REPLIKK" ? "ring-2 ring-blue-500" : ""}`}>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">Svar‑replikk (fra {current.name})</div>
                            <div className="flex gap-2 items-center">
                              <button
                                type="button"
                                className="text-xs underline"
                                onClick={() => {
                                  setActiveSlot("SVAR_REPLIKK");
                                  resetAndPush(current.durations.SVAR_REPLIKK);
                                }}
                              >
                                Tidsstyr
                              </button>
                              {current.svarReplikk && <Badge tone="info">klar</Badge>}
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <input
                              className="px-2 py-1 rounded border"
                              placeholder="Navn (auto: taler)"
                              value={current.svarReplikk?.name ?? current.name}
                              onChange={(e) => setSvarReplikk({ ...(current.svarReplikk || {}), name: e.target.value })}
                            />
                            <input
                              className="px-2 py-1 rounded border"
                              placeholder="Parti/rolle"
                              value={current.svarReplikk?.party ?? current.party}
                              onChange={(e) => setSvarReplikk({ ...(current.svarReplikk || {}), party: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-slate-500">Ingen talere i køen.</div>
            )}
          </Card>

          {/* Stage View */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Scenervisning</div>
              <div className="text-xs text-slate-500">Trykk på elementer for å markere</div>
            </div>
            {current && (
              <div className="grid md:grid-cols-3 gap-4">
                <div className={`rounded-2xl p-4 border ${activeSlot === "INNLEGG" ? "bg-blue-50 border-blue-300" : "bg-slate-50"}`}>
                  <div className="text-xs text-slate-500 mb-1">Innlegg</div>
                  <div className="text-lg font-medium">{current.name}</div>
                  <div className="text-sm text-slate-500">{current.party}</div>
                </div>
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className={`rounded-2xl p-4 border ${
                      activeSlot === "REPLIKK" && selectedReplikkIndex === i ? "bg-blue-50 border-blue-300" : "bg-slate-50"
                    }`}
                  >
                    <div className="text-xs text-slate-500 mb-1">Replikk #{i + 1}</div>
                    <div className="text-lg font-medium">{current.replikker[i]?.name || "—"}</div>
                    <div className="text-sm text-slate-500">{current.replikker[i]?.party || ""}</div>
                  </div>
                ))}
                <div className={`rounded-2xl p-4 border ${activeSlot === "SVAR_REPLIKK" ? "bg-blue-50 border-blue-300" : "bg-slate-50"}`}>
                  <div className="text-xs text-slate-500 mb-1">Svar‑replikk</div>
                  <div className="text-lg font-medium">{current.svarReplikk?.name || current.name}</div>
                  <div className="text-sm text-slate-500">{current.svarReplikk?.party || current.party}</div>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* RIGHT: Queue & Add */}
        {!isDisplayMode && (
          <aside className="space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold">Kø</div>
                <div className="text-xs text-slate-500">N: neste</div>
              </div>
              <ol className="space-y-2">
                {queue.map((p, i) => (
                  <li key={p.id}>
                    <button
                      className={`w-full text-left p-3 rounded-xl border hover:shadow transition ${
                        i === currentIdx ? "bg-white ring-2 ring-blue-500" : "bg-slate-50"
                      }`}
                      onClick={() => {
                        setCurrentIdx(i);
                        setActiveSlot("INNLEGG");
                        setTimeout(push, 0);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-slate-500">
                            {p.party} • {p.topic}
                          </div>
                        </div>
                        {i === currentIdx ? <Badge tone="live">nå</Badge> : <Badge>vent</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <div className="text-lg font-semibold mb-3">Legg til taler</div>
              <SpeakerForm onAdd={(entry) => setQueue((q) => [...q, entry])} />
            </Card>
          </aside>
        )}
      </main>

      <footer className="py-6 text-center text-xs text-slate-500">
        ⏱️ Space=start/pause · R=reset · 1/2=velg replikk · S=svar · N=Neste {isDisplayMode ? "· Display modus" : ""}
      </footer>
    </div>
  );
}

function SpeakerForm({ onAdd }) {
  const [name, setName] = useState("");
  const [party, setParty] = useState("");
  const [topic, setTopic] = useState("");
  const [innlegg, setInnlegg] = useState(180);
  const [replikk, setReplikk] = useState(60);
  const [svar, setSvar] = useState(30);

  const submit = (e) => {
    e.preventDefault();
    const entry = {
      id: crypto.randomUUID(),
      name,
      party,
      topic,
      durations: { INNLEGG: Number(innlegg), REPLIKK: Number(replikk), SVAR_REPLIKK: Number(svar) },
      replikker: [null, null],
      svarReplikk: null,
    };
    onAdd(entry);
    setName(""); setParty(""); setTopic("");
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input className="px-2 py-2 rounded border" placeholder="Navn" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="px-2 py-2 rounded border" placeholder="Parti/rolle" value={party} onChange={(e) => setParty(e.target.value)} />
      </div>
      <input className="w-full px-2 py-2 rounded border" placeholder="Tema/innlegg" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs">Innlegg (sek)
          <input type="number" min={5} max={1200} className="w-full px-2 py-1 rounded border" value={innlegg} onChange={(e) => setInnlegg(e.target.value)} />
        </label>
        <label className="text-xs">Replikk (sek)
          <input type="number" min={5} max={1200} className="w-full px-2 py-1 rounded border" value={replikk} onChange={(e) => setReplikk(e.target.value)} />
        </label>
        <label className="text-xs">Svar‑replikk (sek)
          <input type="number" min={5} max={1200} className="w-full px-2 py-1 rounded border" value={svar} onChange={(e) => setSvar(e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end">
        <button className="px-3 py-2 rounded-xl shadow-sm border text-sm hover:shadow">Legg til</button>
      </div>
    </form>
  );
}
