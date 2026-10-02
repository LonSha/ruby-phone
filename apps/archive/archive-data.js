/* ========================================================
 * archive-data.js — [v3.45.0] 存档台 · 纯函数内核
 *
 * 数据层：本文件（纯函数）  落盘与接线：archive-app.js  视图：archive-view.js
 *
 * ── 源与立场差（素材缝合第 3 层第九件 · EPhone·xintuk main-app 存档一族）
 *   源是**整机主控里的存档按钮集合**：自己开 IndexedDB 全表遍历、自己起
 *   ReadableStream 造下载、自己 window.location.reload()、自己清空宿主的
 *   全部表与 localStorage、自己把整包推给 GitHub。
 *   本件是**存档台** —— 只把**一份包**收拾成可对账的账：包型 / 版本 / 覆盖性 /
 *   表名 / 条数 / 体积 / 结构可疑 / 重置影响，产可复制的要求文本（requestText）。
 *   本件**不写任何宿主数据**：它只回答「这份包是什么、拿它做恢复会发生什么」。
 *
 * ── 四块不缝（源的整套能力，本件一律不接）──────────────
 *   ① 不落库不落外部备份：源 Utils.saveData / IndexedDB 全表 / GitHub 上传；
 *   ② 不下载不上传：源 Blob + URL.createObjectURL + a.click() 造下载，
 *      以及 uploadBackupToGitHub / restoreBackupFromGitHub；
 *   ③ 不出图不压图：源 compressImage / canvas 重编码 / compressAllImagesInDB；
 *   ④ 不读宿主界面元素：源满篇 document.getElementById 直读宿主。
 *
 * ── 四条偏离（逐条对着源的静默失效）──────────────────
 *   ① **包型不许猜**：源靠「有没有 type 字段」三分支，认不出就按全量处理并
 *      **直接覆盖**；本件把包型判成唯一结论并逐因报（含「认不出来」这一态）。
 *   ② **覆盖性不许含糊**：源的「补充式导入」用 bulkPut（同 id 覆盖），而
 *      「330 格式导入」**先 clear 全部表再 bulkAdd** —— 同一个界面上两个按钮，
 *      一个补一个清。本件对每一份包明说 merge / replace，并列出会被清空的表。
 *   ③ **版本号不许只数值比**：源里 version 有**两套语义**（1 = 流式包、
 *      3 = 分块包与 330 包），而 330 导入把 version 不等于 3 直接抛错 ——
 *      拿流式包走 330 导入必报「版本不匹配」。本件报「声明值 / 属于哪一套 / 是否可互认」。
 *   ④ **表不许静默丢**：源的补充式导入只对「包里的表 交 库里的表」开事务，
 *      交集外的表一个字都不说；本件逐表报 已认 / 未认。
 *
 * ── 静默失效形态（本件守的，都不报错、不崩溃，只是结果不对）──
 *   · 包读不出来 **不许**读成「空包」（四态面分开）；
 *   · 表条数取不出来 **不许**画成 0；
 *   · 体积读不出来 **不许**画成 0 字节；
 *   · 重置影响 **不许**只画一个总数（逐键列）。
 *
 * ── 实现纪律 ──────────────────────────────────────────
 *   本件不许出现正则字面量、反斜杠与反引号：一切字符切分走 indexOf / slice / split。
 * ======================================================== */
'use strict';


const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const DQ = String.fromCharCode(34);
const SQ = String.fromCharCode(39);

export const AR_SOURCE_NOTE = 'EPhone·xintuk main-app · 存档一族（分块导出 / 流式导出 / 兼容导出 / 三型导入 / 覆盖式导入 / 全量重置 / 结构体检 / 图片估重）';

export const AR_SOURCE_FILES = Object.freeze([
    { key: '045', file: '045.js', role: '分块导出 + 补充式导入 + 兼容 330 导出 + 330 格式导入', bytes: 32269 },
    { key: '046', file: '046.js', role: '流式导出（逐表写 ReadableStream）+ 全库图片压缩 + 体积读数', bytes: 32643 },
    { key: '049', file: '049.js', role: '全量重置（清全库 + localStorage）+ 全能数据修复', bytes: 30711 },
    { key: '011', file: '011.js', role: '全量备份数据组装 + GitHub 上传 / 恢复 + 定时自动备份', bytes: 33074 },
    { key: '007', file: '007.js', role: '索引库建库 + 旧库（legacy）读取与迁移痕迹', bytes: 52641 }
]);

