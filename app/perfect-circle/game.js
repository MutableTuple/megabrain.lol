"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FADE_MS = 550;
const MIN_POINTS = 20;
const MIN_SIZE = 40;

const SHAPES = [
  { id: "circle", label: "circle" },
  { id: "square", label: "square" },
  { id: "rectangle", label: "rectangle" },
];

function bestKey(shape) { return `pc-best-${shape}`; }
function ghostKey(shape) { return `pc-ghost-${shape}`; }

function loadBest(shape) {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(bestKey(shape));
  return v ? Number(v) : null;
}
function saveBest(shape, v) {
  if (typeof window === "undefined") return;
  localStorage.setItem(bestKey(shape), String(v));
}
function loadGhost(shape) {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(ghostKey(shape));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function saveGhost(shape, pts) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ghostKey(shape), JSON.stringify(pts));
  } catch {}
}

// ---------- scoring ----------

function scoreShape(points, shape) {
  if (shape === "circle") return scoreCircle(points);
  return scoreRect(points, shape === "square");
}

function scoreCircle(points) {
  if (points.length < MIN_POINTS) return { score: 0, valid: false };
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const cx = sx / points.length;
  const cy = sy / points.length;
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  let mr = 0;
  for (const r of radii) mr += r;
  mr /= radii.length;
  if (mr < MIN_SIZE / 2) return { score: 0, valid: false };
  let vsum = 0;
  for (const r of radii) vsum += (r - mr) ** 2;
  const std = Math.sqrt(vsum / radii.length);
  const cv = std / mr;

  const angles = points.map((p) => Math.atan2(p.y - cy, p.x - cx));
  angles.sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angles.length; i++) {
    const next = i === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[i + 1];
    const gap = next - angles[i];
    if (gap > maxGap) maxGap = gap;
  }
  const coverage = (Math.PI * 2 - maxGap) / (Math.PI * 2);

  let s = Math.max(0, 1 - cv * 3.2);
  s *= Math.min(1, coverage / 0.98);
  return { score: s * 100, valid: true, shape: "circle", cx, cy, meanR: mr };
}

function scoreRect(points, forceSquare) {
  if (points.length < MIN_POINTS) return { score: 0, valid: false };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < MIN_SIZE || h < MIN_SIZE) return { score: 0, valid: false };

  // for a square, use the min side as reference so the bounding box is square
  let rx0 = minX, rx1 = maxX, ry0 = minY, ry1 = maxY;
  if (forceSquare) {
    const side = Math.min(w, h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    rx0 = cx - side / 2; rx1 = cx + side / 2;
    ry0 = cy - side / 2; ry1 = cy + side / 2;
  }
  const bw = rx1 - rx0;
  const bh = ry1 - ry0;

  let sumErr = 0;
  for (const p of points) {
    const dL = Math.abs(p.x - rx0);
    const dR = Math.abs(p.x - rx1);
    const dT = Math.abs(p.y - ry0);
    const dB = Math.abs(p.y - ry1);
    // distance to nearest edge (only count points near one of the edges)
    // constrain point to lie within its perpendicular projection on that edge
    const inXBand = p.x >= rx0 && p.x <= rx1;
    const inYBand = p.y >= ry0 && p.y <= ry1;
    let candidates = [];
    if (inXBand) candidates.push(dT, dB);
    if (inYBand) candidates.push(dL, dR);
    if (candidates.length === 0) {
      // corner: distance to nearest corner
      const dTL = Math.hypot(p.x - rx0, p.y - ry0);
      const dTR = Math.hypot(p.x - rx1, p.y - ry0);
      const dBL = Math.hypot(p.x - rx0, p.y - ry1);
      const dBR = Math.hypot(p.x - rx1, p.y - ry1);
      candidates = [dTL, dTR, dBL, dBR];
    }
    sumErr += Math.min(...candidates);
  }
  const meanErr = sumErr / points.length;
  const scale = (bw + bh) / 2;
  const normErr = meanErr / scale;

  let s = Math.max(0, 1 - normErr * 7);

  // aspect penalty for square
  if (forceSquare) {
    const ar = Math.min(w, h) / Math.max(w, h);
    s *= ar; // 1 for a perfect square input, less otherwise
  } else {
    // rectangle: require non-square (bonus for having a real aspect ratio)
    const ar = Math.min(w, h) / Math.max(w, h);
    if (ar > 0.92) s *= 0.7; // too square-ish
  }

  // side coverage: check each of 4 sides has points
  const sideCounts = [0, 0, 0, 0];
  const tol = Math.max(6, scale * 0.06);
  for (const p of points) {
    if (Math.abs(p.y - ry0) < tol && p.x >= rx0 - tol && p.x <= rx1 + tol) sideCounts[0]++; // top
    if (Math.abs(p.y - ry1) < tol && p.x >= rx0 - tol && p.x <= rx1 + tol) sideCounts[1]++; // bottom
    if (Math.abs(p.x - rx0) < tol && p.y >= ry0 - tol && p.y <= ry1 + tol) sideCounts[2]++; // left
    if (Math.abs(p.x - rx1) < tol && p.y >= ry0 - tol && p.y <= ry1 + tol) sideCounts[3]++; // right
  }
  const sidesHit = sideCounts.filter((c) => c > 3).length;
  s *= sidesHit / 4;

  const cx = (rx0 + rx1) / 2;
  const cy = (ry0 + ry1) / 2;
  return {
    score: s * 100,
    valid: true,
    shape: forceSquare ? "square" : "rectangle",
    cx, cy, rx0, rx1, ry0, ry1, bw, bh,
  };
}

