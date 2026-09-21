/* ========================================================
 * memory-insights.js — [v2.57.0] 记忆洞察层（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   记忆 App 的引擎侧能力远比界面厚：
 *     · `MemoryPool.getSensoryArchive()` —— 按五感归档全部感知记忆（已按权重排序）
 *     · `MemoryPool.getSceneTags()`      —— 按地点聚合感知/空间记忆
 *     · `recall-filter.lifecycleStage()` —— active / cooling / frozen / tombstone 四段生命周期
 *     · `supersede-engine`               —— 换代压制（旧事实被新事实顶掉，可逆复活）
 *     · `decorateRecall()`               —— 回忆权限三级（可引用 / 需谨慎 / 仅联想）
 *   而 `memory-view.js`（136 行）实测只用到了引擎的 **四个计数** 与一个时间线列表。
 *   全仓 grep `getSensoryArchive` / `getSceneTags` —— **产品代码零命中**。
 *   后果：手机里最核心的那个 App（记忆）是**最薄的一个面**——
 *     「我最近闻到过的味道」「哪个场景攒的记忆最多」「有多少条已经冻住了」
 *     「哪条旧事被新事顶掉了」在界面上全部答不出，而数据**已经在内存里了**。
 *
 * 【本模块的职责（把引擎读数投影成可渲染的东西）】
 *   ① 五感归档 `senseRows()`：把归档读成有序、可裁剪的行（空感维不出现）；
 *   ② 场景聚合 `sceneRows()`：按地点聚成「一室一室」的记忆，附感官分布；
 *   ③ 生命周期分布 `lifecycleRows()`：四段计数 + 每个阶段最久未动的几条；
 *   ④ 换代对读 `supersedePairs()`：旧事实 ↔ 顶掉它的新事实（可逆，所以必须能看见）；
 *   ⑤ 情感轨迹 `emotionTrace()`：按天分桶的情绪强度均值（新算，引擎里没有）；
 *   ⑥ 记忆体检 `auditMemory()`：分级 + 问题清单 + 可执行建议（新算）。
 *
 * 【三条纪律（与 place-data.js / profile-data.js 同规格）】
 *   ① 纯函数：不碰 window、不读 storage、不写任何状态；时间由参数注入，保证可测；
 *   ② 不抛：任何畸形输入一律降级为空读数，绝不把一次渲染变成一次崩溃；
 *   ③ 不猜：算不出就是 0 / 空数组，绝不编一个好看的数顶替。
 *
 * 【为什么体检只读 `lifecycleStage` 而不调 `pruneByLifecycle`】
 *   `pruneByLifecycle()` 会把超期非保护条目**墓碑化**（清空正文）——它是「巩固管线」的一步，
 *   有真实副作用。界面渲染**绝不能**触发它：用户只是打开记忆 App 看一眼，
 *   不该因此把记忆永久清空。故本模块只调纯读的 `lifecycleStage()`。
 *   这是本仓反复治理过的形态：**「看一眼」与「改一把」必须走不同的函数**。
 * ======================================================== */
'use strict';
import { lifecycleStage, LIFECYCLE } from '../../config/recall-filter.js';
import { SUPERSEDE_STATUS } from '../../config/supersede-engine.js';

/** 五感展示元数据（键必须与 memory-pool.SENSE_HINTS 逐字一致，缺键即该感维不显示） */
export const SENSE_META = Object.freeze({
    smell: { label: '嗅觉', icon: '👃', color: '#a78bfa' },
    touch: { label: '触觉', icon: '✋', color: '#f472b6' },
    sight: { label: '视觉', icon: '👁️', color: '#38bdf8' },
    sound: { label: '听觉', icon: '👂', color: '#34d399' },
    taste: { label: '味觉', icon: '👅', color: '#fbbf24' }
});
/** 生命周期四段展示元数据（三态以上必须各有字样，不得两态同形） */
export const LIFECYCLE_META = Object.freeze({
    active: { label: '活跃', color: '#10b981', hint: '正常参与注入与召回' },
    cooling: { label: '降温', color: '#f59e0b', hint: '超过 14 天未触碰，注入优先级已降' },
    frozen: { label: '冻结', color: '#60a5fa', hint: '超过 30 天未触碰，可检索但不再注入' },
    tombstone: { label: '墓碑', color: '#9ca3af', hint: '超过 90 天且未受保护，正文已清空' }
});
/** 体检等级（四档，各有字样与色；bad 与 warn 不得同形） */
export const AUDIT_GRADE = Object.freeze({
    ok: { label: '状况良好', color: '#10b981' },
    warn: { label: '有待照看', color: '#f59e0b' },
    bad: { label: '需要整理', color: '#ef4444' },
    empty: { label: '尚无沉淀', color: '#9ca3af' }
});

