// Web Audio synthesized sound effects (no external assets).
// All sounds are procedurally generated — filtered noise, oscillators.
// Call initAudio() from a user gesture (button click) to unlock.

let ctx = null;
let master = null;
let muted = false;
let initialized = false;

export function initAudio() {
  if (typeof window === "undefined") return;
  if (initialized) {
    if (ctx && ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    try {
      muted = localStorage.getItem("mb-muted") === "1";
    } catch {}
    master.gain.value = muted ? 0 : 0.5;
    initialized = true;
  } catch {}
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem("mb-muted", muted ? "1" : "0"); } catch {}
  if (master) master.gain.value = muted ? 0 : 0.5;
}

function alive() {
  if (!ctx || muted) return false;
  if (ctx.state === "suspended") { try { ctx.resume(); } catch {} }
  return true;
}

// Drop plop — pitched sine that drops in frequency (classic water plop)
export function playDrop() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  const startF = 220 + Math.random() * 140;
  const endF = 55 + Math.random() * 25;
  osc.frequency.setValueAtTime(startF, now);
  osc.frequency.exponentialRampToValueAtTime(endF, now + 0.12);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.16, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.2);
}

// Splash — high-pass noise burst
export function playSplash() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const dur = 0.13;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "highpass";
  flt.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.value = 0.09;
  src.connect(flt).connect(g).connect(master);
  src.start(now);
}

// Spill — dramatic cascade + low thud
export function playSpill() {
  if (!alive()) return;
  const now = ctx.currentTime;
  // cascading noise
  const dur = 1.2;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "lowpass";
  flt.frequency.setValueAtTime(3200, now);
  flt.frequency.exponentialRampToValueAtTime(300, now + 1.1);
  const gN = ctx.createGain();
  gN.gain.setValueAtTime(0.32, now);
  gN.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
  src.connect(flt).connect(gN).connect(master);
  src.start(now);

  // thud
  const osc = ctx.createOscillator();
  const gO = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.4);
  gO.gain.setValueAtTime(0.4, now);
  gO.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(gO).connect(master);
  osc.start(now);
  osc.stop(now + 0.55);
}

// Turn advance — soft tick
export function playTurn() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, now);
  g.gain.setValueAtTime(0.07, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Start jingle — quick major triad up
export function playStart() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C E G
  notes.forEach((f, i) => {
    const t0 = now + i * 0.08;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  });
}

// Win chime — bright ascending
export function playWin() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const notes = [659.25, 783.99, 987.77, 1318.51];
  notes.forEach((f, i) => {
    const t0 = now + i * 0.09;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
}

// Chess wood-tap move sound
export function playChessMove() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const dur = 0.09;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "bandpass";
  flt.frequency.value = 600;
  flt.Q.value = 4;
  const g = ctx.createGain();
  g.gain.value = 0.32;
  src.connect(flt).connect(g).connect(master);
  src.start(now);
  // low thud
  const osc = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(85, now + 0.06);
  g2.gain.setValueAtTime(0.22, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(g2).connect(master);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Capture — harsher, two-part
export function playChessCapture() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const dur = 0.16;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / d.length;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.6);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const flt = ctx.createBiquadFilter();
  flt.type = "bandpass";
  flt.frequency.value = 350;
  flt.Q.value = 2.5;
  const g = ctx.createGain();
  g.gain.value = 0.38;
  src.connect(flt).connect(g).connect(master);
  src.start(now);
  const osc = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.13);
  g2.gain.setValueAtTime(0.3, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(g2).connect(master);
  osc.start(now);
  osc.stop(now + 0.17);
}

// Check — alert ping
export function playChessCheck() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.12);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.13, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.22);
}

// Castle — double tap
export function playChessCastle() {
  if (!alive()) return;
  playChessMove();
  const c = ctx;
  setTimeout(() => { if (c) playChessMove(); }, 90);
}

// Merge pop — pitched to tier (higher tier = brighter)
export function playMerge(tier) {
  if (!alive()) return;
  const now = ctx.currentTime;
  const base = 300 + tier * 80;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(base * 0.6, now);
  osc.frequency.exponentialRampToValueAtTime(base, now + 0.05);
  osc.frequency.exponentialRampToValueAtTime(base * 1.3, now + 0.18);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.16, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.24);
  // sparkle overtone
  const osc2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(base * 2, now);
  g2.gain.setValueAtTime(0.06, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc2.connect(g2).connect(master);
  osc2.start(now);
  osc2.stop(now + 0.18);
}

// Correct answer — soft rising ding
export function playCorrect() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const notes = [659.25, 987.77];
  notes.forEach((f, i) => {
    const t0 = now + i * 0.05;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.13, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  });
}

// Wrong answer — short buzz
export function playWrong() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.linearRampToValueAtTime(120, now + 0.15);
  g.gain.setValueAtTime(0.11, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.2);
}

// Countdown tick
export function playTick() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(660, now);
  g.gain.setValueAtTime(0.14, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.14);
}

// "GO" — louder chime
export function playGo() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.25);
  g.gain.setValueAtTime(0.22, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.4);
}

// Soft key click
export function playKey() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1200, now);
  g.gain.setValueAtTime(0.03, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.04);
}

// Lose sting — descending minor
export function playLose() {
  if (!alive()) return;
  const now = ctx.currentTime;
  const notes = [440, 392, 329.63];
  notes.forEach((f, i) => {
    const t0 = now + i * 0.12;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.11, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  });
}
