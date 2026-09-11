/**
 * 对弈数据层
 * 引擎移植自瑟瑟小手机游戏扩展 V0.1.0：五子棋 / 象棋 / 斗兽棋
 * 纯本地规则 + 走法搜索，不绑神数据库 / ubp-root
 */

import { GomokuEngine } from './gomoku-engine.js';
import { XiangqiEngine } from './xiangqi-engine.js';
import { JungleEngine } from './jungle-engine.js';

const STORAGE_KEY = 'games_board_state';

export const BOARD_GAMES = Object.freeze([
  { id: 'gomoku', title: '五子棋', desc: '15×15 · 先连五子者胜', first: '黑' },
  { id: 'xiangqi', title: '中国象棋', desc: '红先 · 本机对弈', first: '红' },
  { id: 'jungle', title: '斗兽棋', desc: '兽阶吃子 · 入穴获胜', first: '红' },
]);

function cloneBoard(board) {
  if (!board) return board;
  if (Array.isArray(board[0])) return board.map((row) => row.slice());
  return board.slice();
}

function createEngine(type) {
  if (type === 'xiangqi') return new XiangqiEngine();
  if (type === 'jungle') return new JungleEngine();
  return new GomokuEngine(15);
}

function snapshotEngine(engine, type) {
  return {
    type,
    board: cloneBoard(engine.board),
    turn: engine.turn,
    history: Array.isArray(engine.history) ? engine.history.map((item) => ({ ...item })) : [],
    winner: engine.winner,
  };
}

function restoreEngine(snap) {
  const type = snap?.type || 'gomoku';
  const engine = createEngine(type);
  if (snap?.board) engine.board = cloneBoard(snap.board);
  if (snap?.turn !== undefined) engine.turn = snap.turn;
  if (Array.isArray(snap?.history)) engine.history = snap.history.map((item) => ({ ...item }));
  if (snap?.winner !== undefined) engine.winner = snap.winner;
  return engine;
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

  isUserTurn() {
    if (!this.engine || this.winner()) return false;
    const turn = this.engine.turn;
    if (this.state.type === 'gomoku') {
      const userPlayer = this.state.userFirst ? 1 : 2;
      return turn === userPlayer;
    }
    const userColor = this.state.userFirst ? 'R' : 'B';
    return turn === userColor;
  }

  winner() {
    if (!this.engine) return null;
    const w = this.engine.winner;
    if (w === 0 || w == null) return null;
    return w;
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
    let move;
    if (type === 'gomoku') {
      const aiPlayer = this.state.userFirst ? 2 : 1;
      move = this.engine.getBestMove(aiPlayer, false);
      if (!move) return null;
      this.engine.makeMove(move.r, move.c, aiPlayer);
    } else {
      const color = this.engine.turn;
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
    if (payload.fromR == null) {
      return false;
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
    return moves.map((m) => Array.isArray(m) ? { r: m[0], c: m[1] } : { r: m.toR, c: m.toC });
  }
}

export default BoardData;
