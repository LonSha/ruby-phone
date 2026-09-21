/**
 * 对弈数据层
 * 引擎移植自瑟瑟小手机游戏扩展 V0.1.0 / V0.2.0：五子棋 / 象棋 / 斗兽棋 / 国际象棋 / 日本将棋
 * 纯本地规则 + 走法搜索，不绑神数据库 / ubp-root
 *
 * 颜色约定（userFirst=true 时玩家持大写色）：
 *   gomoku  数字 1/2（1=黑先）
 *   xiangqi/jungle  'R'/'B'（R 红先）
 *   chess     'W'/'B'（W 白=大写，下方；B 黑=小写，上方）
 *   shogi     'S'/'G'（S 先手=大写，下方；G 后手=小写，上方）
 */

import { GomokuEngine } from './gomoku-engine.js';
import { XiangqiEngine } from './xiangqi-engine.js';
import { JungleEngine } from './jungle-engine.js';
import { ChessEngine } from './chess-engine.js';
import { ShogiEngine } from './shogi-engine.js';

const STORAGE_KEY = 'games_board_state';

export const BOARD_GAMES = Object.freeze([
  { id: 'gomoku', title: '五子棋', desc: '15×15 · 先连五子者胜', first: '黑' },
  { id: 'xiangqi', title: '中国象棋', desc: '红先 · 本机对弈', first: '红' },
  { id: 'jungle', title: '斗兽棋', desc: '兽阶吃子 · 入穴获胜', first: '红' },
  { id: 'chess', title: '国际象棋', desc: '8×8 · 吃王即胜 · 三次重复判和', first: '白' },
  { id: 'shogi', title: '日本将棋', desc: '9×9 · 可打落子 · 千日手判和', first: '先手' },
]);

function cloneBoard(board) {
  if (!board) return board;
  if (Array.isArray(board[0])) return board.map((row) => row.slice());
  return board.slice();
}

function createEngine(type) {
  if (type === 'xiangqi') return new XiangqiEngine();
  if (type === 'jungle') return new JungleEngine();
  if (type === 'chess') return new ChessEngine();
  if (type === 'shogi') return new ShogiEngine();
  return new GomokuEngine(15);
}

// 按类型克隆快照：chess 需保留易位权/吃过路兵格，shogi 需保留手牌；positionCount 供判和累计。
function snapshotEngine(engine, type) {
  const snap = {
    type,
    board: cloneBoard(engine.board),
    turn: engine.turn,
    history: Array.isArray(engine.history) ? engine.history.map((item) => ({ ...item })) : [],
    winner: engine.winner,
  };
  if (type === 'chess') {
    snap.castling = engine.castling ? { ...engine.castling } : null;
    snap.enPassantTarget = engine.enPassantTarget ? [...engine.enPassantTarget] : null;
  }
  if (type === 'shogi') {
    snap.hand = engine.hand ? { S: { ...engine.hand.S }, G: { ...engine.hand.G } } : null;
  }
  if (engine.positionCount instanceof Map) {
    snap.positionCount = Array.from(engine.positionCount.entries());
  }
  return snap;
}

function restoreEngine(snap) {
  const type = snap?.type || 'gomoku';
  const engine = createEngine(type);
  if (snap?.board) engine.board = cloneBoard(snap.board);
  if (snap?.turn !== undefined) engine.turn = snap.turn;
  if (Array.isArray(snap?.history)) engine.history = snap.history.map((item) => ({ ...item }));
  if (snap?.winner !== undefined) engine.winner = snap.winner;
  if (type === 'chess') {
    if (snap?.castling) engine.castling = { ...snap.castling };
    if (snap?.enPassantTarget) engine.enPassantTarget = [...snap.enPassantTarget];
  }
  if (type === 'shogi' && snap?.hand) {
    engine.hand.S = { ...snap.hand.S };
    engine.hand.G = { ...snap.hand.G };
  }
  if (Array.isArray(snap?.positionCount)) {
    engine.positionCount = new Map(snap.positionCount);
  }
  return engine;
}

function userColorOf(state) {
  switch (state.type) {
    case 'gomoku': return state.userFirst ? 1 : 2;
    case 'chess': return state.userFirst ? 'W' : 'B';
    case 'shogi': return state.userFirst ? 'S' : 'G';
    default: return state.userFirst ? 'R' : 'B';
  }
}

function emptyState() {
  return {
    screen: 'picker',
    type: null,
    vsAi: true,
    userFirst: true,
    thinking: false,
    engineSnap: null,
    updatedAt: Date.now(),
  };
}

export class BoardData {
  constructor(storage) {
    this.storage = storage;
    this.state = this._load();
    this.engine = this.state.engineSnap ? restoreEngine(this.state.engineSnap) : null;
  }

