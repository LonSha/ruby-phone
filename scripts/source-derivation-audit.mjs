#!/usr/bin/env node
/* ============================================================
 * scripts/source-derivation-audit.mjs — 派生读数源身份台账门禁 [v2.96.0]
 * ------------------------------------------------------------
 * 【为什么有这道门】
 * TODO P0「源头变更后的下游对齐普查」从 v2.77 一路手查到 v2.95：
 *   生活事件（v2.77/2.90/2.92/2.93）→ 搜索索引（v2.81）→ 桌面角标（v2.91）→
 *   万象背包（v2.95）。每轮都是「读代码找形态」，于是**同一形态查完要不要再查**
 *   永远没有答案，判据也只活在当轮的测试套件里。
 * v2.96 换做法：把「按源身份去重的派生库」枚举清楚、逐条登记，本门持续回答：
 *     ① 枚举面有没有**新增未登记**的库（新库一出现即红灯）；
 *     ② 已登记的库，其应具备的出口是否**仍在**（出口被删即红灯）；
 *     ③ 已登记条目是否**仍然存活**（枚举面里消失即红灯，防僵尸条目）。
 *
 * 【判据边界】本门只说「出口在不在」，不说「行为对不对」。行为面对每条库都不同
 *   （族回收 / 按源对账 / 按源过滤），必须逐条真跑模块 —— 已固化在对应套件（见 note）。
 *
 * 【枚举面（实测口径，v2.96.0）】`apps/**` + `config/**` 的 `.js` 中，同一行**同时**出现
 *   · 源身份字段：sourceId / sourceKey / commitmentSourceId
 *   · 集合操作调用：.filter/.find/.findIndex/.some/.map/.flatMap/.reduce/.unshift/.push
 *   实测命中 10 个文件（见运行输出）。口径刻意**不要求**源字段落在参数括号内：
 *   本仓大量配对写作 `String(x?.sourceKey || '') === sourceKey` 与
 *   `.map(([sourceId, ...]) => ...)`，那种写法会被「参数内必须带源字段」的正则漏掉 ——
 *   漏掉就等于门禁开口（负控制 B2 覆盖该形态）。
 *   注意两种**不在**本面里的形态，已各自登记：
 *   · 只有字段声明、没有集合操作的纯投影文件；
 *   · `apps/**` 之外（如 `index.js`）的源身份使用点，本门不覆盖（登记在台账 note 里）。
 *   枚举面一变（新增或消失）本门即失败 —— 把台账改对，是本门唯一的人工动作。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function walk(absDir, out = []) {
    for (const name of fs.readdirSync(absDir)) {
        const abs = path.join(absDir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs, out);
        else if (name.endsWith('.js')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
    return out;
}

const SOURCE_FIELD = /\b(sourceId|sourceKey|commitmentSourceId)\b/;
const SOURCE_PAIRING = /\.(filter|find|findIndex|some|map|flatMap|reduce|unshift|push)\s*\(/;

/* ------------------------------------------------------------
 * 台账
 *   kind: 'derivation'       — 按源身份去重的派生库（必须齐备出口）
 *         'store'            — 派生库本体存储层（枚举面命中与否都可，见 inFace）
 *         'not-a-derivation' — 已查、明确**不是**派生库（登记以免重复投入）
 *   inFace: 是否**要求**它出现在枚举面（僵尸条目检查用；写 false 表示「不要求」）
 *   exports: 必须仍然在场的出口锚点（结构面）
 *   sources: 该派生库的源头与其「源头侧出口」（同样做在场检查）
 * ------------------------------------------------------------ */
