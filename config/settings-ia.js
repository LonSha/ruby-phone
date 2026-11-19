/**
 * config/settings-ia.js — 设置面信息架构内核（v4.157.0 · R25-O5）
 *
 * 【治的欠债】`apps/settings/settings-app.js` 一万二千行里，设置项靠位置记忆：
 *   - 搜索（R22-O2）只把当前 DOM 里的 `.setting-item` 藏起来；而设置页六个 tab 的 HTML 同时存在，
 *     只是 `hidden`。所以「搜到了」和「看得见」是两件事——命中项可能正躺在一个看不见的 tab 里。
 *   - 分组是十来个各写各的标题（`.setting-section-title` / `.settings-subsection-title` / `<summary>`），
 *     没有一张「六组各多少项」的总账。
 *   - 恢复默认散在 2808 / 5000 / 6743 / 7038 / 7275 等八颗按钮上，各管一段 DOM，
 *     既没有「改过哪几项」的清单，也没有统一入口。
 *
 * 【本模块只做判据面】纯函数：不碰 DOM、不碰 storage、不新建设置索引的第二个真源。
 *   分组真源 = 设置页真实存在的六个 tab（不是另造一套语义分组）；
 *   可恢复项真源 = 设置页真实读写的 storage 键 + 源码里那行读取自带的默认值
 *   （`test/r25_o5_settings_ia.test.mjs` 会去源码里逐条对账，编不出来）。
 *   过滤沿用 `settings-filter.js#filterSettings`：一处实现，两处调用。
 *
 * 【三态不塌】读当前值失败 → `unknown`，绝不塌成「都是默认值」`noop`；
 *   写入回执只在 `ok === true` 时算成，零条结果 → `unknown`（不拿「没报错」冒充「改成功」）。
 */
import { filterSettings } from './settings-filter.js';

/** 分组真源：设置页六个 tab（`data-tab` 值，见 settings-app.js 的 role=tab 按钮）。 */
export const IA_GROUPS = Object.freeze({
    general: { title: '常规', tab: 'general' },
    memory: { title: '联动', tab: 'memory' },
    api: { title: 'API', tab: 'llm' },
    tts: { title: 'TTS', tab: 'tts' },
    image: { title: '生图', tab: 'image' },
    lobby: { title: '大厅', tab: 'lobby' }
});

/** 展示顺序（不是 Map 插入序，也不随快照出现顺序漂移）。 */
export const IA_GROUP_ORDER = Object.freeze(['general', 'memory', 'api', 'tts', 'image', 'lobby']);

/**
 * 可恢复项登记。每条三项硬要求：
 *   1. `storageKey` 必须是设置页真读真写的键（单测去源码里查 get / set 两侧）；
 *   2. `default` 必须与源码里读取那行的默认字面量一致（单测逐条对账）；
 *   3. `effect` 说人话：恢复后用户会看到什么变回来。
 * 只有拿得出这三样的项才敢进这张表——拿不出的项在面板里如实标「未登记」，不给假按钮。
 */
export const IA_RESET_ENTRIES = Object.freeze([
    { id: 'appearance.fontScale', group: 'general', label: '界面字号', storageKey: 'phone-font-scale', default: 100, effect: '整机字号回到 100%' },
    { id: 'appearance.shellScale', group: 'general', label: '手机外壳缩放', storageKey: 'phone-shell-scale', default: 100, effect: '外壳缩放回到 100%' },
    { id: 'general.homeLayout', group: 'general', label: '桌面布局', storageKey: 'phone-home-layout', default: 'icons', effect: '桌面回到图标网格' },
    { id: 'general.inlineReply', group: 'general', label: '消息内联回复按钮', storageKey: 'phone_inline_reply_btn', default: true, effect: '消息下重新出现内联回复按钮' },
    { id: 'general.singleChatLimit', group: 'general', label: '单聊历史条数', storageKey: 'offline-single-chat-limit', default: 30, effect: '单聊注入上限回到 30 条' },
    { id: 'general.groupChatLimit', group: 'general', label: '群聊历史条数', storageKey: 'offline-group-chat-limit', default: 10, effect: '群聊注入上限回到 10 条' },
    { id: 'general.callLimit', group: 'general', label: '通话记录条数', storageKey: 'phone-call-limit', default: 10, effect: '通话记录上限回到 10 条' },
    { id: 'general.smsLimit', group: 'general', label: '短信条数', storageKey: 'phone-sms-limit', default: 20, effect: '短信上限回到 20 条' },
    { id: 'general.weiboLimit', group: 'general', label: '微博记录条数', storageKey: 'offline-weibo-history-limit', default: 5, effect: '微博线下记录上限回到 5 条' },
    { id: 'general.diaryLimit', group: 'general', label: '日记记录条数', storageKey: 'offline-diary-history-limit', default: 10, effect: '日记线下记录上限回到 10 条' }
]);

