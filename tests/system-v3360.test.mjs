// tests/system-v3360.test.mjs — 杂志 [v3.36.0]
//
//   本版接的是素材缝合路线图 **第 2 层第七件（也是末件）：杂志**。源侧是 Perigee 的
//   `js/magazine.js`（1971 行 / 118212 字节）+ `magazine.css`（20050 字节）——
//   一个挂在宿主全局 `AppState.data.magazineData` 上（切角色串味）、以 `Utils.saveData`
//   整块回写（13 处命中）、与放送局 / 论坛 / TTS 三处联动的**日文动画杂志仿真**：
//   ① 十种稿件类型 ② 列表与阅读面 ③ 十套正文解析器 ④ 四套导出 ⑤ 译文折叠块 ⑥ 联动面。
//
//   ★ 取六块 / 四处不缝 / 三条偏离（逐条写在 magazine-data.js 文件头，此处只留判据面）：
//     取：① 十种稿件类型 ② 列表与阅读面 ③ 十套正文解析（**提成唯一实现**）
//         ④ 四套导出（TXT 与可打印结构，不产二进制）⑤ 译文折叠块 ⑥ 分享文本。
//     不缝：① 源有 **8 处 `Utils.callChatAPI`** 自己拼 systemPrompt 自己解析 `TITLE:` 行
//             —— 本件零网络调用，只产「可复制的要求文本」，结果由用户贴回来登记；
//           ② 源把整块状态经 `Utils.saveData` 回写、`Utils.emitEvent('magazine_published')`
//             往宿主事件总线抛（8 处）、读 `AppState.data.broadcast.officialNpcs`
//             —— 本件零宿主写入零宿主读；
//           ③ 源要别的 App 的池（放送局官方 NPC / 论坛世界观 / `ttsConfig`）
//             —— 本件自带 10 位原创受访者池，零跨 App 读；
//           ④ 源 `exportImage()` 从 jsdelivr CDN **动态插 `<script>`** 拉 html2canvas、
//             把离屏 DOM 画成 PNG data URL —— 本件一条外链都不收、一张图都不产。
//     偏离：期号收成**登记时写下的序号**（源 `findIndex+1` 反查 ⇒ 删中间一篇后
//           后面所有篇期号集体前移，旧导出与新读数对不上）/
//           正文解析收成**唯一实现**（源十套解析器各写一遍、同一行在不同类型下归类不同，
//           且没有任何一处能回答「这行到底被认出来了吗」）/
//           译文按**段落数组**存（源把整段转义后塞 `innerHTML`，译文里的标签全变可见字符）。
//
//   ★ 本版抓到**两处真缺陷**（都不是自述，由门禁当场报红）：
//     ① **三处零消费导出**（`dead-exports` 门报红）：`MAGAZINE_NPC_TYPES` 是
//        `MAGAZINE_INTERVIEW_TYPES.slice()` 的**同义副本**（第二个真源，删除）；
//        `MAGAZINE_ARROW_KINDS` 与 `MAGAZINE_BLOCK_KINDS` 建好了零消费 ——
//        真接线（视图 marker 表用前者当键面、解析器用后者做产出白名单校验）。
//        **不是塞进冻结账本**。
//     ② **视图 `AGO_TEXT` 手写标识符形键**（本仓 J7 形态）：五个键手写了一遍，
//        而它们本是数据层 `timeAgoFace()` 的产出 ⇒ 数据层多一个单位，视图**静默走兜底**
//        （显示「时间不详」）而不报错。修法 = 提真源 `MAGAZINE_TIME_UNITS` + 计算键 +
//        数据层用它做产出白名单（三处一起）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 内核：十型闭合 / 期号是**事实**不是位置（删中间一篇不许改别人的期号）/
//       坏号即 null 且不许补位置号 / 撞号如实回报 / 截断如实回报；
//     B 解析：十套解析器**同一份实现** / 「没认出来」与「正文是空的」不许同形 /
//       对谈空名落旁白 / 关系图兜底上收为所有类型共用 / 块 kind 白名单校验；
//     C 接线：三条键随会话隔离 / 七处接线落点到位 / 重绑表在册 / 视图调用面闭合；
//     D 通道：不碰模型 / 不碰宿主对象 / 不跨 App 读 / 不收外链 / 不产二进制；
//     E 活性：本版修的零消费导出必须有真调用点；手写键不许回潮；
//     F 视图面闭合：视图调用的 App 方法在 App 上全都在（差集必须为空）；
//     G 视图契约：期号直接读字段（不许 index+1）/ 受访者缺人必须可见 /
//       译文走段落数组（不拼整段 HTML）；
//     H 键归属：三条会话键登记 scope=chat / 宽匹配族在场 / 三条键真被产品消费；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向 / 破坏表锚点在场（恰 1 次）且替换保真 / 替换后仍是合法 JS；
//     K 单一真源：类型人话表不手写键 / 企划模板表不手写键 / 时间单位表不手写键；
//     L 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据函数一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/magazine/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），否则相对 import
//   会解析错位置、首跑即假红；App 侧的编排断言只做**结构面**（不加载副本）。
//   ★ 判据纯度：负控制层里的锚点字面量**只准声明一次**（在 DAMAGE 表里），
//     判据函数不得引用破坏串（否则破坏一改，判据跟着变 ⇒ 假绿三形之三）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/magazine/magazine-data.js';
import { MagazineApp } from '../apps/magazine/magazine-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MG_DATA = 'apps/magazine/magazine-data.js';
const MG_APP = 'apps/magazine/magazine-app.js';
const MG_VIEW = 'apps/magazine/magazine-view.js';
const MG_CSS = 'apps/magazine/magazine.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释（字符状态机，与 v3300 / v3310 / v3320 / v3330 / v3340 / v3350 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头与源码注释逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`callChatAPI`、`AppState`、`html2canvas`…）是
 *    **说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）：被审代码里一旦出现**裸的引号或反引号**，
 *    剥器会把正则正文当成字符串/模板串的起头。故 J1 用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
