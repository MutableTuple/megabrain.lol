import { Chess } from "chess.js";

const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
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

function chooseBotMove(chess, depth) {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  const isWhite = chess.turn() === "w";
  moves.sort(() => Math.random() - 0.5);
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

self.onmessage = (e) => {
  const { id, fen, depth } = e.data;
  try {
    const chess = new Chess(fen);
    const move = chooseBotMove(chess, depth);
    self.postMessage({
      id,
      move: move ? { from: move.from, to: move.to, promotion: move.promotion || null, san: move.san } : null,
    });
  } catch (err) {
    self.postMessage({ id, move: null, error: String(err?.message || err) });
  }
};
