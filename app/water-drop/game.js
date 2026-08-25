"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { initAudio, isMuted, setMuted, playDrop, playSpill, playTurn, playStart, playWin, playLose } from "../lib/sound";

function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function hostPeerId(roomId) { return `mb-wd-${roomId}`; }

const NAMES = [
  "aarav", "diya", "mia", "leo", "zara", "kabir", "priya", "noah",
  "ivy", "yusuf", "sana", "milo", "ava", "reyansh", "nia",
];
const PLAYER_COLORS = ["#4cc9f0", "#c77dff", "#06d6a0", "#ffd166", "#ef476f"];

const LIQUIDS = [
  { id: "water",  label: "water",  swatch: "#4cc9f0", top: "140,220,255", mid: "90,180,240",  bot: "30,80,150",   dropMid: "142,215,255", dropDeep: "30,80,150",   splash: "160,220,255" },
  { id: "juice",  label: "juice",  swatch: "#ff9a1f", top: "255,200,110", mid: "245,145,40",  bot: "175,80,10",   dropMid: "255,180,80",  dropDeep: "175,80,10",   splash: "255,200,120" },
  { id: "wine",   label: "wine",   swatch: "#8b1a3b", top: "200,70,100",  mid: "130,25,55",   bot: "60,10,30",    dropMid: "180,60,90",   dropDeep: "60,10,30",    splash: "200,100,130" },
  { id: "lime",   label: "lime",   swatch: "#7ed321", top: "185,240,120", mid: "110,200,60",  bot: "40,110,20",   dropMid: "160,225,100", dropDeep: "40,110,20",   splash: "190,245,140" },
  { id: "ink",    label: "ink",    swatch: "#3d3dbf", top: "110,110,180", mid: "40,40,100",   bot: "8,8,30",      dropMid: "80,80,150",   dropDeep: "8,8,30",      splash: "130,130,200" },
  { id: "milk",   label: "milk",   swatch: "#f6efe0", top: "255,252,244", mid: "240,235,220", bot: "205,200,185", dropMid: "250,245,232", dropDeep: "200,195,180", splash: "255,252,240" },
  { id: "coffee", label: "coffee", swatch: "#5a331b", top: "150,90,50",   mid: "90,50,25",    bot: "35,18,10",    dropMid: "140,85,50",   dropDeep: "35,18,10",    splash: "180,120,80" },
];

const START_FILL = 0.72;         // start at ~72% of rim volume
const DOME_CRITICAL = 0.11;      // dome collapses when excess > 11% of rim volume
const DROP_INTERVAL_MS = 75;     // emit rate while pouring
const DROP_VOLUME_FRAC = 0.005;  // each landed drop adds 0.5% of rim volume
const SETTLE_MS = 900;           // pause between turns for waves to settle