export const AR_BLOCK_FILE = 'nuo_sources/nuo3/live/blk_xintuk_backup.txt';

/* ══════════ 包型真源 ══════════ */
export const AR_PACKS = Object.freeze([
    { key: 'chunked', label: '分块包', by: 'type = EPhoneChunkedBackup', version: 3, mode: 'merge' },
    { key: 'stream', label: '流式包', by: 'version = 1，顶层直接是表名', version: 1, mode: 'replace' },
    { key: 'compat330', label: '330 兼容包', by: 'version = 3 + timestamp + data', version: 3, mode: 'replace' },
    { key: 'full', label: '全量包', by: '只有 data 与 timestamp', version: 0, mode: 'replace' },
    { key: 'unknown', label: '认不出来', by: '——', version: 0, mode: 'none' }
]);

export const AR_PACK_WHYS = Object.freeze([
    'ok', 'not_object', 'no_version', 'bad_version', 'no_payload', 'empty_contains'
]);

export const AR_PACK_WHY_TEXT = Object.freeze({
    [AR_PACK_WHYS[0]]: '认得出来',
    [AR_PACK_WHYS[1]]: '不是一份对象',
    [AR_PACK_WHYS[2]]: '没有版本号',
    [AR_PACK_WHYS[3]]: '版本号读不出整数',
    [AR_PACK_WHYS[4]]: '没有装着内容的格子',
    [AR_PACK_WHYS[5]]: '清单是空的（一份什么都没有的包）'
});

export const AR_PACK_MODES = Object.freeze([
    { key: 'merge', label: '补充式（同 id 覆盖）', clears: false },
    { key: 'replace', label: '覆盖式（先清空再写入）', clears: true },
    { key: 'none', label: '不适用（认不出来）', clears: false }
]);

/* ══════════ 三张表的真源（源把这三张写死在好几处，本件收成一处） ══════════ */
export const AR_APP_TABLES = Object.freeze([
    { key: 'weibo', label: '微博', tables: ['weiboPosts', 'qzoneSettings'] },
    { key: 'forum', label: '圈子', tables: ['forumGroups', 'forumPosts', 'forumComments', 'forumCategories', 'forumSeries', 'forumChapters'] },
    { key: 'taobao', label: '桃宝', tables: ['taobaoProducts', 'taobaoOrders', 'taobaoCart', 'userWalletTransactions'] },
    { key: 'worldBooks', label: '世界书', tables: ['worldBooks', 'worldBookCategories'] },
    { key: 'dateALive', label: '约会数据', tables: ['datingScenes', 'datingPresets', 'datingSpriteGroups', 'datingSprites', 'datingHistory'] },
    { key: 'tukeyAccounting', label: '记账数据', tables: ['tukeyAccounts', 'tukeyAccountingGroups', 'tukeyAccountingRecords', 'tukeyAccountingReplies', 'tukeyUserSettings', 'tukeyCustomConfig'] },
    { key: 'studio', label: '小剧场数据', tables: ['studioScripts', 'studioHistory', 'studioSessions', 'studioMemories'] },
    { key: 'userStickers', label: '我的表情包', tables: ['userStickers', 'userStickerCategories'] },
    { key: 'charStickers', label: '角色通用表情包', tables: ['charStickers'] },
    { key: 'gameData', label: '游戏大厅数据', tables: ['scriptKillScripts', 'ludoQuestionBanks', 'ludoQuestions'] },
    { key: 'appearance', label: '通用外观预设', tables: ['themes', 'fontPresets', 'homeScreenPresets', 'customAvatarFrames', 'apiPresets', 'bubbleStylePresets'] }
]);

export const AR_RELATED_TABLES = Object.freeze([
    { table: 'memories', key: 'chatId', label: '记忆' },
    { table: 'callRecords', key: 'chatId', label: '通话记录' },
    { table: 'qzonePosts', key: 'authorId', label: '动态' },
    { table: 'weiboPosts', key: 'authorId', label: '微博帖' },
    { table: 'datingHistory', key: 'characterId', label: '约会史' },
    { table: 'pomodoroSessions', key: 'chatId', label: '番茄钟' },
    { table: 'memorySettings', key: 'chatId', label: '记忆设置' },
    { table: 'memoryVectors', key: 'chatId', label: '记忆向量' },
    { table: 'memoryFacts', key: 'chatId', label: '记忆事实' }
]);

