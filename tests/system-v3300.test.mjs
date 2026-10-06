// tests/system-v3300.test.mjs — 恋爱空间（天数 / 足迹 / 心情日记 / 情书 / 问答）[v3.30.0]
//
//   本版接的是素材缝合路线图 **第 2 层第二件**：
//     恋爱空间（情侣空间）—— 源 EPhone·xintuk `runtime/scripts/lovers-space/{001,002,003,004}.js`
//     （打包载荷 174001 字节 / 1470+918+930 行 / 77 个函数）。
//
//   ★ 起手复算（复算见 TODO.md / 每次起手必须重新量）：
//     路线图把本件写成「恋爱空间（情侣空间）170KB」；实测源把**六件事**塞进同一个
//     `chat.loversSpaceData`：① 在一起天数 ② 今日足迹 ③ 心情日记 + 心情罐子
//     ④ 情书 ⑤ 提问与回答 ⑥ 说说 / 相册 / 照片 / 分享。本件取 ①②③④⑤ 五块。
//     缺口复算：`情侣空间` / `恋爱空间` / `loversSpace` 全仓 0 命中（真缺口）；
//     `情书` 落在 data/gacha-items.js 与 data/dirtytalk*.js（噪声）；
//     `纪念日` / `anniversary` 落在 apps/calendar/（已有权威）。
//
//   缝合**不是搬运**。本件有一份「源有本仓不能有」的清单，本套件守的就是「它们没被搬进来」：
//     · 源**说说 / 相册 / 照片 / 分享**与本仓 `apps/weibo/` 是同一件事的第二份实现
//       —— 本仓的纪律是「同一件事不许有两个权威」（用户在哪儿发都可能另一半看不见）。
//       F5 守这条。
//     · 源**番茄钟 + 白噪音**（`pomodoroState` / `bgmAudio = new Audio()` / `setInterval`）
//       与本仓 `apps/focus/`（v3.21.0）同族；且「一个模块里两处计时器」正是本仓忌的形态。
//     · 源**直连模型**（`handleGenerateDailyActivity` 自己拼 systemPrompt 去
//       `fetch(proxyUrl + '/v1/chat/completions')`）—— 本仓模型调用走宿主生成侧。
//       App 不自己发请求，也不替用户编一整天足迹。
//     · 源**落 Dexie 并往 `chat.history` 塞隐藏系统消息**（`db.chats.put(chat)` /
//       `chat.history.push({ role:'system', isHidden:true })`）—— 本仓零数据库铁律
//       （落 PhoneStorage、键走 `^lover_`），且**不替宿主往对话里写楼层**。
//     · 源 **12 条外链素材**（`i.postimg.cc` 背景 + 网易云 / QQ 音乐搜索接口）—— 一条不收。
//
//   四条**偏离**（偏离不是遗漏，逐条与文件头同源）：
//     ① 不做实时定时器：源 `setInterval(…, 60 * 1000)` 每分钟重画「到点显形」；
//        本件一个定时器都不转，每次取数用 `now` 一次性算出「到此刻哪些条已经到点」；
//     ② 时间一律**本地时区**：「到点显形」与「一天只有一次」都建在本地日上，
//        而源用 `toISOString().split('T')[0]` 取 **UTC 日期串**（东八区 00:00–07:59 会记到昨天）；
//     ③ 足迹一天封顶 24 条（源无上限），超出的**如实计数**（`overCap`）而不是静默丢；
//     ④ 心情日记的空串归一成「没记」（源写空串也算「有记录」⇒ 日历上出现点不进去的格子）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 天数：**首日即第 1 天**（源 `+ 1`）/ 起算日在未来 ⇒ 「还没记录」而不是负数 /
//       `2026-02-30` 这种看着像日期的假日期必须拒（源直接 `new Date`，会静默顺延成 3-02）/
//       本地日归零再算差（跨天不许靠毫秒差误算一天）；
//     B 足迹：`HH:mm` → 当天毫秒时刻（非法**不抛**）/ **到点才显形**（未来的不许提前显形）/
//       到点显形关掉时整天一次画全 / 一天封顶 24 并如实计数 / 坏行如实丢弃并计数；
//     C 日记：空串归一成「没记」（`hasDiary` 判内容非空）/ 日历前导空格 = 1 号是周几 /
//       格子数与当月天数一致 / **心情罐子顺序可复算**（源 `for…in` 依赖对象键序）；
//     D 情书：**回信收发对调** / **回自己的信直接拒收**（源会产出「我 → 我」的怪信）/
//       上限丢**最旧** / 坏条目如实丢弃并计数；
//     E 问答：**三态不许塌成两态** / 已答过的再答拒收 / 替对方答拒收 / 找不到不静默成功；
//     F 投影与注入：归因先判可读 / 空投影不编数 / 注入只给事实、无内容则空串（不产生空块）/
//       头行必须带换行（桃宝那一版漏了，本件照同形守）；
//     G 接线：四处注册齐备（槽位名 `loverApp` 驼峰）/ 视图调用面闭合在 App 上 /
//       样式源与 phone.css 逐字同源且类名有落点 / 前缀全仓唯一 / 四件套齐备 + 六块禁区没进来；
//     H 键归属：六条新键在门禁账本里且 scope=chat；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（十五条）；
//     J 判据工具自证：剥注释器两向、替换必须保真、锚点必须在场；
//     V 版本锚（下限形）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/loverspace/<file>.js`），否则相对 import 会解析错位置、首跑即假红；
//   判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   取段纪律：v3.30.0 接的是**当前末段** ⇒ 取段取到文件尾；但判据里先自证
//   「本段之后没有别的段头」——下版往后接段时这条会**主动报红**，提醒改回按下一个段头截断。
//   （v3.29.0 那套件就是在 v3.30.0 接段后报的红，本轮已按当时的约定改成按段头截断。）
//
//   批次纪律（本版特有，与 v3.29.0 同）：第二批全部做完前**只跑单套件**
//   （`node --test tests/system-v3300.test.mjs`），不跑全链 `check-file.mjs` ——
//   避免中途的噪声红掩盖真实回归。故本版条目里没有「全链收尾读数」，
//   只有「验证边界（诚实登记）」，全链读数留到第二批成套后那一版补。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    LOVER_REASONS, LOVER_FACES, LOVER_LIMITS, DEFAULT_LOVER_SETTINGS, QUESTION_STATES,
    defaultLoverSettings, normalizeLoverSettings, readLoverFace,
    localDateStr, startOfLocalDay, daysTogether, parseDateInput,
    normalizeFootprints, atFromHHMM, hhmmOf, visibleFootprints, canRegisterToday,
    normalizeDiaryEntry, hasDiary, splitDateStr, daysInMonth, calendarGrid, moodJar,
    composeLetter, composeIncoming, normalizeLetters,
    questionState, normalizeQuestion, askQuestion, answerQuestion, removeQuestion,
    projectLover, loverPromptBlock, faceSummary,
    isValidDateStr, pruneFootprintStore, footprintsOf, putFootprints, pruneDiaryStore,
    parseFootprintLines, parseLetterInput, parseDiaryInput,
} from '../apps/loverspace/loverspace-data.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_REL = 'apps/loverspace/loverspace-data.js';
const APP_REL = 'apps/loverspace/loverspace-app.js';
const VIEW_REL = 'apps/loverspace/loverspace-view.js';
const CSS_REL = 'apps/loverspace/loverspace.css';
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
const DAY = 24 * 60 * 60 * 1000;

/** 剥注释（字符状态机，与 v3200 / v3250 / v3260 / v3270 / v3290 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`setInterval`、`Dexie`、`chat.history`、
 *    `postimg`、`/v1/chat/completions`…）是**说明**不是**消费**。
 *    判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

/** 本地某天的 0 点（判据夹具用；不依赖被测件）。 */
const local0 = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
/** 固定夹具时刻：2026-09-15 12:00（本地）。 */
const T0 = local0(2026, 9, 15) + 12 * 60 * 60 * 1000;
/** 当天 `HH:mm` 的毫秒时刻（本地）。 */
const at = (hh, mm) => local0(2026, 9, 15) + (hh * 60 + mm) * 60 * 1000;

/** 一封最简来信（判据夹具）。
 *  ★ `senderName` **故意与角色名不同**：回信的口径是「收信人取**原信的发信人**」，
 *    若夹具把两者写成同一个名字，那条断言在「照抄 charName」的实现上也一样绿 —— 属
 *    本仓记过的「夹具不区分则判据空转」。下面 letterProblems 里有夹具自证。 */
