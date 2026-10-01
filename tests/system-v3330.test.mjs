// tests/system-v3330.test.mjs — 游戏厅（下半 · 剧本杀 + 心动飞行棋）[v3.33.0]
//
//   本版接的是素材缝合路线图 **第 2 层第四件：游戏厅**（下半）。上半 v3.32.0 已落
//   海龟汤 + 你说我猜；本版落**剧情型对局**两件：剧本杀 + 心动飞行棋。
//
//   ★ 起手复算（每次起手必须重新量）：源侧 `game-hall/` 九片解包后是一台**单体宿主脚本**
//     （`/tmp/gamehall_src.js` = 271887 字符 / 7588 行 / 123 个顶层函数），它其实是**六件**。
//     六取四（狼人杀 / 谁是卧底让位本仓既有权威 `apps/games/werewolf/` / `undercover/`），
//     四件分两版落；本版落余下两件。
//
//   ★ 缝合**不是搬运**，四处**不缝**（源里有、本仓明令禁止或有第二个权威的，一条都没进来）：
//     · 源落 Dexie（`db.scriptKillScripts` / `db.ludoQuestionBanks` / `db.ludoQuestions`）
//       —— 本仓零数据库铁律（落 PhoneStorage，键 `chat_games_scriptkill_state` /
//       `chat_games_ludo_state`，按聊天独立）；
//     · 源往 `chat.history` push 可见 `share_link` 卡 + `isHidden: true` 的 system 指令
//       —— 本仓**不替宿主往对话里写楼层**，「分享」只产一份文本走 `wechatData.addMessage`；
//     · 源自己拼 systemPrompt 直打 `/v1/chat/completions` —— 本仓走宿主生成侧
//       （`_callDialogGameAi` → `window.VirtualPhone.apiManager.callAI`，可被预设 /
//       可被中断 / 记账一致）；
//     · 源把图与外链写进状态 —— 本件一张图都不存、一条外链都不收。
//
//   ★ **源数据一条不搬**（本版实证判定）：源的内置剧本数组 `BUILT_IN_SCRIPTS` 与飞行棋
//     默认 21 题（`migrateDefaultLudoQuestions`）**都不在 game-hall 九分片里**
//     （`grep 'BUILT_IN_SCRIPTS' gamehall_src.js` 只命中引用点 2320 / 3175 / 3176，
//     没有定义体）⇒ 按纪律**全部原创**：剧本杀两份原创剧本（雾港灯塔 3 角色 7 线索 /
//     子夜书店 4 角色 8 线索），飞行棋 21 条原创题库（11 条 `both_answer` + 10 条
//     `single_answer`）。判据把这几个数钉住，防「下一版顺手把源数据填进来」。
//
//   ★ **一处口径校正（起手抓到的第一处真形态）**：源侧 `clue.owner` 存的是**纯角色名**
//     （`handleAiSearch` 里 `foundClue.owner === '公共'` 判公共，显示时才拼成
//     「角色 ${owner} 的私人物品」）。本件把「的私人物品」也写进了数据数组里 ——
//     数据能跑，但**存了一份冗余**：改名/改后缀要同时动数据、机制与显示三处。
//     本版把数组改成**纯角色名**（`privateOwnerOf` 继续作为显示/匹配助手），
//     A2 的「归属纯度」把这条钉住。
//
//   ★ 本版起手抓到**四处真缺陷**（都不是自述，其中三处由门禁当场报红）：
//     ① **搜证计数跨两轮串味**：`remainingSearch` 拿「本阶段新增额度」去比**跨轮累计**
//        的计数器（源侧 `evidenceCounts` 是同一个计数器：round1 判 `< 2`、round2 判 `< 3`）
//        —— 第二轮时计数已等于第一轮用掉的 2，`remaining` 恒被压成 0，
//        **用户按钮永远灰着、第二轮补搜永远搜不了**，全程不报错（A4 钉住）；
//     ② **视图调了 App 上不存在的 `startScriptKillFlow`**：视图写的是
//        `this.app.startScriptKillFlow?.()`，可选链把「方法不存在」吞成静默无操作
//        —— 点「开始」之后界面停在本环节，没有任何按钮能推它（C3 钉住）；
//     ③ **用户被要求答题时只看到「等待 Ta 回答…」**：飞行棋踩事件格那一步回合者可能是
//        AI，而问答脚本的第二步可能是用户；界面按「回合者是不是用户」渲染 ⇒ 输入框不出现，
//        问答链在 `_ludoResumeQuestion` 里等一个永远不会来的输入（C4 钉住）；
//     ④ **两处导出零消费**（`LUDO_QUESTION_TYPES` / `LUDO_AI_EVENTS`）：由 dead-export
//        门当场报红，本版补两处**真消费**（模式标签统一走数据层 + 局面事件词表白名单）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 剧本杀内核：阶段链十阶（源侧 switch 顺序）/ 搜证**累计上限**与「上限用尽不许再记」/
//       角色分配两模式（free 的出界索引必须拒绝）/ 线索归属纯度与「公共 + 自己的」可见性 /
//       投票只有「唯一最高票 == 凶手」算好人赢 / 票数为 0 者不入表 / 日志封顶保留首条 /
//       开局前提（剧本不在、人数不等于角色数都不许开）；
//     B 飞行棋内核：42 格 / 起点 50% 出 6（边界 0.49 与 0.5 实测）/ 非 6 不能起飞 /
//       超过终点直接停到终点且判胜 / 踩对方踢回起点 / 掷 6 再行动（结束后不算）/
//       事件格不落在起点与终点 / 题库轮转（取空再洗，不返回 null）/ 题目带作答记录形态；
//     C 接线：两套入口与常量 / 生命周期级联 / 返回手势链 / **视图调用面闭合**
//       （视图调了 App 上不存在的方法＝静默断裂）/ 开局驱动方法在场 / 事件格优先于再行动；
//     D 通道：一律走 `apiManager.callAI`（不许 fetch / apiKey / endpoint / Dexie /
//       写聊天楼层）/ data 层只许一条 import 且层级对（三层）/ 禁入词只在**说明注释**里；
//     E 活性：起手修掉的功能级失效必须有非声明处命中；死字段不许回来；
//     F 样式：两份样式前缀各自独占且互不出现在对方文件里 / 每个产出类名有落点；
//     G 大厅卡片：两张卡片在场、绑了点击、且卡片配色与图标有样式落点；
//     H 键归属：两条会话键登记且 scope=chat / 精确枚举面在场 / 键真被产品消费；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向 / 破坏表锚点在场（恰 1 次）且替换保真 / 副本结构自证；
//     K 事件词表与模式表（数据层的表与编排层的表必须彼此闭合，不许出现幽灵词）；
//     V 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/games/<name>/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），
//   否则相对 import 会解析错位置、首跑即假红；判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   批次纪律：本批（第 2 层四件）全部收干前**只跑单套件**（`node --test`）；
//   本件收干后补跑全链（上一版 v3.32.0 的教训留档：单套件全绿 ≠ 全链绿）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScriptKillData, SK_PHASES, SK_SEARCH_ALLOWANCE, SK_ASSIGN_MODES, SK_PUBLIC_OWNER,
    SK_PRIVATE_SUFFIX, SK_BUILT_IN_SCRIPTS, getBuiltInSkScript, clueKey, privateOwnerOf,
    ownerDisplayOf } from '../apps/games/scriptkill/scriptkill-data.js';
import {
    LUDO_BOARD_SIZE, LUDO_FINAL_INDEX, LUDO_START_POSITION, LUDO_EVENT_CELLS,
    LUDO_QUESTION_TYPES, LUDO_AI_EVENTS, LUDO_BUILT_IN_QUESTIONS, ludoModeLabel,
    isLudoEventCell, rollLudoDice, LudoQuestionDeck, LudoData,
} from '../apps/games/ludo/ludo-data.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SK_DATA = 'apps/games/scriptkill/scriptkill-data.js';
const SK_VIEW = 'apps/games/scriptkill/scriptkill-view.js';
const SK_CSS = 'apps/games/scriptkill/scriptkill.css';
const LD_DATA = 'apps/games/ludo/ludo-data.js';
const LD_VIEW = 'apps/games/ludo/ludo-view.js';
const LD_CSS = 'apps/games/ludo/ludo.css';
const APP = 'apps/games/games-app.js';
const POKER_VIEW = 'apps/games/poker/poker-view.js';
const POKER_CSS = 'apps/games/poker/poker.css';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释（字符状态机，与 v3300 / v3310 / v3320 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`Dexie`、`chat.history`、
 *    `/v1/chat/completions`…）是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）：被审代码里一旦出现**裸的引号或
 *    反引号**，剥器会把正则正文当成字符串/模板串的起头。本版两份视图的产出面是
 *    「反引号成对、状态可复位」（J1 逐文件实测尾随哨兵可被剥掉），故两向都钉住。 */
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
/** 假存储：只记内存，`get` 返回结构化克隆（判据不许与被测件共用同一份对象引用）。 */
function fakeStorage(seed = null) {
    const box = { value: seed };
    return {
        get: () => (box.value === null || box.value === undefined ? null : JSON.parse(JSON.stringify(box.value))),
        set: (_k, v) => { box.value = JSON.parse(JSON.stringify(v)); },
        _raw: box,
    };
}
/* ══════════════════════ 夹具 ══════════════════════ */
/** 剧本杀牌桌：座位数按**内建剧本的角色数**铺（真件要求人数 === 角色数）。
 *  ★ 为什么不用合成剧本：`startGame` 内部按 `getBuiltInSkScript(scriptId)` 查表
 *    （模块内函数，class 方法覆盖不到），合成剧本进不去 —— 所以夹具直接用**真剧本**，
 *    判据全部按**身份**取下标（凶手是谁由洗牌决定，不写死）。 */
