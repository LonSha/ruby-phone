// tests/system-v3430.test.mjs — PV 案头 [v3.43.0]
//
// 本套件守四件事：
//  ① 收拾内核的口径（分镜解析逐条报 / 逐镜要求文本组装 / 歌词三态与坏行分类 /
//     上限余量不编 0 / 回信归一报表 / 来源面）；
//  ② 四块不缝真的没缝（零音频元件 / 零网络 / 零出图零成片 / 零宿主界面读）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 ~ v3.42 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/pvdesk/pvdesk-data.js';
import * as APP from '../apps/pvdesk/pvdesk-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PD_DATA = 'apps/pvdesk/pvdesk-data.js';
const PD_APP = 'apps/pvdesk/pvdesk-app.js';
const PD_VIEW = 'apps/pvdesk/pvdesk-view.js';
const PD_CSS = 'apps/pvdesk/pvdesk.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
/** 单引号（破坏表里拼锚点用）：一律拼装形，不写裸引号。 */
const Q = String.fromCharCode(39);
/** 反斜杠（剥注释器里判转义用）：同样拼装形，免得文件里出现裸反斜杠。 */
const BS = String.fromCharCode(92);
const AMP = String.fromCharCode(38);
/** 双引号（造文本用）：拼装形。 */
const DQ = String.fromCharCode(34);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300…v3420 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故本件的被审代码一律字串比对、不写正则字面量，
 *    并在 J 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
            if (c === Q || c === DQ || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        /* 字符串态：本件被审代码不许有裸引号，故只需处理转义与收尾。 */
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === state) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}

/** 内存存储（单会话）。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^pvdesk_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致 —— 抄别版的前缀会把「换会话后读到别人数据」这条判据测成空气。 */
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

/** 取不出来的存储（一取就抛）—— 守「取不出来不许读成空的」那一族。 */
function hostileStorage() {
    return { get: () => { throw new Error('boom'); }, set: () => {} };
}

/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new APP.PvdeskApp(shellStub(), storage);

/** 一段分镜脚本（用数组 + join(NL) 拼，源码里不出现裸引号）。 */
function shotScript() {
    return [
        '分镜脚本：夏日的天台',
        '镜头1（0-3秒）',
        '图1 站在天台上，风吹起校服下摆',
        '使用的素材：图1',
        '镜头2（4-10秒）',
        '台词「谁说我不行」（图2 与 ' + String.fromCharCode(22259) + '10）',
        '镜头9（12-8秒）',
        '区间反了'
    ].join(NL);
}
/** 一份 LRC 文本（含元标签行、空正文行、没时间标签的行）。 */
function lrcText() {
    return [
        '[ti:歌名]',
        '[00:01.00]第一行',
        '这一行没有时间标签',
        '[00:02.00]',
        '[00:05.00]（括注）正文',
        '[ar:艺人]'
    ].join(NL);
}

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 分镜解析：区间反了与超上限逐条报（源只认正序、静默跳过）', () => {
    const r = DAT.parseShots(shotScript(), {});
    assert.equal(r.ok, true);
    assert.equal(r.shots.length, 2);
    assert.equal(r.rejected.length, 1, '区间反了的镜头必须逐条报出来');
    assert.equal(r.rejected[0].n, 9);
    assert.equal(r.rejected[0].saw, '12-8');
    /* 空正文与硬限也都要报。 */
    assert.equal(DAT.parseShots('', {}).why, DAT.PV_PARSE_WHYS[0]);
    assert.equal(DAT.parseShots('没有表头的一段', {}).why, DAT.PV_PARSE_WHYS[1]);
    const over = DAT.parseShots('镜头1（0-3秒）' + NL + 'x'.repeat(300), { limitChars: 10 });
    assert.equal(over.why, DAT.PV_PARSE_WHYS[3], '超硬限必须报 over_limit');
    assert.equal(over.truncated, true);
    assert.ok(over.keptChars < over.chars);
});

test('A2 镜头体必须是**这一镜自己的**（本版真踩到：尾部混入下一镜表头）', () => {
    const r = DAT.parseShots(shotScript(), {});
    for (const s of r.shots) {
        assert.equal(s.body.indexOf(DAT.PV_SHOT_MARK), -1,
            '镜头体里不许出现下一镜的表头（切割位置必须落在表头起点）');
    }
    assert.ok(r.shots[0].body.includes('风吹起校服下摆'));
});

test('A3 剔行要计数：以「使用的素材」打头的行剔掉时逐镜报（源静默剔）', () => {
    const r = DAT.parseShots(shotScript(), {});
    assert.equal(r.bodyCut.length, 1);
    assert.equal(r.bodyCut[0].n, 1);
    assert.equal(r.bodyCut[0].cut, 1);
    assert.equal(r.shots[0].cut, 1);
    /* 没剔行时不许凭空造一条。 */
    const clean = DAT.parseShots('镜头1（0-3秒）' + NL + '正文', {});
    assert.equal(clean.bodyCut.length, 0);
});

test('A4 图号认「图」与「図」两种写法，去重保序（源口径）', () => {
    assert.deepEqual(DAT.shotFigNums('图1 与 ' + String.fromCharCode(22259) + '2 和 图10'), [1, 2, 10]);
    assert.deepEqual(DAT.shotFigNums('没有号'), []);
    assert.deepEqual(DAT.allFigNums(DAT.parseShots(shotScript(), {}).shots), [1, 2, 10]);
});

test('A5 LRC 时间标签必须剥掉、正文不许带标签（本版真踩到）', () => {
    const r = DAT.parseLrcText(lrcText(), { duration: 10, maxChars: 6 });
    assert.equal(r.mode, 'timed');
    assert.ok(r.cues.length >= 2);
    for (const c of r.cues) {
        assert.equal(c.text.indexOf('['), -1, '正文里不许残留时间标签：' + c.text);
        assert.equal(c.main.indexOf('['), -1, '主行不许带标签：' + c.main);
    }
    assert.equal(r.cues[0].text, '第一行');
});

test('A6 歌词坏行分三类报（源不中即 continue，丢了几行不报）', () => {
    const r = DAT.parseLrcText(lrcText(), { duration: 10, maxChars: 40 });
    assert.equal(r.dropped.noText, 1, '标签后没字必须报出来');
    assert.equal(r.dropped.meta, 2, '元标签行必须计数');
    assert.ok(r.dropped.noTime.length >= 1, '没时间标签的行必须逐条列');
    assert.equal(r.dropped.noTime[0].why, 'no_stamp');
    /* 三态不许压平。 */
    assert.equal(DAT.parseLrcText('', {}).mode, 'empty');
    assert.equal(DAT.parseLrcText('一行' + NL + '两行', {}).mode, 'untimed');
    assert.equal(DAT.parseLrcText('一行' + NL + '两行', {}).plain.length, 2);
});

test('A7 按秒找句：左闭右开，三种落空各有原因（源拿区间直接比）', () => {
    const cues = DAT.parseLrcText(lrcText(), { duration: 10, maxChars: 40 }).cues;
    const hit = DAT.findCueAt(cues, 1.5);
    assert.equal(hit.found, true);
    assert.equal(hit.index, 0);
    assert.equal(DAT.findCueAt([], 1).why, 'empty');
    assert.equal(DAT.findCueAt(cues, 'x').why, 'no_time');
    assert.equal(DAT.findCueAt(cues, 99).why, 'out_of_range');
});

test('A8 主副行切法四处不同形（源两处都写「未指定」的同一形坑）', () => {
    assert.equal(DAT.splitParen('主行（副行）').filled, 'split');
    assert.equal(DAT.splitParen('没有括注').filled, 'no_paren');
    assert.equal(DAT.splitParen('主行（）').filled, 'paren_empty');
    assert.equal(DAT.splitParen('（前缀）主行').filled, 'not_tail');
    const cut = DAT.captionCut('一二三四五六', 4);
    assert.equal(cut.cut, true);
    assert.equal(cut.main, '一二三四');
    assert.equal(cut.sub, '五六');
});

test('A9 语速检查：塞不进要报原因，没时长是 no_cut（源只在心里估）', () => {
    const ok = DAT.speechLimitCheck('好的', 3, 'zh');
    assert.equal(ok.ok, true);
    assert.equal(ok.perSecond, 4);
    const bad = DAT.speechLimitCheck('一二三四五六七八九十', 1, 'zh');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, DAT.PV_HOLD_WHYS[1]);
    assert.equal(bad.limit, 4);
    assert.equal(DAT.speechLimitCheck('好的', 0, 'zh').why, 'no_cut');
});