const mkIncoming = (over) => ({
    id: 'L1', senderId: 'char', senderName: '樱子', senderAvatar: null,
    recipientId: 'user', recipientName: '阿柚', recipientAvatar: null,
    content: '今天想你了', timestamp: 1000, replyToId: null, ...(over || {}),
});

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A 天数：首日即第 1 天 / 跨天不许算错 / 假日期必须拒 ── */
function daysProblems(api) {
    const bad = [];
    const d0 = local0(2026, 1, 1);
    /* ★ 首日即第 1 天（源 `Math.ceil(差 / 一天) + 1`）—— 差一天是最常见的错法。 */
    if (api.daysTogether(d0, d0) !== 1) bad.push('day0:' + api.daysTogether(d0, d0));
    if (api.daysTogether(d0, d0 + DAY) !== 2) bad.push('day1:' + api.daysTogether(d0, d0 + DAY));
    if (api.daysTogether(d0, d0 + 30 * DAY) !== 31) bad.push('day30:' + api.daysTogether(d0, d0 + 30 * DAY));
    /* ★ 跨天不许靠毫秒差误算：同一天内不管几点都算第 1 天。 */
    if (api.daysTogether(d0, d0 + 23 * 60 * 60 * 1000) !== 1) bad.push('same-day-late');
    if (api.daysTogether(d0 + 23 * 60 * 60 * 1000, d0 + 25 * 60 * 60 * 1000) !== 2) bad.push('cross-day');
    /* ★ 本地日归零：跨月的 30 天不许因为时区/夏令时算出 29 或 31。 */
    if (api.daysTogether(local0(2026, 2, 1), local0(2026, 3, 1)) !== 29) {
        bad.push('feb-to-mar:' + api.daysTogether(local0(2026, 2, 1), local0(2026, 3, 1)));
    }
    /* 起算日在未来 ⇒ null（「还没开始」与「没设」在界面上同一句话，但不是负数）。 */
    if (api.daysTogether(d0 + DAY, d0) !== null) bad.push('future:' + api.daysTogether(d0 + DAY, d0));
    /* 缺失 / 非法 ⇒ null（**不抛**：一个坏字符串不该让整个空间打不开）。 */
    for (const v of [null, undefined, '', 'x', '2026-13-01', '2026-02-30', '1900-01-01', NaN, {}]) {
        if (api.daysTogether(v, T0) !== null) bad.push('bad-start:' + String(v));
    }
    /* 数字与 Date 也接受（宿主可能给毫秒）。 */
    if (api.daysTogether(d0, T0) === null) bad.push('number-start');
    if (api.parseDateInput(new Date(2026, 0, 1)) === null) bad.push('date-input');
    /* ★ `2026-02-30` 是最阴的一种：看着像日期，`new Date` 会静默顺延成 3-02。 */
    if (api.parseDateInput('2026-02-30') !== null) bad.push('feb30');
    if (api.parseDateInput('2026-02-29') !== null) bad.push('feb29-nonleap');
    if (api.parseDateInput('2024-02-29') === null) bad.push('feb29-leap');
    /* 本地日期串（★ 偏离②：源取 UTC 串）。 */
    if (api.localDateStr(local0(2026, 9, 5) + 3 * 60 * 60 * 1000) !== '2026-09-05') {
        bad.push('local-str:' + api.localDateStr(local0(2026, 9, 5) + 3 * 60 * 60 * 1000));
    }
    return bad;
}