  _load() {
    try {
      const raw = this.storage?.get?.(STORAGE_KEY);
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || typeof data !== 'object') return emptyState();
      return { ...emptyState(), ...data };
    } catch (e) {
      return emptyState();
    }
  }

  _persist() {
    this.state.updatedAt = Date.now();
    if (this.engine) this.state.engineSnap = snapshotEngine(this.engine, this.state.type);
    else this.state.engineSnap = null;
    try { this.storage?.set?.(STORAGE_KEY, this.state); } catch (e) {}
  }

  getState() {
    return this.state;
  }

  getEngine() {
    return this.engine;
  }

  meta() {
    return BOARD_GAMES.find((item) => item.id === this.state.type) || BOARD_GAMES[0];
  }

  openPicker() {
    this.state.screen = 'picker';
    this._persist();
    return this.state;
  }

  newGame(type, { vsAi = true, userFirst = true } = {}) {
    const id = BOARD_GAMES.some((item) => item.id === type) ? type : 'gomoku';
    this.state = {
      screen: 'play',
      type: id,
      vsAi: !!vsAi,
      userFirst: userFirst !== false,
      thinking: false,
      engineSnap: null,
      updatedAt: Date.now(),
    };
    this.engine = createEngine(id);
    this._persist();
    if (this.state.vsAi && !this.state.userFirst) this.playAi();
    return this.state;
  }

  resume() {
    if (!this.engine || !this.state.type) return this.openPicker();
    this.state.screen = 'play';
    this.state.thinking = false;
    this._persist();
    return this.state;
  }

  userColor() {
    return userColorOf(this.state);
  }

  isUserTurn() {
    if (!this.engine || this.winner()) return false;
    return this.engine.turn === this.userColor();
  }

  winner() {
    if (!this.engine) return null;
    const w = this.engine.winner;
    if (w === 0 || w == null) return null;
    return w;
  }

  // 将棋手牌（玩家侧）：color + 各棋子计数；非将棋返回 null
  shogiHand() {
    if (!this.engine || this.state.type !== 'shogi') return null;
    const color = this.userColor();
    return { color, counts: { ...this.engine.hand[color] } };
  }

  // 将棋某手牌棋子可落格
  legalDrops(pieceKey) {
    if (!this.engine || this.state.type !== 'shogi') return [];
    const color = this.userColor();
    return this.engine.getLegalDrops(color, pieceKey).map((m) => ({ r: m.toR, c: m.toC }));
  }

  playUser(payload) {
    if (!this.engine || this.state.thinking || !this.isUserTurn() || this.winner()) return { ok: false };
    const ok = this._applyMove(payload, true);
    if (!ok) return { ok: false };
    this._persist();
    return { ok: true, winner: this.winner() };
  }

  playAi() {
    if (!this.engine || !this.state.vsAi || this.winner()) return null;
    if (this.isUserTurn()) return null;
    const type = this.state.type;
    const color = this.engine.turn;
    let move;
    if (type === 'gomoku') {
      const aiPlayer = this.state.userFirst ? 2 : 1;
      move = this.engine.getBestMove(aiPlayer, false);
      if (!move) return null;
      this.engine.makeMove(move.r, move.c, aiPlayer);
    } else if (type === 'chess') {
      move = this.engine.getBestMove(color, false);
      if (!move) return null;
      this.engine.makeMove(move.fromR, move.fromC, move.toR, move.toC, move.promo || 'Q');
    } else if (type === 'shogi') {
      move = this.engine.getBestMove(color, false);
      if (!move) return null;
      if (move.isDrop) this.engine.makeDrop(move.piece.toUpperCase(), move.toR, move.toC);
      else this.engine.makeMove(move.fromR, move.fromC, move.toR, move.toC, move.promote);
    } else {
      move = this.engine.getBestMove(color, false);
      if (!move) return null;
      this.engine.makeMove(move.fromR, move.fromC, move.toR, move.toC);
    }
    this.state.thinking = false;
    this._persist();
    return move;
  }

  _applyMove(payload, isUser) {
    const type = this.state.type;
    if (type === 'gomoku') {
      const player = this.engine.turn;
      return this.engine.makeMove(payload.r, payload.c, player);
    }
    if (type === 'shogi' && payload.drop) {
      return this.engine.makeDrop(payload.pieceKey, payload.toR, payload.toC);
    }
    if (payload.fromR == null) {
      return false;
    }
    if (type === 'chess') {
      return this.engine.makeMove(payload.fromR, payload.fromC, payload.toR, payload.toC, payload.promo);
    }
    if (type === 'shogi') {
      return this.engine.makeMove(payload.fromR, payload.fromC, payload.toR, payload.toC, payload.promote);
    }
    return this.engine.makeMove(payload.fromR, payload.fromC, payload.toR, payload.toC);
  }

  undo() {
    if (!this.engine) return this.state;
    this.engine.undo();
    if (this.state.vsAi && this.engine.history.length) this.engine.undo();
    this.state.thinking = false;
    this._persist();
    return this.state;
  }

  legalTargets(fromR, fromC) {
    if (!this.engine || this.state.type === 'gomoku') return [];
    const moves = this.engine.getLegalMoves(fromR, fromC) || [];
    const seen = new Set();
    const out = [];
    for (const m of moves) {
      const r = Array.isArray(m) ? m[0] : m.toR;
      const c = Array.isArray(m) ? m[1] : m.toC;
      const key = r * 100 + c;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ r, c });
    }
    return out;
  }
}

export default BoardData;