/** 一项在索引里的稳定键（跨重渲染不变：tab + 分区标题 + 标签）。 */
export function iaItemKey(tab, section, label) {
    return String(tab || '') + ' / ' + String(section || '') + ' / ' + String(label || '');
}

function squash(text) {
    return String(text == null ? '' : text).replace(/[ \t\n\r]+/g, ' ').trim();
}

/**
 * 从「分区快照」建索引。
 * @param {Array<{tab:string, sections:Array<{title:string, items:Array<{label:string}>}>}>} snapshot
 */
export function buildIaIndex(snapshot) {
    const spans = Array.isArray(snapshot) ? snapshot.filter((s) => s && typeof s === 'object') : [];
    const groups = [];
    const items = [];
    const absentGroups = [];
    const unknownTabs = [];

    IA_GROUP_ORDER.forEach(function (g) {
        const def = IA_GROUPS[g];
        const groupSpans = spans.filter(function (s) { return String(s.tab || '') === def.tab; });
        const seen = new Set();
        const own = [];
        let duplicated = 0;
        groupSpans.forEach(function (span) {
            const sections = Array.isArray(span.sections) ? span.sections : [];
            sections.forEach(function (sec) {
                const title = squash(sec && sec.title) || '未分组';
                const list = Array.isArray(sec && sec.items) ? sec.items : [];
                list.forEach(function (it) {
                    const label = squash(it && it.label);
                    if (!label) return; // 空标签不入索引：不许拿序号/占位符冒充一项设置
                    const key = iaItemKey(def.tab, title, label);
                    if (seen.has(key)) { duplicated += 1; return; }
                    seen.add(key);
                    own.push({ key, label, section: title, group: g, groupTitle: def.title, tab: def.tab });
                });
            });
        });
        own.forEach(function (it) { items.push(it); });
        if (own.length === 0) absentGroups.push(g);
        groups.push({ group: g, title: def.title, tab: def.tab, count: own.length, duplicated, items: own });
    });

    // 已登记的是「tab 值」（llm → api 组），不是分组 key：拿 key 去比会把 llm 自己误报成脏数据
    const knownTabs = IA_GROUP_ORDER.map(function (g) { return IA_GROUPS[g].tab; });
    spans.forEach(function (s) {
        const tab = String(s.tab || '');
        if (knownTabs.indexOf(tab) === -1 && unknownTabs.indexOf(tab) === -1) unknownTabs.push(tab);
    });

    return { groups, items, total: items.length, absentGroups, unknownTabs, groupCount: groups.length };
}

/**
 * 搜索：复用 settings-filter（一处实现两处用），但把命中变成**带 tab 的扁平列表**，
 * 这样「搜到了但看不见」不会发生——面板把它们画在可见区，点一条就跳过去。
 */
export function iaSearch(index, query) {
    const idx = index && Array.isArray(index.groups) ? index : { groups: [], total: 0 };
    if (!idx.total) return { face: 'empty', hits: [], matched: 0, query: '', note: '还没有设置项可搜' };

    const sections = idx.groups.map(function (g) {
        return {
            title: g.title,
            group: g.group,
            items: g.items.map(function (it) {
                return { label: it.label, keywords: it.section + ' ' + it.groupTitle + ' ' + it.key, _it: it };
            })
        };
    });

    const r = filterSettings(sections, query);
    if (r.face === 'empty') return { face: 'empty', hits: [], matched: 0, query: '', note: '还没有设置项可搜' };
    if (r.face === 'all') return { face: 'all', hits: [], matched: r.matched, query: '', note: '共 ' + r.matched + ' 项设置，按组收拢在下面' };
    if (r.face === 'noMatch') return { face: 'noMatch', hits: [], matched: 0, query: r.query, note: '没有匹配「' + r.query + '」的设置项' };

    const hits = [];
    r.sections.forEach(function (sec) {
        sec.items.forEach(function (it) { if (it && it._it) hits.push(it._it); });
    });
    return { face: 'results', hits, matched: hits.length, query: r.query, note: '找到 ' + hits.length + ' 项设置（跨 ' + new Set(hits.map(function (h) { return h.tab; })).size + ' 个分组）' };
}