test('A10 逐镜要求文本：画风锚 + 机型 + 情绪 + 立绘号 + 一帧约束，逐格报填写态', () => {
    const shot = { n: 1, a: 0, b: 3, sec: 3, body: '图1 站在天台' };
    const p = DAT.promptForShot(shot, { styleKey: 'cel', lensKey: 'op', moodKey: 'iyashi' });
    assert.equal(p.filled.style, 'ok');
    assert.equal(p.filled.lens, 'ok');
    assert.equal(p.filled.mood, 'ok');
    assert.equal(p.filled.figs, 'ok');
    assert.deepEqual(p.figs, [1]);
    assert.ok(p.text.includes(DAT.PV_STYLE_ANCHORS[0].anchor));
    assert.ok(p.text.includes('图1'));
    const none = DAT.promptForShot(shot, {});
    assert.equal(none.filled.style, 'absent');
    assert.equal(none.filled.lens, 'absent');
    assert.equal(none.filled.mood, 'absent');
    /* ★ 立绘号是**从这一镜的正文里认出来的**（不是选项格）：这一镜挂了图1 就是 ok，
     *   一镜没挂才是 none —— 两形不同（源把两件事并进「未指定」一句话里）。 */
    assert.equal(none.filled.figs, 'ok');
    const bare = DAT.promptForShot({ n: 2, a: 3, b: 6, sec: 3, body: '没有图号的一镜' }, {});
    assert.equal(bare.filled.figs, 'none');
});

test('A11 风格四形互不同形（absent / ok / unknown / already）', () => {
    assert.equal(DAT.stylePick(undefined).filled, 'absent');
    assert.equal(DAT.stylePick('').filled, 'absent');
    assert.equal(DAT.stylePick('cel').filled, 'ok');
    const unk = DAT.stylePick('nope');
    assert.equal(unk.filled, 'unknown');
    assert.equal(unk.anchor, '');
    assert.equal(unk.saw, 'nope');
    /* 画风锚追加：已有同一锚就不重复加。 */
    assert.equal(DAT.applyStyleAnchor('正文', 'cel').applied, true);
    assert.equal(DAT.applyStyleAnchor(DAT.PV_STYLE_ANCHORS[0].anchor, 'cel').filled, 'already');
    assert.equal(DAT.applyStyleAnchor('正文', '').applied, false);
});

test('A12 提交文本三块：素材指代 / 逐镜要求 / 负向控制（不长角外链）', () => {
    const w = DAT.wrapPromptForSubmit('正文', { assetCount: 2, frameShots: [1, 2], segCount: 10 });
    assert.equal(w.hasMaterial, true);
    assert.equal(w.blocks, 3);
    assert.ok(w.text.includes('图1'));
    const none = DAT.wrapPromptForSubmit('正文', {});
    assert.equal(none.blocks, 2);
    assert.equal(none.hasMaterial, false);
    /* 图号映射：连号写区间、单镜写单条、跳号逐张写。 */
    assert.equal(DAT.figMapRows(0, [3]).length, 1);
    assert.ok(DAT.figMapRows(2, [1, 2])[0].includes('图3'));
    assert.equal(DAT.figMapRows(0, [2, 5]).length, 2);
    assert.deepEqual(DAT.figMapRows(0, []), []);
});

test('A13 三项上限余量：四项读数 / 上限，四项都真能被顶到', () => {
    const r = DAT.readingsOf({});
    for (const k of DAT.PV_GAUGE_KEYS.map((g) => g.key)) {
        assert.ok(r.rows[k], k + ' 必须有一格读数');
        assert.equal(r.rows[k].value, 0);
        assert.ok(r.rows[k].of > 0, k + ' 必须有上限');
    }
    const over = DAT.holdCheck({
        shots: new Array(70).fill(0).map((_, i) => ({ n: i + 1, a: 0, b: 1, sec: 1, body: 'x' })),
        text: 'x', cast: new Array(10).fill(1), refs: new Array(60).fill(1)
    });
    assert.equal(over.ok, false);
    assert.ok(over.fails >= 3, '三项上限必须都真能被顶到（实测 ' + over.fails + '）');
    assert.equal(DAT.holdCheck({ shots: [], text: '' }).ok, false);
});

test('A14 参考素材上限按开关分档（源按渠道与模型分档）', () => {
    assert.equal(DAT.refsLimitOf('paint', false), DAT.PV_REFS_MAX);
    assert.equal(DAT.refsLimitOf('paint', true), DAT.PV_REFS_MAX_WIDE);
    assert.equal(DAT.refsLimitOf('audio', false), 15);
    assert.equal(DAT.refsLimitOf('audio', true), 30);
});

test('A15 回信归一：认出的格与认不出的键都要报（源静默改）', () => {
    const r = DAT.parseBriefReply([
        '标题：夏', '时长：12', '风格：cel', '镜头：op', '情绪：iyashi',
        '不认识的键：x', '正文第一行'
    ].join(NL));
    assert.equal(r.title, '夏');
    assert.equal(r.duration, 12);
    assert.equal(r.style, 'cel');
    assert.equal(r.lens, 'op');
    assert.equal(r.mood, 'iyashi');
    assert.deepEqual(r.taken, ['title', 'style', 'lens', 'mood']);
    assert.deepEqual(r.extra, ['不认识的键'], '认不出的键必须留痕');
    assert.equal(r.sawKeys, 5);
    /* 时长坏值要报 malformed、不许静默丢。 */
    const bad = DAT.parseBriefReply('时长：99' + NL + '正文');
    assert.equal(bad.duration, null);
    assert.equal(bad.filled.duration, 'malformed');
    assert.equal(DAT.parseBriefReply('').why, DAT.PV_PARSE_WHYS[0]);
});

test('A16 读数面一律不编 0：取不出来是 null（空与坏不是一回事）', () => {
    const blank = DAT.blankCover('storage_absent');
    assert.equal(blank.ok, false);
    assert.equal(blank.face, DAT.PV_FACES[3]);
    for (const k of DAT.PV_READ_KEYS) assert.equal(blank.rows[k], null, k + ' 取不出来必须是 null');
    const r = DAT.readingsOf({});
    assert.equal(r.ok, true);
    /* 真的 0 与取不出来必须不同形。 */
    assert.equal(r.rows.shots.value, 0);
    assert.equal(blank.rows.shots, null);
});

test('A17 题面正文的截断读数（源也截，但不说）', () => {
    const b = DAT.briefOf('x'.repeat(500), 400);
    assert.equal(b.truncated, true);
    assert.equal(b.keptChars, 400);
    assert.equal(b.limit, 400);
    const e = DAT.excerptOf('x'.repeat(500), 400);
    assert.equal(e.text.length, 400);
    const small = DAT.briefOf('abc', 400);
    assert.equal(small.truncated, false);
});

test('A18 时间码补零两位形（与仓内同族件同口径）', () => {
    assert.equal(DAT.formatClock(0).text, '00:00');
    assert.equal(DAT.formatClock(65).text, '01:05');
    assert.equal(DAT.formatClock(null).text, '', '读不出来画空串，不许画 00:00');
    assert.equal(DAT.formatClock('x').ok, false);
});

test('A19 一句台词的字形构成三类（源不做混合分类、只看长度）', () => {
    assert.equal(DAT.textClassOf(String.fromCharCode(12354)).cls, 'kana');
    assert.equal(DAT.textClassOf('汉').cls, 'hans');
    assert.equal(DAT.textClassOf('abc').cls, 'latin');
    assert.equal(DAT.textClassOf('！').cls, 'other');
});

test('A20 真源表在场且取值互不相同（塔平就是同形）', () => {
    assert.equal(DAT.PV_PERSPECTIVES.length, 7);
    assert.equal(DAT.PV_MOOD_CUES.length, 6);
    assert.equal(DAT.PV_STYLE_ANCHORS.length, 4);
    assert.equal(DAT.PV_DIALOGUE_LANGS.length, 3);
    assert.equal(DAT.PV_SOURCE_FILES.length, 7, '源是一族七件（主件 + 六个分件）');
    assert.ok(DAT.PV_SOURCE_FILES[0].includes('niconico.js'));
    assert.equal(new Set(DAT.PV_STYLE_ANCHORS.map((s) => s.anchor)).size, 4);
    assert.equal(new Set(DAT.PV_DIALOGUE_LANGS.map((l) => l.perSecond)).size, 3);
    for (const k of [DAT.PV_PARSE_WHYS, DAT.PV_HOLD_WHYS, DAT.PV_FACES, DAT.PV_READ_KEYS, DAT.PV_META_TAGS]) {
        assert.equal(new Set(k).size, k.length, '真源表内不许有重复项');
    }
});