export const AR_STREAM_TABLES = Object.freeze([
    'chats', 'apiConfig', 'globalSettings', 'userStickers', 'charStickers', 'worldBooks',
    'musicLibrary', 'personaPresets', 'qzoneSettings', 'qzonePosts', 'qzoneAlbums', 'qzonePhotos',
    'favorites', 'qzoneGroups', 'memories', 'worldBookCategories', 'callRecords',
    'customAvatarFrames', 'themes', 'apiPresets', 'bubbleStylePresets', 'fontPresets',
    'homeScreenPresets', 'weiboPosts', 'forumGroups', 'forumPosts', 'forumComments',
    'forumCategories', 'forumSeries', 'forumChapters', 'tarotReadings', 'pomodoroSessions',
    'scriptKillScripts', 'taobaoProducts', 'taobaoOrders', 'taobaoCart', 'userWalletTransactions',
    'userStickerCategories', 'datingScenes', 'datingPresets', 'datingSpriteGroups', 'datingSprites',
    'datingHistory', 'mcpConnections', 'mcpCapabilities', 'mcpActivities', 'mcpSubscriptions',
    'mcpTasks', 'mcpApprovals', 'mcpSettings', 'promptSettings', 'promptItems', 'promptPresets',
    'promptBindings', 'promptDiagnostics'
]);

export const AR_330_TABLES = Object.freeze([
    'chats', 'worldBooks', 'worldBookCategories', 'userStickers', 'userStickerCategories',
    'apiConfig', 'globalSettings', 'qzonePosts', 'qzoneAlbums', 'qzonePhotos', 'qzoneSettings',
    'personaPresets', 'memories', 'apiPresets', 'favorites', 'musicLibrary', 'callRecords',
    'customAvatarFrames', 'themes', 'bubbleStylePresets', 'fontPresets', 'homeScreenPresets',
    'weiboPosts', 'forumGroups', 'forumPosts', 'forumComments', 'forumCategories', 'forumSeries',
    'forumChapters', 'tarotReadings', 'pomodoroSessions', 'scriptKillScripts', 'taobaoProducts',
    'taobaoOrders', 'taobaoCart', 'userWalletTransactions', 'ludoQuestionBanks', 'ludoQuestions',
    'datingScenes', 'datingPresets', 'datingSpriteGroups', 'datingSprites', 'datingHistory',
    'memorySettings', 'memoryVectors', 'memoryFacts', 'memoryRecallLogs'
]);

export const AR_SINGLE_OBJECT_TABLES = Object.freeze([
    'apiConfig', 'globalSettings', 'musicLibrary', 'qzoneSettings',
    'tukeyUserSettings', 'tukeyCustomConfig', 'tukeyAccountingGroups'
]);

/* ══════════ 结构体检表 ══════════ */
export const AR_REQUIRED = Object.freeze([
    { path: 'history', kind: 'array', label: '聊天历史', fix: '补成空表', scope: 'both' },
    { path: 'settings', kind: 'object', label: '设置', fix: '补成空对象', scope: 'both' },
    { path: 'status', kind: 'object', label: '在线状态', fix: '补成在线', scope: 'both' },
    { path: 'members', kind: 'array', label: '群成员', fix: '补成空表', scope: 'group' },
    { path: 'relationship', kind: 'object', label: '关系', fix: '补成好友', scope: 'single' },
    { path: 'characterPhoneData', kind: 'object', label: '角色手机数据', fix: '补成空对象', scope: 'single' }
]);

export const AR_TABLE_SHAPES = Object.freeze(['missing', 'array', 'object', 'null', 'scalar', 'absent']);

/* ══════════ 上限真源 ══════════ */
export const AR_BUNDLE_MAX = 40;
export const AR_TEXT_MAX = 40000;
export const AR_LOG_MAX = 60;
export const AR_TABLE_MAX = 200;
export const AR_ROWS_SHOWN = 60;

export const AR_GAUGE_KEYS = Object.freeze(['pack', 'tables', 'rows', 'logs']);

