/* ========================================================
 * config/tab-source.js — [v3.65.0 · 拓展计划 X1 第一切片] 页签真源快照（声明面）
 * --------------------------------------------------------
 * 【为什么需要这张表】
 *   任务入口要能说「这个入口会把用户送到曲库的歌词页」。这句话是一个**声明**，
 *   而声明的靶心在别的文件里（apps/<id>/<id>-app.js 的 setTab 夹取语句）。
 *   声明与靶心一旦漂移，用户点下去会落在**兜底页**上 —— 不报错、只错结果，
 *   正是本仓最贵的形态。
 *   故本表是「从 apps/** 真源码摘录的**快照**」，并由
 *   `tests/system-v3650_task_entry.test.mjs` 的 B 组**真读源码逐条核**：
 *   源码抽取结果与表逐 appId 比集合相等，漂移即红。
 *   ⇒ 本表不是第二真源，是**可被证伪的声明**。
 *
 * 【table 口径：登记「事实上可达的页签」，不是「setTab 收下的串」】
 *   这两者在本仓**不是一回事**，逐 shape 说明：
 *     · array   —— app 层 `const ok = [...]` 显式夹取。收下 = 可达（形同构）。
 *     · ifchain —— app 层 `if (s === 'a' || s === 'b')` 白名单。收下 = 可达。
 *     · view    —— app 层 `toStr(tab) || '<兜底>'` **不夹取**（收下任意串），
 *                  事实上能渲染出来的页签列在 **view 层的 tabs 数组**里。
 *                  故本条登记 view 层的数组（app 层会收下别的串但渲染等价于兜底页）。
 *     · single  —— app 层不夹取、view 层**没有任何 tab 分支**（单页 App）。
 *                  登记那个唯一的兜底页签；判据核「view 层不含第二个 tab 字面量」。
 *   ⇒ 分 shape 是必要的：把 view/single 混进 array 会让判据核错对象（核到不存在的数组）。
 *
 * 【刻意不做的事】
 *   · 不登记「setTab 收得下但渲染不出来」的串（那正是要做成红的东西）。
 *   · 不在这里 import 任何 App 模块（本表是数据，运行时不加载 App）。
 *   · 不把兜底页签当成白名单成员之外的东西隐藏起来 —— 每条都显式写在 tabs 里。
 * ======================================================== */
'use strict';

/** 本表的存在理由与可证伪方式（供读数展示与判据引用，避免同一句话说三遍）。 */
export const TAB_SOURCE_NOTE = 'apps/** 真源码的页签白名单快照；由 X1 判据 B 组真读源码逐条核，漂移即红。';

/**
 * 逐 App 页签真源。
 * @type {Readonly<Record<string, {tabs: readonly string[], file: string, shape: string, note: string}>>}
 */