/* ── B 足迹：到点才显形 / 封顶如实计数 / 坏行如实丢 ── */
function footprintProblems(api) {
    const bad = [];
    const L = api.LOVER_LIMITS;
    /* `HH:mm` → 当天毫秒时刻；非法一律 null（**不抛**）。 */
    if (api.atFromHHMM('08:30', T0) !== at(8, 30)) bad.push('at-0830:' + api.atFromHHMM('08:30', T0));
    if (api.atFromHHMM('8:30', T0) !== at(8, 30)) bad.push('at-830');
    if (api.atFromHHMM('23:59', T0) !== at(23, 59)) bad.push('at-2359');
    if (api.atFromHHMM('00:00', T0) !== at(0, 0)) bad.push('at-0000');
    for (const v of ['24:00', '08:60', '8', '8：30', '', null, undefined, 'abc', '08:3']) {
        if (api.atFromHHMM(v, T0) !== null) bad.push('at-bad:' + String(v));
    }
    if (api.hhmmOf(at(8, 5)) !== '08:05') bad.push('hhmm:' + api.hhmmOf(at(8, 5)));
    /* 规范化：坏条目（时间认不出 / 描述空）**如实丢弃并计数**，不静默吞。 */
    const n = api.normalizeFootprints([
        { time: '08:30', description: '起床', icon: '🌤', duration: '30分' },
        { time: 'bogus', description: '认不出' },
        { time: '09:00', description: '   ' },
        null,
        { time: '12:00', description: '午饭', html_snippet: '<b>x</b>' },
    ], T0);
    if (n.list.length !== 2) bad.push('norm-keep:' + n.list.length);
    if (n.dropped !== 3) bad.push('norm-dropped:' + n.dropped);
    if (n.list[0].time !== '08:30' || n.list[0].at !== at(8, 30)) bad.push('norm-at');
    if (n.list[1].snippet !== '<b>x</b>') bad.push('norm-snippet:' + n.list[1].snippet);
    /* 排序：按时刻升序（源靠数组顺序，模型给乱序就乱画）。 */
    const s2 = api.normalizeFootprints([{ time: '18:00', description: 'b' }, { time: '07:00', description: 'a' }], T0);
    if (s2.list[0].time !== '07:00') bad.push('norm-sort');
    /* ★ 到点才显形：未来的不许提前显形。 */
    const list = api.normalizeFootprints([
        { time: '08:00', description: '过去' },
        { time: '12:00', description: '正点' },
        { time: '20:00', description: '未来' },
    ], T0).list;
    const vis = api.visibleFootprints(list, at(12, 0), true);
    if (vis.visible.length !== 2) bad.push('vis-count:' + vis.visible.length);
    if (vis.hidden !== 1) bad.push('vis-hidden:' + vis.hidden);
    if (vis.allShown !== false) bad.push('vis-allshowed');
    const vis2 = api.visibleFootprints(list, at(23, 0), true);
    if (vis2.hidden !== 0 || vis2.allShown !== true) bad.push('vis-all:' + JSON.stringify(vis2.hidden));
    /* 关掉到点显形 ⇒ 整天一次画全（写复盘时好用）。 */
    const off = api.visibleFootprints(list, at(0, 30), false);
    if (off.visible.length !== 3 || off.hidden !== 0) bad.push('vis-off');
    /* ★ 封顶如实计数：超出 24 条的**截到 24 并报 overCap**（源无上限）。 */
    const many = [];
    for (let i = 0; i < L.maxFootprintsPerDay + 5; i += 1) {
        many.push({ time: String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'), description: 'x' + i });
    }
    const cap = api.normalizeFootprints(many, T0);
    if (cap.list.length !== L.maxFootprintsPerDay) bad.push('cap:' + cap.list.length);
    if (cap.overCap !== 5) bad.push('cap-over:' + cap.overCap);
    /* 一天一次的门：有记录就不给记，`force` 是显式覆盖。 */
    const g1 = api.canRegisterToday([], T0, true, false);
    if (g1.ok !== true || g1.reason !== 'allowed') bad.push('gate-empty');
    const g2 = api.canRegisterToday([{ time: '08:00' }], T0, true, false);
    if (g2.ok !== false || g2.reason !== 'today-already') bad.push('gate-again');
    const g3 = api.canRegisterToday([{ time: '08:00' }], T0, true, true);
    if (g3.ok !== true || g3.reason !== 'forced') bad.push('gate-force');
    const g4 = api.canRegisterToday([{ time: '08:00' }], T0, false, false);
    if (g4.ok !== true) bad.push('gate-off');
    return bad;
}

/* ── C 日记：空串≠有记录 / 日历对齐 / 罐子顺序可复算 ── */
function diaryProblems(api) {
    const bad = [];
    const L = api.LOVER_LIMITS;
    /* ★ 空串归一成「没记」：`null` 与 `''` 都是没记。 */
    const e0 = api.normalizeDiaryEntry({ userEmoji: '  ', userDiary: '', charEmoji: null, charDiary: undefined });
    if (e0.userEmoji !== null || e0.userDiary !== null || e0.charEmoji !== null || e0.charDiary !== null) {
        bad.push('empty-null:' + JSON.stringify(e0));
    }
    if (api.hasDiary(e0) !== false) bad.push('empty-hasdiary');
    if (api.hasDiary(null) !== false) bad.push('null-hasdiary');
    /* 只有 emoji 也算记过（源「只挑了个表情」也是记录）。 */
    if (api.hasDiary(api.normalizeDiaryEntry({ userEmoji: '☀' })) !== true) bad.push('emoji-only');
    if (api.hasDiary(api.normalizeDiaryEntry({ charDiary: '他今天很累' })) !== true) bad.push('text-only');
    /* 截断不拒收。 */
    const long = api.normalizeDiaryEntry({ userDiary: 'x'.repeat(2000), userEmoji: 'y'.repeat(20) });
    if (long.userDiary.length !== L.maxTextLen) bad.push('trunc-text:' + long.userDiary.length);
    if (long.userEmoji.length !== L.maxEmojiLen) bad.push('trunc-emoji:' + long.userEmoji.length);
    /* 日期串反查（防 2026-02-30）。 */
    if (api.splitDateStr('2026-02-30') !== null) bad.push('split-feb30');
    if (api.isValidDateStr('2026-09-15') !== true) bad.push('valid-str');
    if (api.isValidDateStr('2026-09-31') !== true && false) bad.push('never');
    /* 该月天数：2 月闰年 29 / 平年 28；小月 30、大月 31。 */
    if (api.daysInMonth(2026, 2) !== 28) bad.push('feb2026:' + api.daysInMonth(2026, 2));
    if (api.daysInMonth(2024, 2) !== 29) bad.push('feb2024');
    if (api.daysInMonth(2026, 4) !== 30) bad.push('apr');
    if (api.daysInMonth(2026, 12) !== 31) bad.push('dec');
    /* 日历：前导空格 = 1 号是周几；格子数 = 前导 + 当月天数。 */
    const grid = api.calendarGrid(2026, 9, { '2026-09-05': { userEmoji: '☀' }, '2026-09-07': { userDiary: ' ' } });
    if (grid.lead !== new Date(2026, 8, 1).getDay()) bad.push('grid-lead:' + grid.lead);
    if (grid.cells.length !== grid.lead + 30) bad.push('grid-cells:' + grid.cells.length);
    const cell5 = grid.cells.find((c) => c && c.day === 5);
    const cell7 = grid.cells.find((c) => c && c.day === 7);
    if (!cell5 || cell5.hasDiary !== true || cell5.userEmoji !== '☀') bad.push('grid-day5');
    /* ★ 空日记（`charDiary: ' '`）在日历上**不许**亮起来（否则格子点不进去）。 */
    if (!cell7 || cell7.hasDiary !== false) bad.push('grid-day7-blank');
    /* 前导格子必须是 null（视图据此画占位），不是 0 号。 */
    for (let i = 0; i < grid.lead; i += 1) if (grid.cells[i] !== null) bad.push('grid-blank:' + i);
    /* 心情罐子：★ 顺序可复算（源 `for…in` 依赖对象键序，换台机器就变）。 */
    const jar = api.moodJar(2026, 9, {
        '2026-09-20': { userEmoji: 'B', charEmoji: 'b' },
        '2026-09-05': { userEmoji: 'A', charEmoji: 'a' },
        '2026-08-30': { userEmoji: 'X' },
        '2026-09-11': { userDiary: '只写了字' },
    });
    if (jar.emojis.join('') !== 'AaBb') bad.push('jar-order:' + jar.emojis.join(''));
    if (jar.count !== 4) bad.push('jar-count:' + jar.count);
    /* 跨月不串（8 月的不进来）。 */
    if (jar.emojis.includes('X')) bad.push('jar-cross-month');
    /* 尾巴收紧：日记库给顶（源无限长地存）。 */
    const big = {};
    for (let i = 0; i < 10; i += 1) big['2026-01-' + String(i + 1).padStart(2, '0')] = { userDiary: 'x' };
    const pr = api.pruneDiaryStore(big, 3);
    if (Object.keys(pr.store).length !== 3) bad.push('prune-diary:' + Object.keys(pr.store).length);
    if (pr.expiredDays !== 7) bad.push('prune-expired:' + pr.expiredDays);
    if (Object.keys(pr.store).sort()[0] !== '2026-01-08') bad.push('prune-keeps-newest');
    return bad;
}

/* ── D 情书：回信收发对调 / 回自己的信拒收 / 上限丢最旧 ── */
function letterProblems(api) {
    const bad = [];
    const L = api.LOVER_LIMITS;
    const ctx = { myName: '\u963f\u67da', charName: '\u5c0f\u6a31' };
    /* 新写一封：我 → Ta。 */
    const a = api.composeLetter('\u4f60\u597d', ctx, null, 1000);
    if (!a.letter) { bad.push('letter-null'); return bad; }
    if (a.letter.senderId !== 'user' || a.letter.recipientId !== 'char') bad.push('letter-dir:' + a.letter.senderId + '>' + a.letter.recipientId);
    if (a.letter.senderName !== '\u963f\u67da' || a.letter.recipientName !== '\u5c0f\u6a31') bad.push('letter-names');
    if (a.letter.replyToId !== null) bad.push('letter-reply-null');
    if (a.letter.timestamp !== 1000) bad.push('letter-ts');
    /* 没有角色名 ⇒ 拒收并给原因（**不抛**）。 */
    const noChar = api.composeLetter('hi', { myName: '\u6211' }, null, 1000);
    if (noChar.letter !== null || noChar.error !== 'no-char') bad.push('letter-no-char');
    /* 内容空 ⇒ 拒收。 */
    for (const v of ['', '   ', null, undefined]) {
        const e = api.composeLetter(v, ctx, null, 1000);
        if (e.letter !== null || e.error !== 'empty-content') bad.push('letter-empty:' + String(v));
    }
    /* ★ 回信：**收发对调**（senderName 换成我、recipientName 取原信的发信人）。 */
    const rep = api.composeLetter('\u56de\u4f60', ctx, mkIncoming(), 2000);
    if (!rep.letter) { bad.push('reply-null'); return bad; }
    if (rep.letter.senderId !== 'user' || rep.letter.senderName !== '\u963f\u67da') bad.push('reply-sender:' + rep.letter.senderId);
    if (rep.letter.recipientId !== 'char' || rep.letter.recipientName !== '樱子') bad.push('reply-recipient:' + rep.letter.recipientId);
    /* ★ 夹具自证：若「原信发信人」与「角色名」恰好同字，上面那条在「照抄 charName」的实现上
     *   也一样绿 —— 先把两者不同这件事钉住，那条断言才有判别力。 */
    if (mkIncoming().senderName === ctx.charName) bad.push('fixture-distinct');
    if (rep.letter.replyToId !== 'L1') bad.push('reply-ref:' + rep.letter.replyToId);
    if (rep.letter.timestamp !== 2000) bad.push('reply-ts');
    /* ★ 回**自己的信**必须拒收（源照做，于是产出「我 → 我」的怪信，界面上看不出来）。 */
    const self = api.composeLetter('\u56de\u81ea\u5df1', ctx, a.letter, 3000);
    if (self.letter !== null || self.error !== 'self-reply') {
        bad.push('self-reply:' + JSON.stringify(self.letter && self.letter.senderId + '>' + self.letter.recipientId));
    }
    /* ★ 记一封来信（角色写给你的）—— 没有它，回信是个没有对象的按钮。 */
    const inc = api.composeIncoming('\u60f3\u4f60\u4e86', ctx, 4000);
    if (!inc.letter || inc.letter.senderId !== 'char' || inc.letter.recipientId !== 'user') bad.push('incoming');
    if (inc.letter.senderName !== '\u5c0f\u6a31' || inc.letter.recipientName !== '\u963f\u67da') bad.push('incoming-names');
    if (!api.composeIncoming('  ', ctx, 4000).error) bad.push('incoming-empty');
    if (api.composeIncoming('x', { myName: '\u6211' }, 4000).error !== 'no-char') bad.push('incoming-no-char');
    /* ★ 上限丢最旧（源没有顶）。 */
    const many = [];
    for (let i = 0; i < L.maxLetters + 3; i += 1) many.push({ id: 'l' + i, content: 'c' + i, timestamp: 1000 + i });
    const n = api.normalizeLetters(many);
    if (n.list.length !== L.maxLetters) bad.push('letters-cap:' + n.list.length);
    if (n.overCap !== 3) bad.push('letters-over:' + n.overCap);
    if (n.list[0].id !== 'l3') bad.push('letters-drops-oldest:' + n.list[0].id);
    /* 排序升序（视图 reverse 成新→旧）。 */
    const sorted = api.normalizeLetters([{ id: 'b', content: 'b', timestamp: 200 }, { id: 'a', content: 'a', timestamp: 100 }]);
    if (sorted.list[0].id !== 'a') bad.push('letters-sort');
    /* 坏条目（无内容 / 无时间）如实丢弃并计数。 */
    const dirty = api.normalizeLetters([{ content: '', timestamp: 1 }, { content: 'x' }, null, { content: 'ok', timestamp: 5 }]);
    if (dirty.list.length !== 1 || dirty.dropped !== 3) bad.push('letters-dirty:' + dirty.list.length + '/' + dirty.dropped);
    return bad;
}

/* ── E 问答：三态不许塌成两态 / 只有悬着的那方能答 ── */
function questionProblems(api) {
    const bad = [];
    const S = api.QUESTION_STATES;
    if (S.awaiting_char === S.awaiting_user) bad.push('states-alias');
    /* 我问 Ta ⇒ 提问者 user、等 Ta 答。 */
    const q = api.askQuestion({ questionText: '\u4f60\u5728\u5417', questioner: 'user', timestamp: 1000 }, 1000);
    if (!q.question || q.error) { bad.push('ask-null'); return bad; }
    if (q.question.questioner !== 'user' || q.question.answerer !== 'char') bad.push('ask-role');
    if (q.question.answerText !== null) bad.push('ask-answer-null');
    if (api.questionState(q.question) !== S.awaiting_char) bad.push('ask-state:' + api.questionState(q.question));
    /* Ta 我问 ⇒ 等用户答。★ 时间戳必须与上面那条**不同**：时间戳相同 ⇒ 两条 id 撞车 ⇒
     * 下面「删掉一条要剩一条」会一次删掉两条，报出来的是夹具自己的错。 */
    const q2 = api.askQuestion({ questionText: '\u4f60\u7231\u6211\u5417', questioner: 'char', timestamp: 1001 }, 1001);
    if (api.questionState(q2.question) !== S.awaiting_user) bad.push('ask2-state:' + api.questionState(q2.question));
    if (q2.question.answerer !== 'user') bad.push('ask2-role');
    /* 内容空 / 坏输入 ⇒ 拒收，不造一条空问题。 */
    for (const v of ['', '   ', null, undefined, 'x']) {
        const e = api.askQuestion(typeof v === 'string' && v === 'x' ? 1 : { questionText: v }, 1000);
        if (e.question !== null) bad.push('ask-empty:' + String(v));
    }
    /* ★ 不是轮到你答 ⇒ 拒收（用户不能替 Ta 答「等 Ta 答」的问题）。 */
    const w1 = api.answerQuestion([q.question], q.question.id, 'user', '\u5728', 2000);
    if (w1.error !== 'not-your-turn') bad.push('turn-char:' + w1.error);
    if (w1.list[0].answerText !== null) bad.push('turn-no-mutation');
    /* ★ Ta 答上了，这条就进「已答」。 */
    const a1 = api.answerQuestion([q.question], q.question.id, 'char', '\u5728\u7684', 2000);
    if (a1.error !== null) bad.push('answer-char:' + a1.error);
    if (a1.list[0].answerText !== '\u5728\u7684' || a1.list[0].answerer !== 'char') bad.push('answer-value');
    if (api.questionState(a1.list[0]) !== S.answered) bad.push('answered-state');
    /* ★ 已答过的再答 ⇒ 拒收（源直接改字段，谁都能覆盖谁的答复）。 */
    const a2 = api.answerQuestion(a1.list, q.question.id, 'char', '\u6539\u53e3', 3000);
    if (a2.error !== 'already-answered') bad.push('re-answer:' + a2.error);
    if (a2.list[0].answerText !== '\u5728\u7684') bad.push('re-answer-mutated');
    /* 用户答「等用户答」的那条；Ta 替答 ⇒ 拒收。 */
    const w2 = api.answerQuestion([q2.question], q2.question.id, 'char', '\u66ff\u4f60', 2000);
    if (w2.error !== 'not-your-turn') bad.push('turn-user:' + w2.error);
    const a3 = api.answerQuestion([q2.question], q2.question.id, 'user', '\u7231', 2000);
    if (a3.error !== null) bad.push('answer-user:' + a3.error);
    /* 找不到 ⇒ not-found（不静默成功）。 */
    if (api.answerQuestion([q.question], 'nope', 'char', 'x', 2000).error !== 'not-found') bad.push('not-found');
    /* 内容空 ⇒ empty-content。 */
    if (api.answerQuestion([q.question], q.question.id, 'char', '  ', 2000).error !== 'empty-content') bad.push('answer-empty');
    /* 删：找不到 ⇒ not-found。 */
    const rm = api.removeQuestion([q.question, q2.question], q.question.id);
    if (rm.error !== null || rm.list.length !== 1) bad.push('remove-hit:' + rm.error);
    if (api.removeQuestion([q.question], 'nope').error !== 'not-found') bad.push('remove-missing');
    /* 三态计数不许塌：两悬 + 一答。 */
    const three = [q.question, q2.question, a1.list[0]];
    const pr = api.projectLover({ questions: three }, T0, api.defaultLoverSettings());
    if (pr.awaitingChar !== 1 || pr.awaitingUser !== 1 || pr.answered !== 1) {
        bad.push('project-three:' + pr.awaitingChar + '/' + pr.awaitingUser + '/' + pr.answered);
    }
    return bad;
}

/* ── F 投影与注入：归因先判可读 / 空投影不编数 / 无内容不产块 ── */
function projectProblems(api) {
    const bad = [];
    /* ★ 归因三态：读不到就说读不到（不许说「空的」）。 */
    if (api.readLoverFace(null) !== api.LOVER_REASONS.storage_absent) bad.push('face-null:' + api.readLoverFace(null));
    if (api.readLoverFace({ storageOk: false, hasAny: true }) !== api.LOVER_REASONS.storage_absent) bad.push('face-nostorage');
    if (api.readLoverFace({ storageOk: true, hasAny: false }) !== api.LOVER_REASONS.empty) bad.push('face-empty');
    if (api.readLoverFace({ storageOk: true, hasAny: true }) !== api.LOVER_REASONS.ready) bad.push('face-ready');
    /* ★ 空投影不编数。 */
    const p0 = api.projectLover(null, T0, {});
    if (p0.hasAny !== false) bad.push('proj-hasany');
    if (p0.daysTogether !== null) bad.push('proj-days:' + p0.daysTogether);
    if (p0.todayFootprintCount !== 0 || p0.letterCount !== 0 || p0.questionCount !== 0 || p0.diaryDays !== 0) bad.push('proj-zeros');
    if (p0.moodJarCount !== 0 || p0.monthDiaryCount !== 0) bad.push('proj-month');
    if (p0.todayDateStr !== api.localDateStr(T0)) bad.push('proj-today:' + p0.todayDateStr);
    /* 有足迹时：显形 / 没到点 / 下一条（最靠前的未到点）。 */
    const p1 = api.projectLover({
        startDate: local0(2026, 1, 1),
        todayFootprints: [
            { time: '08:00', description: 'a' },
            { time: '20:00', description: 'b' },
            { time: '22:00', description: 'c' },
        ],
    }, at(12, 0), {});
    /* ★ 258 是逐日复算出来的：1-01 → 9-15，1 月只剩 30 天（首日已算第 1 天）
     *   ⇒ 30 + 2 月 28 + 3 月 31 + 4 月 30 + 5 月 31 + 6 月 30 + 7 月 31 + 8 月 31 + 9 月 15
     *   = 257 天差 ⇒ 首日即第 1 天 ⇒ 第 258 天（同一夹具在接线层实测读数亦为 258）。 */
    if (p1.daysTogether !== 258) bad.push('proj-days258:' + p1.daysTogether);
    if (p1.todayFootprintCount !== 3) bad.push('proj-foot:' + p1.todayFootprintCount);
    if (p1.todayShownCount !== 1 || p1.todayHiddenCount !== 2) bad.push('proj-shown:' + p1.todayShownCount + '/' + p1.todayHiddenCount);
    if (!p1.nextFootprint || p1.nextFootprint.time !== '20:00') bad.push('proj-next:' + JSON.stringify(p1.nextFootprint));
    if (p1.nextFootprint.inMs !== (at(20, 0) - at(12, 0))) bad.push('proj-next-inMs:' + p1.nextFootprint.inMs);
    if (p1.hasAny !== true) bad.push('proj-hasany1');
    /* ★ 两个面的「这一面有什么」：键取 LOVER_FACES 的值，与投影同一份口径。 */
    if (!api.LOVER_FACES.includes('days') || !api.LOVER_FACES.includes('diary')) bad.push('faces');
    const sDays = api.faceSummary(p1, 'days');
    const sDiary = api.faceSummary(p1, 'diary');
    if (!sDays.includes(String(p1.daysTogether))) bad.push('summary-days:' + sDays);
    if (!sDiary.includes('\u65e5\u8bb0')) bad.push('summary-diary:' + sDiary);
    if (api.faceSummary(p0, 'days') !== '\u8fd8\u6ca1\u8bb0\u5f55\u7b2c\u4e00\u5929') bad.push('summary-noday');
    return bad;
}

function injectProblems(api) {
    const bad = [];
    /* ★ 无内容 ⇒ 空串（不产生空块）—— 与 taobao / widget / block 同规格。 */
    if (api.loverPromptBlock(null, {}) !== '') bad.push('inject-null');
    if (api.loverPromptBlock({ hasAny: false }, {}) !== '') bad.push('inject-empty');
    const p = {
        hasAny: true, daysTogether: 100, startDate: '2026-01-01',
        todayFootprintCount: 2, todayShownCount: 1, todayHiddenCount: 1,
        awaitingChar: 1, awaitingUser: 0, letterCount: 3, diaryDays: 2, moodJarCount: 4,
    };
    const blk = api.loverPromptBlock(p, {});
    /* ★ 头行必须带**换行**（桃宝那一版漏了，头行与第一条事实粘成一行）。 */
    if (!blk.startsWith('\u3010\u7cfb\u7edf\u00b7\u604b\u7231\u7a7a\u95f4\u3011\n')) {
        bad.push('inject-head:' + JSON.stringify(blk.slice(0, 30)));
    }
    if (!blk.includes('100')) bad.push('inject-days');
    if (!blk.includes('3')) bad.push('inject-letters');
    /* 关闭注入 ⇒ 空串。 */
    if (api.loverPromptBlock(p, { injectToPrompt: false }) !== '') bad.push('inject-off');
    /* 条数 0 ⇒ 空串（不是只给头行）。 */
    if (api.loverPromptBlock(p, { maxInjectLines: 0 }) !== '') bad.push('inject-max0');
    /* 条数上限真的生效（钳到 0..20）。 */
    const one = api.loverPromptBlock(p, { maxInjectLines: 1 });
    if (one.split('\n').length !== 2) bad.push('inject-max1:' + one.split('\n').length);
    const huge = api.loverPromptBlock(p, { maxInjectLines: 999 });
    if (huge.split('\n').length - 1 > api.LOVER_LIMITS.maxInjectLines) bad.push('inject-clamp');
    /* 设置规范化：未知字段不进、布尔按真值收。 */
    const st = api.normalizeLoverSettings({ maxInjectLines: 999, injectToPrompt: 0, xx: 1 });
    if (st.maxInjectLines !== 20 || st.injectToPrompt !== false || 'xx' in st) bad.push('settings:' + JSON.stringify(st));
    if (api.defaultLoverSettings().injectToPrompt !== true) bad.push('defaults');
    const allOff = api.normalizeLoverSettings({ injectToPrompt: false, revealByTime: false, oncePerDay: false });
    if (allOff.revealByTime !== false || allOff.oncePerDay !== false) bad.push('settings-off');
    /* 缺省时回到默认（不是 undefined）。 */
    const dflt = api.normalizeLoverSettings(null);
    if (dflt.maxInjectLines !== api.DEFAULT_LOVER_SETTINGS.maxInjectLines) bad.push('settings-default');
    return bad;
}

/* ── G 输入解析与尾巴收紧（本件为绕开「让模型产 json」加的一层） ── */
function parseProblems(api) {
    const bad = [];
    /* 足迹行文本：认得出的留下、认不出的**如实计数**。 */
    const p = api.parseFootprintLines('08:30 \u8d77\u5e8a\n\n\u4e71\u5199\u4e00\u884c\n12:00 \u5348\u996d \ud83c\udf24');
    if (p.list.length !== 2) bad.push('fp-lines:' + p.list.length);
    if (p.skipped !== 1) bad.push('fp-skipped:' + p.skipped);
    if (p.list[0].time !== '08:30' || p.list[0].description !== '\u8d77\u5e8a') bad.push('fp-first');
    if (p.list[1].description !== '\u5348\u996d \ud83c\udf24') bad.push('fp-emoji:' + p.list[1].description);
    if (api.parseFootprintLines('').list.length !== 0) bad.push('fp-empty');
    if (api.parseFootprintLines(null).list.length !== 0) bad.push('fp-null');
    /* 情书抬头：可带一行「致：谁」，其余为正文。 */
    const l1 = api.parseLetterInput('\u81f4\uff1a\u5c0f\u6a31\n\u4f60\u597d\u5440');
    if (l1.to !== '\u5c0f\u6a31' || l1.body !== '\u4f60\u597d\u5440') bad.push('letter-head:' + JSON.stringify(l1));
    const l2 = api.parseLetterInput('\u4f60\u597d\u5440');
    if (l2.to !== null || l2.body !== '\u4f60\u597d\u5440') bad.push('letter-nohead:' + JSON.stringify(l2));
    /* ★ 认不出抬头就当正文 —— 不因为一个格式细节把用户写的东西吃掉。 */
    const l3 = api.parseLetterInput('\u81f4\u4f60\u4eec\u597d\n\u6b63\u6587');
    if (l3.to !== null || !l3.body.includes('\u81f4\u4f60\u4eec\u597d')) bad.push('letter-keepall:' + JSON.stringify(l3));
    if (api.parseLetterInput('').body !== '') bad.push('letter-empty');
    /* 日记：认得出 `我：` / `Ta：` 两块就分开存。 */
    const d = api.parseDiaryInput('\u6211\uff1a\u2600\n\u4eca\u5929\u5f88\u597d\nTa\uff1a\u2614\n\u4ed6\u5f88\u7d2f');
    if (!d.parsed) { bad.push('diary-null'); return bad; }
    if (d.parsed.userEmoji !== '\u2600' || d.parsed.userDiary !== '\u4eca\u5929\u5f88\u597d') bad.push('diary-user:' + JSON.stringify(d.parsed));
    if (d.parsed.charEmoji !== '\u2614' || d.parsed.charDiary !== '\u4ed6\u5f88\u7d2f') bad.push('diary-char:' + JSON.stringify(d.parsed));
    /* 认不出 ⇒ parsed: null（由界面走「整段当你自己写的」降级路）。 */
    if (api.parseDiaryInput('\u6ca1\u6709\u6807\u8bb0\u7684\u6574\u6bb5').parsed !== null) bad.push('diary-noflag');
    if (api.parseDiaryInput('').parsed !== null) bad.push('diary-empty');
    /* 首行不是 emoji ⇒ 并回正文（不把汉字当 emoji）。 */
    const d2 = api.parseDiaryInput('\u6211\uff1a\u4eca\u5929\u5f88\u597d');
    if (!d2.parsed || d2.parsed.userEmoji !== '' || d2.parsed.userDiary !== '\u4eca\u5929\u5f88\u597d') bad.push('diary-hanzi:' + JSON.stringify(d2.parsed));
    /* 尾巴收紧：足迹库给顶、**如实计数**、保留最新。 */
    const store = {};
    for (let i = 0; i < 40; i += 1) store['2026-01-' + String((i % 28) + 1).padStart(2, '0')] = [{ time: '08:00', description: 'x' }];
    const pr = api.pruneFootprintStore(store, 5);
    if (Object.keys(pr.store).length !== 5) bad.push('prune-foot:' + Object.keys(pr.store).length);
    if (pr.expiredDays !== 23) bad.push('prune-foot-expired:' + pr.expiredDays);
    if (Object.keys(pr.store).sort().pop() !== '2026-01-28') bad.push('prune-foot-newest');
    /* 非法日期键不许进库（会造出「有键但点不进去」的鬼格子）。 */
    const pr2 = api.pruneFootprintStore({ '2026-13-01': [], 'bad': [], '2026-01-01': [] }, 5);
    if (Object.keys(pr2.store).length !== 1) bad.push('prune-bad-keys:' + Object.keys(pr2.store).join(','));
    /* 取 / 写某一天：非法日期串 ⇒ 原样返回 + reason（不静默写进去）。 */
    if (api.footprintsOf({ '2026-01-01': [{ time: '08:00' }] }, '2026-01-01').length !== 1) bad.push('foot-of');
    if (api.footprintsOf(null, 'x').length !== 0) bad.push('foot-of-null');
    const put = api.putFootprints({}, '2026-02-30', []);
    if (!put.error) bad.push('put-bad-date');
    const put2 = api.putFootprints({}, '2026-01-01', [{ time: '08:00' }]);
    if (put2.error || api.footprintsOf(put2.store, '2026-01-01').length !== 1) bad.push('put-ok');
    /* 原对象不许被改（App 会把它当「上一份」用）。 */
    const base = { '2026-01-01': [] };
    api.putFootprints(base, '2026-01-02', []);
    if (Object.keys(base).length !== 1) bad.push('put-pure');
    return bad;
}

/* ══════════════════════ H ── 接线（四处注册 + 调用面 + 样式 + 前缀 + 四件套） ══════════════════════ */
const APP_ID = 'loverspace';
const APP_CLS = 'LoverSpaceApp';
const CSS_PFX = '.lov-';
const KEY_PFX = 'lover';

test('H1 四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀（槽位名是驼峰）', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.length > 0, 'index.js 必须有 ST_PHONE_REBIND_APP_KEYS 表');
    assert.ok(apps.includes("id: '" + APP_ID + "'"), 'config/apps.js 必须登记 id: ' + APP_ID);
    assert.equal(apps.split("id: '" + APP_ID + "'").length - 1, 1, 'APPS 里同 id 只许登记一次');
    assert.ok(idx.includes("appId === '" + APP_ID + "'"), 'index.js 必须有懒加载分支 ' + APP_ID);
    assert.ok(idx.includes("import('./apps/" + APP_ID + "/" + APP_ID + "-app.js')"), '分支必须指向真实路径 apps/' + APP_ID);
    assert.ok(idx.includes('new module.' + APP_CLS + '('), APP_CLS + ' 必须被构造');
    /* ★ 槽位名是**驼峰**（window.VirtualPhone.loverApp），不是「前缀 + App」（前缀全小写 `lover`）。
     *   REBIND 表与三处清理按的就是这个**槽位**：名字对不上时换会话不会重绑，而门禁一声不响。 */
    const slot = 'loverApp';
    assert.ok(idx.includes('window.VirtualPhone.' + slot + ' = new module.' + APP_CLS + '('),
        'index.js 必须把 ' + APP_CLS + ' 留在 window.VirtualPhone.' + slot);
    assert.ok(tbl.includes("'" + slot + "'"), 'REBIND 表必须含 ' + slot + ' 槽位');
    assert.ok(storage.includes('/^' + KEY_PFX + '_/'), '会话隔离表必须有 /^' + KEY_PFX + '_/');
    /* 条目注释里必须写明「哪些不缝」——那几行的存在本身是这一件的定位凭据。 */
    assert.ok(apps.includes('四处不缝'), 'config/apps.js 的恋爱空间条目必须写明不缝清单');
    assert.ok(apps.includes('[v3.30.0]'), '条目必须带本版标记');
});

