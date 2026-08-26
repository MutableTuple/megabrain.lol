"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playTick, playGo, playWin, playLose } from "../lib/sound";

const GRID_N = 5; // 5x5 = 25 dots
const WIN_SCORE = 5;
const ROUND_TIMEOUT_MS = 8000;
const WRONG_PENALTY_MS = 700;

// difficulty ramp — smaller lightness delta = harder
const DIFFICULTY = [22, 16, 12, 9, 6, 4]; // per round (idx = round-1, capped)

const NAMES = ["aarav","diya","mia","leo","zara","kabir","priya","noah","ivy","yusuf","sana","milo","ava"];
const SUFFIXES = ["","","","","88","07","23","_","x"];
function randomName() {
  return NAMES[Math.floor(Math.random()*NAMES.length)] + SUFFIXES[Math.floor(Math.random()*SUFFIXES.length)];
}
function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function hostPeerId(rid) { return `mb-ooo-${rid}`; }

// generate colors: all same hsl, odd differs in lightness
function generateRound(round) {
  const n = GRID_N * GRID_N;
  const delta = DIFFICULTY[Math.min(round - 1, DIFFICULTY.length - 1)];
  const hue = Math.floor(Math.random() * 360);
  const sat = 60 + Math.random() * 20;
  const light = 45 + Math.random() * 15;
  const oddIdx = Math.floor(Math.random() * n);
  const oddLight = Math.random() < 0.5 ? light - delta : light + delta;
  return { hue, sat, light, oddIdx, oddLight };
}

function colorAt(cfg, idx) {
  const l = idx === cfg.oddIdx ? cfg.oddLight : cfg.light;
  return `hsl(${cfg.hue}, ${cfg.sat}%, ${l}%)`;
}

