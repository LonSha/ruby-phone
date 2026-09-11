export class GomokuEngine {
    constructor(size = 15) {
      this.size = size;
      this.board = Array(size * size).fill(0); // 0=空, 1=黑, 2=白
      this.history = [];
      this.turn = 1; // 1=黑, 2=白
      this.winner = 0; // 0=进行中, 1=黑胜, 2=白胜, 3=平局
    }
    get(r, c) {
      if (r < 0 || r >= this.size || c < 0 || c >= this.size) return -1;
      return this.board[r * this.size + c];
    }
    set(r, c, val) {
      this.board[r * this.size + c] = val;
    }
    makeMove(r, c, player = this.turn) {
      if (this.winner !== 0 || this.get(r, c) !== 0) return false;
      this.set(r, c, player);
      this.history.push({ r, c, player });
      if (this.checkWin(r, c, player)) {
        this.winner = player;
      } else if (this.history.length === this.size * this.size) {
        this.winner = 3;
      } else {
        this.turn = this.turn === 1 ? 2 : 1;
      }
      return true;
    }
    undo() {
      if (!this.history.length) return false;
      const last = this.history.pop();
      this.set(last.r, last.c, 0);
      this.winner = 0;
      this.turn = last.player;
      return true;
    }
    checkWin(r, c, p) {
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
          if (this.get(r + dr * i, c + dc * i) === p) count++; else break;
        }
        for (let i = 1; i < 5; i++) {
          if (this.get(r - dr * i, c - dc * i) === p) count++; else break;
        }
        if (count >= 5) return true;
      }
      return false;
    }
    getBestMove(aiPlayer = 2, soften = false) {
      const humanPlayer = aiPlayer === 1 ? 2 : 1;
      if (this.history.length === 0) {
        return { r: 7, c: 7 };
      }
      let scoredMoves = [];
      const candidates = new Set();
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this.get(r, c) !== 0) {
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const nr = r + dr, nc = c + dc;
                if (this.get(nr, nc) === 0) candidates.add(nr * this.size + nc);
              }
            }
          }
        }
      }
      for (const idx of candidates) {
        const r = Math.floor(idx / this.size);
        const c = idx % this.size;
        const attackScore = this.evaluatePoint(r, c, aiPlayer);
        const defenseScore = this.evaluatePoint(r, c, humanPlayer);
        const score = attackScore * 1.15 + defenseScore;
        scoredMoves.push({ r, c, score });
      }
      scoredMoves.sort((a, b) => b.score - a.score);
      if (!scoredMoves.length) return { r: 7, c: 7 };

      if (soften && scoredMoves.length > 2 && scoredMoves[0].score < 50000) {
        const pickIdx = Math.floor(Math.random() * Math.min(3, scoredMoves.length - 1)) + 1;
        return scoredMoves[pickIdx];
      }
      return scoredMoves[0];
    }
    evaluatePoint(r, c, p) {
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      let total = 0;
      for (const [dr, dc] of dirs) {
        let count = 1, openEnds = 0;
        let i = 1;
        while (i < 5 && this.get(r + dr * i, c + dc * i) === p) { count++; i++; }
        if (this.get(r + dr * i, c + dc * i) === 0) openEnds++;
        let j = 1;
        while (j < 5 && this.get(r - dr * j, c - dc * j) === p) { count++; j++; }
        if (this.get(r - dr * j, c - dc * j) === 0) openEnds++;

        if (count >= 5) total += 100000;
        else if (count === 4) total += openEnds === 2 ? 10000 : 1500;
        else if (count === 3) total += openEnds === 2 ? 1000 : 150;
        else if (count === 2) total += openEnds === 2 ? 100 : 15;
        else if (count === 1 && openEnds === 2) total += 5;
      }
      return total;
    }
  }