export const TABS_BY_APP = Object.freeze({
    /* ---------- shape: array（app 层显式数组夹取） ---------- */
    archive: Object.freeze({
        tabs: Object.freeze(['pack', 'face', 'reset', 'ledger']),
        file: 'apps/archive/archive-app.js', shape: 'array',
        note: '存档台；兜底包页'
    }),
    cotdesk: Object.freeze({
        tabs: Object.freeze(['items', 'config', 'sides', 'ledger']),
        file: 'apps/cotdesk/cotdesk-app.js', shape: 'array',
        note: '思维链案头；兜底条目页'
    }),
    doujin: Object.freeze({
        tabs: Object.freeze(['shop', 'market', 'cart', 'shelf']),
        file: 'apps/doujin/doujin-app.js', shape: 'array',
        note: '同人商店；兜底逛店页'
    }),
    kettle: Object.freeze({
        tabs: Object.freeze(['notes', 'rounds', 'options', 'ledger', 'policy']),
        file: 'apps/kettle/kettle-app.js', shape: 'array',
        note: '对话水壶；兜底笔记页'
    }),
    lofter: Object.freeze({
        tabs: Object.freeze(['home', 'follow', 'me', 'search']),
        file: 'apps/lofter/lofter-app.js', shape: 'array',
        note: '老福特；兜底首页'
    }),
    magazine: Object.freeze({
        tabs: Object.freeze(['list', 'new', 'search', 'settings']),
        file: 'apps/magazine/magazine-app.js', shape: 'array',
        note: '杂志排版；兜底列表页'
    }),
    musicdesk: Object.freeze({
        tabs: Object.freeze(['shelf', 'lyrics', 'queue', 'source', 'form', 'policy']),
        file: 'apps/musicdesk/musicdesk-app.js', shape: 'array',
        note: '曲库案头；兜底书架页（歌词页是本条存在的直接理由）'
    }),
    needsim: Object.freeze({
        tabs: Object.freeze(['needs', 'pool', 'wish', 'memory', 'ledger', 'policy']),
        file: 'apps/needsim/needsim-app.js', shape: 'array',
        note: '需求沙盘；兜底需求页'
    }),
    pixiv: Object.freeze({
        tabs: Object.freeze(['illust', 'novel', 'me', 'search']),
        file: 'apps/pixiv/pixiv-app.js', shape: 'array',
        note: 'Pixiv；兜底小说页（插画页与兜底**不同页**，最易做错的一处）'
    }),
    pvdesk: Object.freeze({
        tabs: Object.freeze(['brief', 'shots', 'cast', 'lyrics', 'compose', 'shelf']),
        file: 'apps/pvdesk/pvdesk-app.js', shape: 'array',
        note: 'PV 案头；兜底简报页'
    }),
    recall: Object.freeze({
        tabs: Object.freeze(['channels', 'fusion', 'ledger', 'policy']),
        file: 'apps/recall/recall-app.js', shape: 'array',
        note: '召回治理台；兜底通道页'
    }),
    soundkit: Object.freeze({
        tabs: Object.freeze(['slots', 'editor', 'share', 'settings']),
        file: 'apps/soundkit/soundkit-app.js', shape: 'array',
        note: '白盒音效盒；兜底槽位页'
    }),
    sourcebook: Object.freeze({
        tabs: Object.freeze(['shelf', 'span', 'tone', 'ledger', 'policy']),
        file: 'apps/sourcebook/sourcebook-app.js', shape: 'array',
        note: '素材书；兜底书架页'
    }),
    /* ---------- shape: ifchain（app 层 if 链白名单） ---------- */
    diagdesk: Object.freeze({
        tabs: Object.freeze(['overview', 'fields', 'pipeline', 'ledger']),
        file: 'apps/diagdesk/diagdesk-app.js', shape: 'ifchain',
        note: '诊断案头；兜底总览页'
    }),
    uterus: Object.freeze({
        tabs: Object.freeze(['board', 'fetuses', 'readings', 'ledger']),
        file: 'apps/uterus/uterus-app.js', shape: 'ifchain',
        note: '子宫画板；兜底画板页'
    }),
    /* ---------- shape: view（app 层不夹取；白名单在 view 层 tabs 数组） ---------- */
    memtable: Object.freeze({
        tabs: Object.freeze(['board', 'templates', 'xml', 'history', 'ledger']),
        file: 'apps/memtable/memtable-view.js', shape: 'view',
        note: '记忆表；app 层 toStr 兜底 board，页签真源在视图'
    }),
    socialguard: Object.freeze({
        tabs: Object.freeze(['board', 'feed', 'contacts', 'check', 'ledger']),
        file: 'apps/socialguard/socialguard-view.js', shape: 'view',
        note: '熟人可见性；app 层 toStr 兜底 board，页签真源在视图'
    }),
    /* ---------- shape: single（单页 App：app 层不夹取、view 层无 tab 分支） ---------- */
    freehome: Object.freeze({
        tabs: Object.freeze(['board']),
        file: 'apps/freehome/freehome-app.js', shape: 'single',
        note: '自由桌面（案头布局）：单页，视图无 tab 分支'
    }),
    lexiscore: Object.freeze({
        tabs: Object.freeze(['board']),
        file: 'apps/lexiscore/lexiscore-app.js', shape: 'single',
        note: '词法计分：单页，视图无 tab 分支'
    }),
    stickerdesk: Object.freeze({
        tabs: Object.freeze(['board']),
        file: 'apps/stickerdesk/stickerdesk-app.js', shape: 'single',
        note: '表情包册：单页，视图无 tab 分支'
    }),
    sullydesk: Object.freeze({
        tabs: Object.freeze(['guard']),
        file: 'apps/sullydesk/sullydesk-app.js', shape: 'single',
        note: '外发前体检：单页，视图无 tab 分支（兜底串是 guard，不是 board —— 三个案头各有各的兜底名）'
    })
});

