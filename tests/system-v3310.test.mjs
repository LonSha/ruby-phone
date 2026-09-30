// tests/system-v3310.test.mjs — 约会大作战（场景册 / 出资四路 / 计划到收场 / 结算卡 / 欠账台账）[v3.31.0]
//
//   本版接的是素材缝合路线图 **第 2 层第三件**：
//     约会大作战 —— 源 EPhone·xintuk `runtime/scripts/date/` 三片
//     （打包载荷 120530 字节 / 3195 行 / 51 个顶层函数）。
//
//   ★ 起手复算（复算见 TODO.md / 每次起手必须重新量）：
//     路线图把本件写成「日期（约会大作战）120KB」；实测源把**八块**塞在同一个屏幕上：
//     ① 场景册 ② 出资四路 ③ 开演与推进 ④ 结算卡 ⑤ 约会预设 ⑥ 立绘库 ⑦ BGM 面板 ⑧ 自定义场景。
//     本件取 ①②③④⑤⑧ —— 也就是源里唯一自带闭环的那条链：
//     「计划一场约会 → 谁出钱 → 走到结束 → 记下来 → 能回看」。
//     缺口复算：`约会` / `dating` 全仓落在 apps/calendar（纪念日，另一件事）；
//     `场景册` / `出资` / `欠账` 全仓 0 命中（真缺口）。
//
//   缝合**不是搬运**。两块**不取**（各有本仓更强的权威，或不是同一件事）：
//     · ⑥ 立绘库：源靠 x / y / size 三个滑块把立绘叠在背景上 —— 那是一套完整的编辑器，
//       与「约会」不是一件事；本仓也没有立绘权威（立绘归宿主渲染侧）。
//     · ⑦ BGM 面板：源读 `window.state.musicState.playlist` —— 那是「一起听」App 的曲库
//       （本仓有第二个权威）；音量写的是**全局键** `projectStorage`，会跨会话串味。
//
//   四处**不缝**（源里有、本仓明令禁止或有第二个权威的东西，一条都没进来）：
//     · 源**直改用户余额与角色银行卡**（四处 `updateUserBalanceAndLogTransaction` /
//       `updateCharacterPhoneBankBalance`）—— 本仓用户钱包的**仲裁源是微信零钱**，
//       一个 App 里再写一套扣钱逻辑就是同一笔钱有两个仲裁源。本件只算「谁出多少」
//       与「够不够」（`sourceOfFunds` / `walletGate`），出账入账交给那个权威。
//     · 源**直连模型**（三处自己拼 systemPrompt、自己打 `/v1/chat/completions`，
//       连 Gemini 分支都自己走）—— 本仓模型调用走宿主生成侧；故剧情不靠模型生成，
//       本件只登记「哪一段」「谁说的」，模型要看就走注入块。
//     · 源**落 Dexie 并往 `chat.history` 塞隐藏系统消息**（`db.chats.put(chat)` /
//       `chat.history.push({ isHidden: true })` / 结束时再塞 `pat_message`）—— 本仓零数据库铁律
//       （落 PhoneStorage、键走 `^date_`），且**不替宿主往对话里写楼层**；「分享」只产一份文本。
//     · 源把生图 URL（含 `data:`）写进场景与立绘、背景靠外链 —— 本件**一张图都不存、
//       一条外链都不收**，只登记宿主给的路径与用户自填提示词（`bareImageUrl` 去脏）。
//
//   四条**偏离**（偏离不是遗漏，逐条与文件头同源）：
//     ① 金额一律**整数金币**，且 `我出的 + Ta 出的 === 花费` 是**不变量**：
//        源用 `scene.cost / 2` 两次算 AA（浮点 + `toFixed(2)` 显示），且四路扣款各写一份。
//        本件 `sourceOfFunds` 是**唯一**的分配实现，AA 余数**明确归 Ta**；
//     ② 不做实时定时器 / 不做逐句动画（源 4 处 `setTimeout`：立绘淡入 ×2、文本 250ms
//        淡出淡入、卡片放大移除，还有点击防抖锁）—— 本件一个定时器都不转，要「到点」的地方
//        一律由时间推演（`runPhase` 拿 `now` 算）；
//     ③ 历史只留最近 `maxRuns`（40）场，更早的**如实计数后丢弃**（源无上界增长，
//        长会话下聊天存档被撑大）；
//     ④ **「没走到结束」不许当成一场完整的约会**：源只在 `isDateOver && completion >= 100`
//        时结算，否则那份 `datingGameState` 就静静挂内存里（重开全丢）。本件把「结束」做成
//        **显式事实**（`closeRun`），且评级的星数里有一条硬事实是「走到结束了没」。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 场景册：`花费是 0`（免费场景，合法）与 `花费没填` 是两件事（源写 `Number(cost) || 0`，
//       于是「没填」被当成 0）/ 场景名里带 `"` `)` 不许进 CSS 的 `url(...)`（源裸插）/
//       坏条目**如实计数**（dropped / dupes）不许静默丢 / 场景册有顶且如实计数；
//     B 出资：**四路 × 花费 0..11 的组合下 `userPart + charPart === cost` 恒成立** /
//       AA 的余数归 Ta（源两次 `cost / 2` 会丢半分钱或凭空多出）/
//       ★ **「读不到余额」与「余额是 0」不许塌成同一个读数**（源写 `userBalance || 0`）；
//     C 场次：`planned → running → ended` 三态 / **未定出资方式不许开演**（源点一下就跑）/
//       **已经收场的不许再收一次**（源会重复结算）/ 日志封顶 60 条并如实报满；
//     D 评级：按**可核对的三件事实**排星（钱对得上 / 走到收场 / 有记录），
//       **不取**源那三个模型报的数值（模型不报就恒为 0，于是永远只有最高档）；
//       半途收场照样能记 —— 但**记的是半途**，不冒充完整；
//     E 投影与归因：先判能不能读（`storage-absent` ≠ `empty`）/ 空投影不编数 /
//       两个面（scenes / runs）的 summary 与投影同一份口径；
//     F 注入：只给事实不给指令 / **无内容则空串（不产生空块）** / 关掉注入或条数 0 也是空串 /
//       条数真的钳到 1..20（源没有这一格）；
//     G 分享：只产一份**纯数据 + 一段可复制文本**，本视图一个字都不往聊天里写；
//     H 尾巴：历史只留最近 N 场并**如实计数**（`expiredRuns` / `totalRuns`）；
//     I 接线：四处注册齐备（槽位名 `dateApp` 驼峰）/ 视图调用面闭合在 App 上 /
//       样式源与 phone.css 逐字同源且类名有落点 / 前缀全仓唯一 / 四件套齐备 + 六块禁区没进来；
//     J 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（十五条）；
//     K 判据工具自证：剥注释器两向、替换必须保真、锚点必须在场，
//       且**代码里不得出现带裸引号的正则字面量**（本轮当场踩到，见 K3）；
//     V 版本锚（下限形）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/date/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），否则相对 import
//   会解析错位置、首跑即假红；判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   取段纪律（v3.28.0 立、v3.29.0 起沿用）：本套件接的**可能是末段也可能不是**，
//   故一律**按下一个段头截断**（`nxt = rest.indexOf('/* ---------- [', 1)`），不取文件尾 ——
//   这样下版往后接段时本判据依然绿，不会以「同源失败」假红（那是设计性报红，不是回归）。
//
//   批次纪律（本版特有，与 v3.29.0 / v3.30.0 同）：第二批全部做完前**只跑单套件**
//   （`node --test tests/system-v3310.test.mjs`），不跑全链 `check-file.mjs` ——
//   避免中途的噪声红掩盖真实回归。故本版条目里没有「全链收尾读数」，
//   只有「验证边界（诚实登记）」，全链读数留到第二批成套后那一版补。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    DATE_REASONS, DATE_FACES, FUND_MODES, RUN_PHASES, DATE_LIMITS, DEFAULT_DATE_SETTINGS,
    defaultDateSettings, normalizeDateSettings, readDateFace, msOfTime, localDateStr,
    startOfLocalDay, parseDateInput, isValidDateStr, sceneCanonical, sceneStyleTags,
    craftBackgroundPrompt, bareImageUrl, normalizeScenes, localScene, updatableScene,
    sourceOfFunds, walletGate, borrowPlan, planDateRun, assignFunds, noteBorrow,
    startRun, closeRun, addRunLine, attachStory, runPhase, humanSpan, rateDate, settleRun,
    sharePayload, shareText, pruneRunStore, projectDate, datePromptBlock, faceSummary,
} from '../apps/date/date-data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_REL = 'apps/date/date-data.js';
const APP_REL = 'apps/date/date-app.js';
const VIEW_REL = 'apps/date/date-view.js';
const CSS_REL = 'apps/date/date.css';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300 / v3290 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`setTimeout`、`Dexie`、`chat.history`、
 *    `postimg`、`/v1/chat/completions`…）是**说明**不是**消费**。
 *    判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）—— 因此被审代码里一旦出现
 *    「带裸引号的正则字面量」，本剥器会把那半个引号当成字符串起头，从那一行往后
 *    **块注释再也识不出来**（本条由 K3 专门钉住，v3.31.0 当场踩到并修掉）。 */
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

/** 一场最简场次（判据夹具）。
 *  ★ `charName` **故意与「我」不同名**，`mode` 故意取 `aa`：
 *    若夹具把两个人写成同一个名字、或把出资方式写成单边，则「AA 余数归 Ta」
 *    与「分享文本分列两边」那两条断言在「照抄单边」的实现上也一样绿 ——
 *    属本仓记过的「夹具不区分则判据空转」。下面 fundProblems 里有夹具自证。 */