export const LEDGER = [
    {
        key: 'life-events',
        title: '生活事件库（时间线派生读数）',
        file: 'config/life-events.js',
        kind: 'derivation',
        exports: ['add(event)', 'updateBySource(sourceId', 'removeBySource(sourceId', 'removeBySourceBase(base)'],
        sources: [
            { name: 'calendar 备忘（领域事件）', file: 'apps/calendar/calendar-data.js', exports: ['recordDomainLifeEvent(memo)', 'refreshDomainLifeEvent(memo)', 'forgetDomainLifeEvent(memo)'] },
            { name: 'commitment 约定', file: 'apps/calendar/calendar-app.js', inFace: false, exports: ['recordCommitmentLifeEvent(item)', 'refreshCommitmentLifeEvent(item)', 'forgetCommitmentLifeEvent(id)'] },
        ],
        note: '行为面：tests/system-v293.test.mjs（源键不放可变状态：commitment:<id>）、system-v292（过期批量清除回收）、system-v290（跨会话残留）。',
    },
    {
        key: 'wanxiang-inventory',
        title: '万象背包（任务奖励 / 订单送达派生条目）',
        file: 'apps/wangxiang/wangxiang-app.js',
        kind: 'derivation',
        exports: ['_addInventoryItem(item = {})', '_removeInventoryItemsBySourceKeys(sourceKeys)', '_removeInventoryItemsBySourceBase(base)'],
        sources: [
            {
                name: 'task 任务奖励（源键 task:<id>:<index>）',
                file: 'apps/wangxiang/wangxiang-app.js',
                inFace: false,
                exports: ['_grantTaskRewardsToInventory(task)', '_removeInventoryItemsBySourceBase(`task:${taskId}`)', '_removeInventoryItemsBySourceBase(`task:${id}`)'],
            },
            { name: 'order 订单送达（源键 order:<id>）', file: 'apps/wangxiang/wangxiang-app.js', inFace: false, exports: ['_grantDeliveredOrderToInventory(order)'] },
        ],
        note: '行为面：tests/system-v295.test.mjs（回滚/放弃两条路径整族回收；删订单**记录**不回收 = 设计本意，已立守卫）。',
    },
    {
        key: 'worldbook-selection',
        title: '世界书来源选择状态（按来源记条目选择）',
        file: 'config/worldbook-manager.js',
        kind: 'derivation',
        writable: false,
        exports: ['setSourceSelected(appKey, source, selected)', 'setSourceEntrySelection(appKey, source, entryIds', 'getSourceEntrySelectionState(appKey, source)', '_resolveSourceEntrySelection(selection, source)', '_getSourceSelectionAliases(source)'],
        sources: [
            { name: 'worldbook 来源（含 legacyIds 别名）', file: 'config/worldbook-manager.js', inFace: false, exports: ['_writeSelectionState(appKey, selection)', '_findExplicitEntrySelection(selection, source)'] },
        ],
        note: '**已查、判定为非缺陷**：来源行与条目行的勾选框在 UI 上无法取消（900ms 后回写 true），'
            + '而「条目被移除 → 旧 uid 悬空」不可由本仓代码路径制造（来源与条目由宿主 SillyTavern 提供）。'
            + '登记在此是为了「别再手查第二遍」；若将来加了来源级清除出口，请在此登记并补行为面套件。',
    },
    { file: 'apps/album/album-data.js', kind: 'not-a-derivation', note: '相册来源分类器：sourceKey 是图片的来源**标签**，不是派生条目的源头身份。' },
    { file: 'apps/album/album-image-picker.js', kind: 'not-a-derivation', note: '相册按来源筛选视图。' },
    { file: 'apps/album/album-view.js', kind: 'not-a-derivation', note: '相册按来源筛选视图。' },
    { file: 'apps/calendar/calendar-view.js', kind: 'not-a-derivation', note: '时间线视图据 memo.commitmentSourceId 反查约定（纯展示）。' },
    { file: 'apps/memory/global-search-engine.js', kind: 'not-a-derivation', exports: ['registerSource(src)', 'query(query, opts = {})'], note: '跨 App 搜索：sourceId 是来源标签，索引每次打开面板失效重建，不承载派生条目生命周期。' },
    { file: 'apps/search/search-view.js', kind: 'not-a-derivation', note: '搜索面板：按来源作用域过滤视图。' },
    { file: 'config/prompt-manager.js', kind: 'not-a-derivation', inFace: false, note: '提示词导入预设：字段名叫 sourceId，语义是「导入来源的预设 id」，无删除语义、不参与去重回收（预设删除走独立入口）。' },
];

