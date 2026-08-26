"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { puzzleForDate } from "./puzzles";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playWin, playLose, playKey } from "../lib/sound";

const MAX_GUESSES = 5;

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// letter-level share pattern: 🟩 = correct letter, 🟨 = present, ⬜ = missing
function pattern(guess, answer) {
  const g = normalize(guess);
  const a = normalize(answer);
  // Very simple: mark correct-position letters green
  const res = [];
  for (let i = 0; i < Math.max(g.length, a.length); i++) {
    if (i >= g.length) { res.push("⬜"); continue; }
    if (i >= a.length) { res.push("🟨"); continue; }
    if (g[i] === a[i]) res.push("🟩");
    else if (a.includes(g[i])) res.push("🟨");
    else res.push("⬜");
  }
  return res.slice(0, 24).join("");
}

// storage
function storeKey(day) { return `emojile-${day}`; }
function loadState(day) {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(storeKey(day));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function saveState(day, state) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(storeKey(day), JSON.stringify(state)); } catch {}
}

export default function Game() {
  const puzzle = useMemo(() => puzzleForDate(), []);
  const [guesses, setGuesses] = useState([]); // [{text, correct}]
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("playing"); // playing | won | lost
  const [muted, setMutedState] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMutedState(isMuted());
    const saved = loadState(puzzle.dayNumber);
    if (saved) {
      setGuesses(saved.guesses || []);
      setStatus(saved.status || "playing");
    }
  }, [puzzle.dayNumber]);

  useEffect(() => {
    saveState(puzzle.dayNumber, { guesses, status });
  }, [puzzle.dayNumber, guesses, status]);

  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  const submit = useCallback(() => {
    if (status !== "playing") return;
    const g = input.trim();
    if (!g) return;
    initAudio();
    playKey();
    const correct = normalize(g) === normalize(puzzle.answer);
    const entry = { text: g, correct };
    const next = [...guesses, entry];
    setGuesses(next);
    setInput("");
    if (correct) {
      setStatus("won");
      playWin();
    } else if (next.length >= MAX_GUESSES) {
      setStatus("lost");
      playLose();
    } else {
      playWrong();
    }
  }, [input, status, guesses, puzzle.answer]);

  const shareText = useMemo(() => {
    const lines = [`emojile #${puzzle.dayNumber}  ${status === "won" ? guesses.length : "X"}/${MAX_GUESSES}`];
    lines.push(puzzle.emoji);
    for (const g of guesses) lines.push(pattern(g.text, puzzle.answer));
    lines.push("megabrain.lol/emojile");
    return lines.join("\n");
  }, [puzzle, guesses, status]);

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [shareText]);

  return (
    <div className="relative min-h-[100dvh] bg-[#0a0a12] text-white font-mono flex flex-col">
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      <div className="flex-1 flex flex-col items-center px-4 pt-16 pb-8 max-w-md mx-auto w-full gap-5">
        <div className="text-center">
          <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-2">emojile</div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">guess the phrase.</h1>
          <div className="text-white/50 text-xs">
            puzzle #{puzzle.dayNumber} · {puzzle.category} · {MAX_GUESSES} guesses
          </div>
        </div>

        {/* Emoji clue */}
        <div className="w-full bg-white/[0.04] border border-white/10 rounded-2xl p-8 sm:p-10 text-center">
          <div className="text-5xl sm:text-6xl leading-tight tracking-widest">{puzzle.emoji}</div>
        </div>

        {/* Guess history */}
        {guesses.length > 0 && (
          <div className="w-full space-y-2">
            {guesses.map((g, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm flex items-center justify-between ${
                  g.correct ? "bg-emerald-500/15 border border-emerald-500/40" : "bg-white/[0.03] border border-white/10"
                }`}
              >
                <div className="flex-1 text-white/90 lowercase truncate">{g.text}</div>
                <div className="text-xs tabular-nums text-white/60 ml-2">{pattern(g.text, puzzle.answer)}</div>
              </div>
            ))}
          </div>
        )}

        {status === "playing" && (
          <div className="w-full flex flex-col gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-lg font-mono text-white outline-none focus:border-white/30"
              placeholder="type your guess…"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <button type="button" onClick={submit}
              disabled={!input.trim()}
              className="w-full py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer touch-manipulation">
              guess ({MAX_GUESSES - guesses.length} left)
            </button>
          </div>
        )}

        {status !== "playing" && (
          <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
            <div className="text-4xl mb-2">{status === "won" ? "🎉" : "🫠"}</div>
            <div className="text-xl font-semibold tracking-tight mb-1">
              {status === "won" ? `solved in ${guesses.length}/${MAX_GUESSES}` : "out of guesses"}
            </div>
            <div className="text-white/60 text-sm mb-4">
              answer: <span className="text-white font-semibold lowercase">{puzzle.answer}</span>
            </div>
            <button type="button" onClick={share}
              className="w-full py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation mb-2">
              {copied ? "copied ✓" : "share result"}
            </button>
            <div className="text-white/40 text-xs">new puzzle tomorrow</div>
          </div>
        )}
      </div>
    </div>
  );
}
