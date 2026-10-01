// tests/system-v3320.test.mjs — 游戏厅（上半 · 海龟汤 + 你说我猜）[v3.32.0]
//
//   本版接的是素材缝合路线图 **第 2 层第四件：游戏厅**（上半）。
//
//   ★ 起手复算（每次起手必须重新量）：
//     路线图把这一层写成「游戏厅 672KB」的整块；实测源是 EPhone·xintuk
//     `runtime/scripts/game-hall/` 九片（打包载荷 339805 字节），解包后
//     271887 字符 / 7588 行 / 123 个顶层函数 —— 一台**单体宿主脚本**，
//     依赖 showScreen / state.chats / db.*（Dexie），AI 调用自己拼 systemPrompt
//     直打 /v1/chat/completions（apiKey 40 处 / model 50 处 / fetch( 21 处）。
//     它不是一件，是**六件**：狼人杀 / 海龟汤 / 剧本杀 / 你说我猜 / 心动飞行棋 / 谁是卧底。
//
//   ★ 取舍（六取四，两件让位既有权威）：
//     `狼人杀` 全仓 8 命中、`谁是卧底` 9 命中 —— 本仓对此两款已有权威
//     （apps/games/werewolf/ 与 apps/games/undercover/），源的同名实现一行不取。
//     `游戏厅` / `gameHall` / `海龟汤` / `剧本杀` / `飞行棋` 全仓 0 命中（真缺口）。
//     四件分两版：v3.32.0 落海龟汤 + 你说我猜（同为「一方出题、另一方靠对话
//     逼近答案」的对话型对局）；v3.33.0 落剧本杀 + 心动飞行棋。
//
//   ★ 缝合**不是搬运**。四处**不缝**（源里有、本仓明令禁止或有第二个权威的，
//     一条都没进来）：
//     · 源落 Dexie（`db.chats.put` / `db.scriptKillScripts` / `db.ludoQuestions`）
//       —— 本仓零数据库铁律（落 PhoneStorage，键 `chat_games_*`，按聊天独立）；
//     · 源往 `chat.history` push 可见 `share_link` 卡 + `isHidden: true` 的 system
//       指令来驱动模型 —— 本仓**不替宿主往对话里写楼层**，「分享」只产一份文本；
//     · 源自己拼 systemPrompt 直打 `/v1/chat/completions` —— 本仓走宿主生成侧
//       （`window.VirtualPhone.apiManager.callAI`，可被预设 / 可被中断 / 记账一致）；
//     · 源把图与外链写进状态 —— 本件一张图都不存、一条外链都不收。
//
//   ★ 三条**偏离**（偏离不是遗漏，逐条与文件头同源）：
//     ① **模型的 JSON 由自证提取器取**，不靠 `JSON.parse` 一把梭：
//        `_extractDialogGameJson` 剥围栏后从首个 `{` 逐字符扫描（跟踪字符串态
//        与转义），最外层括号配平时才 parse；取不到返回 null 由上层回退
//        （海龟汤回退「无关」、你说我猜回退「再给点线索」）；
//     ② **两条 AI 节流是显式常量**（海龟汤每步 2200ms / 你说我猜每步 1200ms /
//        请求间共用一次性冷却 5000ms —— 与狼人杀、谁是卧底同量级）；
//     ③ **子游戏一律三件套**挂进既有大厅容器，样式前缀各自独占（`.sts-` / `.gw-`）
//        —— 同批落地但**互不复用**，避免两件之一被替换时把另一件的观感带走。
//
//   ★ 本版起手就抓到的两处真缺陷（都由门禁当场报红，不是自述）：
//     · **加载链是坏的**：两个数据层把取数门写成 `../../config/num-gate.js`
//       （`apps/games/<name>/` 到仓根是**三层**），而**语法门完全看不出来**
//       （文件本身语法正确）—— 由 import-resolve 门抓住；
//     · **两条会话键没登记归属**：`chat_games_seaturtle_state` /
//       `chat_games_guesswhat_state` 未进 keys 账本 —— 不登记不报错，
//       只是**换会话串味**；由 keys 门 K1 抓住。
//
//   ★ 功能级失效（本仓迭代主线「导出了能力但全库零调用点」）本件自身也踩了五处：
//     修三（`GuessWhatData.setMode` / `GUESSWHAT_AI_STEP_DELAY_MS` /
//     `getUserTurnLabel`）、删三（四个只写不读的视图字段、`_avatar` 的死参数）。
//     本套件的 E 组把「不许再退化回去」钉成判据。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 海龟汤内核：日志封顶**保留首条系统日志**（源无上界）/ 判定四档之外一律
//       落「无关」（不许把模型说的怪词原样透出去）/ 卡关判定要**真的按比例**（最近 8 条
//       ≥75% 无关）且样本不足时不许乱报 / 出题人按模式抽取的**边界**（没有 AI 可抽时返回 -1
//       —— 源此处 `random_ai` 会崩）/ 开局的三个前提（有出题人 / 谜面 / 谜底）缺一不可；
//     B 你说我猜内核：`isGuessHit` 的宽松匹配**两向都成立**（互为子串）且空值不许误判成中 /
//       撤回只撤回**最后一组**「用户 + AI」且顺序不对时不许乱剪 / 轮次上限真的到顶 /
//       **校验失败不许留下半截状态**（源与初版都把 state 换成 playing 再判空返回）；
//     C 接线：两套入口 / 常量的量级关系 / 视图调用面闭合 / 生命周期级联 / 返回手势链；
//     D 通道：一律走 `apiManager.callAI`（**不许出现 fetch / apiKey / endpoint**）/
//       JSON 提取器对坏输入返回 null 而不是猜 / 围栏剥法**不许含反引号字面量**；
//     E 活性：导出的能力必须有调用点（`setMode` / `getUserTurnLabel` /
//       `GUESSWHAT_AI_STEP_DELAY_MS` 各有非声明处命中）；四个死字段不许回来；
//     F 样式：两份样式前缀**各自独占且互不出现在对方文件里** / 每个产出类名有落点；
//     G 大厅卡片：两张卡片在场、绑了点击、且**卡片配色与图标有样式落点**
//       （起手时 art 类无样式落点，本版补上）；
//     H 键归属：两条会话键登记且 scope=chat / 精确枚举面在场；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向、围栏新旧写法等价、破坏表锚点在场；
//     V 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/games/<name>/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），
//   否则相对 import 会解析错位置、首跑即假红；判据函数仍只吃**数据对象**，
//   不吃模块内部实现。
//
//   批次纪律：本批（第 2 层四件）全部收干前**只跑单套件**（`node --test`）；
//   本件收干后补跑全链（上一版 v3.31.0 的教训留档：单套件全绿 ≠ 全链绿）。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    TURTLE_PROVIDER_MODES, TURTLE_RIDDLE_TYPES, TURTLE_JUDGEMENTS, SeaTurtleData,
} from '../apps/games/seaturtle/seaturtle-data.js';
import {
    GUESS_MODES, GUESS_MAX_ROUNDS, GuessWhatData, isGuessHit,
} from '../apps/games/guesswhat/guesswhat-data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TS_DATA = 'apps/games/seaturtle/seaturtle-data.js';
const TS_VIEW = 'apps/games/seaturtle/seaturtle-view.js';
const TS_CSS = 'apps/games/seaturtle/seaturtle.css';
const GW_DATA = 'apps/games/guesswhat/guesswhat-data.js';
const GW_VIEW = 'apps/games/guesswhat/guesswhat-view.js';
const GW_CSS = 'apps/games/guesswhat/guesswhat.css';
const APP = 'apps/games/games-app.js';
const POKER_VIEW = 'apps/games/poker/poker-view.js';
const POKER_CSS = 'apps/games/poker/poker.css';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300 / v3310 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`Dexie`、`chat.history`、
 *    `setInterval`、`/v1/chat/completions`…）是**说明**不是**消费**。
 *    判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）—— 因此被审代码的正则正文里
 *    一旦出现**裸的引号或反引号**，剥器会把它当成字符串/模板串的起头，
 *    从那处往后块注释再也识不出来。v3.31.0 踩到的是引号，v3.32.0 踩到的是
 *    **反引号**（`_extractDialogGameJson` 的围栏写法）—— 两次都由 D/K 组钉住。 */
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