function skSeats(script) {
    const names = ['小雅', '阿澈', '阿禾', '阿泠', '阿岚'];
    return script.roles.map((_, i) => (i === 0
        ? { id: 'user', name: '我', isUser: true }
        : { id: 'c' + i, name: names[i - 1] || ('AI' + i) }));
}
function skFixture(api) {
    const data = new api.ScriptKillData(fakeStorage());
    data.seatPlayers(skSeats(api.__script));
    return { data };
}
function startedSk(api) {
    const { data } = skFixture(api);
    assert.equal(data.startGame({ scriptId: api.__script.id }), true, '内建剧本必须能开局');
    return data;
}
function ludoFixture(api) {
    return { data: new api.LudoData(fakeStorage()) };
}
function startedLudo(api) {
    const { data } = ludoFixture(api);
    const ok = data.startGame({ userPlayer: { name: '我', avatar: '' }, opponent: { id: 'c1', name: '小雅' } });
    assert.equal(ok, true, '飞行棋必须能开局');
    return data;
}
/** 把某玩家棋子直接摆到指定格（夹具：只改位置，不走掷骰）。 */
function placeAt(data, id, index) {
    data.getState().positions[id] = index;
}
/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */
/* ── A 剧本杀内核 ── */
function skProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);
    const script = api.__script;
    /* A0 夹具自证：同桌要有 AI、且「私有线索」不是人人都能拿到 —— 否则下面几条空转。 */
    {
        const st = skFixture(api).data.getState();
        if (!st.players.some((p) => p.isUser)) push('fixture-no-user');
        if (st.players.filter((p) => !p.isUser).length < 2) push('fixture-too-few-ai');
        if (st.players.length !== script.roles.length) push('fixture-seat-count');
        if (!script.clues.some((c) => c.owner !== api.SK_PUBLIC_OWNER)) push('fixture-no-private-clue');
    }
    /* A1 阶段链十阶，首尾与顺序与源侧 switch 一致。 */
    {
        if (api.SK_PHASES.length !== 10) push('phases-count');
        if (api.SK_PHASES[0] !== 'start' || api.SK_PHASES[api.SK_PHASES.length - 1] !== 'end') push('phases-ends');
        const d = startedSk(api);
        if (d.getPhaseIndex('evidence_round_1') !== 3) push('phases-order');
        if (d.nextPhaseOf('start') !== 'introduction') push('phases-next');
        if (d.nextPhaseOf('end') !== 'end') push('phases-tail');
        if (d.setPhase('__nope__') !== false || d.getState().phase !== 'start') push('phase-rejects-unknown');
    }
    /* A2 搜证：**累计上限**（round1=2 / round2=3），上限用尽不许再记；非搜证阶段 0。
     *  ★ 这条钉的正是起手那处真缺陷（拿「本阶段新增额度」比跨轮累计计数器 ⇒ 第二轮恒 0）。 */
    {
        const d = startedSk(api);
        const r1 = api.SK_SEARCH_ALLOWANCE.evidence_round_1;
        const r2 = api.SK_SEARCH_ALLOWANCE.evidence_round_2;
        if (d.searchCapOf('evidence_round_1') !== r1) push('cap-round1');
        if (d.searchCapOf('evidence_round_2') !== r1 + r2) push('cap-round2');
        if (d.searchCapOf('discussion_round_1') !== 0) push('cap-non-search');
        d.setPhase('evidence_round_1');
        if (d.recordSearch('user') !== true) push('record-first');
        if (d.recordSearch('user') !== true) push('record-second');
        if (d.recordSearch('user') !== false) push('cap-enforced');
        if (d.searchCountOf('user') !== r1) push('cap-count');
        if (d.remainingSearch('user') !== 0) push('cap-remaining');
        /* 换到第二轮：上限变 3、计数仍是 2 ⇒ 还剩 1 次（起手版本这里恒 0）。 */
        d.setPhase('evidence_round_2');
        if (d.remainingSearch('user') !== r2) push('cap-round2-remaining');
        if (d.canSearch('user') !== true) push('cap-round2-can-search');
        if (d.recordSearch('user') !== true) push('record-third');
        if (d.recordSearch('user') !== false) push('cap-round2-enforced');
    }
    /* A3 角色分配：恰一个凶手、角色互不重复；free 模式用户拿到指定角色、出界被拒。 */
    {
        const d = startedSk(api);
        if (d.getKiller() === null) push('assign-one-killer');
        if (d.getState().players.filter((p) => p.isKiller).length !== 1) push('assign-single-killer');
        const roles = new Set(d.getState().players.map((p) => p.roleName));
        if (roles.size !== script.roles.length) push('assign-distinct-roles');
        const f0 = skFixture(api).data;
        if (f0.startGame({ scriptId: script.id, free: true, userRoleIndex: script.roles.length + 3 }) !== false) push('assign-free-out-of-range');
        const f1 = skFixture(api).data;
        if (f1.startGame({ scriptId: script.id, free: true, userRoleIndex: 0 }) !== true) push('assign-free-ok');
        if (f1.getUserPlayer()?.roleName !== script.roles[0].name) push('assign-free-picks-user-role');
    }
    /* A4 线索：唯一键 = 描述；可用线索 = 公共 + **自己角色名**的私人物品；别人的私有拿不到。 */
    {
        const d = startedSk(api);
        const me = d.getUserPlayer();
        const other = d.getState().players.find((p) => p.id !== me.id);
        if (api.clueKey(script.clues[0]) !== script.clues[0].description) push('clue-key');
        const mine = d.availableCluesFor(me.id).map((c) => c.description);
        const rival = d.availableCluesFor(other.id).map((c) => c.description);
        for (const clue of script.clues) {
            const visible = clue.owner === api.SK_PUBLIC_OWNER || clue.owner === me.roleName;
            if (visible && !mine.includes(clue.description)) push('clue-visible-missing');
            if (!visible && mine.includes(clue.description)) push('clue-private-leaked');
        }
        for (const clue of script.clues) {
            const visible = clue.owner === api.SK_PUBLIC_OWNER || clue.owner === other.roleName;
            if (!visible && rival.includes(clue.description)) push('clue-private-leaked');
        }
        /* 收一条：uncollected 少一条、重复收被拒、「关于自己」按归属角色名判。 */
        const target = script.clues[0];
        const before = d.uncollectedClues().length;
        if (d.collectClue(target, me.id) !== true) push('clue-collect');
        if (d.uncollectedClues().length !== before - 1) push('clue-uncollected');
        if (d.collectClue(target, me.id) !== false) push('clue-collect-twice');
        if (d.isClueCollected(target) !== true) push('clue-collected-flag');
        if (!(d.getPlayerById(me.id)?.evidence || []).includes(target.description)) push('clue-evidence-holder');
        const ownPrivate = script.clues.find((c) => c.owner === me.roleName);
        const otherPrivate = script.clues.find((c) => c.owner !== api.SK_PUBLIC_OWNER && c.owner !== me.roleName);
        if (ownPrivate && d.isAboutSelf(ownPrivate, me.id) !== true) push('about-self');
        if (otherPrivate && d.isAboutSelf(otherPrivate, me.id) !== false) push('about-self-other');
        /* 归属串不是数据侧职责：数组里不许出现后缀（显示才拼）。 */
        if (script.clues.some((c) => String(c.owner).includes(api.SK_PRIVATE_SUFFIX))) push('clue-owner-suffix-stored');
        /* ★ 助手必须按 **roleName** 匹配、且**不**返回带后缀的串（双侧都钉）：
         *   按 `name`（玩家昵称）匹配是本件起手那处真形态的连带 —— 昵称与角色名不一致时
         *   谁都搜不到自己的东西，且不报错。只钉「带后缀」一侧等于漏掉这一侧。 */
        const owner = api.privateOwnerOf({ roleName: script.roles[0].name });
        if (owner !== script.roles[0].name) push('owner-helper-roleName');
        if (String(owner).includes(api.SK_PRIVATE_SUFFIX)) push('owner-helper-keeps-suffix');
        if (api.privateOwnerOf({ name: script.roles[0].name }) !== '') push('owner-helper-ignores-name');
        if (api.privateOwnerOf({ roleName: '  ' }) !== '') push('owner-helper-trims');
        /* 归属显示串：公共 → 公共区域；私有 → 「XX的私人物品」（源侧的显示拼接）。 */
        if (api.ownerDisplayOf(api.SK_PUBLIC_OWNER) !== '公共区域') push('owner-display-public');
        if (api.ownerDisplayOf(script.roles[0].name) !== script.roles[0].name + api.SK_PRIVATE_SUFFIX) push('owner-display-private');
        /* 视图与编排层不许**引用**后缀常量（拼接必须走 ownerDisplayOf）——
         *   ★ 钉的是**标识符**不是中文字面：视图的玩法说明里那句「也可能翻到
         *     自己的私人物品」是文案，不是归属拼接；把它算成违规等于逼着改文案。 */
        for (const rel of [APP, SK_VIEW]) {
            if (/\bSK_PRIVATE_SUFFIX\b/.test(stripComments(read(rel)))) push('suffix-referenced:' + rel);
        }
    }
    /* A5 投票：唯一最高票 == 凶手才好人赢；平票 / 票给别人都是凶手赢；空票不入表。 */
    {
        /* ★ 判据不许假设「谁坐在哪个下标上」：真实下标是**洗牌后**的（用户可能排到
         *   末位），而且 `players.filter(id !== killer.id)` 里**可能包含用户** ——
         *   照「下标 0/1/2」投会覆盖掉别人的票，票数凭空少一票还以为是内核错了。
         *   这里改成「按身份挑投票人」：killer 不投自己那张票，票数就恒等于投票人数。 */
        const d = startedSk(api);
        const killer = d.getKiller();
        const voters = d.getState().players.filter((p) => p.id !== killer.id);
        for (const voter of voters) d.setVote(voter.id, killer.id);
        const t = d.tallyVotes();
        if (t.counts[killer.id] !== voters.length) push('vote-count');
        if (t.topIds.length !== 1 || t.tie) push('vote-top-unique');
        const hit = d.resolveVotes();
        if (hit.winner !== '好人阵营' || hit.hit !== true) push('vote-good-wins');
        /* 平票（三方各一票，**凶手也在票里**）⇒ 凶手阵营赢。
         * ★ 凶手必须落在票里：否则「平票」这一条对「平票也算命中」的破坏**没有判别力**
         *   （凶手拿 0 票时，改不改 `topIds.includes(killer.id)` 结果都是 false ——
         *   本轮实测就是这样漏掉的）。 */
        const e = startedSk(api);
        const k2 = e.getKiller();
        const non = e.getState().players.filter((p) => p.id !== k2.id);
        e.setVote(k2.id, non[0].id);
        e.setVote(non[0].id, non[1].id);
        e.setVote(non[1].id, k2.id);
        const et = e.tallyVotes();
        if (!et.tie) push('vote-tie-detect');
        if (!et.topIds.includes(k2.id)) push('vote-tie-includes-killer');
        if (e.resolveVotes().winner !== '凶手阵营') push('vote-tie-no-win');
        /* 最高票是别人 ⇒ 凶手阵营赢（票数 2:0，最高票唯一但不是凶手）。 */
        const f = startedSk(api);
        const k3 = f.getKiller();
        const r3 = f.getState().players.filter((p) => p.id !== k3.id);
        f.setVote(k3.id, r3[0].id);
        f.setVote(r3[1].id, r3[0].id);
        const fv = f.resolveVotes();
        if (fv.winner !== '凶手阵营' || fv.hit !== false) push('vote-wrong-target');
        /* 空票不入表。 */
        const g = startedSk(api);
        g.setVote('user', '');
        if (Object.keys(g.tallyVotes().counts).length !== 0) push('vote-empty-ignored');
    }
    /* A6 日志封顶 400 且保留首条（挡住首条 = 玩家再也看不到本局是什么）。 */
    {
        const d = startedSk(api);
        const first = d.getState().log[0]?.text || '';
        if (!first.includes('剧本')) push('log-first-is-system');
        for (let i = 0; i < 600; i += 1) d.addSystem('填充' + i);
        const log = d.getState().log;
        if (log.length > 400) push('log-cap');
        if ((log[0]?.text || '') !== first) push('log-keeps-first');
    }
    /* A7 开局前提：剧本不在 / 人数不等于角色数 都不许开，且状态不许被改烂。 */
    {
        const a = skFixture(api).data;
        if (a.startGame({ scriptId: 'no_such_script' }) !== false) push('start-needs-script');
        const b = new api.ScriptKillData(fakeStorage());
        b.seatPlayers([{ id: 'user', name: '我', isUser: true }]);
        if (b.startGame({ scriptId: script.id }) !== false) push('start-needs-players');
        const c = new api.ScriptKillData(fakeStorage());
        if (c.startGame({ scriptId: script.id }) !== false) push('start-needs-seats');
    }
    /* A8 玩法表两值齐全（视图的「随机 / 我来挑」是查这张表，不是另写文案）。 */
    {
        const values = api.SK_ASSIGN_MODES.map((m) => m.value);
        if (values.length !== 2) push('assign-modes-size');
        if (!values.includes('random') || !values.includes('free')) push('assign-modes-values');
        if (api.SK_ASSIGN_MODES.some((m) => !m.label)) push('assign-modes-labels');
    }
    return bad;
}
/* ── B 飞行棋内核 ── */
function ludoProblems(api) {
    const bad = [];
    const push = (tag) => bad.push(tag);
    /* B1 棋盘常数：42 格 / 终点 41 / 起点 -1 / 事件格升序去重且严格在开区间内。 */
    {
        if (api.LUDO_BOARD_SIZE !== 42) push('board-size');
        if (api.LUDO_FINAL_INDEX !== api.LUDO_BOARD_SIZE - 1) push('final-index');
        if (api.LUDO_START_POSITION !== -1) push('start-position');
        const cells = api.LUDO_EVENT_CELLS;
        if (new Set(cells).size !== cells.length) push('event-cells-dup');
        if (!cells.every((v, i) => i === 0 || v > cells[i - 1])) push('event-cells-order');
        if (cells.some((v) => v <= 0 || v >= api.LUDO_FINAL_INDEX)) push('event-cells-range');
        if (api.isLudoEventCell(cells[0]) !== true) push('event-cell-flag');
        if (api.isLudoEventCell(0) !== false) push('event-cell-zero');
        if (api.isLudoEventCell(api.LUDO_FINAL_INDEX) !== false) push('event-cell-final');
        if (api.isLudoEventCell('x') !== false) push('event-cell-bad-input');
    }
    /* B2 起点 50% 出 6（边界 0.5 不算 6），否则 1~5；起飞后公平 1~6。
     *  ★ rng 用**池**而不是常量：起点分支要**取两次样**（源侧 `rollTheDice` 的 `if` 里
     *    一次、`Math.floor(Math.random()*5)+1` 再一次）。拿固定常量当 rng，
     *    「两次取样写成一次复用」的写法会被测成「符合预期」——
     *    这里按取样次序喂不同值，边界才真的钉住。 */
    {
        const pool = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
        if (api.rollLudoDice(true, pool(0.49, 0.99)) !== 6) push('takeoff-six');
        if (api.rollLudoDice(true, pool(0.5, 0.0)) !== 1) push('takeoff-half-is-not-six');
        if (api.rollLudoDice(true, pool(0.99, 0.0)) !== 1) push('takeoff-one');
        if (api.rollLudoDice(true, pool(0.99, 0.29)) !== 2) push('takeoff-two');
        if (api.rollLudoDice(true, pool(0.99, 0.99)) !== 5) push('takeoff-five');
        if (api.rollLudoDice(true, pool(0.999, 0.999)) !== 5) push('takeoff-max-is-five');
        /* 起飞时**不出 6 就只可能 1~5**，且 1 与 2 必须到得了（这是起手那处真缺陷的形状：
         *  一次取样两处复用 ⇒ floor(draw*5)+1 在 draw>=0.5 时恒 >= 3，1/2 永远掷不出）。
         *  ★ 两次取样必须**各取各的**：拿同一个序号派生两次（`(i*2+step)`）会把两轮耦合成
         *    一条序列，1 与 2 落到互补区间里 ⇒ 判据自己制造出「不可达」的假红。 */
        const sawStart = new Set();
        for (const first of [0.1, 0.6]) {
            for (const second of [0, 0.19, 0.39, 0.59, 0.79, 0.99]) {
                sawStart.add(api.rollLudoDice(true, pool(first, second)));
            }
        }
        if (sawStart.size !== 6) push('takeoff-reachable:' + [...sawStart].sort((a, b) => a - b).join(','));
        if ([...sawStart].some((v) => v < 1 || v > 6)) push('takeoff-out-of-range');
        /* 起飞后公平：六面都到得了，且都是整数。 */
        const fair = new Set();
        for (let i = 0; i < 6; i += 1) fair.add(api.rollLudoDice(false, pool(i / 6)));
        if (fair.size !== 6 || [...fair].some((v) => !Number.isInteger(v) || v < 1 || v > 6)) {
            push('dice-range:' + [...fair].sort((a, b) => a - b).join(','));
        }
    }
    /* B3 起点：非 6 不能起飞（位置不动）；掷 6 起飞到 0 格。 */
    {
        const d = startedLudo(api);
        const u = d.getUserPlayer();
        placeAt(d, u.id, api.LUDO_START_POSITION);
        const blocked = d.applyRoll(u.id, 5);
        if (blocked?.type !== 'blocked') push('start-needs-six');
        if (d.positionOf(u.id) !== api.LUDO_START_POSITION) push('start-stays');
        const take = d.applyRoll(u.id, 6);
        if (take?.type !== 'takeoff' || take.to !== 0) push('takeoff-to-zero');
        if (d.isOnBoard(u.id) !== true) push('takeoff-on-board');
    }
    /* B4 越过终点：停到终点并判胜（不许溢出、也不许「不走了」）；结束后不许再行动。 */
    {
        const d = startedLudo(api);
        const u = d.getUserPlayer();
        placeAt(d, u.id, api.LUDO_FINAL_INDEX - 2);
        const win = d.applyRoll(u.id, 5);
        if (win?.type !== 'win') push('overshoot-blocked');
        if (d.positionOf(u.id) !== api.LUDO_FINAL_INDEX) push('overshoot-clamped');
        if (d.getState().phase !== 'ended') push('win-ends-game');
        if (!d.getState().winnerId) push('win-records-winner');
        if (d.shouldRollAgain(6) === true) push('ended-no-extra-roll');
    }
    /* B5 踩到对方：对方回起点；没踩到不许动别人。 */
    {
        const d = startedLudo(api);
        const u = d.getUserPlayer();
        const ai = d.getAiPlayer();
        placeAt(d, u.id, 4);
        placeAt(d, ai.id, 9);
        const hit = d.applyRoll(u.id, 5);
        if (hit?.type !== 'move' || hit.to !== 9) push('move-normal');
        if (hit.kicked !== ai.id) push('kick-detects');
        if (d.positionOf(ai.id) !== api.LUDO_START_POSITION) push('kick-sends-home');
        const e = startedLudo(api);
        const u2 = e.getUserPlayer();
        const ai2 = e.getAiPlayer();
        placeAt(e, u2.id, 4);
        placeAt(e, ai2.id, 2);
        const plain = e.applyRoll(u2.id, 5);
        if (plain.kicked !== null) push('kick-only-on-collision');
        if (e.positionOf(ai2.id) !== 2) push('kick-no-false-move');
    }
    /* B6 掷 6 再行动（仅进行中）；脏骰子入参一律 null（不许当成 1 走一步）。 */
    {
        const d = startedLudo(api);
        if (d.shouldRollAgain(6) !== true) push('roll-again-six');
        if (d.shouldRollAgain(5) !== false) push('roll-again-five');
        const u = d.getUserPlayer();
        if (d.applyRoll(u.id, 0) !== null) push('dice-zero-rejected');
        if (d.applyRoll(u.id, 7) !== null) push('dice-seven-rejected');
        if (d.applyRoll('', 3) !== null) push('dice-no-player-rejected');
    }
    /* B7 题库轮转：一轮内不重复、取空再洗、空题库返回 null；抽题落成「带作答记录」形态。 */
    {
        const deck = new api.LudoQuestionDeck(api.LUDO_BUILT_IN_QUESTIONS, () => 0.5);
        const total = api.LUDO_BUILT_IN_QUESTIONS.length;
        const seen = new Set();
        for (let i = 0; i < total; i += 1) {
            const q = deck.next();
            if (!q || !q.text) push('deck-returns-question');
            else seen.add(q.text);
        }
        if (seen.size !== total) push('deck-rotates');
        if (!deck.next()?.text) push('deck-reshuffles-after-empty');
        if (new api.LudoQuestionDeck([], () => 0.5).next() !== null) push('deck-empty-safe');
        const d = startedLudo(api);
        const q = d.drawQuestion();
        if (!q || !Array.isArray(q.answers) || q.answers.length !== 0) push('draw-shape');
        if (d.questionAwaitingUser() !== false) push('awaiting-default');
        d.updateQuestion({ awaiting: 'user', kind: 'answer' });
        if (d.questionAwaitingUser() !== true) push('awaiting-user');
        d.pushQuestionAnswer({ speakerId: 'user', speaker: '我', text: '我喜欢雨天', kind: 'answer' });
        if (d.getState().pendingQuestion.answers.length !== 1) push('answer-pushed');
        if (d.getState().pendingQuestion.answers[0].text !== '我喜欢雨天') push('answer-text');
        d.clearQuestion();
        if (d.getState().pendingQuestion !== null) push('question-cleared');
        if (d.updateQuestion({ awaiting: 'user' }) !== null) push('update-without-question');
        if (d.pushQuestionAnswer({ text: 'x' }) !== false) push('push-without-question');
    }
    /* B8 模式表与事件词表：两值成对、标签非空、查不到回落原名；题库不许出现幽灵模式。 */
    {
        if (api.LUDO_QUESTION_TYPES.length !== 2) push('mode-table-size');
        const values = api.LUDO_QUESTION_TYPES.map((m) => m.value);
        if (!values.includes('both_answer') || !values.includes('single_answer')) push('mode-table-values');
        if (api.LUDO_QUESTION_TYPES.some((m) => !m.label)) push('mode-table-labels');
        if (api.ludoModeLabel('both_answer') !== api.LUDO_QUESTION_TYPES[0].label) push('mode-label-lookup');
        if (api.ludoModeLabel('__nope__') !== '__nope__') push('mode-label-fallback');
        if (!api.LUDO_AI_EVENTS.length) push('event-table-empty');
        if (new Set(api.LUDO_AI_EVENTS).size !== api.LUDO_AI_EVENTS.length) push('event-table-dup');
        const unknown = api.LUDO_BUILT_IN_QUESTIONS.filter((q) => !values.includes(q.type));
        if (unknown.length) push('question-unknown-mode');
    }
    /* B9 日志封顶 300 且保留首条（与 A6 同款：封顶不能把「本局怎么开始的」吞掉）。 */
    {
        const d = startedLudo(api);
        const first = d.getState().log[0]?.text || '';
        if (!first.includes('先手')) push('ludo-log-first');
        for (let i = 0; i < 400; i += 1) d.addSystem('填充' + i);
        const log = d.getState().log;
        if (log.length > 300) push('ludo-log-cap');
        if ((log[0]?.text || '') !== first) push('ludo-log-keeps-first');
    }
    return bad;
}
/* ══════════════════════ api 面（真件与破坏副本共用） ══════════════════════ */
function skApiOf(mod) {
    return {
        ScriptKillData: mod.ScriptKillData,
        SK_PHASES: mod.SK_PHASES,
        SK_SEARCH_ALLOWANCE: mod.SK_SEARCH_ALLOWANCE,
        SK_ASSIGN_MODES: mod.SK_ASSIGN_MODES,
        SK_PUBLIC_OWNER: mod.SK_PUBLIC_OWNER,
        SK_PRIVATE_SUFFIX: mod.SK_PRIVATE_SUFFIX,
        SK_BUILT_IN_SCRIPTS: mod.SK_BUILT_IN_SCRIPTS,
        getBuiltInSkScript: mod.getBuiltInSkScript,
        clueKey: mod.clueKey,
        privateOwnerOf: mod.privateOwnerOf,
        ownerDisplayOf: mod.ownerDisplayOf,
        __script: mod.SK_BUILT_IN_SCRIPTS[0],
    };
}
function ludoApiOf(mod) {
    return {
        LudoData: mod.LudoData,
        LudoQuestionDeck: mod.LudoQuestionDeck,
        rollLudoDice: mod.rollLudoDice,
        isLudoEventCell: mod.isLudoEventCell,
        LUDO_BOARD_SIZE: mod.LUDO_BOARD_SIZE,
        LUDO_FINAL_INDEX: mod.LUDO_FINAL_INDEX,
        LUDO_START_POSITION: mod.LUDO_START_POSITION,
        LUDO_EVENT_CELLS: mod.LUDO_EVENT_CELLS,
        LUDO_QUESTION_TYPES: mod.LUDO_QUESTION_TYPES,
        LUDO_AI_EVENTS: mod.LUDO_AI_EVENTS,
        LUDO_BUILT_IN_QUESTIONS: mod.LUDO_BUILT_IN_QUESTIONS,
        ludoModeLabel: mod.ludoModeLabel,
    };
}
const REAL_SK = skApiOf({
    ScriptKillData, SK_PHASES, SK_SEARCH_ALLOWANCE, SK_ASSIGN_MODES, SK_PUBLIC_OWNER,
    SK_PRIVATE_SUFFIX, SK_BUILT_IN_SCRIPTS, getBuiltInSkScript, clueKey, privateOwnerOf,
    ownerDisplayOf,
});
const REAL_LD = ludoApiOf({
    LudoData, LudoQuestionDeck, rollLudoDice, isLudoEventCell, LUDO_BOARD_SIZE, LUDO_FINAL_INDEX,
    LUDO_START_POSITION, LUDO_EVENT_CELLS, LUDO_QUESTION_TYPES, LUDO_AI_EVENTS,
    LUDO_BUILT_IN_QUESTIONS, ludoModeLabel,
});
/* ══════════════════════ A/B 内核判据挂测 ══════════════════════ */
test('A1 剧本杀内核：阶段链 / 搜证累计上限 / 角色分配 / 线索归属 / 投票 / 日志封顶 / 开局前提', () => {
    assert.deepEqual(skProblems(REAL_SK), [], '内核口径必须与设计一致，实测问题：' + skProblems(REAL_SK).join(' , '));
    assert.equal(REAL_SK.SK_PHASES.length, 10, '阶段链就是十阶');
    assert.equal(REAL_SK.SK_SEARCH_ALLOWANCE.evidence_round_1, 2, '第一轮搜证 2 次');
    assert.equal(REAL_SK.SK_SEARCH_ALLOWANCE.evidence_round_2, 1, '第二轮补搜 1 次');
});
test('B1 飞行棋内核：棋盘 / 起点概率 / 起飞 / 到点判胜 / 踩人 / 再行动 / 题库 / 模式表 / 日志', () => {
    assert.deepEqual(ludoProblems(REAL_LD), [], '内核口径必须与设计一致，实测问题：' + ludoProblems(REAL_LD).join(' , '));
    assert.equal(REAL_LD.LUDO_BOARD_SIZE, 42, '棋盘就是 42 格');
    assert.equal(REAL_LD.LUDO_EVENT_CELLS.length, 8, '事件格 8 个');
});
test('A2 内建剧本与题库是**原创**（源数据一条不搬）：数量、结构、归属纯度全部钉死', () => {
    /* ★ 为什么必须有：源的内置剧本与默认题库都不在 game-hall 分片里（见文件头），
     *   本件是原创。这条把「原创的那几个数」钉住 —— 下一版若顺手把源数据填进来，
     *   数量、角色数、线索数、凶手数会同时变。 */
    assert.equal(SK_BUILT_IN_SCRIPTS.length, 2, '内建剧本两份');
    for (const script of SK_BUILT_IN_SCRIPTS) {
        assert.ok(script.id.startsWith('built_in_'), '内建剧本 id 前缀：' + script.id);
        assert.ok(script.name && script.storyBackground && script.truth, '剧本必须有名字/背景/真相');
        assert.equal(script.roles.filter((r) => r.isKiller).length, 1, script.name + ' 必须恰有一个凶手');
        for (const role of script.roles) {
            assert.ok(role.name && role.description && role.storyline && role.tasks,
                script.name + ' 的角色四件（名字/介绍/故事/任务）缺一：' + role.name);
        }
        assert.ok(script.clues.length >= 6, script.name + ' 线索太少（' + script.clues.length + '）');
        assert.ok(script.clues.some((c) => c.owner === SK_PUBLIC_OWNER), script.name + ' 必须有公共线索');
        assert.ok(script.clues.some((c) => c.owner !== SK_PUBLIC_OWNER), script.name + ' 必须有私人物品线索');
        /* ★ 归属纯度：`owner` 只存**角色名**（与源侧同口径），后缀是显示时才拼的 ——
         *   数组里一旦混进后缀，写的是「数据 + 显示」两份信息，改名要动两处。 */
        const names = new Set(script.roles.map((r) => r.name));
        for (const clue of script.clues) {
            assert.equal(String(clue.owner).includes(SK_PRIVATE_SUFFIX), false,
                script.name + ' 的 owner 不许带显示后缀：' + clue.owner);
            if (clue.owner === SK_PUBLIC_OWNER) continue;
            assert.ok(names.has(clue.owner), script.name + ' 的私物归属不在角色表里：' + clue.owner);
            assert.ok(clue.description, script.name + ' 的线索必须有描述（描述就是唯一键）');
        }
        /* 线索描述必须唯一（描述是 collectedClueIds 的键，重复即两条线索互相吞）。 */
        const descs = script.clues.map((c) => c.description);
        assert.equal(new Set(descs).size, descs.length, script.name + ' 的线索描述必须唯一');
    }
    assert.equal(getBuiltInSkScript(SK_BUILT_IN_SCRIPTS[0].id)?.name, SK_BUILT_IN_SCRIPTS[0].name, '按 id 取剧本');
    assert.equal(getBuiltInSkScript('no_such'), null, '取不到必须返回 null（不许抛）');
    assert.equal(SK_BUILT_IN_SCRIPTS[0].roles.length, 3, '雾港灯塔 3 角色');
    assert.equal(SK_BUILT_IN_SCRIPTS[0].clues.length, 7, '雾港灯塔 7 线索');
    assert.equal(SK_BUILT_IN_SCRIPTS[1].roles.length, 4, '子夜书店 4 角色');
    assert.equal(SK_BUILT_IN_SCRIPTS[1].clues.length, 8, '子夜书店 8 线索');
    assert.equal(LUDO_BUILT_IN_QUESTIONS.length, 21, '内建题库 21 条');
    const both = LUDO_BUILT_IN_QUESTIONS.filter((q) => q.type === 'both_answer').length;
    const single = LUDO_BUILT_IN_QUESTIONS.filter((q) => q.type === 'single_answer').length;
    assert.equal(both, 11, '双向回答 11 条（实测 ' + both + '）');
    assert.equal(single, 10, '一人答一人评 10 条（实测 ' + single + '）');
    assert.ok(LUDO_BUILT_IN_QUESTIONS.every((q) => q.text && q.text.length >= 4), '题库题目不许是空串');
    assert.equal(new Set(LUDO_BUILT_IN_QUESTIONS.map((q) => q.text)).size, 21, '题库题目不许重复');
});
/* ══════════════════════ F 通道与禁入面 ══════════════════════ */
test('F1 两件一律走宿主生成侧：不许 fetch / apiKey / endpoint / Dexie / 写聊天楼层', () => {
    /* ★ 源侧四处「有，但不许进来」的形态（见文件头）：
     *   ① 源落 Dexie 三张表（`db.scriptKillScripts` / `db.ludoQuestionBanks` / `db.ludoQuestions`）；
     *   ② 源往 `chat.history` push 可见卡与 `isHidden: true` 的 system 指令；
     *   ③ 源自己拼 systemPrompt 直打 `/v1/chat/completions`；
     *   ④ 源把图与外链写进状态。
     *   这四条**都只在注释里**（说明「为什么不能有」），所以必须先剥注释 ——
     *   否则判据会拿自己的说明文当违规（本仓记过的「注释里的提及不算消费」半面）。 */
    const check = [APP, SK_DATA, SK_VIEW, LD_DATA, LD_VIEW];
    for (const rel of check) {
        const code = stripComments(read(rel));
        for (const banned of ['XMLHttpRequest', 'apiKey', 'Authorization', 'chat/completions',
            'Dexie', 'indexedDB', 'openDB', 'db.chats', 'chat.history', 'history.push',
            'isHidden', 'scriptKillScripts', 'ludoQuestionBanks', 'ludoQuestions']) {
            assert.equal(code.includes(banned), false, rel + ' 的代码里不得出现：' + banned);
        }
        /* `fetch(` 在编排层是明令禁止（宿主生成侧必须走 apiManager）；两层数据/视图更不许。 */
        assert.equal(code.includes('fetch('), false, rel + ' 不得自己发请求（走 apiManager.callAI）');
    }
    /* 本件两层数据层：只许一条 import，且必须是全仓唯一的取数门，层级要到仓根（三层）。 */
    for (const rel of [SK_DATA, LD_DATA]) {
        const data = read(rel);
        const imports = data.match(/^\s*import\s.*$/gm) || [];
        assert.equal(imports.length, 1, rel + ' 只能有一条 import（实测 ' + imports.length + '）');
        assert.ok(imports[0].includes("from '../../../config/num-gate.js'"),
            rel + ' 那一条 import 必须是唯一取数门，且**层级要对**（apps/games/<name>/ 到仓根是三层）');
        assert.ok(/import\s*\{\s*numOrNull\s*\}/.test(imports[0]), rel + ' 必须只引入 numOrNull');
        const code = stripComments(data);
        assert.equal(code.includes('Number.isFinite(Number('), false, rel + ' 不得就地再写一份弱口径取数');
        for (const banned of ['document.', 'window.', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval']) {
            assert.equal(code.includes(banned), false, rel + ' 的代码里不得出现：' + banned);
        }
    }
    /* 视图层不许碰存储（状态一律落数据层，视图只读）。 */
    for (const rel of [SK_VIEW, LD_VIEW]) {
        const code = stripComments(read(rel));
        for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'PhoneStorage']) {
            assert.equal(code.includes(banned), false, rel + ' 不得直接碰存储：' + banned);
        }
    }
    /* 两件一张图都不存、一条外链都不收（源侧把图与外链写进状态）。 */
    for (const rel of [SK_DATA, SK_VIEW, LD_DATA, LD_VIEW]) {
        const code = stripComments(read(rel));
        for (const banned of ['http://', 'https://', 'cdn.', '.png', '.jpg', '.webp', 'img src']) {
            assert.equal(code.includes(banned), false, rel + ' 不得收外链 / 图源：' + banned);
        }
    }
});
test('F2 生成侧只走一条通道：两件都调 _callDialogGameAi，且它落在 callAI 上', () => {
    const app = read(APP);
    /* 两件都走同一条既有通道（v3.32.0 建的），不另起一套。
     * ★ 「一人答 · 一人评」在编排层是 `_ludoAiAnswer` 的 **kind 参数**（不另立方法）——
     *   判据钉的是「问答链真的共用一条通道」，不是钉方法名。写死一个不存在的方法名
     *   等于让判据自己去发明实现（本轮 F2 起手就这样误红了一次）。 */
    for (const fn of ['_scriptKillAct', '_ludoAiAnswer', '_ludoResumeQuestion', '_ludoAskQuestion']) {
        assert.ok(app.includes(fn), APP + ' 必须实现 ' + fn);
    }
    const atEval = app.indexOf('    async _ludoAiAnswer(');
    assert.ok(atEval > 0, '_ludoAiAnswer 必须在场');
    const evalBody = app.slice(atEval, atEval + 1600);
    assert.ok(evalBody.includes("kind"), '_ludoAiAnswer 必须接收 kind（区分回答与评价）');
    assert.ok(evalBody.includes("'evaluate'"), '_ludoAiAnswer 必须处理评价这一步（一人答 · 一人评）');
    const body = app.slice(app.indexOf('async _callDialogGameAi('), app.indexOf('async _callDialogGameAi(') + 1400);
    assert.ok(body.includes('apiManager'), '_callDialogGameAi 必须走宿主 apiManager');
    assert.ok(/callAI\s*\(|callAI\b/.test(body), '_callDialogGameAi 必须落在 callAI 上');
    assert.ok(body.includes('_waitDialogGameApiCooldown()'), '通道前必须过共享冷却');
    /* 两件都必须真的用这条通道（不是声明了没人调）。
     * ★ 窗口要**按下一个方法定义**切，不能按固定字符数切：`_scriptKillAct` 前面有两百多行
     *   提示词组装，900 字符够不着调用点 ⇒ 判据会自己制造假红；而下一个方法也**不保证是
     *   async**（`_scriptKillActionOfPhase` 就不是）—— 用名字硬拼前缀会 indexOf 成 -1。 */
    const nextMethodAt = (src, from) => {
        const re = /^[ \t]+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/gm;
        re.lastIndex = from;
        const hit = re.exec(src);
        return hit ? hit.index : src.length;
    };
    for (const fn of ['_scriptKillAct', '_ludoAiAnswer']) {
        const a = app.indexOf('    async ' + fn + '(');
        assert.ok(a > 0, fn + ' 必须在场');
        const b = nextMethodAt(app, a + fn.length + 12);
        assert.ok(b > a, fn + ' 之后必须能找到下一个方法（切窗用）');
        const seg = app.slice(a, b);
        assert.ok(seg.includes('_callDialogGameAi('), fn + ' 必须走 _callDialogGameAi（不许自己拼请求）');
        assert.equal(seg.includes('apiManager'), false, fn + ' 不许自己碰 apiManager（通道收在 _callDialogGameAi 里）');
    }
    /* 冷却真的被 await。 */
    const app2 = stripComments(app);
    assert.ok(/await this\._waitDialogGameApiCooldown\(\)/.test(app2), '冷却必须在通道前 await');
    assert.ok(/await this\._dialogSleep\(/.test(app2), '两件的单步节流必须真的 await');
});
/* ══════════════════════ G 接线面 ══════════════════════ */
test('G1 两个入口 / 四条常量 / 生命周期级联 / 返回手势链齐备', () => {
    const app = read(APP);
    for (const sig of ['openScriptKill()', 'openLudo()', 'startScriptKillFlow(', 'advanceScriptKill(',
        'speakScriptKill(', 'searchScriptKill(', 'voteScriptKill(', 'stopScriptKillFlow(',
        'shareScriptKillSummary(', 'startLudoFlow(', 'rollLudo(', 'answerLudo(',
        'stopLudoFlow(', 'shareLudoSummary(', 'runLudoAi(']) {
        assert.ok(app.includes(sig), APP + ' 必须实现 ' + sig);
    }
    assert.ok(app.includes("this.currentView = 'scriptkill'"), '入口必须置 currentView=scriptkill');
    assert.ok(app.includes("this.currentView = 'ludo'"), '入口必须置 currentView=ludo');
    /* 构造期实例化（恰一次）。 */
    for (const s of ['new ScriptKillData(storage)', 'new ScriptKillView(this)',
        'new LudoData(storage)', 'new LudoView(this)']) {
        assert.equal(app.split(s).length - 1, 1, '构造期必须恰实例化一次：' + s);
    }
    /* 常量：三条节流 + 空手率，且都在合理量级（数值写错 = 一局要等半小时或零延迟刷屏）。 */
    const num = (re) => Number((app.match(re) || [])[1]);
    const sk = num(/const SCRIPTKILL_AI_STEP_DELAY_MS = (\d+);/);
    const ld = num(/const LUDO_AI_STEP_DELAY_MS = (\d+);/);
    const rate = Number((app.match(/const SCRIPTKILL_SEARCH_EMPTY_RATE = ([\d.]+);/) || [])[1]);
    const cool = num(/const DIALOG_GAME_API_COOLDOWN_MS = (\d+);/);
    assert.ok(sk >= 500 && sk <= 5000, '剧本杀步进 ' + sk + ' 应在 0.5~5s');
    assert.ok(ld >= 200 && ld <= 3000, '飞行棋步进 ' + ld + ' 应在 0.2~3s');
    assert.equal(rate, 0.3, '搜证空手率与源侧同口径（30%）');
    assert.equal(cool, 5000, '共享冷却与狼人杀 / 谁是卧底同量级（5000）');
    /* 生命周期级联：返回大厅与销毁都要级联两件。 */
    const lobby = app.slice(app.indexOf('    backToLobby()'), app.indexOf('    deactivate()'));
    assert.ok(lobby.includes('this.stopScriptKillFlow?.()'), 'backToLobby 必须停剧本杀驱动');
    assert.ok(lobby.includes('this.stopLudoFlow?.()'), 'backToLobby 必须停飞行棋驱动');
    for (const v of ['scriptKillView?.destroy?.()', 'ludoView?.destroy?.()']) {
        assert.ok(lobby.includes(v), 'backToLobby 必须级联销毁：' + v);
    }
    const deact = app.slice(app.indexOf('    deactivate()'));
    for (const v of ['scriptKillView?.destroy?.()', 'ludoView?.destroy?.()']) {
        assert.ok(deact.includes(v), 'deactivate 必须级联销毁：' + v);
    }
    /* 返回手势：先视图 handleBack，再落大厅。 */
    const swipe = app.slice(app.indexOf('    handleSwipeBack()'));
    assert.ok(swipe.includes("this.currentView === 'scriptkill' && this.scriptKillView?.handleBack?.()"),
        '返回手势必须先问剧本杀视图');
    assert.ok(swipe.includes("this.currentView === 'ludo' && this.ludoView?.handleBack?.()"),
        '返回手势必须先问飞行棋视图');
    /* ★ 同一形态的措辞（与 v3320 交棒改法一致）：形态锚 + 守自己那一件，
     *   不把「当版最后一款」写成确切包含。 */
    assert.ok(/this\.currentView === '[a-z0-9]+'(?: \|\| this\.currentView === '[a-z0-9]+')+\)/.test(swipe),
        '落大厅分支必须是一条 currentView 析取链（形态锚，不许退化成单件判定）');
    for (const v of ['scriptkill', 'ludo']) {
        assert.ok(swipe.includes("'" + v + "'"), '落大厅分支必须含本套件那一件：' + v);
    }
});
test('G2 视图调用面闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* FIELDS = 视图有权直接碰的**属性**（不是方法）：容器引用、构造期挂上的数据层、
     *  以及父类 PokerApp 提供的公开面。 */
    const FIELDS = new Set(['app', 'phoneShell', 'getWechatContactsForPoker', 'backToLobby',
        'scriptKillData', 'ludoData', 'currentView', 'getDefaultScriptKillPrompt']);
    const appSrc = read(APP);
    const methods = new Set();
    /* ★ 修饰符一律可选：`async startScriptKillFlow() {` 是最常见的写法，漏掉 `async`
     *   会让**全部**异步编排方法都看不见 —— 判据自己制造整页假红（本轮 9 条）。 */
    const sigRe = /^[ \t]+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm;
    for (const m of appSrc.matchAll(sigRe)) methods.add(m[1]);
    const missing = [];
    for (const rel of [SK_VIEW, LD_VIEW]) {
        const called = new Set();
        for (const m of read(rel).matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
        for (const n of called) if (!methods.has(n) && !FIELDS.has(n)) missing.push(rel + '::' + n);
        assert.ok(called.size >= 8, rel + ' 的调用面异常小（' + called.size + '）');
    }
    assert.deepEqual(missing, [], '视图调了 App 上不存在的东西：' + missing.join(' , '));
    /* ★ 这条的**判别力**必须自证：起手那版视图写的是 `this.app.startScriptKillFlow?.()`,
     *   而 App 上根本没有这个方法 —— 可选链把「方法不存在」吞成静默无操作，
     *   点「开始」之后界面停住、没有任何按钮能推它。判据要能抓到这种形态。 */
    assert.ok(methods.has('startScriptKillFlow'), '方法签名扫描必须认得开局驱动方法：startScriptKillFlow');
    assert.ok(methods.has('runLudoAi'), '方法签名扫描必须认得 AI 驱动：runLudoAi');
    assert.ok(methods.size >= 165, APP + ' 的方法面异常小（' + methods.size + '）');
});
/* ══════════════════════ E 活性面 ══════════════════════ */
/* 本版修掉的五处真缺陷，每一处都必须真有调用点（导出了不等于用上了）。 */
const LIVE_CHECKS = [
    /* ① 搜证累计上限：`searchCapOf` 必须真被 `remainingSearch` 用上（本轮修） */
    [SK_DATA, 'searchCapOf', 2],
    /* ② 归属助手必须按 roleName 匹配（本轮校正口径） */
    [SK_DATA, 'roleName', 3],
    /* ③ 显示拼接必须只有一处（`ownerDisplayOf`） */
    [SK_DATA, 'ownerDisplayOf', 1],
    [APP, 'ownerDisplayOf', 2],
    /* ④ 开局驱动：视图调了、App 上必须真有（起手是 `?.()` 吞掉的静默无操作）。
     *    App 侧只计**定义处** 1 次（调用点在视图里，由 G2 的调用面闭合负责）。 */
    [APP, 'startScriptKillFlow', 1],
    [SK_VIEW, 'startScriptKillFlow', 1],
    /* ⑤ 问答链的两处驱动（用户答题得见输入框 + 答完驱动 AI） */
    [LD_DATA, 'questionAwaitingUser', 1],
    [LD_VIEW, 'questionAwaitingUser', 1],
    [APP, '_ludoResumeQuestion', 4],
    /* 模式表与事件词表：起手零消费（dead-export 门当场报红），本版补真消费。 */
    [APP, 'LUDO_EVENT_SET', 2],
    [APP, 'ludoModeLabel', 2],
    [LD_DATA, 'ludoModeLabel', 1],
    [LD_VIEW, 'ludoModeLabel', 1],
];
/* 本版删掉的死形态：不许再回来（只写不读 = 看起来有守卫）。 */
const LIVE_DEAD = [
    /* 起手那版的夹具注入口（class 方法覆盖不到模块内函数，永远进不去） */
    [SK_DATA, '__setFixtureScript'],
    /* 起手那版视图里硬写两遍的模式文案（已统一走数据层） */
    [LD_VIEW, "'一起回答'"],
];
const countHits = (rel, needle) => {
    const src = rel === APP ? stripComments(read(rel)) : read(rel);
    return src.split(needle).length - 1;
};
test('E1 活性：本版修掉的五处功能级失效必须真有调用点（导出了不等于用上了）', () => {
    const bad = [];
    for (const [rel, need, atLeast] of LIVE_CHECKS) {
        const hits = countHits(rel, need);
        if (hits < atLeast) bad.push('dead:' + need + '@' + rel + '=' + hits);
    }
    assert.deepEqual(bad, [], '活性面不达标：' + bad.join(' , '));
});
test('E2 起手那两处死形态不许回来', () => {
    for (const [rel, dead] of LIVE_DEAD) {
        assert.equal(countHits(rel, dead), 0, rel + ' 不该再出现 ' + dead);
    }
});
/* ══════════════════════ H 样式与大厅卡片 ══════════════════════ */
const classNamesIn = (css, bare) => new Set(css.match(new RegExp('[.]' + bare + '[a-z0-9-]+', 'g')) || []);
test('H1 两份样式各自独占前缀，且互不出现在对方文件里（同批落地、互不复用）', () => {
    const sk = read(SK_CSS);
    const ld = read(LD_CSS);
    assert.ok(sk.includes('.sk-'), SK_CSS + ' 必须用 .sk- 前缀');
    assert.ok(ld.includes('.ld-'), LD_CSS + ' 必须用 .ld- 前缀');
    assert.equal(sk.includes('.ld-'), false, SK_CSS + ' 不得出现对方的 .ld- 前缀');
    assert.equal(ld.includes('.sk-'), false, LD_CSS + ' 不得出现对方的 .sk- 前缀');
    /* 本件样式是 JS 自注入（与本仓「样式投递」表的第三类一致）。 */
    for (const [viewRel, cssId] of [[SK_VIEW, 'scriptkill-css'], [LD_VIEW, 'ludo-css']]) {
        assert.ok(read(viewRel).includes(`document.getElementById('${cssId}')`),
            viewRel + ' 必须按 id 幂等注入样式（' + cssId + '）');
    }
});
test('H2 视图产出的每个类名都有样式落点或选择器锚点', () => {
    for (const [viewRel, cssRel, bare] of [[SK_VIEW, SK_CSS, 'sk-'], [LD_VIEW, LD_CSS, 'ld-']]) {
        const view = read(viewRel);
        const css = read(cssRel);
        const js = view + read(APP);
        const cssNames = classNamesIn(css, bare);
        const anchors = new Set();
        for (const m of js.matchAll(/(?:querySelector(?:All)?)\s*\(\s*['"]([^'"]*)['"]/g)) {
            for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
        }
        for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
        /* 第三类落点：`phoneShell.setContent(html, '<token>')` 的屏名 token
         * （本仓惯例 `<app>-<screen>`，屏名会落在容器类上）。 */
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
test('H3 大厅两张卡片在场、绑了点击，且配色与图标有样式落点', () => {
    const view = read(POKER_VIEW);
    const css = read(POKER_CSS);
    for (const id of ['games-open-scriptkill', 'games-open-ludo']) {
        assert.equal(view.split(`id="${id}"`).length - 1, 1, POKER_VIEW + ' 必须恰有一张卡片：' + id);
        assert.ok(view.includes(`getElementById('${id}')?.addEventListener('click'`),
            POKER_VIEW + ' 必须给 ' + id + ' 绑点击');
    }
    assert.ok(view.includes('this.app.openScriptKill()'), '剧本杀卡片必须调 openScriptKill');
    assert.ok(view.includes('this.app.openLudo()'), '飞行棋卡片必须调 openLudo');
    /* 卡片配色与图标必须有落点（没有就是光秃方块）。 */
    for (const cls of ['games-scriptkill-card', 'games-scriptkill-lobby-art',
        'games-ludo-card', 'games-ludo-lobby-art']) {
        assert.ok(css.includes('.' + cls + ' {') || css.includes('.' + cls + '{'),
            POKER_CSS + ' 必须给 .' + cls + ' 样式落点');
    }
});
/* ══════════════════════ I 键归属 ══════════════════════ */
test('I1 两条会话键必须在 keys 门账本里登记且 scope=chat，且精确枚举面在场', () => {
    const audit = read('scripts/keys-audit.mjs');
    const storage = read('config/storage.js');
    for (const key of ['chat_games_scriptkill_state', 'chat_games_ludo_state']) {
        assert.equal(audit.split(`key: '${key}'`).length - 1, 1,
            '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次（不登记不报错，只是换会话串味）');
        assert.ok(new RegExp("\\{ key: '" + key + "', scope: 'chat'").test(audit),
            '键 ' + key + ' 必须是会话隔离（scope: chat）');
        assert.ok(storage.includes('/^' + key + '$/'),
            'storage 的精确枚举面必须列出 ' + key + '（评审面：一眼可数）');
    }
    assert.ok(storage.includes('/^chat_games_/'), '宽匹配族必须在（新子游戏自动接住）');
    /* 每条键必须真被产品消费（不是账本里空挂）。 */
    assert.ok(read(SK_DATA).includes("'chat_games_scriptkill_state'"), SK_DATA + ' 必须真用这条键');
    assert.ok(read(LD_DATA).includes("'chat_games_ludo_state'"), LD_DATA + ' 必须真用这条键');
    /* ★ 两个存储键不许互换（互换了照样跑，只是两件共享同一份状态）。 */
    assert.equal(read(SK_DATA).includes('chat_games_ludo_state'), false, SK_DATA + ' 不得引用飞行棋的键');
    assert.equal(read(LD_DATA).includes('chat_games_scriptkill_state'), false, LD_DATA + ' 不得引用剧本杀的键');
});
/* ══════════════════════ J 负控制 ══════════════════════ */
/** 破坏表集中一处：K2 会拿它做「锚点在场性 + 替换保真」的批量自证。
 *  ★ 锚点一律取**代码行**（不取注释），一律用字面 split/join（不用 String.replace，
 *    避免 `$&` 被解释）。每条都必须恰中 1 次（本轮实测：`if (isLudoEventCell(result.to)) {`
 *    在 APP 里出现 2 次 ⇒ 不能进表，改取唯一的那一条）。 */
const DAMAGE = {
    /* ① 搜证上限退回「本阶段新增额度」比跨轮累计计数器（起手那处真缺陷） */
    s1: [SK_DATA,
        'return Math.max(0, this.searchCapOf(phase) - this.searchCountOf(playerId));',
        'return Math.max(0, this.searchAllowance(phase) - this.searchCountOf(playerId));'],
    /* ② 可用线索不再含「自己的私人物品」（归属助手拿不到角色名） */
    s2: [SK_DATA,
        'const mine = privateOwnerOf(player);',
        'const mine = privateOwnerOf({});'],
    /* ③ 「关于自己」恒假（藏不藏线索的判据失效） */
    s3: [SK_DATA,
        "return String(clue?.owner || '').trim() === privateOwnerOf(player);",
        'return false;'],
    /* ④ 日志不再封顶 */
    s4: [SK_DATA,
        'if (log.length > MAX_LOG) {',
        'if (false) {'],
    /* ⑤ 平票也算命中（「唯一最高票」退化成「最高票之一」） */
    s5: [SK_DATA,
        'const hit = !!killer && topIds.length === 1 && topIds[0] === killer.id;',
        'const hit = !!killer && topIds.length >= 1 && topIds.includes(killer.id);'],
    /* ⑥ 归属助手按**昵称**匹配（起手那处真形态） */
    s6: [SK_DATA,
        "return String(player?.roleName || '').trim();",
        "return String(player?.name || '').trim();"],
    /* ⑦ 起点掷骰退回「一次取样两处复用」⇒ 1、2 永远掷不出（起手那处真缺陷） */
    l1: [LD_DATA,
        'if (fromStart && Number(rng()) < 0.5) return 6;\n    return Math.floor(Number(rng()) * (fromStart ? 5 : 6)) + 1;',
        'const draw = Number(rng());\n    if (fromStart && draw < 0.5) return 6;\n    return Math.floor(draw * (fromStart ? 5 : 6)) + 1;'],
    /* ⑧ 越过终点不再判胜 */
    l2: [LD_DATA,
        'if (next >= LUDO_FINAL_INDEX) {',
        'if (false) {'],
    /* ⑨ 踩到对方不再踢回起点 */
    l3: [LD_DATA,
        'this.state.positions[opponent.id] = LUDO_START_POSITION;',
        'void 0;'],
    /* ⑩ 结束后还能再行动 */
    l4: [LD_DATA,
        "return numOrNull(dice) === 6 && this.state.phase === 'playing';",
        'return numOrNull(dice) === 6;'],
    /* ⑪ 飞行棋日志不再封顶 */
    l5: [LD_DATA,
        'if (log.length > MAX_LOG) {',
        'if (false) {'],
    /* ⑫ 起点非 6 也能「起飞」 */
    l6: [LD_DATA,
        "if (value !== 6) return { type: 'blocked', dice: value, from, to: from, kicked: null, winner: null };",
        "if (false) return { type: 'blocked', dice: value, from, to: from, kicked: null, winner: null };"],
    /* ⑬ 开局驱动**改名**⇒ 视图的调用面断裂（起手那处真缺陷的形状） */
    a2: [APP,
        'async startScriptKillFlow() {',
        'async startScriptKillFlowRenamed() {'],
    /* ⑭ 模式分派不再查表（模式表退回零消费） */
    a3: [APP,
        "const isBothAnswer = LUDO_QUESTION_TYPES.some(item => item.value === mode && item.value === 'both_answer');",
        'const isBothAnswer = true;'],
};
function chr96() { return String.fromCharCode(96); }
/** num-gate 的等价桩（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';
/**
 * 造一份破坏副本并**落盘**（只写文件，不加载）。
 * ★ 副本按**真目录结构**建：数据层写的是 `../../../config/num-gate.js`，
 *   摊在 <tmp> 根下会解析错位置、首跑即 ERR_MODULE_NOT_FOUND（与破坏无关的假红）。
 *   `apps/games/games-app.js` 的**上一层就叫 `games`**（与散件同名）—— 所以编排层的
 *   副本一律只做「字符串层面」的结构面判据，不 import（一 import 就会去找
 *   `apps/games/games/poker/poker-app.js`，报一堆与破坏无关的模块解析错）。
 */
function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3330_'));
    const relDir = path.dirname(rel);            // 例：apps/games/scriptkill
    const target = path.join(dir, relDir, path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return { target, src: damaged };
}
async function loadDamagedCopy(rel, from, to) {
    const { target, src } = writeDamagedCopy(rel, from, to);
    return { mod: await import(pathToFileURL(target).href), src };
}
/** APP 侧的两条**结构面**判据（与 F2 / G1 同款，放在这里便于对破坏源码直接跑）。 */
const appStructureProblems = (src) => {
    const bad = [];
    if (!src.includes('async startScriptKillFlow(')) bad.push('missing-startScriptKillFlow');
    if (!src.includes('this.advanceScriptKill()')) bad.push('missing-advance-scriptkill');
    if (!src.includes('this.scriptKillView.renderGame()')) bad.push('missing-scriptkill-render');
    return bad;
};
const appModeProblems = (src) => {
    const bad = [];
    if (!src.includes('LUDO_QUESTION_TYPES.some(')) bad.push('mode-table-unused');
    if (!src.includes('ludoModeLabel(')) bad.push('mode-label-unused');
    return bad;
};
const NEG = [
    ['J1 破坏「搜证累计上限」⇒ 内核判据必须转红', 's1', 'sk', skProblems, ['cap-round2-remaining', 'cap-round2-can-search']],
    ['J2 破坏「可用线索含自己的私人物品」⇒ 内核判据必须转红', 's2', 'sk', skProblems, ['clue-visible-missing']],
    ['J3 破坏「关于自己」判据 ⇒ 内核判据必须转红', 's3', 'sk', skProblems, ['about-self']],
    ['J4 破坏「日志封顶」⇒ 内核判据必须转红', 's4', 'sk', skProblems, ['log-cap']],
    ['J5 破坏「唯一最高票」⇒ 内核判据必须转红', 's5', 'sk', skProblems, ['vote-tie-no-win']],
    ['J6 破坏「归属按角色名匹配」⇒ 内核判据必须转红', 's6', 'sk', skProblems, ['owner-helper-roleName']],
    ['J7 破坏「起点两次独立取样」⇒ 内核判据必须转红', 'l1', 'ld', ludoProblems, ['takeoff-two', 'takeoff-one']],
    ['J8 破坏「越过终点判胜」⇒ 内核判据必须转红', 'l2', 'ld', ludoProblems, ['overshoot-blocked']],
    ['J9 破坏「踩人踢回起点」⇒ 内核判据必须转红', 'l3', 'ld', ludoProblems, ['kick-sends-home']],
    ['J10 破坏「结束后不再行动」⇒ 内核判据必须转红', 'l4', 'ld', ludoProblems, ['ended-no-extra-roll']],
    ['J11 破坏「飞行棋日志封顶」⇒ 内核判据必须转红', 'l5', 'ld', ludoProblems, ['ludo-log-cap']],
    ['J12 破坏「起点非 6 不能起飞」⇒ 内核判据必须转红', 'l6', 'ld', ludoProblems, ['start-needs-six']],
    ['J13 破坏「开局驱动方法名」⇒ 结构面判据必须转红', 'a2', 'app', appStructureProblems, ['missing-startScriptKillFlow']],
    ['J14 破坏「模式分派查表」⇒ 结构面判据必须转红', 'a3', 'app', appModeProblems, ['mode-table-unused']],
];
const REAL_MODS = { sk: REAL_SK, ld: REAL_LD };
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        /* 编排层只做结构面（不 import 副本，见 writeDamagedCopy 的说明）。 */
        const { mod, src } = kind === 'app'
            ? (() => { const w = writeDamagedCopy(rel, from, to); return { mod: null, src: w.src }; })()
            : await loadDamagedCopy(rel, from, to);
        const bad = kind === 'app' ? judge(src) : judge(kind === 'sk' ? skApiOf(mod) : ludoApiOf(mod));
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        /* 对照：真实现必须干净（否则「转红」可能只是因为判据本来就红 —— 假绿三形之一）。 */
        const clean = kind === 'app' ? judge(read(rel)) : judge(REAL_MODS[kind]);
        assert.deepEqual(clean, [], '对照：真实现必须干净');
    });
}
/* ══════════════════════ K ── 判据工具自证 ══════════════════════ */
test('K1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：F1 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会更绿 —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「负控制假绿」三形之一。所以必须两向都钉：剥对了 + 没多剥。 */
    const q = chr96();
    assert.equal(stripComments('a /* 注释里的 Dexie */ b').includes('Dexie'), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 Dexie\nb').includes('Dexie'), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 Dexie';").includes('Dexie'), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 Dexie' + q + ';').includes('Dexie'), true, '模板串里的必须留住');
    assert.equal(stripComments('a = "带 \\" 转义的 Dexie";').includes('Dexie'), true, '转义串不许被误断');
    /* 尾随哨兵：真件每一份审到的文件都必须能把「文件尾的注释」剥掉。 */
    for (const rel of [APP, SK_DATA, SK_VIEW, LD_DATA, LD_VIEW]) {
        const src = read(rel);
        const sentinel = stripComments(src + '\n/* RP_TAIL_3330 */\n');
        assert.equal(sentinel.includes('RP_TAIL_3330'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});
test('K2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, key + ' 的锚点必须恰中 1 次（实测 ' + hits + '）');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        /* ★ 锚点必须在**代码里**：若它落在注释里，破坏改的是说明文，
         *   行为一点不变 —— 判据却可能因为别的原因转红（假绿三形之「对原文件断言」的变体）。 */
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        /* 替换必须真的发生且保真（无残留、无重复插入）。 */
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        assert.ok(damaged.includes(to), key + ' 替换后必须出现新串');
        /* 破坏后的源码必须仍是**合法 JS**（否则 J 的「转红」会来自语法错而非行为变）。 */
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3330k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split('\n')[0]);
    }
});
/* ══════════════════════ L ── 版本锚 ══════════════════════ */
test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 33),
        '本套件成立于 RubyPhone 3.33.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.33.0 游戏厅下半），不是「当版」——
     *   本仓已有四处「守别人的版」的口径错（v3270 / v3280 / v3290 / v3300），
     *   均在下一版当场报红。 */
    const SELF = '3.33.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['剧本杀', '飞行棋', '搜证', '归属', '起点', '零消费']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'),
        '本版条目必须如实登记批次纪律（只跑单套件）');
});
/* ══ 追加段锚：V3330_SECTION_4 ══ */