test('H2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'face', 'storage', 'shell', 'limits', 'proj', 'projection',
        'view', '_view', 'app', 'state', 'questions', 'letters', '_root']);
    const appSrc = read(APP_REL);
    const methods = new Set();
    /* ★ 只认「签名的行尾就是 `{`」这一形：`if (…) {` 与 `return x;` 不算方法定义
     *   （否则整行 `if (a && b) {` 会被当成一个叫 if 的方法，缺的调用反被它掩盖）。 */
    for (const m of appSrc.matchAll(/^[ \t]+(?:get |set )?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm)) methods.add(m[1]);
    const viewSrc = read(VIEW_REL);
    const called = new Set();
    for (const m of viewSrc.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
    const missing = [...called].filter((n) => !methods.has(n) && !FIELDS.has(n));
    assert.deepEqual(missing, [], VIEW_REL + ' 调了 App 上不存在的东西：' + missing.join(' , '));
    assert.ok(methods.size >= 15, APP_REL + ' 的方法面异常小（' + methods.size + '）');
    assert.ok(called.size >= 8, VIEW_REL + ' 的调用面异常小（' + called.size + '）');
    /* ★ 视图不许自己写一份状态中文（两边各写一份 = 改文案时只改一处，静默不一致）。 */
    const view = stripComments(viewSrc);
    for (const s of ["'awaiting", '"awaiting', "'answered'", "'storage-absent'", '"storage-absent"']) {
        assert.equal(view.includes(s), false, '视图不得自写状态/归因字面量（应走数据层常量）：' + s);
    }
    assert.ok(viewSrc.includes('QUESTION_STATES'), '视图的状态文案必须由数据层的三态常量计算');
    assert.ok(viewSrc.includes('[LOVER_REASONS.'), '视图文案表的键必须由归因常量计算');
});