export default function Game() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | ended
  const [netMode, setNetMode] = useState("local");
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle");
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [oppName, setOppName] = useState("");
  const [round, setRound] = useState(1);
  const [config, setConfig] = useState(null);
  const [myScore, setMyScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [winner, setWinner] = useState(null);
  const [roundStatus, setRoundStatus] = useState("idle"); // idle | showing | ended (round)
  const [roundWinner, setRoundWinner] = useState(null); // 'me' | 'opp' | 'timeout' | null
  const [wrongIdx, setWrongIdx] = useState(null);
  const [muted, setMutedState] = useState(false);

  const phaseRef = useRef(phase);
  const netModeRef = useRef("local");
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const configRef = useRef(null);
  const roundRef = useRef(1);
  const roundStatusRef = useRef("idle");
  const myScoreRef = useRef(0);
  const oppScoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const wrongUntilRef = useRef(0);
  const roundTimerRef = useRef(null);
  const botTimerRef = useRef(null);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { roundRef.current = round; }, [round]);
  useEffect(() => { roundStatusRef.current = roundStatus; }, [roundStatus]);
  useEffect(() => { myScoreRef.current = myScore; }, [myScore]);
  useEffect(() => { oppScoreRef.current = oppScore; }, [oppScore]);
  useEffect(() => { setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const send = useCallback((msg) => {
    const c = connRef.current;
    if (c && c.open) { try { c.send(msg); } catch {} }
  }, []);

  const clearBotTimer = useCallback(() => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
  }, []);
  const clearRoundTimer = useCallback(() => {
    if (roundTimerRef.current) { clearTimeout(roundTimerRef.current); roundTimerRef.current = null; }
  }, []);

  // ---------- round flow ----------
  const finishRound = useCallback((winner, wrongIdx) => {
    if (roundStatusRef.current !== "showing") return;
    setRoundStatus("ended");
    setRoundWinner(winner);
    clearRoundTimer();
    clearBotTimer();

    let ms = myScoreRef.current;
    let os = oppScoreRef.current;
    if (winner === "me") { ms += 1; setMyScore(ms); playCorrect(); }
    else if (winner === "opp") { os += 1; setOppScore(os); playWrong(); }
    else { playTick(); }
    if (wrongIdx != null) setWrongIdx(wrongIdx);

    // if net host, broadcast round result
    if (netModeRef.current === "host") {
      send({ t: "endRound", w: winner === "me" ? "host" : winner === "opp" ? "guest" : "timeout" });
    }

    setTimeout(() => {
      setWrongIdx(null);
      // check match end
      if (ms >= WIN_SCORE || os >= WIN_SCORE) {
        setWinner(ms > os ? "me" : "opp");
        setPhase("ended");
        if (ms > os) playWin(); else playLose();
        return;
      }
      // next round (host-driven if network)
      if (netModeRef.current === "guest") {
        // wait for host's next round
      } else {
        const nextRound = roundRef.current + 1;
        const cfg = generateRound(nextRound);
        setRound(nextRound);
        setConfig(cfg);
        setRoundWinner(null);
        setRoundStatus("showing");
        startedAtRef.current = performance.now();
        playGo();
        if (netModeRef.current === "host") send({ t: "round", r: nextRound, cfg });
      }
    }, 1400);
  }, [send, clearRoundTimer, clearBotTimer]);

  const tapCell = useCallback((idx) => {
    const cfg = configRef.current;
    if (!cfg) return;
    if (roundStatusRef.current !== "showing") return;
    const now = performance.now();
    if (now < wrongUntilRef.current) return;
    if (idx === cfg.oddIdx) {
      if (netModeRef.current === "guest") {
        send({ t: "tap", correct: true });
        // wait for host to confirm winner
      } else {
        finishRound("me", null);
      }
    } else {
      wrongUntilRef.current = now + WRONG_PENALTY_MS;
      setWrongIdx(idx);
      setTimeout(() => setWrongIdx(null), WRONG_PENALTY_MS);
      playWrong();
      if (netModeRef.current === "guest") send({ t: "tap", correct: false });
    }
  }, [finishRound, send]);

  // Bot: taps after delay based on difficulty; some rounds gets it wrong first
  useEffect(() => {
    if (netMode !== "local") return;
    if (roundStatus !== "showing") return;
    if (!config) return;
    // delay scales with difficulty
    const diff = DIFFICULTY[Math.min(round - 1, DIFFICULTY.length - 1)];
    // easier (bigger delta) → faster bot; harder → slower bot
    const base = 1400 + (24 - diff) * 130 + Math.random() * 1000;
    // sometimes bot messes up: taps wrong once before correct
    const willMistake = Math.random() < 0.22;
    const delay = base + (willMistake ? 400 + Math.random() * 800 : 0);
    clearBotTimer();
    botTimerRef.current = setTimeout(() => {
      if (roundStatusRef.current !== "showing") return;
      finishRound("opp", null);
    }, delay);
    return () => clearBotTimer();
  }, [config, round, roundStatus, netMode, finishRound, clearBotTimer]);

  // round timeout
  useEffect(() => {
    if (roundStatus !== "showing") return;
    clearRoundTimer();
    roundTimerRef.current = setTimeout(() => {
      if (roundStatusRef.current === "showing") finishRound("timeout", null);
    }, ROUND_TIMEOUT_MS);
    return () => clearRoundTimer();
  }, [config, roundStatus, finishRound, clearRoundTimer]);

  // ---------- networking ----------
  const handleMessage = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    const mode = netModeRef.current;
    if (data.t === "hello" && mode === "host") {
      const name = randomName();
      setOppName(name);
      send({ t: "lob", myName: name });
    } else if (data.t === "lob" && mode === "guest") {
      setOppName(data.myName || "friend");
    } else if (data.t === "start" && mode === "guest") {
      setMyScore(0); myScoreRef.current = 0;
      setOppScore(0); oppScoreRef.current = 0;
      setWinner(null);
      setPhase("playing");
    } else if (data.t === "round" && mode === "guest") {
      setRound(data.r);
      setConfig(data.cfg);
      setRoundStatus("showing");
      setRoundWinner(null);
      playGo();
    } else if (data.t === "tap" && mode === "host") {
      if (roundStatusRef.current !== "showing") return;
      if (data.correct) {
        finishRound("opp", null); // guest tapped correctly
      }
      // wrong taps by guest do nothing on host side
    } else if (data.t === "endRound" && mode === "guest") {
      // authoritative round result
      setRoundStatus("ended");
      const w = data.w;
      const winner = w === "host" ? "opp" : w === "guest" ? "me" : "timeout";
      setRoundWinner(winner);
      let ms = myScoreRef.current, os = oppScoreRef.current;
      if (winner === "me") { ms += 1; setMyScore(ms); playCorrect(); }
      else if (winner === "opp") { os += 1; setOppScore(os); playWrong(); }
      else playTick();
      setTimeout(() => {
        if (ms >= WIN_SCORE || os >= WIN_SCORE) {
          setWinner(ms > os ? "me" : "opp");
          setPhase("ended");
          if (ms > os) playWin(); else playLose();
        }
      }, 1400);
    }
  }, [send, finishRound]);

  const leaveNet = useCallback(() => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch {}; peerRef.current = null; }
    connRef.current = null;
    setNetMode("local");
    netModeRef.current = "local";
    setRoomId(null);
    setNetStatus("idle");
    setNetError(null);
    setOppName("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.pathname);
    }
    setPhase("lobby");
  }, []);

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
    });
    peer.on("connection", (conn) => {
      conn.on("open", () => { connRef.current = conn; });
      conn.on("data", (data) => handleMessage(data));
      conn.on("close", () => {
        setNetError("opponent left");
        setNetStatus("error");
        connRef.current = null;
      });
    });
    peer.on("error", (err) => { setNetError(String(err?.type || err?.message || err)); setNetStatus("error"); });
    peerRef.current = peer;
  }, [handleMessage]);

  const joinRoom = useCallback((rid) => {
    if (peerRef.current) return;
    setRoomId(rid);
    setNetMode("guest");
    netModeRef.current = "guest";
    setNetStatus("opening");
    setNetError(null);
    const peer = new Peer(undefined, { debug: 1 });
    peer.on("open", () => {
      const conn = peer.connect(hostPeerId(rid), { reliable: true });
      conn.on("open", () => {
        setNetStatus("ready");
        connRef.current = conn;
        conn.send({ t: "hello", name: null });
      });
      conn.on("data", handleMessage);
      conn.on("close", () => { setNetError("host left"); setNetStatus("error"); });
    });
    peer.on("error", (err) => { setNetError(String(err?.type || err?.message || err)); setNetStatus("error"); });
    peerRef.current = peer;
  }, [handleMessage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r && !peerRef.current) joinRoom(r);
    // eslint-disable-next-line
  }, []);

  useEffect(() => () => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch {}; peerRef.current = null; }
  }, []);

  // ---------- actions ----------
  const startLocal = useCallback(() => {
    initAudio();
    setMyScore(0); myScoreRef.current = 0;
    setOppScore(0); oppScoreRef.current = 0;
    setWinner(null);
    setRound(1);
    const cfg = generateRound(1);
    setConfig(cfg);
    setRoundStatus("showing");
    setRoundWinner(null);
    playGo();
    setPhase("playing");
  }, []);

  const startFriendMatch = useCallback(() => {
    initAudio();
    setMyScore(0); myScoreRef.current = 0;
    setOppScore(0); oppScoreRef.current = 0;
    setWinner(null);
    setRound(1);
    const cfg = generateRound(1);
    setConfig(cfg);
    setRoundStatus("showing");
    setRoundWinner(null);
    playGo();
    setPhase("playing");
    send({ t: "start" });
    send({ t: "round", r: 1, cfg });
  }, [send]);

  const opponentDisplayName = netMode === "local" ? "bot" : (oppName || "friend");

  return (
    <div className="relative w-full h-[100dvh] bg-[#0a0a12] text-white font-mono overflow-hidden select-none touch-none" style={{ touchAction: "none" }}>
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-6 z-20 overflow-y-auto py-8">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">odd one out</div>
            <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">spot it first.</h1>
            <p className="text-white/60 max-w-sm mx-auto">
              one dot in the grid is slightly different. tap it before your opponent does. first to {WIN_SCORE} wins.
            </p>
          </div>

          {netMode === "local" && (
            <div className="flex flex-col items-center gap-3">
              <button type="button" onClick={startLocal}
                className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                play vs bot
              </button>
              <button type="button" onClick={startHosting}
                className="text-white/60 hover:text-white text-sm underline underline-offset-4 cursor-pointer touch-manipulation">
                play with a friend →
              </button>
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
                  <div className="text-white/60 text-sm mt-4">
                    {oppName ? <span className="text-[#c77dff]">{oppName} joined</span> : <span className="text-white/40">waiting for opponent…</span>}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button" disabled={!oppName} onClick={startFriendMatch}
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
                  <button type="button" onClick={leaveNet}
                    className="mt-2 text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation">leave</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* PLAYING */}
      {phase === "playing" && config && (
        <div className="absolute inset-0 flex flex-col items-center pt-16 sm:pt-20 pb-6 px-4 z-10">
          {/* score */}
          <div className="w-full max-w-md flex items-center justify-between mb-6">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-[#4cc9f0]">you</div>
              <div className="text-4xl font-semibold tabular-nums">{myScore}</div>
            </div>
            <div className="text-center">
              <div className="text-white/40 text-sm">round {round}</div>
              <div className="text-white/30 text-[10px] mt-0.5">first to {WIN_SCORE}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-[#c77dff]">{opponentDisplayName}</div>
              <div className="text-4xl font-semibold tabular-nums">{oppScore}</div>
            </div>
          </div>

          {/* grid */}
          <div className="flex-1 flex items-center justify-center w-full max-w-md">
            <div
              className="grid w-full aspect-square gap-2 sm:gap-3"
              style={{ gridTemplateColumns: `repeat(${GRID_N}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: GRID_N * GRID_N }, (_, i) => {
                const isWrong = wrongIdx === i;
                const revealed = roundStatus === "ended" && i === config.oddIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => tapCell(i)}
                    disabled={roundStatus !== "showing"}
                    className={`aspect-square rounded-full transition-all touch-manipulation ${
                      isWrong ? "ring-2 ring-red-500 scale-90" : ""
                    } ${revealed ? "ring-4 ring-white scale-110" : ""}`}
                    style={{ background: colorAt(config, i) }}
                    aria-label={`dot ${i + 1}`}
                  />
                );
              })}
            </div>
          </div>

          {/* status */}
          <div className="w-full max-w-md text-center mt-4 h-6">
            {roundStatus === "ended" && roundWinner === "me" && (
              <div className="text-[#06d6a0] font-semibold">round yours</div>
            )}
            {roundStatus === "ended" && roundWinner === "opp" && (
              <div className="text-[#ef476f] font-semibold">round {opponentDisplayName}'s</div>
            )}
            {roundStatus === "ended" && roundWinner === "timeout" && (
              <div className="text-white/50">time's up — no one got it</div>
            )}
            {roundStatus === "showing" && (
              <div className="text-white/40 text-sm">tap the different one</div>
            )}
          </div>
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">{winner === "me" ? "🧠" : "🫠"}</div>
            <div className="text-2xl font-semibold tracking-tight mb-1">
              {winner === "me" ? "you win the match" : `${opponentDisplayName} wins`}
            </div>
            <div className="text-white/50 text-sm mb-6">final {myScore} — {oppScore}</div>
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
