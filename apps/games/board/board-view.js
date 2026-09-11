/**
 * 对弈视图：五子棋 / 象棋 / 斗兽棋
 */
import { BOARD_GAMES } from "./board-data.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function h(tag, attrs, html) {
  const a = attrs ? (" " + attrs) : "";
  return "<" + tag + a + ">" + (html || "") + "<" + "/" + tag + ">";
}
function attr(name, val) {
  const q = String.fromCharCode(34);
  return name + "=" + q + val + q;
}
function cls(name) { return attr("class", name); }

const XIANGQI_LABEL = {
  K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵",
  k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒",
};
const JUNGLE_LABEL = {
  E: "象", L: "狮", T: "虎", P: "豹", W: "狼", D: "狗", C: "猫", R: "鼠",
  e: "象", l: "狮", t: "虎", p: "豹", w: "狼", d: "狗", c: "猫", r: "鼠",
};

export class BoardView {
  constructor(app) {
    this.app = app;
    this._cssLoaded = false;
    this._selected = null;
    this._aiTimer = null;
  }

  _loadCSS() {
    if (this._cssLoaded) return;
    if (document.getElementById("games-board-css")) { this._cssLoaded = true; return; }
    const link = document.createElement("link");
    link.id = "games-board-css";
    link.rel = "stylesheet";
    link.href = new URL("./board.css?v=1.0.0", import.meta.url).href;
    document.head.appendChild(link);
    this._cssLoaded = true;
  }

  render() {
    this._loadCSS();
    const data = this.app.boardData;
    const state = data.getState();
    if (state.screen !== "play" || !data.getEngine()) this._renderPicker();
    else this._renderPlay();
  }

  _renderPicker() {
    const cards = BOARD_GAMES.map((g) => {
      return h("button", cls("gb-pick") + " " + attr("data-board", g.id) + " " + attr("type", "button"),
        h("strong", "", esc(g.title)) + h("span", "", esc(g.desc)));
    }).join("");
    const html = h("div", cls("games-app gb-app"),
      h("div", cls("gb-top"),
        h("button", cls("gb-icon") + " " + attr("id", "gb-back-lobby") + " " + attr("type", "button"), "<i class=" + String.fromCharCode(34) + "fa-solid fa-chevron-left" + String.fromCharCode(34) + "></i>") +
        h("div", "", h("div", cls("gb-title"), "对弈") + h("div", cls("gb-sub"), "本地棋规 · 可与本机对弈"))
      ) +
      h("div", cls("gb-body"), cards)
    );
    this.app.phoneShell.setContent(html, "games-board");
    document.getElementById("gb-back-lobby")?.addEventListener("click", () => this.app.openGamesLobby?.() || this._backLobby());
    document.querySelectorAll("[data-board]").forEach((btn) => {
      btn.addEventListener("click", () => this.app.startBoardGame(btn.getAttribute("data-board")));
    });
  }

  _backLobby() {
    this.app.backToLobby();
  }

  _statusText(data) {
    const w = data.winner();
    const type = data.state.type;
    if (w != null) {
      if (type === "gomoku") {
        if (w === 3) return "平局";
        const userPlayer = data.state.userFirst ? 1 : 2;
        return w === userPlayer ? "你赢了" : "你输了";
      }
      const userColor = data.state.userFirst ? "R" : "B";
      return String(w) === userColor ? "你赢了" : "你输了";
    }
    if (data.state.thinking) return "对方思考中";
    return data.isUserTurn() ? "轮到你" : "等待对方";
  }

  _renderPlay() {
    const data = this.app.boardData;
    const meta = data.meta();
    const engine = data.getEngine();
    const status = this._statusText(data);
    const boardHtml = this._renderBoard(data, engine);
    const html = h("div", cls("games-app gb-app gb-play"),
      h("div", cls("gb-top"),
        h("button", cls("gb-icon") + " " + attr("id", "gb-back-picker") + " " + attr("type", "button"), "<i class=" + String.fromCharCode(34) + "fa-solid fa-chevron-left" + String.fromCharCode(34) + "></i>") +
        h("div", "", h("div", cls("gb-title"), esc(meta.title)) + h("div", cls("gb-sub"), esc(status))) +
        h("button", cls("gb-icon") + " " + attr("id", "gb-undo") + " " + attr("type", "button"), "悔") +
        h("button", cls("gb-icon") + " " + attr("id", "gb-new") + " " + attr("type", "button"), "新")
      ) +
      h("div", cls("gb-stage"), boardHtml)
    );
    this.app.phoneShell.setContent(html, "games-board");
    this._bindPlay(data);
    this._maybeAi(data);
  }