const mkRun = (over) => ({
    uid: 'run_1', sceneUid: 'scene_1_1', sceneName: '夜市', cost: 10,
    charRef: 'c1', charName: '小雅', mode: 'aa', userPart: 5, charPart: 5,
    borrowed: 0, debtTo: '', phase: 'ended', plannedAt: 1000, startedAt: 2000, endedAt: 3000,
    storyText: '', log: [], ...(over || {}),
});

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A 场景册：花费 0 合法 / 没填拒收 / 名字带引号不许进 url() / 坏条目如实计数 ── */
function sceneProblems(api) {
    const bad = [];
    const L = api.DATE_LIMITS;
    /* 名字必须有（trim 后空 ⇒ no-name，不是「造一个空场景」）。 */
    for (const v of [{}, null, undefined, { name: '   ' }, { name: '', cost: 1 }]) {
        const r = api.sceneCanonical(v);
        if (r.ok !== false || r.problem !== 'no-name') bad.push('no-name:' + JSON.stringify(v));
    }
    /* ★ 花费：`0` 是**合法报价**（免费场景：公园散步、看落日），`没填` 必须拒。 */
    if (api.sceneCanonical({ name: 'x', cost: 0 }).ok !== true) bad.push('cost-0-must-pass');
    if (api.sceneCanonical({ name: 'x', cost: '0' }).ok !== true) bad.push('cost-str0');
    if (api.sceneCanonical({ name: 'x', cost: 12.6 }).scene.cost !== 13) bad.push('cost-round');
    for (const v of ['', null, undefined, 'x', -1, '-3', {}, [], true, false, NaN]) {
        const r = api.sceneCanonical({ name: 'x', cost: v });
        if (r.ok !== false || r.problem !== 'bad-cost') bad.push('bad-cost:' + String(v));
    }
    /* ★ 图片地址白名单：`http` / `data:image` / 本仓两条本地路径；其余一律拒。
     *   `javascript:` 是最好用的探针（假 URL 里最容易漏的一个）。 */
    for (const v of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x/y.png', 'data:text/html;base64,AA']) {
        const r = api.sceneCanonical({ name: 'x', cost: 0, imageUrl: v });
        if (r.ok !== false || r.problem !== 'bad-url') bad.push('bad-url:' + v);
    }
    for (const v of ['', 'https://x/y.png', 'data:image/png;base64,AA', '/backgrounds/a.png', 'assets/a.png']) {
        if (api.sceneCanonical({ name: 'x', cost: 0, imageUrl: v }).ok !== true) bad.push('good-url:' + v);
    }
    /* ★ 名字里的引号 / 括号不许进 CSS 的 `url(...)`（源直接拼 `style="...url(${u})"`）。
     *   修法是「去脏」而不是编码（编码会把合法 URL 弄坏）。 */
    if (api.bareImageUrl('  "/a.png)"  ') !== '/a.png') bad.push('bare:' + api.bareImageUrl('  "/a.png)"  '));
    if (api.bareImageUrl("a'b(c)d") !== 'abcd') bad.push('bare2:' + api.bareImageUrl("a'b(c)d"));
    if (api.bareImageUrl(null) !== '') bad.push('bare-null');
    /* ★ 坏条目**如实计数**（dropped / dupes），不是静默丢。 */
    const n = api.normalizeScenes([
        { name: 'a', cost: 1, uid: 'u1' },
        { name: 'b', cost: '' },
        null,
        { name: 'a2', cost: 1, uid: 'u1' },
        { name: 'c', cost: 2 },
    ]);
    if (n.list.length !== 2) bad.push('norm-keep:' + n.list.length);
    if (n.dropped !== 2) bad.push('norm-dropped:' + n.dropped);
    if (n.dupes !== 1) bad.push('norm-dupes:' + n.dupes);
    if (n.list[0].uid !== 'u1' || n.list[1].uid === 'u1') bad.push('norm-uid-dup');
    /* 没给 uid 的自动补一个（且不撞车）。 */
    const auto = api.normalizeScenes([{ name: 'a', cost: 0 }, { name: 'b', cost: 0 }]);
    if (!auto.list[0].uid || auto.list[0].uid === auto.list[1].uid) bad.push('norm-auto-uid');
    /* 场景册有顶，超出**如实计数**（trimmed）。 */
    const many = [];
    for (let i = 0; i < L.maxScenes + 4; i += 1) many.push({ name: 's' + i, cost: 0, uid: 'u' + i });
    const cap = api.normalizeScenes(many);
    if (cap.list.length !== L.maxScenes) bad.push('cap:' + cap.list.length);
    if (cap.trimmed !== 4) bad.push('cap-trimmed:' + cap.trimmed);
    /* 手建场景：给了图就不编提示词（源在有图时仍写 `User-provided image`）。 */
    const withImg = api.localScene({ name: '夜市', cost: 10, imageUrl: 'https://x/y.png' });
    if (withImg.ok !== true || withImg.scene.imagePrompt !== '') bad.push('local-with-img');
    const noImg = api.localScene({ name: '夜市', cost: 10 });
    if (noImg.ok !== true || !noImg.scene.imagePrompt) bad.push('local-no-img');
    if (noImg.scene.source !== 'user') bad.push('local-source');
    /* 手建场景的花费空串 ⇒ 拒收（不是 0），且带上人能看懂的原因。 */
    const badLocal = api.localScene({ name: 'x', cost: '' });
    if (badLocal.ok !== false || badLocal.problem !== 'bad-cost' || !badLocal.error) bad.push('local-badcost');
    /* 可编辑字段：uid / source 不可改；改成非法值则整条拒。 */
    const up = api.updatableScene({ name: 'a', cost: 1, uid: 'u1', source: 'builtin' }, { cost: 5, uid: 'hacked', source: 'user' });
    if (up.ok !== true || up.scene.uid !== 'u1' || up.scene.source !== 'builtin' || up.scene.cost !== 5) bad.push('updatable');
    if (api.updatableScene({ name: 'a', cost: 1 }, { cost: '' }).ok !== false) bad.push('updatable-bad');
    /* 提示词：五类关键词归三类，且**保留纯风景纪律**（no humans）。 */
    if (api.sceneStyleTags('夜市').kind !== 'outdoor') bad.push('tags-outdoor');
    if (api.sceneStyleTags('书店').kind !== 'indoor-public') bad.push('tags-indoor');
    if (api.sceneStyleTags('街拍').kind !== 'generic') bad.push('tags-generic');
    const pr = api.craftBackgroundPrompt({ name: '夜市', cost: 0 });
    if (!pr.includes('no humans')) bad.push('prompt-no-humans');
    if (api.craftBackgroundPrompt({ name: '', cost: 0 }) !== '') bad.push('prompt-empty');
    /* ★ 源对「情趣酒店」硬编码了一段英文擦边直译 —— 本件把它归回通用室内。 */
    const love = api.sceneStyleTags('情趣酒店');
    if (love.kind !== 'generic') bad.push('tags-love-hotel:' + love.kind);
    const joined = api.sceneStyleTags('my love hotel');
    if (joined.kind === 'outdoor') bad.push('tags-substring');
    return bad;
}

/* ── B 出资：四路 × 花费组合的不变量 / AA 余数归 Ta / 「读不到余额」≠「余额是 0」 ── */
function fundProblems(api) {
    const bad = [];
    const F = api.FUND_MODES;
    /* ★ 不变量：对**每一个**花费（0..11）× 四种方式，两边加起来必须正好等于花费。
     *   源用 `cost / 2` 浮点算两次 AA，且四路各写一份扣款（改一处忘一处）。 */
    for (let c = 0; c <= 11; c += 1) {
        for (const m of [F.user, F.char, F.aa, F.lend]) {
            const r = api.sourceOfFunds(m, c);
            if (r.ok !== true) { bad.push('fund-fail:' + m + ':' + c); continue; }
            if (r.userPart + r.charPart !== r.total || r.total !== c) {
                bad.push('fund-sum:' + m + ':' + c + '>' + r.userPart + '+' + r.charPart + '!=' + r.total);
            }
        }
    }
    /* AA 的余数**明确归 Ta**（7 → 3 / 4；源用 3.5 那种浮点）。 */
    const aa7 = api.sourceOfFunds(F.aa, 7);
    if (aa7.userPart !== 3 || aa7.charPart !== 4) bad.push('aa7:' + aa7.userPart + '/' + aa7.charPart);
    const aa8 = api.sourceOfFunds(F.aa, 8);
    if (aa8.userPart !== 4 || aa8.charPart !== 4) bad.push('aa8');
    /* 单边：我付 ⇒ 全在我；Ta 付 ⇒ 全在 Ta。`lend` 的 userPart 仍是他要还的总额。 */
    const u = api.sourceOfFunds(F.user, 9);
    if (u.userPart !== 9 || u.charPart !== 0) bad.push('mode-user');
    const ch = api.sourceOfFunds(F.char, 9);
    if (ch.userPart !== 0 || ch.charPart !== 9) bad.push('mode-char');
    const ln = api.sourceOfFunds(F.lend, 9);
    if (ln.userPart !== 9 || ln.charPart !== 0 || ln.mode !== F.lend) bad.push('mode-lend');
    /* 不知名的方式 / 坏花费 ⇒ 明确拒（不默认成单边）。 */
    for (const v of ['', null, undefined, 'aa2', 'AA', '我付']) {
        if (api.sourceOfFunds(v, 10).ok !== false) bad.push('mode-bad:' + String(v));
    }
    for (const v of ['', null, undefined, -1, 'x', {}, [], true, false]) {
        if (api.sourceOfFunds(F.aa, v).ok !== false) bad.push('cost-bad:' + String(v));
    }
    /* ★ 夹具自证：本组夹具的两人必须能区分（否则「AA 余数归 Ta」空转）。 */
    if (aa7.userPart === aa7.charPart) bad.push('fixture-indistinct');
    /* ★★ 「没给余额」与「余额是 0」**不许塌成同一个读数**（源写 `userBalance || 0`）。 */
    const noBal = api.walletGate(null, 2);
    if (noBal.ok !== false || noBal.error !== 'no-balance') bad.push('wallet-null:' + JSON.stringify(noBal));
    if (api.walletGate(undefined, 2).error !== 'no-balance') bad.push('wallet-undef');
    if (api.walletGate('', 2).error !== 'no-balance') bad.push('wallet-emptystr');
    if (api.walletGate('x', 2).error !== 'no-balance') bad.push('wallet-nan');
    const zero = api.walletGate(0, 2);
    if (zero.error !== 'short' || zero.shortfall !== 2 || zero.balance !== 0) bad.push('wallet-zero:' + JSON.stringify(zero));
    /* 刚好够（remaining === 0 也是「够」）。 */
    const just = api.walletGate(5, 5);
    if (just.ok !== true || just.remaining !== 0) bad.push('wallet-just:' + JSON.stringify(just));
    const rich = api.walletGate(100, 30);
    if (rich.ok !== true || rich.remaining !== 70) bad.push('wallet-rich');
    /* 借钱计划：只产事实（向谁借 / 多少 / 欠上之后多少），**不动任何余额**。 */
    const bp = api.borrowPlan(20, 10, 100, { others: [{ ref: 'p1', name: '老张' }] });
    if (bp.ok !== true || bp.lenderName !== '老张' || bp.amount !== 20 || bp.outstandingAfter !== 30) bad.push('borrow:' + JSON.stringify(bp));
    for (const a of [0, -1, '', null, undefined, 'x']) {
        if (api.borrowPlan(a, 0, 100, { others: [{ name: 'x' }] }).ok !== false) bad.push('borrow-amt:' + String(a));
    }
    if (api.borrowPlan(10, 0, 5, { others: [{ name: 'x' }] }).ok !== false) bad.push('borrow-cap');
    if (api.borrowPlan(10, 0, 100, { others: [] }).ok !== false) bad.push('borrow-nobody');
    return bad;
}

