"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Peer from "peerjs";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playTick, playGo, playKey, playWin, playLose } from "../lib/sound";

function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function hostPeerId(rid) { return `mb-md-${rid}`; }

const TARGET = 10;

const NAMES = [
  "aarav", "diya", "kabir", "mia", "leo", "zara", "rohan", "emma", "yusuf",
  "ivy", "noah", "priya", "ethan", "sana", "arjun", "luna", "kai", "nia",
  "milo", "aria", "reyansh", "ava", "ishaan", "chloe", "vivaan", "maya",
  "hana", "theo", "elle", "raf", "jules", "sofi", "nico", "eli", "amaya",
];

const SUFFIXES = ["", "", "", "", "88", "42", "07", "99", "_x", "23", "_", "01"];

function randomName() {
  const n = NAMES[Math.floor(Math.random() * NAMES.length)];
  const s = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  return n + s;
}

// bot personalities — determines skill for one match
function pickPersonality() {
  const tiers = [
    { tier: "fast",   think: 350,  thinkVar: 500,  charDelay: 70,  charVar: 60,  mistake: 0.07 },
    { tier: "sharp",  think: 500,  thinkVar: 700,  charDelay: 90,  charVar: 80,  mistake: 0.10 },
    { tier: "mid",    think: 800,  thinkVar: 900,  charDelay: 120, charVar: 100, mistake: 0.13 },
    { tier: "casual", think: 1100, thinkVar: 1200, charDelay: 160, charVar: 130, mistake: 0.17 },
    { tier: "chill",  think: 1400, thinkVar: 1600, charDelay: 200, charVar: 160, mistake: 0.22 },
  ];
  return tiers[Math.floor(Math.random() * tiers.length)];
}

