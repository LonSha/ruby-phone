/**
 * 对弈视图：五子棋 / 象棋 / 斗兽棋 / 国际象棋 / 日本将棋
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
const CHESS_PIECE = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};
const CHESS_PROMO_LABEL = { Q: "后", R: "车", B: "象", N: "马" };
const SHOGI_LABEL = {
  K: "王", k: "玉",
  R: "飞", r: "飞",
  B: "角", b: "角",
  S: "银", s: "银",
  N: "桂", n: "桂",
  L: "香", l: "香",
  G: "金", g: "金",
  P: "步", p: "步",
  D: "龙", d: "龙",
  H: "马", h: "马",
  M: "成银", m: "成银",
  E: "成桂", e: "成桂",
  Y: "成香", y: "成香",
  T: "T", t: "T",
};

function isOwnPiece(piece, userColor) {
  if (!piece) return false;
  const up = userColor === String(userColor).toUpperCase();
  return up ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
}

export class BoardView {
  constructor(app) {
    this.app = app;
    this._cssLoaded = false;
    this._selected = null;
    this._selectedDrop = null;
    this._pendingPromo = null;
    this._aiTimer = null;
  }

  _loadCSS() {
    if (this._cssLoaded) return;
    if (document.getElementById("games-board-css")) { this._cssLoaded = true; return; }
    const link = document.createElement("link");
    link.id = "games-board-css";
    link.rel = "stylesheet";
    link.href = new URL("./board.css?v=1.1.0", import.meta.url).href;
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
        return w === data.userColor() ? "你赢了" : "你输了";
      }
      if (w === "draw") return "和棋";
      return String(w) === String(data.userColor()) ? "你赢了" : "你输了";
    }
    if (data.state.thinking) return "对方思考中";
    return data.isUserTurn() ? "轮到你" : "等待对方";
  }

  _renderPlay() {
    const data = this.app.boardData;
    const type = data.state.type;
    const meta = data.meta();
    const engine = data.getEngine();
    const status = this._statusText(data);
    const boardHtml = this._renderBoard(data, engine);
    const top = h("div", cls("gb-top"),
      h("button", cls("gb-icon") + " " + attr("id", "gb-back-picker") + " " + attr("type", "button"), "<i class=" + String.fromCharCode(34) + "fa-solid fa-chevron-left" + String.fromCharCode(34) + "></i>") +
      h("div", "", h("div", cls("gb-title"), esc(meta.title)) + h("div", cls("gb-sub"), esc(status))) +
      h("button", cls("gb-icon") + " " + attr("id", "gb-undo") + " " + attr("type", "button"), "悔") +
      h("button", cls("gb-icon") + " " + attr("id", "gb-new") + " " + attr("type", "button"), "新")
    );
    let inner = h("div", cls("gb-stage"), boardHtml);
    if (type === "shogi") inner += this._renderShogiHand(data);
    if (this._pendingPromo) inner += this._renderPromoBar(type);
    const html = h("div", cls("games-app gb-app gb-play"), top + inner);
    this.app.phoneShell.setContent(html, "games-board");
    this._bindPlay(data);
    this._maybeAi(data);
  }

  _renderShogiHand(data) {
    const hand = data.shogiHand();
    if (!hand) return "";
    const up = hand.color === hand.color.toUpperCase();
    const items = Object.keys(hand.counts).map((k) => {
      const cnt = hand.counts[k] || 0;
      if (!cnt) return "";
      const sel = this._selectedDrop === k;
      return h("button", cls("gb-hand") + (sel ? " sel" : "") + " " + attr("data-hand", k) + " " + attr("type", "button"),
        h("span", cls("piece " + (up ? "red" : "black")), esc(SHOGI_LABEL[k] || k)) + h("em", "", String(cnt)));
    }).join("");
    return h("div", cls("gb-shogi-hand"), h("span", cls("gb-hand-lbl"), "手牌（点击选子再点盘面落子）") + items);
  }

  _renderPromoBar(type) {
    const cands = this._pendingPromo.cands;
    const btns = cands.map((m, i) => {
      const label = type === "chess" ? (CHESS_PROMO_LABEL[m.promo] || m.promo) : (m.promote ? "成" : "不成");
      return h("button", cls("gb-promo-opt") + " " + attr("data-promo", i) + " " + attr("type", "button"), esc(label));
    }).join("");
    return h("div", cls("gb-promo"),
      h("span", cls("gb-promo-lbl"), type === "chess" ? "选择升变棋子" : "是否成子？") + btns +
      h("button", cls("gb-promo-cancel") + " " + attr("data-promo-cancel", "1") + " " + attr("type", "button"), "取消"));
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
    if (type === "chess") bits.push("gb-chs", (r + c) % 2 ? "dark" : "light");
    if (type === "shogi") bits.push("gb-shg", (r + c) % 2 ? "odd" : "even");
    if (selected && selected.r === r && selected.c === c) bits.push("sel");
    if (targets.some((t) => t.r === r && t.c === c)) bits.push("tgt");
    return bits.join(" ");
  }

  _pieceHtml(type, piece, userColor) {
    if (!piece) return "";
    if (type === "gomoku") {
      return h("span", cls(piece === 1 ? "stone black" : "stone white"), "");
    }
    if (type === "chess") {
      const white = piece === piece.toUpperCase();
      return h("span", cls("cpc " + (white ? "white" : "black")), esc(CHESS_PIECE[piece] || piece));
    }
    const up = piece === piece.toUpperCase();
    if (type === "shogi") {
      return h("span", cls("piece " + (up ? "red" : "black")), esc(SHOGI_LABEL[piece] || piece));
    }
    const label = type === "xiangqi" ? (XIANGQI_LABEL[piece] || piece) : (JUNGLE_LABEL[piece] || piece);
    return h("span", cls("piece " + (up ? "red" : "black")), esc(label));
  }

  _renderBoard(data, engine) {
    const type = data.state.type;
    const selected = this._selected;
    const userColor = data.userColor();
    let rows = 15, cols = 15, getPiece = (r, c) => engine.get(r, c);
    if (type === "xiangqi") { rows = 10; cols = 9; getPiece = (r, c) => engine.board[r][c]; }
    if (type === "jungle") { rows = 9; cols = 7; getPiece = (r, c) => engine.board[r][c]; }
    if (type === "chess") { rows = 8; cols = 8; getPiece = (r, c) => engine.board[r][c]; }
    if (type === "shogi") { rows = 9; cols = 9; getPiece = (r, c) => engine.board[r][c]; }
    let targets;
    if (this._selectedDrop && type === "shogi") targets = data.legalDrops(this._selectedDrop);
    else if (selected && type !== "gomoku") targets = data.legalTargets(selected.r, selected.c);
    else targets = [];
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const piece = getPiece(r, c);
        cells.push(h("button",
          cls(this._cellClass(type, r, c, piece, selected, targets)) + " " + attr("type", "button") + " " + attr("data-r", r) + " " + attr("data-c", c),
          this._pieceHtml(type, piece, userColor)
        ));
      }
    }
    return h("div", cls("gb-board gb-" + type) + " " + attr("style", "--cols:" + cols), cells.join(""));
  }

  _bindPlay(data) {
    document.getElementById("gb-back-picker")?.addEventListener("click", () => {
      this._selected = null; this._selectedDrop = null; this._pendingPromo = null;
      data.openPicker();
      this.render();
    });
    document.getElementById("gb-undo")?.addEventListener("click", () => {
      this._selected = null; this._selectedDrop = null; this._pendingPromo = null;
      data.undo();
      this.render();
    });
    document.getElementById("gb-new")?.addEventListener("click", () => {
      this._selected = null; this._selectedDrop = null; this._pendingPromo = null;
      data.newGame(data.state.type, { vsAi: data.state.vsAi, userFirst: data.state.userFirst });
      this.render();
    });
    document.querySelectorAll("[data-hand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-hand");
        this._selected = null;
        this._selectedDrop = this._selectedDrop === k ? null : k;
        this.render();
      });
    });
    document.querySelectorAll("[data-promo]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-promo"));
        const m = this._pendingPromo.cands[idx];
        if (!m) return;
        const { fromR, fromC } = this._pendingPromo;
        const toR = Array.isArray(m) ? m[0] : m.toR;
        const toC = Array.isArray(m) ? m[1] : m.toC;
        const res = data.playUser({ fromR, fromC, toR, toC, promo: m.promo, promote: m.promote });
        this._pendingPromo = null; this._selected = null;
        if (res.ok) this.render();
      });
    });
    document.querySelector("[data-promo-cancel]")?.addEventListener("click", () => {
      this._pendingPromo = null;
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
    if (data.state.thinking || data.winner()) return;
    if (this._pendingPromo) return; // 升变/成桂选择中，忽略盘面
    const type = data.state.type;
    if (type === "gomoku") {
      const res = data.playUser({ r, c });
      if (res.ok) this.render();
      return;
    }
    // 将棋落子模式
    if (this._selectedDrop) {
      const dts = data.legalDrops(this._selectedDrop);
      if (dts.some((t) => t.r === r && t.c === c)) {
        const res = data.playUser({ drop: true, pieceKey: this._selectedDrop, toR: r, toC: c });
        if (res.ok) this._selectedDrop = null;
        this.render();
        return;
      }
    }
    const engine = data.getEngine();
    const piece = engine.board[r][c];
    const userColor = data.userColor();
    const isOwn = isOwnPiece(piece, userColor);
    if (!this._selected) {
      if (!isOwn) return;
      this._selected = { r, c };
      this._selectedDrop = null;
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
      this._selectedDrop = null;
      this.render();
      return;
    }
    const fromR = this._selected.r, fromC = this._selected.c;
    const moves = engine.getLegalMoves(fromR, fromC) || [];
    const cands = moves.filter((m) => {
      const tr = Array.isArray(m) ? m[0] : m.toR;
      const tc = Array.isArray(m) ? m[1] : m.toC;
      return tr === r && tc === c;
    });
    if (!cands.length) { this._selected = null; this.render(); return; }
    if (cands.length === 1) {
      const m = cands[0];
      const res = data.playUser({ fromR, fromC, toR: r, toC: c, promo: m.promo, promote: m.promote });
      if (res.ok) this._selected = null;
      this.render();
      return;
    }
    this._pendingPromo = { fromR, fromC, cands };
    this._selected = null;
    this.render();
  }

  _maybeAi(data) {
    if (this._aiTimer) { clearTimeout(this._aiTimer); this._aiTimer = null; }
    if (!data.state.vsAi || data.winner() || data.isUserTurn() || data.state.thinking) return;
    data.state.thinking = true;
    this._aiTimer = setTimeout(() => {
      data.playAi();
      this._selected = null; this._selectedDrop = null; this._pendingPromo = null;
      this.render();
    }, 280);
  }
}

export default BoardView;