test('H3 样式源与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    const HDR = '/* ---------- [v3.30.0] 恋爱空间 App（' + CSS_PFX + '*） ---------- */';
    const at = phone.indexOf(HDR);
    assert.ok(at >= 0, 'phone.css 必须带本版段头：' + HDR);
    const rest = phone.slice(at);
    /* ★ [v3.31.0 接段已执行] 本段不再是末段 —— v3.31.0 往后接了「约会大作战」段，
     *   故按 v3.28.0 当时立的交棒口径：**按下一个段头截断**，不取文件尾。
     *   下版若再往后接段，本取法依然正确（不会以「同源失败」假红）。 */
    const nxt = rest.indexOf('/* ---------- [', 1);
    const seg = nxt >= 0 ? rest.slice(0, nxt) : rest;
    const norm = (x) => x.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
    assert.equal(norm(seg), norm(read(CSS_REL)), 'phone.css 的本版段必须与 ' + CSS_REL + ' 逐字同源');
    assert.ok(seg.split(CSS_PFX).length - 1 >= 5, '本段必须真的带样式');
    /* 每个产出的类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点。 */
    const view = read(VIEW_REL);
    const js = view + read(APP_REL);
    const css = read(CSS_REL);
    const bare = CSS_PFX.slice(1);
    const cssNames = new Set(css.match(new RegExp('[.]' + bare + '[a-z0-9-]+', 'g')) || []);
    const anchors = new Set();
    /* ★ 本仓的取值助手是 `const q = (sel) => this._root.querySelector(sel);`，视图一律写
     *   `q('.lov-foot')` —— 只认「querySelector( 紧跟选择器」会把全部 q(...) 锚点漏掉。 */
    for (const m of js.matchAll(/(?:querySelector(?:All)?|\bq)\s*\(\s*['"]([^'"]*)['"]/g)) {
        for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
    }
    for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
    const produced = new Set();
    for (const m of view.matchAll(/class=["']([^"']+)/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare) && !tok.endsWith('-')) produced.add(tok);
    }
    for (const m of view.matchAll(/className\s*=\s*'([^']+)'/g)) {
        for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare)) produced.add(tok);
    }
    const missing = [...produced].filter((x) => !cssNames.has('.' + x) && !anchors.has(x));
    assert.deepEqual(missing, [], VIEW_REL + ' 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
    assert.ok(produced.size >= 20, VIEW_REL + ' 产出的类名异常少（' + produced.size + '）');
    assert.ok(anchors.size >= 3, VIEW_REL + ' 的选择器锚点异常少（' + anchors.size + '）');
    /* 段里的类名必须都在本 App 前缀下（防「顺手借了别人的类名」）。 */
    const foreign = [...cssNames].filter((x) => !x.startsWith(CSS_PFX));
    assert.deepEqual(foreign, [], CSS_REL + ' 出现非本前缀的类名：' + foreign.join(' , '));
});