/* ── C 场次：计划 → 开演 → 收场 / 未定方式不许开演 / 不许重复收场 / 日志封顶 ── */
function runProblems(api) {
    const bad = [];
    const L = api.DATE_LIMITS;
    const P = api.RUN_PHASES;
    const scene = { name: '夜市', cost: 10, uid: 's1' };
    /* 计划：得到一条**可单独存在的事实**（还没开演也有读数）。 */
    const pl = api.planDateRun(scene, { ref: 'c1', name: '小雅' }, T0);
    if (pl.ok !== true || pl.run.phase !== P.planned) bad.push('plan:' + JSON.stringify(pl).slice(0, 80));
    if (pl.run.mode !== '' || pl.run.userPart !== 0 || pl.run.charPart !== 0) bad.push('plan-nomode');
    if (pl.run.startedAt !== null || pl.run.endedAt !== null) bad.push('plan-times');
    /* 计划时就能定方式（三处内联合成一步）。 */
    const pl2 = api.planDateRun(scene, { name: '小雅' }, T0, 'aa');
    if (pl2.ok !== true || pl2.run.mode !== 'aa' || pl2.run.userPart !== 5 || pl2.run.charPart !== 5) bad.push('plan-with-mode');
    /* 场景读不出来 / 没有角色名 / 时间非法 ⇒ 各自明确拒（不抛）。 */
    if (api.planDateRun({ name: '', cost: 0 }, { name: 'x' }, T0).problem !== 'no-name') bad.push('plan-bad-scene');
    if (api.planDateRun(scene, { ref: 'c1' }, T0).problem !== 'no-char') bad.push('plan-no-char');
    if (api.planDateRun(scene, { name: '小雅' }, null).problem !== 'no-time') bad.push('plan-no-time');
    /* ★ 宿主没给名字 ⇒ 如实空着，**绝不编人名**。 */
    if (api.planDateRun(scene, { ref: 'c1', name: '   ' }, T0).ok !== false) bad.push('plan-blank-char');
    /* 定方式：改了就整份重算（不许两份分配并存）。 */
    const r0 = api.planDateRun(scene, { name: '小雅' }, T0).run;
    const a1 = api.assignFunds(r0, 'char');
    if (a1.ok !== true || a1.run.mode !== 'char' || a1.run.userPart !== 0 || a1.run.charPart !== 10) bad.push('assign');
    const a2 = api.assignFunds(a1.run, 'aa');
    if (a2.run.userPart !== 5 || a2.run.charPart !== 5) bad.push('assign-replace');
    if (api.assignFunds(r0, 'nope').ok !== false) bad.push('assign-bad');
    /* ★ 未定出资方式**不许开演**（源点一下就跑，钱没算过照样出发）。 */
    const noMode = api.startRun(r0, T0);
    if (noMode.ok !== false) bad.push('start-nomode');
    /* 开演 → running 且带 startedAt。 */
    const st = api.startRun(a2.run, T0);
    if (st.ok !== true || st.run.phase !== P.running || st.run.startedAt !== T0) bad.push('start');
    /* ★ 收场是**显式事实**；已经收场的**不许再收一次**（源会重复结算）。 */
    const cl = api.closeRun(st.run, T0 + 3 * 60 * 60 * 1000);
    if (cl.ok !== true || cl.run.phase !== P.ended || cl.run.endedAt !== T0 + 3 * 60 * 60 * 1000) bad.push('close');
    if (api.closeRun(cl.run, T0 + 4 * 60 * 60 * 1000).ok !== false) bad.push('close-twice');
    if (api.startRun(cl.run, T0).ok !== false) bad.push('start-after-close');
    /* 日志：一条一追；空文本拒；封顶 60 条**如实报满**。 */
    if (api.addRunLine(st.run, '我', '   ', T0).ok !== false) bad.push('log-empty');
    let cur = st.run;
    for (let i = 0; i < L.maxLogPerRun; i += 1) {
        const r = api.addRunLine(cur, '我', 'l' + i, T0 + i);
        if (r.ok !== true) { bad.push('log-fill:' + i); break; }
        cur = r.run;
    }
    if (cur.log.length !== L.maxLogPerRun) bad.push('log-cap:' + cur.log.length);
    const over = api.addRunLine(cur, '我', 'x', T0);
    if (over.ok !== false || over.overCap !== true) bad.push('log-over');
    /* 日志里 `who` 空 ⇒ 落到「我」，不许出现无名日志。 */
    const w = api.addRunLine(st.run, '', 'x', T0);
    if (w.run.log[0].who !== '我') bad.push('log-who:' + w.run.log[0].who);
    /* 剧情：一段一体、可覆盖；空串拒。 */
    const s1 = api.attachStory(st.run, '我们去了夜市');
    if (s1.ok !== true || s1.run.storyText !== '我们去了夜市') bad.push('story');
    if (api.attachStory(st.run, '  ').ok !== false) bad.push('story-empty');
    /* 原对象**不许被改**（App 把它当「上一份」用）。 */
    if (st.run.log.length !== 0 || r0.mode !== '') bad.push('pure');
    /* 借钱登记：只记事实（欠谁多少），不改分配。 */
    const nb = api.noteBorrow(st.run, '老张', 30);
    if (nb.ok !== true || nb.run.borrowed !== 30 || nb.run.debtTo !== '老张') bad.push('note-borrow');
    const nb2 = api.noteBorrow(nb.run, '老王', 20);
    if (nb2.run.borrowed !== 50 || nb2.run.debtTo !== '老张') bad.push('note-borrow-sum:' + JSON.stringify([nb2.run.borrowed, nb2.run.debtTo]));
    for (const a of [0, -1, '', null]) {
        if (api.noteBorrow(st.run, 'x', a).ok !== false) bad.push('borrow-amt:' + String(a));
    }
    if (api.noteBorrow(st.run, '  ', 10).ok !== false) bad.push('borrow-who');
    if (api.noteBorrow(st.run, 'x', L.maxDebtAmount + 1).ok !== false) bad.push('borrow-huge');
    /* 场次读数：按 `now` 现算（与页面在不在无关，一个定时器都不转）。 */
    const ph = api.runPhase(cl.run, cl.run.endedAt + 90 * 60 * 1000);
    if (ph.phase !== P.ended || ph.elapsedMs !== 90 * 60 * 1000) bad.push('phase-ended:' + JSON.stringify(ph));
    const ph2 = api.runPhase(api.startRun(a2.run, T0).run, T0 + 30 * 60 * 1000);
    if (ph2.phase !== P.running || ph2.elapsedText !== '30 分钟') bad.push('phase-running:' + JSON.stringify(ph2));
    const ph3 = api.runPhase(r0, T0);
    if (ph3.phase !== P.planned || ph3.elapsedText !== '还没开始') bad.push('phase-planned:' + JSON.stringify(ph3));
    if (api.runPhase(null, T0).phase !== '') bad.push('phase-null');
    /* 时段人话：半天与跨天不许算成同一格。 */
    if (api.humanSpan(30 * 60 * 1000) !== '30 分钟') bad.push('span-min:' + api.humanSpan(30 * 60 * 1000));
    if (api.humanSpan(25 * 60 * 60 * 1000) !== '1 天') bad.push('span-day:' + api.humanSpan(25 * 60 * 60 * 1000));
    if (api.humanSpan(-1) !== '' || api.humanSpan('x') !== '') bad.push('span-bad');
    return bad;
}

