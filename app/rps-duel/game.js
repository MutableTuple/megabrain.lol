"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { initAudio, isMuted, setMuted, playKey, playCorrect, playWrong, playTick, playGo, playWin, playLose } from "../lib/sound";

const CHOICES = [
  { id: "rock",     emoji: "✊", label: "rock" },
  { id: "paper",    emoji: "✋", label: "paper" },
  { id: "scissors", emoji: "✌️", label: "scissors" },
];

const WIN_MAP = { rock: "scissors", paper: "rock", scissors: "paper" };
const WIN_SCORE = 3; // first to 3 wins the match

const NAMES = ["aarav","diya","mia","leo","zara","kabir","priya","noah","ivy","yusuf","sana","milo","ava"];
const SUFFIXES = ["","","","","88","07","23","_","x"];
function randomName() {
  return NAMES[Math.floor(Math.random()*NAMES.length)] + SUFFIXES[Math.floor(Math.random()*SUFFIXES.length)];
}

function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function hostPeerId(rid) { return `mb-rps-${rid}`; }

function judge(a, b) {
  if (a === b) return "draw";
  if (WIN_MAP[a] === b) return "win";
  return "lose";
}

// Bot: slight bias toward beating the player's last move (mild pattern-hunter)
function botPick(lastPlayerChoice) {
  // 70% random, 30% counters the player's last
  if (lastPlayerChoice && Math.random() < 0.3) {
    const counters = { rock: "paper", paper: "scissors", scissors: "rock" };
    return counters[lastPlayerChoice];
  }
  return CHOICES[Math.floor(Math.random()*3)].id;
}

