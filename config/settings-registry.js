/**
 * config/settings-registry.js — R24-O6 设置中心重构：登记制（v4.158.0）
 *
 * 【治的欠债】`apps/settings-app.js` 一万二千行里，每个设置项的「默认值 / 分组 / 说明 / 存哪」
 *   都散在渲染代码里：新增一项要改渲染、改默认值、改说明三处；也**说不出**「改过哪几项」。
 *
 * 【登记制】每项一条 `{ id, group, label, default, effect }`：
 *   - `id` 唯一（撞名即拒，不许两处各存一份）
 *   - `group` 只能是六个登记分组之一
 *   - `default` 是**唯一真值**（别处只准读）
 *   - `effect` 是**人话**：改了会发生什么（不是「开关」两个字）
 *
 * 【过滤沿用 O2/R22**】不新建索引，直接喂 `settings-filter.js#filterSettings`，
 *   把登记项转成它要的 `{title, items:[{label, keywords}]}`。一处实现，两处调用。
 */
import { filterSettings } from './settings-filter.js';

export const SETTING_GROUPS = Object.freeze({
    general: '常规',
    appearance: '外观',
    notification: '通知',
    privacy: '隐私',
    performance: '性能',
    data: '数据'
});

export const SETTING_FIELDS = Object.freeze(['id', 'group', 'label', 'default', 'effect']);

/** 校验一条登记：拒就说明是哪个字段不行。 */
export function validateSetting(entry, seenIds) {
    const e = entry && typeof entry === 'object' ? entry : null;
    if (!e) return { ok: false, bad: ['no-entry'] };
    const bad = [];
    SETTING_FIELDS.forEach(function (f) {
        if (e[f] === undefined || e[f] === null) bad.push('missing-field:' + f);
    });
    if (typeof e.id === 'string' && !/^[a-z][a-zA-Z0-9._-]{2,47}$/.test(e.id)) bad.push('bad-id');
    if (typeof e.id === 'string' && seenIds && seenIds.has(e.id)) bad.push('duplicate-id:' + e.id);
    if (typeof e.group === 'string' && !Object.prototype.hasOwnProperty.call(SETTING_GROUPS, e.group)) bad.push('unknown-group:' + e.group);
    if (typeof e.label === 'string' && e.label.trim() === '') bad.push('empty-label');
    if (typeof e.effect === 'string' && e.effect.trim().length < 4) bad.push('vague-effect:' + String(e.id));
    if (e.default !== undefined && e.default !== null && typeof e.default === 'object' && !Array.isArray(e.default)) {
        bad.push('bad-default:' + String(e.id));
    }
    return { ok: bad.length === 0, bad };
}

/**
 * 建登记表。
 * @param {Array<object>} entries
 */
export function createSettingsRegistry(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const byId = new Map();
    const rejected = [];
    list.forEach(function (entry) {
        const v = validateSetting(entry, byId);
        if (!v.ok) { rejected.push({ entry, bad: v.bad }); return; }
        byId.set(entry.id, Object.freeze({
            id: entry.id,
            group: entry.group,
            label: entry.label,
            default: entry.default,
            effect: entry.effect,
            keywords: String(entry.keywords || '')
        }));
    });

    function all() { return Array.from(byId.values()); }

    /** 分组视图：只列非空分组，顺序按 SETTING_GROUPS 登记序（不是 Map 插入序）。 */
    function grouped() {
        const out = [];
        Object.keys(SETTING_GROUPS).forEach(function (g) {
            const items = all().filter(function (e) { return e.group === g; });
            if (items.length) out.push({ group: g, title: SETTING_GROUPS[g], items });
        });
        return out;
    }

    /** 转成 O2 过滤要的形状（一处实现两处用）。 */
    function toSections() {
        return grouped().map(function (g) {
            return {
                title: g.title,
                group: g.group,
                items: g.items.map(function (e) {
                    return { id: e.id, label: e.label, keywords: e.keywords + ' ' + e.id, effect: e.effect };
                })
            };
        });
    }

    function search(query) { return filterSettings(toSections(), query); }

    /** 默认值：唯一真值出口。 */
    function defaults() {
        const out = {};
        all().forEach(function (e) { out[e.id] = e.default; });
        return out;
    }

    /** 改过哪几项（与默认值逐项比；缺项视为未改，不报成 changed）。 */
    function changed(current) {
        const cur = current && typeof current === 'object' ? current : {};
        const out = [];
        all().forEach(function (e) {
            if (!Object.prototype.hasOwnProperty.call(cur, e.id)) return;
            if (JSON.stringify(cur[e.id]) !== JSON.stringify(e.default)) {
                out.push({ id: e.id, from: e.default, to: cur[e.id] });
            }
        });
        return out;
    }

    /** 人话摘要：改动项逐条带 effect，不是只给个数字。 */
    function summary(current) {
        const ch = changed(current);
        if (!ch.length) return { text: '都是默认值', changed: [] };
        const lines = ch.map(function (c) {
            const e = byId.get(c.id);
            return e.label + '（' + e.effect + '）';
        });
        return { text: '改过 ' + ch.length + ' 项：' + lines.join('；'), changed: ch };
    }

    return { all, grouped, toSections, search, defaults, changed, summary, rejected, size: function () { return byId.size; } };
}