/** 取数：非有限数如实返回 null（不编 0 —— 0 是一个读数，null 是「没有读数」） */
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
/** 纯文本裁剪（防单条无界撑爆界面） */
function clip(v, max = 120) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}
/** 时间戳容错解析（坏值返回 null，不返回 0 = 1970） */
function ts(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
}

/* ---------------- ① 五感归档 ---------------- */
/**
 * 把 `pool.getSensoryArchive()` 的 { smell:[...], touch:[...], ... } 投影成有序行。
 * 空感维**不产出该行**（不占位、不显示 0 —— 零计数没有信息量，只会稀释注意力）。
 *
 * @param {object} archive getSensoryArchive() 的返回
 * @param {{perSense?:number, now?:number}} [opts]
 * @returns {Array<{sense:string,label:string,icon:string,color:string,count:number,
 *                  items:Array<{content:string,weight:number,age:string}>}>}
 */
export function senseRows(archive, opts = {}) {
    const out = [];
    const perSense = Math.max(1, Math.min(20, Number(opts.perSense) || 4));
    const now = num(opts.now) || Date.now();
    try {
        const src = archive && typeof archive === 'object' ? archive : {};
        for (const sense of Object.keys(SENSE_META)) {
            const arr = Array.isArray(src[sense]) ? src[sense] : [];
            if (!arr.length) continue;
            const meta = SENSE_META[sense];
            const items = arr.slice(0, perSense).map((it) => {
                const created = ts(it && it.createdAt);
                const days = created === null ? null : Math.floor((now - created) / 86400000);
                return {
                    content: clip(it && it.content, 90),
                    weight: num(it && it.weights && it.weights[sense]) || num(it && it.senses && it.senses[sense]) || 0,
                    age: days === null ? '' : (days <= 0 ? '今天' : days + ' 天前')
                };
            });
            out.push({ sense, label: meta.label, icon: meta.icon, color: meta.color, count: arr.length, items });
        }
        // 按条数降序：哪个感官攒得多，一眼可见
        out.sort((a, b) => b.count - a.count);
    } catch (_e) { return []; }
    return out;
}

/* ---------------- ② 场景聚合 ---------------- */
/**
 * 把 `pool.getSceneTags()` 的 [{place, items, senses}] 投影成可渲染的场景行。
 * 未登记地点的条目归到「未标注地点」，**不丢**（丢了会让总数对不上，用户会以为少了数据）。
 *
 * @returns {Array<{place:string,count:number,senses:Array<{sense:string,label:string,icon:string,color:string,count:number}>,samples:string[]}>}
 */
export function sceneRows(scenes, opts = {}) {
    const out = [];
    const perScene = Math.max(1, Math.min(10, Number(opts.perScene) || 2));
    try {
        const list = Array.isArray(scenes) ? scenes : [];
        for (const s of list) {
            if (!s || typeof s !== 'object') continue;
            const items = Array.isArray(s.items) ? s.items : [];
            if (!items.length) continue;
            const senseMap = (s.senses && typeof s.senses === 'object') ? s.senses : {};
            const senses = Object.keys(SENSE_META)
                .map((k) => ({ sense: k, label: SENSE_META[k].label, icon: SENSE_META[k].icon, color: SENSE_META[k].color, count: num(senseMap[k]) || 0 }))
                .filter((x) => x.count > 0)
                .sort((a, b) => b.count - a.count);
            out.push({
                place: clip(s.place, 40) || '未标注地点',
                count: items.length,
                senses,
                samples: items.slice(0, perScene).map((it) => clip(it && it.content, 70)).filter(Boolean)
            });
        }
        out.sort((a, b) => b.count - a.count);
    } catch (_e) { return []; }
    return out;
}

/* ---------------- ③ 生命周期分布 ---------------- */
/**
 * 四段生命周期分布（只读 `lifecycleStage()`，绝不调会墓碑化的 `pruneByLifecycle()`）。
 *
 * @param {Array} memories 长期记忆
 * @param {{now?:number, perStage?:number}} [opts]
 * @returns {{rows:Array<{stage,label,color,hint,count,stale:Array<{content,days}>}>,total:number,protectedCount:number}}
 */