/* ── D 评级 / 结算：按**可核对的三件事实**排星，不取模型报的数 ── */
function rateProblems(api) {
    const bad = [];
    /* 三件事实全中 ⇒ 3 星。 */
    const full = api.rateDate(mkRun({ storyText: 'x' }));
    if (full.stars !== 3 || !full.label) bad.push('rate3:' + JSON.stringify(full).slice(0, 90));
    if (!Array.isArray(full.facts) || full.facts.length !== 3) bad.push('rate-facts');
    const keys = full.facts.map((f) => f.key).join(',');
    if (keys !== 'money,ended,record') bad.push('rate-keys:' + keys);
    /* 只对得上钱（半途 + 没记录）⇒ 1 星。 */
    const one = api.rateDate(mkRun({ phase: 'planned', storyText: '', log: [] }));
    if (one.stars !== 1) bad.push('rate1:' + one.stars);
    /* ★ 钱对不上 ⇒ 那一颗星也没有（源从不校验钱，只信模型报的数值）。 */
    const brokeMoney = api.rateDate(mkRun({ userPart: 1, charPart: 1, storyText: 'x' }));
    if (brokeMoney.stars !== 2) bad.push('rate-badmoney:' + brokeMoney.stars);
    if (brokeMoney.facts[0].ok !== false) bad.push('rate-money-fact');
    /* ★ 半途收场：照样能记，但**记的是半途** —— 「走到收场了」那一格必须是 false。 */
    const half = api.rateDate(mkRun({ phase: 'running', storyText: 'x' }));
    if (half.stars !== 2 || half.facts[1].ok !== false) bad.push('rate-half:' + JSON.stringify([half.stars, half.facts[1].ok]));
    /* 空 / 坏输入 ⇒ 0 星且说清「没有这一场」（不抛）。 */
    for (const v of [null, undefined, 'x', 0]) {
        const r = api.rateDate(v);
        if (r.stars !== 0 || !r.label) bad.push('rate-bad:' + String(v));
    }
    /* 结算读数：都是非负整数，且「加起来对有花费」这条要能核对。 */
    const st = api.settleRun(mkRun({ borrowed: 3 }));
    if (st.cost !== 10 || st.userPaid !== 5 || st.charPaid !== 5 || st.borrowed !== 3) bad.push('settle:' + JSON.stringify(st));
    if (st.balanced !== true) bad.push('settle-balanced');
    if (api.settleRun(mkRun({ userPart: 1 })).balanced !== false) bad.push('settle-unbalanced');
    /* 坏输入一律给零值，不抛。 */
    const z = api.settleRun(null);
    if (z.cost !== 0 || z.userPaid !== 0 || z.charPaid !== 0 || z.balanced !== true) bad.push('settle-null');
    /* ★ 分享：只产**纯数据 + 一段可复制文本**；两份钱分列，且借了多少如实带上。 */
    const run = mkRun({ storyText: '我们去了夜市', borrowed: 3, log: [{ at: 1, who: '我', text: '好吃' }, { at: 2, who: '小雅', text: '嗯' }] });
    const pay = api.sharePayload(run, { myName: '阿柚' });
    if (!pay || pay.sceneName !== '夜市' || pay.charName !== '小雅' || pay.myName !== '阿柚') bad.push('payload-head');
    if (pay.stars !== 3 || !pay.rating) bad.push('payload-rate');
    if (pay.cost !== 10 || pay.userPaid !== 5 || pay.charPaid !== 5 || pay.borrowed !== 3) bad.push('payload-money');
    if (!Array.isArray(pay.log) || pay.log.length !== 2) bad.push('payload-log');
    if (api.sharePayload(null, {}) !== null) bad.push('payload-null');
    const txt = api.shareText(pay);
    if (!txt.includes('夜市') || !txt.includes('小雅')) bad.push('text-head:' + txt.slice(0, 40));
    if (!txt.includes('我出 5') || !txt.includes('Ta 出 5')) bad.push('text-money:' + txt);
    if (!txt.includes('借了 3')) bad.push('text-borrow');
    if (!txt.includes('我们去了夜市')) bad.push('text-story');
    /* ★ 一段可复制文本 = 一份**纯文本**：不许含标签（源拿它当聊天消息的 content）。 */
    if (/[<>]/.test(txt)) bad.push('text-has-tag');
    if (api.shareText(null) !== '') bad.push('text-null');
    /* 夹具自证：两个人的名字必须能区分（否则「我出 / Ta 出」空转）。 */
    if (pay.charName === pay.myName) bad.push('fixture-same-name');
    return bad;
}

/* ── E 投影 / 归因 / 注入：先判能不能读 / 空投影不编数 / 无内容不产块 ── */
function projectProblems(api) {
    const bad = [];
    /* ★ 归因三态：读不到就说读不到（不许说「空的」）。 */
    if (api.readDateFace(null) !== api.DATE_REASONS.storage_absent) bad.push('face-null');
    if (api.readDateFace({ storageOk: false, hasAny: true }) !== api.DATE_REASONS.storage_absent) bad.push('face-nostorage');
    if (api.readDateFace({ storageOk: true, hasAny: false }) !== api.DATE_REASONS.empty) bad.push('face-empty');
    if (api.readDateFace({ storageOk: true, hasAny: true }) !== api.DATE_REASONS.ready) bad.push('face-ready');
    /* 两个面（场景册 / 场次）。 */
    if (!api.DATE_FACES.includes('scenes') || !api.DATE_FACES.includes('runs')) bad.push('faces');
    /* ★ 空投影不编数。 */
    const p0 = api.projectDate(null, T0, {});
    if (p0.hasAny !== false) bad.push('proj-hasany');
    if (p0.sceneCount !== 0 || p0.runCount !== 0 || p0.spent !== 0 || p0.outstanding !== 0) bad.push('proj-zeros');
    if (p0.lastStars !== 0 || p0.lastRating !== '') bad.push('proj-last-zero');
    if (p0.todayDateStr !== api.localDateStr(T0)) bad.push('proj-today:' + p0.todayDateStr);
    /* 有内容时：三态计数 / 花了多少 / 欠着多少，逐项可复算。 */
    const p1 = api.projectDate({
        scenes: [{ name: '夜市', cost: 10, uid: 's1' }, { name: '公园', cost: 0, uid: 's2' }],
        runs: [
            mkRun({ uid: 'r1', plannedAt: 1, phase: 'ended', endedAt: 3 }),
            mkRun({ uid: 'r2', plannedAt: 2, phase: 'running', startedAt: 4, endedAt: null, cost: 0, userPart: 0, charPart: 0 }),
            mkRun({ uid: 'r3', plannedAt: 9, phase: 'planned', startedAt: null, endedAt: null, cost: 0, userPart: 0, charPart: 0 }),
        ],
        debts: [{ amount: 30 }],
    }, T0, {});
    if (p1.hasAny !== true) bad.push('proj-hasany1');
    if (p1.sceneCount !== 2 || p1.runCount !== 3) bad.push('proj-counts:' + p1.sceneCount + '/' + p1.runCount);
    if (p1.endedCount !== 1 || p1.runningCount !== 1 || p1.plannedCount !== 1) bad.push('proj-phases');
    /* 花费按**分配**累加（不按场景标价：AA 也是一人一半地花掉）。 */
    if (p1.spent !== 10) bad.push('proj-spent:' + p1.spent);
    if (p1.outstanding !== 30 || p1.debtCount !== 1) bad.push('proj-debt:' + p1.outstanding);
    /* 最近一场 = 时间最靠后的那一条（按 ended/started/planned 依次取）。 */
    if (p1.lastSceneName !== '夜市') bad.push('proj-last-scene:' + p1.lastSceneName);
    /* 「最近一场」按 endedAt → startedAt → plannedAt 依次取时间最大的那个：
     * r3 的 plannedAt=9 最大 ⇒ 最近一场是 r3（钱对得上、没走到收场、没记录 ⇒ 一星）。 */
    if (p1.lastStars !== 1) bad.push('proj-last-stars:' + p1.lastStars);
    if (p1.lastRunAt !== 9) bad.push('proj-last-at:' + p1.lastRunAt);
    /* 两个面的 summary 与投影**同一份口径**。 */
    if (!api.faceSummary(p1, 'scenes').includes('2')) bad.push('summary-scenes:' + api.faceSummary(p1, 'scenes'));
    const sRuns = api.faceSummary(p1, 'runs');
    if (!sRuns.includes('1')) bad.push('summary-runs:' + sRuns);
    if (api.faceSummary(p0, 'scenes') !== '还什么都没有') bad.push('summary-empty');
    /* 全空但可读 ⇒ 「还没有去处」而不是「还什么都没有」。 */
    const onlyRuns = api.projectDate({ scenes: [], runs: [mkRun()] }, T0, {});
    if (api.faceSummary(onlyRuns, 'scenes') !== '还没有去处') bad.push('summary-no-scenes');
    const onlyScenes = api.projectDate({ scenes: [{ name: 'a', cost: 0 }], runs: [] }, T0, {});
    if (api.faceSummary(onlyScenes, 'runs') !== '还没约过') bad.push('summary-no-runs');
    return bad;
}