/* ══════════ 基础工具 ══════════ */
/** 清文本（不写正则：先用字符表把 CR 与 TAB 换掉再 trim）。 */
export function cleanText(v) {
    if (typeof v !== 'string') return '';
    let s = '';
    for (let i = 0; i < v.length; i++) {
        const c = v.charAt(i);
        if (c === CR) continue;
        s += (c === TAB) ? ' ' : c;
    }
    return s.trim();
}
export function charCount(s) {
    return (typeof s === 'string') ? s.length : 0;
}
/** 数：取不出来返回 null（**不返回 0**）。 */
export function numOrNull(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    let digits = '';
    let seenDot = false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if (c >= '0' && c <= '9') { digits += c; continue; }
        if (c === '.' && !seenDot) { seenDot = true; digits += c; continue; }
        if (digits) break;
    }
    if (!digits || digits === '.') return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
}
export function intOrNull(v) {
    const n = numOrNull(v);
    if (n === null) return null;
    return Math.trunc(n);
}
export function isIntLike(v) {
    if (typeof v === 'number') return Number.isInteger(v);
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s) return false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if (c < '0' || c > '9') return false;
    }
    return true;
}
/** 对象判定（不写正则）。 */
export function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/* ══════════ 包型裁定（唯一一处） ══════════ */
export function classifyBundle(input) {
    const base = {
        pack: 'unknown', label: '认不出来', why: 'not_object', version: null,
        mode: 'none', tables: [], contains: [], knowledge: 0
    };
    if (!isPlainObject(input)) return base;
    const hasType = (typeof input.type === 'string') && input.type.length > 0;
    const hasData = isPlainObject(input.data);

    const rawVersion = input.version;
    const hasVersion = (rawVersion !== undefined && rawVersion !== null && rawVersion !== '');
    if (!hasVersion) { base.why = 'no_version'; return base; }
    if (!isIntLike(rawVersion)) { base.why = 'bad_version'; return base; }
    const version = Number((typeof rawVersion === 'string') ? rawVersion.trim() : rawVersion);
    base.version = version;

    if (hasType && input.type === 'EPhoneChunkedBackup') {
        if (version !== 3) { base.why = 'bad_version'; return base; }
        const contains = Array.isArray(input.contains) ? input.contains.slice() : [];
        const tables = hasData ? Object.keys(input.data) : [];
        base.pack = 'chunked'; base.label = '分块包'; base.mode = 'merge';
        base.contains = contains;
        base.tables = tables;
        if (!contains.length && !tables.length) { base.why = 'empty_contains'; return base; }
        base.why = 'ok';
        return base;
    }

    if (!hasData && version === 1) {
        const keys = Object.keys(input);
        const tables = [];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (k === 'version' || k === 'timestamp' || k === 'type' || k === 'contains') continue;
            tables.push(k);
        }
        base.tables = tables;
        if (!tables.length) { base.why = 'no_payload'; return base; }
        base.pack = 'stream'; base.label = '流式包'; base.mode = 'replace';
        base.why = 'ok';
        return base;
    }

    if (hasData && version === 3) {
        const tables = Object.keys(input.data);
        base.tables = tables;
        if (!tables.length) { base.why = 'no_payload'; return base; }
        base.pack = 'compat330'; base.label = '330 兼容包'; base.mode = 'replace';
        base.why = 'ok';
        return base;
    }

    if (hasData) {
        const tables = Object.keys(input.data);
        base.tables = tables;
        if (!tables.length) { base.why = 'no_payload'; return base; }
        base.pack = 'full'; base.label = '全量包'; base.mode = 'replace';
        base.why = 'ok';
        return base;
    }

    base.why = 'no_payload';
    return base;
}

