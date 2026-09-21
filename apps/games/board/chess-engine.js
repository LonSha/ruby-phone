/**
 * 国际象棋引擎（移植自瑟瑟小手机游戏扩展 V0.2.0）
 * 纯本地规则 + alpha-beta 走法搜索：置换表 / 残局搜索 / 将军检测 / 王车易位 / 吃过路兵 / 升变 / 三次重复判和。
 * 零宿主依赖：纯 JS 类，不引用任何浏览器对象 / 存储 / 网络 API。
 * 引擎自包含：board 为 8x8，turn 为 W/B（大写白=用户下方，小写黑=电脑上方），winner 为 W/B/draw。
 */
export class ChessEngine {
    constructor() {
      this.init();
    }
    init() {
      this.board = Array(8).fill(null).map(() => Array(8).fill(null));
      this.history = [];
      this.turn = 'W'; // 'W'=白(用户, 下方), 'B'=黑(电脑, 上方)
      this.winner = null; // null | 'W' | 'B' | 'draw'
      this.tt = new Map();
      this.killerMoves = Array(16).fill(null).map(() => []);
      this.castling = { WK: true, WQ: true, BK: true, BQ: true };
      this.enPassantTarget = null; // [r,c] 可吃过路兵的目标格
      this.inSearch = false;
      this.positionCount = new Map();
      const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
      for (let c = 0; c < 8; c++) {
        this.board[0][c] = back[c].toLowerCase();
        this.board[1][c] = 'p';
        this.board[6][c] = 'P';
        this.board[7][c] = back[c];
      }
    }
    isWhite(p) { return !!p && p === p.toUpperCase(); }
    isBlack(p) { return !!p && p === p.toLowerCase(); }
    sameColor(p, color) { return !!p && (color === 'W' ? this.isWhite(p) : this.isBlack(p)); }
    enemyColor(color) { return color === 'W' ? 'B' : 'W'; }
    findKing(color) {
      const k = color === 'W' ? 'K' : 'k';
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (this.board[r][c] === k) return [r, c];
      return null;
    }
    getRawMoves(r, c, p, color) {
      const moves = [];
      const addIf = (tr, tc) => {
        if (tr < 0 || tr >= 8 || tc < 0 || tc >= 8) return false;
        const t = this.board[tr][tc];
        if (this.sameColor(t, color)) return false;
        moves.push([tr, tc]);
        return !t;
      };
      const type = p.toUpperCase();
      if (type === 'K') {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) addIf(r + dr, c + dc);
      } else if (type === 'Q') {
        for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) { let i = 1; while (addIf(r + dr * i, c + dc * i)) i++; }
      } else if (type === 'R') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) { let i = 1; while (addIf(r + dr * i, c + dc * i)) i++; }
      } else if (type === 'B') {
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { let i = 1; while (addIf(r + dr * i, c + dc * i)) i++; }
      } else if (type === 'N') {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) addIf(r + dr, c + dc);
      } else if (type === 'P') {
        const fwd = color === 'W' ? -1 : 1;
        const startRow = color === 'W' ? 6 : 1;
        const nr = r + fwd;
        if (nr >= 0 && nr < 8) {
          if (!this.board[nr][c]) {
            moves.push([nr, c]);
            const nr2 = r + 2 * fwd;
            if (r === startRow && nr2 >= 0 && nr2 < 8 && !this.board[nr2][c]) moves.push([nr2, c]);
          }
          for (const dc of [-1, 1]) {
            const nc = c + dc;
            if (nc >= 0 && nc < 8) {
              const t = this.board[nr][nc];
              if (t && !this.sameColor(t, color)) moves.push([nr, nc]);
              if (this.enPassantTarget && this.enPassantTarget[0] === nr && this.enPassantTarget[1] === nc && this.board[r][nc] && !this.sameColor(this.board[r][nc], color) && this.board[r][nc].toUpperCase() === 'P') {
                moves.push([nr, nc]);
              }
            }
          }
        }
      }
      return moves;
    }
    isSquareAttacked(r, c, byColor) {
      for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
        const p = this.board[rr][cc];
        if (!p || !this.sameColor(p, byColor)) continue;
        for (const [tr, tc] of this.getRawMoves(rr, cc, p, byColor)) if (tr === r && tc === c) return true;
      }
      return false;
    }
    isInCheck(color) {
      const king = this.findKing(color);
      if (!king) return false;
      return this.isSquareAttacked(king[0], king[1], this.enemyColor(color));
    }
    _applyMove(m) {
      const saved = { enPassant: this.enPassantTarget, castling: { WK: this.castling.WK, WQ: this.castling.WQ, BK: this.castling.BK, BQ: this.castling.BQ } };
      this.board[m.fromR][m.fromC] = null;
      if (m.special === 'castle') {
        const hr = m.toR;
        if (m.toC === 6) { this.board[hr][6] = m.piece; this.board[hr][5] = this.board[hr][7]; this.board[hr][7] = null; }
        else { this.board[hr][2] = m.piece; this.board[hr][3] = this.board[hr][0]; this.board[hr][0] = null; }
      } else if (m.special === 'enpassant') {
        this.board[m.toR][m.toC] = m.piece;
        this.board[m.fromR][m.toC] = null;
      } else {
        this.board[m.toR][m.toC] = m.promo || m.piece;
      }
      if (m.piece.toUpperCase() === 'P' && Math.abs(m.toR - m.fromR) === 2) {
        this.enPassantTarget = [(m.fromR + m.toR) / 2, m.fromC];
      } else {
        this.enPassantTarget = null;
      }
      const p = m.piece, col = this.isWhite(p) ? 'W' : 'B';
      if (p.toUpperCase() === 'K') {
        if (col === 'W') { this.castling.WK = false; this.castling.WQ = false; }
        else { this.castling.BK = false; this.castling.BQ = false; }
      }
      if (p.toUpperCase() === 'R') {
        if (col === 'W') { if (m.fromR === 7 && m.fromC === 0) this.castling.WQ = false; if (m.fromR === 7 && m.fromC === 7) this.castling.WK = false; }
        else { if (m.fromR === 0 && m.fromC === 0) this.castling.BQ = false; if (m.fromR === 0 && m.fromC === 7) this.castling.BK = false; }
      }
      if (m.captured && m.captured.toUpperCase() === 'R') {
        if (m.toR === 7 && m.toC === 0) this.castling.WQ = false;
        if (m.toR === 7 && m.toC === 7) this.castling.WK = false;
        if (m.toR === 0 && m.toC === 0) this.castling.BQ = false;
        if (m.toR === 0 && m.toC === 7) this.castling.BK = false;
      }
      return saved;
    }
    _undoMove(m, saved) {
      this.board[m.fromR][m.fromC] = m.piece;
      this.board[m.toR][m.toC] = null;
      if (m.special === 'castle') {
        const hr = m.toR;
        if (m.toC === 6) { this.board[hr][7] = m.rook; this.board[hr][5] = null; }
        else { this.board[hr][0] = m.rook; this.board[hr][3] = null; }
      } else if (m.special === 'enpassant') {
        this.board[m.toR][m.toC] = null;
        this.board[m.fromR][m.toC] = m.captured;
      } else {
        this.board[m.toR][m.toC] = m.captured;
      }
      this.enPassantTarget = saved.enPassant;
      this.castling = { WK: saved.castling.WK, WQ: saved.castling.WQ, BK: saved.castling.BK, BQ: saved.castling.BQ };
    }
    isKingSafeAfter(m) {
      const saved = this._applyMove(m);
      const color = this.isWhite(m.piece) ? 'W' : 'B';
      const safe = !this.isInCheck(color);
      this._undoMove(m, saved);
      return safe;
    }
    getLegalMoves(r, c) {
      const p = this.board[r][c];
      if (!p) return [];
      const color = this.isWhite(p) ? 'W' : 'B';
      const enemy = this.enemyColor(color);
      const result = [];
      for (const [tr, tc] of this.getRawMoves(r, c, p, color)) {
        const m = { fromR: r, fromC: c, toR: tr, toC: tc, piece: p, captured: this.board[tr][tc], promo: null, special: null, rook: null };
        if (p.toUpperCase() === 'P' && this.enPassantTarget && tr === this.enPassantTarget[0] && tc === this.enPassantTarget[1] && !this.board[tr][tc]) {
          m.special = 'enpassant';
          m.captured = this.board[r][tc];
        }
        if (p.toUpperCase() === 'P' && (tr === 0 || tr === 7)) {
          for (const promo of ['Q', 'R', 'B', 'N']) {
            const mm = { ...m, promo, rook: null };
            if (this.isKingSafeAfter(mm)) result.push(mm);
          }
        } else {
          if (this.isKingSafeAfter(m)) result.push(m);
        }
      }
      if (p.toUpperCase() === 'K' && !this.isInCheck(color)) {
        const hr = color === 'W' ? 7 : 0;
        if (r === hr && c === 4) {
          const rook = color === 'W' ? 'R' : 'r';
          const rights = color === 'W' ? { K: this.castling.WK, Q: this.castling.WQ } : { K: this.castling.BK, Q: this.castling.BQ };
          if (rights.K && !this.board[hr][5] && !this.board[hr][6] && this.board[hr][7] === rook && !this.isSquareAttacked(hr, 5, enemy) && !this.isSquareAttacked(hr, 6, enemy)) {
            result.push({ fromR: hr, fromC: 4, toR: hr, toC: 6, piece: p, captured: null, promo: null, special: 'castle', rook });
          }
          if (rights.Q && !this.board[hr][1] && !this.board[hr][2] && !this.board[hr][3] && this.board[hr][0] === rook && !this.isSquareAttacked(hr, 3, enemy) && !this.isSquareAttacked(hr, 2, enemy)) {
            result.push({ fromR: hr, fromC: 4, toR: hr, toC: 2, piece: p, captured: null, promo: null, special: 'castle', rook });
          }
        }
      }
      return result;
    }
    getAllMoves(color) {
      const moves = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && this.sameColor(p, color)) {
          for (const m of this.getLegalMoves(r, c)) moves.push(m);
        }
      }
      return moves;
    }
    executeMove(m) {
      const saved = this._applyMove(m);
      m.saved = saved;
      this.history.push(m);
      if (!this.inSearch) this.recordPosition();
      this.turn = this.turn === 'W' ? 'B' : 'W';
      return true;
    }
    undo() {
      if (!this.history.length) return false;
      const m = this.history.pop();
      this._undoMove(m, m.saved);
      this.turn = this.isWhite(m.piece) ? 'W' : 'B';
      return true;
    }
    makeMove(fromR, fromC, toR, toC, promo) {
      const p = this.board[fromR][fromC];
      if (!p) return false;
      const color = this.isWhite(p) ? 'W' : 'B';
      if (color !== this.turn) return false;
      const legal = this.getLegalMoves(fromR, fromC);
      const m = legal.find(x => x.toR === toR && x.toC === toC && (promo === undefined || x.promo === promo));
      if (!m) return false;
      return this.executeMove(m);
    }
    orderMoves(moves, depth) {
      const values = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
      const killers = this.killerMoves[depth] || [];
      return moves.map(m => {
        let score = 0;
        if (m.captured) score += 10000 + (values[m.captured.toUpperCase()] || 50) * 10 - (values[m.piece.toUpperCase()] || 50);
        if (m.promo === 'Q') score += 800;
        else if (m.promo) score += 300;
        if (killers.some(k => k.fromR === m.fromR && k.fromC === m.fromC && k.toR === m.toR && k.toC === m.toC)) score += 500;
        return { ...m, orderScore: score };
      }).sort((a, b) => b.orderScore - a.orderScore);
    }
    getBoardHash() {
      let s = this.turn + '|' + (this.castling.WK ? 1 : 0) + (this.castling.WQ ? 1 : 0) + (this.castling.BK ? 1 : 0) + (this.castling.BQ ? 1 : 0) + (this.enPassantTarget ? this.enPassantTarget.join(',') : '-') + '|';
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
      return s;
    }
    evaluateBoard(color) {
      if (this.winner === color) return 100000;
      if (this.winner === 'draw') return 0;
      if (this.winner && this.winner !== color) return -100000;
      const pieceValues = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
      const oppColor = this.enemyColor(color);
      const pstP = [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0];
      const pstN = [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50];
      let score = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) continue;
        const type = p.toUpperCase();
        const isMy = this.sameColor(p, color);
        let val = pieceValues[type] || 0;
        if (type === 'P') {
          val += this.isWhite(p) ? pstP[r * 8 + c] : pstP[(7 - r) * 8 + c];
        } else if (type === 'N') {
          val += this.isWhite(p) ? pstN[r * 8 + c] : pstN[(7 - r) * 8 + c];
        } else if (type === 'K') {
          val = -20;
        }
        score += isMy ? val : -val;
      }
      if (this.isInCheck(color)) score -= 500;
      if (this.isInCheck(oppColor)) score += 500;
      return score;
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
        if (this.isInCheck(currentTurn)) return currentTurn === color ? -99990 : 99990;
        return 0; // 逼和
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
        const captures = this.getAllMoves(sideToMove).filter(m => m.captured);
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
        const captures = this.getAllMoves(sideToMove).filter(m => m.captured);
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
    getBestMove(color = 'B', soften = false, level = 'normal') {
      const rawMoves = this.getAllMoves(color);
      if (!rawMoves.length) return null;
      const prevInSearch = this.inSearch;
      this.inSearch = true;
      const startTime = Date.now();
      const maxTime = soften ? 500 : (level === 'fast' ? 450 : level === 'strong' ? 1500 : 900);
      const inCheck = this.isInCheck(color);
      const depth = (soften && !inCheck) ? 2 : (level === 'fast' ? 2 : level === 'strong' ? 4 : 3);
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
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
      return s;
    }
    recordPosition() {
      const h = this.getPositionHash();
      const cnt = (this.positionCount.get(h) || 0) + 1;
      this.positionCount.set(h, cnt);
      if (!this.inSearch && cnt >= 3) this.winner = 'draw'; // 三次重复局面
      return cnt;
    }
  }