/** 假存储：只记内存，`get` 返回结构化克隆（不许判据与被测件共用同一份对象引用）。 */
function fakeStorage(seed = null) {
    const box = { value: seed };
    return {
        get: () => (box.value === null || box.value === undefined ? null : JSON.parse(JSON.stringify(box.value))),
        set: (_k, v) => { box.value = JSON.parse(JSON.stringify(v)); },
        _raw: box,
    };
}

/** 一个最简牌桌（判据夹具）。
 *  ★ 夹具里**故意**让「我」与另一个角色同场，且出题人不是用户：
 *    若夹具只有用户一人，则「谁能提问」「出题人是不是用户」这两条断言在
 *    「永远返回用户」的实现上也一样绿 —— 属本仓记过的「夹具不区分则判据空转」。
 *    下面 turtleProblems 里有夹具自证。 */
const mkPlayers = () => ([
    { id: 'user', name: '我', isUser: true },
    { id: 'c1', name: '小雅', persona: '爱说反话' },
    { id: 'c2', name: '阿澈', persona: '话少' },
]);

/** 起一局到「猜谜中」。
 *  ★ 座位是**洗过牌**的（数据层设计如此：「让出题人不可预测」），所以「谁当出题人」
 *    不能按下标写死 —— 写死下标时约 1/3 概率落到用户头上，于是
 *    `fixture-provider-is-user` / `fixture-user-cannot-ask` 随机报红（本轮实测）。
 *    这里一律按**身份**取下标。 */
function seatIndex(data, id) {
    return (data.getState().players || []).findIndex((p) => p.id === id);
}

function startedTurtle(api, over = {}) {
    /* ★ 必须用 api 上的构造器：负控制要的是「在破坏副本上跑同款判据」，
     *   写死顶层 import 的真件会让整组负控制静默退化成「在真件上重跑一遍」。 */
    const storage = fakeStorage();
    const data = new api.SeaTurtleData(storage);
    data.seatPlayers(mkPlayers());
    data.startGame({
        providerIndex: seatIndex(data, 'c1'),
        riddle: '他走进电梯，出来时成了另一个人。',
        answer: '双胞胎换了衣服。',
        ...over,
    });
    return data;
}

function startedGuess(api, mode = 'ai_guesses', word = '蒲公英') {
    const storage = fakeStorage();
    const data = new api.GuessWhatData(storage);
    data.startGame({ mode, opponent: { id: 'c1', name: '小雅' }, secretWord: word });
    return data;
}

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A 海龟汤内核 ── */
function turtleProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);

    /* A0 夹具自证：出题人不是用户、同桌不止一人 —— 否则下面几条会空转。 */
    {
        const d = new api.SeaTurtleData(fakeStorage());
        d.seatPlayers(api.__mkPlayers());
        d.startGame({ providerIndex: seatIndex(d, 'c1'), riddle: 'r', answer: 'a' });
        const st = d.getState();
        if (!st.players.some((p) => p.isUser)) push('fixture-no-user');
        if (st.players.filter((p) => !p.isUser).length < 2) push('fixture-too-few-ai');
        if (d.getProvider()?.isUser) push('fixture-provider-is-user');
        if (d.canUserAsk() !== true) push('fixture-user-cannot-ask');
    }

    /* A1 四档之外一律落「无关」（不许把模型说的怪词原样透出去）。 */
    {
        const d = startedTurtle(api);
        const got = d.addAnswer({ judgement: '大概是吧', remark: '' });
        if (got !== '无关') push('judge-fallback');
        const logs = d.getState().log.filter((e) => e.type === 'answer');
        if (logs[logs.length - 1]?.text !== '无关') push('judge-fallback-log');
    }
    /* A2 四档之内原样保留。 */
    for (const j of api.TURTLE_JUDGEMENTS) {
        const d = startedTurtle(api);
        if (d.addAnswer({ judgement: j }) !== j) push('judge-keep:' + j);
    }
    /* A3 日志封顶，且**保留首条系统日志**（源无上界）。 */
    {
        const d = startedTurtle(api);
        const first = d.getState().log[0]?.text || '';
        for (let i = 0; i < 600; i += 1) d.addQuestion({ question: 'q' + i, player: { id: 'c2', name: '阿澈' } });
        const log = d.getState().log;
        if (log.length !== api.TURTLE_MAX_LOG) push('log-cap');
        if (log[0]?.type !== 'system' || log[0]?.text !== first) push('log-keeps-first');
    }
    /* A4 卡关判定按**比例**而不是「有一条无关就算」；样本不足时不许乱报。 */
    {
        const d = startedTurtle(api);
        for (let i = 0; i < 4; i += 1) { d.addQuestion({ question: 'q' }); d.addAnswer({ judgement: '无关' }); }
        if (d.isStuck() !== false) push('stuck-too-few-samples');
        d.addQuestion({ question: 'q9' });
        d.addAnswer({ judgement: '无关' });
        if (d.isStuck() !== true) push('stuck-should-fire');
    }
    {
        const d = startedTurtle(api);
        for (let i = 0; i < 8; i += 1) { d.addQuestion({ question: 'q' }); d.addAnswer({ judgement: i < 2 ? '是' : '无关' }); }
        /* 6/8 = 75% ⇒ 恰好到线（`>=`），必须是卡关 */
        if (d.isStuck() !== true) push('stuck-boundary-75');
    }
    {
        const d = startedTurtle(api);
        for (let i = 0; i < 8; i += 1) { d.addQuestion({ question: 'q' }); d.addAnswer({ judgement: i < 3 ? '是' : '无关' }); }
        /* 5/8 = 62.5% ⇒ 不到线 */
        if (d.isStuck() !== false) push('stuck-below-threshold');
    }
    /* A5 出题人按模式抽取的**边界**：没有 AI 可抽时返回 -1（源此处会崩）。 */
    {
        const d = new api.SeaTurtleData(fakeStorage());
        d.seatPlayers([{ id: 'user', name: '我', isUser: true }]);
        if (d.pickProviderIndex('random_ai') !== -1) push('pick-no-ai');
        if (d.pickProviderIndex('user') !== 0) push('pick-user-mode');
    }
    /* A6 开局三前提缺一不可（有出题人 / 谜面 / 谜底）。 */
    {
        const d = new api.SeaTurtleData(fakeStorage());
        d.seatPlayers(api.__mkPlayers());
        if (d.startGame({ providerIndex: seatIndex(d, 'c1'), riddle: 'r', answer: 'a' }) !== true) push('start-normal');
        const d2 = new api.SeaTurtleData(fakeStorage());
        d2.seatPlayers(api.__mkPlayers());
        if (d2.startGame({ providerIndex: seatIndex(d2, 'c1'), riddle: '', answer: 'a' }) !== false) push('start-needs-riddle');
        if (d2.getState().phase !== 'setup') push('start-fail-keeps-phase');
        /* 出题人下标越界（源在这里按 `players[idx]` 直接取，会崩）。 */
        const d3 = new api.SeaTurtleData(fakeStorage());
        d3.seatPlayers(api.__mkPlayers());
        if (d3.startGame({ providerIndex: 99, riddle: 'r', answer: 'a' }) !== false) push('start-needs-provider');
    }
    /* A7 出题人只在猜谜阶段、且出题人不是用户时，用户才能提问。 */
    {
        const d = startedTurtle(api);
        if (d.canUserAsk() !== true) push('can-ask-guessing');
        d.reveal();
        if (d.canUserAsk() !== false) push('can-ask-after-reveal');
    }
    /* A8 「猜谜者」不含出题人；「用户」能取到。 */
    {
        const d = startedTurtle(api);
        if (d.getGuessers().some((p) => p.isProvider)) push('guessers-excludes-provider');
        if (d.getUserPlayer()?.id !== 'user') push('user-player');
        if (d.getProvider()?.id !== 'c1') push('provider-player');
    }
    /* A9 复盘里必须同时有谜面与谜底（缺哪个都不能叫复盘）。 */
    {
        const d = startedTurtle(api);
        const s = d.getSummary();
        if (!s.includes('双胞胎换了衣服')) push('summary-has-answer');
        if (!s.includes('他走进电梯')) push('summary-has-riddle');
    }
    /* A10 重开一局时出题人重标（旧标记必须清掉，且**全桌只有一个**出题人）。 */
    {
        const d = startedTurtle(api);
        d.startGame({ providerIndex: seatIndex(d, 'c2'), riddle: 'r2', answer: 'a2' });
        if (d.getProvider()?.id !== 'c2') push('provider-redefined');
        if (d.getState().players.filter((p) => p.isProvider).length !== 1) push('provider-unique');
    }
    return bad;
}

