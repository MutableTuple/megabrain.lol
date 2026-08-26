"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initAudio, isMuted, setMuted, playDrop, playMerge, playLose } from "../lib/sound";

const FRUITS = [
  { r: 14, color: "#ff5c8a", emoji: "🍒" },   // 0 cherry
  { r: 20, color: "#ef476f", emoji: "🍓" },   // 1 strawberry
  { r: 27, color: "#c77dff", emoji: "🍇" },   // 2 grape
  { r: 34, color: "#ff9a1f", emoji: "🍊" },   // 3 orange
  { r: 42, color: "#e63946", emoji: "🍎" },   // 4 apple
  { r: 52, color: "#f4a261", emoji: "🍑" },   // 5 peach
  { r: 63, color: "#ffd166", emoji: "🍍" },   // 6 pineapple
  { r: 75, color: "#8ecae6", emoji: "🍈" },   // 7 melon
  { r: 92, color: "#2a9d8f", emoji: "🍉" },   // 8 watermelon (win)
];

const MAX_TIER = FRUITS.length - 1;
const SPAWN_TIERS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3]; // weighted random
const GRAVITY = 0.55;
const DAMPING = 0.995;
const REST = 0.15; // bounciness
const DROP_COOLDOWN_MS = 380;
const DANGER_GRACE_MS = 900;

function loadBest() {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem("fm-best");
  return v ? Number(v) : 0;
}
function saveBest(v) {
  if (typeof window === "undefined") return;
  localStorage.setItem("fm-best", String(v));
}

class Fruit {
  constructor(tier, x, y) {
    const def = FRUITS[tier];
    this.tier = tier;
    this.r = def.r;
    this.color = def.color;
    this.emoji = def.emoji;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.mass = def.r * def.r;
    this.dead = false;
    this.mergePulse = 0;
    this.aboveDangerSince = 0;
    this.bornAt = performance.now();
  }
}

function pickSpawnTier() {
  return SPAWN_TIERS[Math.floor(Math.random() * SPAWN_TIERS.length)];
}

