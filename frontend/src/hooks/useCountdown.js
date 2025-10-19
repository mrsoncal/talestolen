import { useEffect, useMemo, useRef, useState } from "react";

/**
 * useCountdown
 * Source of truth is: baseMs, startedAt (ms), running, pausedAccumMs (ms)
 * It returns live-updating remaining time while running, and a frozen value while paused/stopped.
 */
export default function useCountdown({
  baseMs,          // total allotted time (e.g., 60_000)
  startedAt,       // timestamp (ms) when started (or last resumed)
  running,         // boolean: true = ticking
  pausedAccumMs=0, // total time (ms) spent paused so far
}) {
  const [now, setNow] = useState(() => Date.now());
  const lastFormattedRef = useRef("—"); // so UI remains stable while paused

  // tick only while running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // compute how much time has elapsed since first start, excluding pauses
  const elapsedMs = useMemo(() => {
    if (!startedAt) return 0;
    // If running, include live delta from startedAt; if paused/stopped, no live delta
    const live = running ? Math.max(0, now - startedAt) : 0;
    return pausedAccumMs + live;
  }, [now, startedAt, pausedAccumMs, running]);

  const remainingMs = useMemo(() => {
    if (baseMs == null) return null;
    return Math.max(0, baseMs - elapsedMs);
  }, [baseMs, elapsedMs]);

  const formatted = useMemo(() => {
    if (remainingMs == null) return "—";
    const total = Math.floor(remainingMs / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const hh = h > 0 ? String(h).padStart(2, "0") + ":" : "";
    return hh + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }, [remainingMs]);

  // while paused, freeze on last value so it doesn't jump due to state churn
  useEffect(() => {
    if (running) {
      lastFormattedRef.current = formatted;
    }
  }, [formatted, running]);

  return {
    remainingMs,
    remainingSec: remainingMs == null ? null : Math.floor(remainingMs / 1000),
    formatted: running ? formatted : lastFormattedRef.current,
    isFinished: remainingMs === 0,
  };
}
