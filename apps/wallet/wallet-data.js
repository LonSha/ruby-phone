/* ========================================================
 * wallet-data.js — [v2.49.0] 钱袋 · 钱账数据与投影内核（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件把「金钱账」外供到了只读快照桥
 *   （`lonsha_memory_bridge_v1.snapshot.moneyLedger` = { money, moneyLog }），
 *   而 RubyPhone 侧实测：**全库零消费**——手机端看不到「现在有多少钱」「最近怎么花的」。
 *   后果是本仓最典型的欠债形态：上游把面做出来了，下游一个消费点都没有，
 *   于是「主角钱包还剩多少」「这笔钱是哪一楼记的」在手机上全部答不出——
 *   而这些数据**已经在手边了**。
 *
 * 【本模块的职责（把 moneyLedger 面投影成手机可渲染的东西）】
 *   ① 来源归因 `readWalletFace()`：五态如实分开（见下），不把「桥没装」与「这个世界没钱」同形；
 *   ② 投影 `projectWallet()`：账户余额 / 流水（最新在前）两块可读数据；
 *   ③ 一致性块 `walletPromptBlock()`：把「当前账上金额」交给生成侧，
 *      让正文里的钱数与记忆插件记的账是同一笔（而不是各写各的）。
 *
 * 【为什么归因要分五态（本仓反复治理的「静默降级」）】
 *   修前形态：拿不到数据与「这个世界没钱」长得一模一样，调用方只能一律当「没数据」，
 *   于是「桥没装」「桥装了但还没产出快照」「快照是旧版没有账面」三种完全不同的处境
 *   在界面上同形。这里把五态显式分开，让用户知道该去装/去等/去升级。
 *
 *   纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';
/** 归因文案（五态；与 readWalletFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const WALLET_REASONS = Object.freeze({
    'ready': '钱账就绪',
    'empty': '这个会话还没有记过任何账',
    'no-ledger-face': '记忆插件在，但这版快照没有金钱账面（需插件较新版本）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});
/** 默认设置（随会话隔离，键须匹配 /^wallet_/） */
export function defaultWalletSettings() {
    return {
        // 是否把「当前账上金额」交给生成侧（与正文钱数对齐）
        injectToPrompt: true,
        // 注入块最多几行账户
        maxInject: 6
    };
}
/** 取数（不抛；非数值如实 null，不编 0） */
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
/** 纯文本裁剪（防单条无界） */
function clip(v, max = 60) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}
/**
 * 来源归因：把「桥在不在 / 有没有快照 / 有没有账面 / 空不空」四种处境与「就绪」分开报。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, snapshot?:object|null}} probe
 *   由调用方（消费侧）从只读桥取出，本函数不碰 window。
 * @returns {{state:string, reason:string, ledger:object|null, text:string}}
 *   state ∈ { absent, empty, ready }（粗态）
 *   reason ∈ WALLET_REASONS 的五个键（细态；粗态不得替代细态）
 */
export function readWalletFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'absent', reason: 'bridge-absent', ledger: null, text: WALLET_REASONS['bridge-absent'] };
    if (!p.mounted) return out;
    if (!p.hasSnapshot) { out.reason = 'no-snapshot'; out.text = WALLET_REASONS['no-snapshot']; return out; }
    const snap = p.snapshot;
    if (!snap || typeof snap !== 'object') { out.reason = 'no-snapshot'; out.text = WALLET_REASONS['no-snapshot']; return out; }
    // 旧版快照没有 `moneyLedger` 这一项 ⇒ 「没这面」与「这面是空的」必须分开（升级提示只有前者能给）。
    const ledger = snap.moneyLedger;
    if (!ledger || typeof ledger !== 'object') {
        out.reason = 'no-ledger-face'; out.text = WALLET_REASONS['no-ledger-face']; return out;
    }
    const accounts = ledger.money && typeof ledger.money === 'object' ? ledger.money : {};
    const log = Array.isArray(ledger.moneyLog) ? ledger.moneyLog : [];
    if (!Object.keys(accounts).length && !log.length) {
        out.state = 'empty'; out.reason = 'empty'; out.text = WALLET_REASONS['empty']; out.ledger = ledger; return out;
    }
    out.state = 'ready'; out.reason = 'ready'; out.text = WALLET_REASONS['ready']; out.ledger = ledger;
    return out;
}
/** 流水时间可读化：有 timestamp 用日期，否则只报楼层（不编时间） */
function whenOf(item) {
    const ts = num(item && item.timestamp);
    const fl = num(item && item.floor);
    const parts = [];
    if (ts !== null) {
        try {
            const d = new Date(ts);
            if (!Number.isNaN(d.getTime())) parts.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        } catch (_e) { /* 非法时间戳：不编 */ }
    }
    if (fl !== null) parts.push('第' + fl + '楼');
    return parts.join(' · ');
}
/**
 * 投影：把账面变成可直接渲染的两块数据。
 * 只读、绝不抛；缺失的块如实置空（不抛也不编）。
 *
 * @param {object} ledger readWalletFace().ledger
 * @param {{maxEntries?:number}} [opts]
 * @returns {{ok:boolean, accounts:Array, tx:Array, count:number, txCount:number, state:string}}
 */
