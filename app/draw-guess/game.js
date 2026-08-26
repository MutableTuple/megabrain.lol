"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Peer from "peerjs";
import { WORDS } from "./words";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playGo, playTick, playWin, playLose } from "../lib/sound";

const ROUND_MS = 70000;
const REVEAL_MS = 4000;
const CYCLES = 2; // each player draws twice
const NAMES = ["aarav","diya","mia","leo","zara","kabir","priya","noah","ivy","yusuf","sana","milo","ava"];
const SUFFIXES = ["","","","","88","07","23","_","x"];
const COLORS = ["#4cc9f0", "#c77dff", "#06d6a0", "#ffd166"];

function randomName(taken = new Set()) {
  for (let i = 0; i < 40; i++) {
    const n = NAMES[Math.floor(Math.random()*NAMES.length)] + SUFFIXES[Math.floor(Math.random()*SUFFIXES.length)];
    if (!taken.has(n)) return n;
  }
  return NAMES[Math.floor(Math.random()*NAMES.length)];
}
function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function hostPeerId(rid) { return `mb-dg-${rid}`; }
function pickWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }
function wordDisplay(word, revealChars = 0) {
  return word.split("").map((c) => (c === " " ? "  " : (revealChars > 0 ? c : "_"))).join(" ");
}