export function lifecycleRows(memories, opts = {}) {
    const empty = { rows: [], total: 0, protectedCount: 0 };
    try {
        const list = Array.isArray(memories) ? memories : [];
        if (!list.length) return empty;
        const now = num(opts.now) || Date.now();
        const perStage = Math.max(0, Math.min(10, Number(opts.perStage) || 3));
        const buckets = { active: [], cooling: [], frozen: [], tombstone: [] };
        let protectedCount = 0;
        for (const m of list) {
            if (!m) continue;
            const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
            // 受保护判定与 recall-filter 同口径（pinned / permanent / 剧情回填 / 用户收藏）
            const isProtected = !!(meta.pinned || meta.pinnedBy || meta.permanent || meta.type === 'permanent'
                || (typeof m.content === 'string' && m.content.startsWith('[剧情]')));
            if (isProtected) protectedCount++;
            let stage;
            try { stage = lifecycleStage(m, now); } catch (_e) { stage = LIFECYCLE.ACTIVE; }
            if (!buckets[stage]) stage = LIFECYCLE.ACTIVE;
            const lastActive = ts(meta.lastActive) ?? ts(m.createdAt) ?? now;
            const days = Math.max(0, Math.floor((now - lastActive) / 86400000));
            buckets[stage].push({ content: clip(m.content, 80), days, protected: isProtected });
        }
        const rows = [];
        for (const stage of ['active', 'cooling', 'frozen', 'tombstone']) {
            const arr = buckets[stage];
            if (!arr.length) continue;
            const meta = LIFECYCLE_META[stage] || { label: stage, color: '#9ca3af', hint: '' };
            arr.sort((a, b) => b.days - a.days);   // 最久未动的排前：那才是「该看看」的
            rows.push({
                stage,
                label: meta.label,
                color: meta.color,
                hint: meta.hint,
                count: arr.length,
                stale: arr.slice(0, perStage).filter((x) => x.content)
            });
        }
        return { rows, total: list.length, protectedCount };
    } catch (_e) { return empty; }
}

/* ---------------- ④ 换代对读 ---------------- */
/**
 * 换代（supersede）对读：列出被顶掉的旧事实与顶掉它的新事实。
 * 换代是**可逆**的（旧条目正文永不删除），所以「能看见 + 知道被谁顶了」是它的必要界面；
 * 否则用户只会看到「记忆变少了」而不知道去哪找回。
 *
 * @returns {Array<{oldId:string,oldText:string,heldDays:number|null,byId:string|null,byText:string,byMissing:boolean}>}
 */
export function supersedePairs(memories, opts = {}) {
    const out = [];
    try {
        const list = Array.isArray(memories) ? memories : [];
        if (!list.length) return out;
        const limit = Math.max(1, Math.min(30, Number(opts.limit) || 10));
        const now = num(opts.now) || Date.now();
        const byId = new Map();
        for (const m of list) if (m && m.id) byId.set(m.id, m);
        for (const m of list) {
            if (!m) continue;
            const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
            if (meta._superseded !== SUPERSEDE_STATUS.SUPERSEDED) continue;
            const at = ts(meta.supersededAt);
            const holder = meta.supersededBy ? byId.get(meta.supersededBy) : null;
            out.push({
                oldId: String(m.id || ''),
                oldText: clip(m.content, 80),
                heldDays: at === null ? null : Math.max(0, Math.floor((now - at) / 86400000)),
                byId: meta.supersededBy ? String(meta.supersededBy) : null,
                byText: holder ? clip(holder.content, 80) : '',
                // 压制方**已不在池中**（被删/被墓碑化）→ 如实报「已不在」，不假装它还压着
                byMissing: !!(meta.supersededBy && !holder)
            });
            if (out.length >= limit) break;
        }
    } catch (_e) { return []; }
    return out;
}

/* ---------------- ⑤ 情感轨迹（引擎里没有，本版新算） ---------------- */
/**
 * 情感轨迹：把长期记忆按天分桶，算每桶的情绪强度均值与条数。
 * 用途是「这段时间的相处是浓的还是淡的」——单一数字答不出，曲线才答得出。
 *
 * @param {Array} memories 长期记忆
 * @param {{days?:number, now?:number}} [opts] days 默认 14
 * @returns {Array<{label:string,dayKey:string,count:number,avgArousal:number|null,avgImportance:number|null}>}
 *          只返回**有条目**的天（空白天不补零：补零会把「没聊」画成「情绪为零」）
 */