export default function Game() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | ended
  const [netMode, setNetMode] = useState("local");
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle");
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [oppName, setOppName] = useState("");
  const [myScore, setMyScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [round, setRound] = useState(1);
  const [myChoice, setMyChoice] = useState(null);
  const [oppChoice, setOppChoice] = useState(null);
  const [roundResult, setRoundResult] = useState(null); // 'win' | 'lose' | 'draw' | null
  const [shakePhase, setShakePhase] = useState(null); // null | number (3,2,1)
  const [winner, setWinner] = useState(null); // 'me' | 'opp' | null
  const [muted, setMutedState] = useState(false);

  const phaseRef = useRef(phase);
  const netModeRef = useRef("local");
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const lastMyChoiceRef = useRef(null);
  const myChoiceRef = useRef(null);
  const oppChoiceRef = useRef(null);
  const myScoreRef = useRef(0);
  const oppScoreRef = useRef(0);
  const roundRef = useRef(1);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);
  useEffect(() => { myChoiceRef.current = myChoice; }, [myChoice]);
  useEffect(() => { oppChoiceRef.current = oppChoice; }, [oppChoice]);
  useEffect(() => { myScoreRef.current = myScore; }, [myScore]);
  useEffect(() => { oppScoreRef.current = oppScore; }, [oppScore]);
  useEffect(() => { roundRef.current = round; }, [round]);
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

  // ---------- round resolution ----------
  const resolveRound = useCallback((mine, theirs) => {
    setShakePhase(null);
    const r = judge(mine, theirs);
    setRoundResult(r);
    let ms = myScoreRef.current;
    let os = oppScoreRef.current;
    if (r === "win") { ms += 1; setMyScore(ms); playCorrect(); }
    else if (r === "lose") { os += 1; setOppScore(os); playWrong(); }
    else { playTick(); }
    // match end?
    setTimeout(() => {
      if (ms >= WIN_SCORE || os >= WIN_SCORE) {
        setWinner(ms > os ? "me" : "opp");
        setPhase("ended");
        if (ms > os) playWin(); else playLose();
        return;
      }
      // next round
      setRound((r0) => r0 + 1);
      setMyChoice(null);
      setOppChoice(null);
      setRoundResult(null);
    }, 1600);
  }, []);

  // when both choices are in, run the reveal
  const tryReveal = useCallback(() => {
    const mine = myChoiceRef.current;
    const theirs = oppChoiceRef.current;
    if (!mine || !theirs) return;
    // shake animation 3-2-1 then reveal
    let n = 3;
    setShakePhase(n);
    playTick();
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        playGo();
        resolveRound(mine, theirs);
      } else {
        setShakePhase(n);
        playTick();
        setTimeout(tick, 350);
      }
    };
    setTimeout(tick, 350);
  }, [resolveRound]);

  // whenever both choices are in, reveal
  useEffect(() => {
    if (phase !== "playing") return;
    if (myChoice && oppChoice && shakePhase === null && !roundResult) {
      tryReveal();
    }
  }, [myChoice, oppChoice, phase, shakePhase, roundResult, tryReveal]);

  // bot response
  useEffect(() => {
    if (phase !== "playing") return;
    if (netMode !== "local") return;
    if (!myChoice || oppChoice) return;
    // bot picks after a short delay
    const t = setTimeout(() => {
      const pick = botPick(lastMyChoiceRef.current);
      setOppChoice(pick);
    }, 500 + Math.random() * 900);
    return () => clearTimeout(t);
  }, [myChoice, oppChoice, phase, netMode]);

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
    } else if (data.t === "start") {
      // fresh match
      setMyScore(0); myScoreRef.current = 0;
      setOppScore(0); oppScoreRef.current = 0;
      setRound(1);
      setMyChoice(null);
      setOppChoice(null);
      setRoundResult(null);
      setShakePhase(null);
      setWinner(null);
      setPhase("playing");
    } else if (data.t === "c") {
      setOppChoice(data.c);
    }
  }, [send]);

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
    peer.on("error", (err) => {
      setNetError(String(err?.type || err?.message || err));
      setNetStatus("error");
    });
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
      conn.on("close", () => {
        setNetError("host left");
        setNetStatus("error");
      });
    });
    peer.on("error", (err) => {
      setNetError(String(err?.type || err?.message || err));
      setNetStatus("error");
    });
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
    setRound(1);
    setMyChoice(null);
    setOppChoice(null);
    setRoundResult(null);
    setShakePhase(null);
    setWinner(null);
    setPhase("playing");
  }, []);

  const startFriendMatch = useCallback(() => {
    initAudio();
    setMyScore(0); myScoreRef.current = 0;
    setOppScore(0); oppScoreRef.current = 0;
    setRound(1);
    setMyChoice(null);
    setOppChoice(null);
    setRoundResult(null);
    setShakePhase(null);
    setWinner(null);
    setPhase("playing");
    send({ t: "start" });
  }, [send]);

  const pickChoice = useCallback((cid) => {
    if (phase !== "playing") return;
    if (myChoice) return;
    if (shakePhase !== null) return;
    playKey();
    setMyChoice(cid);
    lastMyChoiceRef.current = cid;
    if (netMode !== "local") {
      send({ t: "c", c: cid });
    }
  }, [phase, myChoice, shakePhase, netMode, send]);

  const opponentDisplayName = netMode === "local" ? "bot" : (oppName || "friend");

  return (
    <div className="relative w-full h-[100dvh] bg-[#0a0a12] text-white font-mono overflow-hidden select-none touch-none" style={{ touchAction: "none" }}>
      {/* mute */}
      <button
        type="button"
        onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-6 z-20 overflow-y-auto py-8">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">rps duel</div>
            <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">first to {WIN_SCORE}.</h1>
            <p className="text-white/60 max-w-sm mx-auto">rock. paper. scissors. classic.</p>
          </div>

          {netMode === "local" && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={startLocal}
                className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
              >
                play vs bot
              </button>
              <button
                type="button"
                onClick={startHosting}
                className="text-white/60 hover:text-white text-sm underline underline-offset-4 cursor-pointer touch-manipulation"
              >
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
                  <button
                    type="button"
                    onClick={async () => {
                      const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                      try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
                    }}
                    className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm cursor-pointer touch-manipulation"
                  >
                    {copied ? "copied ✓" : "copy invite link"}
                  </button>
                  <div className="text-white/30 text-xs break-all">
                    {typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?room=${roomId}` : ""}
                  </div>
                  <div className="text-white/60 text-sm mt-4">
                    {oppName ? <span className="text-[#c77dff]">{oppName} joined</span> : <span className="text-white/40">waiting for opponent…</span>}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={!oppName}
                      onClick={startFriendMatch}
                      className="px-6 py-3 rounded-full bg-white text-black font-medium tracking-tight disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
                    >
                      start
                    </button>
                    <button type="button" onClick={leaveNet} className="px-4 py-3 rounded-full text-white/60 hover:text-white text-sm cursor-pointer touch-manipulation">cancel</button>
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
                  <button type="button" onClick={leaveNet} className="mt-2 text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation">leave</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* PLAYING */}
      {phase === "playing" && (
        <div className="absolute inset-0 flex flex-col items-center px-4 pt-16 sm:pt-20 pb-8 z-10">
          {/* score */}
          <div className="w-full max-w-md flex items-center justify-between mb-6">
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-[#4cc9f0]">you</div>
              <div className="text-4xl font-semibold tabular-nums">{myScore}</div>
            </div>
            <div className="text-white/40 text-sm">round {round}</div>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-widest text-[#c77dff]">{opponentDisplayName}</div>
              <div className="text-4xl font-semibold tabular-nums">{oppScore}</div>
            </div>
          </div>

          {/* hands display */}
          <div className="flex-1 flex items-center justify-center gap-10 sm:gap-16 w-full max-w-md">
            <Hand
              side="left"
              choice={myChoice}
              revealed={roundResult !== null}
              shake={shakePhase !== null && !myChoice ? false : shakePhase !== null}
              result={roundResult === "win" ? "win" : roundResult === "lose" ? "lose" : roundResult === "draw" ? "draw" : null}
            />
            <div className="text-white/30 text-3xl font-semibold">vs</div>
            <Hand
              side="right"
              choice={oppChoice}
              revealed={roundResult !== null}
              shake={shakePhase !== null}
              result={roundResult === "lose" ? "win" : roundResult === "win" ? "lose" : roundResult === "draw" ? "draw" : null}
              mirror
            />
          </div>

          {/* shake overlay */}
          {shakePhase !== null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-8xl font-semibold tabular-nums text-white/70 drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">
                {shakePhase}
              </div>
            </div>
          )}

          {/* result flash */}
          {roundResult && shakePhase === null && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
              <div className={`text-4xl sm:text-5xl font-semibold tracking-tight ${roundResult === "win" ? "text-[#06d6a0]" : roundResult === "lose" ? "text-[#ef476f]" : "text-white/60"}`}>
                {roundResult === "win" ? "you win the round" : roundResult === "lose" ? "you lose the round" : "draw"}
              </div>
            </div>
          )}

          {/* choice buttons */}
          <div className="w-full max-w-md mt-8">
            {!myChoice && shakePhase === null && !roundResult && (
              <div className="text-center text-white/50 text-sm mb-3">pick your throw</div>
            )}
            {myChoice && !oppChoice && (
              <div className="text-center text-white/50 text-sm mb-3">waiting for {opponentDisplayName}…</div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {CHOICES.map((c) => {
                const chosen = myChoice === c.id;
                const disabled = !!myChoice || shakePhase !== null || roundResult !== null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickChoice(c.id)}
                    disabled={disabled}
                    className={`aspect-square rounded-2xl text-5xl sm:text-6xl transition active:scale-95 touch-manipulation ${
                      chosen ? "bg-[#4cc9f0]/25 ring-2 ring-[#4cc9f0]" :
                      disabled ? "bg-white/[0.03] opacity-40" :
                      "bg-white/[0.06] hover:bg-white/[0.12] cursor-pointer"
                    }`}
                  >
                    {c.emoji}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">{winner === "me" ? "🏆" : "🫠"}</div>
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

function Hand({ choice, revealed, shake, result, mirror }) {
  const emoji = revealed && choice ? CHOICES.find((c) => c.id === choice)?.emoji : "✊";
  const ring = result === "win" ? "ring-[#06d6a0]" : result === "lose" ? "ring-[#ef476f]" : result === "draw" ? "ring-white/30" : "ring-transparent";
  return (
    <div className={`relative rounded-full ${ring} ${result ? "ring-4" : ""} transition-all`}>
      <div
        className={`text-6xl sm:text-8xl inline-block ${shake ? "animate-[shake_0.35s_ease-in-out_infinite]" : ""}`}
        style={{ transform: mirror ? "scaleX(-1)" : undefined }}
      >
        {emoji}
      </div>
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: ${mirror ? "scaleX(-1)" : "scaleX(1)"} translateY(0) rotate(0deg); }
          25% { transform: ${mirror ? "scaleX(-1)" : "scaleX(1)"} translateY(-10px) rotate(-6deg); }
          75% { transform: ${mirror ? "scaleX(-1)" : "scaleX(1)"} translateY(-10px) rotate(6deg); }
        }
      `}</style>
    </div>
  );
}
