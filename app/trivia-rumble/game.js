"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { QUESTIONS } from "./questions";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playTick, playGo, playWin, playLose, playKey } from "../lib/sound";

const ROUNDS = 10;
const ROUND_MS = 15000;
const REVEAL_MS = 2500;

const NAMES = ["aarav","diya","mia","leo","zara","kabir","priya","noah","ivy","yusuf","sana","milo","ava","reyansh","nia"];
const SUFFIXES = ["","","","","88","07","23","_","x"];
const COLORS = ["#4cc9f0", "#c77dff", "#06d6a0", "#ffd166"];

function randomName(taken = new Set()) {
  for (let i = 0; i < 40; i++) {
    const n = NAMES[Math.floor(Math.random() * NAMES.length)] + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    if (!taken.has(n)) return n;
  }
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}
function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function hostPeerId(rid) { return `mb-tr-${rid}`; }

function pickQuestions() {
  const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, ROUNDS).map((q) => {
    // shuffle options; remap correct index
    const idx = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const options = idx.map((i) => q.options[i]);
    const correct = idx.indexOf(q.correct);
    return { q: q.q, options, correct };
  });
}

export default function Game() {
  // net
  const [netMode, setNetMode] = useState("local"); // local | host | guest
  const [phase, setPhase] = useState("lobby"); // lobby | playing | roundReveal | ended
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle");
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [players, setPlayers] = useState([]); // [{id, name, color, peerId, isHost}]
  const [round, setRound] = useState(0); // 0..ROUNDS-1
  const [question, setQuestion] = useState(null);
  const [roundStartedAt, setRoundStartedAt] = useState(0);
  const [myAnswer, setMyAnswer] = useState(null);
  const [revealed, setRevealed] = useState(null); // {correct, playerAnswers: {pid: idx}, roundPoints: {pid: pts}}
  const [scores, setScores] = useState({}); // {peerId: totalPts}
  const [timeLeft, setTimeLeft] = useState(ROUND_MS);
  const [botCount, setBotCount] = useState(1); // for local mode
  const [muted, setMutedState] = useState(false);

  const netModeRef = useRef("local");
  const phaseRef = useRef("lobby");
  const peerRef = useRef(null);
  const connsRef = useRef(new Map()); // host: peerId → conn
  const hostConnRef = useRef(null);
  const questionsRef = useRef([]);
  const roundRef = useRef(0);
  const scoresRef = useRef({});
  const playersRef = useRef([]);
  const myPeerIdRef = useRef("local-host");
  const roundAnswersRef = useRef({}); // {peerId: {idx, ms}}
  const botTimersRef = useRef([]);
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { roundRef.current = round; }, [round]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const send = useCallback((msg, targetPeerId) => {
    if (netModeRef.current === "host") {
      if (targetPeerId) {
        const c = connsRef.current.get(targetPeerId);
        if (c?.open) try { c.send(msg); } catch {}
      } else {
        for (const c of connsRef.current.values()) {
          if (c.open) try { c.send(msg); } catch {}
        }
      }
    } else if (netModeRef.current === "guest") {
      const c = hostConnRef.current;
      if (c?.open) try { c.send(msg); } catch {}
    }
  }, []);

  const clearBotTimers = useCallback(() => {
    for (const t of botTimersRef.current) clearTimeout(t);
    botTimersRef.current = [];
  }, []);

  // ---------- match flow (host authoritative) ----------
  const scheduleBotAnswers = useCallback(() => {
    // for local mode with bot players
    const pls = playersRef.current;
    const bots = pls.filter((p) => p.isBot);
    for (const b of bots) {
      const think = 700 + Math.random() * (ROUND_MS - 3000);
      const t = setTimeout(() => {
        if (phaseRef.current !== "playing") return;
        if (roundAnswersRef.current[b.peerId]) return;
        const q = questionsRef.current[roundRef.current];
        if (!q) return;
        const correctChance = 0.55 + Math.random() * 0.25;
        const chosen = Math.random() < correctChance ? q.correct : Math.floor(Math.random() * 4);
        roundAnswersRef.current[b.peerId] = { idx: chosen, ms: think };
        // if all answered, reveal
        if (allAnswered()) doReveal();
      }, think);
      botTimersRef.current.push(t);
    }
  }, []);

  const allAnswered = useCallback(() => {
    const pls = playersRef.current;
    return pls.every((p) => roundAnswersRef.current[p.peerId] != null);
  }, []);

  const doReveal = useCallback(() => {
    clearBotTimers();
    const q = questionsRef.current[roundRef.current];
    if (!q) return;
    const answers = roundAnswersRef.current;
    const roundPoints = {};
    for (const p of playersRef.current) {
      const a = answers[p.peerId];
      if (a && a.idx === q.correct) {
        // Kahoot-style: max 1000 pts, scaled by speed
        const timePct = Math.min(1, a.ms / ROUND_MS);
        const pts = Math.round(500 + 500 * (1 - timePct));
        roundPoints[p.peerId] = pts;
      } else {
        roundPoints[p.peerId] = 0;
      }
    }
    const newScores = { ...scoresRef.current };
    for (const p of playersRef.current) {
      newScores[p.peerId] = (newScores[p.peerId] || 0) + (roundPoints[p.peerId] || 0);
    }
    scoresRef.current = newScores;
    setScores(newScores);
    const reveal = {
      correct: q.correct,
      answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.idx])),
      roundPoints,
    };
    setRevealed(reveal);
    setPhase("roundReveal");
    // audio for me
    const myA = answers[myPeerIdRef.current];
    if (myA && myA.idx === q.correct) playCorrect(); else playWrong();
    // broadcast reveal
    if (netModeRef.current === "host") {
      send({ t: "reveal", ...reveal, scores: newScores });
    }
    // schedule next round
    const t = setTimeout(() => {
      const nextRound = roundRef.current + 1;
      if (nextRound >= ROUNDS) {
        finishMatch(newScores);
      } else {
        startRound(nextRound);
      }
    }, REVEAL_MS);
    botTimersRef.current.push(t);
  }, [clearBotTimers, send]);

  const finishMatch = useCallback((finalScores) => {
    clearBotTimers();
    setPhase("ended");
    if (netModeRef.current === "host") send({ t: "end", scores: finalScores });
    const me = finalScores[myPeerIdRef.current] || 0;
    const others = playersRef.current
      .filter((p) => p.peerId !== myPeerIdRef.current)
      .map((p) => finalScores[p.peerId] || 0);
    const maxOther = Math.max(0, ...others);
    if (me > maxOther) playWin(); else playLose();
  }, [clearBotTimers, send]);

  const startRound = useCallback((idx) => {
    roundRef.current = idx;
    setRound(idx);
    const q = questionsRef.current[idx];
    if (!q) return;
    setQuestion(q);
    setRevealed(null);
    setMyAnswer(null);
    roundAnswersRef.current = {};
    const startedAt = performance.now();
    setRoundStartedAt(startedAt);
    setTimeLeft(ROUND_MS);
    setPhase("playing");
    if (netModeRef.current === "host") {
      send({ t: "round", i: idx, q, startedAt: Date.now() });
    }
    // bots
    if (netModeRef.current === "local" || netModeRef.current === "host") {
      scheduleBotAnswers();
    }
    // round timeout
    const t = setTimeout(() => {
      if (phaseRef.current === "playing") doReveal();
    }, ROUND_MS + 200);
    botTimersRef.current.push(t);
  }, [send, scheduleBotAnswers, doReveal]);

  // per-100ms timer tick for UI
  useEffect(() => {
    if (phase !== "playing") return;
    const iv = setInterval(() => {
      const left = Math.max(0, ROUND_MS - (performance.now() - roundStartedAt));
      setTimeLeft(left);
    }, 100);
    return () => clearInterval(iv);
  }, [phase, roundStartedAt]);

  const submitAnswer = useCallback((idx) => {
    if (phase !== "playing" || myAnswer != null) return;
    playKey();
    setMyAnswer(idx);
    const ms = performance.now() - roundStartedAt;
    if (netModeRef.current === "guest") {
      send({ t: "answer", idx, ms });
    } else {
      // host records locally
      roundAnswersRef.current[myPeerIdRef.current] = { idx, ms };
      if (allAnswered()) doReveal();
    }
  }, [phase, myAnswer, roundStartedAt, allAnswered, doReveal, send]);

  // ---------- networking ----------
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
        const newP = { id: idx, name, color: COLORS[idx % 4], peerId: conn.peer, isHost: false };
        const updated = [...playersRef.current, newP];
        setPlayers(updated);
        playersRef.current = updated;
        // broadcast lobby
        setTimeout(() => send({ t: "lob", players: updated }), 10);
      } else if (data.t === "answer") {
        if (phaseRef.current !== "playing") return;
        if (roundAnswersRef.current[conn.peer]) return;
        roundAnswersRef.current[conn.peer] = { idx: data.idx, ms: data.ms };
        if (allAnswered()) doReveal();
      }
    } else if (mode === "guest") {
      if (data.t === "lob") {
        setPlayers(data.players || []);
      } else if (data.t === "start") {
        questionsRef.current = data.questions;
        scoresRef.current = {};
        setScores({});
        setPhase("playing"); // will be superseded by "round" below
      } else if (data.t === "round") {
        setRound(data.i);
        roundRef.current = data.i;
        setQuestion(data.q);
        setRevealed(null);
        setMyAnswer(null);
        setRoundStartedAt(performance.now());
        setTimeLeft(ROUND_MS);
        setPhase("playing");
      } else if (data.t === "reveal") {
        setRevealed({ correct: data.correct, answers: data.answers, roundPoints: data.roundPoints });
        setScores(data.scores);
        scoresRef.current = data.scores;
        setPhase("roundReveal");
        const q = questionsRef.current[roundRef.current];
        const myA = data.answers[myPeerIdRef.current];
        if (myA === data.correct) playCorrect(); else playWrong();
      } else if (data.t === "end") {
        setScores(data.scores);
        scoresRef.current = data.scores;
        setPhase("ended");
        const me = data.scores[myPeerIdRef.current] || 0;
        const others = playersRef.current.filter((p) => p.peerId !== myPeerIdRef.current).map((p) => data.scores[p.peerId] || 0);
        const maxOther = Math.max(0, ...others);
        if (me > maxOther) playWin(); else playLose();
      }
    }
  }, [send, allAnswered, doReveal]);

  const startHosting = useCallback(() => {
    if (peerRef.current) return;
    initAudio();
    const rid = makeRoomId();
    setRoomId(rid);
    setNetMode("host");
    netModeRef.current = "host";
    setNetStatus("opening");
    setNetError(null);
    const hpid = hostPeerId(rid);
    myPeerIdRef.current = hpid;
    // add self as first player
    const me = { id: 0, name: "you", color: COLORS[0], peerId: hpid, isHost: true };
    setPlayers([me]);
    playersRef.current = [me];
    const peer = new Peer(hpid, { debug: 1 });
    peer.on("open", () => {
      setNetStatus("ready");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("room", rid);
        window.history.replaceState({}, "", url.toString());
      }
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
    setNetError(null);
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
    clearBotTimers();
  }, [clearBotTimers]);

  // ---------- actions ----------
  const startLocal = useCallback(() => {
    initAudio();
    myPeerIdRef.current = "you";
    const taken = new Set(["you"]);
    const pls = [{ id: 0, name: "you", color: COLORS[0], peerId: "you", isHost: true, isBot: false }];
    for (let i = 0; i < botCount; i++) {
      const nm = randomName(taken);
      taken.add(nm);
      pls.push({ id: i + 1, name: nm, color: COLORS[(i + 1) % 4], peerId: `bot-${i}`, isHost: false, isBot: true });
    }
    setPlayers(pls);
    playersRef.current = pls;
    questionsRef.current = pickQuestions();
    scoresRef.current = {};
    setScores({});
    setRevealed(null);
    startRound(0);
  }, [botCount, startRound]);

  const startFriendMatch = useCallback(() => {
    initAudio();
    const qs = pickQuestions();
    questionsRef.current = qs;
    scoresRef.current = {};
    setScores({});
    setRevealed(null);
    // broadcast the questions
    send({ t: "start", questions: qs });
    startRound(0);
  }, [send, startRound]);

  const timeLeftPct = timeLeft / ROUND_MS;

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
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-2">trivia rumble</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">🧠 fastest wins.</h1>
            <p className="text-white/60 max-w-md mx-auto text-sm sm:text-base">
              {ROUNDS} questions. everyone sees them at the same time. fastest correct answer per round scores more points. 2–4 players.
            </p>
          </div>

          {netMode === "local" && (
            <>
              <div className="flex flex-col items-center gap-2">
                <div className="text-white/50 text-[10px] uppercase tracking-widest">bots</div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setBotCount((c) => Math.max(1, c - 1))}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-lg cursor-pointer touch-manipulation">−</button>
                  <div className="w-12 text-center text-2xl font-semibold tabular-nums">{botCount}</div>
                  <button type="button" onClick={() => setBotCount((c) => Math.min(3, c + 1))}
                    className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-lg cursor-pointer touch-manipulation">+</button>
                </div>
                <div className="text-white/40 text-xs">you + {botCount} bot{botCount > 1 ? "s" : ""}</div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button type="button" onClick={startLocal}
                  className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  play vs bots
                </button>
                <button type="button" onClick={startHosting}
                  className="text-white/60 hover:text-white text-sm underline underline-offset-4 cursor-pointer touch-manipulation">
                  play with friends →
                </button>
              </div>
            </>
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
                      start ({players.length}/4)
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

      {/* PLAYING or REVEAL */}
      {(phase === "playing" || phase === "roundReveal") && question && (
        <div className="flex-1 flex flex-col items-center px-4 pt-14 pb-6 max-w-2xl w-full mx-auto gap-4">
          {/* header */}
          <div className="w-full flex items-center justify-between">
            <div className="text-white/40 text-[10px] uppercase tracking-widest">round {round + 1}/{ROUNDS}</div>
            <div className="text-white/40 text-[10px] uppercase tracking-widest">{Math.ceil(timeLeft / 1000)}s</div>
          </div>
          {/* time bar */}
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full transition-all duration-100" style={{
              width: `${timeLeftPct * 100}%`,
              background: timeLeftPct > 0.35 ? "#06d6a0" : timeLeftPct > 0.15 ? "#ffd166" : "#ef476f",
            }} />
          </div>
          {/* players */}
          <div className="w-full flex gap-2 justify-center flex-wrap">
            {players.map((p) => (
              <div key={p.peerId} className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1 bg-white/[0.04] rounded-full px-2 py-0.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  <span className="text-[10px] font-mono">{p.peerId === myPeerIdRef.current ? "you" : p.name}</span>
                </div>
                <div className="text-xs tabular-nums text-white/70 font-mono">{scores[p.peerId] || 0}</div>
              </div>
            ))}
          </div>
          {/* question */}
          <div className="w-full flex-1 flex flex-col justify-center items-center">
            <div className="text-2xl sm:text-3xl font-semibold text-center leading-snug mb-6 max-w-xl">
              {question.q}
            </div>
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
              {question.options.map((opt, i) => {
                const isMyAnswer = myAnswer === i;
                const isCorrect = revealed && revealed.correct === i;
                const isWrong = revealed && isMyAnswer && !isCorrect;
                let bg = "bg-white/[0.05] hover:bg-white/[0.12]";
                if (revealed) {
                  if (isCorrect) bg = "bg-emerald-500/25 border-emerald-400";
                  else if (isWrong) bg = "bg-rose-500/25 border-rose-400";
                  else bg = "bg-white/[0.03] opacity-50";
                } else if (isMyAnswer) {
                  bg = "bg-[#4cc9f0]/20 border-[#4cc9f0]";
                }
                const disabled = phase !== "playing" || myAnswer != null;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => submitAnswer(i)}
                    disabled={disabled}
                    className={`text-left rounded-xl border border-white/10 px-4 py-4 text-base sm:text-lg lowercase transition active:scale-[0.98] ${bg} ${disabled ? "cursor-default" : "cursor-pointer"}`}
                  >
                    <span className="text-white/40 mr-2 text-sm">{["a","b","c","d"][i]}.</span>
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
          {/* reveal footer */}
          {phase === "roundReveal" && revealed && (
            <div className="w-full text-center">
              <div className="text-white/60 text-xs uppercase tracking-widest mb-2">round scores</div>
              <div className="flex gap-3 justify-center flex-wrap">
                {players.map((p) => {
                  const pts = revealed.roundPoints[p.peerId] || 0;
                  return (
                    <div key={p.peerId} className="flex flex-col items-center">
                      <div className="text-[10px]" style={{ color: p.color }}>{p.peerId === myPeerIdRef.current ? "you" : p.name}</div>
                      <div className={`text-lg font-semibold tabular-nums ${pts > 0 ? "text-emerald-400" : "text-white/40"}`}>
                        +{pts}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {phase === "playing" && myAnswer != null && (
            <div className="text-white/40 text-xs">locked in. waiting for others…</div>
          )}
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl mb-1">🏆</div>
            <div className="text-white/60 text-sm uppercase tracking-widest mb-3">final standings</div>
            <div className="space-y-2 mb-6">
              {[...players]
                .sort((a, b) => (scores[b.peerId] || 0) - (scores[a.peerId] || 0))
                .map((p, i) => (
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
              {netMode === "guest" ? (
                <div className="flex-1 py-3 text-white/50 text-sm">waiting for host…</div>
              ) : netMode === "host" ? (
                <button type="button" onClick={startFriendMatch}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  rematch
                </button>
              ) : (
                <button type="button" onClick={startLocal}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  rematch
                </button>
              )}
              <button type="button"
                onClick={() => netMode === "local" ? setPhase("lobby") : leaveNet()}
                className="flex-1 py-3 rounded-full text-white/60 hover:text-white transition cursor-pointer touch-manipulation">
                {netMode === "local" ? "back" : "leave"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
