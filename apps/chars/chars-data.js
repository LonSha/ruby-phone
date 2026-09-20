/* ========================================================
 * chars-data.js — [v2.51.0] 群像 · 角色状态表数据与投影内核（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件把「角色状态表」外供到了只读快照桥
 *   （`lonsha_memory_bridge_v1.snapshot.characters` = { 角色名: { fields, todos, updatedAt, floor } }），
 *   而 RubyPhone 侧实测：**全库零消费**——手机端看不到「当前世界有哪些被追踪的角色、各自什么状态」。
 *   注意：这与「档案」App 互补——档案只投影主角单人（snapshot.protagonist），
 *   群像投影的是除主角外被记忆插件追踪的多角色状态表（好感/情绪/重要度/待办等动态字段）。
 *   那些数据**已经在手边了**，却没有消费点。
 *
 * 【本模块的职责（把 characters 面投影成手机可渲染的东西）】
 *   ① 来源归因 `readCharsFace()`：五态如实分开（见下），不把「桥没装」与「这个世界没有角色」同形；
 *   ② 投影 `projectChars()`：角色卡片列表（字段 + 待办 + 楼层），按活动度打分排序；
 *   ③ 一致性块 `charsPromptBlock()`：把「当前被追踪角色的关键状态」交给生成侧，
 *      让正文里这些角色的状态与记忆插件记的状态是同一套（无内容返回 ''，不产生空块）。
 *
 * 【为什么归因要分五态（本仓反复治理的「静默降级」）】
 *   修前形态：拿不到数据与「这个世界没有角色」长得一模一样。这里把五态显式分开，
 *   让用户知道该去装/去等/去升级。「读不到不一律画成灰」是硬约束。
 *
 *   纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';
/** 归因文案（五态；与 readCharsFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const CHARS_REASONS = Object.freeze({
    'ready': '群像就绪',
    'empty': '这个会话还没有被追踪的角色',
    'no-chars-face': '记忆插件在，但这版快照没有角色状态表（需插件较新版本）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});
/** 默认设置（随会话隔离，键须匹配 /^chars_/） */
export function defaultCharsSettings() {
    return {
        // 是否把「当前被追踪角色状态」交给生成侧（与正文角色状态对齐）
        injectToPrompt: true,
        // 注入块最多几个角色
        maxInject: 5
    };
}
/** 纯文本裁剪（防单条无界） */
function clip(v, max = 40) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}
/** 楼层取值（floor 缺失/非法如实 null，不编 0） */
function floorOf(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
/**
 * 来源归因：把「桥在不在 / 有没有快照 / 有没有角色面 / 空不空」与「就绪」分开报。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, snapshot?:object|null}} probe
 *   由调用方（消费侧）从只读桥取出，本函数不碰 window。
 * @returns {{state:string, reason:string, chars:object|null, text:string}}
 */
export function readCharsFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'absent', reason: 'bridge-absent', chars: null, text: CHARS_REASONS['bridge-absent'] };
    if (!p.mounted) return out;
    if (!p.hasSnapshot) { out.reason = 'no-snapshot'; out.text = CHARS_REASONS['no-snapshot']; return out; }
    const snap = p.snapshot;
    if (!snap || typeof snap !== 'object') { out.reason = 'no-snapshot'; out.text = CHARS_REASONS['no-snapshot']; return out; }
    // 旧版快照没有 `characters` 这一项 ⇒ 「没这面」与「这面是空的」必须分开（升级提示只有前者能给）。
    const chars = snap.characters;
    if (!chars || typeof chars !== 'object' || Array.isArray(chars)) {
        out.reason = 'no-chars-face'; out.text = CHARS_REASONS['no-chars-face']; return out;
    }
    if (!Object.keys(chars).length) {
        out.state = 'empty'; out.reason = 'empty'; out.text = CHARS_REASONS['empty']; out.chars = chars; return out;
    }
    out.state = 'ready'; out.reason = 'ready'; out.text = CHARS_REASONS['ready']; out.chars = chars;
    return out;
}
/**
 * 投影：把角色状态表变成可直接渲染的角色卡片列表。
 * 只读、绝不抛；缺失的字段如实留空（不抛也不编）。
 *
 * 角色条目结构（上游）：{ name, fields: {field: value}, todos: [{text, date}], updatedAt, floor }
 * 其中 fields 是动态字段表（好感/情绪/重要度/有独立目标…），值可为数字/字符串/布尔/null。
 *
 * @param {object} chars readCharsFace().chars
 * @param {{maxRoles?:number}} [opts]
 * @returns {{ok:boolean, state:string, roles:Array, count:number}}
 */