function verdict(s) {
  if (s >= 96) return { text: "godlike", color: "#ffd166" };
  if (s >= 90) return { text: "perfect-ish", color: "#06d6a0" };
  if (s >= 80) return { text: "clean", color: "#4cc9f0" };
  if (s >= 70) return { text: "decent", color: "#a8dadc" };
  if (s >= 50) return { text: "wobbly", color: "#c77dff" };
  if (s >= 30) return { text: "rough", color: "#f4a261" };
  return { text: "chaos", color: "#ef476f" };
}

// ---------- component ----------

export default function Game() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [shape, setShape] = useState("circle");
  const [fade, setFade] = useState(true);
  const [thickness, setThickness] = useState(3);
  const [uiScore, setUiScore] = useState(null);
  const [best, setBest] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [phase, setPhase] = useState("idle");

  const shapeRef = useRef(shape);
  const fadeRef = useRef(fade);
  const thickRef = useRef(thickness);
  useEffect(() => { shapeRef.current = shape; }, [shape]);
  useEffect(() => { fadeRef.current = fade; }, [fade]);
  useEffect(() => { thickRef.current = thickness; }, [thickness]);

  // reload best + ghost when shape changes
  useEffect(() => {
    setBest(loadBest(shape));
    if (stateRef.current) {
      stateRef.current.ghost = loadGhost(shape);
      stateRef.current.result = null;
      stateRef.current.points = [];
    }
    setPhase("idle");
    setUiScore(null);
    setNewBest(false);
    setAttempts(0);
  }, [shape]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const s = {
      w: 0, h: 0, dpr,
      drawing: false,
      points: [],
      lastPoint: null,
      result: null,
      ghost: loadGhost(shapeRef.current),
      confetti: [],
      revealT: 0,
      pulse: 0,
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

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function down(e) {
      canvas.setPointerCapture?.(e.pointerId);
      s.drawing = true;
      s.points = [];
      s.result = null;
      s.revealT = 0;
      setPhase("drawing");
      setNewBest(false);
      const p = pos(e);
      const t = performance.now();
      s.points.push({ x: p.x, y: p.y, t });
      s.lastPoint = p;
    }
    function move(e) {
      if (!s.drawing) return;
      const p = pos(e);
      const last = s.lastPoint;
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      s.points.push({ x: p.x, y: p.y, t: performance.now() });
      s.lastPoint = p;
    }
    function up() {
      if (!s.drawing) return;
      s.drawing = false;
      const currShape = shapeRef.current;
      const res = scoreShape(s.points, currShape);
      if (!res.valid) {
        setPhase("idle");
        s.points = [];
        return;
      }
      s.result = { points: s.points.slice(), ...res };
      s.revealT = performance.now();
      setUiScore(res.score);
      setAttempts((a) => a + 1);
      const prev = loadBest(currShape);
      if (prev == null || res.score > prev) {
        setBest(res.score);
        setNewBest(true);
        saveBest(currShape, res.score);
        saveGhost(currShape, s.result.points);
        s.ghost = s.result.points;
        s.pulse = 1;
        for (let i = 0; i < 140; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 3 + Math.random() * 7;
          s.confetti.push({
            x: res.cx, y: res.cy,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
            rot: Math.random() * Math.PI, rotV: (Math.random() - 0.5) * 0.4,
            size: 4 + Math.random() * 6, color: pickColor(),
            life: 80 + Math.random() * 60,
            shape: Math.random() < 0.5 ? "rect" : "circle",
          });
        }
      }
      setPhase("result");
    }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    let raf = 0;
    function loop(now) {
      draw(ctx, s, now, fadeRef.current, thickRef.current);
      if (s.confetti.length) {
        for (const p of s.confetti) {
          p.vy += 0.25;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.rotV;
          p.life -= 1;
        }
        s.confetti = s.confetti.filter((p) => p.life > 0 && p.y < s.h + 40);
      }
      s.pulse *= 0.96;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  const reset = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    s.points = [];
    s.result = null;
    setPhase("idle");
    setUiScore(null);
    setNewBest(false);
  }, []);

  const v = uiScore != null ? verdict(uiScore) : null;

  return (
    <div
      className="relative w-full h-[100dvh] bg-[#0a0a12] overflow-hidden select-none touch-none"
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        style={{ touchAction: "none" }}
      />

      {/* header */}
      <div className="absolute top-0 inset-x-0 p-3 sm:p-6 flex justify-between items-start text-white font-mono text-sm gap-3 z-10">
        {/* controls */}
        <div className="flex flex-col gap-2 items-start pointer-events-auto">
          <div className="text-white/50 uppercase tracking-widest text-[10px]">Perfect Shape</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value)}
              className="bg-white/10 hover:bg-white/15 text-white text-sm font-mono rounded-md px-2 py-1.5 border border-white/10 outline-none cursor-pointer"
            >
              {SHAPES.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#111] text-white">
                  {s.label}
                </option>
              ))}
            </select>
            <FadeSwitch on={fade} onChange={setFade} />
            <ThicknessControl value={thickness} onChange={setThickness} />
          </div>
        </div>

        {/* stats */}
        <div className="text-right space-y-1 pointer-events-none">
          <StatLine label="attempts" value={attempts} />
          <StatLine label="best" value={best != null ? best.toFixed(1) + "%" : "—"} />
        </div>
      </div>

      {/* Hint */}
      {phase === "idle" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-white/70 text-lg sm:text-xl font-mono tracking-wide text-center">
            draw a {shape}
          </div>
          <div className="text-white/30 text-xs sm:text-sm font-mono mt-2 text-center">
            one stroke. {fade ? "line fades as you draw." : "line stays visible."}
          </div>
        </div>
      )}

      {/* Result overlay */}
      {phase === "result" && uiScore != null && (
        <div className="pointer-events-none absolute bottom-0 inset-x-0 pb-6 sm:pb-10 flex flex-col items-center gap-2">
          {newBest && (
            <div
              className="text-xs uppercase tracking-widest font-mono animate-pulse"
              style={{ color: v.color }}
            >
              new best
            </div>
          )}
          <div
            className="text-6xl sm:text-8xl font-semibold tabular-nums tracking-tight"
            style={{ color: v.color }}
          >
            {uiScore.toFixed(1)}%
          </div>
          <div className="text-white/60 text-sm font-mono uppercase tracking-widest">
            {v.text}
          </div>
          <button
            type="button"
            onClick={reset}
            className="pointer-events-auto mt-4 px-6 py-3 rounded-full bg-white/10 text-white font-mono text-sm tracking-tight hover:bg-white/20 active:scale-95 transition cursor-pointer touch-manipulation"
          >
            draw again
          </button>
        </div>
      )}
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