/* ══════════════════════ B — 落盘与接线面 ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一条都没收进来」', () => {
    const app = newApp(hostileStorage());
    const r = app.probe();
    assert.equal(app.faceOf(), DAT.PV_FACES[3], '取不出来必须是「读数拿不到」这一态');
    assert.equal(app.readingsOk(), false);
    for (const row of app.gaugeRows()) {
        assert.equal(row.value, null, '取不出来时读数格必须是 null，不许是 0');
    }
    assert.equal(app.readings().face, DAT.PV_FACES[3]);
    assert.equal(r.face, DAT.PV_FACES[3]);
    /* 没给 storage 也不许崩。 */
    const bare = newApp(null);
    bare.probe();
    assert.equal(bare.faceOf(), DAT.PV_FACES[3]);
    assert.deepEqual(bare.shotRows(), []);
});

test('B2 「写了但认不出来」单列：坏内容不许与「还没写题面」同形', () => {
    const app = newApp(memStorage({ pvdesk_brief: '{坏 JSON' }));
    app.probe();
    assert.equal(app.faceOf(), DAT.PV_FACES[2], '写了但读不懂必须是 malformed');
    const empty = newApp(memStorage({}));
    empty.probe();
    assert.equal(empty.faceOf(), DAT.PV_FACES[1], '压根没写过是 empty');
    assert.notEqual(DAT.PV_FACES[1], DAT.PV_FACES[2]);
    /* 形状对了但没内容（空对象）也归 empty。 */
    const shape = newApp(memStorage({ pvdesk_brief: '{}' }));
    shape.probe();
    assert.equal(shape.faceOf(), DAT.PV_FACES[1]);
});

test('B3 收题面：成功逐项报，失败分因且**不动现有题面**', () => {
    const app = newApp(memStorage({}));
    const ok = app.ingestReply(shotScript());
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, 'shots');
    assert.equal(ok.detail.shots, 2);
    assert.equal(ok.detail.rejected, 1);
    assert.equal(app.shotRows().length, 2);
    /* 键值形态也吃得进。 */
    const kv = app.ingestReply(['标题：夏', '时长：12', '正文'].join(NL));
    assert.equal(kv.ok, true);
    assert.equal(kv.kind, 'brief');
    /* 失败不许清掉现有的。 */
    const before = app.shotRows().length;
    const bad = app.ingestReply('');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, DAT.PV_PARSE_WHYS[0]);
    assert.equal(app.shotRows().length, before, '失败时不许动现有题面');
});

test('B4 收歌词：坏行逐项落到取数口上', () => {
    const app = newApp(memStorage({}));
    const r = app.ingestLyrics(lrcText());
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'timed');
    const info = app.lyricsInfo();
    assert.equal(info.noText, 1);
    assert.equal(info.meta, 2);
    assert.equal(app.droppedRows().length, info.noTime);
    assert.ok(app.plainRows().length >= 1, '按字数排的正文行必须真出得来');
    assert.equal(app.cueAt(1.5).ok, true);
    assert.equal(app.cueAt(99).ok, false);
});

test('B5 逐镜行：要求文本与立绘号都逐条落到行上', () => {
    const app = newApp(memStorage({}));
    app.ingestReply(shotScript());
    const rows = app.shotRows();
    assert.equal(rows.length, 2);
    assert.ok(rows[0].text.includes(DAT.PV_SHOT_MARK + '内容') || rows[0].text.length > 20);
    assert.equal(rows[0].clock, '00:00-00:03');
    assert.equal(rows[1].sec, 6);
    const refs = app.refRows();
    assert.equal(refs.length, 3, '三个图号都要成行');
    assert.equal(refs[0].key, '图1');
    assert.equal(refs[0].where, '1');
    assert.equal(refs[0].limit, DAT.PV_REFS_MAX);
    assert.equal(app.bodyCutRows().length, 1);
});

test('B6 产要求文本：唯一的「往外写」的出口（本件只产文本）', () => {
    const app = newApp(memStorage({}));
    app.ingestReply(shotScript());
    const r = app.composeText({ frameCount: 2 });
    assert.equal(r.ok, true);
    assert.ok(r.chars > 0);
    assert.equal(r.blocks, 3);
    assert.equal(r.shots, 2);
    assert.equal(r.filled.style, 'absent', '没给画风必须报 absent');
    assert.equal(app.requestText(), r.text);
    /* 没镜头时拒，不静默产一份空文本。 */
    const bare = newApp(memStorage({}));
    assert.equal(bare.composeText({}).ok, false);
});

test('B7 作品台账：空题面拒存、越界拒删、挤掉要计数', () => {
    const app = newApp(memStorage({}));
    const no = app.saveToShelf({});
    assert.equal(no.ok, false);
    assert.equal(no.why, DAT.PV_HOLD_WHYS[5]);
    app.ingestReply(shotScript());
    const ok = app.saveToShelf({});
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, 'cut');
    assert.equal(app.shelfRows().length, 1);
    assert.equal(app.removeFromShelf(9).ok, false);
    assert.equal(app.removeFromShelf(0).ok, true);
    assert.equal(app.shelfRows().length, 0);
    /* 台账挤掉要计数（源静默 shift）。 */
    for (let i = 0; i < DAT.PV_LEDGER_MAX + 3; i++) app.ingestLyrics('一行' + NL + i);
    const info = app.ledgerInfo();
    assert.equal(info.max, DAT.PV_LEDGER_MAX);
    assert.ok(info.dropped > 0, '被挤掉的条数必须报出来');
    assert.equal(app.clearLedger().ok, true);
    assert.equal(app.ledgerInfo().dropped, 0, '清台账要把挤掉计数一并归零');
});

test('B8 三项设定：坏值一律拒而不夹，且如实报 saw', () => {
    const app = newApp(memStorage({}));
    assert.equal(app.setDuration('99').ok, false);
    assert.equal(app.setDuration('abc').saw, 'abc');
    assert.equal(app.setDuration(12).duration, 12);
    assert.equal(app.setStyle('nope').filled, 'unknown');
    assert.equal(app.setStyle('nope').ok, false);
    assert.equal(app.setLens('nope').ok, false);
    assert.equal(app.setMood('nope').ok, false);
    assert.equal(app.setLang('nope').reason, 'unknown_lang');
    assert.equal(app.setMaxChars('99').ok, false);
    assert.equal(app.setMaxChars('20').ok, true);
    const wide = app.setWide(true);
    assert.equal(wide.wide, true);
    assert.equal(wide.refs, DAT.PV_REFS_MAX_WIDE);
});

test('B9 页签与焦点：越界一律拒，换会话收回', () => {
    const app = newApp(memStorage({}));
    assert.equal(app.tab(), 'brief');
    assert.equal(app.setTab('shots'), 'shots');
    assert.equal(app.setTab('不存在'), 'brief', '坏页签一律回落到第一页');
    app.ingestReply(shotScript());
    const r = app.openItem('1');
    assert.equal(r.ok, true);
    assert.equal(app.currentKey(), '1');
    assert.equal(app.closeItem().ok, true);
    assert.equal(app.currentKey(), '');
    assert.equal(app.cueAt('abc').ok, false);
    assert.equal(app.policyOf().lang, DAT.PV_DIALOGUE_LANGS[1].key);
});