export function projectWallet(ledger, opts = {}) {
    const out = { ok: false, state: 'absent', accounts: [], tx: [], count: 0, txCount: 0 };
    try {
        if (!ledger || typeof ledger !== 'object') return out;
        const maxEntries = Math.max(1, Number(opts.maxEntries) || 40);
        const accounts = ledger.money && typeof ledger.money === 'object' ? ledger.money : {};
        out.accounts = Object.keys(accounts).map((k) => {
            const a = accounts[k] && typeof accounts[k] === 'object' ? accounts[k] : {};
            return { key: clip(k, 60), name: clip(a.name) || clip(k, 20), amount: num(a.amount), floor: num(a.floor) };
        }).sort((a, b) => (b.amount === null ? -1 : b.amount) - (a.amount === null ? -1 : a.amount) || a.key.localeCompare(b.key));
        out.txCount = Array.isArray(ledger.moneyLog) ? ledger.moneyLog.length : 0;
        out.tx = (Array.isArray(ledger.moneyLog) ? ledger.moneyLog : [])
            .filter((x) => x && typeof x === 'object')
            .slice(-maxEntries)
            .reverse()
            .map((x) => ({
                name: clip(x.name) || clip(x.key, 20), desc: clip(x.desc, 48),
                delta: num(x.delta), time: whenOf(x), floor: num(x.floor)
            }));
        out.count = out.accounts.length;
        out.ok = true;
        out.state = out.accounts.length || out.txCount ? 'ready' : 'empty';
        return out;
    } catch (_e) { return out; }
}
/**
 * 一致性块：把「当前账上金额与最近流水」交给生成侧，
 * 让正文里的钱数与记忆插件记的账**是同一笔**（无内容返回 ''，不产生空块）。
 * @param {object} ledger
 * @param {{maxLines?:number}} [opts]
 */
export function walletPromptBlock(ledger, opts = {}) {
    try {
        const maxLines = Math.max(1, Number(opts.maxLines) || 6);
        if (!ledger || typeof ledger !== 'object') return '';
        const proj = projectWallet(ledger, { maxEntries: 6 });
        if (!proj.accounts.length && !proj.tx.length) return '';
        const lines = [];
        for (const a of proj.accounts.slice(0, maxLines)) {
            lines.push('- ' + (a.name || a.key) + '：' + (a.amount === null ? '金额未记' : a.amount + ' 元')
                + (a.floor !== null ? '（第' + a.floor + '楼记账）' : ''));
        }
        const last = proj.tx.slice(0, 3);
        for (const t of last) {
            lines.push('- 最近一笔：' + t.name + (t.desc ? ' · ' + t.desc : '') + ' ' + (t.delta === null ? '' : (t.delta >= 0 ? '+' : '') + t.delta + ' 元')
                + (t.time ? '（' + t.time + '）' : ''));
        }
        if (!lines.length) return '';
        return '【本世界的钱账（记忆插件金钱账，正文金额不得与之矛盾）】\n' + lines.slice(0, maxLines + 3).join('\n');
    } catch (_e) { return ''; }
}