function ThicknessControl({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-full px-3 py-1.5 border border-white/10 bg-white/[0.03]">
      <span className="text-xs text-white/60 font-mono">size</span>
      <input
        type="range"
        min={1}
        max={14}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 accent-[#4cc9f0] cursor-pointer touch-manipulation"
      />
      <span
        className="rounded-full bg-white"
        style={{ width: value + 2, height: value + 2, minWidth: 4, minHeight: 4 }}
      />
    </div>
  );
}

function FadeSwitch({ on, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative flex items-center gap-2 rounded-full px-2.5 py-1.5 border transition cursor-pointer touch-manipulation ${
        on ? "bg-white/10 border-white/15" : "bg-white/[0.03] border-white/10"
      }`}
    >
      <span
        className={`w-8 h-4 rounded-full relative transition-colors ${on ? "bg-[#4cc9f0]" : "bg-white/20"}`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? "left-4" : "left-0.5"}`}
        />
      </span>
      <span className="text-xs text-white/70 font-mono">fade</span>
    </button>
  );
}

// ---------- drawing ----------

function draw(ctx, s, now, fadeEnabled, thickness) {
  ctx.clearRect(0, 0, s.w, s.h);
  drawBg(ctx, s);

  // faint ghost of best attempt for this shape
  if (s.ghost && s.ghost.length > 2 && !s.drawing && !s.result) {
    drawPathSolid(ctx, s.ghost, "rgba(180,200,255,0.10)", 1.2);
  }

  if (s.drawing) {
    drawLiveStroke(ctx, s.points, now, fadeEnabled, thickness);
  } else if (s.result) {
    const t = Math.min(1, (now - s.revealT) / 500);
    const pts = s.result.points;
    const upto = Math.floor(pts.length * t);
    drawGradientStroke(ctx, pts.slice(0, upto + 1), thickness, 1);

    if (t > 0.65) {
      const ct = Math.min(1, (t - 0.65) / 0.35);
      const v = verdict(s.result.score);
      ctx.save();
      ctx.strokeStyle = v.color;
      ctx.globalAlpha = 0.8 * ct;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (s.result.shape === "circle") {
        ctx.arc(s.result.cx, s.result.cy, s.result.meanR, 0, Math.PI * 2);
      } else {
        const { rx0, rx1, ry0, ry1 } = s.result;
        ctx.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      }
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = v.color;
      ctx.globalAlpha = ct;
      ctx.beginPath();
      ctx.arc(s.result.cx, s.result.cy, 2 + s.pulse * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // confetti
  for (const p of s.confetti) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

function drawLiveStroke(ctx, pts, now, fadeEnabled, thickness) {
  if (pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = thickness;
  for (let i = 1; i < pts.length; i++) {
    const a = fadeEnabled ? Math.max(0, 1 - (now - pts[i].t) / FADE_MS) : 1;
    if (a <= 0.02) continue;
    const hue = ((i / pts.length) * 300) % 360;
    ctx.strokeStyle = `hsla(${hue}, 85%, 65%, ${a})`;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  const p = pts[pts.length - 1];
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 22);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(p.x - 24, p.y - 24, 48, 48);
}

function drawGradientStroke(ctx, pts, width, alpha) {
  if (pts.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  for (let i = 1; i < pts.length; i++) {
    const hue = ((i / pts.length) * 300) % 360;
    ctx.strokeStyle = `hsla(${hue}, 85%, 65%, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

function drawPathSolid(ctx, pts, color, width) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawBg(ctx, s) {
  const grad = ctx.createRadialGradient(s.w / 2, s.h / 2, 0, s.w / 2, s.h / 2, Math.max(s.w, s.h) * 0.7);
  grad.addColorStop(0, "rgba(60,60,90,0.30)");
  grad.addColorStop(1, "rgba(10,10,18,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s.w, s.h);
}

function pickColor() {
  const c = ["#ff5c8a", "#ffd166", "#06d6a0", "#4cc9f0", "#c77dff", "#f4a261"];
  return c[Math.floor(Math.random() * c.length)];
}