/* ── B 你说我猜内核 ── */
function guessProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);

    /* B1 宽松匹配：忽略大小写与空白、**互为子串**都算中。 */
    if (!api.isGuessHit('蒲公英', '蒲公英')) push('hit-same');
    if (!api.isGuessHit(' 蒲 公 英 ', '蒲公英')) push('hit-spaces');
    if (!api.isGuessHit('PUGONGYING', 'pugongying')) push('hit-case');
    if (!api.isGuessHit('一朵蒲公英', '蒲公英')) push('hit-superstring');
    if (!api.isGuessHit('蒲公英', '蒲公英的种子')) push('hit-substring');
    /* 空值不许误判成中（源拿 `includes('')` 会恒真）。 */
    if (api.isGuessHit('', '蒲公英') !== false) push('hit-empty-guess');
    if (api.isGuessHit('蒲公英', '') !== false) push('hit-empty-answer');
    if (api.isGuessHit('', '') !== false) push('hit-both-empty');
    if (api.isGuessHit('月亮', '蒲公英') !== false) push('hit-miss');

    /* B2 撤回只撤回**最后一组**「用户 + AI」，且顺序是「用户在前」时才剪。 */
    {
        const d = startedGuess(api);
        d.addUserTurn({ text: '它是植物' });
        d.addAiTurn({ text: '会开花吗？' });
        const back = d.rewindLastAiTurn();
        if (back !== '它是植物') push('rewind-returns-original');
        if (d.getState().log.some((e) => e.type === 'ai-turn')) push('rewind-drops-ai');
        if (d.getState().log.some((e) => e.type === 'user-turn')) push('rewind-drops-user');
        if (d.getState().round !== 0) push('rewind-round-back');
    }
    /* 只有系统日志（还没走过一轮）时不许乱剪。 */
    {
        const d = startedGuess(api);
        if (d.rewindLastAiTurn() !== null) push('rewind-nothing-to-undo');
        if (d.getState().log.filter((e) => e.type === 'system').length !== 1) push('rewind-keeps-system');
    }
    /* 顺序不对（AI 在前、用户在后）时必须拒绝，不许把系统日志当用户回合剪掉。 */
    {
        const d = startedGuess(api);
        d.addAiTurn({ text: 'hint' });
        if (d.rewindLastAiTurn() !== null) push('rewind-refuses-bad-order');
        if (d.getState().log.filter((e) => e.type === 'ai-turn').length !== 1) push('rewind-bad-order-keeps-log');
    }
    /* B3 轮次上限真的到顶（源没有这一格）。 */
    {
        const d = startedGuess(api);
        if (d.isRoundLimitReached() !== false) push('round-limit-initial');
        for (let i = 0; i < api.GUESS_MAX_ROUNDS; i += 1) d.addAiTurn({ text: 'h' + i });
        if (d.isRoundLimitReached() !== true) push('round-limit-reached');
        if (d.getState().round !== api.GUESS_MAX_ROUNDS) push('round-count');
    }
    /* B4 **校验失败不许留下半截状态**（源与初版都是先改 state 再判空返回 false）。 */
    {
        const d = new api.GuessWhatData(fakeStorage());
        if (d.startGame({ mode: 'ai_guesses', opponent: { id: 'c1', name: '小雅' }, secretWord: '' }) !== false) push('guess-needs-word');
        if (d.getState().phase !== 'setup') push('guess-fail-keeps-phase');
        if (d.getState().secretWord !== '') push('guess-fail-keeps-word');
        if (d.getState().log.length !== 0) push('guess-fail-keeps-log');
    }
    /* B5 玩法两态：`isAiGuessing` 与「该我做什么」的文案同源。 */
    {
        const d = startedGuess(api, 'ai_guesses');
        if (d.isAiGuessing() !== true) push('mode-ai-guessing');
        if (!d.getUserTurnLabel().includes('提示')) push('mode-label-hints');
        const e = startedGuess(api, 'user_guesses', '蒲公英');
        if (e.isAiGuessing() !== false) push('mode-user-guessing');
        if (!e.getUserTurnLabel().includes('猜测')) push('mode-label-guess');
    }
    /* B6 玩法写进数据层（**这是本版修掉的静默失效**：只存视图字段会随视图重建丢失）。 */
    {
        const storage = fakeStorage();
        const d = new api.GuessWhatData(storage);
        d.setMode('user_guesses');
        if (d.getState().mode !== 'user_guesses') push('set-mode-writes-state');
        const reloaded = new api.GuessWhatData(storage);
        if (reloaded.getState().mode !== 'user_guesses') push('set-mode-survives-reload');
        /* 非法值必须退到默认，而不是把怪值存进去。 */
        d.setMode('nonsense');
        if (d.getState().mode !== 'ai_guesses') push('set-mode-sanitizes');
    }
    /* B7 结束一局记下赢家与缘故；复盘里同时出现答案与结果。 */
    {
        const d = startedGuess(api);
        d.endGame({ winner: 'user', reason: '一次就中' });
        if (d.isPlaying() !== false) push('end-not-playing');
        const s = d.getSummary();
        if (!s.includes('蒲公英')) push('summary-has-answer');
        if (!s.includes('你赢了')) push('summary-has-winner');
    }
    /* B8 默认玩法必须是列表里的第一项，且玩法表两项齐备。 */
    if (api.GUESS_MODES.length !== 2) push('modes-count');
    if (api.GUESS_MODES[0].value !== 'ai_guesses') push('modes-order');
    /* ★ 这里**不再**断言海龟汤的三张册子（那是海龟汤的口径，放在本函数里就是
     *   「借了对方的 api」—— 一旦哪边调整，报错会挂在错误的套件名下）。 */
    return bad;
}

/* ── C 通道：JSON 自证提取器（判据吃一个与真件同款的实现，验它不猜） ── */
function extractorProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);
    const F = String.fromCharCode(96).repeat(3);
    const cases = [
        ['{"a":1}', 1],
        [F + 'json\n{"a":1}\n' + F, 1],
        ['前缀说明\n{"a":1}\n后缀', 1],
        ['{"s":"带 } 与 { 的字符串"}', 1],
        ['{"s":"转义 \\" 引号"}', 1],
        ['不是我想要的 {"nested":{"x":2}} 尾巴', 1],
    ];
    for (const [input, want] of cases) {
        const got = api.extract(input);
        if (!got || typeof got !== 'object') { push('extract-null:' + input.slice(0, 12)); continue; }
        if (Object.keys(got).length !== want) push('extract-shape:' + input.slice(0, 12));
    }
    /* 取不到就返回 null，**不许猜、不许编**。 */
    for (const input of ['', '模型什么都没说', '{ 半个', '```json\n{未闭合\n```']) {
        if (api.extract(input) !== null) push('extract-must-be-null:' + input.slice(0, 10));
    }
    return bad;
}