function sameValue(a, b) {
    if (a === b) return true;
    if (typeof b === 'number' && a !== null && a !== undefined && String(a).trim() !== '' && Number.isFinite(Number(a))) return Number(a) === b;
    if (typeof b === 'boolean') {
        if (a === 'true') return b === true;
        if (a === 'false') return b === false;
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 恢复默认的差异预览。先算清楚「从什么变成什么」，再让用户勾。
 * face：
 *   - `noop`   全都是默认值（包括「从来没设过」——但每条带 fromSet:false，与「设成了 0」不同形）
 *   - `preview` 有真差异，去勾
 *   - `unknown` 一项都没读成（不许塌成 noop）
 * @param {Array<object>} entries
 * @param {(key:string)=>any} read 读当前值；抛错即该项判 unknown
 * @param {{kind:'all'|'group'|'one', group?:string, id?:string}} scope
 */
export function iaResetPlan(entries, read, scope) {
    const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object' && e.id && e.storageKey) : [];
    const sc = scope && typeof scope === 'object' ? scope : { kind: 'all' };
    let picked = list;
    if (sc.kind === 'group') picked = list.filter(function (e) { return e.group === sc.group; });
    else if (sc.kind === 'one') picked = list.filter(function (e) { return e.id === sc.id; });

    const items = [];
    const skipped = [];
    picked.forEach(function (e) {
        let cur;
        try {
            cur = typeof read === 'function' ? read(e.storageKey) : undefined;
        } catch (err) {
            skipped.push({ id: e.id, label: e.label, reason: 'read-failed' });
            return;
        }
        const fromSet = !(cur === undefined || cur === null || String(cur) === '');
        const from = fromSet ? cur : null;
        items.push({
            id: e.id,
            label: e.label,
            group: e.group,
            storageKey: e.storageKey,
            from,
            fromSet,
            to: e.default,
            changed: !sameValue(fromSet ? cur : e.default, e.default)
        });
    });

    const changed = items.filter(function (i) { return i.changed; });
    let face = 'preview';
    if (items.length === 0) face = 'unknown';
    else if (changed.length === 0 && skipped.length === 0) face = 'noop';

    let note;
    if (face === 'noop') note = '都是默认值，没有要恢复的';
    else if (face === 'unknown') note = '读不到当前值（' + skipped.length + ' 项未知），不敢动';
    else note = '有 ' + changed.length + ' 项改过，先看清变化再恢复' + (skipped.length ? '（另有 ' + skipped.length + ' 项读不到，已跳过）' : '');

    return { face, items, changed, skipped, note };
}

/**
 * 写入回执。`ok` 只认 `=== true`；零条结果 → `unknown`，不拿「没报错」冒充「改成功」。
 * face：`applied` / `partial` / `failed` / `unknown`
 */
export function iaResetReceipt(results) {
    const list = Array.isArray(results) ? results.filter((r) => r && typeof r === 'object' && r.id) : [];
    if (list.length === 0) return { face: 'unknown', applied: 0, failed: 0, appliedIds: [], failedIds: [], note: '一项都没走到写入（未知）' };
    const ok = list.filter(function (r) { return r.ok === true; });
    const bad = list.filter(function (r) { return r.ok !== true; });
    let face = 'applied';
    if (bad.length && ok.length) face = 'partial';
    else if (bad.length && !ok.length) face = 'failed';
    const note = face === 'applied'
        ? '已恢复 ' + ok.length + ' 项默认值'
        : face === 'partial'
            ? '恢复 ' + ok.length + ' 项，' + bad.length + ' 项没写成'
            : '一项都没恢复成功（' + bad.length + ' 项失败）';
    return {
        face,
        applied: ok.length,
        failed: bad.length,
        appliedIds: ok.map(function (r) { return r.id; }),
        failedIds: bad.map(function (r) { return r.id; }),
        note
    };
}

/** 面板状态行：组目录 + 索引覆盖面，一句话说清现在有什么、缺什么。 */
export function iaPanelNote(index, search) {
    const idx = index && typeof index === 'object' ? index : { total: 0, groups: [], absentGroups: [] };
    if (search && search.face && search.face !== 'all') return String(search.note || '');
    const parts = ['共 ' + (idx.total || 0) + ' 项设置'];
    if (Array.isArray(idx.absentGroups) && idx.absentGroups.length) {
        parts.push('空组 ' + idx.absentGroups.map(function (g) { return IA_GROUPS[g] ? IA_GROUPS[g].title : g; }).join('/'));
    }
    if (Array.isArray(idx.unknownTabs) && idx.unknownTabs.length) parts.push('未登记分组 ' + idx.unknownTabs.join('/'));
    return parts.join(' · ');
}

/** 自检：把边界逐条跑一遍（负控制留在下面，改宽判据就会红）。 */
export function settingsIaSelfCheck() {
    const bad = [];

    // 分组真源必须是设置页真有的六个 tab
    IA_GROUP_ORDER.forEach(function (g) {
        if (!IA_GROUPS[g]) bad.push('分组缺表:' + g);
        if (IA_GROUPS[g] && IA_GROUPS[g].tab !== g && g !== 'api') bad.push('分组/tab 映射意外:' + g);
    });
    if (IA_GROUPS.api.tab !== 'llm') bad.push('API 组必须指向真 tab llm');

    const snapshot = [
        { tab: 'general', sections: [{ title: '当前角色', items: [{ label: '称呼' }, { label: '  称呼 ' }, { label: '' }] }, { title: '数据', items: [{ label: '单聊历史条数' }] }] },
        { tab: 'image', sections: [{ title: '生图', items: [{ label: '生图开关' }] }] },
        { tab: 'nope', sections: [{ title: '野分区', items: [{ label: '野项' }] }] }
    ];
    const idx = buildIaIndex(snapshot);
    if (idx.total !== 3) bad.push('索引项数应 3（重复标签与空标签不入索引），得 ' + idx.total);
    if (idx.unknownTabs.indexOf('nope') === -1) bad.push('未登记的 tab 要如实报');
    if (idx.absentGroups.indexOf('tts') === -1) bad.push('空组要如实报');
    if (buildIaIndex([]).total !== 0) bad.push('空快照应 0 项');
    if (buildIaIndex([{ tab: 'llm', sections: [{ title: 'API', items: [{ label: '接口地址' }] }] }]).unknownTabs.length !== 0) bad.push('llm 是真 tab，不许被判成未登记分组');

    const s1 = iaSearch(idx, '称呼');
    if (s1.face !== 'results' || s1.hits.length !== 1) bad.push('按标签搜应命中 1 条，得 ' + s1.hits.length);
    if (s1.face === 'results' && s1.hits[0].tab !== 'general') bad.push('命中项必须带真 tab');
    if (iaSearch(idx, '生图').face !== 'results') bad.push('跨组要能搜到');
    if (iaSearch(idx, '这个词根本没有').face !== 'noMatch') bad.push('无命中应如实 noMatch');
    if (iaSearch(idx, '').face !== 'all') bad.push('空查询应 all');
    if (iaSearch(buildIaIndex([]), 'x').face !== 'empty') bad.push('空索引应 empty');

    const entries = [
        { id: 'a.one', group: 'general', label: '甲', storageKey: 'k-a', default: 100 },
        { id: 'a.two', group: 'general', label: '乙', storageKey: 'k-b', default: true },
        { id: 'a.three', group: 'general', label: '丙', storageKey: 'k-c', default: 'icons' }
    ];
    const planNoop = iaResetPlan(entries, function () { return null; }, { kind: 'all' });
    if (planNoop.face !== 'noop') bad.push('从没设过应 noop');
    if (planNoop.items[0].fromSet !== false) bad.push('没设过要标 fromSet:false（与设成 0 不同形）');

    const planPreview = iaResetPlan(entries, function (k) { return k === 'k-a' ? 120 : (k === 'k-b' ? true : 'icons'); }, { kind: 'all' });
    if (planPreview.face !== 'preview' || planPreview.changed.length !== 1) bad.push('一项改动应 preview/1，得 ' + planPreview.face + '/' + planPreview.changed.length);
    if (planPreview.changed[0] && planPreview.changed[0].from !== 120) bad.push('预览要带原值');

    const planUnknown = iaResetPlan(entries, function () { throw new Error('storage 挂了'); }, { kind: 'all' });
    if (planUnknown.face !== 'unknown') bad.push('全读不到必须 unknown（不许塌成 noop）');

    const planGroup = iaResetPlan(entries, function () { return null; }, { kind: 'group', group: 'tts' });
    if (planGroup.face !== 'unknown') bad.push('空组应 unknown（不是 noop：没有一项可判）');

    if (iaResetReceipt([]).face !== 'unknown') bad.push('零条结果必须 unknown');
    if (iaResetReceipt([{ id: 'a', ok: true }]).face !== 'applied') bad.push('全成应 applied');
    if (iaResetReceipt([{ id: 'a', ok: true }, { id: 'b', ok: false }]).face !== 'partial') bad.push('部分应 partial');
    if (iaResetReceipt([{ id: 'a', ok: 'yes' }]).face !== 'failed') bad.push('ok 只认 true（字符串 yes 不算成）');

    return { ok: bad.length === 0, bad };
}

export default {
    IA_GROUPS,
    IA_GROUP_ORDER,
    IA_RESET_ENTRIES,
    iaItemKey,
    buildIaIndex,
    iaSearch,
    iaResetPlan,
    iaResetReceipt,
    iaPanelNote,
    settingsIaSelfCheck
};