test('B10 视图取数口全部在位（视图调了 App 上没有的口 = 一打开就 undefined）', () => {
    const view = stripComments(read(PD_VIEW));
    const app = read(PD_APP);
    const called = new Set();
    for (const m of view.matchAll(/app\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) called.add(m[1]);
    assert.ok(called.size >= 30, '视图至少要调三十个口（实测 ' + called.size + '）');
    const missing = [];
    for (const name of called) if (app.indexOf(name + '(') < 0) missing.push(name);
    assert.deepEqual(missing, [], '视图调了 App 上没有的口');
});

test('B11 时长档取值字段：真源给的是 { n, label }（取错字段不会报错，只会「选什么都没反应」）', () => {
    const opts = DAT.durationOptions(DAT.PV_DURATION_MIN, DAT.PV_DURATION_MAX, DAT.PV_DURATION_DEFAULT);
    assert.equal(opts.length, DAT.PV_DURATION_MAX - DAT.PV_DURATION_MIN + 1);
    for (const o of opts) {
        assert.equal(typeof o.n, 'number');
        assert.equal(o.key, undefined, '时长档不给 key —— 视图必须能认 n');
    }
    const view = stripComments(read(PD_VIEW));
    assert.ok(view.includes('it.n'), '下拉取值必须先认 key、再认真源的 n');
    assert.ok(view.includes('it.key'));
});

test('B12 清题面只清题面与台账（歌词与策略不动）', () => {
    const app = newApp(memStorage({}));
    app.ingestReply(shotScript());
    app.ingestLyrics(lrcText());
    app.setDuration(12);
    const before = app.lyricsInfo().cues;
    const r = app.clearBrief();
    assert.equal(r.ok, true);
    assert.equal(app.shotRows().length, 0);
    assert.equal(app.shelfRows().length, 0);
    assert.equal(app.durationOf(), DAT.PV_DURATION_DEFAULT);
    assert.equal(app.requestText(), '', '草稿要一起清掉');
    /* 歌词在题面清空后重新解析（题面没了 ⇒ 时长回落，但歌词原文仍在）。 */
    assert.ok(app.plainRows().length > 0 || before === 0);
});

/* ══════════════════════ C — 接线面 ══════════════════════ */
test('C1 四条会话键随会话隔离（换角色后不许读到别人的题面与台账）', () => {
    const st = sessionStorage();
    const app = newApp(st);
    app.ingestReply(shotScript());
    app.saveToShelf({});
    /* ★ 四条键都要**真被写过**才能断言「四条都在册」—— 只写两条却断四条，判据自己把自己码死。 */
    app.ingestLyrics(lrcText());
    app.setMaxChars(20);
    const before = app.shotRows().length;
    assert.ok(before > 0);
    st.switchTo('c2');
    const other = newApp(st);
    other.probe();
    assert.equal(other.shotRows().length, 0, '换会话后不许读到别人的题面');
    assert.equal(other.shelfRows().length, 0, '换会话后不许读到别人的台账');
    st.switchTo('c1');
    const back = newApp(st);
    back.probe();
    assert.equal(back.shotRows().length, before, '换回来必须读得到自己那份');
    /* 四条键都要真被写到。 */
    for (const k of ['pvdesk_brief', 'pvdesk_shelf', 'pvdesk_lyrics', 'pvdesk_policy']) {
        assert.ok([...st._box.keys()].some((x) => x.endsWith(k)), k + ' 必须真被写进 storage');
    }
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    /* ① 注册：apps.js 条目。 */
    const apps = read(APPS);
    assert.ok(/id: 'pvdesk'/.test(apps), 'config/apps.js 必须有 pvdesk 条目');
    /* ② 会话键前缀：不登记 ⇒ 四条键走全局存储（串味）。 */
    assert.ok(/\/\^pvdesk_\//.test(read(STORAGE)), 'config/storage.js 必须有 /^pvdesk_/ 前缀');
    /* ③ 入口：懒加载分支 + 重绑表。 */
    const idx = read(INDEX);
    assert.ok(idx.includes("appId === 'pvdesk'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/pvdesk/pvdesk-app.js')"), 'index.js 必须真 import 本件');
    assert.ok(idx.includes('pvdeskApp'), 'index.js 重绑表必须有 pvdeskApp（换会话才重取）');
    /* ④ 会话键审计：四条键都要在册。 */
    const keys = read(KEYS);
    for (const k of ['pvdesk_brief', 'pvdesk_shelf', 'pvdesk_lyrics', 'pvdesk_policy']) {
        assert.ok(keys.includes(Q + k + Q), k + ' 必须在 keys-audit 登记');
    }
    /* ⑤ 懒加载目录映射（v255 套件用）。 */
    assert.ok(read(V255).includes("pvdeskApp: 'pvdesk'"), 'v255 dirMap 必须登记 pvdesk 目录');
    /* ⑥ 样式段（段头独立成行）。 */
    const css = read(PHONE_CSS);
    assert.ok(css.includes('[v3.43.0] PV 案头'), 'phone.css 必须有本版段头');
    assert.ok(css.includes('.pvd-root'), 'phone.css 必须贴上本件样式正文');
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const mark = '[v3.43.0] PV 案头';
    const idx = css.indexOf(mark);
    assert.ok(idx > 0);
    const lineStart = css.lastIndexOf(NL, idx) + 1;
    const lineEnd = css.indexOf(NL, idx);
    const line = css.slice(lineStart, lineEnd);
    assert.ok(line.startsWith('/*'), '段头行必须以块注释起头，实测：' + line.slice(0, 40));
    assert.ok(line.trimEnd().endsWith('*/'), '段头行必须以块注释收尾，实测：' + line.slice(-40));
    assert.ok(lineStart === 0 || css[lineStart - 1] === NL, '段头不许接在上一段尾后');
    assert.equal(line.split('/*').length, 2, '段头行只许有一个块注释起头');
    /* 段序：本版段必须排在**上一版**段之前（最新版在最前）。
     * ★ 写成绝对形（「heads[0] 必须是本版」）等于给下一版埋一条必红的断言 ——
     *   上一版（v3.42.0）的 C3 正是这么写的，本版已把它改成相对形。 */
    assert.ok(css.indexOf(mark) < css.indexOf('[v3.42.0] 曲库案头'),
        '本版段必须在 v3.42.0 段之前（最新版在最前）');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const phone = read(PHONE_CSS);
    const src = read(PD_CSS).trim();
    assert.ok(phone.indexOf(src) > 0, 'phone.css 里的本版段必须与源文件逐字同源');
});

test('C5 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = read(PD_VIEW);
    const css = read(PD_CSS);
    const produced = new Set();
    for (const m of view.matchAll(/pvd-[a-z0-9-]+/g)) produced.add(m[0]);
    const styled = new Set();
    for (const m of css.matchAll(/\.(pvd-[a-z0-9-]+)/g)) styled.add(m[1]);
    const missing = [];
    for (const c of produced) if (!styled.has(c)) missing.push(c);
    assert.ok(produced.size >= 20, '视图至少要产出二十个类（实测 ' + produced.size + '）');
    assert.ok(missing.length <= 2, '视图产出的类必须有样式落点，缺：' + missing.join('/'));
    /* 样式必须全部挂在 .pvd-root 下（宿主样式不外泄）。 */
    const bare = [];
    for (const line of css.split(NL)) {
        const s = line.trim();
        if (!s.startsWith('.pvd') && !s.startsWith('@') && !s.startsWith('}') && !s.startsWith('/*')
            && !s.startsWith('*') && s.indexOf('{') >= 0) bare.push(s.slice(0, 60));
    }
    assert.deepEqual(bare, [], '样式选择器必须全部挂 .pvd-root 之下');
});

test('C6 视图不自己算内核（那是数据层与 App 的事）', () => {
    const code = stripComments(read(PD_VIEW));
    const imp = code.slice(code.indexOf('import'), code.indexOf('} from'));
    assert.ok(imp.indexOf('PV_FACES') > 0, '视图必须取四态真源');
    assert.equal(imp.indexOf('parseShots') >= 0, false, '视图不许自己解分镜');
    assert.equal(imp.indexOf('parseLrcText') >= 0, false, '视图不许自己解歌词');
    assert.equal(imp.indexOf('holdCheck') >= 0, false, '视图不许自己判上限');
    assert.equal(imp.indexOf('readingsOf') >= 0, false, '视图不许自己算读数');
});

/* ══════════════════════ D — 四块不缝（源的整套能力，本件一律不接） ══════════════════════ */
const codeOf = (rel) => stripComments(read(rel));

test('D1 零音频元件：四件里一个 WebAudio 调用都没有（源自起合成与试听）', () => {
    let all = '';
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) all += codeOf(rel);
    for (const w of ['createGain', 'createOscillator', 'AudioContext', 'new Audio', 'decodeAudioData',
        'encodeWav', 'audioBuffer', 'MediaRecorder']) {
        assert.equal(all.indexOf(w) >= 0, false, '本件不许出现音频元件：' + w);
    }
});

test('D2 零网络：四件里没有任何网络调用（源直连生图与视频生成入口）', () => {
    let all = '';
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) all += codeOf(rel);
    for (const w of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'EventSource',
        'dispatchGenerate', 'generateVideo', 'createTask']) {
        assert.equal(all.indexOf(w) >= 0, false, '本件不许发请求：' + w);
    }
});

test('D3 零出图零成片零外链零数据库：没有任何 URL / data URL / 图片扩展名 / 索引库', () => {
    let all = '';
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) all += codeOf(rel);
    for (const w of ['http', 'data:image', '.png', '.jpg', '.webp', '.mp3', '.wav', '.mp4',
        'indexedDB', 'localStorage', 'sessionStorage']) {
        assert.equal(all.indexOf(w) >= 0, false, '本件不许出现外链 / 二进制 / 宿主库：' + w);
    }
});

test('D4 零宿主界面读：不许 document.getElementById 直读宿主元素（源满篇直读）', () => {
    const all = codeOf(PD_APP) + codeOf(PD_VIEW);
    assert.equal(all.indexOf('getElementById') >= 0, false, '不许直读宿主元素');
    /* 视图只许从自己的 root 与容器里取元素。 */
    const view = codeOf(PD_VIEW);
    assert.ok(view.includes('this._root'), '视图只许在自己的 root 下取元素');
    assert.equal(view.indexOf('document.body') >= 0, false);
});

