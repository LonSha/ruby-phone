/* ========================================================
 * profile-data.js — [v2.49.0] 档案 · 主角档案与生活小档案数据与投影内核（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件把「主角档案」（`snapshot.protagonist`）与「生活小档案」
 *   （`snapshot.lifeDetails`）外供到了只读快照桥，而 RubyPhone 侧实测：**全库零消费**。
 *   后果：手机端看不到「主角现在多大、什么身份」「生活里有哪些持续的小细节」，
 *   而这些数据**已经在手边了**。
 *
 * 【本模块的职责（把两个面投影成手机可渲染的东西）】
 *   ① 来源归因 `readProfileFace()`：五态如实分开，不把「桥没装」与「这个会话没档案」同形；
 *   ② 投影 `projectProfile()`：主角字段 / 生活小档案（分层 pinned/active/archive）两块可读数据；
 *   ③ 一致性块 `profilePromptBlock()`：把「主角当前档案与生活细节」交给生成侧，
 *      让正文里的主角与记忆插件记的主角是同一个（而不是各写各的）。
 *
 * 【为什么归因要分五态（本仓反复治理的「静默降级」）】
 *   与 wallet 同规格：「桥没装」「桥装了但还没产出快照」「快照是旧版没有档案面」
 *   三种完全不同的处境在界面上必须同形分开，让用户知道该去装/去等/去升级。
 *
 *   纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';
import { faceFieldState } from '../../config/world-bridge.js';
/** 归因文案（五态；与 readProfileFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const PROFILE_REASONS = Object.freeze({
    'ready': '档案就绪',
    'empty': '这个会话还没有主角档案',
    'no-profile-face': '记忆插件在，但这版快照没有档案面（需插件较新版本）',
    'upstream-empty': '记忆插件已声明档案面为空（不是没这面，是这次没内容）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});
/** 生活小档案的分层文案（tier 未知时如实显示原值，不吞） */
export const TIER_TEXT = Object.freeze({
    'pinned': '常驻',
    'active': '进行中',
    'archive': '已归档'
});
/** 默认设置（随会话隔离，键须匹配 /^profile_/） */
export function defaultProfileSettings() {
    return {
        // 是否把「主角档案 + 生活细节」交给生成侧（与正文主角对齐）
        injectToPrompt: true,
        // 注入块最多几行生活细节
        maxInject: 8
    };
}
/** 取数（不抛；非数值如实 null，不编 0） */
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
/** 纯文本裁剪（防单条无界） */
function clip(v, max = 120) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}
/**
 * 来源归因：把「桥在不在 / 有没有快照 / 有没有档案面 / 空不空」四种处境与「就绪」分开报。
 * 「档案面」= protagonist 与 lifeDetails 至少有一项为对象/数组。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, snapshot?:object|null}} probe
 *   由调用方（消费侧）从只读桥取出，本函数不碰 window。
 * @returns {{state:string, reason:string, protagonist:object|null, lifeDetails:Array, text:string}}
 *   state ∈ { absent, empty, ready }（粗态）
 *   reason ∈ PROFILE_REASONS 的五个键（细态；粗态不得替代细态）
 */