function injectProblems(api) {
    const bad = [];
    /* ★ 无内容 ⇒ 空串（**不产生空块**）—— 与 taobao / loverspace / widget 同规格。 */
    if (api.datePromptBlock(null, {}) !== '') bad.push('inject-null');
    if (api.datePromptBlock({ hasAny: false }, {}) !== '') bad.push('inject-empty');
    /* ★ 投影说「有东西」但一条事实也摆不出来 ⇒ 仍须空串（不许只给一个头行）。
     *   源那段是无条件拼一个 systemPrompt 前缀的，于是会产出「只有开头没有内容」的空块。 */
    if (api.datePromptBlock({ hasAny: true }, {}) !== '') bad.push('inject-no-content');
    const p = {
        hasAny: true, sceneCount: 2, sceneNames: ['公园', '夜市'],
        runCount: 3, plannedCount: 1, runningCount: 1, endedCount: 1,
        outstanding: 30, debtCount: 1, lastSceneName: '夜市', lastRating: '按计划走完的一场',
    };
    const blk = api.datePromptBlock(p, {});
    /* ★ 头行必须带**换行**（桃宝那一版漏过，头行与第一条事实粘成一行）。 */
    if (!blk.includes('约会大作战')) bad.push('inject-head:' + JSON.stringify(blk.slice(0, 40)));
    if (blk.charAt(0) !== '\n') bad.push('inject-lead-nl');
    if (!blk.endsWith('\n')) bad.push('inject-tail-nl');
    if (!blk.includes('2 个去处') || !blk.includes('公园')) bad.push('inject-scenes');
    if (!blk.includes('1 场')) bad.push('inject-runs');
    if (!blk.includes('30')) bad.push('inject-debt');
    /* ★ 只给**事实**，不给指令（源这段是自己拼 systemPrompt 直接发给模型）。 */
    for (const cmd of ['请', '你要', '必须', '应该', '扮演', '生成']) {
        if (blk.includes(cmd)) bad.push('inject-imperative:' + cmd);
    }
    /* 关闭注入 ⇒ 空串。
     *  ★ 注：条数 0 **不是**合法输入 —— 本件的契约是「钳到 1..20」（视图那一格 min=1），
     *   所以不在这里挂「条数为 0 就是空串」的判据：那会给一个不存在的输入造契约。 */
    if (api.datePromptBlock(p, { injectToPrompt: false }) !== '') bad.push('inject-off');
    /* 条数上限真的生效（钳到 1..20）。 */
    const one = api.datePromptBlock(p, { maxInjectLines: 1 });
    const body = one.split('\n').filter((x) => x.startsWith('- '));
    if (body.length !== 1) bad.push('inject-max1:' + body.length);
    const huge = api.datePromptBlock(p, { maxInjectLines: 999 });
    const body2 = huge.split('\n').filter((x) => x.startsWith('- '));
    if (body2.length > api.DATE_LIMITS.maxInjectLines) bad.push('inject-clamp:' + body2.length);
    /* 设置规范化：未知字段不进、布尔按真值收、条数钳住。 */
    const st = api.normalizeDateSettings({ maxInjectLines: 999, injectToPrompt: 0, xx: 1, defaultFundMode: 'aa' });
    if (st.maxInjectLines !== 20 || st.injectToPrompt !== false || 'xx' in st) bad.push('settings:' + JSON.stringify(st));
    if (st.defaultFundMode !== 'aa') bad.push('settings-mode');
    if (api.normalizeDateSettings({ defaultFundMode: 'nope' }).defaultFundMode !== '') bad.push('settings-badmode');
    if (api.defaultDateSettings().injectToPrompt !== true) bad.push('defaults');
    if (api.normalizeDateSettings(null).maxInjectLines !== api.DEFAULT_DATE_SETTINGS.maxInjectLines) bad.push('settings-default');
    if (api.normalizeDateSettings({ allowBorrowFromDate: 1 }).allowBorrowFromDate !== true) bad.push('settings-bool');
    return bad;
}

/* ── F 尾巴：历史只留最近 N 场并**如实计数** ── */
function pruneProblems(api) {
    const bad = [];
    const L = api.DATE_LIMITS;
    const runs = [];
    for (let i = 0; i < 45; i += 1) runs.push(mkRun({ uid: 'r' + i, plannedAt: i, endedAt: i }));
    const pr = api.pruneRunStore({ runs: runs, debts: [] }, 40);
    if (pr.store.runs.length !== 40) bad.push('prune-keep:' + pr.store.runs.length);
    if (pr.expiredRuns !== 5 || pr.totalRuns !== 45) bad.push('prune-count:' + pr.expiredRuns + '/' + pr.totalRuns);
    /* 留的是**最近**的（时间最靠后的 40 条：5..44）。 */
    const kept = pr.store.runs.map((r) => r.plannedAt).sort((a, b) => a - b);
    if (kept[0] !== 5 || kept[kept.length - 1] !== 44) bad.push('prune-newest:' + kept[0] + '..' + kept[kept.length - 1]);
    /* 欠账台账也有顶，更早的如实计数。 */
    const debts = [];
    for (let i = 0; i < L.maxDebts + 3; i += 1) debts.push({ amount: i });
    const pr2 = api.pruneRunStore({ runs: [], debts: debts });
    if (pr2.store.debts.length !== L.maxDebts) bad.push('prune-debts:' + pr2.store.debts.length);
    if (pr2.expiredDebts !== 3) bad.push('prune-debts-expired:' + pr2.expiredDebts);
    /* 坏输入：给默认，不抛。 */
    const pr3 = api.pruneRunStore(null);
    if (!Array.isArray(pr3.store.runs) || pr3.store.runs.length !== 0 || pr3.totalRuns !== 0) bad.push('prune-null');
    /* 没给上限 ⇒ 用本件默认（40）。 */
    const many = [];
    for (let i = 0; i < L.maxRuns + 7; i += 1) many.push(mkRun({ uid: 'x' + i, plannedAt: i }));
    if (api.pruneRunStore({ runs: many }).store.runs.length !== L.maxRuns) bad.push('prune-default-cap');
    /* 原对象不许被改。 */
    const base = { runs: [mkRun()], debts: [] };
    api.pruneRunStore(base, 0);
    if (base.runs.length !== 1) bad.push('prune-pure');
    return bad;
}

/* ── G 日期与时刻（源的 `toISOString` / 直接 `new Date` 两处坑） ── */
function dateProblems(api) {
    const bad = [];
    /* ★ `2026-02-30` 是最阴的一种：看着像日期，`new Date` 会静默顺延成 3-02。 */
    if (api.parseDateInput('2026-02-30') !== null) bad.push('feb30');
    if (api.parseDateInput('2026-02-29') !== null) bad.push('feb29-nonleap');
    if (api.parseDateInput('2024-02-29') === null) bad.push('feb29-leap');
    if (api.parseDateInput('2026-04-31') !== null) bad.push('apr31');
    if (api.parseDateInput('2026-13-01') !== null) bad.push('month13');
    if (api.parseDateInput('2026-00-10') !== null) bad.push('month0');
    for (const v of [null, undefined, '', 'x', '2026/09/15', '26-9-15', 0, true, {}, []]) {
        if (api.parseDateInput(v) !== null) bad.push('bad-input:' + String(v));
    }
    /* `Date` 与毫秒都接受（宿主可能给任一形）；且**同一天不管几点都算同一天**。 */
    const d0 = local0(2026, 1, 1);
    if (api.parseDateInput(new Date(2026, 0, 1)) !== d0) bad.push('date-input:' + api.parseDateInput(new Date(2026, 0, 1)));
    if (api.isValidDateStr('2026-09-15') !== true) bad.push('valid-str');
    if (api.isValidDateStr('2026-09-31') !== false) bad.push('valid-str-31');
    /* ★ `msOfTime` 必须把 `Date` 显式取毫秒再过门（v3.30.0 当场踩到：直接丢给门 ⇒ 读成「什么都没给」）。 */
    if (api.msOfTime(new Date(0)) !== 0) bad.push('ms-date:' + api.msOfTime(new Date(0)));
    if (api.msOfTime(1234) !== 1234) bad.push('ms-num');
    if (api.msOfTime('1234') !== 1234) bad.push('ms-str');
    if (api.msOfTime(null) !== null || api.msOfTime('') !== null || api.msOfTime('x') !== null) bad.push('ms-bad');
    /* 本地日期串：★ 偏离②（源取的是 UTC 日期串，东八区凌晨会算到昨天）。 */
    if (api.localDateStr(local0(2026, 9, 5) + 3 * 60 * 60 * 1000) !== '2026-09-05') {
        bad.push('local-str:' + api.localDateStr(local0(2026, 9, 5) + 3 * 60 * 60 * 1000));
    }
    if (api.localDateStr(local0(2026, 9, 5) + 23 * 60 * 60 * 1000) !== '2026-09-05') bad.push('local-str-late');
    if (api.localDateStr(null) !== '') bad.push('local-str-null');
    /* 当天 0 点：跨月也不许靠时区误算。 */
    if (api.startOfLocalDay(T0) !== local0(2026, 9, 15)) bad.push('start-day:' + api.startOfLocalDay(T0));
    if (api.startOfLocalDay(null) !== null) bad.push('start-null');
    return bad;
}

/* ══════════════════════ 接线（四处注册 + 调用面 + 样式 + 前缀 + 四件套） ══════════════════════ */
const APP_ID = 'date';
const APP_CLS = 'DateApp';
const CSS_PFX = '.dat-';
const KEY_PFX = 'date';

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
    /* ★ 槽位名是**驼峰**（window.VirtualPhone.dateApp），不是「前缀 + App」（前缀全小写 `date`）。
     *   REBIND 表与三个清理按的就是这个**槽位**：名字对不上时换会话不会重绑，而门禁一声不响。 */
    const slot = 'dateApp';
    assert.ok(idx.includes('window.VirtualPhone.' + slot + ' = new module.' + APP_CLS + '('),
        'index.js 必须把 ' + APP_CLS + ' 留在 window.VirtualPhone.' + slot);
    assert.ok(tbl.includes("'" + slot + "'"), 'REBIND 表必须含 ' + slot + ' 槽位');
    assert.ok(storage.includes('/^' + KEY_PFX + '_/'), '会话隔离表必须有 /^' + KEY_PFX + '_/');
    /* 条目注释里必须写明「哪些不缝 / 哪些不取」——那几行的存在本身是这一件的定位凭据。 */
    assert.ok(apps.includes('四处不缝'), 'config/apps.js 的约会大作战条目必须写明不缝清单');
    assert.ok(apps.includes('两块不取'), '条目必须写明不取清单（立绘库 / BGM 面板）');
    assert.ok(apps.includes('四条偏离'), '条目必须写明四条偏离');
    assert.ok(apps.includes('[v3.31.0]'), '条目必须带本版标记');
});

test('H2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'face', 'storage', 'shell', 'limits', 'proj', 'projection',
        'view', '_view', 'app', 'state', 'scenes', 'runs', 'debts', 'wallet', '_current', '_root']);
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
    /* ★ 视图不许自写**场次状态**字面量（两边各写一份 = 改文案时只改一处，静默不一致）。
     *   注：`no-balance` / `short` 这类**不是状态文案**而是 `walletGate` 的返回码 ——
     *   视图拿它分支是正当的（它是 API 契约，不是可改的显示文案），故不在禁列。 */
    const view = stripComments(viewSrc);
    for (const s of ["'planned'", '"planned"', "'running'", '"running"', "'ended'", '"ended"',
        "'storage-absent'", '"storage-absent"']) {
        assert.equal(view.includes(s), false, '视图不得自写状态/归因字面量（应走数据层常量）：' + s);
    }
    assert.ok(viewSrc.includes('RUN_PHASES'), '视图的状态文案必须由数据层的三态常量计算');
    assert.ok(viewSrc.includes('DATE_REASONS.'), '视图文案表的键必须由归因常量计算');
    assert.ok(viewSrc.includes('FUND_MODES.'), '出资四路的文案必须由数据层的四路常量计算');
});