/* ------------------------------------------------------------
 * 枚举面
 * ------------------------------------------------------------ */
function scan() {
    const hits = [];
    for (const dir of ['apps', 'config']) {
        for (const file of walk(path.join(ROOT, dir))) {
            const lines = read(file).split('\n');
            const n = lines.filter((line) => SOURCE_FIELD.test(line) && SOURCE_PAIRING.test(line)).length;
            if (n > 0) hits.push({ file, pairings: n });
        }
    }
    return hits.sort((a, b) => a.file.localeCompare(b.file));
}

const hits = scan();
const faceFiles = new Set(hits.map((h) => h.file));
const problems = [];

const alive = (file, token) => fs.existsSync(path.join(ROOT, file)) && read(file).includes(token);

// ① 枚举面：命中文件必须被**某条**台账覆盖（顶层条目或某个源头都算覆盖）
//   `inFace` 的语义是「是否**要求**它出现在枚举面」（③ 用），
//   与「是否**允许**它出现」（本处覆盖检查）是两件事，不可一物两用。
const registered = new Set();
for (const entry of LEDGER) {
    registered.add(entry.file);
    for (const src of entry.sources || []) registered.add(src.file);
}
const uncovered = hits.filter((h) => !registered.has(h.file));
if (uncovered.length) {
    problems.push('枚举面出现未登记的库：' + uncovered.map((h) => `${h.file}(${h.pairings})`).join(' · ')
        + ' —— 新增库必须登记进 LEDGER（判定为派生库则一并写出口，否则标 kind: "not-a-derivation"）');
}

// ② 出口在场
for (const entry of LEDGER) {
    for (const token of entry.exports || []) {
        if (!alive(entry.file, token)) problems.push(`${entry.key || entry.file}：登记的出口「${token}」在 ${entry.file} 已找不到`);
    }
    for (const src of entry.sources || []) {
        for (const token of src.exports || []) {
            if (!alive(src.file, token)) problems.push(`${entry.key} / 源头「${src.name}」：出口「${token}」在 ${src.file} 已找不到`);
        }
    }
}

// ③ 台账存活：要求命中枚举面的条目必须仍被命中（防僵尸条目）
for (const entry of LEDGER) {
    if (entry.inFace !== false && !faceFiles.has(entry.file)) {
        problems.push(`${entry.key || entry.file}：台账登记它在枚举面里，但枚举面已不命中它（条目已失效，应删除或改写 inFace）`);
    }
    if (entry.kind === 'derivation' && (!entry.exports || entry.exports.length === 0)) {
        problems.push(`${entry.key}：登记为派生库却没有 exports 判据（派生库必须给出必须齐备的出口）`);
    }
}

// ④ 自证：枚举面与台账非空（正则被改坏时不得「零命中 = 全绿」）
if (hits.length === 0) problems.push('枚举面零命中：源身份扫描正则可能已失效（fail-closed）');
if (LEDGER.length === 0) problems.push('台账为空：本门失去意义（fail-closed）');

/* ------------------------------------------------------------
 * 报告
 * ------------------------------------------------------------ */
const derivations = LEDGER.filter((e) => e.kind === 'derivation');
console.log(`[source-derivation] 枚举面命中 ${hits.length} 个文件：` + hits.map((h) => h.file).join(' · '));
console.log(`[source-derivation] 台账 ${LEDGER.length} 条（派生库 ${derivations.length}：`
    + derivations.map((e) => e.key + (e.writable === false ? '[已证伪]' : '')).join(' · ') + '）');
console.log('[source-derivation] 结构面出口检查：' + derivations.map((e) => {
    const n = (e.exports || []).length + (e.sources || []).reduce((acc, s) => acc + (s.exports || []).length, 0);
    return `${e.key}(${n})`;
}).join(' · '));

if (problems.length) {
    for (const p of problems) console.error('[source-derivation] ✗ ' + p);
    console.error(`[source-derivation] ✗ 共 ${problems.length} 处失配`);
    process.exit(1);
}
console.log('[source-derivation] ✓ 枚举面全部登记 / 登记出口全部在场 / 台账条目全部存活');