function pickName(taken) {
  for (let i = 0; i < 50; i++) {
    const n = NAMES[Math.floor(Math.random() * NAMES.length)];
    if (!taken.has(n)) return n;
  }
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

// bot personality: how much they'll try to pour on their turn (as excess-of-critical target)
function pickPersonality() {
  const tiers = [
    { tier: "reckless", pourMs: [500, 800], think: [700, 1100] },
    { tier: "bold",     pourMs: [350, 600], think: [800, 1300] },
    { tier: "balanced", pourMs: [220, 420], think: [900, 1500] },
    { tier: "cautious", pourMs: [130, 280], think: [1100, 1700] },
    { tier: "timid",    pourMs: [70, 170],  think: [1300, 2000] },
  ];
  return tiers[Math.floor(Math.random() * tiers.length)];
}

function hexRgb(hex) {
  const m = hex.replace("#", "");
  return [
    parseInt(m.substring(0, 2), 16),
    parseInt(m.substring(2, 4), 16),
    parseInt(m.substring(4, 6), 16),
  ];
}

// ---------- Glass ----------

class Glass {
  constructor() {
    this.liquid = LIQUIDS[0];
    this.authoritative = true;
    this.reset(0, 0, 100, 200);
  }
  setLiquid(l) { this.liquid = l; }
  setAuthoritative(v) { this.authoritative = v; }
  reset(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.rimVolume = w * h;
    this.volume = this.rimVolume * START_FILL;
    this.criticalExcess = this.rimVolume * DOME_CRITICAL;
    this.segments = Math.max(30, Math.floor(w / 3));
    this.surfaceY = new Array(this.segments).fill(0);
    this.surfaceV = new Array(this.segments).fill(0);
    this.drops = [];
    this.splashes = [];
    this.spills = []; // cascading over-the-edge particles
    this.overflow = false;
    this.overflowT = 0;
    this.wobble = 0;
  }
  reposition(x, y, w, h) {
    // keep volume ratio when resizing
    const ratio = this.rimVolume ? this.volume / this.rimVolume : START_FILL;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.rimVolume = w * h;
    this.volume = this.rimVolume * ratio;
    this.criticalExcess = this.rimVolume * DOME_CRITICAL;
    this.segments = Math.max(30, Math.floor(w / 3));
    if (this.surfaceY.length !== this.segments) {
      this.surfaceY = new Array(this.segments).fill(0);
      this.surfaceV = new Array(this.segments).fill(0);
    }
  }
  addDrop(color) {
    if (this.overflow) return;
    const dropX = this.x + this.w * (0.35 + Math.random() * 0.30);
    this.drops.push({
      x: dropX,
      y: this.y - 70 - Math.random() * 30,
      vx: (Math.random() - 0.5) * 0.25,
      vy: 0.7,
      size: 4 + Math.random() * 2,
      color: color || "#e3f6ff",
    });
  }
  update(dt) {
    if (this.overflowT > 0) this.overflowT -= dt;
    this.wobble *= 0.9;

    // baseline for segment i: rim capacity gives flat level; excess forms a dome
    const excess = Math.max(0, this.volume - this.rimVolume);
    const domeHMax = this.w * 0.22;
    const domeH = Math.min(domeHMax, (excess / this.criticalExcess) * domeHMax);
    const rimLevel = Math.min(this.volume, this.rimVolume);
    const baseFillH = (rimLevel / this.rimVolume) * this.h;
    const rimBaselineY = this.y + this.h - baseFillH;
    const cxNorm = 0;
    const baseline = (i) => {
      const t = (i / (this.segments - 1) - 0.5) * 2; // -1..1
      const dome = domeH * Math.max(0, 1 - t * t);
      return rimBaselineY - dome;
    };

    // drops
    const still = [];
    for (const d of this.drops) {
      d.vy += 0.55 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const segIdx = Math.max(0, Math.min(this.segments - 1,
        Math.floor((d.x - this.x) / this.w * this.segments)));
      const surfaceY = baseline(segIdx) + this.surfaceY[segIdx];
      if (d.y >= surfaceY) {
        if (!this.overflow && this.authoritative) {
          this.volume += this.rimVolume * DROP_VOLUME_FRAC;
        }
        playDrop();
        // waves + splashes always fire on landing (visual)
        for (let i = -3; i <= 3; i++) {
          const idx = segIdx + i;
          if (idx >= 0 && idx < this.segments) {
            this.surfaceV[idx] -= (3 - Math.abs(i)) * 0.9;
          }
        }
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
          const sp = 1.2 + Math.random() * 2;
          this.splashes.push({
            x: d.x, y: surfaceY,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 1.2,
            size: 1.2 + Math.random() * 1.5,
            life: 22 + Math.random() * 10,
          });
        }
      } else {
        still.push(d);
      }
    }
    this.drops = still;

    // splashes
    for (const s of this.splashes) {
      s.vy += 0.35 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    this.splashes = this.splashes.filter((s) => s.life > 0);

    // spills (cascade)
    for (const s of this.spills) {
      s.vy += 0.42 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    this.spills = this.spills.filter((s) => s.life > 0 && s.y < this.y + this.h + 200);

    // wave spring physics
    const k = 0.14;
    const damping = 0.955;
    for (let i = 0; i < this.segments; i++) {
      this.surfaceV[i] += -k * this.surfaceY[i];
      this.surfaceV[i] *= damping;
    }
    const spread = 0.22;
    const deltas = new Array(this.segments).fill(0);
    for (let i = 0; i < this.segments - 1; i++) {
      const d = spread * (this.surfaceY[i + 1] - this.surfaceY[i]);
      deltas[i] += d;
      deltas[i + 1] -= d;
    }
    for (let i = 0; i < this.segments; i++) {
      this.surfaceY[i] += (this.surfaceV[i] + deltas[i]) * dt;
    }

    // ambient shimmer near critical
    const nearCrit = excess / this.criticalExcess;
    if (!this.overflow && nearCrit > 0.6 && Math.random() < 0.05) {
      const idx = Math.floor(Math.random() * this.segments);
      this.surfaceV[idx] += (Math.random() - 0.5) * 0.15 * nearCrit;
    }

    // spill effect can also be triggered externally by triggerOverflow()
    // overflow condition: dome exceeds max
    if (!this.overflow && this.authoritative && excess > this.criticalExcess) {
      this.triggerOverflow();
    }
  }
  triggerOverflow() {
    if (this.overflow) return;
    this.overflow = true;
    this.overflowT = 80;
    this.wobble = 10;
    playSpill();
    for (let k = 0; k < 60; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const edgeX = side < 0 ? this.x : this.x + this.w;
      this.spills.push({
        x: edgeX + side * (Math.random() * 4),
        y: this.y + 3 + Math.random() * 4,
        vx: side * (0.4 + Math.random() * 0.8),
        vy: 0.4 + Math.random() * 1.2,
        size: 2 + Math.random() * 2,
        life: 90 + Math.random() * 40,
      });
    }
  }
  draw(ctx) {
    const wob = (Math.random() - 0.5) * this.wobble;
    const x = this.x + wob;
    const y = this.y;
    const w = this.w;
    const h = this.h;

    const excess = Math.max(0, this.volume - this.rimVolume);
    const domeHMax = w * 0.22;
    const domeH = Math.min(domeHMax, (excess / this.criticalExcess) * domeHMax);
    const rimLevel = Math.min(this.volume, this.rimVolume);
    const baseFillH = (rimLevel / this.rimVolume) * h;
    const rimBaselineY = y + h - baseFillH;

    // interior tint
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.015)";
    ctx.fillRect(x, y, w, h);

    // water body
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    // start of surface
    for (let i = 0; i < this.segments; i++) {
      const px = x + (i / (this.segments - 1)) * w;
      const t = (i / (this.segments - 1) - 0.5) * 2;
      const dome = domeH * Math.max(0, 1 - t * t);
      const py = rimBaselineY - dome + this.surfaceY[i];
      if (i === 0) ctx.lineTo(x, py);
      else {
        const prevX = x + ((i - 1) / (this.segments - 1)) * w;
        const prevT = ((i - 1) / (this.segments - 1) - 0.5) * 2;
        const prevDome = domeH * Math.max(0, 1 - prevT * prevT);
        const prevY = rimBaselineY - prevDome + this.surfaceY[i - 1];
        const midX = (prevX + px) / 2;
        const midY = (prevY + py) / 2;
        ctx.quadraticCurveTo(prevX, prevY, midX, midY);
      }
    }
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(x, rimBaselineY - domeH, x, y + h);
    grad.addColorStop(0, `rgba(${this.liquid.top},0.95)`);
    grad.addColorStop(0.5, `rgba(${this.liquid.mid},0.98)`);
    grad.addColorStop(1, `rgba(${this.liquid.bot},1)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // subtle inner darker line at rim (meniscus edge)
    if (excess > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(${this.liquid.bot},0.4)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, rimBaselineY);
      ctx.lineTo(x + w - 2, rimBaselineY);
      ctx.stroke();
      ctx.restore();
    }

    // surface highlight
    ctx.beginPath();
    for (let i = 0; i < this.segments; i++) {
      const px = x + (i / (this.segments - 1)) * w;
      const t = (i / (this.segments - 1) - 0.5) * 2;
      const dome = domeH * Math.max(0, 1 - t * t);
      const py = rimBaselineY - dome + this.surfaceY[i] + 0.5;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // near-critical warning glow at surface center
    const nearCrit = excess / this.criticalExcess;
    if (nearCrit > 0.4 && !this.overflow) {
      const cx = x + w / 2;
      const cy = rimBaselineY - domeH;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      g.addColorStop(0, `rgba(255,120,120,${(nearCrit - 0.4) * 0.4})`);
      g.addColorStop(1, "rgba(255,120,120,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // drops
    for (const d of this.drops) {
      const g2 = ctx.createRadialGradient(d.x, d.y - 1, 0, d.x, d.y, d.size);
      g2.addColorStop(0, `rgba(255,255,255,0.7)`);
      g2.addColorStop(0.4, `rgba(${this.liquid.dropMid},0.95)`);
      g2.addColorStop(1, `rgba(${this.liquid.dropDeep},1)`);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.size * 1.5);
      ctx.quadraticCurveTo(d.x + d.size, d.y - d.size * 0.4, d.x + d.size, d.y);
      ctx.arc(d.x, d.y, d.size, 0, Math.PI, false);
      ctx.quadraticCurveTo(d.x - d.size, d.y - d.size * 0.4, d.x, d.y - d.size * 1.5);
      ctx.closePath();
      ctx.fill();
    }

    // splashes
    for (const s of this.splashes) {
      const a = Math.max(0, Math.min(1, s.life / 30));
      ctx.fillStyle = `rgba(${this.liquid.splash},${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // spills (cascading over the sides)
    for (const s of this.spills) {
      const a = Math.max(0, Math.min(1, s.life / 60));
      ctx.fillStyle = `rgba(${this.liquid.mid},${a * 0.85})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // glass outline
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - 1.5, y);
    ctx.lineTo(x - 1.5, y + h);
    ctx.lineTo(x + w + 1.5, y + h);
    ctx.lineTo(x + w + 1.5, y);
    ctx.stroke();
    // glass reflection
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 8);
    ctx.lineTo(x + 6, y + h - 8);
    ctx.stroke();
    ctx.restore();

    // overflow red flash on glass
    if (this.overflowT > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(239,68,68,${(this.overflowT / 80) * 0.35})`;
      ctx.fillRect(x - 10, y - 20, w + 20, h + 30);
      ctx.restore();
    }
  }
}

// ---------- component ----------

export default function Game() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState("lobby");
  const [playerCount, setPlayerCount] = useState(3);
  const [liquidId, setLiquidId] = useState("water");
  const [players, setPlayers] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pouring, setPouring] = useState(false);
  const [loser, setLoser] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | pouring | settling | ended

  // networking
  const [netMode, setNetMode] = useState("local"); // local | host | guest
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle"); // idle | opening | ready | error
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [muted, setMutedState] = useState(false);

  useEffect(() => { setMutedState(isMuted()); }, []);
  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const currentIdxRef = useRef(0);
  const playersRef = useRef([]);
  const phaseRef = useRef(phase);
  const pouringRef = useRef(false);
  const dropTimerRef = useRef(null);
  const botTimersRef = useRef([]);
  const netModeRef = useRef("local");
  const peerRef = useRef(null);
  const guestConnsRef = useRef(new Map()); // host: peerId -> conn
  const hostConnRef = useRef(null);         // guest: connection to host
  const nextGuestIdxRef = useRef(1);

  useEffect(() => { netModeRef.current = netMode; }, [netMode]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { pouringRef.current = pouring; }, [pouring]);

  const clearBotTimers = useCallback(() => {
    for (const t of botTimersRef.current) clearTimeout(t);
    botTimersRef.current = [];
  }, []);

  const stopDrops = useCallback(() => {
    if (dropTimerRef.current) {
      clearInterval(dropTimerRef.current);
      dropTimerRef.current = null;
    }
  }, []);

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
    const glassW = Math.min(220, rect.width * 0.5);
    const glassH = Math.min(400, rect.height * 0.55);
    const glassX = (rect.width - glassW) / 2;
    const glassY = rect.height * 0.25;
    g.glass.reposition(glassX, glassY, glassW, glassH);
  }, []);

  // init runtime
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const g = {
      w: 0, h: 0,
      glass: new Glass(),
    };
    gameRef.current = g;
    layout();
    const onResize = () => layout();
    window.addEventListener("resize", onResize);

    let last = performance.now();
    function loop(now) {
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      g.glass.update(dt);
      ctx.clearRect(0, 0, g.w, g.h);
      drawBg(ctx, g);
      g.glass.draw(ctx);
      raf = requestAnimationFrame(loop);
    }
    let raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [layout]);

  const advanceTurn = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    if (g.glass.overflow) {
      // current player loses
      const cur = playersRef.current[currentIdxRef.current];
      setLoser(cur);
      setStatus("ended");
      setPhase("ended");
      if (netModeRef.current === "host") {
        for (const conn of guestConnsRef.current.values()) {
          if (conn.open) {
            try { conn.send({ t: "end", lp: cur.peerId || null, name: cur.name }); } catch {}
          }
        }
      }
      clearBotTimers();
      stopDrops();
      return;
    }
    setStatus("settling");
    const t = setTimeout(() => {
      const next = (currentIdxRef.current + 1) % playersRef.current.length;
      setCurrentIdx(next);
      setStatus("idle");
    }, SETTLE_MS);
    botTimersRef.current.push(t);
  }, [clearBotTimers, stopDrops]);

  const startPour = useCallback(() => {
    const g = gameRef.current;
    if (!g || phaseRef.current !== "playing" || pouringRef.current) return;
    const cur = playersRef.current[currentIdxRef.current];
    if (!cur) return;
    setPouring(true);
    setStatus("pouring");
    stopDrops();
    const emit = () => {
      if (!gameRef.current) return;
      gameRef.current.glass.addDrop(cur.color);
      if (netModeRef.current === "host") {
        for (const conn of guestConnsRef.current.values()) {
          if (conn.open) { try { conn.send({ t: "dr", c: cur.color }); } catch {} }
        }
      }
      if (gameRef.current.glass.overflow) {
        stopDrops();
        setPouring(false);
        const t = setTimeout(() => advanceTurn(), 600);
        botTimersRef.current.push(t);
      }
    };
    // guarantee at least one drop even for very short pours
    emit();
    dropTimerRef.current = setInterval(emit, DROP_INTERVAL_MS);
  }, [stopDrops, advanceTurn]);

  const stopPour = useCallback(() => {
    if (!pouringRef.current) return;
    stopDrops();
    setPouring(false);
    // let last drops land before advancing
    const t = setTimeout(() => advanceTurn(), 400);
    botTimersRef.current.push(t);
  }, [stopDrops, advanceTurn]);

  // ---------- networking ----------

  const broadcast = useCallback((msg) => {
    for (const conn of guestConnsRef.current.values()) {
      if (conn.open) {
        try { conn.send(msg); } catch {}
      }
    }
  }, []);

  const sendToHost = useCallback((msg) => {
    const c = hostConnRef.current;
    if (c && c.open) {
      try { c.send(msg); } catch {}
    }
  }, []);

  const broadcastLobby = useCallback(() => {
    broadcast({
      t: "lob",
      liquid: /* read latest */ null, // filled below via effect that watches liquid
      players: playersRef.current.map((p) => ({
        id: p.id, name: p.name, color: p.color, isHuman: p.isHuman, peerId: p.peerId || null,
      })),
      phase: phaseRef.current,
    });
  }, [broadcast]);

  const broadcastState = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    broadcast({
      t: "st",
      v: g.glass.volume,
      ov: g.glass.overflow,
      i: currentIdxRef.current,
      ph: phaseRef.current,
      po: pouringRef.current,
    });
  }, [broadcast]);

  const handleHostMessage = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    if (data.t === "lob") {
      if (data.players) {
        setPlayers(data.players);
        playersRef.current = data.players;
      }
      if (data.liquid) {
        setLiquidId(data.liquid);
        const g = gameRef.current;
        if (g) g.glass.setLiquid(LIQUIDS.find((l) => l.id === data.liquid) || LIQUIDS[0]);
      }
    } else if (data.t === "st") {
      const g = gameRef.current;
      if (g) {
        g.glass.volume = data.v;
        if (data.ov && !g.glass.overflow) g.glass.triggerOverflow();
      }
      setCurrentIdx(data.i);
      setPhase(data.ph);
      setPouring(data.po);
    } else if (data.t === "dr") {
      const g = gameRef.current;
      if (g) g.glass.addDrop(data.c || "#4cc9f0");
    } else if (data.t === "end") {
      setLoser({ name: data.name, isHuman: peerRef.current && peerRef.current.id === data.lp });
      setPhase("ended");
    } else if (data.t === "reset") {
      // host is going back to lobby
      setPhase("lobby");
      setLoser(null);
      const g = gameRef.current;
      if (g) g.glass.reset(g.glass.x, g.glass.y, g.glass.w, g.glass.h);
    }
  }, []);

  const handleGuestMessage = useCallback((conn, data) => {
    if (!data || typeof data !== "object") return;
    if (data.t === "hello") {
      if (playersRef.current.find((p) => p.peerId === conn.peer)) return;
      if (playersRef.current.length >= 5) return; // full
      const taken = new Set(playersRef.current.map((p) => p.name));
      const requested = (data.name || "").toString().trim().toLowerCase().slice(0, 12);
      const name = requested && !taken.has(requested) ? requested : pickName(taken);
      const idx = playersRef.current.length;
      const newP = {
        id: idx,
        isHuman: true,
        name,
        color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
        peerId: conn.peer,
        personality: null,
      };
      const updated = [...playersRef.current, newP];
      setPlayers(updated);
      playersRef.current = updated;
      setTimeout(() => broadcastLobby(), 10);
    } else if (data.t === "p1") {
      const idx = playersRef.current.findIndex((p) => p.peerId === conn.peer);
      if (idx === currentIdxRef.current && phaseRef.current === "playing") startPour();
    } else if (data.t === "p0") {
      if (pouringRef.current) stopPour();
    }
  }, [broadcastLobby, startPour, stopPour]);

  const startHosting = useCallback(() => {
    if (peerRef.current) return;
    initAudio();
    const rid = makeRoomId();
    setRoomId(rid);
    setNetMode("host");
    netModeRef.current = "host";
    setNetStatus("opening");
    setNetError(null);
    const peer = new Peer(hostPeerId(rid), { debug: 1 });
    peer.on("open", () => {
      setNetStatus("ready");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("room", rid);
        window.history.replaceState({}, "", url.toString());
      }
      const me = {
        id: 0, isHuman: true, name: "you",
        color: PLAYER_COLORS[0], peerId: null, personality: null,
      };
      setPlayers([me]);
      playersRef.current = [me];
    });
    peer.on("connection", (conn) => {
      conn.on("open", () => {
        guestConnsRef.current.set(conn.peer, conn);
      });
      conn.on("data", (data) => handleGuestMessage(conn, data));
      conn.on("close", () => {
        guestConnsRef.current.delete(conn.peer);
        const updated = playersRef.current.filter((p) => p.peerId !== conn.peer);
        setPlayers(updated);
        playersRef.current = updated;
        setTimeout(() => broadcastLobby(), 10);
      });
    });
    peer.on("error", (err) => {
      setNetError(String(err?.type || err?.message || err));
      setNetStatus("error");
    });
    peerRef.current = peer;
  }, [handleGuestMessage, broadcastLobby]);

  const joinRoom = useCallback((rid) => {
    if (peerRef.current) return;
    setRoomId(rid);
    setNetMode("guest");
    netModeRef.current = "guest";
    setNetStatus("opening");
    setNetError(null);
    const g = gameRef.current;
    if (g) g.glass.setAuthoritative(false);
    const peer = new Peer(undefined, { debug: 1 });
    peer.on("open", () => {
      const conn = peer.connect(hostPeerId(rid), { reliable: true });
      conn.on("open", () => {
        setNetStatus("ready");
        conn.send({ t: "hello", name: null });
      });
      conn.on("data", handleHostMessage);
      conn.on("close", () => {
        setNetError("host left");
        setNetStatus("error");
      });
      hostConnRef.current = conn;
    });
    peer.on("error", (err) => {
      setNetError(String(err?.type || err?.message || err));
      setNetStatus("error");
    });
    peerRef.current = peer;
  }, [handleHostMessage]);

  const leaveNet = useCallback(() => {
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch {}
      peerRef.current = null;
    }
    guestConnsRef.current.clear();
    hostConnRef.current = null;
    setNetMode("local");
    netModeRef.current = "local";
    setRoomId(null);
    setNetStatus("idle");
    setNetError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.pathname);
    }
    const g = gameRef.current;
    if (g) g.glass.setAuthoritative(true);
    setPlayers([]);
    setPhase("lobby");
  }, []);

  // auto-join from URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r && !peerRef.current) joinRoom(r);
    // eslint-disable-next-line
  }, []);

  // broadcast lobby whenever players or liquid change (host only)
  useEffect(() => {
    if (netMode !== "host") return;
    broadcast({
      t: "lob",
      liquid: liquidId,
      players: players.map((p) => ({
        id: p.id, name: p.name, color: p.color, isHuman: p.isHuman, peerId: p.peerId || null,
      })),
      phase,
    });
  }, [netMode, players, liquidId, phase, broadcast]);

  // broadcast state at 20 Hz during play (host only)
  useEffect(() => {
    if (netMode !== "host") return;
    if (phase !== "playing") return;
    const iv = setInterval(() => broadcastState(), 50);
    return () => clearInterval(iv);
  }, [netMode, phase, broadcastState]);

  // sound cues
  useEffect(() => {
    if (phase === "playing") playStart();
  }, [phase]);

  const prevIdxRef = useRef(0);
  useEffect(() => {
    if (phase === "playing" && currentIdx !== prevIdxRef.current) {
      playTurn();
    }
    prevIdxRef.current = currentIdx;
  }, [currentIdx, phase]);

  useEffect(() => {
    if (phase !== "ended" || !loser) return;
    let mine = false;
    if (netMode === "local" || netMode === "host") {
      mine = loser.isHuman && loser.peerId == null;
    } else {
      mine = loser.isHuman && peerRef.current && loser.peerId === peerRef.current.id;
    }
    if (mine) playLose(); else playWin();
  }, [phase, loser, netMode]);

  // bot turn driver — host/local only
  useEffect(() => {
    if (netMode === "guest") return;
    if (phase !== "playing") return;
    if (status !== "idle") return;
    const cur = players[currentIdx];
    if (!cur || cur.isHuman) return;
    const p = cur.personality;
    const thinkMs = p.think[0] + Math.random() * (p.think[1] - p.think[0]);
    let pourMs = p.pourMs[0] + Math.random() * (p.pourMs[1] - p.pourMs[0]);
    // bot "sees" the dome and pulls back a little if it's already scary
    const g = gameRef.current;
    if (g) {
      const excessFrac = Math.max(0, (g.glass.volume - g.glass.rimVolume) / g.glass.criticalExcess);
      if (excessFrac > 0.55) pourMs *= 0.6;
      if (excessFrac > 0.8) pourMs *= 0.5;
    }
    const t1 = setTimeout(() => {
      startPour();
      const t2 = setTimeout(() => stopPour(), pourMs);
      botTimersRef.current.push(t2);
    }, thinkMs);
    botTimersRef.current.push(t1);
    return () => { clearTimeout(t1); };
  }, [netMode, phase, status, currentIdx, players, startPour, stopPour]);

  // start match — host or local only (guests are passive)
  const startMatch = useCallback((count) => {
    if (netModeRef.current === "guest") return;
    initAudio();
    clearBotTimers();
    stopDrops();
    const g = gameRef.current;
    if (!g) return;
    const arr = [];
    const taken = new Set();

    if (netModeRef.current === "host") {
      // preserve host + connected guests as human players
      const humans = playersRef.current.filter((p) => p.isHuman);
      for (const p of humans) {
        if (arr.length >= 5) break;
        const idx = arr.length;
        taken.add(p.name);
        arr.push({
          ...p,
          id: idx,
          isHuman: true,
          color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
          personality: null,
        });
      }
    } else {
      arr.push({
        id: 0, isHuman: true, name: "you",
        color: PLAYER_COLORS[0], peerId: null, personality: null,
      });
      taken.add("you");
    }

    while (arr.length < count && arr.length < 5) {
      const name = pickName(taken);
      taken.add(name);
      const idx = arr.length;
      arr.push({
        id: idx,
        isHuman: false,
        name,
        color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
        peerId: null,
        personality: pickPersonality(),
      });
    }

    setPlayers(arr);
    playersRef.current = arr;
    setCurrentIdx(0);
    setLoser(null);
    setStatus("idle");
    g.glass.reset(g.glass.x, g.glass.y, g.glass.w, g.glass.h);
    const liq = LIQUIDS.find((l) => l.id === liquidId) || LIQUIDS[0];
    g.glass.setLiquid(liq);
    layout();
    setPhase("playing");
  }, [clearBotTimers, stopDrops, layout, liquidId]);

  // determine whether the CURRENT player is "me" on this client
  const isMyTurn = useCallback(() => {
    const cur = players[currentIdx];
    if (!cur || !cur.isHuman) return false;
    if (netMode === "guest") {
      return peerRef.current && cur.peerId === peerRef.current.id;
    }
    // local/host: it's mine if it's the first human (id=0)
    return cur.peerId == null || cur.peerId === undefined;
  }, [players, currentIdx, netMode]);

  const onPointerDown = useCallback((e) => {
    if (phase !== "playing") return;
    if (status !== "idle") return;
    if (!isMyTurn()) return;
    e.preventDefault();
    if (netMode === "guest") sendToHost({ t: "p1" });
    else startPour();
  }, [phase, status, isMyTurn, netMode, sendToHost, startPour]);

  const onPointerUp = useCallback((e) => {
    if (phase !== "playing") return;
    if (!isMyTurn()) return;
    e.preventDefault();
    if (netMode === "guest") sendToHost({ t: "p0" });
    else if (pouring) stopPour();
  }, [phase, isMyTurn, netMode, sendToHost, pouring, stopPour]);

  useEffect(() => () => {
    clearBotTimers();
    stopDrops();
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch {}
      peerRef.current = null;
    }
  }, [clearBotTimers, stopDrops]);

  const dec = () => setPlayerCount((c) => Math.max(1, c - 1));
  const inc = () => setPlayerCount((c) => Math.min(5, c + 1));

  const current = players[currentIdx];

  return (
    <div
      className="relative w-full h-[100dvh] bg-[#050510] text-white font-mono overflow-hidden select-none touch-none"
      style={{ touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* mute toggle — top right */}
      <button
        type="button"
        onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono tracking-widest px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation"
        aria-label={muted ? "unmute" : "mute"}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* tap catcher during play */}
      {phase === "playing" && (
        <div
          className="absolute inset-0 z-0"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      )}

      {/* Turn indicator */}
      {phase === "playing" && current && (
        <div className="pointer-events-none absolute top-0 inset-x-0 pt-16 sm:pt-20 flex flex-col items-center z-10">
          <div className="text-white/40 text-[10px] uppercase tracking-widest mb-1">turn</div>
          <div
            className="text-2xl sm:text-3xl font-semibold tracking-tight"
            style={{ color: current.color }}
          >
            {current.isHuman ? "your turn" : `${current.name}'s turn`}
          </div>
          {current.isHuman && status === "idle" && (
            <div className="text-white/50 text-xs mt-2">tap and hold to pour</div>
          )}
          {status === "pouring" && !current.isHuman && (
            <div className="text-white/50 text-xs mt-2">pouring…</div>
          )}
          {status === "settling" && (
            <div className="text-white/40 text-xs mt-2">…</div>
          )}
        </div>
      )}

      {/* Turn queue at bottom */}
      {phase === "playing" && players.length > 0 && (
        <div className="pointer-events-none absolute bottom-6 inset-x-0 flex justify-center gap-3">
          {players.map((p, i) => (
            <div key={p.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-2.5 h-2.5 rounded-full transition ${
                  i === currentIdx ? "scale-150 shadow-[0_0_10px_currentColor]" : "opacity-40"
                }`}
                style={{ background: p.color, color: p.color }}
              />
              <div className={`text-[10px] font-mono ${i === currentIdx ? "text-white" : "text-white/40"}`}>
                {p.isHuman ? "you" : p.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-6 z-10 overflow-y-auto py-8">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">water drop</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tighter leading-none mb-2">
              don't spill.
            </h1>
            <p className="text-white/60 max-w-sm mx-auto text-sm sm:text-base">
              take turns adding water. whoever tips it over loses.
            </p>
          </div>

          {/* LOCAL mode */}
          {netMode === "local" && (
            <>
              <div className="flex flex-col items-center gap-2">
                <div className="text-white/50 text-[10px] uppercase tracking-widest">players</div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={dec}
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-xl cursor-pointer touch-manipulation">−</button>
                  <div className="w-16 text-center text-3xl font-semibold tabular-nums">{playerCount}</div>
                  <button type="button" onClick={inc}
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-xl cursor-pointer touch-manipulation">+</button>
                </div>
                <div className="text-white/40 text-xs">
                  {playerCount === 1 ? "solo" : `you + ${playerCount - 1} bot${playerCount > 2 ? "s" : ""}`}
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="text-white/50 text-[10px] uppercase tracking-widest">liquid</div>
                <div className="flex items-center gap-2 flex-wrap justify-center max-w-xs">
                  {LIQUIDS.map((l) => {
                    const active = l.id === liquidId;
                    return (
                      <button key={l.id} type="button" onClick={() => setLiquidId(l.id)}
                        className={`relative w-9 h-9 rounded-full transition cursor-pointer touch-manipulation active:scale-95 ${
                          active ? "ring-2 ring-white ring-offset-2 ring-offset-[#050510]" : "ring-1 ring-white/10 hover:ring-white/30"
                        }`}
                        style={{ background: l.swatch }} aria-label={l.label} title={l.label} />
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col items-center gap-3">
                <button type="button" onClick={() => startMatch(playerCount)}
                  className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  start
                </button>
                <button type="button" onClick={startHosting}
                  className="text-white/60 hover:text-white text-sm underline underline-offset-4 cursor-pointer touch-manipulation">
                  play with friends →
                </button>
              </div>
            </>
          )}

          {/* HOST mode — waiting room */}
          {netMode === "host" && (
            <>
              <div className="w-full max-w-sm">
                {netStatus === "opening" && (
                  <div className="text-white/60 text-sm">creating room…</div>
                )}
                {netStatus === "error" && (
                  <div className="text-red-400 text-sm">{netError || "connection failed"}</div>
                )}
                {netStatus === "ready" && roomId && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">room code</div>
                    <div className="text-3xl font-mono font-semibold tracking-widest">{roomId}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1400);
                        } catch {}
                      }}
                      className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm cursor-pointer touch-manipulation"
                    >
                      {copied ? "copied ✓" : "copy invite link"}
                    </button>
                    <div className="text-white/30 text-xs break-all max-w-full">
                      {typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?room=${roomId}` : ""}
                    </div>
                  </div>
                )}
              </div>

              {netStatus === "ready" && (
                <>
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">joined</div>
                    <div className="flex gap-2 flex-wrap justify-center max-w-sm">
                      {players.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 bg-white/5 rounded-full px-2.5 py-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          <span className="text-xs font-mono">{p.isHuman ? (p.peerId ? p.name : "you (host)") : p.name}</span>
                        </div>
                      ))}
                      {players.length < 5 && (
                        <div className="text-white/30 text-xs self-center">…waiting for more</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">total (bots fill rest)</div>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={dec}
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-lg cursor-pointer touch-manipulation">−</button>
                      <div className="w-12 text-center text-2xl font-semibold tabular-nums">{Math.max(playerCount, players.length)}</div>
                      <button type="button" onClick={inc}
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition text-lg cursor-pointer touch-manipulation">+</button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">liquid</div>
                    <div className="flex items-center gap-2 flex-wrap justify-center max-w-xs">
                      {LIQUIDS.map((l) => (
                        <button key={l.id} type="button" onClick={() => setLiquidId(l.id)}
                          className={`w-8 h-8 rounded-full transition cursor-pointer touch-manipulation active:scale-95 ${
                            l.id === liquidId ? "ring-2 ring-white ring-offset-2 ring-offset-[#050510]" : "ring-1 ring-white/10 hover:ring-white/30"
                          }`}
                          style={{ background: l.swatch }} title={l.label} />
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    <button type="button"
                      onClick={() => startMatch(Math.max(playerCount, players.length))}
                      className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                      start game
                    </button>
                    <button type="button" onClick={leaveNet}
                      className="text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation">
                      cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* GUEST mode — waiting for host */}
          {netMode === "guest" && (
            <>
              <div className="w-full max-w-sm">
                {netStatus === "opening" && (
                  <div className="text-white/60 text-sm">joining room {roomId}…</div>
                )}
                {netStatus === "error" && (
                  <div className="text-red-400 text-sm">{netError || "couldn't connect"}</div>
                )}
                {netStatus === "ready" && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">room</div>
                    <div className="text-2xl font-mono font-semibold tracking-widest">{roomId}</div>
                    <div className="text-white/50 text-sm">waiting for host to start…</div>
                  </div>
                )}
              </div>

              {netStatus === "ready" && players.length > 0 && (
                <div className="flex flex-col items-center gap-2">
                  <div className="text-white/50 text-[10px] uppercase tracking-widest">players</div>
                  <div className="flex gap-2 flex-wrap justify-center max-w-sm">
                    {players.map((p) => {
                      const isMe = peerRef.current && p.peerId === peerRef.current.id;
                      return (
                        <div key={p.id} className="flex items-center gap-1.5 bg-white/5 rounded-full px-2.5 py-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          <span className="text-xs font-mono">{isMe ? "you" : p.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button type="button" onClick={leaveNet}
                className="text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation">
                leave
              </button>
            </>
          )}
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && loser && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-white/50 text-[10px] uppercase tracking-widest mb-2">
              {loser.isHuman ? "you spilled" : "spilled"}
            </div>
            <div className="text-3xl font-semibold tracking-tight mb-1">
              {loser.isHuman ? "you lose" : `${loser.name} loses`}
            </div>
            <div className="text-white/40 text-xs mb-6">
              {loser.isHuman ? "shoulda stopped sooner" : "get 'em next round"}
            </div>
            <div className="flex gap-2">
              {netMode !== "guest" ? (
                <button
                  type="button"
                  onClick={() => startMatch(Math.max(playerCount, players.length))}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
                >
                  rematch
                </button>
              ) : (
                <div className="flex-1 py-3 text-white/50 text-sm text-center">waiting for host…</div>
              )}
              <button
                type="button"
                onClick={() => netMode === "local" ? setPhase("lobby") : leaveNet()}
                className="flex-1 py-3 rounded-full text-white/60 hover:text-white transition cursor-pointer touch-manipulation"
              >
                {netMode === "local" ? "lobby" : "leave"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function drawBg(ctx, g) {
  const grad = ctx.createRadialGradient(g.w / 2, g.h * 0.45, 0, g.w / 2, g.h * 0.45, Math.max(g.w, g.h));
  grad.addColorStop(0, "rgba(30,55,110,0.4)");
  grad.addColorStop(1, "rgba(5,5,16,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, g.w, g.h);
}