test('H3 样式源与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    const HDR = '/* ---------- [v3.31.0] 约会大作战 App（' + CSS_PFX + '*） ---------- */';
    const at = phone.indexOf(HDR);
    assert.ok(at >= 0, 'phone.css 必须带本版段头：' + HDR);
    const rest = phone.slice(at);
    /* ★ 取段纪律（v3.28.0 立）：**按下一个段头截断**，不取文件尾 ——
     *   本段当前恰好是末段，但本取法对「下版往后接段」依然正确，不会以「同源失败」假红。 */
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
     *   `q('.dat-foot')` —— 只认「querySelector( 紧跟选择器」会把全部 q(...) 锚点漏掉。 */
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

test('H4 前缀全仓唯一：.dat- 只出现在本 App 目录与 phone.css', () => {
    const walk = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            /* ★ 只排除「判据文件自己」（它满篇写着 `.dat-`）：不能整目录排除 tests/，
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
    /* ★ **发行说明面豁免**（v3300 起的既有口径，本件沿用并显式写明）：
     *   `update-log.json`（更新弹窗的真源）与 `index.js` 的内置公告块是**面向用户的
     *   变更说明**，里面必然要**引用**本版落的类名前缀（「`.dat-` 前缀」）才能说清楚
     *   这一版做了什么。那不是「代码里顺手借了别人的类名」，故第 ① 段只扫**代码面**。
     *   ② 段改为**常量级**唯一性：前缀只能由本 App 目录与 phone.css 声明 ——
     *   「别处又声明了一次这个前缀」才是真越界（例如把样式也写进别的 App 的 css）。 */
    /* ① 代码面：除本 App 目录、phone.css、以及**发行说明面**（更新弹窗真源 `update-log.json`、
     *   内置公告所在的 `index.js`、以及公告的条目真源 `tools/iter*_items.json` / `_seg.md`）
     *   之外，不许有别的文件提到本前缀。 */
    const isReleaseNotes = (f) => f.endsWith('update-log.json') || f.endsWith('/index.js')
        || /\/tools\/iter\d+_(items\.json|seg\.md)$/.test(f);
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(CSS_PFX));
    assert.ok(users.length > 0, CSS_PFX + ' 必须在仓里被用到');
    for (const f of users) {
        assert.ok(f.includes('/apps/' + APP_ID + '/') || f.endsWith('phone.css') || isReleaseNotes(f),
            CSS_PFX + ' 只应出现在 apps/' + APP_ID + '/ 与 phone.css（发行说明面除外），实测还有：' + f.replace(ROOT, ''));
    }
    /* ② 常量级唯一：除本 App 目录 / phone.css / 内置公告块外，全仓不得有第二个文件
     *    **声明**这个前缀（声明形：`.dat-` 后面紧跟 `*`（CSS 族注释）或作为 CSS 选择器起点）。 */
    const decl = [];
    for (const f of files) {
        if (f.includes('/apps/' + APP_ID + '/') || f.endsWith('phone.css')) continue;
        const txt = fs.readFileSync(f, 'utf8');
        if (f.endsWith('index.js')) {
            /* index.js：公告块整块剥掉后，**代码面**不许再提到本前缀。 */
            const blk = txt.match(/const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/);
            const rest = blk ? txt.slice(0, blk.index) + txt.slice(blk.index + blk[0].length) : txt;
            if (rest.includes(CSS_PFX)) decl.push(f.replace(ROOT, '') + '(代码面)');
            continue;
        }
        if (txt.includes(CSS_PFX + '*') || txt.includes(CSS_PFX + '{')) decl.push(f.replace(ROOT, ''));
    }
    assert.deepEqual(decl, [], '除本 App 目录与 phone.css 外不得声明本前缀：' + decl.join(' , '));
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
    for (const banned of ['userBalance', 'updateUserBalanceAndLogTransaction',
        'updateCharacterPhoneBankBalance', 'characterPhoneBank', 'userWalletTransactions', '.bank']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得碰钱包字段：' + banned);
    }
    /* ③ 零外部素材（源把生图 URL 与外链背景写进场景）。 */
    for (const banned of ['http://', 'https://', 'postimg', 'new Audio', '.mp3', '.png', '.jpg']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得内置外链素材：' + banned);
    }
    /* ④ 不自己调模型（源三处自己拼 systemPrompt 直发）。 */
    for (const banned of ['chat/completions', 'refreshDatingScenes', 'triggerDatingStory',
        'triggerNsfwScene', 'modelCall']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得自己调模型：' + banned);
    }
    /* ⑤ 不碰聊天层（源把整份 chat 落库、还往 history 塞隐藏系统消息）。 */
    for (const banned of ['datingGameState', 'datingHistory', 'datingScenes', 'datingPresets',
        'db.chats', 'chat.history', 'history.push', 'saveChat']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得碰聊天层：' + banned);
    }
    /* ⑥ 不取「立绘库 / BGM 面板」两块（本仓各有更强权威或不是一件事）。 */
    for (const banned of ['sprite', '立绘', 'musicState', 'playlist', 'bgmAudio', 'projectStorage', 'BGM']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得取立绘库 / BGM 面板：' + banned);
    }
    /* ⑦ 零动态求值：外来 HTML 只当文本留存（源把整段剧情塞进 innerHTML）。 */
    for (const banned of ['innerHTML', 'eval(', 'new Function']) {
        assert.equal(code.includes(banned), false, DATA_REL + ' 不得动外来 HTML / 动态求值：' + banned);
    }
    /* App 层：不转定时器、不碰钱包、不发请求、不碰数据库、不替宿主写楼层。 */
    const appCode = stripComments(read(APP_REL));
    for (const banned of ['setTimeout', 'setInterval', 'userBalance',
        'updateUserBalanceAndLogTransaction', 'updateCharacterPhoneBankBalance',
        'fetch(', 'XMLHttpRequest', 'indexedDB', 'Dexie', 'db.chats', 'chat.history',
        'history.push', 'saveChat', 'postimg', 'https://', 'http://', 'new Function']) {
        assert.equal(appCode.includes(banned), false, APP_REL + ' 不得出现：' + banned);
    }
    /* ★ 钱包只**读**：本件的唯一合法接触面是读微信零钱的余额，且「读不到」要如实标出来。
     *   不许出现任何**写**那边的名字（那是钱包那个权威的事）。 */
    for (const banned of ['setWalletBalance', 'recordWalletTransaction', 'spendWalletBalance',
        'updateWalletBalance', 'resetWalletBalance', '_appendWalletTransaction']) {
        assert.equal(appCode.includes(banned), false, APP_REL + ' 不得写钱包：' + banned);
    }
    assert.ok(appCode.includes('getWalletBalance'), APP_REL + ' 必须用微信零钱的**读**接口');
    /* 视图：不直接读存储（一切数据变动都回调到 App 上）、不写聊天。 */
    const viewCode = stripComments(read(VIEW_REL));
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'setTimeout',
        'setInterval', 'db.chats']) {
        assert.equal(viewCode.includes(banned), false, VIEW_REL + ' 不得出现：' + banned);
    }
    /* 样式前缀。 */
    assert.ok(read(CSS_REL).includes(CSS_PFX), CSS_REL + ' 必须用 ' + CSS_PFX + ' 前缀');
    /* 归因连字符形在数据层定义（视图文案表的键取的是它的**值**）。 */
    assert.ok(data.includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ══════════════════════ I ── 键归属 ══════════════════════ */
test('I1 三条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const src = read(APP_REL);
    const hits = [...src.matchAll(new RegExp("'(" + KEY_PFX + "_[a-z_]+)'", 'g'))].map((m) => m[1]);
    const uniq = [...new Set(hits)];
    assert.equal(uniq.length, 3, '本件三条键，实测 ' + uniq.join(','));
    assert.deepEqual(uniq.slice().sort(), ['date_scenes', 'date_settings', 'date_store'],
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
/** 破坏表集中在一处：K2 会拿它做「锚点在场性 + 替换保真」的批量自证。
 *  ★ 本表的锚点一律取**代码行**（不取注释），且一律用字面 split/join 替换。 */
const DAMAGE = {
    /* 假日期不再反查 ⇒ 「2026-02-30 必须拒」转红。 */
    d1: [DATA_REL,
        '    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;',
        '    if (y < 0) return null;'],
    /* `Date` 不再显式取毫秒 ⇒ 「传了 Date 被读成没传」转红。 */
    d2: [DATA_REL,
        '    if (v instanceof Date) return numOrNull(v.getTime());',
        '    if (false) return numOrNull(v.getTime());'],
    /* 花费不再挡住「没填」⇒ 「没填 ≠ 0」转红。 */
    d3: [DATA_REL,
        "    if (cost === null || cost < 0) return { ok: false, problem: 'bad-cost' };",
        '    if (cost < 0) return { ok: false, problem: \'bad-cost\' };'],
    /* AA 不再把余数归 Ta（改成两人各拿一半、余数丢掉）⇒ 「加起来等于花费」转红。 */
    d4: [DATA_REL,
        '        return { ok: true, mode: m, userPart: userPart, charPart: total - userPart, total: total };',
        '        return { ok: true, mode: m, userPart: userPart, charPart: userPart, total: total };'],
    /* 读不到余额不再单独报 ⇒ 「读不到 ≠ 余额不足」塌成一态，转红。
     *  ★ 锚点取**整段**函数体：只替换 `if (b === null) …` 那一行会让 `b` 被重赋值（const），
     *   破坏副本当场抛 TypeError —— 那是「破坏方式自己造异常」，不是我们要证的静默失效。 */
    d5: [DATA_REL,
        "export function walletGate(balance, need) {\n"
        + "    const b = numOrNull(balance);\n"
        + "    const n = numOrNull(need);\n"
        + "    if (n === null || n < 0) return { ok: false, error: 'bad-need' };\n"
        + "    if (b === null) return { ok: false, error: 'no-balance', need: n };\n"
        + "    if (b < n) return { ok: false, error: 'short', balance: b, need: n, shortfall: n - b };\n"
        + "    return { ok: true, balance: b, need: n, remaining: b - n };\n"
        + '}',
        "export function walletGate(balance, need) {\n"
        + "    const b = numOrNull(balance) === null ? 0 : numOrNull(balance);\n"
        + "    const n = numOrNull(need);\n"
        + "    if (n === null || n < 0) return { ok: false, error: 'bad-need' };\n"
        + "    if (b < n) return { ok: false, error: 'short', balance: b, need: n, shortfall: n - b };\n"
        + "    return { ok: true, balance: b, need: n, remaining: b - n };\n"
        + '}'],
    /* 未定出资方式也放行开演 ⇒ 「未定 mode 不许开演」转红。 */
    d6: [DATA_REL,
        "    if (!run.mode) return { ok: false, error: '还没定谁出钱' };",
        '    if (false) return { ok: false, error: \'x\' };'],
    /* 收场不再记结束时刻 ⇒ 「收场是显式事实」转红。 */
    d7: [DATA_REL,
        '    return { ok: true, run: Object.assign({}, run, { phase: RUN_PHASES.ended, endedAt: ts }) };',
        '    return { ok: true, run: Object.assign({}, run, { phase: RUN_PHASES.ended, endedAt: null }) };'],
    /* 日志不再封顶 ⇒ 「一场封顶 60 条」转红。 */
    d8: [DATA_REL,
        '    if (cur.length >= DATE_LIMITS.maxLogPerRun) {',
        '    if (false) {'],
    /* 评级不再看「钱对得上」⇒ 那一颗星不再可核对，转红。 */
    d9: [DATA_REL,
        '    const moneyOk = (u + c === cost);',
        '    const moneyOk = true;'],
    /* 关掉注入仍产块 ⇒ 「关掉就是空串」转红。 */
    d10: [DATA_REL,
        "    if (!s.injectToPrompt || !p || !p.hasAny) return '';",
        "    if (!p || !p.hasAny) return '';"],
    /* 无内容也产一个空块 ⇒ 「无内容不产块」转红。 */
    d11: [DATA_REL,
        "    const take = lines.slice(0, s.maxInjectLines);\n    if (!take.length) return '';",
        '    const take = lines.slice(0, s.maxInjectLines);\n    if (false) return \'\';'],
    /* 历史不再如实计数（丢弃的条数归零）⇒ 「如实计数」转红。 */
    d12: [DATA_REL,
        '    const expiredRuns = sorted.length - kept.length;',
        '    const expiredRuns = 0;'],
    /* uid 撞车不再去重 ⇒ 「撞车去重并计数」转红。 */
    d13: [DATA_REL,
        '        if (seen[s.uid]) { dupes++; continue; }',
        '        if (false) { dupes++; continue; }'],
    /* 图片地址白名单整段放行 ⇒ 「javascript: / file: 必须拒」转红。 */
    d14: [DATA_REL,
        "    if (!isSafeImageUrl(url)) return { ok: false, problem: 'bad-url' };",
        '    if (false) return { ok: false, problem: \'bad-url\' };'],
    /* 本地日期串改回 UTC（源的做法）⇒ 「本地时区」转红。 */
    /* ★ 锚点取在 `p` 这个补零助手上（而不是拼接那一行）：
     *   本仓测试环境 TZ=UTC，直接改成 `toISOString()` 在 UTC 下与本地串**同值**，
     *   破坏不会显形（在 UTC+8 的实机上才会）—— 那是「负控制静默假绿」。
     *   改掉补零助手则两种时区下都必然显形。 */
    d15: [DATA_REL,
        "    const p = (x) => String(x).padStart(2, '0');",
        "    const p = (x) => String(x);"],
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3310_'));
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
    DATE_REASONS: m.DATE_REASONS, DATE_FACES: m.DATE_FACES, FUND_MODES: m.FUND_MODES,
    RUN_PHASES: m.RUN_PHASES, DATE_LIMITS: m.DATE_LIMITS,
    DEFAULT_DATE_SETTINGS: m.DEFAULT_DATE_SETTINGS, defaultDateSettings: m.defaultDateSettings,
    normalizeDateSettings: m.normalizeDateSettings, readDateFace: m.readDateFace, msOfTime: m.msOfTime,
    localDateStr: m.localDateStr, startOfLocalDay: m.startOfLocalDay, parseDateInput: m.parseDateInput,
    isValidDateStr: m.isValidDateStr, sceneCanonical: m.sceneCanonical, sceneStyleTags: m.sceneStyleTags,
    craftBackgroundPrompt: m.craftBackgroundPrompt, bareImageUrl: m.bareImageUrl,
    normalizeScenes: m.normalizeScenes, localScene: m.localScene, updatableScene: m.updatableScene,
    sourceOfFunds: m.sourceOfFunds, walletGate: m.walletGate, borrowPlan: m.borrowPlan,
    planDateRun: m.planDateRun, assignFunds: m.assignFunds, noteBorrow: m.noteBorrow,
    startRun: m.startRun, closeRun: m.closeRun, addRunLine: m.addRunLine, attachStory: m.attachStory,
    runPhase: m.runPhase, humanSpan: m.humanSpan, rateDate: m.rateDate, settleRun: m.settleRun,
    sharePayload: m.sharePayload, shareText: m.shareText, pruneRunStore: m.pruneRunStore,
    projectDate: m.projectDate, datePromptBlock: m.datePromptBlock, faceSummary: m.faceSummary,
});
const REAL = apiOf({
    DATE_REASONS, DATE_FACES, FUND_MODES, RUN_PHASES, DATE_LIMITS, DEFAULT_DATE_SETTINGS,
    defaultDateSettings, normalizeDateSettings, readDateFace, msOfTime, localDateStr, startOfLocalDay,
    parseDateInput, isValidDateStr, sceneCanonical, sceneStyleTags, craftBackgroundPrompt, bareImageUrl,
    normalizeScenes, localScene, updatableScene, sourceOfFunds, walletGate, borrowPlan, planDateRun,
    assignFunds, noteBorrow, startRun, closeRun, addRunLine, attachStory, runPhase, humanSpan,
    rateDate, settleRun, sharePayload, shareText, pruneRunStore, projectDate, datePromptBlock, faceSummary,
});

/* 逐条负控制：每条都用「同款真判据」在破坏副本上重跑，并要求对照（真实现必须干净）。 */
const NEG = [
    ['J1 破坏「假日期反查」⇒ 日期判据必须转红', 'd1', dateProblems, ['feb30', 'bad-input', 'apr31']],
    ['J2 破坏「`Date` 显式取毫秒」⇒ 日期判据必须转红', 'd2', dateProblems, ['ms-date', 'date-input']],
    ['J3 破坏「没填花费要拒」⇒ 场景判据必须转红', 'd3', sceneProblems, ['bad-cost']],
    ['J4 破坏「AA 余数归 Ta」⇒ 出资判据必须转红', 'd4', fundProblems, ['fund-sum', 'aa7']],
    ['J5 破坏「读不到余额单独报」⇒ 出资判据必须转红', 'd5', fundProblems, ['wallet-null', 'wallet-undef']],
    ['J6 破坏「未定出资方式不许开演」⇒ 场次判据必须转红', 'd6', runProblems, ['start-nomode']],
    ['J7 破坏「收场记下结束时刻」⇒ 场次判据必须转红', 'd7', runProblems, ['close', 'phase-ended']],
    ['J8 破坏「日志封顶 60 条」⇒ 场次判据必须转红', 'd8', runProblems, ['log-cap', 'log-over']],
    ['J9 破坏「评级看钱对不对」⇒ 评级判据必须转红', 'd9', rateProblems, ['rate-badmoney', 'rate-money-fact']],
    ['J10 破坏「关掉注入就是空串」⇒ 注入判据必须转红', 'd10', injectProblems, ['inject-off']],
    ['J11 破坏「无内容不产空块」⇒ 注入判据必须转红', 'd11', injectProblems, ['inject-no-content']],
    ['J12 破坏「历史丢弃要如实计数」⇒ 尾巴判据必须转红', 'd12', pruneProblems, ['prune-count']],
    ['J13 破坏「uid 撞车去重」⇒ 场景判据必须转红', 'd13', sceneProblems, ['norm-dupes']],
    ['J14 破坏「图片地址白名单」⇒ 场景判据必须转红', 'd14', sceneProblems, ['bad-url']],
    ['J15 破坏「本地时区日期串」⇒ 日期判据必须转红', 'd15', dateProblems, ['local-str', 'local-str-late']],
];

for (const [title, key, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const mod = await loadDamagedCopy(rel, from, to);
        const bad = judge(apiOf(mod));
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        assert.deepEqual(judge(REAL), [], '对照：真实现必须干净');
    });
}

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
    for (const w of ['setTimeout', 'Dexie', 'chat.history', 'postimg', 'innerHTML', 'BGM', 'chat/completions']) {
        assert.ok(read(DATA_REL).includes(w), '文件头应当写明源里的 ' + w + '（它是「说明」，不是「消费」）');
    }
});