test('D5 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const code = codeOf(PD_APP);
    const used = new Set();
    for (const m of code.matchAll(/this\.storage\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
    assert.deepEqual([...used].sort(), ['get', 'set'], 'storage 只许走 get / set（实测 ' + [...used].join(',') + '）');
});

/* ══════════════════════ E — 供应链与手写键 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    const data = read(PD_DATA);
    const consumed = stripComments(read(PD_APP)) + stripComments(read(PD_VIEW));
    const names = [];
    for (const m of data.matchAll(/^export (?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)) names.push(m[1]);
    assert.ok(names.length >= 40, '数据层导出数（实测 ' + names.length + '）');
    const own = stripComments(data);
    const orphan = [];
    for (const n of names) {
        if (consumed.indexOf(n) >= 0) continue;
        if (own.split(n).length - 1 > 1) continue;
        orphan.push(n);
    }
    assert.deepEqual(orphan, [], '这些导出在产品侧与数据层内部都零消费（建好了没人用）');
});

test('E2 手写键不许回潮：四态与失败因的键面必须取真源', () => {
    const code = codeOf(PD_APP);
    assert.ok(code.indexOf('const FACE_OK = PV_FACES[') > 0, '面常量必须取真源');
    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' + BS + 's*' + Q).test(code), false,
        '面常量不许手写引号形（必须从真源数组按下标取，本仓 J7 形态）');
    /* 四态色相表：**四档逐档挂真源键**，且四档不许塔成一种色（塔平就是同形）。 */
    const vcode = codeOf(PD_VIEW);
    const toneAt = vcode.indexOf('const FACE_TONE');
    assert.ok(toneAt > 0, '面色相表必须在场');
    const toneBlock = vcode.slice(toneAt, vcode.indexOf('});', toneAt));
    const slots = [];
    for (const m of toneBlock.matchAll(/\[PV_FACES\[(\d)\]\]/g)) slots.push(m[1]);
    assert.equal(slots.length, 4, '四态必须逐档挂色（键面取真源，不许写标识符形）');
    const vals = [];
    for (const m of toneBlock.matchAll(/: '([a-z-]+)'/g)) vals.push(m[1]);
    assert.equal(vals.length, 4, '四档必须各给一个色名');
    assert.ok(new Set(vals).size >= 3, '四态色不许塔成一种');
    /* 文案表键必须取真源值（J7 形态）：手写一套靠碰巧拼写一致对齐，真源增删一态就静默走兜底。 */
    for (const t of ['FACE_TEXT', 'PARSE_WHY_TEXT', 'HOLD_WHY_TEXT']) {
        const at = code.indexOf('const ' + t);
        assert.ok(at > 0, t + ' 必须在场');
        const blk = code.slice(at, code.indexOf('});', at));
        assert.ok(blk.includes('FACE') === false || blk.includes('_FACES[') || blk.includes('_WHYS['),
            t + ' 的键必须取真源常量值');
        assert.ok(blk.includes('_FACES[') || blk.includes('_WHYS['), t + ' 的键必须取真源常量值');
    }
    /* 面常量必须从真源数组**按下标取**，不许手写引号形。 */
    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' + BS + 's*' + Q).test(code), false, '面常量不许手写引号形');
});

/* ══════════════════════ F — 视图层 ══════════════════════ */
test('F1 四态必须分开画：视图画出四态人话与四色徽章（不许塔成一句）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.indexOf('faceTextOf') > 0, '视图必须读四态人话（不自己写一套）');
    assert.ok(code.indexOf('pvd-face-') > 0, '四态必须有各自的样式落点');
    const css = read(PD_CSS);
    for (const t of ['ok', 'warn', 'err']) {
        assert.ok(css.includes('.pvd-face-' + t), '四态色必须有样式：' + t);
    }
});

test('F2 空与坏不同形：读数取不出来画横线（不是零）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('_count'), '视图必须有「取不出来画横线」的统一口');
    assert.ok(code.includes('DASH'), '横线字符必须走拼装形或常量');
    assert.equal(code.indexOf('=== null || v === undefined') >= 0 || code.includes('_count'), true);
    const app = newApp(hostileStorage());
    app.probe();
    for (const row of app.gaugeRows()) assert.equal(row.value, null);
    for (const c of app.readings().cards) assert.equal(c.dash, true, '取不出来必须标 dash');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('String.fromCharCode'), '转义必须走拼装形');
    /* ★ 查的是**源码里的实体写法**：与号后面紧跟实体名 / `#`。
     *   原来那条把裸双引号也列进禁令 —— 可视图本来就要产 `type="checkbox"`，
     *   于是判据自己把自己码死（真源码上必红）。 */
    assert.equal(new RegExp(AMP + '[a-zA-Z#]').test(code), false, '不许写实体字面量（与号后紧跟实体名）');
    assert.ok(code.includes('amp;') && code.includes('quot;'), '拼装形的收尾必须写死在替换里');
});

test('F4 点卡片要能打开：判定必须向上找祖先（不许只认直点元素）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('climb'), '卡片判定必须向上找最近的带标记祖先');
    assert.ok(code.includes('parentNode'), 'climb 必须沿 parentNode 上溯');
    assert.ok(code.includes('data-open'), '卡片必须带打开标记');
    /* 动作按钮必须先于卡片判定（按钮在卡片内部）。 */
    const iAct = code.indexOf("'data-act'");
    const iCard = code.indexOf("'data-open'");
    assert.ok(iAct > 0 && iCard > 0 && iAct < iCard, '动作按钮判定必须先于卡片判定');
});

test('F5 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('_flash'), '视图必须有回执条');
    assert.ok(code.includes('pvd-warn'), '视图必须画警示面');
    assert.ok(code.includes('为什么') || code.includes('没词') || code.includes('没收下'), '失败必须有人话');
    /* 上限面必须给「拒绝原因」，不只丢一句「已裁剪」。 */
    const app = read(PD_APP);
    assert.ok(app.includes('whyTextOf') && app.includes('holdWhyTextOf'), '拒绝原因必须可读');
});

test('F6 分镜体剔行与歌词坏行都要在视图上有落点（源静默剔 / 静默丢）', () => {
    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('bodyCutRows'), '剔行必须画出来');
    assert.ok(code.includes('droppedRows'), '坏行必须画出来');
    assert.ok(code.includes('plainRows'), '无时间戳时的按字数排正文必须画出来');
    assert.ok(code.includes('readerRows'), '六格读数必须画出来');
    assert.ok(code.includes('figMapRowsOf'), '图号映射必须画出来');
    assert.ok(code.includes('cueAt'), '按秒找句必须画出来');
});

/* ══════════════════════ G — 会话键门 ══════════════════════ */
test('G1 四条会话键在 keys-audit 登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['pvdesk_brief', 'pvdesk_shelf', 'pvdesk_lyrics', 'pvdesk_policy']) {
        const at = keys.indexOf(Q + k + Q);
        assert.ok(at > 0, k + ' 必须在册');
        assert.ok(keys.slice(at, at + 80).includes("scope: 'chat'"), k + ' 必须声明 scope=chat');
    }
    assert.ok(read(STORAGE).includes('/^pvdesk_/'), '宽前缀必须在 CHAT_DATA_PATTERNS 里');
});

test('G2 四条键真被产品消费（写面必须落到这四条上）', () => {
    const code = codeOf(PD_APP);
    for (const k of ['BRIEF_KEY', 'SHELF_KEY', 'LYRICS_KEY', 'POLICY_KEY']) {
        assert.ok(code.includes(k), k + ' 必须在产品侧被定义与使用');
    }
    assert.ok(code.includes('pvdesk_brief') && code.includes('pvdesk_shelf')
        && code.includes('pvdesk_lyrics') && code.includes('pvdesk_policy'), '四条键名必须在产品侧出现');
    /* 写面：_writeJSON 只走 storage.set。 */
    assert.ok(code.includes('this.storage.set(key, JSON.stringify(value))'), '写面必须走 storage.set');
    assert.equal(code.includes('setChatData'), false, '不许走别的取数口（keys 门认不出）');
});