export default function Game() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState("lobby"); // lobby | playing | ended
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [nextTier, setNextTier] = useState(0);
  const [afterTier, setAfterTier] = useState(0);
  const [muted, setMutedState] = useState(false);

  const phaseRef = useRef(phase);
  const nextTierRef = useRef(0);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { nextTierRef.current = nextTier; }, [nextTier]);

  useEffect(() => { setBest(loadBest()); setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  // layout
  const layout = useCallback(() => {
    const g = gameRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.w = rect.width;
    g.h = rect.height;
    // container: centered, portrait
    const availH = g.h - 100; // leave space for HUD
    const contH = Math.min(720, availH * 0.9);
    const contW = Math.min(420, Math.min(g.w * 0.9, contH * 0.62));
    g.container.w = contW;
    g.container.h = contH;
    g.container.x = (g.w - contW) / 2;
    g.container.y = (g.h - contH) / 2 + 20;
    g.dangerY = g.container.y + 60;
  }, []);

  // init runtime
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const g = {
      w: 0, h: 0,
      container: { x: 0, y: 0, w: 320, h: 560 },
      dangerY: 0,
      fruits: [],
      merges: [], // {x, y, tier, life, size}
      cursorX: 0,
      lastDropAt: 0,
      dangerTimer: 0,
    };
    gameRef.current = g;
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);

    let raf = 0;
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      if (phaseRef.current === "playing") step(g, dt, now);
      draw(ctx, g, now, phaseRef.current, nextTierRef.current);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [layout]);

  const start = useCallback(() => {
    initAudio();
    const g = gameRef.current;
    if (!g) return;
    g.fruits = [];
    g.merges = [];
    g.lastDropAt = 0;
    g.dangerTimer = 0;
    setScore(0);
    setNextTier(pickSpawnTier());
    setAfterTier(pickSpawnTier());
    setPhase("playing");
  }, []);

  const doGameOver = useCallback(() => {
    setPhase("ended");
    playLose();
    setScore((s) => {
      const b = loadBest();
      if (s > b) { saveBest(s); setBest(s); }
      return s;
    });
  }, []);

  // physics step
  const step = useCallback((g, dt, now) => {
    const cont = g.container;
    // gravity + integrate
    for (const f of g.fruits) {
      if (f.dead) continue;
      f.vy += GRAVITY * dt;
      f.vx *= DAMPING;
      f.vy *= DAMPING;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.mergePulse *= 0.9;
    }
    // constraints + collisions (multiple iterations)
    const ITERS = 6;
    for (let it = 0; it < ITERS; it++) {
      // walls
      for (const f of g.fruits) {
        if (f.dead) continue;
        if (f.x - f.r < cont.x) { f.x = cont.x + f.r; if (f.vx < 0) f.vx *= -REST; }
        if (f.x + f.r > cont.x + cont.w) { f.x = cont.x + cont.w - f.r; if (f.vx > 0) f.vx *= -REST; }
        if (f.y + f.r > cont.y + cont.h) {
          f.y = cont.y + cont.h - f.r;
          if (f.vy > 0) f.vy *= -REST;
          if (Math.abs(f.vy) < 0.4) f.vy = 0;
        }
      }
      // pairs
      for (let i = 0; i < g.fruits.length; i++) {
        const a = g.fruits[i];
        if (a.dead) continue;
        for (let j = i + 1; j < g.fruits.length; j++) {
          const b = g.fruits[j];
          if (b.dead) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minD = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD) continue;
          const d = Math.sqrt(d2) || 0.0001;
          // merge if same tier
          if (a.tier === b.tier && a.tier < MAX_TIER && it === 0) {
            const nt = a.tier + 1;
            const nx = (a.x + b.x) / 2;
            const ny = (a.y + b.y) / 2;
            const newF = new Fruit(nt, nx, ny);
            // inherit some velocity
            newF.vx = (a.vx + b.vx) / 2;
            newF.vy = (a.vy + b.vy) / 2;
            newF.mergePulse = 1;
            a.dead = true;
            b.dead = true;
            g.fruits.push(newF);
            g.merges.push({ x: nx, y: ny, tier: nt, life: 24, size: FRUITS[nt].r });
            // score
            setScore((s) => s + (nt + 1) * 2);
            playMerge(nt);
            // win check: max tier reached
            if (nt === MAX_TIER) {
              // small celebration but game keeps going
            }
            continue;
          }
          if (a.tier === b.tier && it === 0) {
            // both same at max tier — just resolve
          }
          const overlap = minD - d;
          const nx2 = dx / d;
          const ny2 = dy / d;
          const totalM = a.mass + b.mass;
          const aShare = b.mass / totalM;
          const bShare = a.mass / totalM;
          a.x -= nx2 * overlap * aShare;
          a.y -= ny2 * overlap * aShare;
          b.x += nx2 * overlap * bShare;
          b.y += ny2 * overlap * bShare;
          // relative velocity along normal
          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx2 + rvy * ny2;
          if (vn < 0) {
            const jj = -(1 + REST) * vn / (1 / a.mass + 1 / b.mass);
            const jx = jj * nx2;
            const jy = jj * ny2;
            a.vx -= jx / a.mass;
            a.vy -= jy / a.mass;
            b.vx += jx / b.mass;
            b.vy += jy / b.mass;
          }
        }
      }
    }
    // clear dead
    g.fruits = g.fruits.filter((f) => !f.dead);

    // decay merge splashes
    for (const m of g.merges) m.life -= dt;
    g.merges = g.merges.filter((m) => m.life > 0);

    // danger check: any fruit whose top is above danger line for a while?
    const dangerActive = g.fruits.some((f) => {
      if (now - f.bornAt < 800) return false; // grace period
      // ignore fast-moving
      if (Math.hypot(f.vx, f.vy) > 2) return false;
      return f.y - f.r < g.dangerY;
    });
    if (dangerActive) g.dangerTimer += dt * (16.67 / 1000) * 1000; // dt is in ~frames, convert to ms
    else g.dangerTimer = Math.max(0, g.dangerTimer - dt * 8);
    if (g.dangerTimer > DANGER_GRACE_MS) doGameOver();
  }, [doGameOver]);

  const dropFruit = useCallback((clientX) => {
    const g = gameRef.current;
    if (!g || phaseRef.current !== "playing") return;
    const now = performance.now();
    if (now - g.lastDropAt < DROP_COOLDOWN_MS) return;
    g.lastDropAt = now;
    const rect = canvasRef.current.getBoundingClientRect();
    let x = clientX - rect.left;
    const def = FRUITS[nextTier];
    x = Math.max(g.container.x + def.r + 1, Math.min(g.container.x + g.container.w - def.r - 1, x));
    const f = new Fruit(nextTier, x, g.container.y + def.r + 6);
    g.fruits.push(f);
    playDrop();
    // rotate queue
    setNextTier(afterTier);
    setAfterTier(pickSpawnTier());
  }, [nextTier, afterTier]);

  const onPointerMove = useCallback((e) => {
    const g = gameRef.current;
    if (!g) return;
    const rect = canvasRef.current.getBoundingClientRect();
    g.cursorX = e.clientX - rect.left;
  }, []);
  const onPointerUp = useCallback((e) => {
    if (phaseRef.current !== "playing") return;
    dropFruit(e.clientX);
  }, [dropFruit]);
  const onPointerDown = useCallback((e) => {
    const g = gameRef.current;
    if (!g) return;
    const rect = canvasRef.current.getBoundingClientRect();
    g.cursorX = e.clientX - rect.left;
  }, []);

  const gameOver = useCallback(() => setPhase("lobby"), []);

  return (
    <div
      className="relative w-full h-[100dvh] bg-[#0a0a12] text-white font-mono overflow-hidden select-none touch-none"
      style={{ touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* mute */}
      <button
        type="button"
        onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* HUD */}
      {(phase === "playing" || phase === "ended") && (
        <div className="pointer-events-none absolute top-0 inset-x-0 p-4 sm:p-6 flex justify-between items-start z-10">
          <div>
            <div className="text-white/40 uppercase tracking-widest text-[10px]">score</div>
            <div className="text-3xl sm:text-4xl font-semibold tabular-nums">{score}</div>
          </div>
          <div className="text-right pr-8 sm:pr-12">
            <div className="text-white/40 uppercase tracking-widest text-[10px]">next</div>
            <div className="flex items-center gap-2 justify-end">
              <div className="text-2xl leading-none">{FRUITS[nextTier].emoji}</div>
              <div className="text-white/40 text-xl leading-none">→</div>
              <div className="text-lg leading-none opacity-60">{FRUITS[afterTier].emoji}</div>
            </div>
            <div className="text-white/40 text-[10px] mt-1">best {best}</div>
          </div>
        </div>
      )}

      {/* tap area only during play */}
      {phase === "playing" && (
        <div
          className="absolute inset-0 z-0 cursor-crosshair"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        />
      )}

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-6 z-20">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">fruit merge</div>
            <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">
              🍒 → 🍉
            </h1>
            <p className="text-white/60 max-w-sm mx-auto">
              drop fruits. same fruits merge into the next. don't overflow the box.
            </p>
          </div>
          {best > 0 && (
            <div className="text-white/50 text-sm">best score <span className="text-white font-semibold">{best}</span></div>
          )}
          <button
            type="button"
            onClick={start}
            className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
          >
            drop first fruit
          </button>
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">💥</div>
            <div className="text-2xl font-semibold tracking-tight mb-1">overflow</div>
            <div className="text-white/50 text-sm mb-4">final score</div>
            <div className="text-5xl font-semibold tabular-nums mb-1">{score}</div>
            <div className="text-white/40 text-xs mb-6">best {best}</div>
            <div className="flex gap-2">
              <button type="button" onClick={start}
                className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                play again
              </button>
              <button type="button" onClick={gameOver}
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

function draw(ctx, g, now, phase, nextTier) {
  ctx.clearRect(0, 0, g.w, g.h);
  // background glow
  const bgGrad = ctx.createRadialGradient(g.w / 2, g.h * 0.4, 0, g.w / 2, g.h * 0.4, Math.max(g.w, g.h));
  bgGrad.addColorStop(0, "rgba(50,40,80,0.35)");
  bgGrad.addColorStop(1, "rgba(10,10,18,0)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, g.w, g.h);

  // container
  const cont = g.container;
  ctx.save();
  // interior fill
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(cont.x, cont.y, cont.w, cont.h);
  // danger line
  const dangerPulse = Math.max(0, Math.min(1, g.dangerTimer / 500));
  ctx.strokeStyle = `rgba(239,68,68,${0.2 + 0.6 * dangerPulse})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(cont.x + 4, g.dangerY);
  ctx.lineTo(cont.x + cont.w - 4, g.dangerY);
  ctx.stroke();
  ctx.setLineDash([]);
  // sides + floor
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cont.x - 1.5, cont.y);
  ctx.lineTo(cont.x - 1.5, cont.y + cont.h);
  ctx.lineTo(cont.x + cont.w + 1.5, cont.y + cont.h);
  ctx.lineTo(cont.x + cont.w + 1.5, cont.y);
  ctx.stroke();
  ctx.restore();

  // preview
  const cursorX = Math.max(cont.x + 8, Math.min(cont.x + cont.w - 8, g.cursorX || cont.x + cont.w / 2));
  // guideline
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(cursorX, cont.y + 20);
  ctx.lineTo(cursorX, cont.y + cont.h - 4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // fruits
  for (const f of g.fruits) drawFruit(ctx, f);

  // merge splashes
  for (const m of g.merges) {
    const a = Math.max(0, Math.min(1, m.life / 24));
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.7})`;
    ctx.lineWidth = 2;
    const rr = m.size * (1 + (1 - a) * 0.5);
    ctx.beginPath();
    ctx.arc(m.x, m.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // preview fruit hanging above container at cursor
  if (phase === "playing" && nextTier != null) {
    const def = FRUITS[nextTier];
    const px = Math.max(g.container.x + def.r + 1, Math.min(g.container.x + g.container.w - def.r - 1, g.cursorX || g.container.x + g.container.w / 2));
    const py = g.container.y + def.r + 6;
    const previewF = { x: px, y: py, r: def.r, color: def.color, emoji: def.emoji, mergePulse: 0 };
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawFruit(ctx, previewF);
    ctx.restore();
  }
}

function drawFruit(ctx, f) {
  const grad = ctx.createRadialGradient(f.x - f.r * 0.35, f.y - f.r * 0.4, f.r * 0.1, f.x, f.y, f.r);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, f.color);
  grad.addColorStop(1, shade(f.color, -0.35));
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // outline
  ctx.strokeStyle = shade(f.color, -0.55);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // merge pulse ring
  if (f.mergePulse > 0.01) {
    ctx.strokeStyle = `rgba(255,255,255,${f.mergePulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r + f.mergePulse * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  // emoji
  ctx.font = `${Math.round(f.r * 1.25)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillText(f.emoji, f.x, f.y + 2);
  ctx.fillText(f.emoji, f.x, f.y);
  ctx.restore();
}

function shade(hex, amt) {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  const f = amt < 0 ? 1 + amt : 1;
  const nr = Math.round(r * f);
  const ng = Math.round(g * f);
  const nb = Math.round(b * f);
  const to = (n) => n.toString(16).padStart(2, "0");
  return `#${to(nr)}${to(ng)}${to(nb)}`;
}
