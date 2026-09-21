/**
 * 将棋引擎（移植自瑟瑟小手机游戏扩展 V0.2.0）
 * 纯本地规则 + alpha-beta 走法搜索：置换表 / 残局 / 打步詰 / 二歩禁止 / 千日手判和。
 * 含落子（drop）与成桂（promote）：hand 为双方手牌计数，getLegalDrops 给出可打子格，makeDrop 放子。
 * 零宿主依赖：纯 JS 类，不引用任何浏览器对象 / 存储 / 网络 API。
 * 引擎自包含：board 为 9x9，turn 为 S/G（大写先手=用户下方，小写后手=电脑上方），winner 为 S/G/draw。
 */
export class ShogiEngine {
    constructor() {
      this.init();
    }
    init() {
      this.board = Array(9).fill(null).map(() => Array(9).fill(null));
      this.history = [];
      this.turn = 'S'; // 'S'=先手(用户, 下方), 'G'=后手(电脑, 上方)
      this.winner = null; // null | 'S' | 'G' | 'draw'
      this.tt = new Map();
      this.killerMoves = Array(12).fill(null).map(() => []);
      this.inSearch = false;
      this.positionCount = new Map();
      this.hand = {
        S: { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
        G: { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 }
      };
      const goteBack = ['l', 'n', 's', 'g', 'k', 'g', 's', 'n', 'l'];
      const senteBack = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];
      for (let c = 0; c < 9; c++) {
        this.board[0][c] = goteBack[c];
        this.board[8][c] = senteBack[c];
      }
      for (let c = 0; c < 9; c++) {
        this.board[2][c] = 'p';
        this.board[6][c] = 'P';
      }
      this.board[1][1] = 'b'; this.board[1][7] = 'r';
      this.board[7][7] = 'R'; this.board[7][1] = 'B';
    }
    colorOf(p) { return p === p.toUpperCase() ? 'S' : 'G'; }
    enemyColor(color) { return color === 'S' ? 'G' : 'S'; }
    isUserPiece(p) { return !!p && p === p.toUpperCase(); }
    findKing(color) {
      const k = color === 'S' ? 'K' : 'k';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (this.board[r][c] === k) return [r, c];
      return null;
    }
    inZone(r, color) { return color === 'S' ? r <= 2 : r >= 6; }
    isPromoted(p) { return p ? ['D','H','M','E','Y','T'].indexOf(p.toUpperCase()) !== -1 : false; }
    canPromoteBasic(p) { return p ? ['R','B','S','N','L','P'].indexOf(p.toUpperCase()) !== -1 : false; }
    promoteTo(p) {
      const map = { R: 'D', B: 'H', S: 'M', N: 'E', L: 'Y', P: 'T' };
      const low = p === p.toLowerCase();
      const base = map[p.toUpperCase()] || p.toUpperCase();
      return low ? base.toLowerCase() : base;
    }
    unpromoteKey(p) {
      const map = { D: 'R', H: 'B', M: 'S', E: 'N', Y: 'L', T: 'P' };
      return map[p.toUpperCase()] || p.toUpperCase();
    }
    movesFor(r, c, p, color) {
      const f = color === 'S' ? -1 : 1;
      const type = p.toUpperCase();
      const moves = [];
      const addStep = (tr, tc) => {
        if (tr < 0 || tr >= 9 || tc < 0 || tc >= 9) return false;
        const t = this.board[tr][tc];
        if (t && this.colorOf(t) === color) return false;
        moves.push([tr, tc]);
        return !t;
      };
      if (type === 'K') {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) addStep(r + dr, c + dc);
      } else if (type === 'R') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) { let i = 1; while (addStep(r + dr * i, c + dc * i)) i++; }
      } else if (type === 'B') {
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { let i = 1; while (addStep(r + dr * i, c + dc * i)) i++; }
      } else if (type === 'D') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) { let i = 1; while (addStep(r + dr * i, c + dc * i)) i++; }
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) addStep(r + dr, c + dc);
      } else if (type === 'H') {
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { let i = 1; while (addStep(r + dr * i, c + dc * i)) i++; }
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) addStep(r + dr, c + dc);
      } else if (type === 'L') {
        let i = 1; while (addStep(r + f * i, c)) i++;
      } else if (type === 'N') {
        addStep(r + 2 * f, c - 1);
        addStep(r + 2 * f, c + 1);
      } else if (type === 'P') {
        addStep(r + f, c);
      } else if (type === 'S') {
        addStep(r + f, c); addStep(r + f, c - 1); addStep(r + f, c + 1); addStep(r - f, c - 1); addStep(r - f, c + 1);
      } else if (type === 'G' || type === 'M' || type === 'E' || type === 'Y' || type === 'T') {
        addStep(r + f, c); addStep(r + f, c - 1); addStep(r + f, c + 1); addStep(r, c - 1); addStep(r, c + 1); addStep(r - f, c);
      }
      return moves;
    }
    isInCheck(color) {
      const king = this.findKing(color);
      if (!king) return false;
      const enemy = this.enemyColor(color);
      const [kr, kc] = king;
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const p = this.board[r][c];
        if (!p || this.colorOf(p) !== enemy) continue;
        for (const [tr, tc] of this.movesFor(r, c, p, enemy)) if (tr === kr && tc === kc) return true;
      }
      return false;
    }
    _applyMove(m) {
      if (m.isDrop) {
        this.board[m.toR][m.toC] = m.piece;
        return;
      }
      this.board[m.fromR][m.fromC] = null;
      this.board[m.toR][m.toC] = m.promote ? this.promoteTo(m.piece) : m.piece;
    }
    _undoMove(m) {
      if (m.isDrop) {
        this.board[m.toR][m.toC] = null;
        return;
      }
      this.board[m.fromR][m.fromC] = m.piece;
      this.board[m.toR][m.toC] = m.captured;
    }
    isKingSafeAfter(m, color) {
      this._applyMove(m);
      const safe = !this.isInCheck(color);
      this._undoMove(m);
      return safe;
    }
    noDestination(m) {
      const t = m.piece.toUpperCase();
      const color = this.colorOf(m.piece);
      const lastRank = color === 'S' ? 0 : 8;
      const secondLast = color === 'S' ? 1 : 7;
      if (t === 'P' || t === 'L') return m.toR === lastRank;
      if (t === 'N') return m.toR === lastRank || m.toR === secondLast;
      return false;
    }
    getLegalMoves(r, c) {
      const p = this.board[r][c];
      if (!p) return [];
      const color = this.colorOf(p);
      const raw = this.movesFor(r, c, p, color);
      const moves = [];
      for (const [tr, tc] of raw) {
        const captured = this.board[tr][tc];
        const canPromoteThis = !this.isPromoted(p) && this.canPromoteBasic(p) && (this.inZone(r, color) || this.inZone(tr, color));
        const noPromote = { fromR: r, fromC: c, toR: tr, toC: tc, piece: p, captured, isDrop: false, promote: false };
        const promoteMove = { ...noPromote, promote: true };
        if (this.noDestination(noPromote)) {
          if (canPromoteThis && this.isKingSafeAfter(promoteMove, color)) moves.push(promoteMove);
        } else {
          if (this.isKingSafeAfter(noPromote, color)) moves.push(noPromote);
          if (canPromoteThis && this.isKingSafeAfter(promoteMove, color)) moves.push(promoteMove);
        }
      }
      return moves;
    }
    isPawnDropMate(m) {
      const color = this.colorOf(m.piece);
      const enemy = this.enemyColor(color);
      this._applyMove(m);
      let mate = false;
      if (this.isInCheck(enemy)) {
        const boardMoves = this.getAllBoardMoves(enemy);
        const dropMoves = this.getAllDropMoves(enemy, false);
        mate = (boardMoves.length + dropMoves.length) === 0;
      }
      this._undoMove(m);
      return mate;
    }
    getLegalDrops(color, pieceKey, skipUchifuzume = false) {
      const drops = [];
      if (!this.hand[color][pieceKey]) return drops;
      const enemyLastRank = color === 'S' ? 0 : 8;
      const enemySecondLast = color === 'S' ? 1 : 7;
      const low = color === 'G';
      const piece = low ? pieceKey.toLowerCase() : pieceKey;
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (this.board[r][c]) continue;
        if ((pieceKey === 'P' || pieceKey === 'L') && r === enemyLastRank) continue;
        if (pieceKey === 'N' && (r === enemyLastRank || r === enemySecondLast)) continue;
        if (pieceKey === 'P') {
          let hasPawn = false;
          for (let rr = 0; rr < 9; rr++) {
            const q = this.board[rr][c];
            if (q && this.colorOf(q) === color && q.toUpperCase() === 'P') { hasPawn = true; break; }
          }
          if (hasPawn) continue; // 二歩
        }
        const m = { fromR: -1, fromC: -1, toR: r, toC: c, piece, captured: null, isDrop: true, promote: false };
        if (!this.isKingSafeAfter(m, color)) continue;
        if (!skipUchifuzume && pieceKey === 'P' && this.isPawnDropMate(m)) continue; // 打歩詰
        drops.push(m);
      }
      return drops;
    }
    getAllBoardMoves(color) {
      const moves = [];
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const p = this.board[r][c];
        if (p && this.colorOf(p) === color) moves.push(...this.getLegalMoves(r, c));
      }
      return moves;
    }
    getAllDropMoves(color, enforceUchifuzume = true) {
      const keys = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
      const moves = [];
      for (const k of keys) moves.push(...this.getLegalDrops(color, k, !enforceUchifuzume));
      return moves;
    }
    getAllMoves(color) {
      return this.getAllBoardMoves(color).concat(this.getAllDropMoves(color, true));
    }
    executeMove(m) {
      if (m.isDrop) {
        const color = this.colorOf(m.piece);
        const key = m.piece.toUpperCase();
        this.hand[color][key] = (this.hand[color][key] || 0) - 1;
        this.board[m.toR][m.toC] = m.piece;
      } else {
        const p = this.board[m.fromR][m.fromC];
        const color = this.colorOf(p);
        const captured = this.board[m.toR][m.toC];
        this.board[m.fromR][m.fromC] = null;
        if (captured) {
          const capKey = this.unpromoteKey(captured);
          this.hand[color][capKey] = (this.hand[color][capKey] || 0) + 1;
        }
        this.board[m.toR][m.toC] = m.promote ? this.promoteTo(p) : p;
      }
      if (!this.inSearch) this.recordPosition();
      this.history.push(m);
      this.turn = this.turn === 'S' ? 'G' : 'S';
      return true;
    }
    undo() {
      const m = this.history.pop();
      if (!m) return false;
      if (m.isDrop) {
        this.board[m.toR][m.toC] = null;
        this.hand[this.colorOf(m.piece)][m.piece.toUpperCase()] += 1;
      } else {
        if (m.captured) {
          const capKey = this.unpromoteKey(m.captured);
          this.hand[this.colorOf(m.piece)][capKey] -= 1;
        }
        this.board[m.fromR][m.fromC] = m.piece;
        this.board[m.toR][m.toC] = m.captured;
      }
      this.turn = this.turn === 'S' ? 'G' : 'S';
      return true;
    }
    makeMove(fromR, fromC, toR, toC, promote) {
      const p = this.board[fromR][fromC];
      if (!p) return false;
      const color = this.colorOf(p);
      if (color !== this.turn) return false;
      const legal = this.getLegalMoves(fromR, fromC);
      const m = legal.find(x => x.toR === toR && x.toC === toC && (promote === undefined || x.promote === !!promote));
      if (!m) return false;
      return this.executeMove(m);
    }
    makeDrop(pieceKey, toR, toC) {
      const color = this.turn;
      if (!this.hand[color][pieceKey]) return false;
      const legal = this.getLegalDrops(color, pieceKey);
      const m = legal.find(x => x.toR === toR && x.toC === toC);
      if (!m) return false;
      return this.executeMove(m);
    }
    orderMoves(moves, depth) {
      const vals = { P: 100, L: 350, N: 400, S: 500, G: 600, B: 900, R: 1000, D: 1300, H: 1200, M: 600, E: 600, Y: 600, T: 600, K: 100000 };
      const killers = this.killerMoves[depth] || [];
      return moves.map(m => {
        let score = 0;
        if (m.captured) score += (vals[m.captured.toUpperCase()] || 50) * 10;
        if (m.promote) score += 400;
        if (m.isDrop) score += 200;
        if (killers.some(k => k.fromR === m.fromR && k.fromC === m.fromC && k.toR === m.toR && k.toC === m.toC && k.promote === m.promote && k.isDrop === m.isDrop)) score += 500;
        return { ...m, orderScore: score };
      }).sort((a, b) => b.orderScore - a.orderScore);
    }
    getBoardHash() {
      let s = this.turn + '|';
      for (const k of ['R', 'B', 'G', 'S', 'N', 'L', 'P']) s += this.hand.S[k] + ',' + this.hand.G[k] + ';';
      s += '|';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
      return s;
    }
    evaluateBoard(color) {
      if (this.winner === color) return 100000;
      if (this.winner === 'draw') return 0;
      if (this.winner && this.winner !== color) return -100000;
      const pieceValues = { P: 100, L: 350, N: 400, S: 500, G: 600, B: 900, R: 1000, D: 1300, H: 1200, M: 600, E: 600, Y: 600, T: 600, K: 100000 };
      const oppColor = this.enemyColor(color);
      let score = 0;
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const p = this.board[r][c];
        if (!p) continue;
        const val = pieceValues[p.toUpperCase()] || 60;
        const type = p.toUpperCase();
        let v = val;
        // 位置小加成：银/金/歩前压、飞角活跃
        if (color === 'S') {
          if (!this.isPromoted(p) && (type === 'P' || type === 'S' || type === 'N' || type === 'L')) v += Math.max(0, 6 - r) * 4;
          if (type === 'R' || type === 'B') v += (this.countMobility(r, c, p, color)) * 2;
        } else {
          if (!this.isPromoted(p) && (type === 'P' || type === 'S' || type === 'N' || type === 'L')) v += Math.max(0, r - 2) * 4;
          if (type === 'R' || type === 'B') v += (this.countMobility(r, c, p, color)) * 2;
        }
        score += this.colorOf(p) === color ? v : -v;
      }
      for (const k of ['R', 'B', 'G', 'S', 'N', 'L', 'P']) {
        const hv = pieceValues[k] || 60;
        score += this.hand[color][k] * hv;
        score -= this.hand[oppColor][k] * hv;
      }
      if (this.isInCheck(color)) score -= 400;
      if (this.isInCheck(oppColor)) score += 400;
      return score;
    }
    countMobility(r, c, p, color) {
      let n = 0;
      for (const [tr, tc] of this.movesFor(r, c, p, color)) {
        if (!this.board[tr][tc]) n++;
      }
      return n;
    }
    alphabeta(depth, alpha, beta, isMaximizing, color, startTime, maxTime) {
      if (startTime != null && maxTime != null && Date.now() - startTime > maxTime) return this.evaluateBoard(color);
      const hash = this.getBoardHash();
      const ttEntry = this.tt.get(hash);
      if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === 'exact') return ttEntry.score;
        if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
      }
      if (this.winner) return this.evaluateBoard(color);
      if (depth === 0) return this.quiescence(alpha, beta, color, startTime, maxTime);

      const currentTurn = isMaximizing ? color : this.enemyColor(color);
      const rawMoves = this.getAllMoves(currentTurn);
      if (!rawMoves.length) {
        // 将棋无逼和：无子可动直接判负
        return currentTurn === color ? -99990 : 99990;
      }
      const moves = this.orderMoves(rawMoves, depth);
      let bestMove = moves[0];

      if (isMaximizing) {
        let maxEval = -Infinity;
        for (const m of moves) {
          this.executeMove(m);
          const evalVal = this.alphabeta(depth - 1, alpha, beta, false, color, startTime, maxTime);
          this.undo();
          if (evalVal > maxEval) { maxEval = evalVal; bestMove = m; }
          alpha = Math.max(alpha, evalVal);
          if (beta <= alpha) {
            if (!this.killerMoves[depth]) this.killerMoves[depth] = [];
            this.killerMoves[depth].unshift(m);
            if (this.killerMoves[depth].length > 2) this.killerMoves[depth].pop();
            break;
          }
        }
        const flag = maxEval <= alpha ? 'upper' : maxEval >= beta ? 'lower' : 'exact';
        this.tt.set(hash, { depth, score: maxEval, move: bestMove, flag });
        return maxEval;
      } else {
        let minEval = Infinity;
        for (const m of moves) {
          this.executeMove(m);
          const evalVal = this.alphabeta(depth - 1, alpha, beta, true, color, startTime, maxTime);
          this.undo();
          if (evalVal < minEval) { minEval = evalVal; bestMove = m; }
          beta = Math.min(beta, evalVal);
          if (beta <= alpha) {
            if (!this.killerMoves[depth]) this.killerMoves[depth] = [];
            this.killerMoves[depth].unshift(m);
            if (this.killerMoves[depth].length > 2) this.killerMoves[depth].pop();
            break;
          }
        }
        const flag = minEval <= alpha ? 'upper' : minEval >= beta ? 'lower' : 'exact';
        this.tt.set(hash, { depth, score: minEval, move: bestMove, flag });
        return minEval;
      }
    }
    quiescence(alpha, beta, color, startTime, maxTime, qdepth = 6) {
      if (startTime != null && maxTime != null && Date.now() - startTime > maxTime) return this.evaluateBoard(color);
      if (qdepth <= 0) return this.evaluateBoard(color);
      const sideToMove = this.turn;
      const standPat = this.evaluateBoard(color);
      if (sideToMove === color) {
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
        const captures = this.getAllBoardMoves(sideToMove).filter(m => m.captured);
        if (!captures.length) return alpha;
        const ordered = this.orderMoves(captures, 0);
        for (const m of ordered) {
          this.executeMove(m);
          const score = this.quiescence(alpha, beta, color, startTime, maxTime, qdepth - 1);
          this.undo();
          if (score >= beta) return beta;
          if (score > alpha) alpha = score;
        }
        return alpha;
      } else {
        if (standPat <= alpha) return alpha;
        if (standPat < beta) beta = standPat;
        const captures = this.getAllBoardMoves(sideToMove).filter(m => m.captured);
        if (!captures.length) return beta;
        const ordered = this.orderMoves(captures, 0);
        for (const m of ordered) {
          this.executeMove(m);
          const score = this.quiescence(alpha, beta, color, startTime, maxTime, qdepth - 1);
          this.undo();
          if (score <= alpha) return alpha;
          if (score < beta) beta = score;
        }
        return beta;
      }
    }
    getBestMove(color = 'G', soften = false, level = 'normal') {
      const rawMoves = this.getAllMoves(color);
      if (!rawMoves.length) return null;
      const prevInSearch = this.inSearch;
      this.inSearch = true;
      const startTime = Date.now();
      const maxTime = soften ? 500 : (level === 'fast' ? 450 : level === 'strong' ? 1500 : 900);
      const inCheck = this.isInCheck(color);
      const depth = (soften && !inCheck) ? 1 : (level === 'fast' ? 1 : level === 'strong' ? 3 : 2);
      try {
        const moves = this.orderMoves(rawMoves, depth);
        const scoredMoves = [];
        for (const m of moves) {
          if (Date.now() - startTime > maxTime) break;
          this.executeMove(m);
          const score = this.alphabeta(depth - 1, -Infinity, Infinity, false, color, startTime, maxTime);
          this.undo();
          scoredMoves.push({ ...m, score });
        }
        scoredMoves.sort((a, b) => b.score - a.score);
        if (soften && !inCheck && scoredMoves.length > 2) {
          const pickIdx = Math.floor(Math.random() * Math.min(3, scoredMoves.length - 1)) + 1;
          return scoredMoves[pickIdx];
        }
        return scoredMoves[0];
      } finally {
        this.inSearch = prevInSearch;
      }
    }
    getPositionHash() {
      let s = this.turn + '|';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
      return s;
    }
    recordPosition() {
      const h = this.getPositionHash();
      const cnt = (this.positionCount.get(h) || 0) + 1;
      this.positionCount.set(h, cnt);
      if (!this.inSearch && cnt >= 4) this.winner = 'draw'; // 千日手
      return cnt;
    }
  }
