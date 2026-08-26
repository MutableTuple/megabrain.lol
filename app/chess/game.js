"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { Chess } from "chess.js";
import { initAudio, isMuted, setMuted, playKey, playCorrect, playWin, playLose, playChessMove, playChessCapture, playChessCheck, playChessCastle } from "../lib/sound";

const PIECES = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

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
function hostPeerId(rid) { return `mb-chess-${rid}`; }

// ---------- minimax bot ----------

const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// piece-square tables (simplified, white perspective)
const PST_P = [
  0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5,  5, 10, 25, 25, 10,  5,  5,
  0,  0,  0, 20, 20,  0,  0,  0,
  5, -5,-10,  0,  0,-10, -5,  5,
  5, 10, 10,-20,-20, 10, 10,  5,
  0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_N = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

function squareIdx(sq) {
  const f = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return r * 8 + f;
}

function evaluate(chess) {
  if (chess.isCheckmate()) return chess.turn() === "w" ? -99999 : 99999;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  let s = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const idx = r * 8 + f;
      const mirror = (7 - r) * 8 + f;
      let v = PV[cell.type];
      if (cell.type === "p") v += cell.color === "w" ? PST_P[idx] : PST_P[mirror];
      if (cell.type === "n") v += cell.color === "w" ? PST_N[idx] : PST_N[mirror];
      s += cell.color === "w" ? v : -v;
    }
  }
  return s;
}

function minimax(chess, depth, alpha, beta) {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess);
  const moves = chess.moves({ verbose: true });
  const maximizing = chess.turn() === "w";
  // move ordering: captures first
  moves.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0));
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const v = minimax(chess, depth - 1, alpha, beta);
      chess.undo();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      chess.move(m);
      const v = minimax(chess, depth - 1, alpha, beta);
      chess.undo();
      if (v < best) best = v;
      if (v < beta) beta = v;
      if (beta <= alpha) break;
    }
    return best;
  }
}

function buildExplanation(move, category, bestSan, delta, isBest) {
  const cap = move.captured;
  const check = move.san.includes("+");
  const mate = move.san.includes("#");
  const isCastle = move.san === "O-O" || move.san === "O-O-O";
  const isPromotion = !!move.promotion;

  const pieceName = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const capturedName = cap ? pieceName[cap] : null;

  const parts = [];
  if (mate) parts.push("checkmate.");
  else if (check) parts.push("delivers check.");
  if (isCastle) parts.push(move.san === "O-O" ? "castles kingside for king safety." : "castles queenside for king safety.");
  if (isPromotion) parts.push(`promotes to a ${pieceName[move.promotion]}.`);
  if (capturedName && !mate) parts.push(`captures the ${capturedName}.`);

  const flavor = parts.length ? parts.join(" ") : moveFlavor(move);

  const cat = {
    best:       isBest ? "the top engine choice." : "one of the top choices.",
    good:       "solid — very close to the best available move.",
    inaccuracy: "slightly inaccurate — the position is a bit worse.",
    mistake:    "a mistake — this drops significant material or position.",
    blunder:    "a blunder — this changes the game.",
  }[category];

  let text = `${flavor} ${cat}`;
  if (!isBest && bestSan && category !== "best") {
    text += ` engine preferred ${bestSan}`;
    if (delta < 0) text += ` (${Math.abs(delta) > 99 ? "+" + Math.abs(Math.round(delta / 100)).toFixed(0) : Math.abs(delta) + "cp"} better).`;
    else text += ".";
  }
  return text;
}

function moveFlavor(move) {
  const p = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[move.piece];
  return `${p} to ${move.to}.`;
}

