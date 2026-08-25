"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ROUNDS = 5;

function loadBest() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem("rt-best-avg");
  return v ? Number(v) : null;
}
function saveBest(v) {
  if (typeof window === "undefined") return;
  localStorage.setItem("rt-best-avg", String(v));
}

function verdict(ms) {
  if (ms < 180) return { text: "inhuman", color: "#ffd166" };
  if (ms < 220) return { text: "elite", color: "#06d6a0" };
  if (ms < 270) return { text: "sharp", color: "#4cc9f0" };
  if (ms < 330) return { text: "average", color: "#a8dadc" };
  if (ms < 400) return { text: "casual", color: "#c77dff" };
  return { text: "sleepy", color: "#f4a261" };
}

export default function Game() {
  // phase: idle | waiting | go | result | finished | early
  const [phase, setPhase] = useState("idle");
  const [round, setRound] = useState(0);
  const [times, setTimes] = useState([]);
  const [current, setCurrent] = useState(null);
  const [best, setBest] = useState(null);
  const [newBest, setNewBest] = useState(false);

  const startedAtRef = useRef(0);
  const timeoutRef = useRef(null);

  useEffect(() => { setBest(loadBest()); }, []);

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const armRound = useCallback(() => {
    setPhase("waiting");
    setCurrent(null);
    const delay = 1200 + Math.random() * 2800;
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      setPhase("go");
      startedAtRef.current = performance.now();
    }, delay);
  }, []);

  const startMatch = useCallback(() => {
    setTimes([]);
    setRound(0);
    setCurrent(null);
    setNewBest(false);
    armRound();
  }, [armRound]);

  const onHit = useCallback(() => {
    if (phase === "idle" || phase === "finished") {
      startMatch();
      return;
    }
    if (phase === "waiting") {
      // clicked too early
      clearTimer();
      setPhase("early");
      return;
    }
    if (phase === "early") {
      armRound();
      return;
    }
    if (phase === "go") {
      const ms = performance.now() - startedAtRef.current;
      const nextTimes = [...times, ms];
      const nextRound = round + 1;
      setCurrent(ms);
      setTimes(nextTimes);
      setRound(nextRound);
      if (nextRound >= ROUNDS) {
        const avg = nextTimes.reduce((s, v) => s + v, 0) / nextTimes.length;
        const prev = loadBest();
        if (prev == null || avg < prev) {
          saveBest(avg);
          setBest(avg);
          setNewBest(true);
        }
        setPhase("finished");
      } else {
        setPhase("result");
      }
      return;
    }
    if (phase === "result") {
      armRound();
      return;
    }
  }, [phase, round, times, armRound, startMatch]);

  // spacebar
  useEffect(() => {
    const on = (e) => {
      if (e.code === "Space" || e.key === " ") { e.preventDefault(); onHit(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onHit]);

  useEffect(() => () => clearTimer(), []);

  const bgColor =
    phase === "waiting" ? "#7f1d1d" :
    phase === "go" ? "#065f46" :
    phase === "early" ? "#3f0d0d" :
    "#0a0a12";

  const avg =
    times.length > 0 ? times.reduce((s, v) => s + v, 0) / times.length : null;

  return (
    <div
      className="relative w-full h-[100dvh] text-white font-mono overflow-hidden select-none touch-none transition-colors duration-150"
      style={{ background: bgColor, touchAction: "none" }}
      onPointerDown={(e) => { e.preventDefault(); onHit(); }}
    >
      {/* stats top-right */}
      <div className="pointer-events-none absolute top-0 right-0 p-4 sm:p-6 text-right text-sm space-y-1">
        <div className="text-white/50 uppercase tracking-widest text-[10px]">Reaction Time</div>
        <StatLine label="round" value={`${Math.min(round + (phase === "go" || phase === "waiting" || phase === "early" ? 1 : 0), ROUNDS)}/${ROUNDS}`} />
        <StatLine label="best avg" value={best != null ? Math.round(best) + "ms" : "—"} />
      </div>

      {/* content center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center pointer-events-none">
        {phase === "idle" && (
          <>
            <div className="text-4xl sm:text-6xl font-semibold tracking-tight mb-3">reaction time</div>
            <div className="text-white/60 max-w-md mb-6">
              wait for <span className="text-emerald-400">green</span>. click as fast as you can.
              best of {ROUNDS} averaged.
            </div>
            <div className="text-white/50 text-sm">click anywhere to begin</div>
          </>
        )}

        {phase === "waiting" && (
          <>
            <div className="text-2xl sm:text-3xl text-white/80 mb-2">wait…</div>
            <div className="text-white/50 text-sm">don't click yet</div>
          </>
        )}

        {phase === "go" && (
          <>
            <div className="text-6xl sm:text-8xl font-semibold tracking-tight">CLICK!</div>
          </>
        )}

        {phase === "early" && (
          <>
            <div className="text-3xl sm:text-5xl font-semibold tracking-tight mb-2">too early</div>
            <div className="text-white/70">tap to try that round again</div>
          </>
        )}

        {phase === "result" && current != null && (
          <>
            <div
              className="text-6xl sm:text-8xl font-semibold tabular-nums tracking-tight mb-1"
              style={{ color: verdict(current).color }}
            >
              {Math.round(current)}ms
            </div>
            <div className="text-white/60 text-sm uppercase tracking-widest mb-6">
              {verdict(current).text}
            </div>
            <div className="text-white/40 text-xs mb-4">tap for the next round</div>
            <RoundDots times={times} total={ROUNDS} />
          </>
        )}

        {phase === "finished" && avg != null && (
          <>
            {newBest && (
              <div className="text-xs uppercase tracking-widest font-mono animate-pulse mb-2"
                   style={{ color: verdict(avg).color }}>
                new best
              </div>
            )}
            <div className="text-white/60 text-sm uppercase tracking-widest mb-1">
              average
            </div>
            <div
              className="text-7xl sm:text-9xl font-semibold tabular-nums tracking-tight mb-1"
              style={{ color: verdict(avg).color }}
            >
              {Math.round(avg)}ms
            </div>
            <div className="text-white/60 text-sm uppercase tracking-widest mb-6">
              {verdict(avg).text}
            </div>
            <RoundDots times={times} total={ROUNDS} />
            <div className="text-white/40 text-xs mt-6">tap anywhere to play again</div>
          </>
        )}
      </div>
    </div>
  );
}

function StatLine({ label, value }) {
  return (
    <div className="flex items-baseline justify-end gap-2">
      <span className="text-white/40 text-[10px] uppercase tracking-widest">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function RoundDots({ times, total }) {
  const items = Array.from({ length: total }, (_, i) => times[i]);
  return (
    <div className="flex items-center gap-3 justify-center">
      {items.map((t, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <div
            className={`w-3 h-3 rounded-full ${t != null ? "" : "bg-white/10"}`}
            style={t != null ? { background: verdict(t).color } : undefined}
          />
          <div className="text-[10px] text-white/40 tabular-nums font-mono h-3">
            {t != null ? Math.round(t) : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