test('H4 前缀全仓唯一：.lov- 只出现在本 App 目录与 phone.css', () => {
    const walk = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            /* ★ 只排除「判据文件自己」（它满篇写着 `.lov-`）：不能整目录排除 tests/，
             *   否则别的测试里真出现越界引用就永远查不出来了。 */
            if (path.resolve(dir, e.name) === path.resolve(fileURLToPath(import.meta.url))) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (/\.(js|css|mjs|json|html)$/.test(e.name)) out.push(full);
        }
        return out;
    };
    const files = walk(ROOT, []);
    assert.ok(files.length > 200, '扫描面异常小（' + files.length + '）');
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(CSS_PFX));
    assert.ok(users.length > 0, CSS_PFX + ' 必须在仓里被用到');
    for (const f of users) {
        assert.ok(f.includes('/apps/' + APP_ID + '/') || f.endsWith('phone.css'),
            CSS_PFX + ' 只应出现在 apps/' + APP_ID + '/ 与 phone.css，实测还有：' + f.replace(ROOT, ''));
    }
});

test('H5 四件套齐备、data 层是纯函数，且源里六块禁区一条都没进来', () => {
    for (const f of ['-data.js', '-app.js', '-view.js', '.css']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'apps', APP_ID, APP_ID + f)), 'apps/' + APP_ID + '/' + APP_ID + f + ' 必须存在');
    }
    const data = read(DATA_REL);
    const code = stripComments(data);
    /* ★ 头一条就是本件的立身之本：data 层是**纯函数内核**：只能有一条 import，
     *   且必须是**全仓唯一的取数门**（`config/num-gate.js`）—— 本仓铁律。
     *   不碰 DOM / window / 存储 / 网络 / 聊天层 / 数据库 / 定时器。
     *   ★ 本条第一版写成「零 import」，而实现里就地写了一份弱口径取数（`Number.isFinite(Number(x))`）
     *   —— 它会把 `''` / `[]` / `true` 全读成 0，被本仓 weak-coercion 门当场抳中。
     *   修法不是放宽判据，而是**改成引唯一实现**，判据跟着改成「只准这一条」。 */
    const imports = data.match(/^\s*import\s.*$/gm) || [];
    assert.equal(imports.length, 1, DATA_REL + ' 只能有一条 import（实测 ' + imports.length + '）');
    assert.ok(imports[0].includes("from '../../config/num-gate.js'"), DATA_REL + ' 那一条 import 必须是唯一取数门');
    assert.ok(/import\s*\{\s*numOrNull\s*\}/.test(imports[0]), DATA_REL + ' 必须只引入 numOrNull');
    assert.equal(code.includes('Number.isFinite(Number('), false, DATA_REL + ' 不得就地再写一份弱口径取数');
    for (const banned of ['document', 'window', 'localStorage', 'sessionStorage',
        'fetch(', 'XMLHttpRequest', 'indexedDB', 'Dexie', 'openDB', 'geolocation',
        'getChatMessages', 'setChatMessages', 'chatMetadata', 'setTimeout', 'setInterval']) {
        assert.equal(code.includes(banned), false, APP_ID + ' 的 data 层**代码**里不得出现：' + banned);
    }
    /* ② 不碰钱包（本仓用户钱包的仲裁源是微信零钱）。 */
    for (const banned of ['userBalance', 'userWalletTransactions', 'characterPhoneData',
        'characterPhoneBank', '.bank']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得碰钱包字段：' + banned);
    }
    /* ③ 零外部素材（源 12 条外链一条都不收）。 */
    for (const banned of ['http://', 'https://', 'postimg', 'laddy-lulu', '.mp3', '.png', '.jpg', 'new Audio']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得内置外链素材：' + banned);
    }
    /* ④ 不自己调模型。 */
    for (const banned of ['chat/completions', 'handleGenerateDailyActivity', 'modelCall']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得自己调模型：' + banned);
    }
    /* ⑤ 不碰聊天层（源把整份 chat 落库、还往 history 塞隐藏系统消息）。 */
    for (const banned of ['loversSpaceData', 'chat.history', 'history.push', 'saveChat']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得碰聊天层：' + banned);
    }
    /* ⑥ 不取「说说 / 相册 / 照片 / 分享」那一块（本仓 apps/weibo 是那件事的权威）。 */
    for (const banned of ['moments', 'albums', 'photos', 'shares', '相册', '说说']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得取「说说 / 相册 / 照片 / 分享」块：' + banned);
    }
    /* ⑦ 不取番茄钟 / 白噪音（本仓 apps/focus 是那件事的权威；一个模块两处计时器是本仓忌的形态）。 */
    for (const banned of ['pomodoro', 'whiteNoise', 'bgm', '番茄']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得取番茄钟 / 白噪音：' + banned);
    }
    /* ⑧ 零动态求值：外来 HTML 只当文本留存（源直接把模型给的 HTML 塞进 innerHTML）。
     *   ★ 这里必须用**剥注释后**的代码：文件头正写着「源把模型给的 HTML 塞进 innerHTML」
     *     这句**说明**，用原文判会把说明当消费（K1 正好钉住了这一点）。 */
    for (const banned of ['innerHTML', 'eval(', 'new Function']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得动外来 HTML / 动态求值：' + banned);
    }
    /* App 层：不转定时器、不碰钱包、不发请求、不碰数据库、不替宿主写楼层。 */
    const appCode = stripComments(read(APP_REL));
    for (const banned of ['setTimeout', 'setInterval', 'userBalance', 'characterPhoneData',
        'fetch(', 'XMLHttpRequest', 'https://', 'indexedDB', 'Dexie', 'chat.history', 'history.push']) {
        assert.equal(appCode.includes(banned), false, APP_REL + ' 不得出现：' + banned);
    }
    /* 视图：不直接读存储（一切数据变动都回调到 App 上）。 */
    const viewCode = stripComments(read(VIEW_REL));
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'setTimeout']) {
        assert.equal(viewCode.includes(banned), false, VIEW_REL + ' 不得出现：' + banned);
    }
    /* 样式前缀。 */
    assert.ok(read(CSS_REL).includes(CSS_PFX), CSS_REL + ' 必须用 ' + CSS_PFX + ' 前缀');
    /* 归因连字符形在数据层定义（视图文案表的键取的是它的**值**）。 */
    assert.ok(data.includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ══════════════════════ I ── 键归属 ══════════════════════ */
test('I1 六条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const src = read(APP_REL);
    const hits = [...src.matchAll(new RegExp("'(" + KEY_PFX + "_[a-z_]+)'", 'g'))].map((m) => m[1]);
    const uniq = [...new Set(hits)];
    assert.equal(uniq.length, 6, '本件六条键，实测 ' + uniq.join(','));
    assert.deepEqual(uniq.slice().sort(),
        ['lover_days', 'lover_diary', 'lover_footprints', 'lover_letters', 'lover_questions', 'lover_settings'],
        '键名必须与设计一致：' + uniq.join(','));
    for (const key of uniq) {
        assert.equal(audit.split("key: '" + key + "'").length - 1, 1, '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次');
        assert.ok(new RegExp("\\{ key: '" + key + "', scope: 'chat'").test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
    /* 会话隔离表必须真的覆盖到（前缀落在 storage.js 的模式表里）。 */
    assert.ok(read('config/storage.js').includes('/^' + KEY_PFX + '_/'), '会话隔离表必须覆盖 ^' + KEY_PFX + '_');
    /* 换会话钩子必须在（重绑表把本件算进去了，否则换角色后串味）。 */
    assert.ok(/\n\s*onChatChanged\s*\(/.test(src), '必须有换会话钩子（重绑表按它工作）');
});

/* ══════════════════════ J ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════════════════ */
/** 破坏表集中在一处：K2 会拿它做「锚点在场性 + 替换保真」的批量自证。 */
const DAMAGE = {
    /* 首日不再 +1 ⇒ 「首日即第 1 天」必须转红。 */
    d1: [DATA_REL,
        '    return Math.ceil(Math.abs(to - from) / MS_PER_DAY) + 1;',
        '    return Math.ceil(Math.abs(to - from) / MS_PER_DAY);'],
    /* 起算日在未来不再拒 ⇒ 「未来日期当没记录」必须转红（会算出负数天数）。 */
    d2: [DATA_REL,
        '    if (from > to) return null;',
        '    if (false) return null;'],
    /* 日期串反查拆掉 ⇒ 「2026-02-30 这种假日期必须拒」必须转红。 */
    d3: [DATA_REL,
        '        if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null;',
        '        if (y < 0) return null;'],
    /* 回自己的信不再拒 ⇒ 「回自己的信拒收」必须转红。 */
    d4: [DATA_REL,
        "    if (rep && String(rep.senderId || 'user') === 'user') {",
        '    if (false) {'],
    /* 封顶不再如实计数 ⇒ 「超出要报 overCap」必须转红。 */
    d5: [DATA_REL,
        '        overCap: capped ? kept.length - LOVER_LIMITS.maxFootprintsPerDay : 0,',
        '        overCap: 0,'],
    /* 空串不再归一成 null ⇒ 「没记 ≠ 记了空」必须转红。 */
    d6: [DATA_REL,
        '        return s ? s.slice(0, LOVER_LIMITS.maxTextLen) : null;',
        '        return s.slice(0, LOVER_LIMITS.maxTextLen);'],
    /* 心情罐子改成依赖对象键序 ⇒ 「顺序可复算」必须转红。 */
    d7: [DATA_REL,
        "    const keys = Object.keys(map).filter((k) => typeof k === 'string' && k.startsWith(prefix)).sort();",
        "    const keys = Object.keys(map).filter((k) => typeof k === 'string' && k.startsWith(prefix));"],
    /* 回信不再取原信发信人（改回照抄角色名）⇒ 「回信收发对调」必须转红。 */
    d8: [DATA_REL,
        "                recipientName: String(rep.senderName || charName || ''), recipientAvatar: rep.senderAvatar || null,",
        "                recipientName: String(charName || ''), recipientAvatar: rep.senderAvatar || null,"],
    /* 上限改成丢最**新** ⇒ 「超出丢最旧」必须转红。 */
    d9: [DATA_REL,
        '        list: Object.freeze(over ? kept.slice(kept.length - LOVER_LIMITS.maxLetters) : kept),',
        '        list: Object.freeze(over ? kept.slice(0, LOVER_LIMITS.maxLetters) : kept),'],
    /* 三态塌成两态（「等你答」并成「等 Ta 答」）⇒ 「三态不许塌」必须转红。 */
    d10: [DATA_REL,
        "    return (String(o.answerer || '') === 'user') ? QUESTION_STATES.awaiting_user : QUESTION_STATES.awaiting_char;",
        '    return QUESTION_STATES.awaiting_char;'],
    /* 替对方答也放行 ⇒ 「只有悬着的那方能答」必须转红。 */
    d11: [DATA_REL,
        "        if (st === QUESTION_STATES.awaiting_user && who !== 'user') { err = 'not-your-turn'; return q; }",
        '        if (false) { err = null; }'],
    /* 注入头行漏掉换行 ⇒ 「头行必须带换行」必须转红（桃宝那一版就是这个坑）。 */
    d12: [DATA_REL,
        "    return '【系统·恋爱空间】\\n' + rows.slice(0, max).join('\\n');",
        "    return '【系统·恋爱空间】' + rows.slice(0, max).join('\\n');"],
    /* 关掉注入也照样产块 ⇒ 「无内容 / 关掉都不产块」必须转红。 */
    d13: [DATA_REL,
        "    if (!set.injectToPrompt) return '';",
        "    if (false) return '';"],
};

/** num-gate 的**等价桩**（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/**
 * 造一份破坏副本并加载。
 * ★ 副本按**真目录结构**建：data 层写的是 `../../config/num-gate.js`，
 *   若把副本摊在 <tmp> 根下，那条相对路径会解析成 `/config/num-gate.js`（差两级，
 *   首跑即 ERR_MODULE_NOT_FOUND —— 与破坏本身无关的假红）。
 */
function loadDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3300_'));
    const target = path.join(dir, 'apps', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(target).href);
}

/** 判据函数吃的那一组符号（真实现 / 破坏副本通用）。 */
const apiOf = (m) => ({
    LOVER_REASONS: m.LOVER_REASONS, LOVER_FACES: m.LOVER_FACES, LOVER_LIMITS: m.LOVER_LIMITS,
    DEFAULT_LOVER_SETTINGS: m.DEFAULT_LOVER_SETTINGS, QUESTION_STATES: m.QUESTION_STATES,
    defaultLoverSettings: m.defaultLoverSettings, normalizeLoverSettings: m.normalizeLoverSettings,
    readLoverFace: m.readLoverFace, localDateStr: m.localDateStr, startOfLocalDay: m.startOfLocalDay,
    daysTogether: m.daysTogether, parseDateInput: m.parseDateInput,
    normalizeFootprints: m.normalizeFootprints, atFromHHMM: m.atFromHHMM, hhmmOf: m.hhmmOf,
    visibleFootprints: m.visibleFootprints, canRegisterToday: m.canRegisterToday,
    normalizeDiaryEntry: m.normalizeDiaryEntry, hasDiary: m.hasDiary, splitDateStr: m.splitDateStr,
    daysInMonth: m.daysInMonth, calendarGrid: m.calendarGrid, moodJar: m.moodJar,
    composeLetter: m.composeLetter, composeIncoming: m.composeIncoming, normalizeLetters: m.normalizeLetters,
    questionState: m.questionState, normalizeQuestion: m.normalizeQuestion, askQuestion: m.askQuestion,
    answerQuestion: m.answerQuestion, removeQuestion: m.removeQuestion,
    projectLover: m.projectLover, loverPromptBlock: m.loverPromptBlock, faceSummary: m.faceSummary,
    isValidDateStr: m.isValidDateStr, pruneFootprintStore: m.pruneFootprintStore,
    footprintsOf: m.footprintsOf, putFootprints: m.putFootprints, pruneDiaryStore: m.pruneDiaryStore,
    parseFootprintLines: m.parseFootprintLines, parseLetterInput: m.parseLetterInput,
    parseDiaryInput: m.parseDiaryInput,
});
const REAL = apiOf({
    LOVER_REASONS, LOVER_FACES, LOVER_LIMITS, DEFAULT_LOVER_SETTINGS, QUESTION_STATES,
    defaultLoverSettings, normalizeLoverSettings, readLoverFace, localDateStr, startOfLocalDay,
    daysTogether, parseDateInput, normalizeFootprints, atFromHHMM, hhmmOf, visibleFootprints,
    canRegisterToday, normalizeDiaryEntry, hasDiary, splitDateStr, daysInMonth, calendarGrid, moodJar,
    composeLetter, composeIncoming, normalizeLetters, questionState, normalizeQuestion, askQuestion,
    answerQuestion, removeQuestion, projectLover, loverPromptBlock, faceSummary, isValidDateStr,
    pruneFootprintStore, footprintsOf, putFootprints, pruneDiaryStore, parseFootprintLines,
    parseLetterInput, parseDiaryInput,
});

test('J1 破坏「首日即第 1 天」⇒ A 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d1;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = daysProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('day0') || x.startsWith('day1')), '首日口径改掉后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(daysProblems(REAL), [], '对照：真实现首日必须是第 1 天');
});

test('J2 破坏「未来起算日拒收」⇒ A 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d2;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = daysProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('future')), '未来日期不再拒后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(daysProblems(REAL), [], '对照：真实现未来日期必须当没记录');
});

