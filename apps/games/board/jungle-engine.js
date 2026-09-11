export class JungleEngine {
    constructor() {
      this.init();
    }
    init() {
      this.board = Array(9).fill(null).map(() => Array(7).fill(null));
      this.history = [];
      this.turn = 'R'; // 'R'=红(用户, 下方), 'B'=蓝(电脑, 上方)
      this.winner = null;
      this.tt = new Map();
      this.killerMoves = Array(10).fill(null).map(() => []);
      const initial = [
        [0, 0, 'l'], [0, 6, 't'], [1, 1, 'd'], [1, 5, 'c'], [2, 0, 'r'], [2, 2, 'p'], [2, 4, 'w'], [2, 6, 'e'],
        [8, 6, 'L'], [8, 0, 'T'], [7, 5, 'D'], [7, 1, 'C'], [6, 6, 'R'], [6, 4, 'P'], [6, 2, 'W'], [6, 0, 'E']
      ];
      for (const [r, c, p] of initial) this.board[r][c] = p;
    }
    isRiver(r, c) {
      return (r >= 3 && r <= 5) && ((c >= 1 && c <= 2) || (c >= 4 && c <= 5));
    }
    isTrap(r, c) {
      return (r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3) || (r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3);
    }
    isDen(r, c) {
      return (r === 0 && c === 3) || (r === 8 && c === 3);
    }
    isOwnDen(r, c, color) {
      return color === 'B' ? (r === 0 && c === 3) : (r === 8 && c === 3);
    }
    isOpponentTrap(r, c, color) {
      return color === 'R' ? ((r === 0 && (c === 2 || c === 4)) || (r === 1 && c === 3)) : ((r === 8 && (c === 2 || c === 4)) || (r === 7 && c === 3));
    }
    getRank(p) {
      if (!p) return 0;
      const map = { R: 1, C: 2, D: 3, W: 4, P: 5, T: 6, L: 7, E: 8 };
      return map[p.toUpperCase()] || 0;
    }
    canCapture(atk, def, defR, defC) {
      if (!def) return true;
      const aCol = atk === atk.toUpperCase() ? 'R' : 'B';
      const dCol = def === def.toUpperCase() ? 'R' : 'B';
      if (aCol === dCol) return false;
      if (this.isOpponentTrap(defR, defC, aCol)) return true;
      const aRank = this.getRank(atk), dRank = this.getRank(def);
      if (aRank === 1 && dRank === 8) return true;
      if (aRank === 8 && dRank === 1) return false;
      return aRank >= dRank;
    }
    getLegalMoves(r, c) {
      const p = this.board[r][c];
      if (!p) return [];
      const color = p === p.toUpperCase() ? 'R' : 'B';
      const rank = this.getRank(p);
      const inRiver = this.isRiver(r, c);
      const moves = [];
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= 9 || nc < 0 || nc >= 7 || this.isOwnDen(nr, nc, color)) continue;
        if (rank === 1) {
          const target = this.board[nr][nc];
          if (this.isRiver(nr, nc)) {
            if (!target || this.canCapture(p, target, nr, nc)) moves.push([nr, nc]);
          } else {
            if (inRiver) {
              if (!target) moves.push([nr, nc]);
            } else {
              if (this.canCapture(p, target, nr, nc)) moves.push([nr, nc]);
            }
          }
        } else if (rank === 6 || rank === 7) {
          if (this.isRiver(nr, nc)) {
            let jr = r + dr, jc = c + dc, blocked = false;
            while (this.isRiver(jr, jc)) {
              if (this.board[jr][jc]) { blocked = true; break; }
              jr += dr; jc += dc;
            }
            if (!blocked && jr >= 0 && jr < 9 && jc >= 0 && jc < 7 && !this.isOwnDen(jr, jc, color)) {
              if (this.canCapture(p, this.board[jr][jc], jr, jc)) moves.push([jr, jc]);
            }
          } else {
            if (this.canCapture(p, this.board[nr][nc], nr, nc)) moves.push([nr, nc]);
          }
        } else {
          if (this.isRiver(nr, nc)) continue;
          if (this.canCapture(p, this.board[nr][nc], nr, nc)) moves.push([nr, nc]);
        }
      }
      return moves;
    }
    getAllMoves(color) {
      const moves = [];
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 7; c++) {
          const p = this.board[r][c];
          if (p && (color === 'R' ? p === p.toUpperCase() : p === p.toLowerCase())) {
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
      const color = p === p.toUpperCase() ? 'R' : 'B';
      if (color !== this.turn) return false;
      const legal = this.getLegalMoves(fromR, fromC);
      if (!legal.some(([r, c]) => r === toR && c === toC)) return false;
      const captured = this.board[toR][toC];
      this.board[toR][toC] = p;
      this.board[fromR][fromC] = null;
      this.history.push({ fromR, fromC, toR, toC, piece: p, captured });
      if (color === 'R' && toR === 0 && toC === 3) this.winner = 'R';
      else if (color === 'B' && toR === 8 && toC === 3) this.winner = 'B';
      else {
        const oppColor = color === 'R' ? 'B' : 'R';
        let count = 0;
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 7; c++) {
            const piece = this.board[r][c];
            if (piece && (oppColor === 'R' ? piece === piece.toUpperCase() : piece === piece.toLowerCase())) count++;
          }
        }
        if (count === 0) this.winner = color;
      }
      this.turn = this.turn === 'R' ? 'B' : 'R';
      return true;
    }
    undo() {
      if (!this.history.length) return false;
      const last = this.history.pop();
      this.board[last.fromR][last.fromC] = last.piece;
      this.board[last.toR][last.toC] = last.captured;
      this.turn = last.piece === last.piece.toUpperCase() ? 'R' : 'B';
      this.winner = null;
      return true;
    }
    orderMoves(moves, depth) {
      const values = { E: 100, L: 90, T: 80, P: 70, W: 60, D: 50, C: 40, R: 30 };
      const killers = this.killerMoves[depth] || [];
      return moves.map(m => {
        const target = this.board[m.toR][m.toC];
        let score = 0;
        if (target) {
          const victimVal = values[target.toUpperCase()] || 10;
          const attackerVal = values[m.piece.toUpperCase()] || 10;
          score += victimVal * 10 - attackerVal; // MVV-LVA
        }
        const oppDenR = (m.piece === m.piece.toUpperCase() ? 'R' : 'B') === 'R' ? 0 : 8;
        if (m.toR === oppDenR && m.toC === 3) score += 20000; // 进兽穴获胜走法优先
        if (killers.some(k => k.fromR === m.fromR && k.fromC === m.fromC && k.toR === m.toR && k.toC === m.toC)) score += 500;
        return { ...m, orderScore: score };
      }).sort((a, b) => b.orderScore - a.orderScore);
    }
    getBoardHash() {
      let s = this.turn + '|';
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 7; c++) {
          if (this.board[r][c]) s += `${r}${c}${this.board[r][c]};`;
        }
      }
      return s;
    }
    evaluateBoard(color) {
      if (this.winner === color) return 100000;
      if (this.winner && this.winner !== color) return -100000;
      const pieceValues = { E: 100, L: 90, T: 80, P: 70, W: 60, D: 50, C: 40, R: 30 };
      const oppColor = color === 'R' ? 'B' : 'R';
      const targetDenR = color === 'B' ? 8 : 0;
      const targetDenC = 3;
      const ownDenR = color === 'B' ? 0 : 8;
      const ownDenC = 3;

      const enemyAttack = new Set();
      for (const m of this.getAllMoves(oppColor)) {
        enemyAttack.add(m.toR * 7 + m.toC);
      }

      let myScore = 0, oppScore = 0;

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 7; c++) {
          const p = this.board[r][c];
          if (!p) continue;
          const isMyPiece = color === 'R' ? p === p.toUpperCase() : p === p.toLowerCase();
          const type = p.toUpperCase();
          const val = pieceValues[type] || 10;
          const idx = r * 7 + c;
          let posVal = 0;

          if (isMyPiece) {
            const distToDen = Math.abs(r - targetDenR) + Math.abs(c - targetDenC);
            posVal += (15 - distToDen) * 12;
            if (this.isOpponentTrap(r, c, color)) posVal -= 300;
            if (this.isRiver(r, c)) {
              if (type === 'R') posVal += 30;
              else posVal -= 50;
            }
            myScore += val * 10 + posVal;
            if (enemyAttack.has(idx)) myScore -= val * 4;
            if (this.getLegalMoves(r, c).length === 0) myScore -= 60;
          } else {
            const distToMyDen = Math.abs(r - ownDenR) + Math.abs(c - ownDenC);
            posVal += (15 - distToMyDen) * 12;
            if (this.isOpponentTrap(r, c, oppColor)) posVal -= 300;
            if (this.isRiver(r, c)) {
              if (type === 'R') posVal += 30;
              else posVal -= 50;
            }
            oppScore += val * 10 + posVal;
          }
        }
      }

      let score = myScore - oppScore;

      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = ownDenR + dr, nc = ownDenC + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 7) {
          const p = this.board[nr][nc];
          if (p && (color === 'R' ? p === p.toUpperCase() : p === p.toLowerCase())) {
            score += 40;
          }
        }
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
        return currentTurn === color ? -99990 : 99990;
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
      const depth = soften ? 1 : 4;
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