/** 内存假存储：`key -> 字符串`。视图/App 只经 `storage.get/set`，与真件同形。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 `/^magazine_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致（`magazine_`）—— 抄别版的前缀会把「换会话后读到别人数据」
 *    这条判据测成空气（假绿三形之一）。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
        _box: box,
    };
}
/** 造一篇**完整可读**的稿件（登记 → 返回 `{ app, id, st }`）。 */
function fixtureArticle(opts) {
    const o = opts || {};
    const st = memStorage(o.seed || {});
    const app = new MagazineApp(null, st);
    app.probe();
    const r = app.ingest({
        type: o.type || 'seiyuu',
        theme: o.theme || '新曲收录现场',
        peopleIds: o.peopleIds || ['mg-p1', 'mg-p3'],
        featureKey: o.featureKey,
        response: o.response || ('TITLE: 白石遥 单独访谈\n―― 这次的新曲是什么样的？\n白石 遥：是一首很安静的歌。\n―― 录音时有什么讲究吗？\n黑川 悟：我们把弦乐放在了最后录。'),
    });
    return { app, id: r.article ? r.article.id : '', st, r };
}
/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 十型闭合：类型清单、人话表、配色表三处键面逐一对齐', () => {
    assert.equal(DAT.MAGAZINE_TYPES.length, 10, '源的十种稿件类型必须都在（少一型就是丢功能）');
    assert.deepEqual(Object.keys(DAT.MAGAZINE_TYPE_LABELS), DAT.MAGAZINE_TYPES,
        '人话表的键必须与类型清单同序同面 —— 手写键就是桥契约门 J7 立据的那个形态');
    assert.deepEqual(Object.keys(DAT.MAGAZINE_TYPE_COLORS), DAT.MAGAZINE_TYPES,
        '配色表同理（十型各有色，缺一型就落兜底色）');
    for (const t of DAT.MAGAZINE_TYPES) {
        assert.equal(typeof DAT.MAGAZINE_TYPE_LABELS[t], 'string', '每一型都要有人话：' + t);
        assert.ok(/^#[0-9a-f]{6}$/i.test(DAT.MAGAZINE_TYPE_COLORS[t]), '每一型都要有合法色值：' + t);
    }
    assert.deepEqual(DAT.MAGAZINE_INTERVIEW_TYPES, ['seiyuu', 'staff', 'roundtable'],
        '访谈系列三型必须与源口径一致（源在三处各写一遍同一数组）');
    for (const t of DAT.MAGAZINE_INTERVIEW_TYPES) {
        assert.ok(DAT.MAGAZINE_TYPES.includes(t), '访谈系列必须是十型的子集：' + t);
    }
});
test('A2 期号是**事实**不是位置：删掉中间一篇不许改别人的期号', () => {
    const st = memStorage();
    const app = new MagazineApp(null, st);
    app.probe();
    const a = app.ingest({ type: 'column', theme: 'A', response: 'TITLE: A\n正文甲' });
    const b = app.ingest({ type: 'column', theme: 'B', response: 'TITLE: B\n正文乙' });
    const c = app.ingest({ type: 'column', theme: 'C', response: 'TITLE: C\n正文丙' });
    assert.equal(a.article.vol, 1);
    assert.equal(b.article.vol, 2);
    assert.equal(c.article.vol, 3);
    /* 删中间那篇 —— 源在这里会让 C 的期号从 3 掉到 2（`findIndex+1` 反查）。 */
    app.removeArticle(b.article.id);
    const ca = app.articleById(c.article.id);
    assert.equal(ca.vol, 3, '删掉别人不许改这一篇的期号（期号是事实，不是数组位置）');
    /* 新登记的一篇必须是 4（最大期号 + 1），不是「长度 + 1」= 3（会与 C 撞号）。 */
    const d = app.ingest({ type: 'column', theme: 'D', response: 'TITLE: D\n正文丁' });
    assert.equal(d.article.vol, 4, '新篇期号必须是「现有最大 + 1」，不是「长度 + 1」（否则撞号）');
    assert.equal(d.volConflict, false, '这一篇不许撞号');
});
test('A3 坏号即 null、不许补位置号；0 是合法期号；撞号如实回报', () => {
    assert.equal(DAT.normalizeArticle({ title: 'x', vol: 'nope' }, 4).vol, 5,
        '坏期号走「下标 + 1」的缺省（与 pixiv 的章号口径同族：缺省可以补，但**给定值不许篡改**）');
    assert.equal(DAT.normalizeArticle({ title: 'x', vol: 0 }, 0).vol, 1,
        '期号下界是 1（期号语义上从 1 起；给 0 夹到 1，不许留 0 —— 与章号「0 合法」不同族，这里写明）');
    assert.equal(DAT.normalizeArticle({ title: 'x', vol: -5 }, 0).vol, 1, '负数夹到 1');
    assert.equal(DAT.normalizeArticle({ title: 'x', vol: 1.9 }, 0).vol, 1, '小数取整');
    /* 撞号：两条同期号 ⇒ 后者如实回报，不许静默覆盖前者。 */
    const m = DAT.normalizeMagazine({
        magazineName: 'M',
        articles: [{ title: 'a', vol: 1, content: 'x' }, { title: 'b', vol: 1, content: 'y' }],
    });
    assert.equal(m.articles.length, 1, '撞号的那条不许进来（不许覆盖、也不许两条同号并存）');
    assert.deepEqual(m.volConflicts, [1], '撞号必须如实回报（源 `_getVolNum` 连位置都会算错）');
});
test('A4 截断如实回报：标题 / 主题 / 正文 / 译文四处都有上界且都报数', () => {
    const L = DAT.MAGAZINE_LIMITS;
    assert.ok(L.maxTitleChars > 0 && L.maxBodyChars > 0 && L.maxTranslationChars > 0 && L.maxThemeChars > 0,
        '四处上界都必须存在（源这四处全是无界增长）');
    const long = 'あ'.repeat(L.maxTitleChars + 30);
    const a = DAT.normalizeArticle({ title: long, content: 'x' }, 0);
    assert.equal(a.title.length, L.maxTitleChars, '标题必须被截到上界');
    assert.equal(a.trimmed, 30, '裁掉多少必须如实回报（不静默吞）');
    const t = DAT.takeText('abcdef', 3);
    assert.deepEqual(t, { text: 'abc', trimmed: 3 }, 'takeText 两向都要对');
    assert.deepEqual(DAT.takeText('ab', 3), { text: 'ab', trimmed: 0 }, '没裁到时 trimmed 必须是 0');
});
test('A5 设置面：坏值走缺省、好值原样留（源把语言混在 I18n 里，本件显式成一格）', () => {
    const d = DAT.defaultMagazineSettings();
    assert.equal(d.magazineName, DAT.MAGAZINE_DEFAULT_NAME);
    assert.equal(d.bodyLanguage, 'jp');
    assert.equal(d.defaultType, 'seiyuu');
    const n = DAT.normalizeMagazineSettings({ magazineName: '  ', bodyLanguage: 'xx', defaultType: 'nope' });
    assert.equal(n.magazineName, DAT.MAGAZINE_DEFAULT_NAME, '空白名字走缺省');
    assert.equal(n.bodyLanguage, 'jp', '非法语言走缺省（不是「保持原样」）');
    assert.equal(n.defaultType, 'seiyuu', '非法类型走缺省');
    const k = DAT.normalizeMagazineSettings({ magazineName: 'Newtype', bodyLanguage: 'cn', defaultType: 'poll' });
    assert.equal(k.magazineName, 'Newtype');
    assert.equal(k.bodyLanguage, 'cn');
    assert.equal(k.defaultType, 'poll', '好值必须原样留');
});
test('A6 受访者：查不到人必须如实回报（源 `filter(Boolean)` 整条抹掉）', () => {
    const r = DAT.resolvePeople(['mg-p1', 'ghost', 'mg-p3'], DAT.MAGAZINE_BUILT_IN_PEOPLE);
    assert.equal(r.names.length, 2, '查得到的两位都在');
    assert.deepEqual(r.missing, ['ghost'], '查不到的必须**如实列出来**（不许静默抹掉）');
    assert.ok(r.display.includes('×'), '显示名用 × 连接（源口径）');
    assert.ok(r.display.includes('白石 遥'), '显示名必须含角色名');
    assert.equal(DAT.resolvePeople([], DAT.MAGAZINE_BUILT_IN_PEOPLE).display, '', '空输入给空串');
    assert.deepEqual(DAT.resolvePeople(null, null).missing, [], '坏输入不抛');
    assert.equal(DAT.MAGAZINE_BUILT_IN_PEOPLE.length, 10, '内置 10 位（源要宿主池，本件自带）');
});
test('A7 空态三态分开：storage_absent / empty / ok 互不同形', () => {
    const R = DAT.MAGAZINE_REASONS;
    assert.equal(DAT.emptyFace(R.storage_absent).reason, R.storage_absent);
    assert.equal(DAT.emptyFace(R.storage_absent).canWrite, false, '读不出来时不许说「可以写」');
    assert.equal(DAT.emptyFace(R.empty).canWrite, true, '空但可用时可以写');
    assert.equal(DAT.emptyFace(R.ok).canWrite, true);
    assert.notEqual(DAT.emptyFace(R.empty).canWrite, DAT.emptyFace(R.storage_absent).canWrite,
        '「还没有稿件」与「读不出来」**不许同形**（源把全部状态挂内存，从没区分过）');
    assert.equal(DAT.emptyFace('nope').reason, R.empty, '未识别状态走 empty 缺省');
});
/* ══════════════════════ B — 解析面 ══════════════════════ */
test('B1 十套解析器是**同一份实现**：按类型分发，块类型逐条对得上', () => {
    const qa = DAT.parseArticleBody('seiyuu', '―― 问题\n白石 遥：回答');
    assert.deepEqual(qa.blocks.map((b) => b.kind), ['question', 'answer'],
        '访谈系列：―― 行是提问、「名：词」行是回答');
    const poll = DAT.parseArticleBody('poll', '1位　白石 遥　42.5%\n「太可爱了」');
    assert.deepEqual(poll.blocks.map((b) => b.kind), ['rank', 'comment'], '投票：名次行 + 评语行');
    assert.equal(poll.blocks[0].rank, 1, '名次必须是数字 1（源 parseInt 后 || 0 会把坏号吞成 0）');
    const feat = DAT.parseArticleBody('feature', '◆ 白石 遥\n包里放着乐谱。');
    assert.deepEqual(feat.blocks.map((b) => b.kind), ['card', 'cardline'], '企划：◆ 行是卡头、其余是卡内行');
    const reader = DAT.parseArticleBody('reader', '来信 第一封\n正文\n回信 编辑部\n回复');
    assert.deepEqual(reader.blocks.map((b) => b.kind), ['letter', 'letter', 'reply', 'reply'],
        '读者来函：两个标记行各自开启一段（源按行首两个字符分流）');
    const talk = DAT.parseArticleBody('charatalk', '白石 遥「台词」\n旁白一句');
    assert.deepEqual(talk.blocks.map((b) => b.kind), ['talk', 'narration'], '对谈：台词行 + 旁白');
    const chart = DAT.parseArticleBody('chart', '◆ 白石 遥 → 黑川 悟：师徒\n※ 编者按');
    assert.deepEqual(chart.blocks.map((b) => b.kind), ['relation', 'note'], '关系图：关系行 + 编者按');
    const col = DAT.parseArticleBody('column', '第一段\n\n第二段');
    assert.deepEqual(col.blocks.map((b) => b.kind), ['prose', 'gap', 'prose'], '专栏：段落 + 空行');
    const rup = DAT.parseArticleBody('roundup', '本月总结');
    assert.deepEqual(rup.blocks.map((b) => b.kind), ['prose'], '月度总结走段落');
});
test('B2 「没认出来」与「正文是空的」**不许同形**（源十套里九套直接输出空 div）', () => {
    const empty = DAT.parseArticleBody('chart', '');
    /* ★ 口径：空正文按行 split 得 `['']` ⇒ 产一个 `gap` 块（源也这样产一个
     *   `magazine-qa-gap`）—— 判据守的是「**没有实质块**」，不是「一个块都没有」。 */
    assert.ok(empty.blocks.every((b) => b.kind === 'gap'),
        '空正文不许产实质块（只允许空行占位）：' + JSON.stringify(empty.blocks));
    assert.equal(empty.unknown, 0, '**空正文不算「没认出来」** —— 两个 0 的意义完全不同');
    const bad = DAT.parseArticleBody('chart', '◆ 这行不是合法关系\n◆ 这行也不是');
    assert.equal(bad.unknown, 2, '两条认不出来的 ◆ 行必须如实计数');
    assert.ok(bad.blocks.length >= 2, '认不出来的行必须**落成兜底块**（不许丢内容）');
    assert.ok(bad.blocks.every((b) => b.kind !== 'relation'), '认不出来就不许产关系块');
    const poll = DAT.parseArticleBody('poll', '1位　甲　50%\n这行既不是名次也不是评语');
    assert.equal(poll.unknown, 1, '投票里名次之后的杂行必须计进 unknown');
});
test('B3 块 kind 白名单校验：产出了一个没人认识的块必须计进 unknown（不许静默通过）', () => {
    assert.ok(Array.isArray(DAT.MAGAZINE_BLOCK_KINDS) && DAT.MAGAZINE_BLOCK_KINDS.length >= 10,
        '块类型表必须在场（本件把它当产出白名单用）');
    const p = DAT.parseArticleBody('seiyuu', '―― 问\n甲：答');
    for (const b of p.blocks) {
        assert.ok(DAT.MAGAZINE_BLOCK_KINDS.includes(b.kind), '产出的每一块都必须在白名单内：' + b.kind);
    }
    assert.equal(p.stray, 0, '干净输入下 stray 必须是 0');
});
test('B4 对谈空名落旁白（源正则会命中并给出空名 ⇒ 视图画出一个空名字）', () => {
    const t = DAT.parseTalkLine('「只有台词没有名字」');
    assert.equal(t, null, '只有台词的行不许判成台词（源会给出空名）');
    const ok = DAT.parseTalkLine('白石 遥「正常台词」');
    assert.deepEqual(ok, { name: '白石 遥', dialogue: '正常台词' });
    const br = DAT.parseTalkLine('[白石 遥]「方括号写法」');
    assert.deepEqual(br, { name: '白石 遥', dialogue: '方括号写法' }, '方括号写法也必须认');
    const blocks = DAT.parseArticleBody('charatalk', '「只有台词」');
    assert.deepEqual(blocks.blocks.map((b) => b.kind), ['narration'], '空名行必须落旁白');
});
test('B5 关系图兜底上收为所有类型共用 + 节点上限如实计数', () => {
    const fb = DAT.chartFallback(DAT.parseArticleBody('chart', '◆ 认不出来的行\n普通行').blocks);
    assert.deepEqual(fb, ['◆ 认不出来的行', '普通行'], '兜底必须把原文按行给回去（不许空显示）');
    /* 节点上限：造 15 个节点，上限 12 ⇒ 丢 3 个节点、相关边一并丢，如实报数。 */
    const lines = [];
    for (let i = 0; i < 15; i++) lines.push('◆ C' + i + ' → C' + (i + 1) + '：关系' + i);
    const g = DAT.chartGraph(DAT.parseArticleBody('chart', lines.join('\n')).blocks, 12);
    assert.equal(g.nodes.length, 12, '节点必须被上限夹住');
    assert.equal(g.droppedNodes, 4, '被丢的节点数必须如实回报（16 个不同名节点 - 12）');
    assert.ok(g.droppedEdges > 0, '涉及被丢节点的边也必须一并丢并计数');
    assert.ok(g.edges.every((e) => g.nodes.includes(e.from) && g.nodes.includes(e.to)),
        '留下的边两端都必须在留下的节点里（否则画出悬空线）');
    assert.equal(Object.keys(g.colors).length, g.nodes.length, '每个留下的节点都要有配色');
});
test('B6 关系图坐标是纯函数：节点落在画布内、空输入不抛', () => {
    const pos = DAT.chartPositions(['A', 'B', 'C'], 360, 300);
    assert.equal(Object.keys(pos.positions).length, 3);
    for (const k of Object.keys(pos.positions)) {
        const p = pos.positions[k];
        assert.ok(p.x >= 0 && p.x <= 360, 'x 必须在画布内：' + k);
        assert.ok(p.y >= 0 && p.y <= 300, 'y 必须在画布内：' + k);
    }
    const e = DAT.chartPositions([], 360, 300);
    assert.deepEqual(e.positions, {}, '空节点给空坐标');
    const bad = DAT.chartPositions(null, 'x', null);
    assert.ok(bad.width >= 1 && bad.height >= 1, '坏画布尺寸走缺省，不许产 0 宽画布');
});
test('B7 标题拆分：TITLE 行两向都要对（源八条链路用同一对正则）', () => {
    const s = DAT.splitTitleAndBody('TITLE: 白石遥 单独访谈\n―― 问题\n甲：答');
    assert.equal(s.title, '白石遥 单独访谈');
    assert.ok(s.body.startsWith('―― 问题'), '正文必须从 TITLE 行的下一行起');
    assert.equal(s.body.includes('TITLE'), false, '正文里不许残留 TITLE 行');
    const noTitle = DAT.splitTitleAndBody('没有标题行\n正文');
    assert.equal(noTitle.title, '', '没有 TITLE 行时标题是空串（调用方用主题兜底）');
    assert.equal(noTitle.body, '没有标题行\n正文', '没有 TITLE 行时正文原样');
    const md = DAT.splitTitleAndBody('**TITLE:** **加粗标题**\n正文');
    assert.equal(md.title, '加粗标题', 'TITLE 行的 Markdown 记号必须被剥掉');
});
test('B8 译文段落：按空行切段、坏输入给空数组（源把整段转义后塞 innerHTML）', () => {
    const p = DAT.translationParagraphs('第一段\n\n第二段\n\n\n第三段');
    assert.deepEqual(p, ['第一段', '第二段', '第三段'], '空行切段、多空行不产空段');
    assert.deepEqual(DAT.translationParagraphs(''), [], '空译文给空数组');
    assert.deepEqual(DAT.translationParagraphs(null), [], 'null 给空数组（不抛）');
    assert.deepEqual(DAT.translationParagraphs('只有一段'), ['只有一段']);
});
/* ══════════════════════ C — 接线面 ══════════════════════ */
test('C1 三条会话键随会话隔离：换会话读到的是自己的账', () => {
    const st = sessionStorage();
    const app = new MagazineApp(null, st);
    app.probe();
    app.ingest({ type: 'column', theme: 'C1 的稿', response: 'TITLE: C1\n甲的正文' });
    assert.equal(app.articlesAll().length, 1, 'c1 里有一篇');
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.articlesAll().length, 0, '换到 c2 必须看不到 c1 的稿件（源把数据挂内存 ⇒ 串味）');
    app.ingest({ type: 'column', theme: 'C2 的稿', response: 'TITLE: C2\n乙的正文' });
    assert.equal(app.articlesAll().length, 1);
    assert.equal(app.articlesAll()[0].theme, 'C2 的稿', 'c2 里必须是 c2 自己的稿');
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.articlesAll().length, 1, '换回 c1 必须还能看到自己的那篇');
    assert.equal(app.articlesAll()[0].theme, 'C1 的稿');
});
test('C2 七处接线落点到位：注册 / 前缀 / 重绑 / 懒加载 / 键登记 / 目录映射 / 样式段', () => {
    const apps = read(APPS);
    assert.ok(apps.includes("id: 'magazine',"), 'config/apps.js 必须有注册条目');
    assert.ok(apps.includes("name: '杂志',"), '注册条目必须有名字');
    const storage = read(STORAGE);
    assert.ok(/\/\^magazine_\//.test(storage), 'config/storage.js 必须有会话键前缀');
    const idx = read(INDEX);
    assert.ok(idx.includes("'magazineApp'"), 'index.js 重绑表必须登记（有未提交草稿）');
    assert.ok(idx.includes("appId === 'magazine'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes('./apps/magazine/magazine-app.js'), '懒加载分支必须指对文件');
    assert.ok(read(KEYS).includes("key: 'magazine_settings'"), 'keys-audit 必须登记设置键');
    assert.ok(read(V255).includes("magazineApp: 'magazine'"), 'v255 目录映射必须在册');
    assert.ok(read('phone.css').includes('v3.36.0] 杂志'), 'phone.css 必须有本版段头');
});
test('C3 样式段头**独立成行**（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read('phone.css');
    const idx = css.indexOf('[v3.36.0] 杂志');
    assert.ok(idx > 0, '段头必须在场');
    const lineStart = css.lastIndexOf('\n', idx);
    assert.ok(css.slice(lineStart + 1, idx).startsWith('/*'), '段头必须从行首开始（前面只有 /*）');
    assert.equal(css[idx - 1] !== '\n' && css[lineStart + 1] === '/', true, '段头必须独立成行');
    const seg = read(MG_CSS);
    assert.ok(css.includes(seg.trim()), 'phone.css 里的样式段必须与源文件**逐字同源**');
});
test('C4 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const view = read(MG_VIEW);
    const app = new MagazineApp(null, memStorage());
    const calls = new Set();
    const re = /\bapp\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let m;
    while ((m = re.exec(view)) !== null) calls.add(m[1]);
    assert.ok(calls.size >= 12, '视图至少要调 12 个 App 方法（实测 ' + calls.size + '）');
    const missing = [];
    for (const c of calls) {
        if (typeof app[c] !== 'function') missing.push(c);
    }
    assert.deepEqual(missing, [], '视图调了但 App 上没有的方法（差集必须为空）：' + missing.join(' / '));
});
test('C5 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = read(MG_VIEW);
    const css = read(MG_CSS);
    const cls = new Set();
    /* ★ 先抹掉**拼接段**：`class="mgz-face mgz-face-' + meta.tone + '"` 这种写法里，
     *   正则会把 `mgz-face-'` / `meta.tone` 之类**片段**当成类名（假红）。
     *   拼接段一律以 `' + ` 起、以 ` + '` 止 —— 整段抹成空格再抓。 */
    const flat = view.replace(/'\s*\+[\s\S]*?\+\s*'/g, ' ');
    const re = /class="([^"]+)"/g;
    let m;
    while ((m = re.exec(flat)) !== null) {
        for (const c of m[1].split(/\s+/)) {
            if (c && !c.includes('+') && !c.startsWith('$')) cls.add(c);
        }
    }
    const missing = [];
    for (const c of cls) {
        if (!css.includes('.' + c)) missing.push(c);
    }
    assert.deepEqual(missing, [], '视图产出但样式里没有落点的类：' + missing.join(' / '));
});
/* ══════════════════════ D — 通道面 ══════════════════════ */
test('D1 不碰模型：三件里一个网络调用都没有（源 8 处 callChatAPI）', () => {
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['callChatAPI', 'fetch(', 'XMLHttpRequest', 'axios', 'WebSocket', 'EventSource']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
    }
});
test('D2 不碰宿主对象、不落数据库、不跨 App 读（源 13 处 saveData + 8 处 emitEvent）', () => {
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['AppState', 'Utils.saveData', 'Utils.emitEvent', 'officialNpcs',
            'getWorldContext', 'ttsConfig', 'indexedDB', 'localStorage', 'html2canvas']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
    }
});
test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['http://', 'https://', 'cdn.', 'data:image', '.png', '.jpg', '.webp', 'toDataURL']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
    }
    const css = stripComments(read(MG_CSS));
    assert.equal(css.includes('url('), false, '样式里不许有任何外部资源引用');
});
test('D4 不写宿主楼层、不整块回写：App 只有 storage.get/set 两个出口', () => {
    const code = stripComments(read(MG_APP));
    for (const bad of ['pushMessage', 'AppState', 'Utils.saveData', 'chat.history', 'saveChat']) {
        assert.equal(code.includes(bad), false, '不许出现：' + bad);
    }
    /* ★ `SillyTavern.getContext` 在 `_ctxNames()` 里是**本仓既有的安全取法**
     *   （`typeof` 判断 + try/catch，pixiv / lofter / date 同款）：只读宿主称呼、
     *   拿不到就用中性词。判据不许把它当「碰宿主对象」—— 判据过宽就是判据写歪。 */
    assert.ok(code.includes('_ctxNames'), '宿主称呼必须走那一个安全取法');
    assert.equal(/c\s*=\s*w\.SillyTavern\.getContext\(\)/.test(code), false,
        '不许绕过 typeof 判断直接取宿主对象');
});
/* ══════════════════════ E — 活性面 ══════════════════════ */
test('E1 本版修的零消费导出必须有真调用点（dead-exports 门报红的那三处）', () => {
    /* `MAGAZINE_NPC_TYPES` 已删（同义副本）—— 全仓不许再出现。 */
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        assert.equal(read(rel).includes('MAGAZINE_NPC_TYPES'), false,
            rel + ' 里不许再有同义副本 MAGAZINE_NPC_TYPES（它是第二个真源）');
    }
    /* `MAGAZINE_ARROW_KINDS` 必须在**产品侧**被真消费（视图的 marker 表）。 */
    const viewCode = stripComments(read(MG_VIEW));
    assert.ok(viewCode.includes('MAGAZINE_ARROW_KINDS'), '视图必须真消费箭头清单（marker 表键面）');
    /* `MAGAZINE_BLOCK_KINDS` 必须在**产品侧**被真消费（解析器的产出白名单）。 */
    const dataCode = stripComments(read(MG_DATA));
    assert.ok(dataCode.includes('MAGAZINE_BLOCK_KINDS.includes('), '解析器必须用块类型表做产出白名单校验');
    /* `MAGAZINE_TIME_UNITS` 同族：数据层用它校验产出、视图用计算键建人话表。 */
    assert.ok(dataCode.includes('MAGAZINE_TIME_UNITS'), '数据层必须真消费时间单位表');
    assert.ok(viewCode.includes('MAGAZINE_TIME_UNITS'), '视图必须真消费时间单位表（计算键）');
});
test('E2 手写键不许回潮：视图三张表都必须用计算键（J7 形态）', () => {
    const view = read(MG_VIEW);
    /* AGO_TEXT 的五个人话键不许以标识符形手写。 */
    for (const k of ["    now:", "    minute:", "    hour:", "    day:", "    none:"]) {
        assert.equal(view.includes(k), false, 'AGO_TEXT 不许手写标识符形键：' + k.trim());
    }
    assert.ok(view.includes('[MAGAZINE_TIME_UNITS['), 'AGO_TEXT 必须用计算键');
    /* 箭头 marker 表同理。 */
    assert.ok(view.includes('ARROW_MARKERS'), 'marker 表必须在场');
    assert.ok(view.includes('[MAGAZINE_ARROW_KINDS['), 'marker 表必须用计算键');
    for (const k of ["    '→':", '    "→":', "    '←':"]) {
        assert.equal(view.includes(k), false, 'marker 表不许手写箭头键：' + k.trim());
    }
});
test('E3 视图不自己切块：正文结构只能从 App 拿（源十套解析器写在渲染里）', () => {
    const view = stripComments(read(MG_VIEW));
    assert.ok(view.includes('app.blocks('), '视图必须走 App 的块结构出口');
    assert.ok(view.includes('app.graph(') || view.includes('app.graphLayout('), '关系图必须走 App 出口');
    /* 不许在视图里 split 正文行（源那样做 ⇒ 同一行在不同类型下归类不同）。 */
    assert.equal(/\.content\s*\.\s*split\(/.test(view), false, '视图不许自己 split 正文');
    assert.equal(view.includes('parseArticleBody'), false, '视图不许直接调解析器（那是数据层的事）');
});
/* ══════════════════════ F — 视图契约面 ══════════════════════ */
test('F1 期号直接读字段：视图不许 index + 1（源 `_getVolNum` 位置反查）', () => {
    const view = stripComments(read(MG_VIEW));
    assert.equal(/findIndex\([^)]*\)\s*\+\s*1/.test(view), false, '视图不许用 findIndex + 1 反查期号');
    assert.equal(/index\s*\+\s*1/.test(view), false, '视图不许出现 index + 1');
    assert.ok(view.includes('cover.volLabel') || view.includes('volLabel'), '期号必须走 App 的封面读数出口');
});
test('F2 受访者缺人必须可见：视图必须画出 missing 计数', () => {
    const view = read(MG_VIEW);
    assert.ok(view.includes('people.missing.length'), '视图必须读 missing 计数');
    assert.ok(view.includes('查不到人'), '视图必须把那句话画出来（源 filter(Boolean) 整条抹掉）');
});
test('F3 译文走段落数组：视图不许把整段译文拼进 innerHTML', () => {
    const view = stripComments(read(MG_VIEW));
    assert.ok(view.includes('app.translation('), '译文必须走 App 的段落出口');
    assert.equal(view.includes('translationParagraphs'), false, '视图不许直接调数据层的译文切分');
});
test('F4 未识别行必须可见：视图必须画出 unknown 计数', () => {
    const view = read(MG_VIEW);
    assert.ok(view.includes('parsed.unknown'), '视图必须读未识别计数');
    assert.ok(view.includes('没认出格式') || view.includes('未识别'), '视图必须把那句话画出来');
});
/* ══════════════════════ G — 键归属面 ══════════════════════ */
test('G1 三条会话键登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['magazine_settings', 'magazine_content', 'magazine_ledger']) {
        const re = new RegExp("key:\\s*'" + k + "',\\s*scope:\\s*'chat'");
        assert.ok(re.test(keys), '键必须在册且 scope=chat：' + k);
    }
    assert.ok(/\/\^magazine_\//.test(read(STORAGE)), '宽匹配前缀必须在场');
});
test('G2 三条键真被产品消费（写面必须落到这三条上）', () => {
    const code = stripComments(read(MG_APP));
    for (const k of ['magazine_settings', 'magazine_content', 'magazine_ledger']) {
        assert.ok(code.includes("'" + k + "'"), 'App 必须真用到这一条键：' + k);
    }
    assert.equal(code.includes('magazine_extra'), false, '不许有第四条未登记的键');
});
/* ══════════════════════ H — 单一真源面 ══════════════════════ */
test('H1 企划模板表：八款模板的键面与图标表逐一对齐', () => {
    const t = Object.keys(DAT.MAGAZINE_FEATURE_TEMPLATES);
    const i = Object.keys(DAT.MAGAZINE_FEATURE_ICONS);
    assert.equal(t.length, 8, '八款模板（源 `_FEATURE_LABELS` 八键）');
    assert.deepEqual(i, t, '图标表的键面必须与模板表一致（缺一款就落兜底图标）');
    assert.ok(t.includes('custom'), '必须有「自定义」那一款');
});
test('H2 投票徽标是数字键（源写 {1:...} 而查表用 parseInt ⇒ 字符串键会永远查不到）', () => {
    assert.deepEqual(Object.keys(DAT.MAGAZINE_POLL_MEDALS).sort(), ['1', '2', '3'],
        '徽标表必须是 1/2/3 三个数字键');
    assert.equal(DAT.MAGAZINE_POLL_MEDALS[1] !== undefined, true, '数字键必须查得到（1）');
    assert.equal(DAT.MAGAZINE_POLL_MEDALS['1'] !== undefined, true, 'JS 对象键会字符串化，两种取法等价');
    const p = DAT.parseRankLine('2位　甲　33%');
    assert.equal(p.rank, 2, '名次必须是**数字** 2（源 parseInt 后 || 0 会把坏号吞成 0）');
});
test('H3 导出与屏幕同源：blocksToText 是唯一的一份结构→文本实现', () => {
    const blocks = DAT.parseArticleBody('seiyuu', '―― 问\n甲：答').blocks;
    const txt = DAT.blocksToText(blocks);
    assert.ok(txt.includes('―― 问'), '提问行必须进文本');
    assert.ok(txt.includes('甲：答'), '回答行必须进文本（名字与回答之间用全角冒号）');
    const view = stripComments(read(MG_VIEW));
    assert.equal(view.includes('blocksToText'), false, '视图不许直接调 blocksToText（那是导出面的事）');
    assert.ok(read(MG_APP).includes('blocksToText'), 'App 必须用同一份实现产导出文本');
});
/* ══════════════════════ I — 负控制 ══════════════════════ */
/** 破坏表：锚点一律取**代码行**，一律字面 split/join（不用 String.replace，避免 `$&` 被解释）。 */
const DAMAGE = {
    /* ① 期号又退回位置反查（删中间一篇会改别人的期号） */
    d1: [MG_DATA,
        '    const vol = clampInt(raw.vol, 1, 1e9, fallbackIdx + 1);',
        '    const vol = index + 1;'],
    /* ② nextVol 退回「长度 + 1」（删过中间篇就会撞号） */
    d2: [MG_DATA,
        '    return max + 1;\n}',
        '    return arr.length + 1;\n}'],
    /* ③ 撞号不再回报、直接两条并存 */
    d3: [MG_DATA,
        '        if (seenVol.has(a.vol)) { volConflicts.push(a.vol); continue; }',
        '        if (false) { volConflicts.push(a.vol); continue; }'],
    /* ④ 「没认出来」不再计数（与「正文是空的」塌成同一个读数） */
    d4: [MG_DATA,
        '                unknown++;\n                push(\'prose\', { text: trimmed, unparsed: true });',
        '                push(\'prose\', { text: trimmed, unparsed: true });'],
    /* ⑤ 受访者查不到人又静默抹掉 */
    d5: [MG_DATA,
        '        if (!hit) { missing.push(String(id)); continue; }',
        '        if (!hit) { continue; }'],
    /* ⑥ 让解析器**产出一个表外块**（`question` → `questionx`）。
     *   ★ 为什么不破坏「校验那一行」：产品从不产白名单外的块 ⇒ 摘掉校验与不摘掉
     *     **行为完全相同**（不可观测的破坏 = 装饰破坏）。要让判据有判别力，
     *     必须让**产出**越过白名单，判据才看得见。
     *   ★ 为什么不改表本身：表里的每一行都带行尾注释 ⇒ 锚点会落在注释里，
     *     而 J2 的自证要求「锚点必须落在代码里」（`stripComments` 会把注释剥掉）。 */
    d6: [MG_DATA,
        "            push('question', { text: trimmed });",
        "            push('questionx', { text: trimmed });"],
    /* ⑦ 时间单位表**去掉 export**（内部仍可用 ⇒ 不崩 ReferenceError；对外消失）。
     *   ★ 首版破坏写成「改名」，于是 `timeAgoFace` 里未定义 ⇒ 判据崩在
     *     ReferenceError 上 —— 报红的原因不是判据响、是模块坏了（假红）。 */
    d7: [MG_DATA,
        'export const MAGAZINE_TIME_UNITS = [',
        'const MAGAZINE_TIME_UNITS = ['],
    /* ⑧ App：认源又走吞异常的读法（坏 storage 被读成「空」） */
    a1: [MG_APP,
        '        const rc = this._readRaw(CONTENT_KEY);',
        '        const rc = { ok: true, raw: this._readJSON(CONTENT_KEY) };'],
    /* ⑨ App：登记时不再算期号（走缺省 ⇒ 撞号） */
    a2: [MG_APP,
        '        const vol = nextVol(this.articles);',
        '        const vol = this.articles.length + 1;'],
    /* ⑩ App：换会话不再重取（源把数据挂内存的形态） */
    a3: [MG_APP,
        '        this._loadSettings();\n        this.probe();\n        if (this._view) this._view.refresh();',
        '        if (this._view) this._view.refresh();'],
    /* ⑪ 视图：时间人话表退回手写标识符形键 */
    v1: [MG_VIEW,
        '    [MAGAZINE_TIME_UNITS[1]]: () => \'刚刚\',',
        '    now: () => \'刚刚\','],
    /* ⑫ 视图：期号退回位置反查 */
    v2: [MG_VIEW,
        '        parts.push(\'<span class="mgz-card-vol">\' + this._esc(cover ? cover.volLabel : \'\') + \'</span>\');',
        '        parts.push(\'<span class="mgz-card-vol">VOL.\' + (this.app.articlesAll().findIndex(function (x) { return x.id === a.id; }) + 1) + \'</span>\');'],
};
/** 数据层判据（加载破坏副本后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 期号是事实不是位置：删中间一篇不许改别人的期号 */
    const st = { box: new Map(), get(k) { return this.box.has(k) ? this.box.get(k) : null; }, set(k, v) { this.box.set(k, v); } };
    /* 这里不引 App（判据只碰数据层）：直接用 normalizeMagazine 走两条同期号的输入。 */
    const m = mod.normalizeMagazine({
        magazineName: 'M',
        articles: [{ title: 'a', vol: 1, content: 'x' }, { title: 'b', vol: 1, content: 'y' }],
    });
    if (m.articles.length !== 1) bad.push('vol-conflict-not-reported');
    if (m.volConflicts.length !== 1) bad.push('vol-conflict-not-reported');
    /* ② 缺省期号必须是「下标 + 1」而不是「下标本身」（0 是坏期号） */
    const na = mod.normalizeArticle({ title: 'x' }, 0);
    if (na.vol !== 1) bad.push('default-vol-wrong');
    /* ③ 给定期号不许被篡改（1.9 取整成 1、-5 夹到 1） */
    if (mod.normalizeArticle({ title: 'x', vol: 1.9 }, 0).vol !== 1) bad.push('given-vol-coerced');
    if (mod.normalizeArticle({ title: 'x', vol: -5 }, 0).vol !== 1) bad.push('given-vol-clamped');
    /* ③b **给定期号必须被尊重** —— 这一条才是「期号是事实不是位置」的正判据：
     *    上面两条在 `index = 0` 时与「位置反查」的坏实现**行为等价**（装饰断言）。 */
    if (mod.normalizeArticle({ title: 'x', vol: 9 }, 0).vol !== 9) bad.push('given-vol-ignored');
    if (mod.normalizeArticle({ title: 'x', vol: 9 }, 3).vol !== 9) bad.push('given-vol-ignored');
    /* ③c **期号必须取「现有最大 + 1」**（不是「长度 + 1」—— 删过中间篇就会撞号）。 */
    if (mod.nextVol([{ vol: 1 }, { vol: 3 }]) !== 4) bad.push('next-vol-wrong');
    if (mod.nextVol([{ vol: 1 }, { vol: 2 }]) !== 3) bad.push('next-vol-wrong');
    if (mod.nextVol([]) !== 1) bad.push('next-vol-wrong');
    /* ④ 「没认出来」必须计数（与「正文是空的」分开） */
    const bad2 = mod.parseArticleBody('chart', '◆ 这行不是合法关系\n◆ 这行也不是');
    if (bad2.unknown !== 2) bad.push('unknown-not-counted');
    const empty = mod.parseArticleBody('chart', '');
    if (empty.unknown !== 0) bad.push('empty-counted-as-unknown');
    /* ⑤ 查不到人必须如实回报 */
    const ppl = mod.resolvePeople(['mg-p1', 'ghost'], mod.MAGAZINE_BUILT_IN_PEOPLE);
    if (ppl.missing.length !== 1 || ppl.missing[0] !== 'ghost') bad.push('missing-person-swallowed');
    /* ⑥ 产出的每个块都必须在白名单内（表脱节 ⇒ 立刻暴露） */
    const ok = mod.parseArticleBody('seiyuu', '―― 问\n甲：答');
    if (ok.stray !== 0) bad.push('stray-nonzero-on-clean-input');
    if (ok.blocks.some((b) => !mod.MAGAZINE_BLOCK_KINDS.includes(b.kind))) bad.push('block-outside-whitelist');
    const chartB = mod.parseArticleBody('chart', '◆ A → B：关系\n※ 按');
    if (chartB.blocks.some((b) => !mod.MAGAZINE_BLOCK_KINDS.includes(b.kind))) bad.push('block-outside-whitelist');
    /* ⑦ 时间单位表必须是**导出**的常量（视图要拿它建计算键）。
     *   ★ 先做守卫再往下：去掉 export 后这一格是 undefined，若直接 `.includes`
     *     会抛 TypeError —— 那报红的原因就不是判据响、而是判据自己崩了。 */
    if (!Array.isArray(mod.MAGAZINE_TIME_UNITS)) {
        bad.push('time-units-missing');
        return bad;
    }
    /* ⑧ 时间读数产出必须落在单位表内 */
    const f = mod.timeAgoFace(Date.now() - 5 * 60000, Date.now());
    if (!mod.MAGAZINE_TIME_UNITS.includes(f.unit)) bad.push('time-unit-stray');
    /* ⑨ 关系图兜底必须把原文给回去 */
    const fb = mod.chartFallback(mod.parseArticleBody('chart', '认不出来的行').blocks);
    if (fb.length !== 1 || fb[0] !== '认不出来的行') bad.push('chart-fallback-lost-text');
    return bad;
};
/** App 侧的**结构面**判据（不加载副本 —— 编排层 import 视图/宿主，副本树里跑不起来）。 */
const appReadProblems = (src) => {
    const bad = [];
    /* ★ 判据必须落到**被破坏的那一处**（`probe()` 里的认源调用）。
     *   只查全文件含 `_readRaw(` 等于没盖住破坏面（定义处与别处都在）。 */
    const i = src.indexOf('    probe() {');
    const body = i < 0 ? '' : src.slice(i, i + 2400);
    if (!body.includes('this._readRaw(CONTENT_KEY)')) bad.push('read-raw-not-used');
    if (!/storageOk\s*=/.test(body)) bad.push('storage-ok-not-computed');
    return bad;
};
const appVolProblems = (src) => {
    const bad = [];
    if (!src.includes('nextVol(this.articles)')) bad.push('next-vol-not-used');
    return bad;
};
const appChatProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    onChatChanged() {');
    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }
    /* ★ 窗口必须取到**函数体结束**（下一个顶格 `    }`）：首版取固定 400 字，
     *   窗口里落进了紧随其后的 `render()` 的 `this.probe()` ⇒ 破坏后照样为真
     *   （判据面没盖住破坏面）。 */
    const rest = src.slice(i + 24);
    const endRel = rest.indexOf('\n    }\n');
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!/this\.probe\(\)/.test(body)) bad.push('chat-change-no-refetch');
    return bad;
};
const viewDeadProblems = (src) => {
    const bad = [];
    /* ★ 必须**数次数**：AGO_TEXT 有五个人话键 ⇒ 计算键必须出现 ≥ 5 次。
     *   首版只查「文件里含」，破坏掉一行后其余四行仍在 ⇒ 照样为真（判据数错）。 */
    const hits = src.split('[MAGAZINE_TIME_UNITS[').length - 1;
    if (hits < 5) bad.push('time-keys-handwritten');
    if (/findIndex\(/.test(src)) bad.push('vol-by-position-back');
    return bad;
};
function chr96() { return String.fromCharCode(96); }
/** num-gate 的等价桩（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';
/** 造一份破坏副本并**落盘**（只写文件，不加载）。副本按**真目录结构**建。 */
function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3360_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
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
const NEG = [
    ['I1 破坏「期号是事实不是位置」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['given-vol-ignored']],
    ['I2 破坏「期号取最大 + 1」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['next-vol-wrong']],
    ['I3 破坏「撞号必须如实回报」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['vol-conflict-not-reported']],
    ['I4 破坏「没认出来要计数」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['unknown-not-counted']],
    ['I5 破坏「查不到人如实回报」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['missing-person-swallowed']],
    ['I6 破坏「块 kind 白名单校验」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['stray-nonzero-on-clean-input']],
    ['I7 破坏「时间单位表是导出的真源」⇒ 内核判据必须转红', 'd7', 'data', dataProblems, ['time-units-missing']],
    ['I8 破坏「认源走不吞异常的读法」⇒ 结构面判据必须转红', 'a1', 'app', appReadProblems, ['read-raw-not-used']],
    ['I9 破坏「登记时期号走 nextVol」⇒ 结构面判据必须转红', 'a2', 'app', appVolProblems, ['next-vol-not-used']],
    ['I10 破坏「换会话必须重取」⇒ 结构面判据必须转红', 'a3', 'app', appChatProblems, ['chat-change-no-refetch']],
    ['I11 破坏「时间人话表用计算键」⇒ 视图判据必须转红', 'v1', 'view', viewDeadProblems, ['time-keys-handwritten']],
    ['I12 破坏「期号直接读字段」⇒ 视图判据必须转红', 'v2', 'view', viewDeadProblems, ['vol-by-position-back']],
];
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        if (kind === 'data') {
            const { mod } = await loadDamagedCopy(rel, from, to);
            const bad = judge(mod);
            /* ★ 期望集为空 = 「这一条破坏必须让判据转红」，具体报哪一条由实现决定；
             *   但**不许一条都不报**（那说明判据面没盖住破坏面）。 */
            if (expect.length) {
                assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                    '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            } else {
                assert.ok(bad.length > 0, '破坏后判据必须至少报一条，实测：（没报）');
            }
            /* 对照：真模块必须干净（否则「转红」可能只是因为判据本来就红 —— 假绿三形之一）。 */
            assert.deepEqual(judge(DAT), [], '对照：真模块必须干净');
        } else {
            const { src } = writeDamagedCopy(rel, from, to);
            const bad = judge(src);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(read(rel)), [], '对照：真源码必须干净');
        }
    });
}
/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const q = chr96();
    assert.equal(stripComments('a /* 注释里的 callChatAPI */ b').includes('callChatAPI'), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 callChatAPI\nb').includes('callChatAPI'), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 callChatAPI';").includes('callChatAPI'), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 callChatAPI' + q + ';').includes('callChatAPI'), true, '模板串里的必须留住');
    assert.equal(stripComments('a = "带 \\" 转义的 callChatAPI";').includes('callChatAPI'), true, '转义串不许被误断');
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        const sentinel = stripComments(read(rel) + '\n/* RP_TAIL_3360 */\n');
        assert.equal(sentinel.includes('RP_TAIL_3360'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});
test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, key + ' 的锚点必须恰中 1 次（实测 ' + hits + '）');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        assert.ok(damaged.includes(to) || to === '', key + ' 替换后必须出现新串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3360k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [MG_DATA, MG_APP, MG_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J4 十道静态门必须在场（含本版当场抓到两处缺陷的那两道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts[g], '门必须在 package.json 里：' + g);
    }
});
/* ══════════════════════ L — 版本锚 ══════════════════════ */
test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 36),
        '本套件成立于 RubyPhone 3.36.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.36.0 杂志），不是「当版」——
     *   本仓已有四处「守别人的版」的口径错（v3270 / v3280 / v3290 / v3300）。 */
    const SELF = '3.36.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['杂志', '期号', '解析', '受访者', '零消费']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
});
