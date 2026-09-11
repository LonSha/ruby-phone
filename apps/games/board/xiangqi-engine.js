export class XiangqiEngine {
    constructor() {
      this.init();
    }
    init() {
      this.board = Array(10).fill(null).map(() => Array(9).fill(null));
      this.history = [];
      this.turn = 'R'; // 'R'=红(用户, 下方), 'B'=黑(电脑, 上方)
      this.winner = null;
      this.tt = new Map();
      this.killerMoves = Array(10).fill(null).map(() => []);
      const initial = [
        [0, 0, 'r'], [0, 1, 'n'], [0, 2, 'b'], [0, 3, 'a'], [0, 4, 'k'], [0, 5, 'a'], [0, 6, 'b'], [0, 7, 'n'], [0, 8, 'r'],
        [2, 1, 'c'], [2, 7, 'c'],
        [3, 0, 'p'], [3, 2, 'p'], [3, 4, 'p'], [3, 6, 'p'], [3, 8, 'p'],
        [9, 0, 'R'], [9, 1, 'N'], [9, 2, 'B'], [9, 3, 'A'], [9, 4, 'K'], [9, 5, 'A'], [9, 6, 'B'], [9, 7, 'N'], [9, 8, 'R'],
        [7, 1, 'C'], [7, 7, 'C'],
        [6, 0, 'P'], [6, 2, 'P'], [6, 4, 'P'], [6, 6, 'P'], [6, 8, 'P']
      ];
      for (const [r, c, p] of initial) this.board[r][c] = p;
    }
    isRed(p) { return p && p === p.toUpperCase(); }
    isBlack(p) { return p && p === p.toLowerCase(); }
    findKing(color) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (p && p.toUpperCase() === 'K' && ((color === 'R' && this.isRed(p)) || (color === 'B' && this.isBlack(p)))) {
            return [r, c];
          }
        }
      }
      return null;
    }
    isInCheck(color) {
      const king = this.findKing(color);
      if (!king) return false;
      const [kr, kc] = king;
      const oppColor = color === 'R' ? 'B' : 'R';
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (!p) continue;
          const isEnemy = oppColor === 'R' ? this.isRed(p) : this.isBlack(p);
          if (!isEnemy) continue;
          const raw = this.getRawMoves(r, c, p, oppColor);
          for (const [tr, tc] of raw) {
            if (tr === kr && tc === kc) return true;
          }
        }
      }
      return false;
    }
    getLegalMoves(r, c) {
      const p = this.board[r][c];
      if (!p) return [];
      const color = this.isRed(p) ? 'R' : 'B';
      const raw = this.getRawMoves(r, c, p, color);
      return raw.filter(([tr, tc]) => {
        const orig = this.board[tr][tc];
        this.board[tr][tc] = p;
        this.board[r][c] = null;
        const inCheck = this.isInCheck(color);
        this.board[r][c] = p;
        this.board[tr][tc] = orig;
        return !inCheck;
      });
    }
    getRawMoves(r, c, p, color) {
      const moves = [];
      const isSameColor = (t) => t && (color === 'R' ? this.isRed(t) : this.isBlack(t));
      const addMove = (tr, tc) => {
        if (tr < 0 || tr >= 10 || tc < 0 || tc >= 9) return false;
        const target = this.board[tr][tc];
        if (isSameColor(target)) return false;
        moves.push([tr, tc]);
        return !target;
      };
      const type = p.toUpperCase();
      if (type === 'K') {
        const minR = color === 'R' ? 7 : 0, maxR = color === 'R' ? 9 : 2;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= minR && nr <= maxR && nc >= 3 && nc <= 5) addMove(nr, nc);
        }
      } else if (type === 'A') {
        const minR = color === 'R' ? 7 : 0, maxR = color === 'R' ? 9 : 2;
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= minR && nr <= maxR && nc >= 3 && nc <= 5) addMove(nr, nc);
        }
      } else if (type === 'B') {
        const minR = color === 'R' ? 5 : 0, maxR = color === 'R' ? 9 : 4;
        for (const [dr, dc, er, ec] of [[-2,-2,-1,-1],[-2,2,-1,1],[2,-2,1,-1],[2,2,1,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= minR && nr <= maxR && nc >= 0 && nc < 9 && !this.board[r + er][c + ec]) {
            addMove(nr, nc);
          }
        }
      } else if (type === 'N') {
        const dirs = [[-2,-1,-1,0],[-2,1,-1,0],[2,-1,1,0],[2,1,1,0],[-1,-2,0,-1],[1,-2,0,-1],[-1,2,0,1],[1,2,0,1]];
        for (const [dr, dc, lr, lc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 10 && nc >= 0 && nc < 9 && !this.board[r + lr][c + lc]) {
            addMove(nr, nc);
          }
        }
      } else if (type === 'R') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          let step = 1;
          while (addMove(r + dr * step, c + dc * step)) step++;
        }
      } else if (type === 'C') {
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          let step = 1, jumped = false;
          while (true) {
            const nr = r + dr * step, nc = c + dc * step;
            if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) break;
            const target = this.board[nr][nc];
            if (!jumped) {
              if (!target) moves.push([nr, nc]);
              else jumped = true;
            } else {
              if (target) {
                if (!isSameColor(target)) moves.push([nr, nc]);
                break;
              }
            }
            step++;
          }
        }
      } else if (type === 'P') {
        const fwd = color === 'R' ? -1 : 1;
        const crossed = color === 'R' ? r <= 4 : r >= 5;
        addMove(r + fwd, c);
        if (crossed) {
          addMove(r, c - 1);
          addMove(r, c + 1);
        }
      }
      return moves;
    }
    getAllMoves(color) {
      const moves = [];
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (p && (color === 'R' ? this.isRed(p) : this.isBlack(p))) {
            for (const [tr, tc] of this.getLegalMoves(r, c)) {
              moves.push({ fromR: r, fromC: c, toR: tr, toC: tc, piece: p });
            }
          }
        }
      }
      return moves;
    }
    makeMove(fromR, fromC, toR, toC) {
      const p = this.board[fromR][fromC];
      if (!p) return false;
      const color = this.isRed(p) ? 'R' : 'B';
      if (color !== this.turn) return false;
      const legal = this.getLegalMoves(fromR, fromC);
      if (!legal.some(([r, c]) => r === toR && c === toC)) return false;
      const captured = this.board[toR][toC];
      this.board[toR][toC] = p;
      this.board[fromR][fromC] = null;
      this.history.push({ fromR, fromC, toR, toC, piece: p, captured });
      if (captured && captured.toUpperCase() === 'K') {
        this.winner = color;
      }
      this.turn = this.turn === 'R' ? 'B' : 'R';
      return true;
    }
    undo() {
      if (!this.history.length) return false;
      const last = this.history.pop();
      this.board[last.fromR][last.fromC] = last.piece;
      this.board[last.toR][last.toC] = last.captured;
      this.turn = this.isRed(last.piece) ? 'R' : 'B';
      this.winner = null;
      return true;
    }
    orderMoves(moves, depth) {
      const values = { K: 10000, R: 900, C: 450, N: 400, A: 200, B: 200, P: 100 };
      const killers = this.killerMoves[depth] || [];
      return moves.map(m => {
        const target = this.board[m.toR][m.toC];
        let score = 0;
        if (target) {
          const victimVal = values[target.toUpperCase()] || 50;
          const attackerVal = values[m.piece.toUpperCase()] || 50;
          score += victimVal * 10 - attackerVal; // MVV-LVA
        }
        if (killers.some(k => k.fromR === m.fromR && k.fromC === m.fromC && k.toR === m.toR && k.toC === m.toC)) {
          score += 500;
        }
        return { ...m, orderScore: score };
      }).sort((a, b) => b.orderScore - a.orderScore);
    }
    getBoardHash() {
      let s = this.turn + '|';
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
        }
      }
      return s;
    }
    evaluateBoard(color) {
      if (this.winner === color) return 100000;
      if (this.winner && this.winner !== color) return -100000;
      const pieceValues = { K: 10000, R: 900, C: 450, N: 400, B: 180, A: 180, P: 90 };
      const oppColor = color === 'R' ? 'B' : 'R';
      let myScore = 0, oppScore = 0;

      const enemyAttack = new Set();
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (p && (oppColor === 'R' ? this.isRed(p) : this.isBlack(p))) {
            for (const [tr, tc] of this.getRawMoves(r, c, p, oppColor)) enemyAttack.add(tr * 9 + tc);
          }
        }
      }
      const myAttack = new Set();
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (p && (color === 'R' ? this.isRed(p) : this.isBlack(p))) {
            for (const [tr, tc] of this.getRawMoves(r, c, p, color)) myAttack.add(tr * 9 + tc);
          }
        }
      }

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = this.board[r][c];
          if (!p) continue;
          const isRed = this.isRed(p);
          const isMyPiece = (color === 'R' && isRed) || (color === 'B' && !isRed);
          const type = p.toUpperCase();
          let val = pieceValues[type] || 50;
          const idx = r * 9 + c;

          if (type === 'P') {
            const crossed = isRed ? r <= 4 : r >= 5;
            if (crossed) val += 80;
            const distToPalace = isRed ? Math.max(0, r - 2) : Math.max(0, 7 - r);
            val += Math.max(0, 4 - distToPalace) * 12;
          }
          if (type === 'N') {
            if (r === 4 || r === 5) val += 30; // 河口马
            if (c >= 2 && c <= 6) val += 20;
          }
          if (type === 'R') {
            let openFile = true;
            for (let rr = 0; rr < 10; rr++) {
              if (rr !== r && this.board[rr][c]) { openFile = false; break; }
            }
            if (openFile) val += 35; // 通路车
            const advanceR = isRed ? (9 - r) : r;
            val += advanceR * 8;
          }
          if (type === 'C') {
            if (c === 4) val += 30; // 当头炮
          }
          if (type === 'K') {
            if (c >= 3 && c <= 5) val += 20;
          }
          if (type === 'A' || type === 'B') {
            const inPalace = (isRed ? r >= 7 : r <= 2) && (c >= 3 && c <= 5);
            if (inPalace) val += 25; // 九宫内防守价值
          }

          if (isMyPiece) {
            myScore += val;
            if (enemyAttack.has(idx)) myScore -= Math.round(val * 0.4); // 被威胁扣分
          } else {
            oppScore += val;
            if (myAttack.has(idx)) oppScore -= Math.round(val * 0.4);
          }
        }
      }

      let score = myScore - oppScore;

      const myKing = this.findKing(color);
      const oppKing = this.findKing(oppColor);
      if (myKing && enemyAttack.has(myKing[0] * 9 + myKing[1])) score -= 8000; // 我被将军
      if (oppKing && myAttack.has(oppKing[0] * 9 + oppKing[1])) score += 8000; // 我将军对方

      if (myKing) {
        const [kr, kc] = myKing;
        let guardCount = 0;
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const nr = kr + dr, nc = kc + dc;
          if (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
            const np = this.board[nr][nc];
            if (np && ((color === 'R' && this.isRed(np)) || (color === 'B' && this.isBlack(np)))) guardCount++;
          }
        }
        if (guardCount === 0) score -= 200;
        else if (guardCount === 1) score -= 60;
      }

      return score;
    }
    alphabeta(depth, alpha, beta, isMaximizing, color) {
      const hash = this.getBoardHash();
      const ttEntry = this.tt.get(hash);
      if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === 'exact') return ttEntry.score;
        if (ttEntry.flag === 'lower') alpha = Math.max(alpha, ttEntry.score);
        if (ttEntry.flag === 'upper') beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
      }
      if (depth === 0 || this.winner) return this.evaluateBoard(color);

      const currentTurn = isMaximizing ? color : (color === 'R' ? 'B' : 'R');
      const rawMoves = this.getAllMoves(currentTurn);
      if (!rawMoves.length) {
        return currentTurn === color ? -99990 : 99990; // 将死/困毙
      }
      const moves = this.orderMoves(rawMoves, depth);
      let bestMove = moves[0];

      if (isMaximizing) {
        let maxEval = -Infinity;
        for (const m of moves) {
          this.makeMove(m.fromR, m.fromC, m.toR, m.toC);
          const evalVal = this.alphabeta(depth - 1, alpha, beta, false, color);
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
          this.makeMove(m.fromR, m.fromC, m.toR, m.toC);
          const evalVal = this.alphabeta(depth - 1, alpha, beta, true, color);
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
    getBestMove(color = 'B', soften = false) {
      const rawMoves = this.getAllMoves(color);
      if (!rawMoves.length) return null;
      const depth = soften ? 1 : 2;
      const moves = this.orderMoves(rawMoves, depth);
      let scoredMoves = [];
      for (const m of moves) {
        this.makeMove(m.fromR, m.fromC, m.toR, m.toC);
        const score = this.alphabeta(depth - 1, -Infinity, Infinity, false, color);
        this.undo();
        scoredMoves.push({ ...m, score });
      }
      scoredMoves.sort((a, b) => b.score - a.score);
      if (soften && scoredMoves.length > 2) {
        const pickIdx = Math.floor(Math.random() * Math.min(3, scoredMoves.length - 1)) + 1;
        return scoredMoves[pickIdx];
      }
      return scoredMoves[0];
    }
  }
