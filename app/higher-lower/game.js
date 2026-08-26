"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GOOGLE_SEARCHES } from "./data";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playWin, playLose, playKey } from "../lib/sound";

function pickRandom(pool, exclude = []) {
  const filtered = pool.filter((p) => !exclude.includes(p.term));
  return filtered[Math.floor(Math.random() * filtered.length)];
}

function loadBest() {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem("hl-best");
  return v ? Number(v) : 0;
}
function saveBest(v) {
  if (typeof window === "undefined") return;
  localStorage.setItem("hl-best", String(v));
}

function formatVolume(v) {
  // v is in thousands (per data.js); display readable
  const actual = v * 1000;
  if (actual >= 1_000_000_000) return (actual / 1_000_000_000).toFixed(1) + "B";
  if (actual >= 1_000_000) return (actual / 1_000_000).toFixed(1) + "M";
  if (actual >= 1_000) return (actual / 1_000).toFixed(0) + "K";
  return actual.toString();
}

// animated counter — reveals the number from 0 up to target
function useCountUp(target, duration = 800, active) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) { setVal(0); return; }
    let raf = 0;
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      // ease-out
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return val;
}

export default function Game() {
  const [phase, setPhase] = useState("idle"); // idle | playing | reveal | ended
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [correct, setCorrect] = useState(null); // 'higher' | 'lower' | null
  const [muted, setMutedState] = useState(false);
  const usedRef = useRef([]);

  useEffect(() => { setBest(loadBest()); setMutedState(isMuted()); }, []);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const revealVal = useCountUp(right?.volume || 0, 900, phase === "reveal" || phase === "ended");

  const start = useCallback(() => {
    initAudio();
    usedRef.current = [];
    const a = pickRandom(GOOGLE_SEARCHES);
    const b = pickRandom(GOOGLE_SEARCHES, [a.term]);
    usedRef.current = [a.term, b.term];
    setLeft(a);
    setRight(b);
    setScore(0);
    setCorrect(null);
    setPhase("playing");
  }, []);

  const guess = useCallback((choice) => {
    if (phase !== "playing" || !left || !right) return;
    playKey();
    const isHigher = right.volume >= left.volume;
    const won = (choice === "higher" && isHigher) || (choice === "lower" && !isHigher);
    setCorrect(won ? choice : null);
    setPhase("reveal");
    setTimeout(() => {
      if (won) {
        playCorrect();
        const s = score + 1;
        setScore(s);
        // right becomes left, new right
        const next = pickRandom(GOOGLE_SEARCHES, [right.term]);
        usedRef.current.push(next.term);
        setTimeout(() => {
          setLeft(right);
          setRight(next);
          setCorrect(null);
          setPhase("playing");
        }, 850);
      } else {
        playWrong();
        setTimeout(() => {
          const b = loadBest();
          if (score > b) { saveBest(score); setBest(score); }
          if (score >= b && score > 0) playWin(); else playLose();
          setPhase("ended");
        }, 900);
      }
    }, 1000);
  }, [phase, left, right, score]);

  return (
    <div className="relative w-full h-[100dvh] text-white font-mono overflow-hidden select-none touch-none" style={{ touchAction: "none" }}>
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      {/* HUD score */}
      {(phase === "playing" || phase === "reveal") && (
        <div className="pointer-events-none absolute top-0 inset-x-0 pt-4 sm:pt-6 flex flex-col items-center z-10">
          <div className="text-white/40 text-[10px] uppercase tracking-widest">streak</div>
          <div className="text-5xl sm:text-6xl font-semibold tabular-nums">{score}</div>
          <div className="text-white/30 text-xs mt-1">best {best}</div>
        </div>
      )}

      {/* Playing view — split left / right */}
      {(phase === "playing" || phase === "reveal" || phase === "ended") && left && right && (
        <div className="absolute inset-0 grid grid-rows-2 sm:grid-rows-1 sm:grid-cols-2">
          {/* LEFT (known) */}
          <div className="flex flex-col items-center justify-center px-6 text-center" style={{
            background: "linear-gradient(140deg, #3d2a5a 0%, #1a1030 100%)",
          }}>
            <div className="text-white/60 text-xs uppercase tracking-widest mb-1">"{left.term}"</div>
            <div className="text-white/50 text-sm mb-4">has</div>
            <div className="text-5xl sm:text-6xl font-semibold tabular-nums">{formatVolume(left.volume)}</div>
            <div className="text-white/60 text-sm mt-2">monthly searches</div>
          </div>

          {/* RIGHT (guess) */}
          <div className="relative flex flex-col items-center justify-center px-6 text-center" style={{
            background: "linear-gradient(220deg, #2a4a5a 0%, #101a30 100%)",
          }}>
            <div className="text-white/60 text-xs uppercase tracking-widest mb-1">"{right.term}"</div>
            <div className="text-white/50 text-sm mb-4">has</div>
            {phase === "playing" ? (
              <>
                <div className="text-5xl sm:text-6xl font-semibold text-white/50">???</div>
                <div className="text-white/60 text-sm mt-2">searches vs "{left.term}"</div>
                <div className="flex flex-col gap-2 mt-6 w-full max-w-[220px]">
                  <button type="button" onClick={() => guess("higher")}
                    className="py-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 active:scale-95 transition text-white font-semibold cursor-pointer touch-manipulation">
                    ↑ higher
                  </button>
                  <button type="button" onClick={() => guess("lower")}
                    className="py-3 rounded-full bg-rose-500/80 hover:bg-rose-500 active:scale-95 transition text-white font-semibold cursor-pointer touch-manipulation">
                    ↓ lower
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  className="text-5xl sm:text-6xl font-semibold tabular-nums"
                  style={{ color: correct ? "#06d6a0" : "#ef476f" }}
                >
                  {formatVolume(revealVal)}
                </div>
                <div className="text-white/60 text-sm mt-2">monthly searches</div>
                <div
                  className="mt-4 text-xl font-semibold tracking-tight"
                  style={{ color: correct ? "#06d6a0" : "#ef476f" }}
                >
                  {correct ? "correct!" : "wrong"}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* IDLE / start */}
      {phase === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-5 z-20">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">higher or lower</div>
            <h1 className="text-4xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">google searches.</h1>
            <p className="text-white/60 max-w-sm mx-auto">
              which term gets more monthly google searches? guess higher or lower to keep the streak.
            </p>
          </div>
          {best > 0 && <div className="text-white/50 text-sm">best streak <span className="text-white font-semibold">{best}</span></div>}
          <button type="button" onClick={start}
            className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
            start guessing
          </button>
        </div>
      )}

      {/* ENDED */}
      {phase === "ended" && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">{score > 0 && score >= best ? "🔥" : "💀"}</div>
            <div className="text-2xl font-semibold tracking-tight mb-1">
              {score >= best && score > 0 ? "new best!" : "streak ended"}
            </div>
            <div className="text-white/50 text-sm mb-4">final streak</div>
            <div className="text-6xl font-semibold tabular-nums mb-1">{score}</div>
            <div className="text-white/40 text-xs mb-6">best {best}</div>
            <div className="flex gap-2">
              <button type="button" onClick={start}
                className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                play again
              </button>
              <button type="button" onClick={() => setPhase("idle")}
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