/** 本期登记的真实设置项（六组各至少两项；默认值即唯一真值）。 */
export const SETTING_ENTRIES = Object.freeze([
    { id: 'general.playerName', group: 'general', label: '称呼', default: '你', effect: 'AI 怎么称呼你，改完下一条消息就生效', keywords: '名字 称呼 nickname' },
    { id: 'general.lockScreen', group: 'general', label: '锁屏', default: true, effect: '打开时进手机先见锁屏，关掉直接进桌面', keywords: '锁屏 跳过 lockscreen' },
    { id: 'general.homeHint', group: 'general', label: '桌面提示', default: true, effect: '桌面上显示未读与新消息提示条', keywords: '提示 未读 badge' },

    { id: 'appearance.theme', group: 'appearance', label: '主题', default: 'dark', effect: '切换后整套配色按令牌重算，对比度有底线', keywords: '主题 深色 浅色 theme dark' },
    { id: 'appearance.fontScale', group: 'appearance', label: '字号缩放', default: 1, effect: '整机字号按倍数缩放，最大 1.3 倍', keywords: '字号 缩放 font scale' },

    { id: 'notification.quietHours', group: 'notification', label: '免打扰时段', default: '23:00-07:00', effect: '这段时内不弹通知，消息仍然收', keywords: '免打扰 静音 勿扰 dnd' },
    { id: 'notification.sound', group: 'notification', label: '提示音', default: true, effect: '关掉后通知静默，红点仍然保留', keywords: '提示音 声音 sound' },

    { id: 'privacy.permissionPrompt', group: 'privacy', label: '权限询问', default: 'always', effect: 'App 首次读通讯录/相册时是否再问一次', keywords: '权限 询问 permission' },
    { id: 'privacy.archiveExport', group: 'privacy', label: '允许导出档案', default: false, effect: '打开后才能导出整机档案（含聊天原文）', keywords: '导出 档案 archive' },

    { id: 'performance.lazyStyles', group: 'performance', label: '样式懒加载', default: true, effect: '只加载当前 App 的样式，首屏更快', keywords: '样式 懒加载 启动 lazy' },
    { id: 'performance.mediaCacheMb', group: 'performance', label: '媒体缓存上限', default: 48, effect: '超过就按最久未用逐张淘汰，不整块清空', keywords: '缓存 图片 上限 cache' },

    { id: 'data.healthCheck', group: 'data', label: '数据体检', default: 'weekly', effect: '按周扫孤儿键与坏数据，只报告不自动删', keywords: '体检 孤儿 数据 health' },
    { id: 'data.keepDraft', group: 'data', label: '保留草稿', default: true, effect: '关掉后退出 App 不保留未发送内容', keywords: '草稿 draft' }
]);

export function settingsRegistrySelfCheck() {
    const bad = [];
    const reg = createSettingsRegistry(SETTING_ENTRIES);
    if (reg.rejected.length) bad.push('内置登记项不该被拒：' + JSON.stringify(reg.rejected[0] && reg.rejected[0].bad));
    if (reg.size() !== SETTING_ENTRIES.length) bad.push('登记项数应与常量一致');
    if (reg.grouped().length !== 6) bad.push('六组都该有内容');

    const d = reg.defaults();
    if (d['appearance.theme'] !== 'dark') bad.push('默认值是唯一真值');
    if (Object.keys(d).length !== reg.size()) bad.push('默认值应逐项给出');

    // 三层拒绝：撞 id / 未知组 / 说不清效果
    const dup = createSettingsRegistry([
        { id: 'general.lockScreen', group: 'general', label: 'A', default: 1, effect: '说明很长' },
        { id: 'general.lockScreen', group: 'general', label: 'B', default: 2, effect: '说明很长' }
    ]);
    if (dup.rejected.length !== 1 || dup.rejected[0].bad.indexOf('duplicate-id:general.lockScreen') === -1) bad.push('撞 id 应拒');
    if (createSettingsRegistry([{ id: 'x.y', group: 'nope', label: 'A', default: 1, effect: '说明很长' }]).rejected[0].bad.indexOf('unknown-group:nope') === -1) bad.push('未知分组应拒');
    if (createSettingsRegistry([{ id: 'x.y', group: 'general', label: 'A', default: 1, effect: '开关' }]).rejected[0].bad[0].indexOf('vague-effect') !== 0) bad.push('效果说明不许敷衍');

    // 过滤沿用 O2：一处实现两处用
    if (reg.search('').face !== 'all') bad.push('空查询应全显');
    const hit = reg.search('免打扰');
    if (hit.face !== 'results' || hit.matched < 1) bad.push('按中文关键词应能搜到');
    const idHit = reg.search('privacy.archiveExport');
    if (idHit.face !== 'results') bad.push('按 id 也应能搜到');
    if (reg.search('这个词根本不存在').face !== 'noMatch') bad.push('无命中应如实 noMatch');

    // 改动面：缺项不算改、逐项带 effect
    const ch = reg.changed({ 'appearance.theme': 'light', 'data.keepDraft': true });
    if (ch.length !== 1 || ch[0].id !== 'appearance.theme') bad.push('只报真改过的项');
    const sum = reg.summary({ 'appearance.theme': 'light' });
    if (sum.text.indexOf('主题') === -1 || sum.text.indexOf('对比度') === -1) bad.push('摘要要带人话效果');
    if (reg.summary({}).text !== '都是默认值') bad.push('没改就该说都是默认值');

    return { ok: bad.length === 0, bad, sample: 'settings=' + reg.size() + ' groups=' + reg.grouped().length };
}

export default {
    SETTING_GROUPS,
    SETTING_FIELDS,
    SETTING_ENTRIES,
    validateSetting,
    createSettingsRegistry,
    settingsRegistrySelfCheck
};