/* ── D 活性：导出的能力必须有调用点（本仓迭代主线） ── */
function livenessProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);
    for (const [rel, need, atLeast] of api.CHECKS) {
        const hits = api.countHits(rel, need);
        if (hits < atLeast) push('dead:' + need + '@' + rel + '=' + hits);
    }
    for (const [rel, dead] of api.DEAD) {
        if (api.countHits(rel, dead) > 0) push('zombie:' + dead + '@' + rel);
    }
    return bad;
}

/* ══════════════════════ 真模块挂载 ══════════════════════ */

const extForReal = (() => {
    /* 判据要的那份「同款提取器」：从真源码里把实现抠出来跑（不是另写一份
     * 判据自己的实现 —— 那样判的是判据，不是产品）。实现由 D 组自证在场。 */
    const src = read(APP);
    const at = src.indexOf('    _extractDialogGameJson(text = ');
    assert.ok(at >= 0, '真源码里必须有 _extractDialogGameJson（D 组的地面）');
    const end = src.indexOf('\n    }\n', at);
    assert.ok(end > at, '必须能截到该函数体');
    const body = src.slice(at, end + '\n    }\n'.length);
    const fenceExpr = /const fence = String\.fromCharCode\((\d+)\)\.repeat\((\d+)\);/;
    const m = fenceExpr.exec(body);
    assert.ok(m, '围栏必须由码点拼出（不许字面写反引号）');
    const fence = String.fromCharCode(Number(m[1])).repeat(Number(m[2]));
    /* ★ 真源码里这是**类方法简写**（name(...) { ... }），而 new Function 只吃
     *   function 声明 —— 必须补前缀，否则当场 SyntaxError。
     *   这是判据自己的搬运错，不是产品缺陷；写在这里免得下轮又踩。 */
    const wrap = `function ${body.replace(/^ {4}/gm, '')}\n return _extractDialogGameJson;\n`;
    // eslint-disable-next-line no-new-func
    const fn = new Function('String', 'JSON', 'RegExp', wrap)(String, JSON, RegExp);
    assert.equal(fence.length, 3, '围栏长度必须是 3（三个反引号）');
    return fn;
})();

const REAL_TURTLE = {
    SeaTurtleData, TURTLE_PROVIDER_MODES, TURTLE_RIDDLE_TYPES, TURTLE_JUDGEMENTS,
    TURTLE_MAX_LOG: Number((read(TS_DATA).match(/const MAX_LOG = (\d+);/) || [])[1]),
    __mkPlayers: mkPlayers,
};
const REAL_GUESS = { GuessWhatData, isGuessHit, GUESS_MODES, GUESS_MAX_ROUNDS };
const REAL_EXTRACT = { extract: extForReal };

/** 判据吃的那一组符号（真实现 / 破坏副本通用）。 */
const turtleApiOf = (m) => ({
    SeaTurtleData: m.SeaTurtleData,
    TURTLE_PROVIDER_MODES: m.TURTLE_PROVIDER_MODES,
    TURTLE_RIDDLE_TYPES: m.TURTLE_RIDDLE_TYPES,
    TURTLE_JUDGEMENTS: m.TURTLE_JUDGEMENTS,
    TURTLE_MAX_LOG: REAL_TURTLE.TURTLE_MAX_LOG,
    __mkPlayers: mkPlayers,
});
const guessApiOf = (m) => ({
    GuessWhatData: m.GuessWhatData,
    isGuessHit: m.isGuessHit,
    GUESS_MODES: m.GUESS_MODES,
    GUESS_MAX_ROUNDS: m.GUESS_MAX_ROUNDS,
});

const REAL_T = turtleApiOf(REAL_TURTLE);
const REAL_G = guessApiOf(REAL_GUESS);

/* ══════════════════════ A/B 内核判据挂测 ══════════════════════ */

test('A1 海龟汤内核：四档判定 / 日志封顶保留首条 / 卡关按比例 / 抽取出题人的边界 / 开局三前提', () => {
    assert.deepEqual(turtleProblems(REAL_T), [], '内核口径必须与设计一致，实测问题：' + turtleProblems(REAL_T).join(' , '));
    assert.equal(REAL_T.TURTLE_MAX_LOG, 400, '日志上限就是 400');
    assert.equal(REAL_T.TURTLE_JUDGEMENTS.length, 4, '判定四档');
});

test('B1 你说我猜内核：宽松匹配两向 / 撤回只撤最后一组 / 轮次上限 / 校验失败不留半截状态', () => {
    assert.deepEqual(guessProblems(REAL_G), [], '内核口径必须与设计一致，实测问题：' + guessProblems(REAL_G).join(' , '));
    assert.equal(REAL_G.GUESS_MAX_ROUNDS, 20, '轮次上限就是 20');
});

test('D1 JSON 提取器：真 JSON 取得到 / 坏输入返回 null（不许猜、不许编）', () => {
    assert.deepEqual(extractorProblems(REAL_EXTRACT), [], '提取器口径必须与设计一致，实测问题：' + extractorProblems(REAL_EXTRACT).join(' , '));
});

/* ══════════════════════ E 活性面 ══════════════════════ */

const LIVE_CHECKS = [
    /* 本版修掉的三处功能级失效：导出后必须真有调用点（不是只有声明/定义那一处）。 */
    [GW_VIEW, 'setMode', 1],
    [GW_VIEW, 'getUserTurnLabel', 1],
    [APP, 'GUESSWHAT_AI_STEP_DELAY_MS', 2],
    [APP, 'SEATURTLE_AI_STEP_DELAY_MS', 3],
    [APP, '_extractDialogGameJson', 2],
    [APP, '_waitDialogGameApiCooldown', 2],
    [APP, 'rewindLastAiTurn', 1],
    [APP, 'isStuck', 1],
];
/* 本版删掉的死字段 / 死参数：不许再回来（只写不读 = 看起来有守卫）。 */
const LIVE_DEAD = [
    [TS_VIEW, '_setupOpen'],
    [TS_VIEW, '_shareOpen'],
    [TS_VIEW, '_destroyed'],
    [GW_VIEW, '_shareOpen'],
    [TS_VIEW, 'fallbackName'],
];

const countHits = (rel, needle) => {
    const src = rel === APP ? stripComments(read(rel)) : read(rel);
    return src.split(needle).length - 1;
};

test('E1 活性：本版修掉的三处功能级失效必须真有调用点（导出了不等于用上了）', () => {
    assert.deepEqual(livenessProblems({ CHECKS: LIVE_CHECKS, DEAD: LIVE_DEAD, countHits }), [],
        '活性面不达标：' + livenessProblems({ CHECKS: LIVE_CHECKS, DEAD: LIVE_DEAD, countHits }).join(' , '));
});

test('E2 四个只写不读的视图字段与 _avatar 的死参数不许回来', () => {
    for (const [rel, dead] of LIVE_DEAD) {
        assert.equal(countHits(rel, dead), 0, rel + ' 不该再出现 ' + dead + '（留着会让人以为那里有守卫）');
    }
});

/* ══════════════════════ F 通道与禁入面 ══════════════════════ */

