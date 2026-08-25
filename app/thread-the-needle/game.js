"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const N_SEGMENTS = 34;
const SEG_LEN = 6.5;
const PINCH_INDEX = 5;
const CONSTRAINT_ITERS = 18;
const DAMPING = 0.965;
const GRAVITY = 0.06;
const EYE_RADIUS = 7.5;
const HAND_TREMOR = 0.9;
const FLICK_CHANCE = 0.008;

function loadBest() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem("ttn-best");
  return v ? Number(v) : null;
}

function saveBest(ms) {
  if (typeof window === "undefined") return;
  localStorage.setItem("ttn-best", String(ms));
}

function fmt(ms) {
  if (ms == null) return "—";
  const s = ms / 1000;
  return s < 10 ? s.toFixed(2) + "s" : s.toFixed(1) + "s";
}

export default function Game() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [uiStats, setUiStats] = useState({
    elapsed: 0,
    attempts: 0,
    successes: 0,
    best: null,
    running: false,
  });
  const [won, setWon] = useState(false);
  const [lastTime, setLastTime] = useState(null);

  const startRun = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    s.attempts = 0;
    s.startedAt = null;
    s.running = false;
    s.won = false;
    s.wasFar = false;
    s.mouse.active = false;
    s.confetti = [];
    setWon(false);
    setLastTime(null);
    setUiStats((u) => ({
      ...u,
      elapsed: 0,
      attempts: 0,
      successes: 0,
      running: false,
    }));
    // reinitialize string away from needle
    initString(s);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const s = {
      w: 0,
      h: 0,
      dpr,
      mouse: { x: 0, y: 0, vx: 0, vy: 0, active: false },
      lastMouse: { x: 0, y: 0 },
      nodes: [],
      needle: { x: 0, y: 0, angle: 0, length: 320 },
      eye: { x: 0, y: 0, r: EYE_RADIUS },
      time: 0,
      running: false,
      startedAt: null,
      elapsed: 0,
      attempts: 0,
      successes: 0,
      best: loadBest(),
      lastTip: { x: 0, y: 0 },
      confetti: [],
      flashTime: 0,
      won: false,
      glow: 0,
    };
    stateRef.current = s;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      s.w = rect.width;
      s.h = rect.height;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layoutNeedle(s);
      initString(s);
    }

    resize();
    window.addEventListener("resize", resize);

    setUiStats((u) => ({ ...u, best: s.best }));

    function onPointer(e) {
      const rect = canvas.getBoundingClientRect();
      const nx = e.clientX - rect.left;
      const ny = e.clientY - rect.top;
      s.mouse.vx = nx - s.mouse.x;
      s.mouse.vy = ny - s.mouse.y;
      s.mouse.x = nx;
      s.mouse.y = ny;
      s.mouse.active = true;
      if (!s.running && !s.won) {
        s.running = true;
        s.startedAt = performance.now();
        setUiStats((u) => ({ ...u, running: true }));
      }
    }

    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerdown", onPointer);

    let raf = 0;
    let last = performance.now();
    function loop(now) {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      s.time += dt;

      // update string physics
      stepString(s, dt);

      // check crossing
      const tip = s.nodes[0];
      if (s.mouse.active && !s.won) {
        const prev = s.lastTip;
        const dEye = Math.hypot(tip.x - s.eye.x, tip.y - s.eye.y);
        // must have been clearly outside the eye zone at least once this attempt
        if (dEye > 55) s.wasFar = true;

        if (s.wasFar) {
          const a = s.needle.angle;
          const perpX = -Math.sin(a);
          const perpY = Math.cos(a);
          const dirX = Math.cos(a);
          const dirY = Math.sin(a);
          const prevSide = (prev.x - s.eye.x) * perpX + (prev.y - s.eye.y) * perpY;
          const currSide = (tip.x - s.eye.x) * perpX + (tip.y - s.eye.y) * perpY;

          if (prevSide * currSide < 0) {
            // segment crossed the needle axis line — find crossing point
            const t = prevSide / (prevSide - currSide);
            const cx = prev.x + t * (tip.x - prev.x);
            const cy = prev.y + t * (tip.y - prev.y);
            const along = (cx - s.eye.x) * dirX + (cy - s.eye.y) * dirY;
            if (Math.abs(along) < s.eye.r * 0.9) {
              triggerSuccess(s);
            } else if (Math.abs(along) < s.needle.length * 0.5) {
              // crossed the needle shaft but not the eye — miss
              if (s.time - (s.lastMiss || 0) > 25) {
                s.attempts += 1;
                s.flashTime = 20;
                s.lastMiss = s.time;
                setUiStats((u) => ({ ...u, attempts: s.attempts }));
              }
            }
          }
        }
      }
      s.lastTip.x = tip.x;
      s.lastTip.y = tip.y;

      // update timer
      if (s.running && !s.won && s.startedAt != null) {
        s.elapsed = performance.now() - s.startedAt;
        // throttle UI updates
        if (
          Math.floor(s.elapsed / 50) !== Math.floor((s.elapsedPrev || 0) / 50)
        ) {
          setUiStats((u) => ({ ...u, elapsed: s.elapsed }));
        }
        s.elapsedPrev = s.elapsed;
      }

      // update confetti
      if (s.confetti.length) {
        for (const p of s.confetti) {
          p.vy += 0.25 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.rotV * dt;
          p.life -= dt;
        }
        s.confetti = s.confetti.filter((p) => p.life > 0 && p.y < s.h + 40);
      }

      draw(ctx, s);
      s.flashTime = Math.max(0, s.flashTime - dt);
      s.glow *= 0.94;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  function triggerSuccess(s) {
    s.won = true;
    s.running = false;
    s.successes += 1;
    const time = s.elapsed;
    let newBest = s.best;
    if (s.best == null || time < s.best) {
      newBest = time;
      s.best = time;
      saveBest(time);
    }
    // confetti burst
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 8;
      s.confetti.push({
        x: s.eye.x,
        y: s.eye.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 3,
        rot: Math.random() * Math.PI,
        rotV: (Math.random() - 0.5) * 0.4,
        size: 4 + Math.random() * 6,
        color: pickColor(),
        life: 80 + Math.random() * 60,
        shape: Math.random() < 0.5 ? "rect" : "circle",
      });
    }
    s.glow = 1;
    setLastTime(time);
    setWon(true);
    setUiStats((u) => ({
      ...u,
      running: false,
      elapsed: time,
      successes: s.successes,
      best: newBest,
    }));
  }

  return (
    <div
      className="relative w-full h-[100dvh] bg-[#0a0a12] overflow-hidden select-none touch-none"
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-none touch-none"
        style={{ touchAction: "none" }}
      />

      {/* Header stats */}
      <div className="pointer-events-none absolute top-0 inset-x-0 p-4 sm:p-6 flex justify-between items-start text-white font-mono text-sm">
        <div className="space-y-1">
          <div className="text-white/50 uppercase tracking-widest text-[10px]">
            Thread the Needle
          </div>
          <div className="text-2xl sm:text-3xl tabular-nums font-semibold">
            {fmt(uiStats.elapsed)}
          </div>
        </div>
        <div className="text-right space-y-1">
          <StatLine label="misses" value={uiStats.attempts} />
          <StatLine label="threaded" value={uiStats.successes} />
          <StatLine label="best" value={fmt(uiStats.best)} />
        </div>
      </div>

      {/* Hint */}
      {!uiStats.running && !won && (
        <div className="pointer-events-none absolute bottom-6 inset-x-0 flex justify-center">
          <div className="text-white/60 text-sm sm:text-base font-mono tracking-wide text-center">
            drag to move. slip the tip through the eye.
            <div className="text-white/30 text-xs mt-1">
              it wobbles. so does your hand.
            </div>
          </div>
        </div>
      )}

      {/* Success modal */}
      {won && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 sm:p-10 max-w-sm w-[92%] text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-2">✨</div>
            <div className="text-white text-2xl font-semibold tracking-tight mb-1">
              Threaded.
            </div>
            <div className="text-white/60 text-sm font-mono mb-6">
              you did the impossible thing
            </div>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <Stat label="time" value={fmt(lastTime)} highlight />
              <Stat label="misses" value={uiStats.attempts} />
              <Stat label="best" value={fmt(uiStats.best)} />
            </div>
            <button
              onClick={startRun}
              className="w-full py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 transition"
            >
              Thread again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatLine({ label, value }) {
  return (
    <div className="flex items-baseline justify-end gap-2">
      <span className="text-white/40 text-[10px] uppercase tracking-widest">
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div
      className={`rounded-lg py-3 px-2 ${highlight ? "bg-white/10" : "bg-white/[0.03]"}`}
    >
      <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className="text-white font-mono tabular-nums text-sm">{value}</div>
    </div>
  );
}

// ---------- physics & drawing ----------

function layoutNeedle(s) {
  s.needle.x = s.w * 0.5;
  s.needle.y = s.h * 0.5;
  s.needle.angle = -Math.PI / 6; // slight tilt
  s.needle.length = Math.min(420, Math.min(s.w, s.h) * 0.55);
  // Eye sits near the "blunt" end (opposite to the point)
  const eyeOffset = -s.needle.length * 0.36;
  s.eye.x = s.needle.x + Math.cos(s.needle.angle) * eyeOffset;
  s.eye.y = s.needle.y + Math.sin(s.needle.angle) * eyeOffset;
  s.eye.r = EYE_RADIUS;
}

function initString(s) {
  const startX = s.w * 0.15;
  const startY = s.h * 0.85;
  s.nodes = [];
  for (let i = 0; i < N_SEGMENTS; i++) {
    const x = startX + i * SEG_LEN * 0.5;
    const y = startY - i * SEG_LEN * 0.5;
    s.nodes.push({ x, y, ox: x, oy: y });
  }
  s.mouse.x = startX + PINCH_INDEX * SEG_LEN * 0.5;
  s.mouse.y = startY - PINCH_INDEX * SEG_LEN * 0.5;
  s.lastTip.x = s.nodes[0].x;
  s.lastTip.y = s.nodes[0].y;
}

function stepString(s, dt) {
  // apply tremor to mouse pinch position
  const t = s.time * 0.06;
  const trX = (Math.sin(t * 3.1) + Math.sin(t * 5.7) * 0.5) * HAND_TREMOR;
  const trY = (Math.cos(t * 4.3) + Math.cos(t * 6.1) * 0.5) * HAND_TREMOR;

  // velocity-based extra jitter — moving fast = shakier
  const speed = Math.hypot(s.mouse.vx, s.mouse.vy);
  const jitterK = Math.min(3, 0.5 + speed * 0.08);

  const pinchX = s.mouse.x + trX * jitterK;
  const pinchY = s.mouse.y + trY * jitterK;

  // Verlet integrate
  for (let i = 0; i < s.nodes.length; i++) {
    const n = s.nodes[i];
    if (i === PINCH_INDEX) {
      n.ox = n.x;
      n.oy = n.y;
      n.x = pinchX;
      n.y = pinchY;
      continue;
    }
    const vx = (n.x - n.ox) * DAMPING;
    const vy = (n.y - n.oy) * DAMPING;
    n.ox = n.x;
    n.oy = n.y;
    n.x += vx;
    n.y += vy + GRAVITY;
  }

  // occasional flick on tip
  if (Math.random() < FLICK_CHANCE) {
    const tip = s.nodes[0];
    tip.x += (Math.random() - 0.5) * 6;
    tip.y += (Math.random() - 0.5) * 6;
  }

  // constraints
  for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
    for (let i = 0; i < s.nodes.length - 1; i++) {
      const a = s.nodes[i];
      const b = s.nodes[i + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy) || 0.0001;
      const diff = (dist - SEG_LEN) / dist;
      const ax = dx * 0.5 * diff;
      const ay = dy * 0.5 * diff;
      const aPin = i === PINCH_INDEX;
      const bPin = i + 1 === PINCH_INDEX;
      if (aPin && !bPin) {
        b.x -= ax * 2;
        b.y -= ay * 2;
      } else if (bPin && !aPin) {
        a.x += ax * 2;
        a.y += ay * 2;
      } else if (!aPin && !bPin) {
        a.x += ax;
        a.y += ay;
        b.x -= ax;
        b.y -= ay;
      }
    }
  }

  // decay mouse velocity
  s.mouse.vx *= 0.6;
  s.mouse.vy *= 0.6;
}

function draw(ctx, s) {
  ctx.clearRect(0, 0, s.w, s.h);

  // ambient glow
  const grad = ctx.createRadialGradient(
    s.w / 2,
    s.h / 2,
    0,
    s.w / 2,
    s.h / 2,
    Math.max(s.w, s.h) * 0.7,
  );
  grad.addColorStop(0, "rgba(60,60,90,0.35)");
  grad.addColorStop(1, "rgba(10,10,18,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s.w, s.h);

  // miss flash
  if (s.flashTime > 0) {
    ctx.fillStyle = `rgba(255,80,80,${(s.flashTime / 20) * 0.15})`;
    ctx.fillRect(0, 0, s.w, s.h);
  }

  drawNeedle(ctx, s);
  drawString(ctx, s);
  drawCursor(ctx, s);
  drawConfetti(ctx, s);
}

function drawNeedle(ctx, s) {
  const { x, y, angle, length } = s.needle;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const half = length / 2;
  const shaftGrad = ctx.createLinearGradient(0, -4, 0, 4);
  shaftGrad.addColorStop(0, "#4a4d55");
  shaftGrad.addColorStop(0.5, "#e6e8ee");
  shaftGrad.addColorStop(1, "#4a4d55");

  // Body (blunt end to just before point)
  ctx.fillStyle = shaftGrad;
  ctx.beginPath();
  ctx.moveTo(-half, -3.2);
  ctx.lineTo(half - 40, -1.2);
  ctx.lineTo(half, 0);
  ctx.lineTo(half - 40, 1.2);
  ctx.lineTo(-half, 3.2);
  ctx.closePath();
  ctx.fill();

  // Blunt-end cap
  ctx.beginPath();
  ctx.arc(-half + 2, 0, 3.6, Math.PI / 2, -Math.PI / 2, false);
  ctx.fillStyle = "#c9ccd4";
  ctx.fill();

  // Eye — draw as a hole with dark inside
  const eyeLocalX = -half + length * 0.14;
  ctx.save();
  ctx.translate(eyeLocalX, 0);
  // outline (metal ring)
  ctx.beginPath();
  ctx.ellipse(0, 0, s.eye.r + 2.5, s.eye.r + 1.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#dadde5";
  ctx.fill();
  // hole
  ctx.beginPath();
  ctx.ellipse(0, 0, s.eye.r, s.eye.r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0a12";
  ctx.fill();
  // subtle glow if close
  if (s.glow > 0.01) {
    ctx.beginPath();
    ctx.ellipse(0, 0, s.eye.r + 6, s.eye.r + 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,220,120,${s.glow * 0.35})`;
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();

  // update world-space eye center to match drawn position
  const eyeOffset = -length * 0.36;
  s.eye.x = x + Math.cos(angle) * eyeOffset;
  s.eye.y = y + Math.sin(angle) * eyeOffset;

  // debug ring (subtle target hint)
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(s.eye.x, s.eye.y, s.eye.r + 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawString(ctx, s) {
  if (s.nodes.length < 2) return;

  // Shadow / soft under-glow
  ctx.save();
  ctx.strokeStyle = "rgba(255,220,180,0.08)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.nodes[0].x, s.nodes[0].y);
  for (let i = 1; i < s.nodes.length - 1; i++) {
    const xc = (s.nodes[i].x + s.nodes[i + 1].x) / 2;
    const yc = (s.nodes[i].y + s.nodes[i + 1].y) / 2;
    ctx.quadraticCurveTo(s.nodes[i].x, s.nodes[i].y, xc, yc);
  }
  const last = s.nodes[s.nodes.length - 1];
  const second = s.nodes[s.nodes.length - 2];
  ctx.quadraticCurveTo(second.x, second.y, last.x, last.y);
  ctx.stroke();
  ctx.restore();

  // Main thread
  ctx.save();
  ctx.strokeStyle = "#f4ead6";
  ctx.lineWidth = 2.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.nodes[0].x, s.nodes[0].y);
  for (let i = 1; i < s.nodes.length - 1; i++) {
    const xc = (s.nodes[i].x + s.nodes[i + 1].x) / 2;
    const yc = (s.nodes[i].y + s.nodes[i + 1].y) / 2;
    ctx.quadraticCurveTo(s.nodes[i].x, s.nodes[i].y, xc, yc);
  }
  ctx.quadraticCurveTo(second.x, second.y, last.x, last.y);
  ctx.stroke();

  // Fiber highlight
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();

  // Tip — the pointy waxed end
  const tip = s.nodes[0];
  const nx = s.nodes[1];
  const ang = Math.atan2(tip.y - nx.y, tip.x - nx.x);
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(ang);
  ctx.fillStyle = "#2a2018";
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, 2);
  ctx.lineTo(-4, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Glow if tip near eye
  const dToEye = Math.hypot(tip.x - s.eye.x, tip.y - s.eye.y);
  if (dToEye < 40) {
    const k = 1 - dToEye / 40;
    ctx.save();
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3 + k * 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,220,120,${k * 0.6})`;
    ctx.fill();
    ctx.restore();
    // also glow eye
    s.glow = Math.max(s.glow, k * 0.6);
  }
}

function drawCursor(ctx, s) {
  if (!s.mouse.active) return;
  const p = s.nodes[PINCH_INDEX];
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.restore();
}

function drawConfetti(ctx, s) {
  for (const p of s.confetti) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    if (p.shape === "rect") {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function pickColor() {
  const colors = [
    "#ff5c8a",
    "#ffd166",
    "#06d6a0",
    "#4cc9f0",
    "#c77dff",
    "#f4a261",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
