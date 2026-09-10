/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  2048 单机游戏数据
 * ======================================================== */

const STORAGE_KEY = 'games_2048_state';

export class Game2048Data {
    constructor(storage) {
        this.storage = storage;
        this.size = 4;
        this.state = this._loadState();
    }

    getState() {
        return this.state;
    }

    reset() {
        this.state = this._createInitialState();
        this._persist();
        return this.state;
    }

    move(direction) {
        if (!this.state || this.state.over) return { moved: false, state: this.state };
        const normalized = this._normalizeDirection(direction);
        if (!normalized) return { moved: false, state: this.state };

        const before = this._cloneBoard(this.state.board);
        let addedScore = 0;

        for (let index = 0; index < this.size; index += 1) {
            const line = this._readLine(before, index, normalized);
            const result = this._slideLine(line);
            addedScore += result.score;
            this._writeLine(this.state.board, index, normalized, result.line);
        }

        const moved = !this._boardsEqual(before, this.state.board);
        if (!moved) return { moved: false, state: this.state };

        this.state.score += addedScore;
        this.state.best = Math.max(Number(this.state.best || 0), this.state.score);
        this._addRandomTile();
        this.state.won = this.state.won || this.state.board.some(row => row.some(value => value >= 2048));
        this.state.over = !this._canMove();
        this._persist();
        return { moved: true, state: this.state };
    }

    _loadState() {
        const saved = this.storage?.get?.(STORAGE_KEY);
        if (saved && this._isValidState(saved)) {
            return {
                board: this._cloneBoard(saved.board),
                score: Number(saved.score || 0),
                best: Number(saved.best || 0),
                over: !!saved.over,
                won: !!saved.won
            };
        }
        return this._createInitialState();
    }

    _createInitialState() {
        const best = Number(this.storage?.get?.(STORAGE_KEY)?.best || 0) || 0;
        const state = {
            board: Array.from({ length: this.size }, () => Array(this.size).fill(0)),
            score: 0,
            best,
            over: false,
            won: false
        };
        this.state = state;
        this._addRandomTile();
        this._addRandomTile();
        return state;
    }

    _addRandomTile() {
        const empty = [];
        this.state.board.forEach((row, rowIndex) => {
            row.forEach((value, colIndex) => {
                if (!value) empty.push([rowIndex, colIndex]);
            });
        });
        if (!empty.length) return false;
        const [row, col] = empty[Math.floor(Math.random() * empty.length)];
        this.state.board[row][col] = Math.random() < 0.9 ? 2 : 4;
        return true;
    }

    _slideLine(line) {
        const tiles = line.filter(Boolean);
        const merged = [];
        let score = 0;

        for (let index = 0; index < tiles.length; index += 1) {
            if (tiles[index] === tiles[index + 1]) {
                const value = tiles[index] * 2;
                merged.push(value);
                score += value;
                index += 1;
            } else {
                merged.push(tiles[index]);
            }
        }

        while (merged.length < this.size) merged.push(0);
        return { line: merged, score };
    }

    _readLine(board, index, direction) {
        if (direction === 'left') return board[index].slice();
        if (direction === 'right') return board[index].slice().reverse();
        const line = board.map(row => row[index]);
        return direction === 'down' ? line.reverse() : line;
    }

    _writeLine(board, index, direction, line) {
        const values = direction === 'right' || direction === 'down' ? line.slice().reverse() : line;
        for (let pos = 0; pos < this.size; pos += 1) {
            if (direction === 'left' || direction === 'right') {
                board[index][pos] = values[pos];
            } else {
                board[pos][index] = values[pos];
            }
        }
    }

    _canMove() {
        const board = this.state.board;
        for (let row = 0; row < this.size; row += 1) {
            for (let col = 0; col < this.size; col += 1) {
                const value = board[row][col];
                if (!value) return true;
                if (row < this.size - 1 && board[row + 1][col] === value) return true;
                if (col < this.size - 1 && board[row][col + 1] === value) return true;
            }
        }
        return false;
    }

    _normalizeDirection(direction) {
        const value = String(direction || '').toLowerCase();
        if (['left', 'right', 'up', 'down'].includes(value)) return value;
        return '';
    }

    _isValidState(state) {
        return Array.isArray(state.board)
            && state.board.length === this.size
            && state.board.every(row => Array.isArray(row) && row.length === this.size);
    }

    _cloneBoard(board) {
        return board.map(row => row.slice());
    }

    _boardsEqual(a, b) {
        return a.every((row, rowIndex) => row.every((value, colIndex) => value === b[rowIndex][colIndex]));
    }

    _persist() {
        this.storage?.set?.(STORAGE_KEY, this.state);
    }
}