export function projectChars(chars, opts = {}) {
    const out = { ok: false, state: 'absent', roles: [], count: 0 };
    try {
        if (!chars || typeof chars !== 'object' || Array.isArray(chars)) return out;
        const maxRoles = Math.max(1, Number(opts.maxRoles) || 50);
        const roles = [];
        for (const name of Object.keys(chars)) {
            const raw = chars[name];
            const entry = raw && typeof raw === 'object' ? raw : {};
            const fieldsObj = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
            // 字段拍平成 [key, value] 列表，保持上游插入顺序（不重排，不翻译）
            const fields = Object.keys(fieldsObj).map((k) => ({ key: clip(k, 24), value: fieldsObj[k] }));
            // 待办拍平
            const todos = (Array.isArray(entry.todos) ? entry.todos : [])
                .filter((t) => t && typeof t === 'object')
                .map((t) => ({ text: clip(t.text, 40), date: t.date ? clip(t.date, 20) : '' }));
            // 活动度打分：有字段 +1/个（封顶5）、有待办 +2/个（封顶4），用于排序（有内容的角色优先）
            const score = Math.min(fields.length, 5) + Math.min(todos.length * 2, 4);
            roles.push({
                name: clip(name, 30),
                fields,
                todos,
                floor: floorOf(entry.floor),
                updatedAt: floorOf(entry.updatedAt),
                score
            });
        }
        // 排序：活动度降序 → 楼层降序 → 名字稳定序（同活动度的旧角色不抢先）
        roles.sort((a, b) => (b.score - a.score) || ((b.floor ?? -1) - (a.floor ?? -1)) || a.name.localeCompare(b.name));
        out.roles = roles.slice(0, maxRoles);
        out.count = roles.length;
        out.ok = true;
        out.state = roles.length ? 'ready' : 'empty';
        return out;
    } catch (_e) { return out; }
}
/** 字段值可读化：数字原样、布尔转开/关、其余纯文本裁剪；null 显示「未记」 */
function fmtFieldVal(v) {
    if (v === null || v === undefined) return '未记';
    if (typeof v === 'boolean') return v ? '开' : '关';
    if (typeof v === 'number') return String(v);
    return clip(v, 32);
}
/**
 * 一致性块：把「当前被追踪角色的关键状态」交给生成侧，
 * 让正文里这些角色的状态与记忆插件记的状态**是同一套**（无内容返回 ''，不产生空块）。
 * @param {object} chars
 * @param {{maxRoles?:number}} [opts]
 */
export function charsPromptBlock(chars, opts = {}) {
    try {
        const maxRoles = Math.max(1, Number(opts.maxRoles) || 5);
        if (!chars || typeof chars !== 'object' || Array.isArray(chars)) return '';
        const proj = projectChars(chars, { maxRoles });
        if (!proj.roles.length) return '';
        const lines = [];
        for (const r of proj.roles.slice(0, maxRoles)) {
            let line = '- ' + r.name;
            if (r.fields.length) {
                line += '（' + r.fields.slice(0, 4).map((f) => f.key + ':' + fmtFieldVal(f.value)).join('，') + '）';
            }
            if (r.todos.length) {
                line += ' 待办:' + r.todos.slice(0, 2).map((t) => t.text).join('、');
            }
            lines.push(line);
        }
        if (!lines.length) return '';
        return '【本世界被记忆插件追踪的角色状态（正文里这些角色的状态不得与之矛盾）】\n' + lines.join('\n');
    } catch (_e) { return ''; }
}
