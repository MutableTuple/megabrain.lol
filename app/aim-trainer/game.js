"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playGo, playTick, playWin } from "../lib/sound";

const TARGETS_PER_ROUND = 30;
const MISS_PENALTY_MS = 500; // added to your time per miss
const DIFFICULTIES = [
  { id: "big",    label: "big",    radius: 42, elo: 800 },
  { id: "medium", label: "medium", radius: 30, elo: 1200 },
  { id: "small",  label: "small",  radius: 22, elo: 1600 },
  { id: "tiny",   label: "tiny",   radius: 16, elo: 2000 },
];

function loadBest(id) {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(`at-best-${id}`);
  return v ? Number(v) : null;
}
function saveBest(id, v) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`at-best-${id}`, String(v));
}

function verdict(msPerHit) {
  if (msPerHit < 350) return { text: "cracked", color: "#ffd166" };
  if (msPerHit < 450) return { text: "elite",   color: "#06d6a0" };
  if (msPerHit < 550) return { text: "sharp",   color: "#4cc9f0" };
  if (msPerHit < 700) return { text: "solid",   color: "#a8dadc" };
  if (msPerHit < 900) return { text: "getting there", color: "#c77dff" };
  return { text: "warming up", color: "#f4a261" };
}

export default function Game() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [phase, setPhase] = useState("lobby"); // lobby | countdown | playing | ended
  const [countdown, setCountdown] = useState(3);
  const [difficultyId, setDifficultyId] = useState("medium");
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [best, setBest] = useState(null);
  const [newBest, setNewBest] = useState(false);
  const [muted, setMutedState] = useState(false);

  const difficultyRef = useRef(difficultyId);
  const phaseRef = useRef(phase);
  useEffect(() => { difficultyRef.current = difficultyId; }, [difficultyId]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { setBest(loadBest(difficultyId)); }, [difficultyId]);
  useEffect(() => { setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  // canvas init
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = {
      w: 0, h: 0, dpr,
      target: null,      // {x, y, r, spawnedAt}
      pulse: 0,
      startedAt: 0,
      hitTimes: [],      // per-hit ms
    };
    stateRef.current = s;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      s.w = rect.width;
      s.h = rect.height;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    function loop(now) {
      draw(ctx, s, now);
      s.pulse *= 0.9;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  const spawnTarget = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    const d = DIFFICULTIES.find((x) => x.id === difficultyRef.current) || DIFFICULTIES[1];
    const pad = d.radius + 12;
    const x = pad + Math.random() * (s.w - pad * 2);
    const y = pad + Math.random() * (s.h - pad * 2);
    s.target = { x, y, r: d.radius, spawnedAt: performance.now() };
  }, []);

  const start = useCallback(() => {
    initAudio();
    const s = stateRef.current;
    if (!s) return;
    s.target = null;
    s.hitTimes = [];
    setHits(0);
    setMisses(0);
    setElapsed(0);
    setNewBest(false);
    setPhase("countdown");
    setCountdown(3);
  }, []);

  // countdown → playing
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      playGo();
      const s = stateRef.current;
      if (s) { s.startedAt = performance.now(); }
      setPhase("playing");
      spawnTarget();
      return;
    }
    playTick();
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [phase, countdown, spawnTarget]);

  // playing timer
  useEffect(() => {
    if (phase !== "playing") return;
    const s = stateRef.current;
    if (!s) return;
    const iv = setInterval(() => {
      setElapsed(performance.now() - s.startedAt);
    }, 50);
    return () => clearInterval(iv);
  }, [phase]);

  const finish = useCallback((totalHits, totalMisses, endedAt) => {
    const s = stateRef.current;
    if (!s) return;
    const raw = endedAt - s.startedAt;
    const penalized = raw + totalMisses * MISS_PENALTY_MS;
    setElapsed(penalized);
    setPhase("ended");
    const prev = loadBest(difficultyRef.current);
    if (prev == null || penalized < prev) {
      setNewBest(true);
      saveBest(difficultyRef.current, penalized);
      setBest(penalized);
      playWin();
    } else {
      playCorrect();
    }
  }, []);

  // click / tap
  const onPointerDown = useCallback((e) => {
    if (phase !== "playing") return;
    const rect = canvasRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const s = stateRef.current;
    if (!s || !s.target) return;
    const dx = px - s.target.x;
    const dy = py - s.target.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= s.target.r) {
      // HIT
      const now = performance.now();
      s.hitTimes.push(now - s.target.spawnedAt);
      s.pulse = 1;
      const newHits = hits + 1;
      setHits(newHits);
      playCorrect();
      if (newHits >= TARGETS_PER_ROUND) {
        s.target = null;
        finish(newHits, misses, now);
      } else {
        spawnTarget();
      }
    } else {
      // MISS
      setMisses((m) => m + 1);
      playWrong();
    }
  }, [phase, hits, misses, spawnTarget, finish]);

  const avgMs = hits > 0 ? (elapsed / hits) : 0;
  const currentDiff = DIFFICULTIES.find((d) => d.id === difficultyId) || DIFFICULTIES[1];

  return (
    <div className="relative w-full h-[100dvh] bg-[#0a0a12] text-white font-mono overflow-hidden select-none touch-none" style={{ touchAction: "none" }}>
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full ${phase === "playing" ? "cursor-crosshair" : ""}`}
        onPointerDown={(e) => { e.preventDefault(); onPointerDown(e); }}
      />

      {/* HUD during play */}
      {(phase === "playing" || phase === "countdown") && (
        <div className="pointer-events-none absolute top-0 inset-x-0 pt-3 sm:pt-5 flex justify-around text-sm font-mono z-10">
          <div className="text-center">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">time</div>
            <div className="text-2xl sm:text-3xl font-semibold tabular-nums">{(elapsed / 1000).toFixed(2)}s</div>
          </div>
          <div className="text-center">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">hits</div>
            <div className="text-2xl sm:text-3xl font-semibold tabular-nums">{hits}/{TARGETS_PER_ROUND}</div>
          </div>
          <div className="text-center">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">miss</div>
            <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-rose-400">{misses}</div>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {phase === "countdown" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="text-8xl sm:text-9xl font-semibold tabular-nums drop-shadow-[0_0_30px_rgba(76,201,240,0.6)]">
            {countdown === 0 ? "go" : countdown}
          </div>
        </div>
      )}

      {/* Lobby */}
      {phase === "lobby" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-6 z-20 overflow-y-auto py-8">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">aim trainer</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">🎯 pop {TARGETS_PER_ROUND}.</h1>
            <p className="text-white/60 max-w-sm mx-auto text-sm sm:text-base">
              click every target as fast as you can. miss = +{MISS_PENALTY_MS}ms penalty. best time wins.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="text-white/50 text-[10px] uppercase tracking-widest">target size</div>
            <div className="flex gap-2 flex-wrap justify-center">
              {DIFFICULTIES.map((d) => (
                <button key={d.id} type="button" onClick={() => setDifficultyId(d.id)}
                  className={`px-3 py-2 rounded-xl text-sm cursor-pointer touch-manipulation flex flex-col items-center min-w-[70px] ${
                    difficultyId === d.id ? "bg-white text-black" : "bg-white/10 text-white/60 hover:bg-white/15"
                  }`}>
                  <div className="font-medium">{d.label}</div>
                  <div className={`text-[10px] tabular-nums ${difficultyId === d.id ? "text-black/60" : "text-white/40"}`}>
                    ~{d.elo} feel
                  </div>
                </button>
              ))}
            </div>
          </div>

          {best != null && (
            <div className="text-white/50 text-sm">
              best on <span className="text-white">{currentDiff.label}</span>: {(best / 1000).toFixed(2)}s
              <span className="text-white/40"> ({Math.round(best / TARGETS_PER_ROUND)}ms/hit)</span>
            </div>
          )}

          <button type="button" onClick={start}
            className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
            start
          </button>
        </div>
      )}

      {/* Ended */}
      {phase === "ended" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl mb-1">🎯</div>
            {newBest && <div className="text-xs uppercase tracking-widest text-amber-300 mb-1">new best</div>}
            <div className="text-white/60 text-sm mb-1">time (with miss penalty)</div>
            <div className="text-5xl sm:text-6xl font-semibold tabular-nums mb-1" style={{ color: verdict(avgMs).color }}>
              {(elapsed / 1000).toFixed(2)}s
            </div>
            <div className="text-white/60 text-sm uppercase tracking-widest mb-4">
              {verdict(avgMs).text}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-6">
              <div className="bg-white/[0.03] rounded-lg py-2">
                <div className="text-white/40 uppercase text-[9px] tracking-widest">avg</div>
                <div className="text-white font-mono tabular-nums">{Math.round(avgMs)}ms</div>
              </div>
              <div className="bg-white/[0.03] rounded-lg py-2">
                <div className="text-white/40 uppercase text-[9px] tracking-widest">accuracy</div>
                <div className="text-white font-mono tabular-nums">{Math.round((hits / (hits + misses)) * 100) || 0}%</div>
              </div>
              <div className="bg-white/[0.03] rounded-lg py-2">
                <div className="text-white/40 uppercase text-[9px] tracking-widest">misses</div>
                <div className="text-white font-mono tabular-nums">{misses}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={start}
                className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                again
              </button>
              <button type="button" onClick={() => setPhase("lobby")}
                className="flex-1 py-3 rounded-full text-white/60 hover:text-white transition cursor-pointer touch-manipulation">
                back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function draw(ctx, s, now) {
  ctx.clearRect(0, 0, s.w, s.h);
  // background gradient
  const grad = ctx.createRadialGradient(s.w/2, s.h/2, 0, s.w/2, s.h/2, Math.max(s.w, s.h));
  grad.addColorStop(0, "rgba(30,40,80,0.35)");
  grad.addColorStop(1, "rgba(10,10,18,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s.w, s.h);

  // pulse (last-hit ripple)
  if (s.pulse > 0.02 && s.target === null) {
    // no ripple after last hit
  }

  const t = s.target;
  if (!t) return;
  const age = (now - t.spawnedAt);
  const grow = Math.min(1, age / 100); // small pop-in scale
  const r = t.r * (0.85 + grow * 0.15);

  // outer glow
  const glow = ctx.createRadialGradient(t.x, t.y, r * 0.3, t.x, t.y, r * 1.6);
  glow.addColorStop(0, "rgba(255,120,120,0.35)");
  glow.addColorStop(1, "rgba(255,120,120,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(t.x, t.y, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  // outer ring (red)
  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#e63946";
  ctx.fill();
  // middle ring (white)
  ctx.beginPath();
  ctx.arc(t.x, t.y, r * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = "#f5eedd";
  ctx.fill();
  // inner (red)
  ctx.beginPath();
  ctx.arc(t.x, t.y, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "#e63946";
  ctx.fill();
  // bullseye (white)
  ctx.beginPath();
  ctx.arc(t.x, t.y, r * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = "#f5eedd";
  ctx.fill();
}