/* ══════════ 版本面（两套语义） ══════════ */
export function versionFace(ver, pack) {
    const p = (typeof pack === 'string') ? pack : 'unknown';
    const n = (ver === null || ver === undefined) ? null : (isIntLike(ver) ? Number(ver) : null);
    let family = 'none';
    let text = '--';
    if (n === 1) { family = 'stream'; text = '流式那一套'; }
    else if (n === 3) { family = 'v3'; text = 'v3 那一套（分块 / 330 / 全量）'; }
    else if (n === 0) { family = 'zero'; text = '没有版本号'; }
    else if (n !== null) { family = 'other'; text = '别的值（源会当场抛错）'; }
    let crossOk = false;
    let crossWhy = '认不出来的包不给互认结论';
    if (p === 'stream') {
        crossOk = (n === 1);
        crossWhy = crossOk ? '流式包：走流式恢复' : '声明值不是 1，源会判坏包';
    } else if (p === 'chunked' || p === 'compat330' || p === 'full') {
        crossOk = (n === 3);
        crossWhy = crossOk ? 'v3 那一套：三型可互走 330 导入（先清空）' : '声明值不是 3，330 导入会抛错';
    }
    return { declared: n, pack: p, family, text, crossOk, crossWhy };
}

/* ══════════ 覆盖性面 ══════════ */
export function overwriteFace(pack, tables, knownTables) {
    const known = Array.isArray(knownTables) ? knownTables : [];
    const list = Array.isArray(tables) ? tables : [];
    let mode = 'none';
    for (let i = 0; i < AR_PACKS.length; i++) {
        if (AR_PACKS[i].key === pack) { mode = AR_PACKS[i].mode; break; }
    }
    let modeLabel = '不适用（认不出来）';
    let clears = false;
    for (let i = 0; i < AR_PACK_MODES.length; i++) {
        if (AR_PACK_MODES[i].key === mode) {
            modeLabel = AR_PACK_MODES[i].label;
            clears = AR_PACK_MODES[i].clears;
            break;
        }
    }
    const merged = [];
    const unknown = [];
    for (let i = 0; i < list.length; i++) {
        if (known.length && known.indexOf(list[i]) < 0) unknown.push(list[i]);
        else merged.push(list[i]);
    }
    let modeText = modeLabel;
    if (mode === 'merge') modeText = '补充式：同 id 的行被覆盖，别的行留着';
    else if (mode === 'replace') modeText = '覆盖式：这些表先被清空再写入';
    else if (mode === 'none') modeText = '认不出来 —— 源在这里会按全量处理并直接覆盖';
    return {
        mode: mode, modeLabel: modeLabel, modeText: modeText, clears: clears,
        clearsTables: clears ? merged.slice() : [],
        mergeTables: merged,
        unknownTables: unknown
    };
}

/* ══════════ 表面（逐表条数 / 形态） ══════════ */
export function tableFace(data, tables) {
    const out = [];
    const obj = isPlainObject(data) ? data : null;
    const list = Array.isArray(tables) ? tables : [];
    for (let i = 0; i < list.length; i++) {
        const name = String(list[i]);
        const single = AR_SINGLE_OBJECT_TABLES.indexOf(name) >= 0;
        if (!obj) {
            out.push({ table: name, shape: 'absent', rows: null, label: '这份包没有装内容的格子',
                suspect: true, suspectWhy: 'no_payload', single: single });
            continue;
        }
        const has = Object.prototype.hasOwnProperty.call(obj, name);
        if (!has) {
            out.push({ table: name, shape: 'missing', rows: null, label: '包里没这一张表',
                suspect: false, suspectWhy: '', single: single });
            continue;
        }
        const v = obj[name];
        if (Array.isArray(v)) {
            out.push({ table: name, shape: 'array', rows: v.length, label: String(v.length) + ' 条',
                suspect: single, suspectWhy: single ? '这一张源按单对象读，给的是数组' : '', single: single });
            continue;
        }
        if (v === null) {
            out.push({ table: name, shape: 'null', rows: null, label: '空（null）',
                suspect: !single, suspectWhy: single ? '' : '这一张源按数组读，给的是 null', single: single });
            continue;
        }
        if (typeof v === 'object') {
            out.push({ table: name, shape: 'object', rows: 1, label: '单对象',
                suspect: !single, suspectWhy: single ? '' : '这一张源按数组读，给的是对象', single: single });
            continue;
        }
        out.push({ table: name, shape: 'scalar', rows: null, label: '不是数组也不是对象',
            suspect: true, suspectWhy: '源在这一表上会静默跳过', single: single });
    }
    return out;
}