test('F1 两件一律走宿主生成侧：不许 fetch / apiKey / endpoint / Dexie / 写聊天楼层', () => {
    for (const rel of [APP, TS_DATA, TS_VIEW, GW_DATA, GW_VIEW]) {
        const code = stripComments(read(rel));
        for (const banned of ['fetch(', 'XMLHttpRequest', 'apiKey', 'Authorization',
            'chat/completions', 'Dexie', 'indexedDB', 'openDB', 'db.chats', 'chat.history',
            'history.push', 'isHidden']) {
            if (rel !== APP && banned === 'fetch(') continue;
            assert.equal(code.includes(banned), false, rel + ' 的代码里不得出现：' + banned);
        }
    }
    /* data 层：只许一条 import，且必须是全仓唯一的取数门。 */
    for (const rel of [TS_DATA, GW_DATA]) {
        const data = read(rel);
        const imports = data.match(/^\s*import\s.*$/gm) || [];
        assert.equal(imports.length, 1, rel + ' 只能有一条 import（实测 ' + imports.length + '）');
        assert.ok(imports[0].includes("from '../../../config/num-gate.js'"),
            rel + ' 那一条 import 必须是唯一取数门，且**层级要对**（apps/games/<name>/ 到仓根是三层）');
        assert.ok(/import\s*\{\s*numOrNull\s*\}/.test(imports[0]), rel + ' 必须只引入 numOrNull');
        const code = stripComments(data);
        assert.equal(code.includes('Number.isFinite(Number('), false, rel + ' 不得就地再写一份弱口径取数');
        for (const banned of ['document.', 'window.', 'localStorage', 'sessionStorage', 'setInterval']) {
            assert.equal(code.includes(banned), false, rel + ' 的 data 层代码里不得出现：' + banned);
        }
    }
    /* data 层的 `setTimeout` 是**测试夹具**才允许的：产品侧零定时器。 */
    for (const rel of [TS_DATA, GW_DATA]) {
        assert.equal(stripComments(read(rel)).includes('setTimeout'), false, rel + ' 不得转一次性定时器');
    }
});

test('F2 围栏剥法不许含反引号字面量（会把判据剥注释器击穿）', () => {
    /* ★ 为什么必须有：本仓判据共用的 `stripComments` **不解析正则字面量**。
     *   v3.31.0 踩到的是「正则正文里的 ASCII 引号」，本轮 `_extractDialogGameJson`
     *   的围栏写法给剥器塞了三个连续反引号 —— 剥器在 `code` 态看到反引号会切进
     *   **模板串态**，从此 `//` 与 `/*` 都不再被识别。实测靠紧邻的下一个反引号
     *   **偶然复位**（尾随哨兵侥幸保住）：是「碰巧没炸」而不是「不可能炸」。
     *   一旦错位跨过说明注释，强判据会把说明文字当成消费（假红），
     *   更坏的方向是把真消费挡在窗口里（假绿）。
     *   本判据按**尾随哨兵**直测（不依赖任何正则解析口径）：
     *   给文件尾接一个哨兵块注释，它必须被剥掉。 */
    for (const rel of [APP, TS_DATA, TS_VIEW, GW_DATA, GW_VIEW]) {
        const code = stripComments(read(rel) + '\n/* RP_SENTINEL_TAIL_BLOCK */\n');
        assert.equal(code.includes('RP_SENTINEL_TAIL_BLOCK'), false,
            rel + ' 的尾随块注释没被剥掉 ⇒ 剥注释器在本文件上失守（某处表达式里含裸的引号/反引号）');
        assert.equal(code.includes('/*'), false, rel + ' 剥注释后仍有 /* 残留');
        assert.equal(code.includes('*/'), false, rel + ' 剥注释后仍有 */ 残留');
    }
    /* 且围栏必须由码点拼出（这条是「不许字面写」的直接形状断言）。 */
    const app = read(APP);
    assert.ok(app.includes('String.fromCharCode(96).repeat(3)'),
        '围栏必须由码点拼成常量（不许在正则里字面写三个反引号）');
});

test('F3 围栏新旧写法等价：三种输入下逐字相同（改法不是「行为改变了」）', () => {
    const F = String.fromCharCode(96).repeat(3);
    /* 判据自己实现一遍旧写法（**不许**用被审对象自己的实现来审它自己）。 */
    const legacy = (text) => String(text || '')
        .replace(new RegExp(F + 'json', 'gi'), '')
        .replace(new RegExp(F, 'g'), '');
    const inputs = [
        F + 'json\n{"a":1}\n' + F,
        '模型说：' + F + '{"a":1}' + F + ' 就这样',
        '{"a":1}',
        F + 'JSON {"a":1}',
        '',
    ];
    for (const input of inputs) {
        const mine = String(input || '')
            .replace(new RegExp(String.fromCharCode(96).repeat(3) + 'json', 'gi'), '')
            .replace(new RegExp(String.fromCharCode(96).repeat(3), 'g'), '');
        assert.equal(mine, legacy(input), '新旧围栏剥法必须逐字等价：' + JSON.stringify(input.slice(0, 20)));
        assert.equal(mine === input, legacy(input) === input, '「有没有改动」这个事实也必须一致');
    }
});

/* ══════════════════════ G 接线面 ══════════════════════ */

test('G1 四个入口 / 两条常量 / 生命周期级联 / 返回手势链齐备', () => {
    const app = read(APP);
    for (const sig of ['openSeaTurtle()', 'openGuessWhat()', 'startSeaTurtleRound(', 'startGuessWhatGame(',
        'askSeaTurtle(', 'guessSeaTurtle(', 'sendGuessWhatTurn(', 'driveSeaTurtleAiTurns(',
        'rerollSeaTurtleTurn(', 'rerollGuessWhatTurn(', 'stopSeaTurtleFlow(', 'stopGuessWhatFlow(',
        'shareSeaTurtleSummary(', 'shareGuessWhatSummary(']) {
        assert.ok(app.includes(sig), APP + ' 必须实现 ' + sig);
    }
    assert.ok(app.includes("this.currentView = 'seaturtle'"), '入口必须置 currentView=seaturtle');
    assert.ok(app.includes("this.currentView = 'guesswhat'"), '入口必须置 currentView=guesswhat');
    /* 构造期实例化。 */
    for (const s of ['new SeaTurtleData(storage)', 'new SeaTurtleView(this)',
        'new GuessWhatData(storage)', 'new GuessWhatView(this)']) {
        assert.equal(app.split(s).length - 1, 1, '构造期必须恰实例化一次：' + s);
    }
    /* 生命周期级联：返回大厅与销毁都要级联两个视图。 */
    const lobby = app.slice(app.indexOf('    backToLobby()'), app.indexOf('    deactivate()'));
    assert.ok(lobby.includes('seaTurtleView?.destroy?.()'), 'backToLobby 必须级联销毁海龟汤视图');
    assert.ok(lobby.includes('guessWhatView?.destroy?.()'), 'backToLobby 必须级联销毁你说我猜视图');
    const deact = app.slice(app.indexOf('    deactivate()'));
    assert.ok(deact.includes('seaTurtleView?.destroy?.()'), 'deactivate 必须级联销毁海龟汤视图');
    assert.ok(deact.includes('guessWhatView?.destroy?.()'), 'deactivate 必须级联销毁你说我猜视图');
    /* 返回手势：先视图 handleBack，再落大厅。 */
    const swipe = app.slice(app.indexOf('    handleSwipeBack()'));
    assert.ok(swipe.includes("this.currentView === 'seaturtle' && this.seaTurtleView?.handleBack?.()"), '返回手势必须先问海龟汤视图');
    assert.ok(swipe.includes("this.currentView === 'guesswhat' && this.guessWhatView?.handleBack?.()"), '返回手势必须先问你说我猜视图');
    /* ★ [v3.33.0 交棒 · 判据自身缺陷] 原断言写成「必须**确切**包含
     *   `this.currentView === 'guesswhat')`」—— 那是把「当版最后一款」写进了判据：
     *   **下一个**子游戏落进这个析取链时它当场报红，而产品侧完全正确（枚举本来就该跟着长）。
     *   与 v3270/v3280/v3290/v3300 四处「守别人的版」同族，只是这次守的是「当版最后一款」。
     *   改为泛化：形态锚（仍须是一条析取链）+ 守自己那一件（本套件那两款必须在链上）。 */
    assert.ok(/this\.currentView === '[a-z0-9]+'(?: \|\| this\.currentView === '[a-z0-9]+')+\)/.test(swipe),
        '落大厅分支必须是一条 currentView 析取链（形态锚，不许退化成单件判定）');
    for (const v of ['seaturtle', 'guesswhat']) {
        assert.ok(swipe.includes("'" + v + "'"), '落大厅分支必须含本套件那一件：' + v);
    }
});