test('J3 破坏「假日期反查」⇒ A 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d3;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = daysProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('feb30') || x.startsWith('bad-start')), '假日期不再拒后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(daysProblems(REAL), [], '对照：真实现必须拒 2026-02-30');
});

test('J4 破坏「回自己的信拒收」⇒ D 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d4;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = letterProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('self-reply')), '回自己的信放行后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(letterProblems(REAL), [], '对照：真实现必须拒收「我 → 我」的怪信');
});

test('J5 破坏「足迹封顶如实计数」⇒ B 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d5;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = footprintProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('cap-over')), '不再计数后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(footprintProblems(REAL), [], '对照：真实现必须如实计数');
});

test('J6 破坏「空串归一成没记」⇒ C 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d6;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = diaryProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('empty-null') || x.startsWith('trunc-text')), '空串不再归零后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(diaryProblems(REAL), [], '对照：真实现空串必须归一成「没记」');
});

test('J7 破坏「心情罐子顺序可复算」⇒ C 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d7;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = diaryProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('jar-order')), '顺序依赖对象键序后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(diaryProblems(REAL), [], '对照：真实现必须显式排序');
});

test('J8 破坏「回信收信人取原信发信人」⇒ D 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d8;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = letterProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('reply-recipient')), '收信人不再取原信发信人后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(letterProblems(REAL), [], '对照：真实现回信必须收发对调');
});