export function tableSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let present = 0, missing = 0, suspect = 0, totalRows = 0, rowsUnknown = 0;
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.shape === 'missing' || r.shape === 'absent') missing += 1;
        else present += 1;
        if (r.suspect) suspect += 1;
        if (r.rows === null) rowsUnknown += 1;
        else totalRows += r.rows;
    }
    return {
        tables: list.length, present: present, missing: missing, suspect: suspect,
        rows: totalRows, rowsUnknown: rowsUnknown,
        empty: present > 0 && totalRows === 0
    };
}

export function tableMembership(name) {
    const n = String(name);
    return {
        stream: AR_STREAM_TABLES.indexOf(n) >= 0,
        t330: AR_330_TABLES.indexOf(n) >= 0,
        single: AR_SINGLE_OBJECT_TABLES.indexOf(n) >= 0
    };
}

export function tableDiffs() {
    const onlyStream = [];
    const only330 = [];
    for (let i = 0; i < AR_STREAM_TABLES.length; i++) {
        if (AR_330_TABLES.indexOf(AR_STREAM_TABLES[i]) < 0) onlyStream.push(AR_STREAM_TABLES[i]);
    }
    for (let i = 0; i < AR_330_TABLES.length; i++) {
        if (AR_STREAM_TABLES.indexOf(AR_330_TABLES[i]) < 0) only330.push(AR_330_TABLES[i]);
    }
    return { onlyStream: onlyStream, only330: only330, streamTotal: AR_STREAM_TABLES.length, t330Total: AR_330_TABLES.length };
}

/* ══════════ 体积面 ══════════ */
export function formatBytes(n) {
    const v = numOrNull(n);
    if (v === null || v < 0) return '--';
    if (v < 1024) return String(Math.round(v)) + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / (1024 * 1024)).toFixed(2) + ' MB';
}

export function sizeOf(text) {
    if (typeof text !== 'string') {
        return { chars: null, bytes: null, bytesText: '--', blank: true, why: 'no_text' };
    }
    if (!text.length) {
        return { chars: 0, bytes: 0, bytesText: '0 B', blank: false, why: 'empty' };
    }
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else bytes += 3;
    }
    return { chars: text.length, bytes: bytes, bytesText: formatBytes(bytes), blank: false, why: 'ok' };
}

export function base64Size(s) {
    if (typeof s !== 'string' || !s.length) return 0;
    let body = s;
    const comma = body.indexOf(String.fromCharCode(44));
    if (comma >= 0 && comma < 64) body = body.slice(comma + 1);
    return Math.round(body.length * 0.75);
}

/** 扫一段文本里的 base64 图片串（**不引正则** —— 按特征词切）。 */
export function imageScan(text) {
    if (typeof text !== 'string' || !text.length) {
        return { count: 0, bytes: 0, bytesText: '--', blank: true };
    }
    const mark = 'data:image/';
    let from = 0;
    let count = 0;
    let bytes = 0;
    while (true) {
        const at = text.indexOf(mark, from);
        if (at < 0) break;
        let end = text.indexOf(DQ, at);
        const sq = text.indexOf(SQ, at);
        if (sq >= 0 && (end < 0 || sq < end)) end = sq;
        const stop = text.indexOf(String.fromCharCode(41), at);
        if (stop >= 0 && (end < 0 || stop < end)) end = stop;
        if (end < 0) end = text.length;
        bytes += base64Size(text.slice(at, end));
        count += 1;
        from = end > at ? end : (at + mark.length);
    }
    return { count: count, bytes: bytes, bytesText: formatBytes(bytes), blank: false };
}

/* ══════════ 结构体检 ══════════ */
export function auditOf(records, isGroup) {
    if (!Array.isArray(records)) {
        return { checked: 0, items: [], total: 0, blank: true, why: 'no_records' };
    }
    const items = [];
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const misses = [];
        if (!isPlainObject(r)) {
            misses.push({ path: 'this', label: '本条不是对象', kind: 'object', fix: '整条重建', scope: 'both' });
            items.push({ index: i, label: '(第 ' + String(i + 1) + ' 条)', misses: misses });
            continue;
        }
        for (let k = 0; k < AR_REQUIRED.length; k++) {
            const def = AR_REQUIRED[k];
            if (def.scope === 'group' && isGroup !== true) continue;
            if (def.scope === 'single' && isGroup === true) continue;
            const v = r[def.path];
            let bad = false;
            if (def.kind === 'array') bad = !Array.isArray(v);
            else if (def.kind === 'object') bad = !isPlainObject(v);
            if (bad) {
                misses.push({ path: def.path, label: def.label, kind: def.kind, fix: def.fix, scope: def.scope });
            }
        }
        const name = cleanText(r.name) || '(没有名字)';
        items.push({ index: i, label: name, misses: misses });
    }
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i].misses.length;
    return { checked: items.length, items: items, total: total, blank: items.length === 0, why: items.length ? 'ok' : 'empty' };
}