export default function Game() {
  const canvasRef = useRef(null);
  const chatInputRef = useRef(null);

  // net + phase
  const [netMode, setNetMode] = useState("local"); // local | host | guest
  const [phase, setPhase] = useState("lobby"); // lobby | drawing | reveal | ended
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle");
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);

  const [players, setPlayers] = useState([]); // [{peerId, name, color, isHost}]
  const [scores, setScores] = useState({});   // {peerId: totalPts}
  const [drawerId, setDrawerId] = useState(null);
  const [wordForMe, setWordForMe] = useState(""); // full word if I'm drawer, else display with blanks
  const [wordLen, setWordLen] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_MS);
  const [chat, setChat] = useState([]);       // [{name, color, text, kind}]
  const [chatInput, setChatInput] = useState("");
  const [correctSet, setCorrectSet] = useState(new Set()); // peerIds who got it this round
  const [roundNumber, setRoundNumber] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const [revealed, setRevealed] = useState(null); // {word, roundPoints}
  const [muted, setMutedState] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#f5eedd");

  // refs
  const netModeRef = useRef("local");
  const phaseRef = useRef("lobby");
  const peerRef = useRef(null);
  const connsRef = useRef(new Map());
  const hostConnRef = useRef(null);
  const myPeerIdRef = useRef("host");
  const playersRef = useRef([]);
  const scoresRef = useRef({});
  const drawerIdRef = useRef(null);
  const wordRef = useRef("");
  const roundStartedAtRef = useRef(0);
  const roundOrderRef = useRef([]); // order of peerIds to draw
  const roundIndexRef = useRef(0);
  const correctSetRef = useRef(new Set());
  const timersRef = useRef([]);
  const lastPointRef = useRef(null); // for drawing
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { drawerIdRef.current = drawerId; }, [drawerId]);
  useEffect(() => { correctSetRef.current = correctSet; }, [correctSet]);
  useEffect(() => { setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const clearTimers = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  };

  const send = useCallback((msg, targetPeerId) => {
    if (netModeRef.current === "host") {
      if (targetPeerId) {
        const c = connsRef.current.get(targetPeerId);
        if (c?.open) try { c.send(msg); } catch {}
      } else {
        for (const c of connsRef.current.values()) if (c.open) try { c.send(msg); } catch {}
      }
    } else if (netModeRef.current === "guest") {
      const c = hostConnRef.current;
      if (c?.open) try { c.send(msg); } catch {}
    }
  }, []);

  // --------- canvas ---------
  const dprRef = useRef(1);
  const initCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12121a";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  const clearCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const rect = c.getBoundingClientRect();
    ctx.fillStyle = "#12121a";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  const drawSegment = useCallback((x1, y1, x2, y2, color, size) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const rect = c.getBoundingClientRect();
    // x/y are normalized 0..1
    const px1 = x1 * rect.width, py1 = y1 * rect.height;
    const px2 = x2 * rect.width, py2 = y2 * rect.height;
    ctx.strokeStyle = color;
    ctx.lineWidth = size || 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.stroke();
  }, []);

  useEffect(() => {
    initCanvas();
    const onResize = () => { initCanvas(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [initCanvas, phase]);

  const iAmDrawer = drawerId != null && drawerId === myPeerIdRef.current;

  const onCanvasPointerDown = (e) => {
    if (phaseRef.current !== "drawing" || !iAmDrawer) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    lastPointRef.current = { x, y };
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onCanvasPointerMove = (e) => {
    if (phaseRef.current !== "drawing" || !iAmDrawer) return;
    if (!lastPointRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const p = lastPointRef.current;
    drawSegment(p.x, p.y, x, y, strokeColor, 3);
    // broadcast
    send({ t: "seg", x1: p.x, y1: p.y, x2: x, y2: y, c: strokeColor });
    lastPointRef.current = { x, y };
  };
  const onCanvasPointerUp = () => {
    lastPointRef.current = null;
  };

  const handleClearBoard = () => {
    if (!iAmDrawer) return;
    clearCanvas();
    send({ t: "clear" });
  };

  // --------- round management (host authoritative) ---------
  const finishMatch = useCallback(() => {
    clearTimers();
    setPhase("ended");
    if (netModeRef.current === "host") send({ t: "end", scores: scoresRef.current });
    // audio
    const me = scoresRef.current[myPeerIdRef.current] || 0;
    const others = playersRef.current.filter((p) => p.peerId !== myPeerIdRef.current).map((p) => scoresRef.current[p.peerId] || 0);
    if (me > Math.max(0, ...others)) playWin(); else playLose();
  }, [send]);

  const startReveal = useCallback((forceEndRound) => {
    clearTimers();
    // compute round points
    const roundPoints = {};
    // guessers get 100 - order_pct*50
    const correctList = [...correctSetRef.current];
    correctList.forEach((pid, i) => {
      const pct = i / Math.max(1, correctList.length);
      const pts = Math.round(100 - pct * 40);
      roundPoints[pid] = pts;
    });
    // drawer gets 30 * #correct
    const drawerPts = correctList.filter((p) => p !== drawerIdRef.current).length * 30;
    if (drawerIdRef.current) {
      roundPoints[drawerIdRef.current] = (roundPoints[drawerIdRef.current] || 0) + drawerPts;
    }
    // update totals
    const nextScores = { ...scoresRef.current };
    for (const [pid, pts] of Object.entries(roundPoints)) {
      nextScores[pid] = (nextScores[pid] || 0) + pts;
    }
    scoresRef.current = nextScores;
    setScores(nextScores);
    const rev = { word: wordRef.current, roundPoints };
    setRevealed(rev);
    setPhase("reveal");
    if (netModeRef.current === "host") {
      send({ t: "reveal", word: wordRef.current, roundPoints, scores: nextScores });
    }
    // schedule next round
    const t = setTimeout(() => {
      const nextIdx = roundIndexRef.current + 1;
      if (nextIdx >= roundOrderRef.current.length) {
        finishMatch();
      } else {
        startRound(nextIdx);
      }
    }, REVEAL_MS);
    timersRef.current.push(t);
  }, [send, finishMatch]);

  const startRound = useCallback((idx) => {
    clearTimers();
    roundIndexRef.current = idx;
    setRoundNumber(idx + 1);
    const nextDrawer = roundOrderRef.current[idx];
    const word = pickWord();
    wordRef.current = word;
    correctSetRef.current = new Set();
    setCorrectSet(new Set());
    setDrawerId(nextDrawer);
    drawerIdRef.current = nextDrawer;
    setChat([{ system: true, text: `round ${idx + 1}/${roundOrderRef.current.length} — ${playersRef.current.find((p) => p.peerId === nextDrawer)?.name || "drawer"} is drawing` }]);
    setWordLen(word.length);
    setTimeLeft(ROUND_MS);
    setRevealed(null);
    roundStartedAtRef.current = performance.now();
    setPhase("drawing");
    // clear canvas
    setTimeout(() => { initCanvas(); }, 20);
    // broadcast start
    if (netModeRef.current === "host") {
      // send word only to drawer
      const forDrawer = { t: "roundStart", role: "drawer", word, drawerId: nextDrawer, roundIndex: idx, total: roundOrderRef.current.length };
      const forGuesser = { t: "roundStart", role: "guesser", wordLen: word.length, drawerId: nextDrawer, roundIndex: idx, total: roundOrderRef.current.length };
      // send to each guest based on whether they're the drawer
      for (const p of playersRef.current) {
        if (p.peerId === myPeerIdRef.current) continue;
        if (p.peerId === nextDrawer) send(forDrawer, p.peerId);
        else send(forGuesser, p.peerId);
      }
    }
    // set my word display
    if (nextDrawer === myPeerIdRef.current) {
      setWordForMe(word);
    } else {
      setWordForMe(wordDisplay(word));
    }
    // timer
    const timer = setTimeout(() => {
      if (phaseRef.current === "drawing") startReveal(true);
    }, ROUND_MS + 200);
    timersRef.current.push(timer);
  }, [send, initCanvas, startReveal]);

  // per-tick timer ui
  useEffect(() => {
    if (phase !== "drawing") return;
    const iv = setInterval(() => {
      const left = Math.max(0, ROUND_MS - (performance.now() - roundStartedAtRef.current));
      setTimeLeft(left);
    }, 100);
    return () => clearInterval(iv);
  }, [phase]);

  // ---------- chat / guessing ----------
  const submitGuess = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    if (phaseRef.current !== "drawing") return;
    if (iAmDrawer) return; // drawer can't guess
    if (correctSetRef.current.has(myPeerIdRef.current)) return; // already got it
    setChatInput("");
    if (netModeRef.current === "guest") {
      send({ t: "guess", text });
    } else {
      // host also guesses locally
      processGuessLocally(myPeerIdRef.current, text);
    }
  }, [chatInput, iAmDrawer, send]);

  const addChatMessage = useCallback((msg) => {
    setChat((prev) => [...prev.slice(-100), msg]);
  }, []);

  const processGuessLocally = useCallback((peerId, text) => {
    const player = playersRef.current.find((p) => p.peerId === peerId);
    if (!player) return;
    const guessed = text.trim().toLowerCase();
    const target = wordRef.current.toLowerCase();
    if (guessed === target) {
      // correct
      if (correctSetRef.current.has(peerId)) return;
      const nextSet = new Set(correctSetRef.current);
      nextSet.add(peerId);
      correctSetRef.current = nextSet;
      setCorrectSet(nextSet);
      const msg = { system: true, text: `✓ ${player.name} guessed it!`, kind: "correct" };
      addChatMessage(msg);
      if (netModeRef.current === "host") send({ t: "chat", msg });
      // if all non-drawer players have guessed, end round early
      const nonDrawers = playersRef.current.filter((p) => p.peerId !== drawerIdRef.current);
      if (nonDrawers.every((p) => correctSetRef.current.has(p.peerId))) {
        setTimeout(() => startReveal(false), 300);
      }
      if (peerId === myPeerIdRef.current) playCorrect();
    } else {
      // wrong: broadcast as chat
      const msg = { name: player.name, color: player.color, text, kind: "chat" };
      addChatMessage(msg);
      if (netModeRef.current === "host") send({ t: "chat", msg });
    }
  }, [addChatMessage, send, startReveal]);

  // ---------- networking handlers ----------
  const handleMessage = useCallback((data, conn) => {
    if (!data || typeof data !== "object") return;
    const mode = netModeRef.current;
    if (mode === "host") {
      if (data.t === "hello") {
        const existing = playersRef.current.find((p) => p.peerId === conn.peer);
        if (existing) return;
        if (playersRef.current.length >= 4) return;
        const taken = new Set(playersRef.current.map((p) => p.name));
        const name = randomName(taken);
        const idx = playersRef.current.length;
        const newP = { peerId: conn.peer, name, color: COLORS[idx % 4], isHost: false };
        const updated = [...playersRef.current, newP];
        setPlayers(updated);
        playersRef.current = updated;
        setTimeout(() => send({ t: "lob", players: updated }), 10);
      } else if (data.t === "guess") {
        processGuessLocally(conn.peer, data.text);
      } else if (data.t === "seg") {
        // guest drawing? shouldn't happen (only drawer draws), but relay if drawer is a guest
        if (conn.peer === drawerIdRef.current) {
          drawSegment(data.x1, data.y1, data.x2, data.y2, data.c, 3);
          // relay to other guests
          for (const [pid, c] of connsRef.current.entries()) {
            if (pid !== conn.peer && c.open) try { c.send(data); } catch {}
          }
        }
      } else if (data.t === "clear") {
        if (conn.peer === drawerIdRef.current) {
          clearCanvas();
          for (const [pid, c] of connsRef.current.entries()) {
            if (pid !== conn.peer && c.open) try { c.send({ t: "clear" }); } catch {}
          }
        }
      }
    } else if (mode === "guest") {
      if (data.t === "lob") {
        setPlayers(data.players || []);
      } else if (data.t === "roundStart") {
        clearCanvas();
        setDrawerId(data.drawerId);
        drawerIdRef.current = data.drawerId;
        setRoundNumber(data.roundIndex + 1);
        setTotalRounds(data.total);
        setChat([{ system: true, text: `round ${data.roundIndex + 1}/${data.total} — ${playersRef.current.find((p) => p.peerId === data.drawerId)?.name || "drawer"} is drawing` }]);
        correctSetRef.current = new Set();
        setCorrectSet(new Set());
        setRevealed(null);
        roundStartedAtRef.current = performance.now();
        setTimeLeft(ROUND_MS);
        setPhase("drawing");
        if (data.role === "drawer") {
          wordRef.current = data.word;
          setWordForMe(data.word);
          setWordLen(data.word.length);
        } else {
          wordRef.current = "";
          setWordLen(data.wordLen);
          setWordForMe(wordDisplay("_".repeat(data.wordLen)));
        }
      } else if (data.t === "seg") {
        drawSegment(data.x1, data.y1, data.x2, data.y2, data.c, 3);
      } else if (data.t === "clear") {
        clearCanvas();
      } else if (data.t === "chat") {
        addChatMessage(data.msg);
        if (data.msg.kind === "correct") playCorrect();
      } else if (data.t === "reveal") {
        setRevealed({ word: data.word, roundPoints: data.roundPoints });
        setScores(data.scores);
        scoresRef.current = data.scores;
        setPhase("reveal");
      } else if (data.t === "end") {
        setScores(data.scores);
        scoresRef.current = data.scores;
        setPhase("ended");
        const me = data.scores[myPeerIdRef.current] || 0;
        const others = playersRef.current.filter((p) => p.peerId !== myPeerIdRef.current).map((p) => data.scores[p.peerId] || 0);
        if (me > Math.max(0, ...others)) playWin(); else playLose();
      }
    }
  }, [send, processGuessLocally, drawSegment, clearCanvas, addChatMessage]);

  const startHosting = useCallback(() => {
    if (peerRef.current) return;
    initAudio();
    const rid = makeRoomId();
    setRoomId(rid);
    setNetMode("host");
    netModeRef.current = "host";
    setNetStatus("opening");
    const hpid = hostPeerId(rid);
    myPeerIdRef.current = hpid;
    const me = { peerId: hpid, name: "you", color: COLORS[0], isHost: true };
    setPlayers([me]);
    playersRef.current = [me];
    const peer = new Peer(hpid, { debug: 1 });
    peer.on("open", () => {
      setNetStatus("ready");
      const url = new URL(window.location.href);
      url.searchParams.set("room", rid);
      window.history.replaceState({}, "", url.toString());
    });
    peer.on("connection", (conn) => {
      conn.on("open", () => { connsRef.current.set(conn.peer, conn); });
      conn.on("data", (d) => handleMessage(d, conn));
      conn.on("close", () => {
        connsRef.current.delete(conn.peer);
        const updated = playersRef.current.filter((p) => p.peerId !== conn.peer);
        setPlayers(updated);
        playersRef.current = updated;
        setTimeout(() => send({ t: "lob", players: updated }), 10);
      });
    });
    peer.on("error", (err) => { setNetError(String(err?.type || err?.message || err)); setNetStatus("error"); });
    peerRef.current = peer;
  }, [handleMessage, send]);

  const joinRoom = useCallback((rid) => {
    if (peerRef.current) return;
    setRoomId(rid);
    setNetMode("guest");
    netModeRef.current = "guest";
    setNetStatus("opening");
    const peer = new Peer(undefined, { debug: 1 });
    peer.on("open", (id) => {
      myPeerIdRef.current = id;
      const conn = peer.connect(hostPeerId(rid), { reliable: true });
      conn.on("open", () => {
        setNetStatus("ready");
        hostConnRef.current = conn;
        conn.send({ t: "hello" });
      });
      conn.on("data", (d) => handleMessage(d, conn));
      conn.on("close", () => { setNetError("host left"); setNetStatus("error"); });
    });
    peer.on("error", (err) => { setNetError(String(err?.type || err?.message || err)); setNetStatus("error"); });
    peerRef.current = peer;
  }, [handleMessage]);

  const leaveNet = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch {}; peerRef.current = null; }
    connsRef.current.clear();
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
    setPhase("lobby");
    setPlayers([]);
    playersRef.current = [];
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const r = p.get("room");
    if (r && !peerRef.current) joinRoom(r);
    // eslint-disable-next-line
  }, []);

  useEffect(() => () => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch {}; peerRef.current = null; }
    clearTimers();
  }, []);

  const startFriendMatch = useCallback(() => {
    if (playersRef.current.length < 2) return;
    initAudio();
    // rotate players CYCLES times
    const order = [];
    for (let c = 0; c < CYCLES; c++) {
      for (const p of playersRef.current) order.push(p.peerId);
    }
    roundOrderRef.current = order;
    setTotalRounds(order.length);
    scoresRef.current = {};
    setScores({});
    startRound(0);
  }, [startRound]);

  const secLeft = timeLeft / 1000;

  return (
    <div className="relative min-h-[100dvh] bg-[#0a0a12] text-white font-mono flex flex-col">
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6 py-8 overflow-y-auto">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-2">draw &amp; guess</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">🎨 skribbl style.</h1>
            <p className="text-white/60 max-w-md mx-auto text-sm sm:text-base">
              one draws, everyone else races to guess. 2–4 players. friends only (drawing needs humans).
            </p>
          </div>

          {netMode === "local" && (
            <div className="flex flex-col items-center gap-3">
              <button type="button" onClick={startHosting}
                className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                create room
              </button>
              <div className="text-white/40 text-xs max-w-sm">
                get 1-3 friends to join with the link, then start.
              </div>
            </div>
          )}

          {netMode === "host" && (
            <div className="flex flex-col items-center gap-4 w-full max-w-sm">
              {netStatus === "opening" && <div className="text-white/60 text-sm">creating room…</div>}
              {netStatus === "error" && <div className="text-red-400 text-sm">{netError || "connection failed"}</div>}
              {netStatus === "ready" && (
                <>
                  <div className="text-white/50 text-[10px] uppercase tracking-widest">room code</div>
                  <div className="text-3xl font-mono font-semibold tracking-widest">{roomId}</div>
                  <button type="button"
                    onClick={async () => {
                      const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
                    }}
                    className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm cursor-pointer touch-manipulation">
                    {copied ? "copied ✓" : "copy invite link"}
                  </button>
                  <div className="text-white/30 text-xs break-all">
                    {typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?room=${roomId}` : ""}
                  </div>
                  <div className="w-full pt-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest text-center mb-2">players ({players.length}/4)</div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      {players.map((p) => (
                        <div key={p.peerId} className="flex items-center gap-1.5 bg-white/[0.04] rounded-full px-3 py-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                          <span className="text-xs font-mono">{p.isHost ? "you (host)" : p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" disabled={players.length < 2} onClick={startFriendMatch}
                      className="px-6 py-3 rounded-full bg-white text-black font-medium tracking-tight disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                      start
                    </button>
                    <button type="button" onClick={leaveNet}
                      className="px-4 py-3 rounded-full text-white/60 hover:text-white text-sm cursor-pointer touch-manipulation">cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          {netMode === "guest" && (
            <div className="flex flex-col items-center gap-4 w-full max-w-sm">
              {netStatus === "opening" && <div className="text-white/60 text-sm">joining room {roomId}…</div>}
              {netStatus === "error" && <div className="text-red-400 text-sm">{netError || "couldn't connect"}</div>}
              {netStatus === "ready" && (
                <>
                  <div className="text-white/50 text-[10px] uppercase tracking-widest">room</div>
                  <div className="text-2xl font-mono font-semibold tracking-widest">{roomId}</div>
                  <div className="text-white/50 text-sm">waiting for host to start…</div>
                  <div className="w-full pt-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest text-center mb-2">players in room</div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      {players.map((p) => {
                        const isMe = p.peerId === myPeerIdRef.current;
                        return (
                          <div key={p.peerId} className="flex items-center gap-1.5 bg-white/[0.04] rounded-full px-3 py-1">
                            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                            <span className="text-xs font-mono">{isMe ? "you" : p.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={leaveNet}
                    className="mt-2 text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation">leave</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* IN-GAME */}
      {(phase === "drawing" || phase === "reveal") && (
        <div className="flex-1 flex flex-col lg:flex-row gap-3 p-3 pt-12 max-w-6xl w-full mx-auto">
          {/* MAIN: canvas + header */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            {/* header */}
            <div className="flex items-center justify-between">
              <div className="text-white/40 text-[10px] uppercase tracking-widest">
                round {roundNumber}/{roundOrderRef.current.length || totalRounds}
              </div>
              <div className="text-center">
                <div className="text-white/40 text-[9px] uppercase tracking-widest">
                  {iAmDrawer ? "your word" : phase === "reveal" ? "the word was" : "guess the word"}
                </div>
                <div className={`text-xl sm:text-2xl font-mono tracking-widest tabular-nums ${phase === "reveal" ? "text-emerald-400" : iAmDrawer ? "text-amber-300" : "text-white/80"}`}>
                  {phase === "reveal" && revealed ? revealed.word : (iAmDrawer ? wordForMe : `${wordDisplay("_".repeat(wordLen))}  (${wordLen})`)}
                </div>
              </div>
              <div className={`text-lg font-semibold tabular-nums ${secLeft < 10 ? "text-rose-400" : "text-white/80"}`}>
                {Math.ceil(secLeft)}s
              </div>
            </div>
            {/* canvas */}
            <div className="relative flex-1 min-h-[280px] rounded-xl overflow-hidden border border-white/10 bg-[#12121a]">
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 w-full h-full ${iAmDrawer ? "cursor-crosshair touch-none" : "cursor-not-allowed"}`}
                style={{ touchAction: iAmDrawer ? "none" : "auto" }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerUp}
              />
              {/* drawer toolbar */}
              {iAmDrawer && phase === "drawing" && (
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                  <div className="flex gap-1">
                    {["#f5eedd", "#4cc9f0", "#c77dff", "#06d6a0", "#ffd166", "#ef476f", "#f4a261", "#12121a"].map((col) => (
                      <button key={col} type="button" onClick={() => setStrokeColor(col)}
                        className={`w-7 h-7 rounded-full border-2 ${strokeColor === col ? "border-white" : "border-white/10"}`}
                        style={{ background: col }} />
                    ))}
                  </div>
                  <button type="button" onClick={handleClearBoard}
                    className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs cursor-pointer touch-manipulation">
                    clear board
                  </button>
                </div>
              )}
              {phase === "reveal" && revealed && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
                  <div className="text-white/50 text-[10px] uppercase tracking-widest">round scores</div>
                  <div className="flex gap-3 flex-wrap justify-center max-w-full px-4">
                    {players.map((p) => {
                      const pts = revealed.roundPoints[p.peerId] || 0;
                      return (
                        <div key={p.peerId} className="flex flex-col items-center">
                          <div className="text-[10px]" style={{ color: p.color }}>{p.peerId === myPeerIdRef.current ? "you" : p.name}</div>
                          <div className={`text-lg font-semibold tabular-nums ${pts > 0 ? "text-emerald-400" : "text-white/40"}`}>+{pts}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SIDEBAR: players + chat */}
          <div className="lg:w-72 flex flex-col gap-2 min-h-0">
            {/* players */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-2">
              <div className="text-white/40 uppercase text-[10px] tracking-widest mb-1">players</div>
              <div className="space-y-1">
                {[...players].sort((a, b) => (scores[b.peerId] || 0) - (scores[a.peerId] || 0)).map((p) => {
                  const isDraw = p.peerId === drawerId;
                  const gotIt = correctSet.has(p.peerId);
                  return (
                    <div key={p.peerId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        <span className="font-mono">{p.peerId === myPeerIdRef.current ? "you" : p.name}</span>
                        {isDraw && <span className="text-amber-300 text-xs">✎</span>}
                        {gotIt && !isDraw && <span className="text-emerald-400 text-xs">✓</span>}
                      </div>
                      <span className="font-mono tabular-nums text-white/70">{scores[p.peerId] || 0}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* chat */}
            <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/10 p-2 flex flex-col min-h-[200px]">
              <div className="text-white/40 uppercase text-[10px] tracking-widest mb-1">chat</div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-sm max-h-[280px] lg:max-h-none">
                {chat.map((m, i) =>
                  m.system ? (
                    <div key={i} className={`text-xs ${m.kind === "correct" ? "text-emerald-400" : "text-white/40"}`}>
                      {m.text}
                    </div>
                  ) : (
                    <div key={i}>
                      <span className="text-xs mr-1" style={{ color: m.color || "#fff" }}>{m.name}:</span>
                      <span className="text-white/80">{m.text}</span>
                    </div>
                  )
                )}
              </div>
              {phase === "drawing" && !iAmDrawer && !correctSet.has(myPeerIdRef.current) && (
                <div className="mt-2 flex gap-1">
                  <input
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitGuess(); }}
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1.5 text-sm font-mono outline-none focus:border-white/30"
                    placeholder="type your guess…"
                    autoComplete="off"
                  />
                  <button type="button" onClick={submitGuess}
                    className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium cursor-pointer touch-manipulation">
                    guess
                  </button>
                </div>
              )}
              {phase === "drawing" && correctSet.has(myPeerIdRef.current) && !iAmDrawer && (
                <div className="mt-2 text-emerald-400 text-xs text-center">✓ you got it — waiting…</div>
              )}
              {phase === "drawing" && iAmDrawer && (
                <div className="mt-2 text-amber-300 text-xs text-center">you're drawing — no guessing</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl mb-1">🏆</div>
            <div className="text-white/60 text-sm uppercase tracking-widest mb-3">final standings</div>
            <div className="space-y-2 mb-6">
              {[...players].sort((a, b) => (scores[b.peerId] || 0) - (scores[a.peerId] || 0)).map((p, i) => (
                <div key={p.peerId} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-white/40 w-4">{i + 1}.</div>
                    <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <div className="text-sm">{p.peerId === myPeerIdRef.current ? "you" : p.name}</div>
                  </div>
                  <div className="text-sm font-mono tabular-nums">{scores[p.peerId] || 0}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              {netMode === "host" ? (
                <button type="button" onClick={startFriendMatch}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  rematch
                </button>
              ) : (
                <div className="flex-1 py-3 text-white/50 text-sm">waiting for host…</div>
              )}
              <button type="button" onClick={leaveNet}
                className="flex-1 py-3 rounded-full text-white/60 hover:text-white transition cursor-pointer touch-manipulation">
                leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