  _cellClass(type, r, c, piece, selected, targets) {
    const bits = ["gb-cell"];
    if (type === "gomoku") bits.push("gb-go");
    if (type === "xiangqi") bits.push("gb-xq", (r + c) % 2 ? "odd" : "even");
    if (type === "jungle") {
      bits.push("gb-jg");
      const eng = this.app.boardData.getEngine();
      if (eng.isRiver(r, c)) bits.push("river");
      if (eng.isTrap(r, c)) bits.push("trap");
      if (eng.isDen(r, c)) bits.push("den");
    }
    if (selected && selected.r === r && selected.c === c) bits.push("sel");
    if (targets.some((t) => t.r === r && t.c === c)) bits.push("tgt");
    return bits.join(" ");
  }

  _pieceHtml(type, piece) {
    if (!piece) return "";
    if (type === "gomoku") {
      return h("span", cls(piece === 1 ? "stone black" : "stone white"), "");
    }
    const red = piece === piece.toUpperCase();
    const label = type === "xiangqi" ? (XIANGQI_LABEL[piece] || piece) : (JUNGLE_LABEL[piece] || piece);
    return h("span", cls(red ? "piece red" : "piece black"), esc(label));
  }

  _renderBoard(data, engine) {
    const type = data.state.type;
    const selected = this._selected;
    const targets = selected && type !== "gomoku" ? data.legalTargets(selected.r, selected.c) : [];
    let rows = 15, cols = 15, getPiece = (r, c) => engine.get(r, c);
    if (type === "xiangqi") { rows = 10; cols = 9; getPiece = (r, c) => engine.board[r][c]; }
    if (type === "jungle") { rows = 9; cols = 7; getPiece = (r, c) => engine.board[r][c]; }
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const piece = getPiece(r, c);
        const stone = type === "gomoku" ? piece : piece;
        cells.push(h("button",
          cls(this._cellClass(type, r, c, piece, selected, targets)) + " " + attr("type", "button") + " " + attr("data-r", r) + " " + attr("data-c", c),
          this._pieceHtml(type, type === "gomoku" ? (stone || 0) : piece)
        ));
      }
    }
    return h("div", cls("gb-board gb-" + type) + " " + attr("style", "--cols:" + cols), cells.join(""));
  }

  _bindPlay(data) {
    document.getElementById("gb-back-picker")?.addEventListener("click", () => {
      this._selected = null;
      data.openPicker();
      this.render();
    });
    document.getElementById("gb-undo")?.addEventListener("click", () => {
      this._selected = null;
      data.undo();
      this.render();
    });
    document.getElementById("gb-new")?.addEventListener("click", () => {
      this._selected = null;
      data.newGame(data.state.type, { vsAi: data.state.vsAi, userFirst: data.state.userFirst });
      this.render();
    });
    document.querySelectorAll(".gb-cell").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = Number(btn.getAttribute("data-r"));
        const c = Number(btn.getAttribute("data-c"));
        this._onCell(data, r, c);
      });
    });
  }

  _onCell(data, r, c) {
    if (!data.isUserTurn() || data.winner() || data.state.thinking) return;
    const type = data.state.type;
    if (type === "gomoku") {
      const res = data.playUser({ r, c });
      if (res.ok) this.render();
      return;
    }
    const engine = data.getEngine();
    const piece = engine.board[r][c];
    const userColor = data.state.userFirst ? "R" : "B";
    const isOwn = piece && ((userColor === "R" && piece === piece.toUpperCase()) || (userColor === "B" && piece === piece.toLowerCase()));
    if (!this._selected) {
      if (!isOwn) return;
      this._selected = { r, c };
      this.render();
      return;
    }
    if (this._selected.r === r && this._selected.c === c) {
      this._selected = null;
      this.render();
      return;
    }
    if (isOwn) {
      this._selected = { r, c };
      this.render();
      return;
    }
    const res = data.playUser({ fromR: this._selected.r, fromC: this._selected.c, toR: r, toC: c });
    if (res.ok) this._selected = null;
    this.render();
  }

  _maybeAi(data) {
    if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }
    if (!data.state.vsAi || data.winner() || data.isUserTurn() || data.state.thinking) return;
    data.state.thinking = true;
    this._aiTimer = setTimeout(() => {
      data.playAi();
      this.render();
    }, 280);
  }
}

export default BoardView;