/* ══════════ 重置面 ══════════ */
export function resetPlan(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const e = isPlainObject(list[i]) ? list[i] : {};
        const n = numOrNull(e.rows);
        out.push({
            key: String(e.key || ''), label: cleanText(e.label) || '(未命名)',
            rows: n, text: n === null ? '--' : (String(n) + ' 条')
        });
    }
    return out;
}

export function resetSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let total = 0, unknown = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i].rows === null) unknown += 1;
        else total += list[i].rows;
    }
    return { keys: list.length, rows: total, unknown: unknown, trusty: unknown === 0 };
}

/* ══════════ 台账 ══════════ */
export function arTrim(list, max) {
    const src = Array.isArray(list) ? list : [];
    const capInt = intOrNull(max);
    const cap = (capInt === null || capInt <= 0) ? AR_LOG_MAX : capInt;
    if (src.length <= cap) return { rows: src.slice(), dropped: 0 };
    const cut = src.length - cap;
    return { rows: src.slice(cut), dropped: cut };
}

/* ══════════ 余量面 ══════════ */
export function gaugesOf(input) {
    const src = isPlainObject(input) ? input : {};
    const defs = [
        { key: 'pack', label: '已收包', max: AR_BUNDLE_MAX },
        { key: 'tables', label: '逐表读数', max: AR_TABLE_MAX },
        { key: 'rows', label: '包内条数', max: AR_TABLE_MAX },
        { key: 'logs', label: '动作台账', max: AR_LOG_MAX }
    ];
    const out = [];
    for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        const v = intOrNull(src[d.key]);
        const over = (v !== null && v > d.max);
        out.push({
            key: d.key, label: d.label, value: v, max: d.max, over: over,
            blank: v === null,
            pct: v === null ? 0 : Math.min(100, Math.round((v / d.max) * 100)),
            text: v === null ? '--' : (String(v) + ' / ' + String(d.max))
        });
    }
    return out;
}
export function gaugeText(cell) {
    if (!isPlainObject(cell)) return '--';
    if (cell.blank) return '--';
    return String(cell.value) + ' / ' + String(cell.max);
}

/* ══════════ 要求文本（本件唯一的产出物） ══════════ */
export function requestText(face, target, mode) {
    const f = isPlainObject(face) ? face : {};
    const t = cleanText(target);
    const m = cleanText(mode);
    const lines = [];
    lines.push('请按下面这份存档做恢复对账，不要替我写入任何数据。');
    lines.push('包型：' + (f.label || '认不出来') + '；版本声明：' + (f.version === null ? '没有' : String(f.version)));
    const tabs = Array.isArray(f.tables) ? f.tables : [];
    if (tabs.length) {
        const head = tabs.slice(0, 12).join('、');
        lines.push('涉及表 ' + String(tabs.length) + ' 张：' + head + (tabs.length > 12 ? ' 等' : ''));
    }
    lines.push('导入语义：' + (f.modeText || '——'));
    if (t) lines.push('目标：' + t);
    if (m) lines.push('追加要求：' + m);
    lines.push('逐表报出：条数、形态可疑的表、包里没提的表；清空类操作先把将被清空的表列全再问一次。');
    return lines.join(NL);
}

/* ══════════ 包原文的浅解析 ══════════ */
export function extractObject(text) {
    const s = (typeof text === 'string') ? text : '';
    if (!s.length) return { ok: false, why: 'empty', value: null };
    const hasBrace = s.indexOf('{') >= 0 || s.indexOf('}') >= 0;
    if (!hasBrace) return { ok: false, why: 'no_bracket', value: null };
    let v = null;
    try { v = JSON.parse(s); }
    catch (e) { return { ok: false, why: 'bad_json', value: null }; }
    if (!isPlainObject(v)) return { ok: false, why: 'bad_json', value: null };
    return { ok: true, why: 'ok', value: v };
}