test('G2 视图调用面闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* FIELDS = 视图有权直接碰的**属性**（不是方法）：容器引用、构造期挂上的数据层、
     * 以及父类 PokerApp 提供的公开面。 */
    const FIELDS = new Set(['app', 'phoneShell', 'getWechatContactsForPoker', 'seaTurtleData',
        'guessWhatData', 'backToLobby', 'currentView']);
    const appSrc = read(APP);
    const methods = new Set();
    /* ★ 本仓的方法带修饰符是常态：`async startSeaTurtleRound(…) {` 是最常见的写法，
     *   漏掉 `async` 会让**全部**异步编排方法都看不见 —— 于是判据自己制造出一整页
     *   假红（本轮实测 9 条）。修饰符一律可选，且 `get ` / `set ` 也要认。 */
    const sigRe = /^[ \t]+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm;
    for (const m of appSrc.matchAll(sigRe)) methods.add(m[1]);
    const missing = [];
    for (const rel of [TS_VIEW, GW_VIEW]) {
        const called = new Set();
        for (const m of read(rel).matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
        for (const n of called) if (!methods.has(n) && !FIELDS.has(n)) missing.push(rel + '::' + n);
        assert.ok(called.size >= 6, rel + ' 的调用面异常小（' + called.size + '）');
    }
    assert.deepEqual(missing, [], '视图调了 App 上不存在的东西：' + missing.join(' , '));
    /* 方法面下限要卡在「真件读数」之下一点点：本件 159 个，卡 140 才不会被一次正常
     * 重构打倒，而「扫描器悄悄失效」时又必然报警（本轮漏 async 时只剩 109）。 */
    assert.ok(methods.size >= 140, APP + ' 的方法面异常小（' + methods.size + '）');
    for (const sig of ['startSeaTurtleRound', 'startGuessWhatGame', 'askSeaTurtle', 'sendGuessWhatTurn']) {
        assert.ok(methods.has(sig), '方法签名扫描必须认得异步编排方法：' + sig);
    }
});

test('G3 常量量级：两条单步节流与共享冷却都在同一量级且真的被 await', () => {
    const app = read(APP);
    const t = Number((app.match(/const SEATURTLE_AI_STEP_DELAY_MS = (\d+);/) || [])[1]);
    const g = Number((app.match(/const GUESSWHAT_AI_STEP_DELAY_MS = (\d+);/) || [])[1]);
    const c = Number((app.match(/const DIALOG_GAME_API_COOLDOWN_MS = (\d+);/) || [])[1]);
    assert.ok(t >= 1000 && t <= 5000, '海龟汤步进 ' + t + ' 应在 1~5s');
    assert.ok(g >= 500 && g <= 3000, '你说我猜步进 ' + g + ' 应在 0.5~3s');
    assert.equal(c, 5000, '共享冷却与狼人杀 / 谁是卧底同量级（5000）');
    /* 冷却真的在调用前被 await（不是声明了没人用）。 */
    assert.ok(/await this\._waitDialogGameApiCooldown\(\)/.test(app), '冷却必须在通道前 await');
    assert.ok(/async _waitGuessWhatStep\(\)/.test(app) && /await this\._waitGuessWhatStep\(\);/.test(app),
        '你说我猜的单步节流必须真有 await（本版修掉的功能级失效之一）');
});

/* ══════════════════════ H 样式与大厅卡片 ══════════════════════ */

const classNamesIn = (css, bare) => new Set(css.match(new RegExp('[.]' + bare + '[a-z0-9-]+', 'g')) || []);

test('H1 两份样式各自独占前缀，且**互不出现在对方文件里**（同批落地、互不复用）', () => {
    const ts = read(TS_CSS);
    const gw = read(GW_CSS);
    assert.ok(ts.includes('.sts-'), TS_CSS + ' 必须用 .sts- 前缀');
    assert.ok(gw.includes('.gw-'), GW_CSS + ' 必须用 .gw- 前缀');
    /* 交叉检查：两份文件里不许出现对方的前缀（避免「一次替换带走两件」）。 */
    assert.equal(ts.includes('.gw-'), false, TS_CSS + ' 不得出现对方的 .gw- 前缀');
    assert.equal(gw.includes('.sts-'), false, GW_CSS + ' 不得出现对方的 .sts- 前缀');
    /* 本件样式是**JS 自注入**（不是 phone.css 打包）—— 与本仓「样式投递」表的第三类一致。 */
    for (const [viewRel, cssId] of [[TS_VIEW, 'seaturtle-css'], [GW_VIEW, 'guesswhat-css']]) {
        assert.ok(read(viewRel).includes(`document.getElementById('${cssId}')`),
            viewRel + ' 必须按 id 幂等注入样式（' + cssId + '）');
    }
});