export function readProfileFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'absent', reason: 'bridge-absent', protagonist: null, lifeDetails: [], text: PROFILE_REASONS['bridge-absent'] };
    if (!p.mounted) return out;
    if (!p.hasSnapshot) { out.reason = 'no-snapshot'; out.text = PROFILE_REASONS['no-snapshot']; return out; }
    const snap = p.snapshot;
    if (!snap || typeof snap !== 'object') { out.reason = 'no-snapshot'; out.text = PROFILE_REASONS['no-snapshot']; return out; }
    const protagonist = (snap.protagonist && typeof snap.protagonist === 'object') ? snap.protagonist : null;
    const lifeDetails = Array.isArray(snap.lifeDetails) ? snap.lifeDetails : (snap.lifeDetails && typeof snap.lifeDetails === 'object' ? [snap.lifeDetails] : []);
    // 「档案面」存在 = protagonist 为对象 或 lifeDetails 为数组（旧版快照两项皆无 ⇒ 没这面）
    const hasFace = !!(protagonist || Array.isArray(snap.lifeDetails));
    if (!hasFace) {
        out.protagonist = protagonist; out.lifeDetails = lifeDetails;
        // [v2.98.0] 「没给这面」与「给了、就是空」必須分开：上游 v3.174 在
        //   snapshot.meta.fieldTypes 里如实声明了每个字段的在场。此前一律当「没这面」
        //   并提示用户升级插件——对「声明了、就是空」是错误归因。判定只此一份。
        if (faceFieldState(snap, ['protagonist', 'lifeDetails']) === 'declared-empty') {
            out.state = 'empty'; out.reason = 'upstream-empty'; out.text = PROFILE_REASONS['upstream-empty'];
            return out;
        }
        out.reason = 'no-profile-face'; out.text = PROFILE_REASONS['no-profile-face'];
        return out;
    }
    // 面在但无内容：protagonist 空对象/缺失 且 lifeDetails 空 ⇒ 「这个会话没档案」（与「没这面」分开）
    const hasContent = !!(protagonist && Object.keys(protagonist).length) || lifeDetails.length;
    if (!hasContent) {
        out.state = 'empty'; out.reason = 'empty'; out.text = PROFILE_REASONS['empty'];
        out.protagonist = protagonist; out.lifeDetails = lifeDetails;
        return out;
    }
    out.state = 'ready'; out.reason = 'ready'; out.text = PROFILE_REASONS['ready'];
    out.protagonist = protagonist; out.lifeDetails = lifeDetails;
    return out;
}
/**
 * 主角字段投影：把对象拍平成可读的「字段: 值」行（只取字符串/数值字段，不展开嵌套对象）。
 * 键名原样保留（上游字段名即事实源），不翻译不猜测。
 * @param {object|null} protagonist
 * @returns {Array<{key:string, value:string}>}
 */
export function protagonistFields(protagonist) {
    const out = [];
    try {
        if (!protagonist || typeof protagonist !== 'object') return out;
        for (const [k, v] of Object.entries(protagonist)) {
            if (v === null || v === undefined || v === '') continue;
            if (typeof v === 'object') continue; // 嵌套结构不展开：宁可少显示，不编
            out.push({ key: clip(k, 40), value: clip(v, 200) });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 生活小档案投影：按 tier 分三层，层内保持原序（上游顺序即叙事顺序，不重排）。
 * 只读、绝不抛；缺失字段如实置空。
 * @param {Array} lifeDetails
 * @returns {{pinned:Array, active:Array, archive:Array, total:number}}
 */
export function lifeDetailsGroups(lifeDetails) {
    const out = { pinned: [], active: [], archive: [], total: 0 };
    try {
        const list = Array.isArray(lifeDetails) ? lifeDetails : [];
        out.total = list.length;
        for (const d of list) {
            if (!d || typeof d !== 'object') continue;
            const tier = typeof d.tier === 'string' && TIER_TEXT[d.tier] ? d.tier : 'active';
            out[tier].push({
                text: clip(d.text, 240),
                topics: (Array.isArray(d.topics) ? d.topics : []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 6),
                until: d.until !== null && d.until !== undefined ? String(d.until) : null
            });
        }
        return out;
    } catch (_e) { return out; }
}
/**
 * 一致性块：把「主角档案 + 生活细节」交给生成侧，
 * 让正文里的主角与记忆插件记的主角**是同一个**（无内容返回 ''，不产生空块）。
 * @param {{protagonist?:object|null, lifeDetails?:Array}} face
 * @param {{maxLines?:number}} [opts]
 */
export function profilePromptBlock(face, opts = {}) {
    try {
        const maxLines = Math.max(1, Number(opts.maxLines) || 8);
        if (!face || typeof face !== 'object') return '';
        const fields = protagonistFields(face.protagonist);
        const groups = lifeDetailsGroups(face.lifeDetails);
        const lines = [];
        if (fields.length) {
            lines.push('- 主角档案：' + fields.slice(0, 8).map((f) => f.key + ' ' + f.value).join('；'));
        }
        const life = [...groups.pinned, ...groups.active];
        for (const d of life.slice(0, maxLines)) {
            lines.push('- ' + d.text + (d.topics.length ? '（' + d.topics.join('、') + '）' : ''));
        }
        if (groups.archive.length) {
            lines.push('- 已归档 ' + groups.archive.length + ' 条（不再作为当前设定）');
        }
        if (!lines.length) return '';
        return '【本世界主角的档案与生活细节（记忆插件档案面，正文不得与之矛盾）】\n' + lines.slice(0, maxLines + 3).join('\n');
    } catch (_e) { return ''; }
}
