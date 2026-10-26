/* ============================================================
 * config/seat-view-projection.js — [v4.88.0] 按座位投影（谁是卧底）
 * ------------------------------------------------------------
 * 缝合自 SerenQi/rain-go（packages/engine/src/match/match.ts:221-232，MIT）。
 *
 * ── 源在治什么 ──────────────────────────────────────────
 *   源是联机对局：每个 socket 只能收到**自己那份**视图，暗牌（身份词）
 *   绝不出服务端。它用一条 `viewMatch(m, viewer)` 达成 —— token 先被剥离，
 *   再按座位调 `mod.view(state, viewer)`，观战者传 `null` 走观战视图。
 *
 * ── 本仓的处境与源的立场差（必须写明）────────────────────
 *   本仓的谁是卧底（apps/games/undercover）是**单机 AI 局**：全部状态在
 *   本地，`undercover-data.js:204-212` 直接把 `role` + `word` 写死在每个
 *   player 上，视图整体渲染。于是「暗牌不出服务端」这条在本仓**并不成立**——
 *   真实缺陷不是泄密，而是**投影干脆不存在**：
 *     · 结算/投票面板读 `player.role === 'undercover'` 判身份，靠的是
 *       「视图知道全部」，任何一处想「按座位看」都得自己重新判一遍；
 *     · 观战（对局结束后回看）与玩家视角共用同一份渲染，谁该看到什么没有载体。
 *   故本件落的是**投影层本身**（viewer → 视图），并把「token 剥离」保留为
 *   结构约束：投影结果里绝不出现别人的身份词。
 *
 * ── 契约 ────────────────────────────────────────────────
 *   viewer 三种：`{seat:n}`（某个玩家座）/ `{spectator:true}`（观战）/ `null`（同观战）。
 *   投影结果**恒含** `selfSeat / selfWord / selfRole`（观战为 null），
 *   `players[]` 只带公开面（座位、名字、存活、发言），**不带 `word`**；
 *   别人身份只在 `revealed: true`（已出局或对局结束）时出现在 `players[].role`。
 *   这就是源的「暗牌不出服务端」在本仓的等价物：**投影结果里没有别人的词**。
 * ============================================================ */

/** 投影可见性（互不相同、不得塌两态）。 */
export const SEAT_VIEW_MODES = Object.freeze({
    PLAYER: 'player',       // 坐在座位上的人：看得到自己的词
    SPECTATOR: 'spectator'  // 观战 / 对局结束回看：看得到已揭晓的身份
});

/** 归一 viewer。`null`/无座/非数 ⇒ 观战（源传 null 观战同义）。 */
export function normalizeViewer(viewer) {
    const v = viewer || {};
    const seat = Number(v.seat);
    const hasSeat = Number.isInteger(seat) && seat > 0;
    return {
        mode: hasSeat && v.spectator !== true ? SEAT_VIEW_MODES.PLAYER : SEAT_VIEW_MODES.SPECTATOR,
        seat: hasSeat ? seat : null
    };
}

/** 这条玩家行是否该带身份（自己 / 已揭晓 / 观战且已结束）。 */
function shouldReveal(player, norm, game) {
    if (!player) return false;
    if (norm.mode === SEAT_VIEW_MODES.PLAYER && Number(player.seat) === norm.seat) return true;
    if (player.alive === false) return true;              // 出局即翻牌
    if (game.phase === 'ended') return true;              // 结束即全揭
    return false;
}

/**
 * 按座位投影对局。
 *
 * @param {object} game   undercover-data 的 game 快照
 * @param {object|null} viewer {seat} | {spectator:true} | null
 * @returns {{ok:boolean, mode:string, selfSeat:number|null, selfWord:string|null,
 *            selfRole:string|null, phase:string, round:number, currentSpeakerSeat:number|null,
 *            players:Array, wordPairHidden:boolean, reason:string}}
 *   `wordPairHidden` = 词对整体是否已可公开（结束即公开；进行中一律 false ——
 *   词对同时含平民词与卧底词，进行中给出去等于送答案）。
 */
export function projectSeatView(game, viewer) {
    const g = game || {};
    const norm = normalizeViewer(viewer);
    const players = Array.isArray(g.players) ? g.players : [];
    const me = norm.seat !== null ? players.find(p => Number(p.seat) === norm.seat) || null : null;
    const ended = g.phase === 'ended';

    const rows = players.map(p => {
        const reveal = shouldReveal(p, norm, g);
        const row = {
            seat: Number(p.seat),
            name: String(p.name || ''),
            alive: p.alive !== false,
            isSelf: norm.seat !== null && Number(p.seat) === norm.seat,
            avatarPreset: p.avatarPreset ?? null
        };
        // 身份只在应当揭晓时出现；**词只在本人那一行出现**（别人被翻牌也不给词，
        //   因为别人手里那个词正是卧底词/平民词的一半）。
        if (reveal) row.role = String(p.role || '');
        if (norm.mode === SEAT_VIEW_MODES.PLAYER && row.isSelf) {
            row.word = String(p.word || '');
        }
        return row;
    });

    return {
        ok: norm.mode === SEAT_VIEW_MODES.PLAYER ? me !== null : true,
        mode: norm.mode,
        selfSeat: norm.seat,
        selfWord: me ? String(me.word || '') : null,
        selfRole: me ? String(me.role || '') : null,
        phase: String(g.phase || ''),
        round: Math.max(1, Number(g.round || 1)),
        currentSpeakerSeat: g.currentSpeakerSeat === null ? null : Number(g.currentSpeakerSeat || 0) || null,
        players: rows,
        wordPairHidden: !ended,
        reason: norm.mode === SEAT_VIEW_MODES.PLAYER
            ? (me ? '' : '座位上没有人（座位号 ' + norm.seat + '）')
            : (ended ? '' : '观战：词对在结束后公开')
    };
}

/**
 * 投影消息流：只有 `system` 消息与自己的发言一定可见；
 * 别人的发言在**进行中的私有回合**里也只是公开文本（谁是卧底是公开发言局），
 * 故本函数只做一件事 —— 把 `senderSeat` 与 `isSelf` 标出来，不做裁剪。
 * 之所以仍要单独一个函数：调用方需要「这条是谁说的」而不是自己比座位。
 */
export function projectMessage(message, viewer) {
    const m = message || {};
    const norm = normalizeViewer(viewer);
    const seat = Number(m.senderSeat || 0);
    return {
        id: String(m.id || ''),
        senderSeat: seat,
        senderName: String(m.senderName || ''),
        isSelf: norm.seat !== null && seat === norm.seat,
        isSystem: String(m.source || '') === 'system',
        content: String(m.content || ''),
        round: Number(m.round || 0)
    };
}