test('H2 视图产出的每个类名都有样式落点或选择器锚点', () => {
    for (const [viewRel, cssRel, bare] of [[TS_VIEW, TS_CSS, 'sts-'], [GW_VIEW, GW_CSS, 'gw-']]) {
        const view = read(viewRel);
        const css = read(cssRel);
        const js = view + read(APP);
        const cssNames = classNamesIn(css, bare);
        const anchors = new Set();
        for (const m of js.matchAll(/(?:querySelector(?:All)?|\bq)\s*\(\s*['"]([^'"]*)['"]/g)) {
            for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
        }
        for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
        /* ★ 第三类落点：`phoneShell.setContent(html, '<token>')` 的**屏名 token**。
         *   本仓既有惯例是 `<app>-<screen>`（如谁是卧底的 'games-undercover' /
         *   'games-undercover-game'）—— 屏名会落在容器类上，所以它也是一个产出面；
         *   漏掉这一类会把「屏名类」误判成「无落点」。 */
        for (const m of js.matchAll(/setContent\(\s*[^,]+,\s*'([^']+)'/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare)) anchors.add(tok);
        }
        const produced = new Set();
        for (const m of view.matchAll(/class=["']([^"']+)/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare) && !tok.endsWith('-')) produced.add(tok);
        }
        const missing = [...produced].filter((x) => !cssNames.has('.' + x) && !anchors.has(x));
        assert.deepEqual(missing, [], viewRel + ' 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
        assert.ok(produced.size >= 20, viewRel + ' 产出的类名异常少（' + produced.size + '）');
        assert.ok(anchors.size >= 3, viewRel + ' 的锚点面异常小（' + anchors.size + '）');
        const foreign = [...cssNames].filter((x) => !x.startsWith('.' + bare));
        assert.deepEqual(foreign, [], cssRel + ' 出现非本前缀的类名：' + foreign.join(' , '));
    }
});

test('H3 大厅两张卡片在场、绑了点击，且卡片配色与图标**有样式落点**', () => {
    const view = read(POKER_VIEW);
    const css = read(POKER_CSS);
    for (const id of ['games-open-seaturtle', 'games-open-guesswhat']) {
        assert.equal(view.split(`id="${id}"`).length - 1, 1, POKER_VIEW + ' 必须恰有一张卡片：' + id);
        assert.ok(view.includes(`getElementById('${id}')?.addEventListener('click'`),
            POKER_VIEW + ' 必须给 ' + id + ' 绑点击');
    }
    assert.ok(view.includes('this.app.openSeaTurtle()'), '海龟汤卡片必须调 openSeaTurtle');
    assert.ok(view.includes('this.app.openGuessWhat()'), '你说我猜卡片必须调 openGuessWhat');
    /* ★ 起手时这两张卡片的 art 类**没有样式落点**（卡片会是一个光秃的方块）——
     *   本判据把「配色与图标必须有落点」钉死。 */
    for (const cls of ['games-seaturtle-card', 'games-seaturtle-lobby-art',
        'games-guesswhat-card', 'games-guesswhat-lobby-art']) {
        assert.ok(css.includes('.' + cls + ' {') || css.includes('.' + cls + '{'),
            POKER_CSS + ' 必须给 .' + cls + ' 样式落点（否则卡片无配色/无图标）');
    }
});

/* ══════════════════════ I 键归属 ══════════════════════ */

test('I1 两条会话键必须在 keys 门账本里登记且 scope=chat，且精确枚举面在场', () => {
    const audit = read('scripts/keys-audit.mjs');
    const storage = read('config/storage.js');
    for (const key of ['chat_games_seaturtle_state', 'chat_games_guesswhat_state']) {
        assert.equal(audit.split(`key: '${key}'`).length - 1, 1,
            '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次（不登记不报错，只是换会话串味）');
        assert.ok(new RegExp("\\{ key: '" + key + "', scope: 'chat'").test(audit),
            '键 ' + key + ' 必须是会话隔离（scope: chat）');
        assert.ok(storage.includes('/^' + key + '$/'),
            'storage 的精确枚举面必须列出 ' + key + '（评审面：一眼可数）');
    }
    assert.ok(storage.includes('/^chat_games_/'), '宽匹配族必须在（新子游戏自动接住）');
    /* 每条键必须真被产品消费（不是账本里空挂）。 */
    assert.ok(read(TS_DATA).includes("'chat_games_seaturtle_state'"), TS_DATA + ' 必须真用这条键');
    assert.ok(read(GW_DATA).includes("'chat_games_guesswhat_state'"), GW_DATA + ' 必须真用这条键');
});

/* ══════════════════════ J 负控制 ══════════════════════ */

/** 破坏表集中在一处：K2 会拿它做「锚点在场性 + 替换保真」的批量自证。
 *  ★ 本表的锚点一律取**代码行**（不取注释），且一律用字面 split/join 替换。 */
const DAMAGE = {
    /* 四档之外不再回落 ⇒ 「怪词必须落无关」转红。 */
    t1: [TS_DATA,
        "        const value = TURTLE_JUDGEMENTS.includes(judgement) ? judgement : '无关';",
        '        const value = judgement;'],
    /* 日志不再封顶 ⇒ 「封顶 400 并保留首条」转红。 */
    t2: [TS_DATA,
        '        if (log.length > MAX_LOG) {',
        '        if (false) {'],
    /* 溢出时不再保留首条（从 0 剪）⇒ 「保留首条系统日志」转红。 */
    t3: [TS_DATA,
        '            log.splice(1, overflow);',
        '            log.splice(0, overflow);'],
    /* 卡关不再按比例（「有一条无关就算」）⇒ 阈值判据转红。 */
    t4: [TS_DATA,
        "        if (answers.length < 5) return false;",
        '        if (false) return false;'],
    /* 「没有 AI 可抽」不再返回 -1（改成落到随机）⇒ 边界判据转红。 */
    t5: [TS_DATA,
        "            if (aiIndices.length) return aiIndices[Math.floor(Math.random() * aiIndices.length)];\n            return -1;",
        '            if (aiIndices.length) return aiIndices[Math.floor(Math.random() * aiIndices.length)];\n            return Math.floor(Math.random() * players.length);'],
    /* 开局不再要求谜面 ⇒ 「谜面必填」转红。 */
    t6: [TS_DATA,
        "        if (!String(riddle || '').trim() || !String(answer || '').trim()) return false;",
        "        if (!String(answer || '').trim()) return false;"],
    /* 宽松匹配不再忽略空白 ⇒ 「去空格」转红。 */
    g1: [GW_DATA,
        "    const a = String(guess || '').toLowerCase().replace(/\\s+/g, '');",
        "    const a = String(guess || '').toLowerCase();"],
    /* 空值不再拦（`includes('')` 恒真）⇒ 「空值不许误判成中」转红。 */
    g2: [GW_DATA,
        '    if (!a || !b) return false;',
        '    if (false) return false;'],
    /* 撤回不再要求「用户在前」⇒ 「顺序不对必须拒绝」转红。 */
    g3: [GW_DATA,
        "        if (log[userIndex]?.type !== 'user-turn') return null;",
        '        if (false) return null;'],
    /* 校验失败仍改状态（把校验挪到改状态之后，并把 phase 先推成 playing）⇒
     * 「不许留半截状态」转红。★ 这里必须**连 phase 一起**推前：只把 `_empty()` 挪前
     * 是看不出来的（`_empty()` 给的 phase 本来就是 'setup'），破坏会静默失效
     * （本轮实测：第一版 g4 就是这样，J10 报「没报」）。 */
    g4: [GW_DATA,
        '        if (!word) return false;\n        this.state = this._empty();',
        "        this.state = this._empty();\n        this.state.phase = 'playing';\n        if (!word) return false;"],
    /* 玩法不再写进数据层 ⇒ 「setMode 必须落状态」转红。 */
    g5: [GW_DATA,
        "        this.state.mode = GUESS_MODES.some(item => item.value === value) ? value : 'ai_guesses';",
        "        this.state.mode = this.state.mode;"],
    /* 轮次上限失效 ⇒ 「到顶」转红。 */
    g6: [GW_DATA,
        '        return this.state.round >= GUESS_MAX_ROUNDS;',
        '        return false;'],
    /* 围栏改回**正则字面量**写法（本轮修的隐患回归）⇒ 破坏点之后的哨兵剥不掉。
     *  ★ 本轮实测的两条教训：
     *    ① 只换 `const fence = …` 那行是**装饰** —— 紧跟的注释里本来就有成对反引号，
     *       剥器的模板串态会被当场复位，尾随哨兵照样被剥掉，判别力自证静默假绿；
     *    ② **反引号的个数必须是奇数**：写成「两处 replace 都用字面围栏」共 6 个（偶数），
     *       剥器会自己一路配对回 `code` 态 —— 那正是本仓记录的「靠紧邻的下一个反引号
     *       偶然复位」。所以这里取一个真实的**部分回退**形：只把第一处写回字面围栏
     *       （3 个裸反引号 ⇒ 奇数 ⇒ 模板串态一直挂到文件深处）。 */
    d1: [APP,
        "        const raw = String(text || '')\n"
        + "            .replace(new RegExp(fence + 'json', 'gi'), '')\n"
        + "            .replace(new RegExp(fence, 'g'), '');",
        ("        const raw = String(text || '')\n"
        + "            .replace(/%%%json/gi, '')\n"
        + "            .replace(new RegExp(fence, 'g'), '');").split('%%%').join(chr97(96) + chr97(96) + chr97(96))],
};

function chr97(code) {
    return String.fromCharCode(code);
}

/** num-gate 的**等价桩**（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/**
 * 造一份破坏副本并加载。
 * ★ 副本按**真目录结构**建：data 层写的是 `../../../config/num-gate.js`，
 *   若把副本摊在 <tmp> 根下，那条相对路径会解析错位置、首跑即 ERR_MODULE_NOT_FOUND
 *   （与破坏本身无关的假红）。
 */
function loadDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3320_'));
    const target = path.join(dir, 'apps', 'games', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(target).href);
}

/* 逐条负控制：每条都用「同款真判据」在破坏副本上重跑，并要求对照（真实现必须干净）。 */
const NEG = [
    ['J1 破坏「四档之外回落无关」⇒ 内核判据必须转红', 't1', turtleApiOf, turtleProblems, ['judge-fallback']],
    ['J2 破坏「日志封顶」⇒ 内核判据必须转红', 't2', turtleApiOf, turtleProblems, ['log-cap']],
    ['J3 破坏「溢出保留首条」⇒ 内核判据必须转红', 't3', turtleApiOf, turtleProblems, ['log-keeps-first']],
    ['J4 破坏「卡关按比例（样本不足不报）」⇒ 内核判据必须转红', 't4', turtleApiOf, turtleProblems, ['stuck-too-few-samples']],
    ['J5 破坏「没有 AI 可抽时返回 -1」⇒ 内核判据必须转红', 't5', turtleApiOf, turtleProblems, ['pick-no-ai']],
    ['J6 破坏「开局必须给谜面」⇒ 内核判据必须转红', 't6', turtleApiOf, turtleProblems, ['start-needs-riddle']],
    ['J7 破坏「宽松匹配去空格」⇒ 内核判据必须转红', 'g1', guessApiOf, guessProblems, ['hit-spaces']],
    ['J8 破坏「空值不许误判成中」⇒ 内核判据必须转红', 'g2', guessApiOf, guessProblems, ['hit-both-empty', 'hit-empty-guess']],
    ['J9 破坏「撤回要求用户在前」⇒ 内核判据必须转红', 'g3', guessApiOf, guessProblems, ['rewind-refuses-bad-order']],
    ['J10 破坏「校验失败不留半截状态」⇒ 内核判据必须转红', 'g4', guessApiOf, guessProblems, ['guess-fail-keeps-phase']],
    ['J11 破坏「玩法写进数据层」⇒ 内核判据必须转红', 'g5', guessApiOf, guessProblems, ['set-mode-writes-state', 'set-mode-survives-reload']],
    ['J12 破坏「轮次上限」⇒ 内核判据必须转红', 'g6', guessApiOf, guessProblems, ['round-limit-reached']],
];

for (const [title, key, mk, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const mod = await loadDamagedCopy(rel, from, to);
        const bad = judge(mk(mod));
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        assert.deepEqual(judge(mk(REAL_MODS[key])), [], '对照：真实现必须干净');
    });
}

const REAL_MODS = {
    t1: REAL_TURTLE, t2: REAL_TURTLE, t3: REAL_TURTLE, t4: REAL_TURTLE, t5: REAL_TURTLE, t6: REAL_TURTLE,
    g1: REAL_GUESS, g2: REAL_GUESS, g3: REAL_GUESS, g4: REAL_GUESS, g5: REAL_GUESS, g6: REAL_GUESS,
};

/* ══════════════════════ K ── 判据工具自证 ══════════════════════ */

test('K1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：F1/F2 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（工具被削成空闸）。故必须两向自证。 */
    const raw = '// 注释里写 setInterval 与 Dexie\n'
        + 'const a = "setInterval";\n'
        + '/* 块注释 chat.history / apiKey */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"setInterval"'), '字符串字面量必须留住');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
    /* 本件五个文件剥注释后都必须真的变短（否则「不出现」是空闸）。 */
    for (const rel of [APP, TS_DATA, TS_VIEW, GW_DATA, GW_VIEW]) {
        assert.ok(read(rel).length > stripComments(read(rel)).length, rel + ' 剥注释后必须真的变短');
    }
    /* ★ 而且：说明文字**未剥时在场、剥掉后不在**（这正是「提及 ≠ 消费」的两向实证）。
     *   本件只有 App 编排层写说明注释，四个子游戏文件里一个禁入词都没有 ——
     *   所以「在场」这一向只对 App 断言（此前写成对三个词逐个断言却一律去查 APP，
     *   而 APP 里只写了 `fetch(` 一个 —— 报错文案与事实不符）。 */
    const appRaw = read(APP);
    const appCode = stripComments(appRaw);
    assert.ok(appRaw.includes('fetch('), APP + ' 的说明注释里应当写明源里的 fetch(（说明，不是消费）');
    assert.equal(appCode.includes('fetch('), false, APP + ' 剥注释后不得再有 fetch(（那才是消费）');
    /* 反向：其余四个文件**原文**里不许出现任何禁入词（连注释里也不许 ——
     * 说明只写在 App 编排层一处，免得「提及」与「消费」在多个文件里混着看）。 */
    for (const rel of [TS_DATA, TS_VIEW, GW_DATA, GW_VIEW]) {
        for (const w of ['chat/completions', 'Dexie', 'apiKey', 'indexedDB', 'isHidden', 'fetch(']) {
            assert.equal(read(rel).includes(w), false, rel + ' 原文里不得出现 ' + w);
        }
    }
});