test('K2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    /* ★ 负控制自身最隐蔽的失效形态是**锚点漂移**——产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    assert.ok(Object.keys(DAMAGE).length >= 15, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3310_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'date'), { recursive: true });
    const realCopy = path.join(tmp, 'apps', 'date', 'date-data.js');
    fs.copyFileSync(path.join(ROOT, DATA_REL), realCopy);
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(realCopy).href).then((m) => {
        assert.equal(m.sourceOfFunds('aa', 7).userPart, 3,
            '副本按真目录结构摊开后必须能加载且行为同真件（只引唯一取数门）');
    });
});

test('K3 本件三文件的块注释必须真能被剥掉，且工作面不得出现「正文带 ASCII 引号的正则字面量」', () => {
    /* ★ 为什么必须有：本仓判据共用的 `stripComments` **不解析正则字面量**。
     *   代码里一旦写出 `/["'()]/g` 这种（字符类或正文里带引号、转义形也算）的正则，
     *   剥器会把那半个引号当成**字符串的起头** —— 从那一行往后，块注释再也识不出来。
     *   于是 H5 那种「剥注释后不得出现 setInterval / Dexie / chat.history」的强判据
     *   会把自己的**说明文字**当成消费（与产品无关的假红），更坏的方向是把**真**消费
     *   剥掉（假绿）。v3.31.0 当场踩到两处：`bareImageUrl`（data 层 303 行起的注释失守）
     *   与 `_esc` 里的 `/"/g`（date-view 的**尾随**块注释失守）。
     *   这是真实隐患（隐患不是「判据太严」），故一律修在**产品侧**，判据这边分两层钉：
     *   ① 地面自证 —— 三个文件加上**尾随哨兵块注释**后，哨兵必须被剥掉（这直接测剥器
     *      在本件源码上有没有失守，不受任何正则解析口径影响）；
     *   ② 工作面扫 —— 本 App 三份 JS 的**代码位**上不得有正文带 ASCII 引号的正则字面量。
     */
    const trap = 'const bad = /["\'()]/g;\n/* 说明 setInterval */\nconst a = 1;';
    assert.ok(stripComments(trap).includes('说明'), '剥器确实会被裸引号正则击穿（本条的判别力来自这里）');
    const cleanTrap = 'const ok = /\\x22\\x27/g;\n/* 说明 setInterval */\nconst a = 1;';
    assert.equal(stripComments(cleanTrap).includes('说明'), false, '不用引号的正则不得击穿剥器（反向自证）');

    /* ① 地面自证：尾随哨兵必须被剥掉 ⇒ 剥器在这份源码上没有失守。 */
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        const code = stripComments(read(rel) + '\n/* RP_SENTINEL_TAIL_BLOCK */\n');
        assert.equal(code.includes('RP_SENTINEL_TAIL_BLOCK'), false,
            rel + ' 的尾随块注释没被剥掉 ⇒ 剥注释器在本文件上失守（某处正则字面量含引号）');
        assert.equal(code.includes('/*'), false, rel + ' 剥注释后仍有 /* 残留（说明剥器被击穿）');
        assert.equal(code.includes('*/'), false, rel + ' 剥注释后仍有 */ 残留（说明剥器被击穿）');
    }

    /* ② 工作面扫：字符串感知的正则字面量识别（`/` 只在「可起始正则」的位置才算正则，
     *    字符串 / 注释里的 `/` 一律不算 —— 朴素正则做不到这一点，会把 `' / '` 与
     *    `'</span>'` 里的斜杠误当真则，那正是本条第一版的假红现场）。 */
    const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'do', 'else',
        'void', 'new', 'delete', 'case', 'yield', 'await', 'throw']);
    const scanQuotedRegex = (src) => {
        const out = [];
        let i = 0; const n = src.length; let state = 'code'; let prev = [];
        const allowRegex = () => {
            let j = prev.length - 1;
            while (j >= 0 && /\s/.test(prev[j])) j -= 1;
            if (j < 0) return true;
            const ch = prev[j];
            if (/[A-Za-z0-9_$]/.test(ch)) {
                let k = j;
                while (k >= 0 && /[A-Za-z0-9_$]/.test(prev[k])) k -= 1;
                return KEYWORDS.has(prev.slice(k + 1, j + 1).join(''));
            }
            if (ch === ')' || ch === ']' || ch === '}' || ch === "'" || ch === '"' || ch === '`') return false;
            return true;
        };
        while (i < n) {
            const c = src[i]; const d = src[i + 1];
            if (state === 'code') {
                if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
                if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
                if (c === "'" || c === '"' || c === '`') { state = c; i += 1; continue; }
                if (c === '/' && allowRegex()) {
                    let j = i + 1; let cls = false; let bad = false;
                    while (j < n) {
                        const e = src[j];
                        if (e === '\\') { j += 2; continue; }
                        if (e === '\n') { bad = true; break; }
                        if (e === '[') cls = true;
                        else if (e === ']') cls = false;
                        else if (e === '/' && !cls) { j += 1; break; }
                        j += 1;
                    }
                    let flags = '';
                    while (j < n && /[gimsuy]/.test(src[j])) { flags += src[j]; j += 1; }
                    const text = src.slice(i, j);
                    /* 只在它真像字面量（带 flag，或后接「表达式结束」符）时才算 */
                    if (!bad && (flags.length > 0 || /[),;\]}.=?:&\n]|$/.test(src[j] || ''))) {
                        if (text.includes('"') || text.includes("'")) out.push(text);
                    }
                    for (const ch of text) prev.push(ch);
                    if (prev.length > 400) prev = prev.slice(-400);
                    i = j; continue;
                }
                prev.push(c);
                if (prev.length > 400) prev = prev.slice(-400);
                i += 1; continue;
            }
            if (state === 'line') { i += 1; continue; }
            if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
            if (c === '\\') { i += 2; continue; }
            i += 1;
            if (c === state) state = 'code';
        }
        return out;
    };
    /* 扫描器自证：坏写法必须被抓、字符串里的 `/` 与「不用引号的正则」不许被抓。 */
    assert.deepEqual(scanQuotedRegex('const a = /["\']/g; const b = 1;').length, 1, '裸引号正则必须被抓');
    assert.deepEqual(scanQuotedRegex('const a = /\\"/g; const b = 1;').length, 1, '转义形引号也必须被抓（朴素剥器看的是原始字符）');
    assert.deepEqual(scanQuotedRegex("const s = '</span>'; const t = ' / ';"), [], "字符串里的 `/` 不许被抓");
    assert.deepEqual(scanQuotedRegex('const r = /[\\x22\\x27]/g; const q = 1;'), [], '改用 \\x 转义的正则不受影响');
    assert.deepEqual(scanQuotedRegex('const r = a / b; const q = c / d;'), [], '除号不许被抓');
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        const hits = scanQuotedRegex(read(rel));
        assert.deepEqual(hits, [], rel + ' 的代码位出现「正文带引号的正则字面量」（会把判据剥注释器击穿）：' + hits.join(' , '));
    }
});

