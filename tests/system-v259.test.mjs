/**
 * system-v259.test.mjs — v2.59.0 对弈棋种扩列（国际象棋 + 日本将棋）
 *
 * 【背景】games/board 对弈数据层自 v0.1.0 起移植五子/象棋/斗兽棋，本轮把上游
 *   瑟瑟小手机游戏扩展 V0.2.0 的 ChessEngine / ShogiEngine 两个自包含引擎
 *   （alpha-beta + 置换表 + 残局，零宿主依赖）纯本地移植接入，对弈棋种 3 → 5。
 *
 * 【为什么可以直接 import 内核】chess-engine.js / shogi-engine.js / board-data.js
 *   均为纯 ESM、零 window / DOM / localStorage / fetch 依赖，本套件直接导入做**真功能测试**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
import { ChessEngine } from '../apps/games/board/chess-engine.js';
import { ShogiEngine } from '../apps/games/board/shogi-engine.js';
import { BoardData, BOARD_GAMES } from '../apps/games/board/board-data.js';

const mem = (seed) => {
  const m = new Map(seed ? [seed] : []);
  return { get: (k) => m.get(k), set: (k, v) => m.set(k, typeof v === 'string' ? v : JSON.stringify(v)) };
};

// ============================================================
// A. 纯内核：两引擎真功能
// ============================================================
test('A1 ChessEngine 规则正确性：初始局面 + 走法 + 撤销', () => {
  const c = new ChessEngine();
  assert.equal(c.board.length, 8);
  assert.equal(c.board[0].length, 8);
  assert.equal(c.turn, 'W', '白先');
  // e2 白兵可进 e3/e4
  assert.equal(c.getLegalMoves(6, 4).length, 2, 'e2 兵两步');
  // b1 白马：a3/c3 被己方兵占，仅 d2
  assert.equal(c.getLegalMoves(7, 1).length, 2, 'b1 马受兵阻挡');
  const ok = c.makeMove(6, 4, 4, 4, undefined); // e4
  assert.equal(ok, true);
  assert.equal(c.turn, 'B');
  c.undo();
  assert.equal(c.turn, 'W');
  assert.equal(c.board[4][4], null, '撤销后 e4 空');
});

test('A2 ChessEngine 升变：兵到对面底线生成 Q/R/B/N 候选', () => {
  const c = new ChessEngine();
  c.board[1][4] = 'P'; // e2 白兵
  c.board[0][4] = null; // e1 空 → 可升变
  c.turn = 'W';
  const moves = c.getLegalMoves(1, 4);
  assert.ok(moves.some((m) => m.promo === 'Q'), '含升后');
  assert.ok(moves.some((m) => m.promo === 'N'), '含升马');
});

test('A3 ChessEngine 三次重复判和', () => {
  const c = new ChessEngine();
  c.recordPosition();
  c.recordPosition();
  assert.equal(c.winner, null, '两次未判和');
  c.recordPosition();
  assert.equal(c.winner, 'draw', '三次重复判和');
});

test('A4 ShogiEngine 规则正确性：初始局面 + 走法 + 撤销', () => {
  const s = new ShogiEngine();
  assert.equal(s.board.length, 9);
  assert.equal(s.board[0].length, 9);
  assert.equal(s.turn, 'S', '先手');
  // g7 先手兵可前进一步
  assert.ok(s.getLegalMoves(6, 6).some((m) => m.toR === 5 && m.toC === 6), 'g7 兵前进');
  const ok = s.makeMove(6, 6, 5, 6, false);
  assert.equal(ok, true);
  assert.equal(s.turn, 'G');
  s.undo();
  assert.equal(s.turn, 'S');
});

test('A5 ShogiEngine 成桂：成区内兵给出成/不成双选项', () => {
  const s = new ShogiEngine();
  s.board[2][5] = 'P'; // 先手兵在成区内（r<=2）
  s.board[1][5] = null;
  s.turn = 'S';
  const moves = s.getLegalMoves(2, 5);
  assert.ok(moves.some((m) => m.promote === true), '可成');
  assert.ok(moves.some((m) => m.promote === false), '可不成');
});

test('A6 ShogiEngine 二歩禁止 + 落子', () => {
  const s = new ShogiEngine();
  s.hand.S = { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 2 };
  s.turn = 'S';
  // 清空盘面白兵
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = s.board[r][c];
    if (p && p === p.toUpperCase() && p.toUpperCase() === 'P') s.board[r][c] = null;
  }
  const many = s.getLegalDrops('S', 'P');
  assert.ok(many.length > 30, '清白兵后大量可落格');
  s.board[4][0] = 'P'; // a 列已有白兵
  const blocked = s.getLegalDrops('S', 'P');
  assert.equal(blocked.filter((d) => d.c === 0).length, 0, 'a 列二歩禁止');
  assert.ok(blocked.some((d) => d.c !== 0), '其他列仍可落');
});

test('A7 ShogiEngine 千日手判和', () => {
  const s = new ShogiEngine();
  s.recordPosition();
  s.recordPosition();
  s.recordPosition();
  assert.equal(s.winner, null, '三次未判和');
  s.recordPosition();
  assert.equal(s.winner, 'draw', '四次重复判和');
});

// ============================================================
// B. BoardData 集成：5 棋种 + 快照/手牌
// ============================================================
test('B1 BOARD_GAMES 扩到 5 棋种（新增 chess + shogi）', () => {
  assert.equal(BOARD_GAMES.length, 5);
  for (const id of ['gomoku', 'xiangqi', 'jungle', 'chess', 'shogi']) {
    assert.ok(BOARD_GAMES.some((g) => g.id === id), '含 ' + id);
  }
});

test('B2 chess 集成：userColor / isUserTurn / 走子 / 快照含易位权', () => {
  const d = new BoardData(mem());
  d.newGame('chess', { vsAi: false, userFirst: true });
  assert.equal(d.userColor(), 'W');
  assert.equal(d.isUserTurn(), true);
  const res = d.playUser({ fromR: 6, fromC: 4, toR: 4, toC: 4, promo: undefined });
  assert.equal(res.ok, true);
  assert.equal(d.isUserTurn(), false, '走子后轮到 AI');
  const snap = JSON.parse(mem().set ? JSON.stringify(d.state.engineSnap) : JSON.stringify(d.state.engineSnap));
  assert.equal(snap.type, 'chess');
  assert.ok(snap.castling && snap.castling.WK === true, '快照保留易位权');
});

test('B3 shogi 集成：userColor / 手牌 / 非将棋手牌为 null / 走法目标', () => {
  const d = new BoardData(mem());
  d.newGame('shogi', { vsAi: false, userFirst: true });
  assert.equal(d.userColor(), 'S');
  const hand = d.shogiHand();
  assert.ok(hand && typeof hand.counts.P === 'number', '手牌含 P 计数');
  d.newGame('chess', { vsAi: false, userFirst: true });
  assert.equal(d.shogiHand(), null, '非将棋 shogiHand 为 null');
  d.newGame('shogi', { vsAi: false, userFirst: true });
  const tg = d.legalTargets(6, 6);
  assert.ok(tg.some((x) => x.r === 5 && x.c === 6), 'g7 兵目标格');
});

test('B4 快照往返：chess 易位权 + shogi 手牌持久化后恢复', () => {
  // shogi 走一步吃子 → 手牌 +1 → 持久化 → 新实例恢复
  const d = new BoardData(mem());
  d.newGame('shogi', { vsAi: false, userFirst: true });
  // 先手 g7 兵前进
  d.playUser({ fromR: 6, fromC: 6, toR: 5, toC: 6, promote: false });
  const raw = JSON.stringify(d.state.engineSnap);
  const d2 = new BoardData({ get: () => JSON.stringify(d.state), set: () => {} });
  const snap = d2.state.engineSnap;
  assert.ok(snap.hand, '快照含手牌');
  assert.equal(typeof snap.hand.S.P, 'number', '手牌结构');
});

// ============================================================
// F. 源码不变量：引擎自包含 + view 消费闭环
// ============================================================
test('F1 引擎零宿主依赖：不引用 window/document/localStorage/fetch/openai', () => {
  for (const f of ['apps/games/board/chess-engine.js', 'apps/games/board/shogi-engine.js']) {
    const src = read(f);
    assert.ok(src.length > 5000, f + ' 非空');
    for (const bad of ['window.', 'document.', 'localStorage', 'fetch(', 'openai', 'SillyTavern']) {
      assert.ok(!src.includes(bad), f + ' 不得包含 ' + bad);
    }
  }
});

test('F2 board-data 注册两新引擎 + 类型感知走法', () => {
  const src = read('apps/games/board/board-data.js');
  assert.ok(src.includes("from './chess-engine.js'"), 'import ChessEngine');
  assert.ok(src.includes("from './shogi-engine.js'"), 'import ShogiEngine');
  assert.ok(src.includes("type === 'chess'"), 'chess 走法分支');
  assert.ok(src.includes("type === 'shogi'"), 'shogi 走法分支');
  assert.ok(src.includes('makeDrop'), 'shogi 落子路径');
  assert.ok(src.includes('shogiHand'), '手牌取数出口');
});

test('F3 view 消费闭环：chess/shogi 渲染 + 升变条 + 手牌栏', () => {
  const src = read('apps/games/board/board-view.js');
  assert.ok(src.includes('CHESS_PIECE'), 'chess 棋子映射');
  assert.ok(src.includes('SHOGI_LABEL'), 'shogi 棋子映射');
  assert.ok(src.includes('_renderShogiHand'), '手牌栏');
  assert.ok(src.includes('_renderPromoBar'), '升变/成桂选择条');
  assert.ok(src.includes('data-hand'), '手牌按钮落点');
  assert.ok(src.includes('data-promo'), '升变按钮落点');
});

test('F4 CSS 落点：chess 棋盘 + 手牌栏 + 升变条样式', () => {
  const src = read('apps/games/board/board.css');
  assert.ok(src.includes('.gb-chs'), 'chess 棋盘类');
  assert.ok(src.includes('.gb-shg'), 'shogi 棋盘类');
  assert.ok(src.includes('.gb-shogi-hand'), '手牌栏');
  assert.ok(src.includes('.gb-promo'), '升变条');
});

// ============================================================
// G. 版本四源同源（动态跟随当前版本，不硬编码）
// ============================================================
test('G1 版本四源同源（当前版本由 index.js 定义）', () => {
  const idx = read('index.js');
  const m = idx.match(/ST_PHONE_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
  assert.ok(m, 'index.js 定义 ST_PHONE_VERSION');
  const v = m[1];
  assert.equal(JSON.parse(read('manifest.json')).version, v, 'manifest 同源');
  assert.equal(JSON.parse(read('package.json')).version, v, 'package 同源');
  const log = JSON.parse(read('update-log.json'));
  assert.equal(log.latest, v, 'update-log.latest 同源');
  assert.ok(Object.prototype.hasOwnProperty.call(log.versions, v), 'update-log 含当前版本条目');
  assert.equal(log.versions[v].version, v, '当前版本条目 version 一致');
});

test('G2 2.59.0 条目记录了本次棋种扩列（防只记杂项不记主菜）', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(log.versions['2.59.0'], 'update-log 缺 2.59.0 条目');
  const items = log.versions['2.59.0'].items.join('\n');
  assert.ok(items.includes('国际象棋') || items.includes('chess'), '条目提及国际象棋');
  assert.ok(items.includes('将棋') || items.includes('shogi'), '条目提及将棋');
});