test('K2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    assert.ok(Object.keys(DAMAGE).length >= 12, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
        const at = src.indexOf(from);
        /* ★ 「锚点在不在注释里」的**准**口径：锚点必须存在于**剥注释后的代码面**。
         *   此前用的是「数一数前缀里有几个 `/*` 几个 `*/`」，而注释正文里可以**提到**
         *   `/*`（本件 d1 的说明就写着「`//` 与 `/*` 都不再被识别」）—— 计数当场失衡，
         *   报出「锚点落在块注释里」这种假红。锚点若真落在注释里，剥注释后它会消失。 */
        assert.equal(stripComments(src).split(from).length - 1, 1,
            name + ' 的锚点必须在**代码面**恰 1 次（落在注释里会消失），锚点：' + JSON.stringify(from.slice(0, 60)));
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const lineEnd = src.indexOf('\n', at);
        const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('*'), name + ' 的锚点不得落在注释行里：' + line.slice(0, 60));
        assert.ok(!to.includes('$') || !from.includes('$'), name + ' 替换串含 $ 时更须小心（本表一律走 split/join）');
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 副本的结构自证：`../../../config/num-gate.js` 必须真能解析到桩。 */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3320_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'games', 'seaturtle'), { recursive: true });
    const realCopy = path.join(tmp, 'apps', 'games', 'seaturtle', 'seaturtle-data.js');
    fs.copyFileSync(path.join(ROOT, TS_DATA), realCopy);
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return import(pathToFileURL(realCopy).href).then((m) => {
        const d = new m.SeaTurtleData(fakeStorage());
        d.seatPlayers(mkPlayers());
        assert.equal(d.startGame({ providerIndex: 1, riddle: 'r', answer: 'a' }), true,
            '副本按真目录结构摊开后必须能加载且行为同真件（只引唯一取数门）');
    });
});

test('K3 破坏表里那条「围栏回归」的破坏真的会击穿剥器（判别力自证）', () => {
    /* ★ 这条是 d1 的**判别力自证**：光看「文件里有没有反引号」不够，必须证明
     *   「真写回裸反引号之后，剥注释器在那个位置**真的失守**」——否则 d1 就是个
     *   永远绿的装饰（属本仓记过的「负控制假绿」三形之「对原文件断言」）。
     *
     * ★ 哨兵必须插在**破坏点的正后方**，不能只看文件尾：本文件尾部本来就有成对的
     *   反引号（模板串），剥器的状态会被下一次配对**复位** —— 于是尾随哨兵照样被剥掉，
     *   判别力自证会静默假绿（本轮实测到的就是这个）。 */
    const [rel, from, to] = DAMAGE.d1;
    const src = read(rel);
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, 'd1 的破坏必须真的发生');
    assert.ok(damaged.includes(chr97(96) + chr97(96) + chr97(96)), '破坏后必须真的出现裸的三连反引号');
    const atSrc = src.indexOf(from) + from.length;
    const atDmg = damaged.indexOf(to) + to.length;
    const sentinelAt = (text, at) => stripComments(text.slice(0, at) + '\n/* RP_SENTINEL_AFTER_DAMAGE */\n' + text.slice(at));
    assert.equal(sentinelAt(src, atSrc).includes('RP_SENTINEL_AFTER_DAMAGE'), false,
        '对照：真源码上，破坏点之后的哨兵必须被剥掉');
    assert.equal(sentinelAt(damaged, atDmg).includes('RP_SENTINEL_AFTER_DAMAGE'), true,
        '破坏后，破坏点之后的哨兵必须剥不掉（否则 d1 没有判别力）');
});