export function emotionTrace(memories, opts = {}) {
    const out = [];
    try {
        const list = Array.isArray(memories) ? memories : [];
        if (!list.length) return out;
        const days = Math.max(1, Math.min(60, Number(opts.days) || 14));
        const now = num(opts.now) || Date.now();
        const buckets = new Map();
        for (const m of list) {
            if (!m) continue;
            const t = ts(m.createdAt);
            if (t === null) continue;
            const age = Math.floor((now - t) / 86400000);
            if (age < 0 || age >= days) continue;
            const d = new Date(t);
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (!buckets.has(key)) buckets.set(key, { key, day: d, arousal: 0, arousalN: 0, imp: 0, impN: 0, count: 0 });
            const b = buckets.get(key);
            b.count++;
            const a = num(m.emotion && m.emotion.arousal);
            if (a !== null) { b.arousal += a; b.arousalN++; }
            const imp = num(m.importance) ?? num(m.metadata && m.metadata.importance);
            if (imp !== null) { b.imp += imp; b.impN++; }
        }
        const keys = [...buckets.keys()].sort();
        for (const key of keys) {
            const b = buckets.get(key);
            out.push({
                label: (b.day.getMonth() + 1) + '/' + b.day.getDate(),
                dayKey: key,
                count: b.count,
                avgArousal: b.arousalN ? +(b.arousal / b.arousalN).toFixed(2) : null,
                avgImportance: b.impN ? +(b.imp / b.impN).toFixed(1) : null
            });
        }
    } catch (_e) { return []; }
    return out;
}

/* ---------------- ⑥ 记忆体检（引擎里没有，本版新算） ---------------- */
/**
 * 记忆体检：给出一档评级 + 问题清单 + 可执行建议。
 *
 * 【为什么要「建议」而不只是「诊断」】本仓的诊断面已经不少了，缺的一直是
 *   「读数亮红灯，然后呢」。每条 issue 都带一个能直接做的动作（巩固 / 收藏 / 清空 / 等它积累），
 *   否则体检只是把焦虑换个地方显示。
 *
 * 判据全部是**可复现的确定性规则**（无 LLM、无随机）：
 *   · 无沉淀        —— 长期 + 短期 + 池全空
 *   · 长期为空      —— 有短期缓冲但没巩固过（该点巩固）
 *   · 换代堆积      —— superseded 占比 > 25% 且 ≥ 5 条（旧事被大量顶掉，建议回看确认）
 *   · 五感失衡      —— 有感知记忆但只落在单一感官（> 80%）
 *   · 冷库          —— 冻结 + 墓碑占比 > 50% 且 ≥ 5 条
 *   · 无收藏        —— 长期 ≥ 20 条但零 pinned（没有一条被显式保护，巩固上限淘汰随时可能吃掉剧情）
 *   · 近三日空白    —— 长期 ≥ 10 条但最近 3 天无新记忆
 *
 * @returns {{grade:string,gradeLabel:string,color:string,score:number,
 *            issues:Array<{kind:string,level:'info'|'warn'|'bad',text:string,advice:string}>,
 *            counts:object}}
 */