/* ══════════════════════ 内核判据挂测 ══════════════════════ */
test('A1 场景册：花费 0 合法 / 没填拒收 / 名字带引号不许进 url() / 坏条目如实计数', () => {
    const bad = sceneProblems(REAL);
    assert.deepEqual(bad, [], '场景册口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(DATE_LIMITS.maxScenes, 60, '场景册封顶就是 60');
    assert.equal(sceneCanonical({ name: 'x', cost: 0 }).ok, true, '免费场景必须合法');
});

test('B1 出资：四路 × 花费不变量 / AA 余数归 Ta / 读不到余额 ≠ 余额是 0', () => {
    const bad = fundProblems(REAL);
    assert.deepEqual(bad, [], '出资口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(walletGate(null, 1).error, 'no-balance', '读不到要说读不到');
    assert.equal(walletGate(0, 1).error, 'short', '余额是 0 才叫不够');
});

test('C1 场次：计划 → 开演 → 收场 / 未定方式不许开演 / 不许重复收场 / 日志封顶', () => {
    const bad = runProblems(REAL);
    assert.deepEqual(bad, [], '场次口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(DATE_LIMITS.maxLogPerRun, 60, '一场封顶 60 条日志');
});

test('D1 评级与分享：按可核对的三件事实排星 / 半途不冒充完整 / 分享只产纯文本', () => {
    const bad = rateProblems(REAL);
    assert.deepEqual(bad, [], '评级与分享口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(rateDate(mkRun({ storyText: 'x' })).stars, 3, '三件事实全中才是三星');
});

test('E1 投影与归因：先判可读 / 空投影不编数 / 两个面 summary 同源', () => {
    const bad = projectProblems(REAL);
    assert.deepEqual(bad, [], '投影口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(readDateFace({ storageOk: false, hasAny: true }), DATE_REASONS.storage_absent, '读不到就是读不到');
});

test('E2 注入只给事实：无内容则空串（不产生空块）/ 头行带换行 / 条数真的钳住', () => {
    const bad = injectProblems(REAL);
    assert.deepEqual(bad, [], '注入口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('F1 尾巴收紧：历史只留最近 N 场并如实计数（源的库无上界）', () => {
    const bad = pruneProblems(REAL);
    assert.deepEqual(bad, [], '尾巴口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(DATE_LIMITS.maxRuns, 40, '历史留最近 40 场');
});

test('F2 本件一个定时器都不转：源 4 处 setTimeout 做逐句动画，本件改按时间推演', () => {
    for (const rel of [DATA_REL, APP_REL, VIEW_REL]) {
        const code = stripComments(read(rel));
        assert.equal(code.includes('setInterval'), false, rel + ' 不得转常驻定时器');
        assert.equal(code.includes('setTimeout'), false, rel + ' 不得转一次性定时器');
    }
    /* 而「多久了」这件事必须真的由 `now` 推出来（不是靠定时器重画）。 */
    assert.equal(humanSpan(90 * 60 * 1000), '1 小时');
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 31),
        '本套件成立于 RubyPhone 3.31.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.31.0 约会大作战），不是「当版」——
     *   抬版后 latest 换成新件。此前本仓已有四处「守别人的版」的口径错
     *   （v3270 / v3280 / v3290 / v3300，均在下一版当场报红），本件从起手就按 SELF 写。 */
    const SELF = '3.31.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6, '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['约会', '出资', '读不到', 'AA', '注入', '历史']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'), '本版条目必须如实登记批次纪律（只跑单套件）');
});