test('J9 破坏「情书超出丢最旧」⇒ D 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d9;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = letterProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('letters-drops-oldest')), '改成丢最新后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(letterProblems(REAL), [], '对照：真实现必须丢最旧（留住最近的往来）');
});

test('J10 破坏「问答三态」⇒ E 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d10;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = questionProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('ask2-state') || x.startsWith('project-three')), '三态塌成两态后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(questionProblems(REAL), [], '对照：真实现三态必须各是各的');
});

test('J11 破坏「只有悬着的那方能答」⇒ E 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d11;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = questionProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('turn-')), '替对方答也放行后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(questionProblems(REAL), [], '对照：真实现必须只让悬着的那方答');
});

test('J12 破坏「注入头行带换行」⇒ F 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d12;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = injectProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('inject-head') || x.startsWith('inject-max1')), '头行漏换行后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(injectProblems(REAL), [], '对照：真实现头行必须带换行');
});

test('J13 破坏「关掉注入不产块」⇒ F 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d13;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = injectProblems(apiOf(mod));
    assert.ok(bad.some((x) => x.startsWith('inject-off')), '关掉注入仍产块后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(injectProblems(REAL), [], '对照：真实现关掉就该是空串');
});

/* ══════════════════════ K ── 判据工具自证 ══════════════════════ */
test('K1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：H5 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（对原文件断言 / 破坏写死成常量 / 判据自我指涉之外：工具被削成空闸）。
     *   故必须两向自证。 */
    const raw = '// 注释里写 setInterval 与 postimg\n'
        + 'const a = "setInterval";\n'
        + '/* 块注释 Dexie / userBalance */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"setInterval"'), '字符串字面量必须留住（剥器不得把字符串里的同形文本一起吃掉）');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头（剥器不得在字符串内切换状态）');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    /* 模板串与转义引号也是状态机必须正确处理的两种输入。 */
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
    /* 本件三层剥注释后都必须真的变短（否则 H5 的「不出现」是空闸）。 */
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        assert.ok(read(rel).length > stripComments(read(rel)).length, rel + ' 剥注释后必须真的变短');
    }
    /* ★ 而且：未剥注释时**必须**真的出现那几个词（正说明它们只是「提及」不是「消费」）。 */
    for (const w of ['setInterval', 'Dexie', 'chat.history', 'postimg', 'innerHTML', 'pomodoro', 'chat/completions']) {
        assert.ok(read(DATA_REL).includes(w), '文件头应当写明源里的 ' + w + '（它是「说明」，不是「消费」）');
    }
});

test('K2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    /* ★ 负控制自身最隐蔽的失效形态是**锚点漂移**——产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    assert.ok(Object.keys(DAMAGE).length >= 13, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.ok(out.includes(to), name + ' 替换后新串必须在场');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
        /* 锚点必须落在**代码**里 —— 落在注释里的锚点破坏不了任何行为。 */
        const at = src.indexOf(from);
        const before = src.slice(0, at);
        const opens = (before.match(/\/\*/g) || []).length;
        const closes = (before.match(/\*\//g) || []).length;
        assert.equal(opens, closes, name + ' 的锚点不得落在块注释里');
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const lineEnd = src.indexOf('\n', at);
        const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('*'), name + ' 的锚点不得落在注释行里：' + line.slice(0, 60));
        /* ★ 替换串里出现 `$` 时只能用字面 split/join（`replace` 会把 `$&` 当命中整串解释）。 */
        assert.ok(!to.includes('$') || !from.includes('$'), name + ' 替换串含 $ 时更须小心（本表一律走 split/join）');
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去判别力。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 副本的结构自证：`../../config/num-gate.js` 必须真能解析到桩（否则出 ERR_MODULE_NOT_FOUND 假红）。 */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3300_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'loverspace'), { recursive: true });
    const realCopy = path.join(tmp, 'apps', 'loverspace', 'loverspace-data.js');
    fs.copyFileSync(path.join(ROOT, DATA_REL), realCopy);
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(realCopy).href).then((m) => {
        assert.equal(m.daysTogether(new Date(2026, 0, 1), new Date(2026, 0, 1)), 1,
            '副本按真目录结构摊开后必须能加载且行为同真件（只引唯一取数门）');
    });
});

/* ══════════════════════ 内核判据挂测 ══════════════════════ */
test('A1 天数：首日即第 1 天 / 未来当没记录 / 假日期拒 / 本地日期串', () => {
    const bad = daysProblems(REAL);
    assert.deepEqual(bad, [], '天数口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(daysTogether(new Date(2026, 0, 1), new Date(2026, 0, 1)), 1, '首日就是第 1 天');
});

test('A2 足迹：HH:mm 解析 / 到点显形 / 封顶如实计数 / 一天一次的门', () => {
    const bad = footprintProblems(REAL);
    assert.deepEqual(bad, [], '足迹口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(LOVER_LIMITS.maxFootprintsPerDay, 24, '一天封顶就是 24 条');
});

test('B1 日记：空串≠有记录 / 日历对齐 / 罐子顺序可复算 / 日记库尾巴收紧', () => {
    const bad = diaryProblems(REAL);
    assert.deepEqual(bad, [], '日记口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(LOVER_LIMITS.maxDiaryDays, 400);
});

test('C1 情书：回信收发对调 / 回自己的信拒收 / 上限丢最旧 / 坏条目计数', () => {
    const bad = letterProblems(REAL);
    assert.deepEqual(bad, [], '情书口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(LOVER_LIMITS.maxLetters, 100);
});

test('D1 问答：三态不塌 / 只有悬着的那方能答 / 找不到不静默成功', () => {
    const bad = questionProblems(REAL);
    assert.deepEqual(bad, [], '问答口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(QUESTION_STATES.awaiting_user === QUESTION_STATES.awaiting_char, false, '三态必须各是各的');
});

test('E1 投影与归因：先判可读 / 空投影不编数 / 两面 summary 同源', () => {
    const bad = projectProblems(REAL);
    assert.deepEqual(bad, [], '投影口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('E2 注入只给事实：无内容则空串（不产生空块）/ 头行带换行 / 条数真的钳住', () => {
    const bad = injectProblems(REAL);
    assert.deepEqual(bad, [], '注入口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('F1 输入解析与尾巴收紧：三件输入 + 足迹库/日记库留最近 N 天并如实计数', () => {
    const bad = parseProblems(REAL);
    assert.deepEqual(bad, [], '解析与收紧口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('F2 本件一个定时器都不转：源每分钟 setInterval 重画「到点显形」，本件改惰性显形', () => {
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        const code = stripComments(read(rel));
        assert.equal(code.includes('setInterval'), false, rel + ' 不得转常驻定时器');
        assert.equal(code.includes('setTimeout'), false, rel + ' 不得转一次性定时器');
    }
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 30),
        '本套件成立于 RubyPhone 3.30.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* 本版条目必须在场且非空（审计门会查这一条，这里先钉住）。 */
    /* ★ 本套件守的是**自己那一版**（v3.30.0 恋爱空间），不是「当版」——
     *   抬版后 latest 换成新件。此前这里读 `log.versions[man.version]`，
     *   一抬到 3.31.0 就报「本版条目必须写到 恋爱空间」红，而 3.30.0 的条目其实好好的。
     *   这是本仓记过的「守别人的版」同款口径错的第四例（v3270 / v3280 / v3290 已改）。 */
    const SELF = '3.30.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6, '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['恋爱空间', '首日即第 1 天', '到点显形', '心情罐子', '回信收发对调', '三态']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'), '本版条目必须如实登记批次纪律（只跑单套件）');
});

