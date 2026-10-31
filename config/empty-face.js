/* ========================================================
 * config/empty-face.js — [v4.108.0 · 第十三期 R13-O6] 空态的四种处境
 * --------------------------------------------------------
 * 【它要治的缺陷：三种处境长得一模一样】
 *   全仓 543 处空态文案、147 处 loading，但「真的没有」「有但被挡住」「取数面不在来了」
 *   这三种处境共用同一句话。于是用户看到「还没有照片」时无法判断：
 *     · 该去拍一张（真的空）；
 *     · 该去清筛选条件（有，被挡住了）；
 *     · 该去看诊断页（存储读不到，不是没数据）。
 *   三种处置**相反**，界面却给同一句话 —— 这就是本仓最贵的老账。
 *
 * 【四态（固定词表，不许自创第五个）】
 *   ok      有内容（不渲染空态）
 *   empty   真的没有（如实说明，不要建引导按钮）
 *   blocked 有，但被挡住了（筛选 / 权限 / 未解锁）⇒ 处置是「去解开」
 *   absent  取数面本身不在（模块没接 / 存储读失败）⇒ 处置是「报告/诊断」
 *
 * 【为什么四种必须不同形】
 *   光「都有文案」没用。判据必须能区分「四句话不同」而不是「都非空」——
 *   否则把 blocked 文案复制成 empty 的，判据依然绿。
 *
 * 依赖：零 import（叶子，谁都可引用）。
 * ======================================================== */
'use strict';

/** 四态闭集（键值同名，便于属性直写）。 */
export const FACE = Object.freeze({
    ok: 'ok',
    empty: 'empty',
    blocked: 'blocked',
    absent: 'absent'
});

/** 非 ok 的三态（渲染空态时才用得上）。 */
export const NOT_OK = Object.freeze(['empty', 'blocked', 'absent']);

/** 属性名：非 ok 态必须带它，值取自 FACE。 */
export const FACE_ATTR = 'data-face-why';

/**
 * reason code 词表（比四态更细，用于「为什么挡/为什么不在」）。
 * 与记忆侧 L13-O3 同词表精神，各仓各实现（不共享代码，共享语义）。
 */
export const FACE_REASON = Object.freeze({
    'no-data': '真的没有内容',
    'filtered-out': '被筛选条件挡住了',
    'no-permission': '没有权限或未订阅',
    'locked': '需要解锁/前置条件未满足',
    'not-mounted': '对应模块未接入',
    'read-failed': '存储读取失败',
    'not-ready': '还在加载或未初始化'
});

/** reason code → 所属四态（未登记一律归 absent，不猜 empty）。 */
export const REASON_FACE = Object.freeze({
    'no-data': 'empty',
    'filtered-out': 'blocked',
    'no-permission': 'blocked',
    'locked': 'blocked',
    'not-mounted': 'absent',
    'read-failed': 'absent',
    'not-ready': 'absent'
});

/** 四态的人话标题（互不相同，判据会逐字比对）。 */
export const FACE_TEXT = Object.freeze({
    ok: '有内容',
    empty: '还没有内容',
    blocked: '被挡住了',
    absent: '这会儿打不开'
});

/** 某一态是否属于闭集。 */
export function isFace(v) {
    return Object.prototype.hasOwnProperty.call(FACE, String(v == null ? '' : v));
}

/** reason code 归一：未登记 ⇒ null（不猜）。 */
export function reasonOf(code) {
    const c = String(code == null ? '' : code).trim();
    return Object.prototype.hasOwnProperty.call(REASON_FACE, c) ? c : null;
}

/** reason code 对应的四态（未登记 ⇒ absent：宁可报「打不开」也不冒充「真的没有」）。 */
export function faceOfReason(code) {
    const c = reasonOf(code);
    return c === null ? FACE.absent : REASON_FACE[c];
}

/**
 * 把「取数结果」归一成四态。
 *
 * 输入形状（约定，避免每个 app 各写一套判断）：
 *   { items?, error?, filtered?, permission?, mounted?, ready? }
 * 判定顺序**有讲究**：先取数面在不在 → 再权限 → 再筛选 → 最后才是空。
 *   反过来的话，一个「存储读失败」会被读成「真的没有」，退回本模块要消灭的毛病。
 *
 * @returns {{face:string, code:string}}
 */
export function faceOf(input) {
    const o = input || {};
    if (o.mounted === false) return { face: 'absent', code: 'not-mounted' };
    if (o.error) return { face: 'absent', code: 'read-failed' };
    if (o.ready === false) return { face: 'absent', code: 'not-ready' };
    if (o.permission === false) return { face: 'blocked', code: 'no-permission' };
    if (o.locked === true) return { face: 'blocked', code: 'locked' };
    const n = Array.isArray(o.items) ? o.items.length : (Number.isFinite(o.count) ? o.count : 0);
    /* `filtered` 只在「确实有内容、只是被滤掉」时才算 blocked。
     *   为什么要把这个判断放在模块里而不是信任调用方：列表本来就空时如果还报「被筛掉了」，
     *   用户去清筛选（清完还是空）—— 这是把人往错的方向支走，比不提示更糟。 */
    if (o.filtered === true && n > 0) return { face: 'blocked', code: 'filtered-out' };
    if (n > 0) return { face: 'ok', code: 'has-data' };
    return { face: 'empty', code: 'no-data' };
}

/**
 * 渲染一段空态 HTML（四态互不相同）。
 *
 * 为什么统一在这里拼：文案与属性必须同步出现，分开写就会出现「改了文案忘了属性」。
 *
 * @param {string} face 四态之一
 * @param {{code?:string, text?:string}} [o]
 * @returns {string} 空 HTML 串表示「不该渲染」
 */
export function faceHtml(face, o) {
    const f = isFace(face) ? String(face) : 'absent';
    if (f === 'ok') return '';
    const opts = o || {};
    const code = reasonOf(opts.code) || (f === 'empty' ? 'no-data' : (f === 'blocked' ? 'filtered-out' : 'read-failed'));
    /* 属性与文案一起给：属性给机器（判据/诊断），文案给人。 */
    const text = String(opts.text || FACE_TEXT[f]);
    return '<div class="empty-face" ' + FACE_ATTR + '="' + code + '" data-face="' + f + '">' + text + '</div>';
}

export default {
    FACE,
    NOT_OK,
    FACE_ATTR,
    FACE_REASON,
    REASON_FACE,
    FACE_TEXT,
    isFace,
    reasonOf,
    faceOfReason,
    faceOf,
    faceHtml
};