function chooseBotMove(chess, depth) {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  const isWhite = chess.turn() === "w";
  moves.sort(() => Math.random() - 0.5); // variety on equal scores
  let best = moves[0], bestScore = isWhite ? -Infinity : Infinity;
  for (const m of moves) {
    chess.move(m);
    const s = minimax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();
    if (isWhite ? s > bestScore : s < bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

// ---------- component ----------

const FILES = ["a","b","c","d","e","f","g","h"];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

const BOT_LEVELS = [
  { id: "easy",   label: "easy",   depth: 1, elo: 800  },
  { id: "medium", label: "medium", depth: 2, elo: 1200 },
  { id: "hard",   label: "hard",   depth: 3, elo: 1600 },
];

export default function Game() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | ended
  const [mode, setMode] = useState("bot"); // bot | friend
  const [netMode, setNetMode] = useState("local"); // local | host | guest
  const [roomId, setRoomId] = useState(null);
  const [netStatus, setNetStatus] = useState("idle");
  const [netError, setNetError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [oppName, setOppName] = useState("");
  const [level, setLevel] = useState("medium");
  const [myColor, setMyColor] = useState("w"); // 'w' | 'b'
  const [fen, setFen] = useState("");
  const [selected, setSelected] = useState(null); // e.g. 'e2'
  const [legalTargets, setLegalTargets] = useState([]);
  const [lastMove, setLastMove] = useState(null); // {from, to}
  const [history, setHistory] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState(null); // {winner: 'w'|'b'|'draw', reason}
  const [muted, setMutedState] = useState(false);
  const [viewPly, setViewPly] = useState(null); // null = latest; else 0..history.length
  const [analysis, setAnalysis] = useState(null); // array of {san, category, delta, best}
  const [analyzing, setAnalyzing] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [animatingMove, setAnimatingMove] = useState(null); // {from, to, piece} | null
  const [premove, setPremove] = useState(null); // {from, to, promotion} | null
  const [promotion, setPromotion] = useState(null); // {from, to, color, isPremove} | null
  const [annotations, setAnnotations] = useState([]); // [{type:'arrow'|'circle', from, to?}]
  const animateRef = useRef(true);
  useEffect(() => { animateRef.current = animate; }, [animate]);

  const chessRef = useRef(null);
  const phaseRef = useRef(phase);
  const netModeRef = useRef("local");
  const modeRef = useRef("bot");
  const myColorRef = useRef("w");
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const workerRef = useRef(null);
  const pendingBotIdRef = useRef(0);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { netModeRef.current = netMode; }, [netMode]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { myColorRef.current = myColor; }, [myColor]);
  useEffect(() => { setMutedState(isMuted()); }, []);

  if (!chessRef.current) chessRef.current = new Chess();

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

  const syncFromChess = useCallback(() => {
    const c = chessRef.current;
    setFen(c.fen());
    setHistory(c.history({ verbose: true }));
    if (c.isGameOver()) {
      let winner = "draw";
      let reason = "draw";
      if (c.isCheckmate()) { winner = c.turn() === "w" ? "b" : "w"; reason = "checkmate"; }
      else if (c.isStalemate()) reason = "stalemate";
      else if (c.isThreefoldRepetition()) reason = "repetition";
      else if (c.isInsufficientMaterial()) reason = "insufficient material";
      else if (c.isDraw()) reason = "50-move rule";
      setResult({ winner, reason });
      setPhase("ended");
      if (winner === "draw") { /* neutral sound */ }
      else if (winner === myColorRef.current) playWin();
      else playLose();
    }
  }, []);

  const runMoveEffects = useCallback((m) => {
    // sound
    if (m.san.includes("#")) { playChessCapture(); }
    else if (m.san.includes("+")) { playChessCheck(); }
    else if (m.san === "O-O" || m.san === "O-O-O") { playChessCastle(); }
    else if (m.captured) { playChessCapture(); }
    else { playChessMove(); }
    // animation
    if (animateRef.current) {
      setAnimatingMove({ from: m.from, to: m.to, piece: { color: m.color, type: m.piece } });
      setTimeout(() => setAnimatingMove(null), 220);
    }
  }, []);

  const applyMove = useCallback((moveObj) => {
    const c = chessRef.current;
    const m = c.move(moveObj);
    if (!m) return null;
    setLastMove({ from: m.from, to: m.to });
    setSelected(null);
    setLegalTargets([]);
    setViewPly(null);
    runMoveEffects(m);
    syncFromChess();
    return m;
  }, [syncFromChess, runMoveEffects]);

  const undoMove = useCallback(() => {
    if (phase !== "playing") return;
    if (mode !== "bot") return; // takeback disabled in friend mode
    if (thinking) return;
    const c = chessRef.current;
    if (c.history().length === 0) return;
    // undo my move + bot's response (2 plies) if it's my turn now
    const undos = c.turn() === myColor && c.history().length >= 2 ? 2 : 1;
    for (let i = 0; i < undos; i++) c.undo();
    setSelected(null);
    setLegalTargets([]);
    setViewPly(null);
    setPremove(null);
    const verbose = c.history({ verbose: true });
    setLastMove(verbose.length ? { from: verbose[verbose.length - 1].from, to: verbose[verbose.length - 1].to } : null);
    setResult(null);
    if (phaseRef.current === "ended") setPhase("playing");
    setFen(c.fen());
    setHistory(verbose);
    playKey();
  }, [phase, mode, thinking, myColor]);

  // bot worker init
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = new Worker(new URL("./bot-worker.js", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const { id, move } = e.data || {};
      // ignore stale responses
      if (id !== pendingBotIdRef.current) return;
      setThinking(false);
      if (!move) return;
      const c = chessRef.current;
      if (c.isGameOver()) return;
      // it might now be my turn if state changed under our feet
      if (c.turn() === myColorRef.current) return;
      const applied = c.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
      if (applied) {
        setLastMove({ from: applied.from, to: applied.to });
        runMoveEffects(applied);
        syncFromChess();
      }
    };
    workerRef.current = w;
    return () => { try { w.terminate(); } catch {} workerRef.current = null; };
  }, [runMoveEffects, syncFromChess]);

  // bot turn (dispatches to worker)
  useEffect(() => {
    if (phase !== "playing") return;
    if (mode !== "bot") return;
    const c = chessRef.current;
    if (c.turn() === myColor) return;
    if (c.isGameOver()) return;
    if (!workerRef.current) return;
    setThinking(true);
    const depth = BOT_LEVELS.find((l) => l.id === level)?.depth || 2;
    const id = ++pendingBotIdRef.current;
    const fen = c.fen();
    const t = setTimeout(() => {
      workerRef.current?.postMessage({ id, fen, depth });
    }, 250 + Math.random() * 400);
    return () => { clearTimeout(t); };
  }, [fen, phase, mode, myColor, level]);

  // compute what moves would be legal IF it were your turn (for premove targeting)
  const premoveTargets = useCallback((sq) => {
    const c = chessRef.current;
    const parts = c.fen().split(" ");
    parts[1] = myColorRef.current;
    // reset castling/en-passant to avoid engine choking
    try {
      const flipped = new Chess(parts.join(" "));
      return flipped.moves({ square: sq, verbose: true }).map((m) => m.to);
    } catch {
      return [];
    }
  }, []);

  // ---------- click handling ----------
  const onSquareClick = useCallback((sq) => {
    if (phase !== "playing") return;
    const c = chessRef.current;
    if (c.isGameOver()) return;
    const isMyTurn = c.turn() === myColor;
    const piece = c.get(sq);

    if (!isMyTurn) {
      // premove mode
      if (selected) {
        if (sq === selected) { setSelected(null); setLegalTargets([]); return; }
        if (piece && piece.color === myColor) {
          setSelected(sq);
          setLegalTargets(premoveTargets(sq));
          return;
        }
        // set premove — prompt promotion if pawn to back rank
        const srcPiece = c.get(selected);
        const rankOfDest = sq[1];
        if (srcPiece && srcPiece.type === "p" && ((srcPiece.color === "w" && rankOfDest === "8") || (srcPiece.color === "b" && rankOfDest === "1"))) {
          setPromotion({ from: selected, to: sq, color: myColor, isPremove: true });
          setSelected(null);
          setLegalTargets([]);
          return;
        }
        setPremove({ from: selected, to: sq, promotion: "q" });
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      if (piece && piece.color === myColor) {
        setSelected(sq);
        setLegalTargets(premoveTargets(sq));
        setPremove(null); // start fresh
        return;
      }
      // clicked opponent piece or empty — cancel any premove
      setPremove(null);
      return;
    }

    // it's my turn
    if (thinking && mode === "bot") return;
    if (selected) {
      if (sq === selected) { setSelected(null); setLegalTargets([]); return; }
      if (piece && piece.color === c.turn()) {
        setSelected(sq);
        setLegalTargets(c.moves({ square: sq, verbose: true }).map((m) => m.to));
        return;
      }
      const legal = c.moves({ square: selected, verbose: true }).find((m) => m.to === sq);
      if (!legal) { setSelected(null); setLegalTargets([]); return; }
      if (legal.promotion) {
        setPromotion({ from: selected, to: sq, color: myColor, isPremove: false });
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      const moveObj = { from: selected, to: sq };
      const m = applyMove(moveObj);
      if (m && mode === "friend") send({ t: "mv", from: m.from, to: m.to, promotion: null });
      return;
    }
    if (piece && piece.color === c.turn()) {
      setSelected(sq);
      setLegalTargets(c.moves({ square: sq, verbose: true }).map((m) => m.to));
    }
  }, [phase, thinking, mode, myColor, selected, applyMove, send, premoveTargets]);

  const attemptMove = useCallback((from, to) => {
    if (phase !== "playing") return;
    const c = chessRef.current;
    if (c.isGameOver()) return;
    const isMyTurn = c.turn() === myColor;
    if (!isMyTurn) {
      // set premove
      const piece = c.get(from);
      if (piece && piece.color === myColor) {
        const rankOfDest = to[1];
        if (piece.type === "p" && ((piece.color === "w" && rankOfDest === "8") || (piece.color === "b" && rankOfDest === "1"))) {
          setPromotion({ from, to, color: myColor, isPremove: true });
          setSelected(null);
          setLegalTargets([]);
          return;
        }
        setPremove({ from, to, promotion: "q" });
        setSelected(null);
        setLegalTargets([]);
      }
      return;
    }
    const legal = c.moves({ square: from, verbose: true }).find((m) => m.to === to);
    if (!legal) {
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    if (legal.promotion) {
      setPromotion({ from, to, color: myColor, isPremove: false });
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    const moveObj = { from, to };
    const m = applyMove(moveObj);
    if (m && mode === "friend") send({ t: "mv", from: m.from, to: m.to, promotion: null });
  }, [phase, myColor, mode, applyMove, send]);

  const clearAnnotations = useCallback(() => setAnnotations([]), []);

  const choosePromotion = useCallback((piece) => {
    if (!promotion) return;
    const { from, to, isPremove } = promotion;
    if (isPremove) {
      setPremove({ from, to, promotion: piece });
    } else {
      const m = applyMove({ from, to, promotion: piece });
      if (m && mode === "friend") send({ t: "mv", from: m.from, to: m.to, promotion: piece });
    }
    setPromotion(null);
  }, [promotion, applyMove, mode, send]);

  const cancelPromotion = useCallback(() => setPromotion(null), []);

  const toggleAnnotation = useCallback((a) => {
    setAnnotations((prev) => {
      const idx = prev.findIndex((x) =>
        x.type === a.type &&
        x.from === a.from &&
        (a.type === "circle" ? true : x.to === a.to)
      );
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, a];
    });
  }, []);

  // clear annotations when a move happens
  const histLenRef = useRef(0);
  useEffect(() => {
    if (history.length !== histLenRef.current) {
      histLenRef.current = history.length;
      setAnnotations([]);
    }
  }, [history.length]);

  // execute premove when your turn arrives (or clear if it's no longer legal)
  useEffect(() => {
    if (phase !== "playing") return;
    if (!premove) return;
    const c = chessRef.current;
    if (c.turn() !== myColor) return;
    // try to apply
    let applied = null;
    try {
      applied = c.move({ from: premove.from, to: premove.to, promotion: premove.promotion });
    } catch { applied = null; }
    if (applied) {
      setLastMove({ from: applied.from, to: applied.to });
      setSelected(null);
      setLegalTargets([]);
      runMoveEffects(applied);
      syncFromChess();
      if (mode === "friend") send({ t: "mv", from: applied.from, to: applied.to, promotion: premove.promotion || null });
    }
    setPremove(null);
  }, [fen, premove, phase, myColor, mode, runMoveEffects, syncFromChess, send]);

  // ---------- networking ----------
  const handleMessage = useCallback((data) => {
    if (!data || typeof data !== "object") return;
    const nm = netModeRef.current;
    if (data.t === "hello" && nm === "host") {
      const name = randomName();
      setOppName(name);
      send({ t: "lob", myName: name });
    } else if (data.t === "lob" && nm === "guest") {
      setOppName(data.myName || "friend");
    } else if (data.t === "start" && nm === "guest") {
      chessRef.current = new Chess();
      setMyColor(data.guestColor || "b");
      myColorRef.current = data.guestColor || "b";
      setLastMove(null);
      setSelected(null);
      setLegalTargets([]);
      setResult(null);
      setThinking(false);
      setMode("friend");
      modeRef.current = "friend";
      setPhase("playing");
      syncFromChess();
    } else if (data.t === "mv") {
      const c = chessRef.current;
      const m = c.move({ from: data.from, to: data.to, promotion: data.promotion || undefined });
      if (m) {
        setLastMove({ from: m.from, to: m.to });
        runMoveEffects(m);
        syncFromChess();
      }
    } else if (data.t === "resign") {
      const winner = myColorRef.current;
      setResult({ winner, reason: "opponent resigned" });
      setPhase("ended");
      playWin();
    }
  }, [send, syncFromChess, runMoveEffects]);

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
      conn.on("data", (d) => handleMessage(d));
      conn.on("close", () => { setNetError("opponent left"); setNetStatus("error"); connRef.current = null; });
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
      conn.on("open", () => { setNetStatus("ready"); connRef.current = conn; conn.send({ t: "hello" }); });
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
  const startBot = useCallback((chosenColor) => {
    initAudio();
    chessRef.current = new Chess();
    const col = chosenColor || (Math.random() < 0.5 ? "w" : "b");
    setMyColor(col);
    myColorRef.current = col;
    setLastMove(null);
    setSelected(null);
    setLegalTargets([]);
    setResult(null);
    setThinking(false);
    setViewPly(null);
    setAnalysis(null);
    setPremove(null);
    setPromotion(null);
    setMode("bot");
    modeRef.current = "bot";
    setPhase("playing");
    syncFromChess();
  }, [syncFromChess]);

  const startFriendMatch = useCallback(() => {
    initAudio();
    chessRef.current = new Chess();
    const hostColor = Math.random() < 0.5 ? "w" : "b";
    const guestColor = hostColor === "w" ? "b" : "w";
    setMyColor(hostColor);
    myColorRef.current = hostColor;
    setLastMove(null);
    setSelected(null);
    setLegalTargets([]);
    setResult(null);
    setThinking(false);
    setViewPly(null);
    setAnalysis(null);
    setPremove(null);
    setPromotion(null);
    setMode("friend");
    modeRef.current = "friend";
    setPhase("playing");
    send({ t: "start", guestColor });
    syncFromChess();
  }, [send, syncFromChess]);

  // navigation
  const historyLen = history.length;
  const goStart = useCallback(() => setViewPly(0), []);
  const goEnd = useCallback(() => setViewPly(null), []);
  const goPrev = useCallback(() => {
    setViewPly((v) => {
      const cur = v == null ? historyLen : v;
      return Math.max(0, cur - 1);
    });
  }, [historyLen]);
  const goNext = useCallback(() => {
    setViewPly((v) => {
      if (v == null) return null;
      const next = v + 1;
      return next >= historyLen ? null : next;
    });
  }, [historyLen]);

  // keyboard nav
  useEffect(() => {
    if (phase !== "playing" && phase !== "ended") return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") { goPrev(); e.preventDefault(); }
      else if (e.key === "ArrowRight") { goNext(); e.preventDefault(); }
      else if (e.key === "Home") { goStart(); e.preventDefault(); }
      else if (e.key === "End") { goEnd(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, goPrev, goNext, goStart, goEnd]);

  const runAnalysis = useCallback(() => {
    if (analyzing) return;
    setAnalyzing(true);
    // async chunked to keep UI responsive
    const moves = chessRef.current.history({ verbose: true });
    const results = [];
    const c = new Chess();
    let i = 0;
    const step = () => {
      if (i >= moves.length) {
        setAnalysis(results);
        setAnalyzing(false);
        return;
      }
      const move = moves[i];
      const turn = c.turn();
      // find best available move at this position (depth 2 for speed)
      const bestBefore = chooseBotMove(c, 2);
      const bestSan = bestBefore ? bestBefore.san : null;
      let evalBest = 0;
      if (bestBefore) {
        c.move(bestBefore);
        evalBest = evaluate(c);
        c.undo();
      }
      // apply actual move
      c.move({ from: move.from, to: move.to, promotion: move.promotion });
      const evalActual = evaluate(c);
      // from mover's perspective, delta = actual - best
      const perspective = turn === "w" ? 1 : -1;
      const delta = (evalActual - evalBest) * perspective; // negative = worse than best
      const absDelta = Math.abs(delta);
      let category;
      if (delta >= -15) category = "best";
      else if (absDelta < 50) category = "good";
      else if (absDelta < 120) category = "inaccuracy";
      else if (absDelta < 300) category = "mistake";
      else category = "blunder";
      // explanation
      const isBest = bestSan === move.san;
      const explanation = buildExplanation(move, category, bestSan, delta, isBest);
      results.push({
        ply: i,
        san: move.san,
        from: move.from,
        to: move.to,
        color: turn,
        category,
        delta: Math.round(delta),
        bestSan,
        explanation,
      });
      i += 1;
      setTimeout(step, 0);
    };
    step();
  }, [analyzing]);

  const resign = useCallback(() => {
    if (phase !== "playing") return;
    const winner = myColor === "w" ? "b" : "w";
    setResult({ winner, reason: "you resigned" });
    setPhase("ended");
    playLose();
    if (mode === "friend") send({ t: "resign" });
  }, [phase, myColor, mode, send]);

  // ---------- render ----------
  const c = chessRef.current;
  const opponentDisplayName = mode === "bot" ? "bot" : (oppName || "friend");
  const turnColor = c.turn();
  const flipped = myColor === "b";
  const isViewing = viewPly !== null && viewPly < historyLen;
  // compute display chess (for viewing past positions)
  let displayChess = c;
  let displayLastMove = lastMove;
  if (isViewing) {
    const dc = new Chess();
    const moves = c.history();
    for (let i = 0; i < viewPly; i++) dc.move(moves[i]);
    displayChess = dc;
    if (viewPly > 0) {
      const vh = c.history({ verbose: true });
      const m = vh[viewPly - 1];
      displayLastMove = m ? { from: m.from, to: m.to } : null;
    } else {
      displayLastMove = null;
    }
  }

  return (
    <div className="relative w-full min-h-[100dvh] bg-[#0a0a12] text-white font-mono overflow-hidden select-none touch-none flex flex-col" style={{ touchAction: "none" }}>
      {/* mute */}
      <button type="button" onClick={toggleMute}
        className="fixed top-2 right-2 sm:top-3 sm:right-3 z-30 text-white/50 hover:text-white text-xs font-mono px-2 py-1 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm transition cursor-pointer touch-manipulation">
        {muted ? "🔇" : "🔊"}
      </button>

      {/* promotion picker */}
      {promotion && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-40 px-4">
          <div className="bg-[#12121a] border border-white/10 rounded-2xl p-4 sm:p-5 shadow-2xl">
            <div className="text-white/60 text-[10px] uppercase tracking-widest mb-3 text-center">
              promote to {promotion.isPremove && <span className="text-amber-300">(premove)</span>}
            </div>
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { p: "q", label: "queen" },
                { p: "r", label: "rook" },
                { p: "b", label: "bishop" },
                { p: "n", label: "knight" },
              ].map(({ p, label }) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => choosePromotion(p)}
                  className="flex flex-col items-center gap-1 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 transition p-3 cursor-pointer touch-manipulation"
                >
                  <span
                    style={{
                      fontSize: "40px",
                      color: promotion.color === "w" ? THEME.wPiece : THEME.bPiece,
                      textShadow: promotion.color === "w"
                        ? "0 1.5px 0 rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.55)"
                        : "0 1px 0 rgba(255,255,255,0.25)",
                      lineHeight: 1,
                      filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))",
                    }}
                  >
                    {PIECES[promotion.color + p.toUpperCase()]}
                  </span>
                  <span className="text-white/50 text-[10px] font-mono">{label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={cancelPromotion}
              className="w-full mt-3 py-2 text-white/40 hover:text-white/70 text-xs cursor-pointer touch-manipulation"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* LOBBY */}
      {phase === "lobby" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6 py-8 overflow-y-auto">
          <div>
            <div className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-3">chess</div>
            <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none mb-3">♞ free forever.</h1>
            <p className="text-white/60 max-w-sm mx-auto text-sm sm:text-base">
              play chess vs a bot or a friend. no paywall.
            </p>
          </div>

          {netMode === "local" && (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="text-white/50 text-[10px] uppercase tracking-widest">bot level</div>
                <div className="flex gap-2">
                  {BOT_LEVELS.map((l) => (
                    <button key={l.id} type="button" onClick={() => setLevel(l.id)}
                      className={`px-4 py-2 rounded-xl text-sm cursor-pointer touch-manipulation flex flex-col items-center gap-0.5 min-w-[80px] ${
                        level === l.id ? "bg-white text-black" : "bg-white/10 text-white/60 hover:bg-white/15"
                      }`}>
                      <span className="font-medium">{l.label}</span>
                      <span className={`text-[10px] tabular-nums ${level === l.id ? "text-black/60" : "text-white/40"}`}>
                        ~{l.elo} elo
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-white/60 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={animate}
                    onChange={(e) => setAnimate(e.target.checked)}
                    className="w-4 h-4 accent-[#4cc9f0] cursor-pointer"
                  />
                  animate moves
                </label>
              </div>

              <div className="flex flex-col items-center gap-2">
                <button type="button" onClick={() => startBot("w")}
                  className="px-8 py-4 rounded-full bg-white text-black text-lg font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  play as ♔ white
                </button>
                <button type="button" onClick={() => startBot("b")}
                  className="px-6 py-3 rounded-full bg-white/10 text-white text-sm tracking-tight hover:bg-white/20 active:scale-95 transition cursor-pointer touch-manipulation">
                  play as ♚ black
                </button>
                <button type="button" onClick={() => startBot()}
                  className="px-6 py-3 rounded-full text-white/60 text-sm hover:text-white transition cursor-pointer touch-manipulation">
                  random color
                </button>
              </div>

              <button type="button" onClick={startHosting}
                className="text-white/60 hover:text-white text-sm underline underline-offset-4 cursor-pointer touch-manipulation">
                play with a friend →
              </button>

              <div className="text-white/30 text-xs max-w-sm">
                stockfish engine + post-game analysis coming next update.
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
                  <div className="text-white/30 text-xs">colors will be randomized</div>
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
      {(phase === "playing" || phase === "ended") && (
        <div className="flex-1 flex flex-col items-center px-3 pt-14 sm:pt-16 pb-4 gap-3 overflow-y-auto">
          {/* opponent header */}
          <div className="w-full max-w-[min(90vw,640px)] flex items-center justify-between">
            <div className="text-sm flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full ${turnColor !== myColor && phase === "playing" ? "bg-white/10" : ""}`}>
                {opponentDisplayName} <span className="text-white/40">({myColor === "w" ? "♚" : "♔"})</span>
              </span>
              {mode === "bot" && (
                <span className="text-[10px] text-white/40 tabular-nums">
                  ~{BOT_LEVELS.find((l) => l.id === level)?.elo} elo · {level}
                </span>
              )}
            </div>
            <div className="text-xs text-white/40">
              {phase === "playing" ? (
                thinking ? "thinking…" : turnColor === myColor ? "your turn" : `${opponentDisplayName}'s turn`
              ) : ""}
            </div>
          </div>

          {/* board */}
          <Board
            chess={displayChess}
            selected={isViewing ? null : selected}
            legalTargets={isViewing ? [] : legalTargets}
            lastMove={displayLastMove}
            onSquareClick={isViewing ? () => {} : onSquareClick}
            onMove={isViewing ? () => {} : attemptMove}
            flipped={flipped}
            animatingMove={isViewing ? null : animatingMove}
            premove={isViewing ? null : premove}
            annotations={annotations}
            onAnnotate={toggleAnnotation}
            onClearAnnotations={clearAnnotations}
            myColor={myColor}
          />

          {/* nav bar */}
          <div className="w-full max-w-md flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <NavBtn onClick={goStart} disabled={historyLen === 0 || viewPly === 0}>{"|<"}</NavBtn>
              <NavBtn onClick={goPrev} disabled={historyLen === 0 || viewPly === 0}>{"<"}</NavBtn>
              <NavBtn onClick={goNext} disabled={!isViewing}>{">"}</NavBtn>
              <NavBtn onClick={goEnd} disabled={!isViewing}>{">|"}</NavBtn>
            </div>
            <div className="text-[10px] text-white/40 font-mono tabular-nums">
              {isViewing ? `move ${viewPly}/${historyLen}` : historyLen > 0 ? `move ${historyLen}/${historyLen}` : ""}
            </div>
            <div className="flex items-center gap-1">
              {mode === "bot" && phase === "playing" && historyLen > 0 && (
                <NavBtn onClick={undoMove} title="undo last move (takeback)">↺</NavBtn>
              )}
            </div>
          </div>

          {isViewing && (
            <div className="text-xs text-amber-300/70">viewing history — <button onClick={goEnd} className="underline">back to game</button></div>
          )}

          {/* self header */}
          <div className="w-full max-w-[min(90vw,640px)] flex items-center justify-between">
            <div className="text-sm">
              <span className={`px-2 py-0.5 rounded-full ${turnColor === myColor && phase === "playing" ? "bg-white/10" : ""}`}>
                you <span className="text-white/40">({myColor === "w" ? "♔" : "♚"})</span>
              </span>
            </div>
            {phase === "playing" && (
              <button type="button" onClick={resign}
                className="text-xs text-white/40 hover:text-red-400 transition cursor-pointer touch-manipulation">
                resign
              </button>
            )}
          </div>

          {/* move history */}
          <div className="w-full max-w-[min(90vw,640px)] bg-white/[0.03] rounded-lg p-2 max-h-24 overflow-y-auto">
            <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">moves</div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
              {history.length === 0 && <div className="text-white/30">no moves yet</div>}
              {history.map((m, i) => {
                const currentPly = viewPly == null ? historyLen : viewPly;
                const isActive = currentPly === i + 1;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setViewPly(i + 1 >= historyLen ? null : i + 1)}
                    className={`px-1 rounded cursor-pointer touch-manipulation ${
                      isActive ? "bg-white/20 text-white" : i % 2 === 0 ? "text-white/80 hover:bg-white/10" : "text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ""} {m.san}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ENDED overlay — only if analysis not yet run */}
      {phase === "ended" && result && !analysis && !analyzing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30 px-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="text-4xl sm:text-5xl mb-1">
              {result.winner === "draw" ? "🤝" : result.winner === myColor ? "🏆" : "🫠"}
            </div>
            <div className="text-2xl font-semibold tracking-tight mb-1">
              {result.winner === "draw" ? "draw" : result.winner === myColor ? "you win" : `${opponentDisplayName} wins`}
            </div>
            <div className="text-white/50 text-sm mb-6">by {result.reason}</div>
            <button
              type="button"
              onClick={runAnalysis}
              className="w-full py-3 rounded-full bg-[#4cc9f0] text-black font-medium tracking-tight hover:opacity-90 active:scale-95 transition cursor-pointer touch-manipulation mb-2"
            >
              🧠 analyze game
            </button>
            <div className="flex gap-2">
              {netMode === "guest" ? (
                <div className="flex-1 py-3 text-white/50 text-sm">waiting for host…</div>
              ) : mode === "friend" && netMode === "host" ? (
                <button type="button" onClick={startFriendMatch}
                  className="flex-1 py-3 rounded-full bg-white text-black font-medium tracking-tight hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation">
                  rematch
                </button>
              ) : (
                <button type="button" onClick={() => startBot(myColor)}
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

      {/* analyzing spinner */}
      {analyzing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-30 gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <div className="text-white/70 text-sm">analyzing every move…</div>
        </div>
      )}

      {/* analysis panel */}
      {phase === "ended" && analysis && (
        <div className="fixed bottom-0 inset-x-0 bg-[#12121a] border-t border-white/10 z-30 max-h-[45vh] overflow-y-auto">
          <div className="max-w-2xl mx-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-white/40 uppercase tracking-widest text-[10px]">analysis</div>
                <div className="text-white/70 text-sm">
                  {result.winner === "draw" ? "draw" : result.winner === myColor ? "you won" : `${opponentDisplayName} won`}
                  {" · "}
                  {result.reason}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => netMode === "local" ? (mode === "friend" && netMode === "host" ? startFriendMatch() : startBot(myColor)) : startFriendMatch()}
                  className="px-4 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 active:scale-95 transition cursor-pointer touch-manipulation"
                >
                  rematch
                </button>
                <button
                  type="button"
                  onClick={() => netMode === "local" ? setPhase("lobby") : leaveNet()}
                  className="px-3 py-2 rounded-full text-white/60 hover:text-white text-sm cursor-pointer touch-manipulation"
                >
                  {netMode === "local" ? "back" : "leave"}
                </button>
              </div>
            </div>

            <AnalysisSummary analysis={analysis} myColor={myColor} />

            <div className="mt-3 space-y-1">
              {analysis.map((a, i) => {
                const isActive = (viewPly == null ? historyLen : viewPly) === i + 1;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setViewPly(i + 1 >= historyLen ? null : i + 1)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition ${
                      isActive ? "bg-white/15" : "bg-white/[0.03] hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-white/40 text-xs tabular-nums">
                        {a.color === "w" ? `${Math.floor(i / 2) + 1}.` : `${Math.floor(i / 2) + 1}…`}
                      </span>
                      <span className="font-mono text-white w-14">{a.san}</span>
                      <span
                        className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ color: CATEGORY_COLORS[a.category], background: CATEGORY_COLORS[a.category] + "22" }}
                      >
                        {a.category}
                      </span>
                      <span className="text-white/40 text-xs tabular-nums ml-auto">
                        {a.delta > 0 ? "+" : ""}{a.delta}cp
                      </span>
                    </div>
                    <div className="text-white/60 text-xs mt-1 ml-10 leading-relaxed">{a.explanation}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const THEME = {
  light: "#ebecd0",
  dark: "#779556",
  selected: "#baca44",
  lastLight: "#f7ec74",
  lastDark: "#dac034",
  check: "#e05a5a",
  premove: "#e07a3c",
  dotDark: "rgba(0,0,0,0.28)",
  dotLight: "rgba(0,0,0,0.3)",
  wPiece: "#ffffff",
  bPiece: "#111111",
};

const CATEGORY_COLORS = {
  best:       "#06d6a0",
  good:       "#a8dadc",
  inaccuracy: "#ffd166",
  mistake:    "#ff9a1f",
  blunder:    "#ef476f",
};

function AnalysisSummary({ analysis, myColor }) {
  const mine = analysis.filter((a) => a.color === myColor);
  const opp = analysis.filter((a) => a.color !== myColor);
  const count = (list, cat) => list.filter((a) => a.category === cat).length;
  const cats = ["best", "good", "inaccuracy", "mistake", "blunder"];
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      {[
        { label: "you", list: mine, color: "#4cc9f0" },
        { label: "opponent", list: opp, color: "#c77dff" },
      ].map((sec) => (
        <div key={sec.label} className="bg-white/[0.03] rounded-lg p-2">
          <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: sec.color }}>{sec.label}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {cats.map((c) => (
              <div key={c} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[c] }} />
                <span className="text-white/70">{count(sec.list, c)}</span>
                <span className="text-white/40 text-[10px]">{c}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NavBtn({ children, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-9 h-9 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition text-sm font-mono cursor-pointer touch-manipulation flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function Board({ chess, selected, legalTargets, lastMove, onSquareClick, flipped, disabled, animatingMove, premove, annotations, onAnnotate, onClearAnnotations, onMove, myColor }) {
  const hideSq = animatingMove ? animatingMove.to : null;
  const preFrom = premove ? premove.from : null;
  const preTo = premove ? premove.to : null;
  const boardRef = useRef(null);
  const [drag, setDrag] = useState(null); // {fromSq, piece, x, y, startX, startY, active}
  const [annotDrag, setAnnotDrag] = useState(null); // {fromSq, toSq}
  const dragHideSq = drag && drag.active ? drag.fromSq : null;

  const squareFromPoint = useCallback((cx, cy) => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    if (cx < rect.left || cx >= rect.right || cy < rect.top || cy >= rect.bottom) return null;
    const cellW = rect.width / 8;
    const col = Math.floor((cx - rect.left) / cellW);
    const row = Math.floor((cy - rect.top) / cellW);
    const file = flipped ? 7 - col : col;
    const rank = flipped ? row + 1 : 8 - row;
    return String.fromCharCode(97 + file) + rank;
  }, [flipped]);

  const handlePointerDown = (e) => {
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    // right-click OR shift-left → annotation
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      setAnnotDrag({ fromSq: sq, toSq: sq });
      try { boardRef.current?.setPointerCapture?.(e.pointerId); } catch {}
      return;
    }
    if (e.button === 0) {
      // left click clears any annotations
      if (annotations && annotations.length) onClearAnnotations();
      const piece = chess.get(sq);
      if (piece && piece.color === myColor) {
        setDrag({ fromSq: sq, piece, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false });
        try { boardRef.current?.setPointerCapture?.(e.pointerId); } catch {}
      }
      onSquareClick(sq);
    }
  };
  const handlePointerMove = (e) => {
    if (annotDrag) {
      const sq = squareFromPoint(e.clientX, e.clientY);
      if (sq && sq !== annotDrag.toSq) setAnnotDrag((a) => ({ ...a, toSq: sq }));
    }
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const dist = Math.hypot(dx, dy);
      if (!drag.active && dist > 6) {
        setDrag((d) => ({ ...d, active: true, x: e.clientX, y: e.clientY }));
      } else if (drag.active) {
        setDrag((d) => ({ ...d, x: e.clientX, y: e.clientY }));
      }
    }
  };
  const handlePointerUp = (e) => {
    if (annotDrag) {
      const from = annotDrag.fromSq;
      const to = squareFromPoint(e.clientX, e.clientY) || annotDrag.toSq;
      if (from === to) onAnnotate({ type: "circle", from });
      else onAnnotate({ type: "arrow", from, to });
      setAnnotDrag(null);
    }
    if (drag) {
      if (drag.active) {
        const sq = squareFromPoint(e.clientX, e.clientY);
        if (sq && sq !== drag.fromSq && onMove) {
          onMove(drag.fromSq, sq);
        }
      }
      setDrag(null);
    }
  };
  const files = flipped ? [...FILES].reverse() : FILES;
  const ranks = flipped ? [...RANKS].reverse() : RANKS;
  const inCheck = chess.inCheck();
  // find king square in check
  let checkSquare = null;
  if (inCheck) {
    const t = chess.turn();
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const sq = FILES[f] + RANKS[r];
        const p = chess.get(sq);
        if (p && p.type === "k" && p.color === t) { checkSquare = sq; break; }
      }
      if (checkSquare) break;
    }
  }
  return (
    <div
      ref={boardRef}
      className="relative w-full max-w-[min(90vw,640px)] aspect-square rounded-md overflow-hidden shadow-2xl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
    >
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {ranks.map((rank, ri) => files.map((file, fi) => {
          const sq = file + rank;
          const piece = chess.get(sq);
          const isDark = (ri + fi) % 2 === 1;
          const isSelected = selected === sq;
          const isLegal = legalTargets.includes(sq);
          const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq);
          const isCheck = checkSquare === sq;
          const isPremove = sq === preFrom || sq === preTo;
          const bgBase = isDark ? THEME.dark : THEME.light;
          const bg = isSelected
            ? THEME.selected
            : isPremove
            ? THEME.premove
            : isCheck
            ? THEME.check
            : isLast
            ? (isDark ? THEME.lastDark : THEME.lastLight)
            : bgBase;
          return (
            <div
              key={sq}
              className="relative flex items-center justify-center cursor-pointer"
              style={{ background: bg }}
            >
              {piece && sq !== hideSq && sq !== dragHideSq && (
                <span
                  className="pointer-events-none select-none"
                  style={{
                    fontSize: "clamp(22px, 9vw, 56px)",
                    color: piece.color === "w" ? THEME.wPiece : THEME.bPiece,
                    textShadow: piece.color === "w"
                      ? "0 1.5px 0 rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.55)"
                      : "0 1px 0 rgba(255,255,255,0.25)",
                    lineHeight: 1,
                    filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
                  }}
                >
                  {PIECES[piece.color + piece.type.toUpperCase()]}
                </span>
              )}
              {isLegal && !piece && (
                <div
                  className="pointer-events-none rounded-full"
                  style={{
                    width: "30%", height: "30%",
                    background: isDark ? THEME.dotDark : THEME.dotLight,
                  }}
                />
              )}
              {isLegal && piece && (
                <div
                  className="pointer-events-none absolute inset-0.5 rounded-full"
                  style={{
                    boxShadow: `inset 0 0 0 4px ${isDark ? THEME.dotDark : THEME.dotLight}`,
                  }}
                />
              )}
              {/* coordinates on edges */}
              {fi === 0 && (
                <div
                  className="absolute top-0.5 left-1 text-[10px] font-semibold pointer-events-none"
                  style={{ color: isDark ? THEME.light : THEME.dark }}
                >
                  {rank}
                </div>
              )}
              {ri === 7 && (
                <div
                  className="absolute bottom-0.5 right-1 text-[10px] font-semibold pointer-events-none"
                  style={{ color: isDark ? THEME.light : THEME.dark }}
                >
                  {file}
                </div>
              )}
            </div>
          );
        }))}
      </div>
      {animatingMove && <AnimatedPiece move={animatingMove} flipped={flipped} />}

      {/* premove ghost piece at destination */}
      {premove && (() => {
        const piece = chess.get(premove.from);
        if (!piece) return null;
        const { col, row } = squareToRC(premove.to, flipped);
        return (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${col * 12.5}%`,
              top: `${row * 12.5}%`,
              width: "12.5%",
              height: "12.5%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.5,
              zIndex: 5,
            }}
          >
            <span
              style={{
                fontSize: "clamp(22px, 9vw, 56px)",
                color: piece.color === "w" ? THEME.wPiece : THEME.bPiece,
                textShadow: piece.color === "w"
                  ? "0 1.5px 0 rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.55)"
                  : "0 1px 0 rgba(255,255,255,0.25)",
                lineHeight: 1,
              }}
            >
              {PIECES[piece.color + piece.type.toUpperCase()]}
            </span>
          </div>
        );
      })()}

      {/* annotations overlay */}
      {(annotations?.length > 0 || annotDrag) && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 8 8"
          preserveAspectRatio="none"
        >
          <defs>
            <marker id="arrowhead-green" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="3" markerHeight="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#4a9c3a" />
            </marker>
          </defs>
          {annotations?.map((a, i) => (
            <AnnotShape key={i} a={a} flipped={flipped} />
          ))}
          {annotDrag && (
            annotDrag.fromSq === annotDrag.toSq
              ? <AnnotShape a={{ type: "circle", from: annotDrag.fromSq }} flipped={flipped} preview />
              : <AnnotShape a={{ type: "arrow", from: annotDrag.fromSq, to: annotDrag.toSq }} flipped={flipped} preview />
          )}
        </svg>
      )}

      {/* drag ghost — position: fixed follows cursor across the page */}
      {drag && drag.active && (
        <div
          className="fixed pointer-events-none z-40"
          style={{
            left: drag.x, top: drag.y,
            transform: "translate(-50%, -50%)",
            fontSize: "clamp(28px, 10vw, 64px)",
            color: drag.piece.color === "w" ? THEME.wPiece : THEME.bPiece,
            textShadow: drag.piece.color === "w"
              ? "0 1.5px 0 rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.55)"
              : "0 1px 0 rgba(255,255,255,0.25)",
            filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))",
            lineHeight: 1,
          }}
        >
          {PIECES[drag.piece.color + drag.piece.type.toUpperCase()]}
        </div>
      )}
    </div>
  );
}

function AnnotShape({ a, flipped, preview }) {
  const opacity = preview ? 0.6 : 0.85;
  if (a.type === "circle") {
    const { col, row } = squareToRC(a.from, flipped);
    const cx = col + 0.5;
    const cy = row + 0.5;
    return (
      <circle
        cx={cx} cy={cy} r={0.44}
        fill="none" stroke="#4a9c3a" strokeWidth="0.09"
        opacity={opacity}
      />
    );
  }
  // arrow
  const { col: c1, row: r1 } = squareToRC(a.from, flipped);
  const { col: c2, row: r2 } = squareToRC(a.to, flipped);
  const x1 = c1 + 0.5, y1 = r1 + 0.5;
  const x2 = c2 + 0.5, y2 = r2 + 0.5;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // pull line back by arrow head
  const back = 0.32;
  const ex = x2 - (dx / len) * back;
  const ey = y2 - (dy / len) * back;
  return (
    <line
      x1={x1} y1={y1} x2={ex} y2={ey}
      stroke="#4a9c3a" strokeWidth="0.16"
      strokeLinecap="round"
      opacity={opacity}
      markerEnd="url(#arrowhead-green)"
    />
  );
}

function squareToRC(sq, flipped) {
  const file = sq.charCodeAt(0) - 97; // 0-7
  const rank = parseInt(sq[1], 10);   // 1-8
  const col = flipped ? 7 - file : file;
  const row = flipped ? rank - 1 : 8 - rank;
  return { col, row };
}

function AnimatedPiece({ move, flipped }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setProgress(1));
    return () => cancelAnimationFrame(raf);
  }, []);
  const { col: cFrom, row: rFrom } = squareToRC(move.from, flipped);
  const { col: cTo, row: rTo } = squareToRC(move.to, flipped);
  const dxPct = (cFrom - cTo) * 100;
  const dyPct = (rFrom - rTo) * 100;
  const style = {
    position: "absolute",
    left: `${cTo * 12.5}%`,
    top: `${rTo * 12.5}%`,
    width: "12.5%",
    height: "12.5%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: 10,
    transform: progress === 0 ? `translate(${dxPct}%, ${dyPct}%)` : "translate(0, 0)",
    transition: progress === 0 ? "none" : "transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1)",
  };
  return (
    <div style={style}>
      <span
        style={{
          fontSize: "clamp(22px, 9vw, 56px)",
          color: move.piece.color === "w" ? THEME.wPiece : THEME.bPiece,
          textShadow: move.piece.color === "w"
            ? "0 1.5px 0 rgba(0,0,0,0.75), 0 0 3px rgba(0,0,0,0.55)"
            : "0 1px 0 rgba(255,255,255,0.25)",
          lineHeight: 1,
          filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
        }}
      >
        {PIECES[move.piece.color + move.piece.type.toUpperCase()]}
      </span>
    </div>
  );
}