export function auditMemory(input, opts = {}) {
    const emptyResult = {
        grade: 'empty', gradeLabel: AUDIT_GRADE.empty.label, color: AUDIT_GRADE.empty.color, score: 0,
        issues: [], counts: { longTerm: 0, shortTerm: 0, pool: 0, pinned: 0, superseded: 0, guarded: 0, senses: 0 }
    };
    try {
        const src = (input && typeof input === 'object') ? input : {};
        const longTerm = Array.isArray(src.longTerm) ? src.longTerm : [];
        const shortTerm = Array.isArray(src.shortTerm) ? src.shortTerm : [];
        const poolStats = (src.poolStats && typeof src.poolStats === 'object') ? src.poolStats : {};
        const poolTotal = (num(poolStats.perception) || 0) + (num(poolStats.spatial) || 0) + (num(poolStats.temporal) || 0);
        const now = num(opts.now) || Date.now();

        let pinned = 0, superseded = 0, guarded = 0;
        let recent3 = 0;
        for (const m of longTerm) {
            if (!m) continue;
            const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
            if (meta.pinned || meta.pinnedBy || m.pinned || m.pinnedBy) pinned++;
            if (meta._superseded === SUPERSEDE_STATUS.SUPERSEDED) superseded++;
            const st = lifecycleStage(m, now);
            if (st === LIFECYCLE.FROZEN || st === LIFECYCLE.TOMBSTONE) guarded++;
            const t = ts(m.createdAt);
            if (t !== null && (now - t) < 3 * 86400000) recent3++;
        }
        const senses = num(src.senseCount) || 0;
        const counts = { longTerm: longTerm.length, shortTerm: shortTerm.length, pool: poolTotal, pinned, superseded, guarded, senses };

        const issues = [];
        const totalAll = longTerm.length + shortTerm.length + poolTotal;
        if (totalAll === 0) {
            return {
                ...emptyResult,
                issues: [{ kind: 'no-data', level: 'info', text: '还没有沉淀任何记忆', advice: '正常聊天即可 —— 记忆会在对话中自动采集，达到阈值后自动巩固' }],
                counts
            };
        }
        if (longTerm.length === 0 && shortTerm.length > 0) {
            issues.push({ kind: 'not-consolidated', level: 'warn', text: `短期缓冲已积 ${shortTerm.length} 条，尚未巩固为长期记忆`, advice: '点右上角 🌙 立即巩固' });
        }
        if (longTerm.length >= 5 && superseded / longTerm.length > 0.25) {
            issues.push({ kind: 'supersede-heavy', level: 'info', text: `${superseded} 条旧事被后来的剧情顶掉（占 ${Math.round(superseded / longTerm.length * 100)}%）`, advice: '到「换代」分页回看：正文都还在，误判可以复活' });
        }
        if (senses === 1 && (num(poolStats.perception) || 0) >= 5) {
            issues.push({ kind: 'sense-lopsided', level: 'info', text: '感知记忆只落在单一感官维度', advice: '无需处理 —— 剧情侧重单一场景时的正常形态' });
        }
        if (longTerm.length >= 5 && guarded / longTerm.length > 0.5) {
            issues.push({ kind: 'cold-storage', level: 'warn', text: `${guarded} 条已冻结/墓碑（超过 30 天未触碰）`, advice: '重要剧情请点 ☆ 收藏：收藏后永不冻结、也不参与淘汰' });
        }
        if (longTerm.length >= 20 && pinned === 0) {
            issues.push({ kind: 'no-pin', level: 'warn', text: `长期记忆 ${longTerm.length} 条，但没有一条被收藏保护`, advice: '在记忆列表点 ☆ 收藏关键剧情，防止被衰减淘汰挤掉' });
        }
        if (longTerm.length >= 10 && recent3 === 0) {
            const newest = longTerm.map((m) => ts(m.createdAt)).filter((t) => t !== null).sort((a, b) => b - a)[0];
            const gapDays = newest === undefined ? null : Math.floor((now - newest) / 86400000);
            issues.push({
                kind: 'idle', level: 'info',
                text: gapDays === null ? '最近三天没有新的记忆沉淀' : `已经 ${gapDays} 天没有新的记忆沉淀`,
                advice: '继续对话即可 —— 长时间不聊是正常状态，不是故障'
            });
        }

        const bad = issues.filter((i) => i.level === 'bad').length;
        const warn = issues.filter((i) => i.level === 'warn').length;
        const grade = bad > 0 ? 'bad' : (warn > 0 ? 'warn' : 'ok');
        const meta = AUDIT_GRADE[grade];
        // score 只作相对参考：问题越少越高，但**不假装它是健康百分比**
        const score = Math.max(0, 100 - bad * 40 - warn * 15);
        return { grade, gradeLabel: meta.label, color: meta.color, score, issues, counts };
    } catch (_e) { return emptyResult; }
}

/* ---------------- 总述（供 App 的 summaryLine 与头部一行） ---------------- */
/**
 * 一行总述：把上面几面压成一句人话。
 * @returns {string}
 */
export function insightSummary(pkg) {
    try {
        const p = (pkg && typeof pkg === 'object') ? pkg : {};
        const senses = Array.isArray(p.senses) ? p.senses : [];
        const scenes = Array.isArray(p.scenes) ? p.scenes : [];
        const lc = (p.lifecycle && typeof p.lifecycle === 'object') ? p.lifecycle : { total: 0, rows: [] };
        const audit = (p.audit && typeof p.audit === 'object') ? p.audit : null;
        if (!senses.length && !scenes.length && !lc.total) return '还没有可洞察的记忆';
        const parts = [];
        if (senses.length) parts.push(`${senses.length} 个感官维度 / ${senses.reduce((a, s) => a + s.count, 0)} 条感知`);
        if (scenes.length) parts.push(`${scenes.length} 个场景`);
        parts.push(`长期 ${lc.total} 条`);
        if (audit) parts.push(audit.gradeLabel);
        return parts.join(' · ');
    } catch (_e) { return '洞察读取失败（已降级）'; }
}

export default {
    SENSE_META, LIFECYCLE_META, AUDIT_GRADE,
    senseRows, sceneRows, lifecycleRows, supersedePairs, emotionTrace, auditMemory, insightSummary
};