/* ══════════════════════ H — 换会话 ══════════════════════ */
test('H1 换会话必须全量重取 + 清视图态（源把这些放在没有角色维度的键下）', () => {
    const st = sessionStorage();
    const app = newApp(st);
    app.ingestReply(shotScript());
    app.saveToShelf({});
    app.ingestLyrics(lrcText());
    app.setDuration(12);
    assert.ok(app.shotRows().length > 0);
    st.switchTo('c2');
    const r = app.onChatChanged();
    assert.equal(r.ok, true);
    assert.equal(app.shotRows().length, 0, '换会话必须丢掉旧题面');
    assert.equal(app.shelfRows().length, 0, '换会话必须丢掉旧台账');
    assert.equal(app.lyricsModeOf(), 'empty', '换会话必须丢掉旧歌词');
    assert.equal(app.durationOf(), DAT.PV_DURATION_DEFAULT, '换会话必须丢掉旧时长');
    assert.equal(app.currentKey(), '', '换会话必须收回焦点');
    assert.equal(app.tab(), 'brief', '换会话必须回到第一页');
});

test('H2 无 storage 也不许崩：四格一起报「取不出来」', () => {
    const app = newApp(null);
    assert.doesNotThrow(() => app.render());
    assert.equal(app.faceOf(), DAT.PV_FACES[3]);
    assert.equal(app.ingestReply('').ok, false);
    assert.equal(app.ingestLyrics('').ok, false);
    assert.doesNotThrow(() => app.clearBrief());
    assert.doesNotThrow(() => app.clearLedger());
    assert.doesNotThrow(() => app.composeText({}));
});

/* ══════════════════════ I — 负控制（真源码破坏 + 在破坏副本上重跑同款真判据） ══════════════════════ */
/** 数据层判据（加载**真破坏副本**后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 区间反了不许静默跳过。 */
    const script = ['镜头1（0-3秒）', '正文', '镜头9（12-8秒）', '反了'].join(NL);
    const r = mod.parseShots(script, {});
    if (r.rejected.length !== 1) bad.push('rejected-shot-unreported');
    /* ② 镜头体不许混入下一镜表头。 */
    for (const s of r.shots) if (s.body.indexOf(mod.PV_SHOT_MARK) >= 0) bad.push('shot-body-leaked-header');
    /* ③ 剔行要计数。 */
    const cut = mod.parseShots(['镜头1（0-3秒）', '正文', '使用的素材：x'].join(NL), {});
    if (cut.bodyCut.length !== 1) bad.push('body-cut-unreported');
    /* ④ LRC 标签必须剥掉。 */
    const lrc = mod.parseLrcText('[00:01.00]第一行' + NL + '[00:02.00]', { duration: 10, maxChars: 40 });
    if (lrc.cues.length !== 1) bad.push('lrc-cue-lost');
    if (lrc.cues[0].text.indexOf('[') >= 0) bad.push('lrc-tag-not-stripped');
    if (lrc.dropped.noText !== 1) bad.push('lrc-notext-lost');
    /* ⑤ 三态不许压平。 */
    if (mod.parseLrcText('', {}).mode !== 'empty') bad.push('lrc-empty-lost');
    if (mod.parseLrcText('一行', {}).mode !== 'untimed') bad.push('lrc-untimed-lost');
    /* ⑥ 时间码补零。 */
    if (mod.formatClock(65).text !== '01:05') bad.push('clock-pad-lost');
    if (mod.formatClock(null).text !== '') bad.push('clock-absent-drawn');
    /* ⑦ 风格四形不许塌。 */
    if (mod.stylePick('').filled !== 'absent') bad.push('style-absent-lost');
    if (mod.stylePick('nope').filled !== 'unknown') bad.push('style-unknown-lost');
    /* ⑧ 画风锚不重复加。 */
    if (mod.applyStyleAnchor(mod.PV_STYLE_ANCHORS[0].anchor, 'cel').filled !== 'already') {
        bad.push('anchor-double-applied');
    }
    /* ⑨ 上限余量不许编 0。 */
    const blank = mod.blankCover('storage_absent');
    if (blank.rows.shots !== null) bad.push('readings-faked-zero');
    if (mod.readingsOf({}).rows.shots.value !== 0) bad.push('real-zero-lost');
    /* ⑩ 回信归一要报认不出的键。 */
    const rep = mod.parseBriefReply(['标题：x', '怪键：y', '正文'].join(NL));
    if (rep.extra.length !== 1) bad.push('extra-key-unreported');
    if (rep.taken.length !== 1) bad.push('taken-key-unreported');
    /* ⑪ 面四态不许塔平。 */
    if (new Set(mod.PV_FACES).size !== 4) bad.push('face-states-collapsed');
    /* ⑫ 真源表条目不许少。 */
    if (mod.PV_PERSPECTIVES.length !== 7) bad.push('perspectives-collapsed');
    if (mod.PV_STYLE_ANCHORS.length !== 4) bad.push('styles-collapsed');
    if (mod.PV_SOURCE_FILES.length !== 7) bad.push('source-files-collapsed');
    return bad;
};

/** App 面判据（在**破坏副本**上真的 new 一个 App 跑）。 */
const appFaceProblems = (mod) => {
    const bad = [];
    const F = DAT.PV_FACES;
    const app = new mod.PvdeskApp(shellStub(), hostileStorage());
    app.probe();
    if (app.faceOf() !== F[3]) bad.push('storage-absent-lost');
    for (const row of app.gaugeRows()) if (row.value !== null) bad.push('projection-not-null-on-absent');
    if (app.readingsOk() !== false) bad.push('readings-not-null-on-absent');
    const empty = new mod.PvdeskApp(shellStub(), memStorage({}));
    empty.probe();
    if (empty.faceOf() !== F[1]) bad.push('empty-face-lost');
    const mal = new mod.PvdeskApp(shellStub(), memStorage({ pvdesk_brief: '{oops' }));
    mal.probe();
    if (mal.faceOf() !== F[2]) bad.push('malformed-face-lost');
    return bad;
};

const appContentProblems = (mod) => {
    const bad = [];
    const app = new mod.PvdeskApp(shellStub(), memStorage({}));
    const r = app.ingestReply(shotScript());
    if (r.ok !== true) bad.push('ingest-lost');
    if (app.shotRows().length !== 2) bad.push('shots-lost');
    for (const s of app.shotRows()) {
        if (s.body && s.body.indexOf(DAT.PV_SHOT_MARK) >= 0) bad.push('shot-body-leaked-header');
    }
    const app2 = new mod.PvdeskApp(shellStub(), memStorage({}));
    app2.ingestReply(shotScript());
    const before = app2.shotRows().length;
    app2.ingestReply('');
    if (app2.shotRows().length !== before) bad.push('failed-ingest-wiped-brief');
    const app3 = new mod.PvdeskApp(shellStub(), memStorage({}));
    app3.ingestLyrics(lrcText());
    if (app3.lyricsInfo().noText !== 1) bad.push('lyrics-drop-lost');
    if (app3.cueAt(1.5).ok !== true) bad.push('cue-at-lost');
    return bad;
};

const appGateProblems = (mod) => {
    const bad = [];
    const app = new mod.PvdeskApp(shellStub(), memStorage({}));
    if (app.setDuration('99').ok !== false) bad.push('duration-gate-lost');
    if (app.setMaxChars('99').ok !== false) bad.push('maxchars-gate-lost');
    if (app.setLang('nope').ok !== false) bad.push('lang-gate-lost');
    if (app.setStyle('nope').ok !== false) bad.push('style-gate-lost');
    if (app.removeFromShelf(9).ok !== false) bad.push('shelf-range-lost');
    if (app.saveToShelf({}).ok !== false) bad.push('shelf-empty-brief-lost');
    for (let i = 0; i < DAT.PV_LEDGER_MAX + 3; i++) app.ingestLyrics('一行' + NL + i);
    if (app.ledgerInfo().dropped <= 0) bad.push('ledger-drop-unreported');
    return bad;
};

const appChatProblems = (mod) => {
    const bad = [];
    const st = sessionStorage();
    const app = new mod.PvdeskApp(shellStub(), st);
    app.ingestReply(shotScript());
    app.saveToShelf({});
    st.switchTo('c2');
    app.onChatChanged();
    if (app.shotRows().length !== 0) bad.push('chat-change-no-brief-reload');
    if (app.shelfRows().length !== 0) bad.push('chat-change-no-shelf-reload');
    if (app.durationOf() !== DAT.PV_DURATION_DEFAULT) bad.push('chat-change-no-policy-reload');
    return bad;
};

const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    const at = code.indexOf('const FACE_TONE');
    if (at < 0) { bad.push('face-tone-missing'); return bad; }
    const block = code.slice(at, code.indexOf('});', at));
    /* ① 四档必须逐档挂真源键（写标识符形 = 真源增删一态就静默走兜底）。 */
    const slots = [];
    for (const m of block.matchAll(/\[PV_FACES\[(\d)\]\]/g)) slots.push(m[1]);
    if (slots.length !== 4) bad.push('face-tone-slots');
    /* ② 表里**指着别人**（`FACE_TONE[PV_FACES[0]]`）= 四态塔平。 */
    if (block.indexOf('FACE_TONE[') >= 0) bad.push('face-tone-not-by-source');
    /* ③ 四档取值不许塌成一种色。 */
    const vals = [];
    for (const m of block.matchAll(/: '([a-z-]+)'/g)) vals.push(m[1]);
    if (new Set(vals).size < 3) bad.push('face-tone-collapsed');
    return bad;
};

const viewCountProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.indexOf('? DASH : String(v)') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('String.fromCharCode') < 0) bad.push('escaping-literal');
    return bad;
};

const viewClimbProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.indexOf('parentNode') < 0) bad.push('card-climb-lost');
    /* ★ 顺序判据必须落在**点击处理段内**：拿整文件的首次出现太松 ——
     *   页面里的按钮自带 data-act 字面量，把判定顺序调换后整文件首次出现不变。 */
    const hAt = code.indexOf("addEventListener('click'");
    if (hAt < 0) { bad.push('click-handler-missing'); return bad; }
    const seg = code.slice(hAt);
    const iAct = seg.indexOf("getAttribute('data-act')");
    const iRm = seg.indexOf("getAttribute('data-rm')");
    const iCard = seg.indexOf("getAttribute('data-open')");
    if (iCard < 0) bad.push('card-mark-lost');
    /* ★ 卡片判定必须**走 climb**：只要求「文件里有 parentNode」太松 ——
     *   把卡片判定退回直点元素时 climb 仍在（动作按钮还在用），判据照样绿。 */
    if (iCard > 0) {
        /* ★ 基底必须是**段内**：iCard 是 seg 的相对下标，
         *   拿 code 取近邻会拿到无关位置（真源码上就会误报）。 */
        const near = seg.slice(Math.max(0, iCard - 70), iCard + 40);
        if (near.indexOf('climb(') < 0) bad.push('card-climb-lost');
    }
    if (!(iAct > 0 && iRm > 0 && iAct < iRm)) bad.push('card-climb-order-lost');
    if (!(iAct > 0 && iCard > 0 && iAct < iCard)) bad.push('card-climb-order-lost');
    return bad;
};

const dataKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    for (const t of ['PV_PARSE_WHYS', 'PV_HOLD_WHYS']) {
        const at = code.indexOf('export const ' + t + ' = Object.freeze([');
        if (at < 0) { bad.push(t + '-missing'); continue; }
        const seg = code.slice(at, at + 200);
        const vals = [];
        for (const v of seg.matchAll(/'([^']*)'/g)) vals.push(v[1]);
        if (vals.length < 4) bad.push(t + '-short');
        for (const v of vals) {
            /* ★ 失败因必须是**键**（ASCII 标识符形），不许是给用户看的中文话：
             *   原来查「有没有空格」——中文话本来就没空格，破坏后照样绿
             *   （判据自己把自己码死，本仓反复踩的那一条）。 */
            if (!/^[a-z][a-z0-9_]*$/.test(v)) bad.push('why-not-key');
        }
        if (new Set(vals).size !== vals.length) bad.push(t + '-collapsed');
    }
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 区间反了照收（源就是这个形态）。 */
    q1: [PD_DATA,
        '        if (h.a > h.b) {' + NL + "            rejected.push({ n: h.n, saw: h.a + '-' + h.b });" + NL + '            continue;' + NL + '        }',
        '        if (false) {' + NL + "            rejected.push({ n: h.n, saw: h.a + '-' + h.b });" + NL + '            continue;' + NL + '        }'],
    /* ② 切割位置退回「下一表头结束 − 表头字数」（本版真踩到的那一处）。 */
    q2: [PD_DATA,
        '        const segEnd = (k + 1 < heads.length) ? heads[k + 1].start : work.length;',
        '        const segEnd = (k + 1 < heads.length) ? heads[k + 1].end - PV_SHOT_MARK.length : work.length;'],
    /* ③ 剔行不计数（源静默剔）。 */
    q3: [PD_DATA,
        '            if (trimmed.indexOf(PV_BODY_DROP_MARK) === 0) { cut += 1; continue; }',
        '            if (trimmed.indexOf(PV_BODY_DROP_MARK) === 0) { continue; }'],
    /* ④ LRC 标签不再剥掉（本版真踩到的那一处）。 */
    q4: [PD_DATA,
        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        cursor = spans[i].end;',
        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        out += line.slice(at, spans[i].end);'],
    /* ⑤ 空正文行不再计数（源只继续不报）。 */
    q5: [PD_DATA,
        '        if (!e.text) { dropped.noText += 1; continue; }',
        '        if (!e.text) { continue; }'],
    /* ⑥ 时间码不补零（源就是这个形态）。 */
    q6: [PD_DATA,
        "    return { text: (mm < 10 ? ('0' + mm) : String(mm)) + ':' + ssText, ok: true };",
        "    return { text: mm + ':' + ssText, ok: true };"],
    /* ⑦ 画风四形塔平（源两处都写「未指定」）。 */
    q7: [PD_DATA,
        "    if (!key) return { filled: 'absent', saw: '', anchor: '', key: '' };",
        "    if (!key) return { filled: 'unknown', saw: '', anchor: '', key: '' };"],
    /* ⑧ 画风锚重复加（源先查前 8 字，本件把这一步去掉）。 */
    q8: [PD_DATA,
        '    if (base.indexOf(marker) >= 0) return { text: base, applied: false, filled: ' + Q + 'already' + Q + ' };',
        '    if (false) return { text: base, applied: false, filled: ' + Q + 'already' + Q + ' };'],
    /* ⑨ 读数编 0（空与坏塔平）。 */
    q9: [PD_DATA,
        '    for (let i = 0; i < PV_READ_KEYS.length; i++) rows[PV_READ_KEYS[i]] = null;',
        '    for (let i = 0; i < PV_READ_KEYS.length; i++) rows[PV_READ_KEYS[i]] = { value: 0, of: 0, pct: null };'],
    /* ⑩ 回信归一不报认不出的键（源把「不认识的键」当正文收走）。 */
    q10: [PD_DATA,
        '        out.extra.push(key);' + NL + '        out.brief = out.brief ? out.brief + CHAR_NL + line : line;',
        '        out.brief = out.brief ? out.brief + CHAR_NL + line : line;'],
    /* ⑪ 面四态塔平（源整页没有「可不可信」这一句）。 */
    q11: [PD_DATA,
        'export const PV_FACES = Object.freeze([' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'malformed' + Q + ', ' + Q + 'absent' + Q + ']);',
        'export const PV_FACES = Object.freeze([' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'absent' + Q + ']);'],
    /* ⑫ 源文件清单漏主件（源是一族七件）。 */
    q12: [PD_DATA,
        "    'niconico.js'," + NL + "    'niconico-pv-form.js',",
        "    'niconico-pv-form.js',"],
    /* ⑬ App：取不出来当没事（源把取不到读成空）。 */
    /* ★ 锚点必须落在**真会被走到的**那一行：那道 `_storageUsable()` gate
     *   在 hostileStorage 下根本不进（它 get/set 都在，gate 判的是「这两个口在不在」）。 */
    q13: [PD_APP,
        "        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }",
        "        catch (e) { return { ok: true, why: 'absent', value: undefined }; }"],
    /* ⑭ App：写了但认不出来当空（源就是把它当空）。 */
    q14: [PD_APP,
        "            return { face: FACE_MALFORMED, why: 'json' };",
        "            return { face: FACE_EMPTY, why: 'json' };"],
    /* ⑮ App：读数格在取不出来时给 0（视图会画成「真的 0」）。 */
    q15: [PD_APP,
        '                value: cell ? cell.value : null,',
        '                value: cell ? cell.value : 0,'],
    /* ⑯ App：失败时把现有题面清掉（源在解析失败时也会清一遍）。 */
    /* ★ 锚点落在**空输入那条分支**：原来挂在末尾失败分支上，
     *   而 ingestReply('') 在开头就 return 了，末尾那行走不到（破坏不可观测）。 */
    q16: [PD_APP,
        "            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });",
        '            this._brief = ' + Q + Q + ';' + NL + '            this._face = FACE_EMPTY;' + NL
        + '            this._recompute();' + NL
        + "            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0, wiped: true });"],
    /* ⑰ App：时长档取值门塔平（坏值照收）。 */
    q17: [PD_APP,
        '        if (n === null || n < PV_DURATION_MIN || n > PV_DURATION_MAX) {' + NL + "            return { ok: false, reason: 'out_of_range', saw: sec, min: PV_DURATION_MIN, max: PV_DURATION_MAX };",
        '        if (false) {' + NL + "            return { ok: false, reason: 'out_of_range', saw: sec, min: PV_DURATION_MIN, max: PV_DURATION_MAX };"],
    /* ⑱ App：台账挤掉不计数（源静默 shift）。 */
    q18: [PD_APP,
        '        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); this._dropped += 1; }',
        '        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); }'],
    /* ⑲ App：换会话不重取（源就是切角色原样留着）。 */
    /* ★ 破坏必须把**整页清**与**重取**一起拿掉：只关掉 probe
     *   时 `_clearToDefaults()` 仍会把内存态清干净，而判据看的正是内存态。 */
    q19: [PD_APP,
        '    onChatChanged() {' + NL + '        this._clearToDefaults();' + NL + "        this._tab = 'brief';" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;' + NL + '        this.probe();',
        '    onChatChanged() {' + NL + "        this._tab = 'brief';" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;'],
    /* ⑳ 视图：面色相塔平（四态只有一种色）。 */
    q20: [PD_VIEW,
        "    [PV_FACES[2]]: 'err',",
        "    [PV_FACES[2]]: FACE_TONE[PV_FACES[0]],"],
    /* ㉑ 视图：卡片判定退回直点元素。 */
    q21: [PD_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);",
        "            const cardEl = (t.getAttribute('data-open') !== null) ? t : null;"],
    /* ㉒ 视图：空与坏塔成一话（null 也当零画）。 */
    q22: [PD_VIEW,
        '        return (v === null || v === undefined) ? DASH : String(v);',
        '        return String(v === null || v === undefined ? 0 : v);'],
    /* ㉓ 视图：动作按钮判定挪到卡片之后（点按钮会把卡片吃掉）。 */
    /* ★ 顺序破坏只需把两段对调（原替换体带了个暂时变量，
     *   那不是真编辑）。判据在**点击处理段内**比先后才能观测。 */
    q23: [PD_VIEW,
        "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }' + NL + "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);",
        "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);" + NL + "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }'],
    /* ㉔ 视图：下拉取值退回只认 key（时长档每一项都变 undefined）。 */
    q24: [PD_VIEW,
        "            const v = (it.key === undefined) ? String(it.n) : it.key;",
        '            const v = it.key;'],
    /* ㉕ 数据层：失败因写成中文话（程序没法比对）。 */
    q25: [PD_DATA,
        "export const PV_PARSE_WHYS = Object.freeze(['empty', 'no_header', 'too_many', 'over_limit']);",
        "export const PV_PARSE_WHYS = Object.freeze(['没给内容', 'no_header', 'too_many', 'over_limit']);"],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3430_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const kd = path.join(dir, 'apps', 'pvdesk');
    fs.mkdirSync(kd, { recursive: true });
    for (const f of ['pvdesk-data.js', 'pvdesk-view.js', 'pvdesk-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'pvdesk', f), path.join(kd, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「区间反了要逐条报」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['rejected-shot-unreported']],
    ['I2 破坏「镜头体不许混入下一镜表头」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['shot-body-leaked-header']],
    ['I3 破坏「剔行要计数」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['body-cut-unreported']],
    ['I4 破坏「LRC 标签必须剥掉」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['lrc-tag-not-stripped']],
    ['I5 破坏「空正文行要计数」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['lrc-notext-lost']],
    ['I6 破坏「时间码补零」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['clock-pad-lost']],
    ['I7 破坏「风格没给与认不出不同形」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['style-absent-lost']],
    ['I8 破坏「画风锚不重复加」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['anchor-double-applied']],
    ['I9 破坏「读数不许编 0」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['readings-faked-zero']],
    ['I10 破坏「认不出的键要留痕」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['extra-key-unreported']],
    ['I11 破坏「面四态不许塔平」⇒ 内核判据必须转红', 'q11', 'data', dataProblems, ['face-states-collapsed']],
    ['I12 破坏「源文件清单要齐七件」⇒ 内核判据必须转红', 'q12', 'data', dataProblems, ['source-files-collapsed']],
    ['I13 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q13', 'appmod', appFaceProblems,
        ['storage-absent-lost', 'projection-not-null-on-absent']],
    ['I14 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q14', 'appmod', appFaceProblems, ['malformed-face-lost']],
    ['I15 破坏「读数格取不出来给 0」（App）⇒ 行为判据必须转红', 'q15', 'appmod', appFaceProblems,
        ['projection-not-null-on-absent']],
    ['I16 破坏「失败不许动现有题面」（App）⇒ 行为判据必须转红', 'q16', 'appmod', appContentProblems,
        ['failed-ingest-wiped-brief']],
    ['I17 破坏「时长取值门」（App）⇒ 行为判据必须转红', 'q17', 'appmod', appGateProblems, ['duration-gate-lost']],
    ['I18 破坏「台账挤掉要计数」（App）⇒ 行为判据必须转红', 'q18', 'appmod', appGateProblems, ['ledger-drop-unreported']],
    ['I19 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appChatProblems,
        ['chat-change-no-brief-reload', 'chat-change-no-shelf-reload', 'chat-change-no-policy-reload']],
    ['I20 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q20', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I21 破坏「点卡片向上找祖先」（视图）⇒ 视图判据必须转红', 'q21', 'src', viewClimbProblems, ['card-climb-lost']],
    ['I22 破坏「空与坏不同形」（视图）⇒ 视图判据必须转红', 'q22', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I23 破坏「动作按钮判定先于卡片」（视图）⇒ 视图判据必须转红', 'q23', 'src', viewClimbProblems, ['card-climb-order-lost']],
    ['I24 破坏「下拉要认时长档的 n」（视图）⇒ 结构判据必须转红', 'q24', 'src', (src) => {
        const code = stripComments(src);
        return code.includes('it.n') ? [] : ['duration-option-value-lost'];
    }, ['duration-option-value-lost']],
    ['I25 破坏「失败因必须是键」（数据层结构面）⇒ 结构判据必须转红', 'q25', 'src', dataKeyProblems, ['why-not-key']],
];

for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 60));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judge(damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(src), [], '对照：真源码必须干净');
            return;
        }
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judge(mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        const real = (kind === 'data') ? DAT : APP;
        assert.deepEqual(judge(real), [], '对照：真模块必须干净');
    });
}

/* ====================== J - 判据工具自证 ====================== */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'fetch(' + Q + ';').includes('fetch('), '字符串里的同形文本必须留住');
    /* ★ 被审三件必须能让剥器复位（尾随哨兵）：剥完不许把哨兵也吃掉。 */
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) {
        const src = read(rel) + NL + 'const SENTINEL_TAIL = 1;' + NL;
        assert.ok(stripComments(src).trimEnd().endsWith('const SENTINEL_TAIL = 1;'),
            rel + ' 必须能让剥器复位（否则说明代码里有裸引号骗住了状态机）');
    }
});

test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, key + ' 的锚点必须恰中 1 次');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3430k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J4 十一道静态门必须在场（含本版缺陷所属的那几道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});

test('J5 判据两向自证：真模块上每一条行为判据都必须干净（且真的会跑）', () => {
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), []);
    assert.deepEqual(appContentProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(viewFaceProblems(read(PD_VIEW)), []);
    assert.deepEqual(viewClimbProblems(read(PD_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(PD_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(PD_DATA)), []);
});

test('J6 被审代码的字符纪律：不许正则字面量 / 反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [PD_DATA, PD_APP, PD_VIEW]) {
        const src = read(rel);
        const code = stripComments(src);
        /* 反斜杠：源码里一处都不许有（转义一律走 String.fromCharCode）。 */
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        /* 反引号：模板字符串禁用。 */
        assert.equal(src.indexOf('`') >= 0, false, rel + ' 不许出现反引号');
        /* 正则字面量：被审代码里不许有（剥器不解析它）。 */
        assert.equal(/=\s*\/[^\/\s][^\n]*\/[gimsuy]*\s*[;.,)]/.test(code), false, rel + ' 不许出现正则字面量');
    }
});

/* ====================== K - 版本与交棒 ====================== */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 43),
        '本套件成立于 RubyPhone 3.43.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
    /* 公告块与 update-log 逐字同源（本仓硬判据）。 */
    const items = rec.items || rec.changes;
    for (const it of items) assert.ok(src.includes(JSON.stringify(it)), '公告块必须与条目逐字同源');
});

test('K2 交棒必须指向第 3 层下一步的真实现状（路线图字面不成立时以实测为准）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.43.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('PV 案头'), 'v3.43.0 条目必须自述本件名');
    assert.ok(text.includes('niconico'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
    assert.ok(text.includes('EPHONE') || text.includes('ephone') || text.includes('html-fragments'),
        '交棒必须写明 EPhone 一族的实测结论');
});