/** 登记在案的 appId 列表（升序，供判据遍历与读数展示）。 */
export const TAB_SOURCE_APPS = Object.freeze(Object.keys(TABS_BY_APP).slice().sort());

/** shape 取值表（判据按此表逐值分派抽取器；新 shape 必须同时加抽取器）。 */
export const TAB_SHAPES = Object.freeze(['array', 'ifchain', 'view', 'single']);

/**
 * 纯自检（不读 fs、不起宿主）：把表自身的形状问题说清。
 * 注意：这里**不**核「表与源码是否一致」—— 那件事必须真读源码，在判据里做。
 */
export function tabSourceSelfCheck() {
    const problems = [];
    for (const id of TAB_SOURCE_APPS) {
        const row = TABS_BY_APP[id];
        if (!row || !Array.isArray(row.tabs) || !row.tabs.length) { problems.push(id + ' 无页签'); continue; }
        if (TAB_SHAPES.indexOf(row.shape) < 0) problems.push(id + ' shape 非法：' + row.shape);
        if (!row.file || row.file.indexOf('apps/') !== 0) problems.push(id + ' 源文件路径非法');
        if (row.shape === 'single' && row.tabs.length !== 1) problems.push(id + ' single 却登记了 ' + row.tabs.length + ' 个页签');
        if (row.shape !== 'single' && row.tabs.length < 2) problems.push(id + ' ' + row.shape + ' 只登记了 1 个页签（应走 single）');
        const seen = Object.create(null);
        for (const t of row.tabs) {
            if (typeof t !== 'string' || !t) { problems.push(id + ' 页签非字符串'); continue; }
            if (seen[t]) problems.push(id + ' 页签重复：' + t);
            seen[t] = true;
        }
    }
    return { apps: TAB_SOURCE_APPS.length, shapes: TAB_SHAPES.length, problems: problems };
}

/** 页签表的读数（给展示与判据共用；不重复遍历）。 */
export function tabSourceReadings() {
    const byShape = Object.create(null);
    let tabs = 0;
    for (const id of TAB_SOURCE_APPS) {
        const row = TABS_BY_APP[id];
        tabs += row.tabs.length;
        byShape[row.shape] = (byShape[row.shape] || 0) + 1;
    }
    return { apps: TAB_SOURCE_APPS.length, tabs: tabs, byShape: byShape };
}

/**
 * 派生平铺表 `{ appId: string[] }` —— tabState 的入参形状。
 * 为什么不让 tabState 直接吃 TABS_BY_APP：本表每项带 file/shape/note（**登记面**），
 *   判定只需要白名单集合。派生的意义是「判定面不因登记面加字段而改口径」——
 *   下次给本表加一列，判定面一行都不用动。
 * @returns {Readonly<Record<string, readonly string[]>>}
 */
export function tabMapOf() {
    const out = Object.create(null);
    for (const id of TAB_SOURCE_APPS) out[id] = TABS_BY_APP[id].tabs;
    return out;
}

/** 本表覆盖的 appId 集（判定用；`unknown` 就是不在这个集合里）。 */
export function hasTabSource(appId) {
    return Object.prototype.hasOwnProperty.call(TABS_BY_APP, appId);
}