function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function genQuestion(index) {
  if (index < 3) {
    const a = randInt(2, 12);
    const b = randInt(2, 12);
    if (Math.random() < 0.5) return { text: `${a} + ${b}`, answer: a + b };
    const [x, y] = a >= b ? [a, b] : [b, a];
    return { text: `${x} − ${y}`, answer: x - y };
  }
  if (index < 6) {
    const a = randInt(12, 55);
    const b = randInt(12, 55);
    if (Math.random() < 0.55) return { text: `${a} + ${b}`, answer: a + b };
    const [x, y] = a >= b ? [a, b] : [b, a];
    return { text: `${x} − ${y}`, answer: x - y };
  }
  if (index < 8) {
    const a = randInt(3, 13);
    const b = randInt(3, 9);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  // 8-9 mixed harder
  const r = Math.random();
  if (r < 0.4) {
    const a = randInt(4, 15);
    const b = randInt(3, 9);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (r < 0.7) {
    const a = randInt(30, 90);
    const b = randInt(30, 90);
    return { text: `${a} + ${b}`, answer: a + b };
  }
  const b = randInt(3, 12);
  const q = randInt(3, 12);
  const a = b * q;
  return { text: `${a} ÷ ${b}`, answer: q };
}

function buildQuestions() {
  return Array.from({ length: TARGET }, (_, i) => genQuestion(i));
}

// generate a plausible wrong answer
function fudgeAnswer(a) {
  const strats = [
    () => a + (Math.random() < 0.5 ? 1 : -1),
    () => a + (Math.random() < 0.5 ? 2 : -2),
    () => a + (Math.random() < 0.5 ? 10 : -10),
  ];
  let v = strats[Math.floor(Math.random() * strats.length)]();
  if (v < 0) v = Math.abs(v);
  if (v === a) v += 1;
  return v;
}

export default function Game() {
  const [phase, setPhase] = useState("lobby"); // lobby | matching | countdown | playing | ended
  const [botName, setBotName] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [questions, setQuestions] = useState(() => buildQuestions());
  const [userIdx, setUserIdx] = useState(0);
  const [botIdx, setBotIdx] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [botTyped, setBotTyped] = useState("");
  const [botStatus, setBotStatus] = useState("waiting"); // waiting | thinking | typing
  const [winner, setWinner] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [matchingLabel, setMatchingLabel] = useState("finding opponent");
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);
  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  // networking
  const [netMode, setNetMode] = useState("local"); // local | host | guest
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle"); // idle | opening | ready | error
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [oppName, setOppName] = useState("");
  const netModeRef = useRef("local");
  const peerRef = useRef(null);
  const connRef = useRef(null);
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);

  const botRef = useRef({ timers: [], personality: null, alive: false });
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const questionsRef = useRef(questions);
  const botIdxRef = useRef(0);
  const userIdxRef = useRef(0);
  const phaseRef = useRef(phase);

  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { botIdxRef.current = botIdx; }, [botIdx]);
  useEffect(() => { userIdxRef.current = userIdx; }, [userIdx]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const clearBot = useCallback(() => {
    botRef.current.alive = false;
    for (const t of botRef.current.timers) clearTimeout(t);
    botRef.current.timers = [];
  }, []);

  const send = useCallback((msg) => {
    const c = connRef.current;
    if (c && c.open) { try { c.send(msg); } catch {} }
  }, []);

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
    setUserIdx(0); setBotIdx(0); setUserInput(""); setWinner(null);
  }, []);

  const finishMatch = useCallback((who) => {
    if (phaseRef.current === "ended") return;
    clearBot();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setWinner(who);
    setPhase("ended");
    if (who === "user") playWin(); else playLose();
  }, [clearBot]);

  const handleMessage = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    const mode = netModeRef.current;
    if (mode === "host") {
      if (data.t === "hello") {
        const name = randomName();
        setOppName(name);
        send({ t: "lob", oppName: "friend", myName: name });
      } else if (data.t === "p") {
        setBotIdx(data.i);
      } else if (data.t === "w") {
        finishMatch("bot");
      }
    } else if (mode === "guest") {
      if (data.t === "lob") {
        setOppName(data.oppName || "friend");
      } else if (data.t === "q") {
        setQuestions(data.questions);
        setUserIdx(0);
        setBotIdx(0);
        setUserInput("");
        setWinner(null);
        setBotStatus("waiting");
        setPhase("countdown");
        setCountdown(3);
      } else if (data.t === "p") {
        setBotIdx(data.i);
      } else if (data.t === "w") {
        finishMatch("bot");
      }
    }
  }, [send, finishMatch]);

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
        setOppName("");
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

  // auto-join from URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("room");
    if (r && !peerRef.current) joinRoom(r);
    // eslint-disable-next-line
  }, []);

  // broadcast my progress when it changes (network modes only)
  useEffect(() => {
    if (netMode === "local") return;
    send({ t: "p", i: userIdx });
    if (userIdx >= TARGET) send({ t: "w" });
  }, [userIdx, netMode, send]);

  // cleanup peer on unmount
  useEffect(() => () => {
    if (peerRef.current) { try { peerRef.current.destroy(); } catch {}; peerRef.current = null; }
  }, []);

  // bot loop
  const botStep = useCallback(() => {
    const bot = botRef.current;
    if (!bot.alive) return;
    if (phaseRef.current !== "playing") return;
    const idx = botIdxRef.current;
    if (idx >= TARGET) return;
    const q = questionsRef.current[idx];
    if (!q) return;
    const p = bot.personality;
    const willMistake = Math.random() < p.mistake;
    const targetVal = willMistake ? fudgeAnswer(q.answer) : q.answer;
    const targetStr = String(targetVal);
    const thinkMs = p.think + Math.random() * p.thinkVar + idx * 120;

    setBotStatus("thinking");
    setBotTyped("");

    bot.timers.push(setTimeout(() => {
      if (!bot.alive || phaseRef.current !== "playing") return;
      setBotStatus("typing");
      let i = 0;
      const typeNext = () => {
        if (!bot.alive || phaseRef.current !== "playing") return;
        if (i >= targetStr.length) {
          // submit
          if (targetVal === q.answer) {
            const nextIdx = idx + 1;
            botIdxRef.current = nextIdx;
            setBotIdx(nextIdx);
            setBotTyped("");
            setBotStatus("waiting");
            if (nextIdx >= TARGET) {
              finishMatch("bot");
              return;
            }
            bot.timers.push(setTimeout(botStep, 250 + Math.random() * 500));
          } else {
            // wrong — brief pause, retry
            bot.timers.push(setTimeout(() => {
              if (!bot.alive) return;
              setBotTyped("");
              bot.timers.push(setTimeout(botStep, 200 + Math.random() * 400));
            }, 350 + Math.random() * 400));
          }
          return;
        }
        setBotTyped(targetStr.slice(0, i + 1));
        i += 1;
        // occasional mid-type pause
        const extra = Math.random() < 0.08 ? 300 + Math.random() * 500 : 0;
        bot.timers.push(setTimeout(typeNext, p.charDelay + Math.random() * p.charVar + extra));
      };
      typeNext();
    }, thinkMs));
  }, [finishMatch]);

  // MATCHING phase
  useEffect(() => {
    if (phase !== "matching") return;
    const labels = ["finding opponent", "scanning region", "opponent found"];
    let i = 0;
    setMatchingLabel(labels[0]);
    const t1 = setInterval(() => {
      i += 1;
      if (i < labels.length) setMatchingLabel(labels[i]);
    }, 700);
    const t2 = setTimeout(() => {
      setBotName(randomName());
      setPhase("countdown");
      setCountdown(3);
    }, 2200);
    return () => { clearInterval(t1); clearTimeout(t2); };
  }, [phase]);

  // COUNTDOWN
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      playGo();
      setPhase("playing");
      return;
    }
    playTick();
    const t = setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // PLAYING start
  useEffect(() => {
    if (phase !== "playing") return;
    startedAtRef.current = performance.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(performance.now() - startedAtRef.current);
    }, 100);
    // launch bot only for local (bot) mode
    if (netModeRef.current === "local") {
      botRef.current.personality = pickPersonality();
      botRef.current.alive = true;
      botRef.current.timers.push(setTimeout(botStep, 500 + Math.random() * 400));
    }
    return () => {
      clearBot();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, botStep, clearBot]);

  // user auto-submit when answer matches
  useEffect(() => {
    if (phase !== "playing") return;
    if (userInput.trim() === "") return;
    const q = questions[userIdx];
    if (!q) return;
    const val = Number(userInput);
    if (Number.isFinite(val) && val === q.answer) {
      const nextIdx = userIdx + 1;
      setUserIdx(nextIdx);
      setUserInput("");
      if (nextIdx >= TARGET) {
        finishMatch("user");
      } else {
        playCorrect();
      }
    }
  }, [userInput, userIdx, questions, phase, finishMatch]);

  const startMatch = useCallback(() => {
    initAudio();
    clearBot();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setQuestions(buildQuestions());
    setUserIdx(0);
    setBotIdx(0);
    setUserInput("");
    setBotTyped("");
    setBotStatus("waiting");
    setWinner(null);
    setElapsed(0);
    setPhase("matching");
  }, [clearBot]);

  const startFriendMatch = useCallback(() => {
    initAudio();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const qs = buildQuestions();
    setQuestions(qs);
    setUserIdx(0);
    setBotIdx(0);
    setUserInput("");
    setBotTyped("");
    setBotStatus("waiting");
    setWinner(null);
    setElapsed(0);
    setPhase("countdown");
    setCountdown(3);
    send({ t: "q", questions: qs });
  }, [send]);

  const pressDigit = useCallback((d) => {
    if (phaseRef.current !== "playing") return;
    playKey();
    setUserInput((v) => {
      const next = (v + d).slice(0, 6);
      return d === "-" ? (v.startsWith("-") ? v.slice(1) : "-" + v) : next;
    });
  }, []);

  const pressBack = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    playKey();
    setUserInput((v) => v.slice(0, -1));
  }, []);

  const pressClear = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    playKey();
    setUserInput("");
  }, []);

  // physical keyboard support
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") { pressDigit(e.key); e.preventDefault(); }
      else if (e.key === "-") { pressDigit("-"); e.preventDefault(); }
      else if (e.key === "Backspace") { pressBack(); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === "Escape") {
        const q = questionsRef.current[userIdxRef.current];
        if (q && Number(userInput) !== q.answer) {
          playWrong();
          setWrongFlash(true);
          setTimeout(() => setWrongFlash(false), 250);
          setUserInput("");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pressDigit, pressBack, userInput]);

  const userQ = questions[userIdx];
  const botQ = questions[botIdx];

  return (
    <div
      className="relative w-full h-[100dvh] text-white font-mono overflow-hidden transition-colors duration-500"
      style={{
        background:
          phase === "ended"
            ? winner === "user"
              ? "radial-gradient(circle at 50% 30%, #14532d 0%, #052014 55%, #010a06 100%)"
              : "radial-gradient(circle at 50% 30%, #4a0a12 0%, #260408 55%, #0a0203 100%)"
            : "#0a0a12",
      }}
    >
      {/* Mute toggle */}
      <button
        type="button"
        onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono tracking-widest px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation"
        aria-label={muted ? "unmute" : "mute"}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* Split panels */}
      {(phase === "playing" || phase === "ended") && (
        <div className="grid grid-cols-2 h-full pb-64 sm:pb-32">
          {/* left — you */}
          <Panel
            side="left"
            accent="#4cc9f0"
            name="you"
            score={userIdx}
            active={phase === "playing"}
            question={userQ}
            wrongFlash={wrongFlash}
          >
            <div
              className={`w-full text-center text-3xl sm:text-6xl tabular-nums tracking-tight h-[1.2em] ${wrongFlash ? "text-red-400" : "text-white"}`}
            >
              {userInput || <span className="text-white/25">?</span>}
              {phase === "playing" && (
                <span className="inline-block w-[2px] h-[0.8em] align-middle ml-1 bg-[#4cc9f0] animate-pulse" />
              )}
            </div>
          </Panel>

          {/* right — opponent */}
          <Panel
            side="right"
            accent="#c77dff"
            name={netMode === "local" ? (botName || "opponent") : (oppName || "friend")}
            score={botIdx}
            active={phase === "playing"}
            question={botQ}
          >
            <div className="w-full h-[1.2em] text-3xl sm:text-6xl text-center tabular-nums text-white/90">
              {netMode !== "local" ? (
                <span className="text-white/40 text-lg sm:text-3xl italic">solving<span className="animate-pulse">…</span></span>
              ) : botStatus === "thinking" ? (
                <span className="text-white/40 text-lg sm:text-3xl italic">thinking…</span>
              ) : botTyped ? (
                <span>{botTyped}<span className="text-white/40 animate-pulse">|</span></span>
              ) : (
                <span className="text-white/20">·</span>
              )}
            </div>
          </Panel>

          {/* central timer */}
          <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 text-white/50 text-sm tabular-nums">
            {(elapsed / 1000).toFixed(1)}s
          </div>

          {/* divider */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/10" />

          {/* on-screen keypad — anchored to viewport so it always sits at the bottom */}
          {phase === "playing" && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(320px,calc(100%-24px))] sm:w-[320px] sm:bottom-6 z-10">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {["1","2","3","4","5","6","7","8","9"].map((d) => (
                  <KeyBtn key={d} onPress={() => pressDigit(d)}>{d}</KeyBtn>
                ))}
                <KeyBtn onPress={pressClear} variant="ghost">C</KeyBtn>
                <KeyBtn onPress={() => pressDigit("0")}>0</KeyBtn>
                <KeyBtn onPress={pressBack} variant="ghost">⌫</KeyBtn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="fixed inset-0 flex flex-col items-center justify-center px-6 text-center z-20 gap-6 overflow-y-auto py-8">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-xs mb-4">math duel</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight mb-3">first to 10.</h1>
            <p className="text-white/60 max-w-sm mx-auto text-sm sm:text-base">
              ten questions, one opponent. type the answer — no enter needed.
            </p>
          </div>

          {netMode === "local" && (
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={startMatch}
                className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation select-none"
              >
                find match (vs bot)
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
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-white/50 text-[10px] uppercase tracking-widest">room code</div>
                    <div className="text-3xl font-mono font-semibold tracking-widest">{roomId}</div>
                  </div>
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
                  <div className="text-white/30 text-xs break-all">
                    {typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?room=${roomId}` : ""}
                  </div>

                  <div className="text-white/60 text-sm mt-4">
                    {oppName ? (
                      <span className="text-[#c77dff]">{oppName} joined</span>
                    ) : (
                      <span className="text-white/40">waiting for opponent…</span>
                    )}
                  </div>

                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={!oppName}
                      onClick={startFriendMatch}
                      className="px-6 py-3 rounded-full bg-white text-black font-medium tracking-tight disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
                    >
                      start game
                    </button>
                    <button
                      type="button"
                      onClick={leaveNet}
                      className="px-4 py-3 rounded-full text-white/60 hover:text-white text-sm cursor-pointer touch-manipulation"
                    >
                      cancel
                    </button>
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
                  <button
                    type="button"
                    onClick={leaveNet}
                    className="mt-2 text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation"
                  >
                    leave
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* MATCHING */}
      {phase === "matching" && (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 z-20">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-2 border-white/10" />
            <div className="absolute inset-0 rounded-full border-2 border-t-white animate-spin" />
          </div>
          <div className="text-white/70 tracking-wide">{matchingLabel}…</div>
        </div>
      )}

      {/* COUNTDOWN */}
      {phase === "countdown" && (
        <div className="fixed inset-0 flex flex-col items-center justify-center z-20">
          <div className="text-white/50 text-sm mb-6 tracking-widest uppercase">
            <span className="text-[#4cc9f0]">you</span>
            <span className="mx-3 text-white/30">vs</span>
            <span className="text-[#c77dff]">{netMode === "local" ? botName : (oppName || "friend")}</span>
          </div>
          <div className="text-9xl font-semibold tabular-nums">
            {countdown === 0 ? "go" : countdown}
          </div>
        </div>
      )}

      {/* ENDED overlay */}
      {phase === "ended" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 sm:p-10 max-w-sm w-[92%] text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">{winner === "user" ? "🏆" : "🫠"}</div>
            <div className="text-2xl font-semibold tracking-tight mb-1">
              {winner === "user" ? "you won" : `${netMode === "local" ? botName : (oppName || "friend")} won`}
            </div>
            <div className="text-white/50 text-sm mb-6">
              {(elapsed / 1000).toFixed(1)}s · you {userIdx}/{TARGET} · {netMode === "local" ? botName : (oppName || "friend")} {botIdx}/{TARGET}
            </div>
            {netMode === "guest" ? (
              <div className="w-full py-3 text-white/50 text-sm">waiting for host…</div>
            ) : netMode === "host" ? (
              <button
                type="button"
                onClick={startFriendMatch}
                className="w-full py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation select-none"
              >
                rematch
              </button>
            ) : (
              <button
                type="button"
                onClick={startMatch}
                className="w-full py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation select-none"
              >
                rematch
              </button>
            )}
            <button
              type="button"
              onClick={() => netMode === "local" ? setPhase("lobby") : leaveNet()}
              className="w-full mt-2 py-3 rounded-full text-white/60 hover:text-white transition cursor-pointer touch-manipulation select-none"
            >
              {netMode === "local" ? "back" : "leave"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function KeyBtn({ children, onPress, variant }) {
  const base =
    "select-none touch-manipulation active:scale-95 transition-transform h-14 sm:h-16 rounded-2xl text-2xl sm:text-3xl font-semibold tabular-nums flex items-center justify-center";
  const style =
    variant === "ghost"
      ? "bg-white/[0.04] text-white/60 hover:bg-white/[0.08] active:bg-white/[0.1]"
      : "bg-white/[0.08] text-white hover:bg-white/[0.12] active:bg-white/[0.16]";
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); onPress(); }}
      className={`${base} ${style}`}
    >
      {children}
    </button>
  );
}

function Panel({ side, accent, name, score, active, question, wrongFlash, children }) {
  const alignSide = side === "left" ? "items-start" : "items-end";
  const scorePct = Math.min(100, (score / TARGET) * 100);
  return (
    <div className={`relative flex flex-col justify-between p-3 sm:p-10 min-w-0 overflow-hidden ${wrongFlash ? "bg-red-900/10" : ""} transition-colors duration-150`}>
      {/* header */}
      <div className={`flex ${side === "left" ? "flex-row" : "flex-row-reverse"} items-center gap-3`}>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-black font-semibold text-sm"
          style={{ background: accent }}
        >
          {name[0]?.toUpperCase()}
        </div>
        <div className={`flex flex-col ${side === "right" ? "items-end" : "items-start"}`}>
          <div className="text-sm text-white/80">{name}</div>
          <div className="text-[10px] text-white/40 uppercase tracking-widest">
            {score}/{TARGET}
          </div>
        </div>
      </div>

      {/* question */}
      <div className={`flex-1 flex flex-col items-center justify-center gap-3 sm:gap-8 min-w-0 ${!active ? "opacity-60" : ""}`}>
        <div className="text-3xl sm:text-7xl font-semibold tracking-tight text-white/90 tabular-nums text-center break-words">
          {question ? question.text : "—"}
        </div>
        <div className="text-lg sm:text-2xl text-white/40">=</div>
        <div className="w-full max-w-xs">{children}</div>
      </div>

      {/* progress */}
      <div className={`flex ${side === "left" ? "justify-start" : "justify-end"}`}>
        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${scorePct}%`, background: accent }}
          />
        </div>
      </div>
    </div>
  );
}
