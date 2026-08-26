"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initAudio, isMuted, setMuted, playCorrect, playWrong, playWin, playKey } from "../lib/sound";

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const ROMANS = /[IVXLCDM]+/g;

function romanToInt(s) {
  const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = m[s[i]];
    const nx = m[s[i + 1]];
    if (nx && nx > c) { n += nx - c; i++; } else n += c;
  }
  return n;
}

const CHESS_UNICODE = "♔♕♖♗♘♙♚♛♜♝♞♟";

// Rules — each has: id, label, check(pw)
const RULES = [
  {
    id: 1,
    label: "your password must be at least 8 characters.",
    check: (p) => p.length >= 8,
  },
  {
    id: 2,
    label: "your password must include a number.",
    check: (p) => /\d/.test(p),
  },
  {
    id: 3,
    label: "your password must include an uppercase letter.",
    check: (p) => /[A-Z]/.test(p),
  },
  {
    id: 4,
    label: "your password must include a special character.",
    check: (p) => /[^A-Za-z0-9]/.test(p),
  },
  {
    id: 5,
    label: "the digits in your password must add up to 25.",
    check: (p) => {
      const digits = (p.match(/\d/g) || []).map(Number);
      if (digits.length === 0) return false;
      return digits.reduce((a, b) => a + b, 0) === 25;
    },
  },
  {
    id: 6,
    label: "your password must include a month of the year.",
    check: (p) => MONTHS.some((m) => p.toLowerCase().includes(m)),
  },
  {
    id: 7,
    label: "your password must include a roman numeral.",
    check: (p) => /[IVXLCDM]/.test(p),
  },
  {
    id: 8,
    label: "the roman numerals in your password should multiply to 35.",
    check: (p) => {
      const matches = p.match(ROMANS) || [];
      if (matches.length === 0) return false;
      const product = matches.reduce((a, m) => a * romanToInt(m), 1);
      return product === 35;
    },
  },
  {
    id: 9,
    label: `your password must include one of these chess pieces: ${CHESS_UNICODE}.`,
    check: (p) => [...CHESS_UNICODE].some((c) => p.includes(c)),
  },
  {
    id: 10,
    label: "your password must include the length of your password (as a number).",
    check: (p) => {
      const len = String(p.length);
      return p.includes(len);
    },
  },
  {
    id: 11,
    label: "the sum of two consecutive digits must appear in your password.",
    check: (p) => {
      const digits = (p.match(/\d/g) || []).map(Number);
      if (digits.length < 2) return false;
      for (let i = 0; i < digits.length - 1; i++) {
        const sum = digits[i] + digits[i + 1];
        if (p.includes(String(sum))) return true;
      }
      return false;
    },
  },
  {
    id: 12,
    label: "your password must include today's day of the week (english).",
    check: (p) => {
      const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
      const today = days[new Date().getDay()];
      return p.toLowerCase().includes(today);
    },
  },
];

export default function Game() {
  const [password, setPassword] = useState("");
  const [maxUnlocked, setMaxUnlocked] = useState(1); // highest rule ever satisfied
  const [muted, setMutedState] = useState(false);
  const [won, setWon] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);
  const prevSatisfiedRef = useRef(new Set());

  useEffect(() => { setMutedState(isMuted()); }, []);
  const toggleMute = useCallback(() => {
    initAudio();
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  useEffect(() => {
    if (password.length > 0 && !startedAt) setStartedAt(Date.now());
  }, [password, startedAt]);

  // determine which rules are currently unlocked (shown to the user)
  // Rule N is unlocked once rules 1..N-1 have all been satisfied AT LEAST ONCE.
  const unlockedCount = maxUnlocked;
  const shown = RULES.slice(0, unlockedCount);
  const results = shown.map((r) => ({ ...r, ok: password.length > 0 ? r.check(password) : false }));
  const allOk = results.length > 0 && results.every((r) => r.ok);

  // auto-unlock next rule when all shown are satisfied
  useEffect(() => {
    if (!password) return;
    if (allOk && unlockedCount < RULES.length) {
      const t = setTimeout(() => {
        playKey();
        setMaxUnlocked((n) => Math.min(RULES.length, n + 1));
      }, 250);
      return () => clearTimeout(t);
    }
    if (allOk && unlockedCount === RULES.length && !won) {
      setWon(true);
      setFinishedAt(Date.now());
      playWin();
    }
  }, [allOk, unlockedCount, password, won]);

  // play sound when a rule flips from unmet to met
  useEffect(() => {
    const nowSat = new Set(results.filter((r) => r.ok).map((r) => r.id));
    const prev = prevSatisfiedRef.current;
    for (const id of nowSat) if (!prev.has(id)) playCorrect();
    for (const id of prev) if (!nowSat.has(id) && shown.find((r) => r.id === id)) playWrong();
    prevSatisfiedRef.current = nowSat;
    // eslint-disable-next-line
  }, [password, unlockedCount]);

  const restart = useCallback(() => {
    setPassword("");
    setMaxUnlocked(1);
    setWon(false);
    setStartedAt(null);
    setFinishedAt(null);
    prevSatisfiedRef.current = new Set();
  }, []);

  const elapsed = finishedAt && startedAt ? finishedAt - startedAt : 0;

  return (
    <div className="relative min-h-[100dvh] bg-[#0a0a12] text-white font-mono flex flex-col">
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      <div className="flex-1 flex flex-col items-center px-4 pt-16 pb-8 max-w-2xl mx-auto w-full gap-6">
        <div className="text-center">
          <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-2">password game</div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-1">choose a password.</h1>
          <p className="text-white/60 text-sm">satisfy every rule that appears.</p>
        </div>

        <div className="w-full">
          <label className="block text-white/50 text-[10px] uppercase tracking-widest mb-2">please choose a password</label>
          <textarea
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            rows={3}
            className="w-full bg-white/[0.03] border border-white/10 rounded-xl p-3 text-lg font-mono text-white outline-none focus:border-white/30 resize-y"
            placeholder="type here…"
            autoFocus
          />
          <div className="text-right text-white/40 text-xs mt-1 tabular-nums">{password.length} chars</div>
        </div>

        {won ? (
          <div className="w-full bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-2">🏆</div>
            <div className="text-2xl font-semibold tracking-tight mb-1">you did it</div>
            <div className="text-white/60 text-sm mb-1">all {RULES.length} rules satisfied</div>
            <div className="text-white/40 text-xs mb-4 tabular-nums">in {(elapsed / 1000).toFixed(1)}s</div>
            <button type="button" onClick={restart}
              className="px-6 py-2 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 transition cursor-pointer touch-manipulation">
              new password
            </button>
          </div>
        ) : (
          <div className="w-full space-y-2">
            {results.slice().reverse().map((r, i) => (
              <div
                key={r.id}
                className={`rounded-xl p-3 border flex items-start gap-3 transition ${
                  r.ok
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-rose-500/10 border-rose-500/30"
                }`}
              >
                <div className={`text-lg leading-none pt-0.5 ${r.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.ok ? "✓" : "✕"}
                </div>
                <div className="flex-1">
                  <div className={`text-[10px] uppercase tracking-widest ${r.ok ? "text-emerald-400/70" : "text-rose-400/70"}`}>
                    rule {r.id}
                  </div>
                  <div className="text-sm text-white/90 leading-snug break-words">{r.label}</div>
                </div>
              </div>
            ))}
            <div className="text-center text-white/40 text-xs pt-2">
              {allOk && unlockedCount < RULES.length ? "unlocking next rule…" : `rule ${unlockedCount} of ${RULES.length}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
