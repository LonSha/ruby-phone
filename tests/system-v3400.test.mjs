// tests/system-v3400.test.mjs — 对话水壶 [v3.40.0]
//
// 本套件守四件事：
//  ① 收话内核的六条口径（轮次数不出来不许与「聊了很久」同形 /
//     选项不足三个不许当合格的一组 / 场景缺了不许沿用上一次的地点 /
//     单字语气词不许被静默保存 / 记录取不出来不许与「还没记过」同形 /
//     换会话后旧记录与旧回执不许留着）；
//  ② 四块不缝真的没缝（零网络零密钥 / 不碰宿主对象 / 不跨 App 读 / 不收外链不落数据库）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 / v3.36 / v3.37 / v3.38 / v3.39 各踩过一次）：
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
import * as DAT from '../apps/kettle/kettle-data.js';
import * as APP from '../apps/kettle/kettle-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KT_DATA = 'apps/kettle/kettle-data.js';
const KT_APP = 'apps/kettle/kettle-app.js';
const KT_VIEW = 'apps/kettle/kettle-view.js';
const KT_CSS = 'apps/kettle/kettle.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
/** 单引号（破坏表里拼锚点用）：一律拼装形，不写裸引号。 */
const Q = String.fromCharCode(39);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300…v3390 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故本件的被审代码一律字串比对、不写正则字面量，
 *    并在 L 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
            if (c === Q || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        /* 字符串态：本件被审代码不许有裸引号，故只需处理转义与收尾。 */
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
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
        set: (k, v) => { box.set(k, v); return true; },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^kettle_/` 前缀拼 chatId 实现）。
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
const newApp = (storage) => new APP.KettleApp(shellStub(), storage);

/** 一段合法的对话（五行 / 两个 assistant 轮）。 */
const talk = (over = {}) => Object.assign({
    partner: '阿棠',
    shop: '巷口那家汤铺',
    at: '2026-10-04 晚',
    messages: [
        { role: 'user', content: '今天汤滚得慢。' },
        { role: 'assistant', content: '那就等它滚。' },
        { role: 'user', content: '不急。' },
        { role: 'assistant', content: '我给你讲讲这口锅的来历。' }
    ]
}, over);

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 轮次数不出来不许与「聊了很久」同形（源 NaN 落「很久」、0 落「短暂」，两处都反）', () => {
    /* 三种坏值：NaN / 负数 / 小数 / 非数。 */
    for (const bad of [NaN, -1, 1.5, 'abc', null, undefined, '', []]) {
        const b = DAT.roundBucketOf(bad);
        assert.equal(b.ok, false, '坏值必须报数不出来：' + String(bad));
        assert.equal(b.bucket, null, '坏值不许落进任何一档：' + String(bad));
        assert.equal(b.label, DAT.KETTLE_ROUND_UNKNOWN);
    }
    /* ★ 源的两处反向：rounds=NaN 落「很久」、rounds=0 落「短暂」。 */
    assert.notEqual(DAT.roundBucketOf(NaN).label, DAT.KETTLE_ROUND_META[DAT.KETTLE_ROUND_BUCKETS[2]].label,
        '数不出来不许与「坐下聊了很久」同形');
    /* ★ 0 也不行：源在 rounds=0（一条 assistant 都没有）时落「短暂」，
     *   于是「根本没聊」与「聊了两句」同形 —— 这一处也是要修的。 */
    const zero = DAT.roundBucketOf(0);
    assert.equal(zero.ok, false, '0 条 assistant = 没聊起来，不许被说成「三言两语」');
    assert.notEqual(zero.label, DAT.KETTLE_ROUND_META[DAT.KETTLE_ROUND_BUCKETS[0]].label,
        '0 不许与首档同形');
    /* 三档边界：2/3 与 5/6。 */
    assert.equal(DAT.roundBucketOf(2).bucket, DAT.KETTLE_ROUND_BUCKETS[0]);
    assert.equal(DAT.roundBucketOf(3).bucket, DAT.KETTLE_ROUND_BUCKETS[1]);
    assert.equal(DAT.roundBucketOf(5).bucket, DAT.KETTLE_ROUND_BUCKETS[1]);
    assert.equal(DAT.roundBucketOf(6).bucket, DAT.KETTLE_ROUND_BUCKETS[2]);
    assert.equal(DAT.roundBucketOf(999).bucket, DAT.KETTLE_ROUND_BUCKETS[2], '末档无上限');
    /* 真源表三档都在场（视图与校验共用这一张）。 */
    assert.equal(DAT.KETTLE_ROUND_BUCKETS.length, 3);
    assert.equal(DAT.KETTLE_ROUND_META[DAT.KETTLE_ROUND_BUCKETS[2]].max, null, '末档无上限');
});

test('A2 计数口唯一：assistant 条数只在一处数（源在四处各数了一遍）', () => {
    assert.equal(DAT.countRounds(talk().messages), 2);
    assert.equal(DAT.countRounds([]), 0);
    assert.equal(DAT.countRounds(null), null, '拿不到数组 = 数不出来（不是 0）');
    assert.equal(DAT.countRounds('nope'), null);
    /* 坏元素不许算进去，也不许崩。 */
    assert.equal(DAT.countRounds([null, 1, { role: 'assistant' }, { role: 'user' }]), 1);
    /* ★ 分工：拿不到数组 ⇒ null ⇒ 数不出来；空数组 ⇒ 0 ⇒ **也是数不出来**
     *   （「没聊起来」与「三言两语」不同形 —— 源在这里把两者塔成一档）。 */
    assert.equal(DAT.countRounds(null), null);
    assert.equal(DAT.roundBucketOf(DAT.countRounds(null)).ok, false);
    assert.equal(DAT.roundBucketOf(DAT.countRounds([])).ok, false);
});

test('A3 选项要裁：不足三个与超过三个都不许当合格的一组（源 split 后照单全收）', () => {
    const ok = DAT.parseOptions('尾行 选项: 问他锅的来历 | 换一家店 | 沉默一会儿');
    assert.equal(ok.face, DAT.KETTLE_OPTION_FACES[0]);
    assert.equal(ok.items.length, 3);
    assert.equal(ok.dropped, 0);
    /* 不足三个。 */
    const few = DAT.parseOptions('选项: 走 | 留');
    assert.equal(few.face, DAT.KETTLE_OPTION_FACES[1], '两个选项只能是「不满三个」');
    assert.equal(few.items.length, 2, '不合格也要如实报出几条（不是丢空）');
    /* 超过三个：封顶 + 报丢弃数。 */
    const many = DAT.parseOptions('选项: a | b | c | d | e | f | g | h');
    assert.equal(many.face, DAT.KETTLE_OPTION_FACES[2]);
    assert.equal(many.items.length, DAT.KETTLE_OPTIONS_MAX);
    assert.equal(many.dropped, 2, '多出来的必须报出去掉几条');
    /* 没有选项段。 */
    assert.equal(DAT.parseOptions('就是一段话，没有选项').face, DAT.KETTLE_OPTION_FACES[3]);
    assert.equal(DAT.parseOptions('选项:').face, DAT.KETTLE_OPTION_FACES[3]);
    assert.equal(DAT.parseOptions('选项:  |  ').face, DAT.KETTLE_OPTION_FACES[3]);
    /* 空串选项与重复选项：丢掉并报数。 */
    const dirty = DAT.parseOptions('选项: 走 |  | 走 | 留 | 等');
    assert.equal(dirty.items.length, 3);
    assert.equal(dirty.dropped, 2, '空白 + 重复各算一次丢弃');
    assert.deepEqual(dirty.items, ['走', '留', '等']);
    /* 单条封顶。 */
    const longOne = DAT.parseOptions('选项: ' + 'x'.repeat(50) + ' | b | c');
    assert.equal(longOne.items[0].length, DAT.KETTLE_OPTION_MAX_LEN);
    /* 四态互不同形。 */
    const faces = [ok.face, few.face, many.face, DAT.parseOptions('无').face];
    assert.equal(new Set(faces).size, 4, '四态必须互不同形');
    assert.equal(DAT.KETTLE_OPTION_FACES.length, 4);
});

test('A4 场景标签缺了不许沿用上一次的地点（源解析失败时保留旧标签）', () => {
    const good = DAT.parseScene('场景: 汤铺\n正文');
    assert.equal(good.state, DAT.KETTLE_SCENE_STATES[0]);
    assert.equal(good.scene, '汤铺');
    /* 没标 = absent，且 scene 是**空的**（不许外推上一条）。 */
    const none = DAT.parseScene('正文里没有场景段');
    assert.equal(none.state, DAT.KETTLE_SCENE_STATES[1]);
    assert.equal(none.scene, '', '缺了就是空 —— 不许把上一次的地点留着');
    /* 两种合法形态都要认：行内形与方括号形。 */
    assert.equal(DAT.parseScene('场景: 汤铺').state, DAT.KETTLE_SCENE_STATES[0], '行内形是合法的');
    assert.equal(DAT.parseScene('[场景: 汤铺]').state, DAT.KETTLE_SCENE_STATES[0], '方括号形是合法的');
    /* 标了但认不出来 = malformed。 */
    assert.equal(DAT.parseScene('场景: ').state, DAT.KETTLE_SCENE_STATES[2], '空的 = 认不出来');
    assert.equal(DAT.parseScene('场景: ' + '很长'.repeat(10)).state, DAT.KETTLE_SCENE_STATES[2], '超长 = 认不出来');
    /* 三态互不同形。 */
    const st = [good.state, none.state, DAT.parseScene('场景: ').state];
    assert.equal(new Set(st).size, 3);
    assert.equal(DAT.KETTLE_SCENE_STATES.length, 3);
    /* 换地方 ⇒ 新地点，且旧的痕迹不留。 */
    assert.equal(DAT.parseScene('场景: 面馆\n汤铺那件事').scene, '面馆');
});

test('A5 单字语气词：登记，不保存（源把它做成气泡；本仓口径不保留）', () => {
    const r = DAT.soloRegister('嗯——那就等着。');
    assert.equal(r.hits, 1);
    assert.deepEqual(r.chars, ['嗯']);
    assert.equal(r.canKeep, false, '**不许**保留 —— 这条是硬口径');
    assert.equal(r.lone, 0, '这句话除了语气词还有别的词，不算「整句只有一个字」');
    /* lone 的定义：去空白去标点之后**只剩一个语气词**。 */
    assert.equal(DAT.soloRegister('嗯').lone, 1, '整句一个字 = lone');
    assert.equal(DAT.soloRegister('嗯。').lone, 1, '标点不算字');
    assert.equal(DAT.soloRegister(' 欸 ').lone, 1, '空白不算字');
    assert.equal(DAT.soloRegister('嗯。那就等着').lone, 0);
    /* 多字语气词混排。 */
    const many = DAT.soloRegister('哦，啊，欸——你说的对。');
    assert.equal(many.hits, 3);
    assert.deepEqual(many.chars, ['哦', '啊', '欸']);
    assert.equal(many.lone, 0);
    /* 台账面要能回答「出现过哪几个」（单一份词表）。 */
    assert.equal(DAT.KETTLE_SOLO_CHARS.length, 10);
    assert.ok(DAT.KETTLE_SOLO_WHY.length > 0, '「为什么不留」必须有单一份说明');
    assert.equal(DAT.soloRegister('这句话里一个语气词都没有。').hits, 0);
});

test('A6 破折号是一种读数，不是风格禁令（源自己在旁白里插）', () => {
    const calm = DAT.dashAudit('他说了一句平平常常的话，没有任何插入语。');
    assert.equal(calm.total, 0);
    assert.equal(calm.dense, false);
    /* total 是**字符数**（每处双破折号算两下）；一行里 10 个字符 ⇒ 偏密（阈值 8）。 */
    const dense = DAT.dashAudit('他——停顿——又开口——说了半句——就停下——真的。');
    assert.equal(dense.total, 10);
    assert.equal(dense.dense, true);
    assert.equal(dense.worstRun, 10);
    assert.equal(dense.worstAt, 0, '要报最密的是第几行');
    assert.ok(dense.why.length > 0);
    /* 同一处数在**多行**上摊开就不算密（密度是每行的观感）。 */
    const spread = DAT.dashAudit(['一——', '二——', '三——', '四——', '五——'].join(NL));
    assert.equal(spread.total, 10);
    assert.equal(spread.worstRun, 2);
    assert.equal(spread.dense, false, '摊开在五行上不算密');
    assert.equal(spread.lines, 5);
    assert.equal(spread.longLines, 0);
    /* 阈值常量在场。 */
    assert.equal(DAT.KETTLE_DASH_CHAR, '—');
    assert.equal(DAT.KETTLE_DASH_LONG, 8);
    assert.equal(DAT.KETTLE_DASH_MAX_RUN, 2);
});

test('A7 记录取值三态：取不出来 / 没写过 / 写了但认不出来（源三种都塔成空列表）', () => {
    const absent = DAT.noteStateOf(null);
    assert.equal(absent.state, DAT.KETTLE_NOTE_STATES[1]);
    assert.equal(DAT.noteStateOf('').state, DAT.KETTLE_NOTE_STATES[1]);
    assert.equal(DAT.noteStateOf('   ').state, DAT.KETTLE_NOTE_STATES[1]);
    const bad = DAT.noteStateOf('{bad json');
    assert.equal(bad.state, DAT.KETTLE_NOTE_STATES[2], '坏 JSON 不许当「没写过」');
    assert.ok(bad.saw.length > 0, '坏内容要留一段原文供排查');
    assert.equal(DAT.noteStateOf('{"a":1}').state, DAT.KETTLE_NOTE_STATES[2], '不是数组也算认不出来');
    assert.equal(DAT.noteStateOf('42').state, DAT.KETTLE_NOTE_STATES[2]);
    const good = DAT.noteStateOf('[{"a":1}]');
    assert.equal(good.state, DAT.KETTLE_NOTE_STATES[0]);
    assert.equal(good.notes.length, 1);
    /* 直接给数组也认。 */
    assert.equal(DAT.noteStateOf([{ a: 1 }]).state, DAT.KETTLE_NOTE_STATES[0]);
    const st = [good.state, absent.state, bad.state];
    assert.equal(new Set(st).size, 3, '三态必须互不同形');
    assert.equal(DAT.KETTLE_NOTE_STATES.length, 3);
});

test('A8 封包三因各自报出：没有正文 / 没有对面的人 / 轮次数不出来（源三种都静默落残缺记录）', () => {
    assert.equal(DAT.settleRecord(talk()).ok, true);
    const noNote = DAT.settleRecord({ partner: '阿棠', messages: [] });
    assert.equal(noNote.ok, false);
    assert.deepEqual(noNote.reasons, ['no_note'], '没有正文与轮次数不出来是两件事，不许塔成一个');
    assert.ok(noNote.labels.length === 1);
    const noPartner = DAT.settleRecord({ messages: talk().messages });
    assert.equal(noPartner.ok, false);
    assert.deepEqual(noPartner.reasons, ['no_partner']);
    assert.equal(noPartner.labels[0], DAT.KETTLE_SETTLE_REASONS.no_partner.label);
    /* ★ 三因不许塔成一个「有问题」：三张标签互不相同。 */
    const labels = ['no_note', 'no_partner', 'bad_rounds'].map((k) => DAT.KETTLE_SETTLE_REASONS[k].label);
    assert.equal(new Set(labels).size, 3);
    for (const k of ['no_note', 'no_partner', 'bad_rounds']) {
        assert.ok(DAT.KETTLE_SETTLE_REASONS[k].why.length > 0, k + ' 必须写清后果');
    }
    /* 封好的包里必须带可读快照（且快照里不许有选项段与场景段）。 */
    const pack = DAT.settleRecord(talk({
        messages: [
            { role: 'assistant', content: '场景: 汤铺\n那就等它滚。\n选项: 走 | 留 | 等' },
            { role: 'assistant', content: '第二句' }
        ]
    }));
    assert.equal(pack.ok, true);
    assert.equal(pack.snapshot[0].text.indexOf('选项:'), -1, '快照里不许留选项段');
    assert.equal(pack.snapshot[0].text.indexOf('场景:'), -1, '快照里不许留场景段');
    assert.equal(pack.firstLine, '那就等它滚。', '首句必须是摘掉标签之后的那一句');
    assert.equal(pack.rounds, 2);
});

test('A9 拆一段对话：拆不出说话人的行必须报出（源假定手里已是数组，分不出也没处报）', () => {
    const sp = DAT.splitTranscript('阿棠：今天汤滚得慢。' + NL + '我：那就等它滚。' + NL + '阿棠：好。', '阿棠');
    assert.equal(sp.messages.length, 3);
    assert.deepEqual(sp.messages.map((m) => m.role), ['assistant', 'user', 'assistant']);
    assert.equal(sp.unattributed, 1, '「我」不是伙伴名 ⇒ 算拆不出（如实报数）');
    assert.equal(DAT.countRounds(sp.messages), 2);
    /* 一句话里的冒号（前缀过长）不许把整行切碎。 */
    const long = DAT.splitTranscript('他说了一句很长很长很长很长很长的话：真的。', '阿棠');
    assert.equal(long.messages.length, 1);
    assert.equal(long.messages[0].role, 'user');
    assert.equal(long.unattributed, 1);
    /* 空白行丢掉；空串 ⇒ 零消息（由上层报 no_note）。 */
    assert.equal(DAT.splitTranscript('   ' + NL + NL, '阿棠').messages.length, 0);
});

test('A10 读数面：三档分布与「数不出来」分开算（源把它们塔在一起）', () => {
    const rows = [
        { rounds: 2, soloHits: 0, dashDense: false },
        { rounds: 4, soloHits: 1, dashDense: false },
        { rounds: NaN, soloHits: 0, dashDense: true },
        { rounds: null, soloHits: 0, dashDense: false }
    ];
    const r = DAT.kettleReadings(rows, { cap: 40 });
    assert.equal(r.total, 4);
    assert.equal(r.unknownRounds, 2, '两种坏值都要进「数不出来」');
    assert.equal(r.perBucket[DAT.KETTLE_ROUND_BUCKETS[0]], 1);
    assert.equal(r.perBucket[DAT.KETTLE_ROUND_BUCKETS[1]], 1);
    assert.equal(r.perBucket[DAT.KETTLE_ROUND_BUCKETS[2]], 0);
    assert.equal(r.withSolo, 1);
    assert.equal(r.withDenseDash, 1);
    /* ★ 三档计数之和 + 数不出来 = 总数（不许静默吞掉）。 */
    const sum = DAT.KETTLE_ROUND_BUCKETS.reduce((a, k) => a + r.perBucket[k], 0);
    assert.equal(sum + r.unknownRounds, r.total, '三档 + 数不出来必须等于总数');
    /* 空表：全是零，而不是 null（这是**真读数**；null 只在 storage 取不出来时由 App 层给）。 */
    const empty = DAT.kettleReadings([], {});
    assert.equal(empty.total, 0);
    assert.equal(empty.unknownRounds, 0);
    assert.equal(empty.perBucket[DAT.KETTLE_ROUND_BUCKETS[0]], 0);
});

test('A11 取数归因四态：一条都没有 / 写了但认不出来 / 取不出来（源这三者在界面全同形）', () => {
    const F = DAT.KETTLE_FACES;
    assert.equal(DAT.ledgerFace(3, true, false), F[0]);
    assert.equal(DAT.ledgerFace(0, true, false), F[1]);
    assert.equal(DAT.ledgerFace(0, true, true), F[2], '写了但认不出来 ≠ 还没记过');
    assert.equal(DAT.ledgerFace(3, true, true), F[2], '账面上有坏内容也要报出来');
    assert.equal(DAT.ledgerFace(0, false, false), F[3], '取不出来 ≠ 还没记过');
    assert.equal(DAT.ledgerFace(3, false, true), F[3], '取不出来优先于坏内容');
    /* 四态人话齐备且互不相同。 */
    const texts = F.map((k) => DAT.KETTLE_FACE_TEXT[k]);
    assert.equal(texts.length, 4);
    assert.equal(new Set(texts).size, 4, '四态人话必须互不相同');
    for (const t of texts) assert.ok(t && t.length > 0);
});

test('A12 去标签：选项段与场景段都摘掉（源两处各写了一份，改一处忘一处）', () => {
    /* 行内形态：只摘到**本行末**，后面的正文必须留着。 */
    assert.equal(DAT.stripTags('场景: 汤铺\n正文一句。\n选项: a | b | c'), '正文一句。');
    assert.equal(DAT.stripTags('正文。\n场景: 汤铺'), '正文。', '没有收尾符时不许把后面的正文切光');
    /* 方括号形态（信封产的就是这个）：连括号整体摘掉。 */
    assert.equal(DAT.stripTags('[场景: 汤铺]\n正文一句。\n[选项: a | b | c]'), '正文一句。');
    assert.equal(DAT.stripTags('正文一句。\n[场景: 汤铺]'), '正文一句。');
    assert.equal(DAT.stripTags('干干净净的一句话'), '干干净净的一句话');
    assert.equal(DAT.stripTags(null), '');
    /* ★ 「后面还有正文」这一情形必须留得住（原版在这里把整段切光）。 */
    assert.equal(DAT.stripTags('选项: a | b | c\n下一行是正文'), '下一行是正文');
});

test('A13 要求文本：本件只产可复制的要求（不调模型），六条要素齐备', () => {
    const text = DAT.composeEnvelope({ name: '阿棠', persona: '话少，记性好' }, { shop: '汤铺' });
    assert.ok(text.indexOf('汤铺') >= 0, '要写明在哪家店');
    assert.ok(text.indexOf('阿棠') >= 0, '要写明对面是谁');
    assert.ok(text.indexOf('[选项:') >= 0, '要写明选项格式（方括号形态，与解析口同一套）');
    assert.ok(text.indexOf('[场景:') >= 0, '要写明场景格式');
    assert.ok(text.indexOf('单字语气词') >= 0, '要写明不许拿单字语气词当整句');
    assert.ok(text.indexOf('破折号') >= 0, '要写明不要堆破折号');
    /* 对白上限：缺省 500；坏值回落；上限 2000。 */
    const d = DAT.composeEnvelope({}, {});
    assert.ok(d.indexOf('500') >= 0);
    assert.ok(DAT.composeEnvelope({}, { dialogueLimit: 0 }).indexOf('500') >= 0, '0 是坏值 ⇒ 回落');
    assert.ok(DAT.composeEnvelope({}, { dialogueLimit: 9999 }).indexOf('2000') >= 0, '超上限封顶');
    /* 括注上限要在要求里写明（真源常量真被用上）。 */
    assert.ok(d.indexOf(String(DAT.KETTLE_ASIDE_MAX_LEN)) >= 0, '括注上限必须出现在要求里');
    /* 空名字给兜底（不许出现 undefined 字样）。 */
    const blank = DAT.composeEnvelope({}, {});
    assert.equal(blank.indexOf('undefined'), -1);
    assert.equal(blank.indexOf('NaN'), -1);
});


/* ══════════════════════ B — App 行为面 ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一条都没记过」', () => {
    const a = newApp(hostileStorage());
    assert.equal(a.faceOf(), DAT.KETTLE_FACES[3], '一取就抛 ⇒ 「存储读不出来」');
    assert.equal(a.probe(), null, '取不出来时投影必须是 null（不是空投影）');
    assert.equal(a.readings(), null, '取不出来时读数拿不到（不是零点）');
    assert.equal(a.readingsOk(), false);
    /* 对照：真空存储 ⇒ 「还没记过」（与上面**不同形**）。 */
    const b = newApp(memStorage());
    assert.equal(b.faceOf(), DAT.KETTLE_FACES[1]);
    assert.ok(b.probe() !== null);
    assert.equal(b.readingsOk(), true);
    /* 两种处境的面必须不同。 */
    assert.notEqual(a.faceOf(), b.faceOf());
    assert.notEqual(a.faceTextOf(a.faceOf()), b.faceTextOf(b.faceOf()));
});

test('B2 「写了但认不出来」单列：坏内容不许与「还没记过」同形（源两者都画空列表）', () => {
    const a = newApp(memStorage({ kettle_notes: '{坏 JSON' }));
    assert.equal(a.faceOf(), DAT.KETTLE_FACES[2], '写了但认不出来是独立一态');
    assert.notEqual(a.faceOf(), DAT.KETTLE_FACES[1]);
    assert.equal(a.noteCount(), 0, '坏内容读不出记录（如实报空，但面已区分）');
    assert.equal(a.readingsOk(), true, 'storage 本身是好的（能取出来）');
    /* 坏在策略格上也要报出来。 */
    const c = newApp(memStorage({ kettle_policy: 'oops' }));
    assert.equal(c.faceOf(), DAT.KETTLE_FACES[2]);
    assert.equal(c.ledgerKeepOf(), 40, '坏策略格 ⇒ 保留数回落真源缺省');
    /* 坏在台账格上同样要报。 */
    const e = newApp(memStorage({ kettle_ledger: '[1,2' }));
    assert.equal(e.faceOf(), DAT.KETTLE_FACES[2]);
    /* 四态人话齐备（视图直接用它）。 */
    for (const k of DAT.KETTLE_FACES) assert.ok(a.faceTextOf(k).length > 0);
});

test('B3 封记录：三因分报 + 满了要拒（源三种都静默落残缺记录）', () => {
    const a = newApp(memStorage());
    assert.equal(a.settle(talk()).ok, true);
    assert.equal(a.noteCount(), 1);
    assert.deepEqual(a.settle({ partner: '阿棠', messages: [] }).reasons, ['no_note']);
    assert.deepEqual(a.settle({ messages: talk().messages }).reasons, ['no_partner']);
    assert.deepEqual(a.settle({ partner: '阿棠', messages: [{ role: 'x' }] }).reasons, ['bad_rounds']);
    /* 满了：拒并报上限（不许静默丢新的）。 */
    for (let i = a.noteCount(); i < DAT.KETTLE_MAX_NOTES; i += 1) a.settle(talk());
    assert.equal(a.noteCount(), DAT.KETTLE_MAX_NOTES);
    const full = a.settle(talk());
    assert.equal(full.ok, false);
    assert.equal(full.reasons[0], 'over_max');
    assert.equal(full.max, DAT.KETTLE_MAX_NOTES);
    assert.equal(full.saw, DAT.KETTLE_MAX_NOTES);
});

test('B4 贴一段对话就能封：拆不出说话人的行如实报数（源假定手里已是数组）', () => {
    const a = newApp(memStorage());
    const text = '阿棠：今天汤滚得慢。' + NL + '我：那就等它滚。' + NL + '阿棠：好。';
    const r = a.settleTranscript(text, { partner: '阿棠', shop: '巷口那家汤铺', at: '晚' });
    assert.equal(r.ok, true);
    assert.equal(r.split.unattributed, 1, '分不出说话人的行要报出来');
    assert.equal(a.noteCount(), 1);
    const row = a.noteRows()[0];
    assert.equal(row.partner, '阿棠');
    assert.equal(row.bucket, DAT.KETTLE_ROUND_BUCKETS[0], '两个 assistant 轮 ⇒ 首档');
    /* 空文本 ⇒ 三因之一，不许静默。 */
    const empty = a.settleTranscript('   ', { partner: '阿棠' });
    assert.equal(empty.ok, false);
    assert.deepEqual(empty.reasons, ['no_note']);
    /* 示范对话：三项体检要在台账面上看得见。 */
    const b = newApp(memStorage());
    assert.equal(b.settleDemo('阿棠', '汤铺', '晚').ok, true);
    const d0 = b.noteRows()[0];
    assert.ok(d0.soloHits > 0, '示范里带单字语气词 ⇒ 登记数要 > 0');
    assert.equal(d0.dashDense, true, '示范里破折号偏密 ⇒ 体检要报出来');
    assert.equal(b.readings().withSolo, 1);
    assert.equal(b.readings().withDenseDash, 1);
    /* 没写字面量数据源：封好的记录里不许存单字气泡本身。 */
    assert.equal(d0.soloChars.indexOf('嗯') >= 0, true);
});

test('B5 撤记录与越界：下标越界一律拒，撤完还剩几段要报', () => {
    const a = newApp(memStorage());
    a.settle(talk());
    a.settle(talk());
    assert.equal(a.noteCount(), 2);
    for (const bad of [-1, 2, 99, 1.5, 'x', null]) {
        assert.equal(a.unnote(bad).ok, false, '越界必须拒：' + String(bad));
    }
    assert.equal(a.noteCount(), 2, '拒了就不许改数据');
    assert.equal(a.unnote(0).ok, true);
    assert.equal(a.unnote(0).left, 0);
    assert.equal(a.noteAt(0), null);
    assert.equal(a.noteAt(0.5), null, '非整数下标一律拒');
});

test('B6 产要求文本：本件不替你发请求，只把要求写清楚', () => {
    const a = newApp(memStorage());
    a.settleTranscript('阿棠：走吧。' + NL + '我：好。', { partner: '阿棠', shop: '汤铺' });
    const r = a.buildEnvelope(0);
    assert.equal(r.ok, true);
    assert.equal(r.shop, '汤铺');
    assert.ok(r.text.indexOf('汤铺') >= 0);
    assert.ok(r.text.indexOf('阿棠') >= 0);
    assert.equal(a.draftOf(), r.text, '产出的草稿要留在 App 上（视图直接读）');
    assert.ok(r.soloWords > 0);
    /* 越界一律拒。 */
    assert.equal(a.buildEnvelope(9).ok, false);
    assert.equal(a.buildEnvelope(9).reason, 'out_of_range');
});

test('B7 收拾回信：四件事各自报出并留一张回执', () => {
    const a = newApp(memStorage());
    a.settleTranscript('阿棠：走吧。' + NL + '我：好。', { partner: '阿棠' });
    const raw = '[场景: 面馆]' + NL + '他抹了抹嘴，嗯了一声。' + NL + '[选项: 问汤 | 付钱 | 出门]';
    const r = a.parseReply(0, raw);
    assert.equal(r.ok, true);
    assert.equal(r.optionFace, DAT.KETTLE_OPTION_FACES[0]);
    assert.deepEqual(r.options, ['问汤', '付钱', '出门']);
    assert.equal(r.sceneState, DAT.KETTLE_SCENE_STATES[0]);
    assert.equal(r.scene, '面馆');
    assert.equal(r.soloHits, 1, '「嗯」要登记');
    assert.equal(r.dashDense, false);
    /* 回执要进台账，且逐字段可读。 */
    const rows = a.receiptRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].partner, '阿棠');
    assert.equal(rows[0].optionCount, 3);
    assert.equal(rows[0].sceneState, DAT.KETTLE_SCENE_STATES[0]);
    assert.equal(rows[0].lone, 0);
    /* 没给选项的回信：必须报「这一轮没给选项」（源不报这件事）。 */
    const r2 = a.parseReply(0, '他什么也没说。');
    assert.equal(r2.optionFace, DAT.KETTLE_OPTION_FACES[3]);
    assert.equal(r2.sceneState, DAT.KETTLE_SCENE_STATES[1], '没标场景就是没标');
    assert.equal(a.receiptRows().length, 2);
    /* 空输入与越界。 */
    assert.equal(a.parseReply(0, '   ').reason, 'empty_input');
    assert.equal(a.parseReply(9, 'x').reason, 'out_of_range');
});

test('B8 台账容量可调：坏值一律回落且如实报「我填的没被采纳」', () => {
    const a = newApp(memStorage());
    assert.equal(a.ledgerKeepOf(), 40);
    for (const bad of [0, -3, 1.5, 'abc', null, undefined]) {
        const r = a.setLedgerKeep(bad);
        assert.equal(r.took, DAT.KETTLE_MAX_NOTES, '坏值必须回落真源上限：' + String(bad));
        assert.equal(r.saw, bad, '要如实报出用户填的是什么');
    }
    assert.equal(a.setLedgerKeep(9999).took, DAT.KETTLE_MAX_NOTES, '超上限封顶');
    assert.equal(a.setLedgerKeep(2).took, 2);
    assert.equal(a.ledgerKeepOf(), 2);
    /* 超上限截最近：留的是最新那两条。 */
    a.settleTranscript('阿棠：走吧。' + NL + '我：好。', { partner: '阿棠' });
    for (const s2 of ['第一', '第二', '第三', '第四']) a.parseReply(0, s2);
    assert.equal(a.receiptRows().length, 2);
    assert.equal(a.receiptRows()[0].dashTotal, DAT.dashAudit('第三').total);
    assert.equal(a.policyRow().receiptFull, true, '满了要报出来');
});

test('B9 策略与读数：三档计数在取不出来时是 null（不是 0）', () => {
    const a = newApp(hostileStorage());
    for (const r of a.roundRows()) assert.equal(r.count, null, '取不出来时 count 必须是 null');
    for (const r of a.optionRows()) assert.equal(r.count, null);
    for (const r of a.optionRows()) assert.equal(r.rate, null);
    assert.equal(a.readings(), null);
    assert.ok(a.summaryLine().indexOf('拿不到') >= 0, '摘要要说清「读数拿不到」');
    /* 对照：真空存储 ⇒ 计数是 0（真读数）。 */
    const b = newApp(memStorage());
    for (const r of b.roundRows()) assert.equal(r.count, 0);
    for (const r of b.optionRows()) assert.equal(r.count, 0);
    /* 三档逐档列全（塔成少于三档就是源那个毛病）。 */
    assert.equal(b.roundRows().length, DAT.KETTLE_ROUND_BUCKETS.length);
    assert.equal(b.optionRows().length, DAT.KETTLE_OPTION_FACES.length);
});

test('B10 投影与视图口：视图只调 App 的口，自己不拆内部结构', () => {
    const a = newApp(memStorage());
    a.settleDemo('阿棠', '汤铺', '晚');
    const pr = a.probe();
    assert.ok(pr);
    assert.equal(typeof pr.face, 'string');
    assert.equal(typeof pr.faceText, 'string');
    assert.equal(pr.malformed, false);
    assert.ok(Array.isArray(pr.notes));
    assert.ok(Array.isArray(pr.rounds));
    assert.ok(Array.isArray(pr.options));
    assert.ok(Array.isArray(pr.receipts));
    assert.ok(pr.policy);
    /* 页签白名单：坏值回落 notes。 */
    assert.equal(a.setTab('nope'), 'notes');
    assert.equal(a.setTab('ledger'), 'ledger');
    /* 详情态。 */
    a.openNote(0);
    assert.equal(a.currentKey(), '0');
    assert.equal(a.closeNote(), 'notes');
    assert.equal(a.currentKey(), '');
    /* catalogs（视图的键面取这里，不写第二份）。 */
    const c = a.catalogs();
    assert.equal(c.rounds.length, 3);
    assert.equal(c.optionFaces.length, 4);
    assert.equal(c.sceneStates.length, 3);
    assert.equal(c.soloChars.length, 10);
    assert.equal(c.faces.length, 4);
    assert.equal(c.tabs.length, 5);
    assert.equal(c.limits.maxNotes, DAT.KETTLE_MAX_NOTES);
    assert.equal(c.roundUnknown, DAT.KETTLE_ROUND_UNKNOWN);
    /* 三个取值口。 */
    assert.equal(a.roundLabelOf(DAT.KETTLE_ROUND_BUCKETS[0]), DAT.KETTLE_ROUND_META[DAT.KETTLE_ROUND_BUCKETS[0]].label);
    assert.equal(a.roundLabelOf('nope'), DAT.KETTLE_ROUND_UNKNOWN);
    assert.equal(a.optionTextOf('nope'), 'nope');
    assert.equal(a.faceTextOf('nope'), 'nope');
    /* 清台账。 */
    a.parseReply(0, 'x');
    assert.equal(a.receiptRows().length, 1);
    assert.equal(a.clearLedger().ok, true);
    assert.equal(a.receiptRows().length, 0);
});


/* ══════════════════════ C — 接线与同源 ══════════════════════ */
test('C1 三条会话键随会话隔离（换角色后不许读到别人的记录）', () => {
    const st = sessionStorage();
    const app = newApp(st);
    app.settleDemo('阿棠', '汤铺', '晚');
    app.parseReply(0, '一句话');
    app.setLedgerKeep(5);
    assert.equal(app.noteCount(), 1);
    assert.equal(app.receiptRows().length, 1);
    /* 换会话 ⇒ 全部重取（旧会话的记录不许留着）。 */
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.noteCount(), 0, '换会话后记录必须清空');
    assert.equal(app.receiptRows().length, 0, '换会话后台账必须清空');
    assert.equal(app.ledgerKeepOf(), 40, '换会话后策略必须回缺省');
    assert.equal(app.faceOf(), DAT.KETTLE_FACES[1], '新会话是「还没记过」而不是「读不出来」');
    assert.equal(app.currentKey(), '', '换会话必须把详情态清掉');
    assert.equal(app.draftOf(), '', '换会话必须把草稿清掉');
    assert.equal(app.tab(), 'notes', '换会话必须把页签收回记录');
    /* 切回去 ⇒ 原来的记录还在。 */
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.noteCount(), 1, '换回来必须能读回自己的记录');
    assert.equal(app.receiptRows().length, 1);
    assert.equal(app.ledgerKeepOf(), 5);
    assert.equal(app.faceOf(), DAT.KETTLE_FACES[0]);
    /* 三条键必须真的各自落在一个带前缀的格上（抄错前缀 = 串味）。 */
    for (const k of ['kettle_notes', 'kettle_policy', 'kettle_ledger']) {
        assert.equal(st._box.has('c1::' + k), true, k + ' 必须落在会话隔离的格上');
    }
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    /* ① App 注册表：id 必须在册。 */
    assert.ok(/id: 'kettle'/.test(apps), 'config/apps.js 必须有 kettle 条目');
    /* ② 会话键前缀：不登记 ⇒ 三条键走全局存储（串味）。 */
    assert.ok(/\/\^kettle_\//.test(read(STORAGE)), 'config/storage.js 必须有 /^kettle_/ 前缀');
    /* ③ 入口：懒加载分支 + 重绑表。 */
    const idx = read(INDEX);
    assert.ok(idx.includes("appId === 'kettle'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/kettle/kettle-app.js')"), 'index.js 必须真 import 本件');
    assert.ok(idx.includes('kettleApp'), 'index.js 重绑表必须有 kettleApp（换会话才重取）');
    /* ④ 会话键审计：三条键都要在册。 */
    const keys = read(KEYS);
    for (const k of ['kettle_notes', 'kettle_policy', 'kettle_ledger']) {
        assert.ok(keys.includes("'" + k + "'"), k + ' 必须在 keys-audit 登记');
    }
    /* ⑤ 懒加载目录映射（v255 套件用）。 */
    assert.ok(read(V255).includes("kettleApp: 'kettle'"), 'v255 dirMap 必须登记 kettle 目录');
    /* ⑥ 样式段（段头独立成行）。 */
    const css = read(PHONE_CSS);
    assert.ok(css.includes('[v3.40.0] 对话水壶'), 'phone.css 必须有本版段头');
    assert.ok(css.includes('.ktl-root'), 'phone.css 必须贴上本件样式正文');
    /* 段序：最新版必须在最前（本仓约定）。 */
    assert.ok(css.indexOf('[v3.40.0] 对话水壶') < css.indexOf('[v3.39.0] 时光胶囊'),
        '本版段必须在 v3.39.0 段之前（最新版在最前）');
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const idx = css.indexOf('[v3.40.0] 对话水壶');
    assert.ok(idx > 0);
    const lineStart = css.lastIndexOf(NL, idx) + 1;
    const lineEnd = css.indexOf(NL, idx);
    const line = css.slice(lineStart, lineEnd);
    assert.ok(line.startsWith('/*'), '段头行必须以块注释起头，实测：' + line.slice(0, 40));
    assert.ok(line.trimEnd().endsWith('*/'), '段头行必须以块注释收尾，实测：' + line.slice(-40));
    assert.ok(lineStart === 0 || css[lineStart - 1] === NL, '段头不许接在上一段尾后');
    assert.equal(line.split('/*').length, 2, '段头行只许有一个块注释起头');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const src = read(KT_CSS).trim();
    const css = read(PHONE_CSS);
    assert.ok(css.includes(src), 'kettle.css 正文必须逐字出现在 phone.css 的本版段里');
});

test('C5 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const v = read(KT_VIEW);
    const a = read(KT_APP);
    const members = new Set();
    for (const m of a.matchAll(/^ {4}([a-zA-Z_$][\w$]*)\(/gm)) members.add(m[1]);
    const used = new Set();
    for (const m of v.matchAll(/\bapp\.([a-zA-Z_$][\w$]*)/g)) used.add(m[1]);
    assert.ok(used.size >= 15, '视图调用面要像话，实测 ' + used.size);
    const missing = [...used].filter((x) => !members.has(x));
    assert.deepEqual(missing, [], '视图调用了 App 上不存在的口：' + missing.join(', '));
});

test('C6 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const v = read(KT_VIEW);
    const css = read(KT_CSS);
    const names = new Set();
    for (const m of v.matchAll(/ktl-[a-z0-9_-]+/g)) names.add(m[0]);
    const stems = [...names].filter((x) => x.endsWith('-'));
    for (const sy of stems) assert.ok(css.includes('.' + sy), '拼接族必须有样式落点：' + sy);
    const missing = [];
    for (const n of names) {
        if (n.endsWith('-')) continue;
        if (css.includes('.' + n)) continue;
        missing.push(n);
    }
    assert.deepEqual(missing, [], '视图产出的类没样式落点：' + missing.join(', '));
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
test('D1 不碰模型：三件里一个网络调用都没有（源直读本地存储三密钥走 SSE 流）', () => {
    for (const rel of [KT_DATA, KT_APP, KT_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
        assert.equal(/\bapiKey\b/i.test(code), false, rel + ' 不许读 apiKey');
        assert.equal(/\bAuthorization\b/i.test(code), false, rel + ' 不许出现 Authorization');
        assert.equal(/\bselectedModel\b/i.test(code), false, rel + ' 不许读 selectedModel');
        assert.equal(/\bapiUrl\b/i.test(code), false, rel + ' 不许读 apiUrl');
    }
});

test('D2 不碰宿主对象、不落数据库、不跨 App 读（源直读 roles 与宿主 addMessage）', () => {
    for (const rel of [KT_DATA, KT_APP]) {
        const code = stripComments(read(rel));
        /* ★ 「读宿主会话表」的形态是「messages[角色id]」（源就是这么取上下文的）；
         *   本件的**局部入参**也叫 messages（messages[0] 是取首句），故禁表要写得准。 */
        for (const bad of ['indexedDB', 'IDBDatabase', 'VirtualPhone', 'DataStorage', 'document.', 'window.', 'messages[roleId]', 'addMessage', 'currentChatRole', 'getUserPersona']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
    /* ★ 视图层：允许 document.createElement 建**自己那棵子树**，但不许摸宿主全局。 */
    const view = stripComments(read(KT_VIEW));
    for (const bad of ['indexedDB', 'IDBDatabase', 'VirtualPhone', 'DataStorage', 'messages[', 'addMessage']) {
        assert.equal(view.includes(bad), false, KT_VIEW + ' 不许出现 ' + bad);
    }
    for (const bad of ['document.body', 'document.head', 'document.cookie', 'window.location', 'postMessage', 'iframe']) {
        assert.equal(view.includes(bad), false, KT_VIEW + ' 不许摸宿主全局：' + bad);
    }
    assert.ok(view.includes('getContentContainer'), '视图必须经 shell 的容器口取容器');
    assert.ok(view.includes('document.createElement('), '视图必须自己建根子树（不整块覆写宿主容器）');
});

test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of [KT_DATA, KT_APP, KT_VIEW, KT_CSS]) {
        const code = stripComments(read(rel));
        for (const bad of ['http://', 'https://', '//cdn', 'data:image', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.woff']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
});

test('D4 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const app = stripComments(read(KT_APP));
    for (const bad of ['storage.removeItem', 'storage.clear', 'storage.delete', 'storage.getAll', 'storage.keys']) {
        assert.equal(app.includes(bad), false, 'App 层不许调 storage 的第三口：' + bad);
    }
    assert.ok(app.includes('this.storage.get('), '必须只走 get');
    /* [v3.58.0 · 计划 O5] 经 set 落盘即可：直调或走唯一实现。 */
    assert.ok(app.includes('this.storage.set(') || app.includes('writeReceipt(this.storage'), '必须只走 set');
});


/* ══════════════════════ E — 消费面 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    const data = read(KT_DATA);
    /* ★ 消费面三处：数据层自身（定义行之外的使用，与本仓 dead-export 同口径）
     *   + App 层 + 视图层。只看 App/视图会把「数据层内部真用上的常量」误报成零消费。 */
    const consumers = stripComments(data) + stripComments(read(KT_APP)) + stripComments(read(KT_VIEW));
    /* 导出清单：从数据层真代码里抽 export（不许手写一份）。 */
    const names = new Set();
    for (const m of stripComments(data).matchAll(/export (?:const|function|class) ([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    assert.ok(names.size >= 20, '导出面要像话，实测 ' + names.size);
    const unused = [...names].filter((n) => consumers.indexOf(n) < 0);
    assert.deepEqual(unused, [], '数据层导出零消费：' + unused.join(', '));
});

test('E2 手写键不许回潮：四态与三态的键面必须取真源', () => {
    const app = stripComments(read(KT_APP));
    /* 面常量必须从真源数组派生（本仓 J7 形态：手写一份靠碰巧拼写一致对齐）。 */
    assert.ok(app.includes('KETTLE_FACES['), '面常量必须取真源数组的值');
    assert.equal(new RegExp('const FACE_OK\\s*=\\s*' + Q + 'ok' + Q).test(app), false, '不许手写面键');
    assert.equal(new RegExp('const FACE_ABSENT\\s*=\\s*' + Q + "storage_absent" + Q).test(app), false, '不许手写面键');
    /* 视图同理。 */
    const view = stripComments(read(KT_VIEW));
    assert.ok(view.includes('KETTLE_FACES['), '视图面色相表必须取真源键');
    assert.equal(new RegExp('ok: ' + Q + 'ok' + Q).test(view), false, '视图不许手写面键');
});

test('E3 视图不自己算内核（那是数据层与 App 的事）', () => {
    const v = stripComments(read(KT_VIEW));
    /* 视图不许自己数轮次 / 拆选项 / 断场景 / 体检破折号。 */
    for (const bad of ['roundBucketOf(', 'parseOptions(', 'parseScene(', 'dashAudit(', 'soloRegister(', 'countRounds(']) {
        assert.equal(v.includes(bad), false, '视图不许自己算内核：' + bad);
    }
    /* 也不许自己拼统计（读数是**读** App 的，不是自己算的）。 */
    for (const bad of ['kettleReadings(', 'perBucket[', '.reduce(', '.filter(']) {
        assert.equal(v.includes(bad), false, '视图不许自己拼统计：' + bad);
    }
    assert.ok(v.includes('app.readings()'), '读数必须经 App 的口取');
});

/* ══════════════════════ F — 视图层 ══════════════════════ */
test('F1 四态必须分开画：视图必须画出四态人话与四色徽章（不许塔成一句）', () => {
    const v = read(KT_VIEW);
    /* 四态各自一个色相（塔成一色 = 四态在用户眼里同形）。 */
    for (const k of ['KETTLE_FACES[0]', 'KETTLE_FACES[1]', 'KETTLE_FACES[2]', 'KETTLE_FACES[3]']) {
        assert.ok(v.includes(k), '四态必须逐态画：' + k);
    }
    /* 人话取自 App 的 faceTextOf（不许在视图里再写一份）。 */
    assert.ok(v.includes('app.faceTextOf('), '四态人话必须取自 App');
});

test('F2 空与坏不同形：同一句话不许两种处境共用（且逗号表达式坑不许回潮）', () => {
    const v = read(KT_VIEW);
    /* 空态文案必须走 faceTextOf（四态各异），不许写死一句。 */
    const idx = v.indexOf('ktl-list-none');
    assert.ok(idx > 0);
    const seg = v.slice(idx, idx + 220);
    assert.ok(seg.includes('faceTextOf'), '空列表文案必须按面分写');
    /* 逗号表达式坑：`),` 结尾后跟换行再加号；用 `) ,` + 同行换行判断。 */
    assert.equal(new RegExp('\\)\\s*,' + NL).test(v), false, '拼串行尾不许留尾逗号（拼串会变成逗号表达式）');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const v = read(KT_VIEW);
    assert.ok(v.includes('String.fromCharCode(38)'), '与号必须拼装');
    assert.ok(v.includes('String.fromCharCode(34)'), '双引号必须拼装');
    /* 实体字面量（与号 + amp;）不许出现。 */
    assert.equal(v.includes('&' + 'amp;'), false, '不许写实体字面量（落盘链会解码，转义会静默失效）');
});

test('F4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const v = read(KT_VIEW);
    assert.ok(v.includes('_settleWhy'), '封记录被拒要分因说清');
    assert.ok(v.includes('_parseFail'), '收拾失败要有话说');
    assert.ok(v.includes("'no_note'"), '三因要逐个报');
    assert.ok(v.includes("'no_partner'"), '三因要逐个报');
    assert.ok(v.includes("'bad_rounds'"), '三因要逐个报');
    assert.ok(v.includes('empty_input'), '空输入要有话说');
});

test('F5 点卡片要能打开：判定必须向上找祖先（不许只认直点元素）', () => {
    const v = read(KT_VIEW);
    assert.ok(v.includes('climb'), '必须有向上找祖先的爬升口');
    assert.equal(new RegExp('t\\.getAttribute\\(.data-open').test(v), false, '不许只认直点元素');
    /* 顺序：动作按钮先于卡片（按钮在卡片内部，先判卡片会把按钮吃掉）。 */
    const ia = v.indexOf("climb(t, (n) => n.getAttribute('data-act'))");
    const ic = v.indexOf("climb(t, (n) => n.getAttribute('data-open')");
    assert.ok(ia > 0 && ic > 0);
    assert.ok(ia < ic, '动作按钮必须先于卡片判定');
});

/* ══════════════════════ G — 会话键 ══════════════════════ */
test('G1 三条会话键在 keys-audit 登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    const reg = keys.slice(keys.indexOf('KEY_REGISTRY = ['));
    for (const k of ['kettle_notes', 'kettle_policy', 'kettle_ledger']) {
        const i = reg.indexOf("'" + k + "'");
        assert.ok(i >= 0, k + ' 必须在 KEY_REGISTRY 登记');
        const line = reg.slice(reg.lastIndexOf(NL, i) + 1, reg.indexOf(NL, i));
        assert.ok(line.includes("scope: 'chat'"), k + ' 的 scope 必须是 chat');
    }
    /* 前缀必须真在 storage 的宽匹配族里。 */
    assert.ok(read(STORAGE).includes('/^kettle_/'), 'CHAT_DATA_PATTERNS 必须有本件前缀');
});

test('G2 三条键真被产品消费（写面必须落到这三条上）', () => {
    const app = stripComments(read(KT_APP));
    for (const k of ['kettle_notes', 'kettle_policy', 'kettle_ledger']) {
        assert.ok(app.includes("'" + k + "'"), k + ' 必须在 App 层被真用上（拼出键名）');
    }
    assert.ok(app.includes('const NOTES_KEY'), '记录键要有单一定义');
    assert.ok(app.includes('const POLICY_KEY'));
    assert.ok(app.includes('const LEDGER_KEY'));
});

/* ══════════════════════ H — 换会话 ══════════════════════ */
test('H1 换会话必须全量重取 + 清视图态（源把记录挂在宿主键下，切角色原样留着）', () => {
    const app = read(KT_APP);
    const i = app.indexOf('    onChatChanged() {');
    assert.ok(i > 0);
    const rest = app.slice(i + 20);
    const endRel = rest.indexOf(NL + '    }' + NL);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    assert.ok(body.includes('this.probe()'), '换会话必须重取读数（三格的装载由 probe 一处承担）');
    /* ★ 单一装载路径：三格不许有第二处装载口（双口径必然分岔）。 */
    const loads = app.split('this._loadNotes(').length - 1 + app.split('this._loadPolicy(').length - 1
        + app.split('this._loadLedger(').length - 1;
    assert.equal(loads, 3, '三格各只许一处调用（定义处不计），实测 ' + loads);
    assert.ok(body.includes("this._draft = ''"), '换会话必须清草稿');
    assert.ok(body.includes("this._current = ''"), '换会话必须清详情态');
});

test('H2 无 storage 也不许崩：三格一起报「取不出来」', () => {
    const a = newApp(null);
    assert.equal(a.faceOf(), DAT.KETTLE_FACES[3]);
    assert.equal(a.probe(), null);
    assert.equal(a.noteCount(), 0);
    const b = newApp({ get: () => null });
    assert.equal(b.faceOf(), DAT.KETTLE_FACES[3], '没有 set 也算存储不可用');
    const c = newApp({ set: () => {} });
    assert.equal(c.faceOf(), DAT.KETTLE_FACES[3], '没有 get 也算存储不可用');
    /* 写入失败不许崩（也不许假装成功）。 */
    const d = newApp({ get: () => null, set: () => { throw new Error('nope'); } });
    assert.equal(d.faceOf(), DAT.KETTLE_FACES[1], 'get 好的 ⇒ 一条都没有');
    assert.equal(d.settleDemo('阿棠', '汤铺', '晚').ok, true, '写失败不许抛出来');
});


/* ====================== I - 负控制（破坏必须可观测） ====================== */
/** 数据层判据（加载**真破坏副本**后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 轮次数不出来不许与「聊了很久」同形。 */
    for (const x of [NaN, -1, 1.5, 'abc', null, 0]) {
        if (mod.roundBucketOf(x).ok !== false) bad.push('rounds-unknown-collapsed');
    }
    /* ② 选项不足三个不许当合格。 */
    if (mod.parseOptions('选项: a | b').face !== mod.KETTLE_OPTION_FACES[1]) bad.push('options-too-few-accepted');
    if (mod.parseOptions('选项: a | b | c | d | e | f | g').face !== mod.KETTLE_OPTION_FACES[2]) bad.push('options-too-many-accepted');
    if (mod.parseOptions('选项: a | b | c | d | e | f | g').items.length !== mod.KETTLE_OPTIONS_MAX) bad.push('options-not-capped');
    /* ③ 场景缺了不许沿用上一次的地点。 */
    if (mod.parseScene('没有场景段').state !== mod.KETTLE_SCENE_STATES[1]) bad.push('scene-absent-collapsed');
    if (mod.parseScene('场景: ').state !== mod.KETTLE_SCENE_STATES[2]) bad.push('scene-malformed-collapsed');
    /* ④ 单字语气词只登记不保存。 */
    if (mod.soloRegister('嗯。').canKeep !== false) bad.push('solo-keep-enabled');
    if (mod.soloRegister('嗯').lone !== 1) bad.push('solo-lone-lost');
    /* ⑤ 坏内容不许与「没写过」同形。 */
    if (mod.noteStateOf('{坏').state !== mod.KETTLE_NOTE_STATES[2]) bad.push('bad-input-swallowed');
    if (mod.noteStateOf(null).state !== mod.KETTLE_NOTE_STATES[1]) bad.push('absent-becomes-malformed');
    /* ⑥ 三态不许塔成一态。 */
    const F = mod.KETTLE_FACES;
    if (mod.ledgerFace(0, true, true) !== F[2]) bad.push('ledger-face-collapsed');
    if (mod.ledgerFace(0, false, false) !== F[3]) bad.push('ledger-storage-face-collapsed');
    if (mod.ledgerFace(2, true, false) !== F[0]) bad.push('ledger-ok-face-lost');
    /* ⑦ 三档不许塔成少于三档。 */
    if (mod.KETTLE_ROUND_BUCKETS.length !== 3) bad.push('round-buckets-collapsed');
    if (mod.KETTLE_OPTION_FACES.length !== 4) bad.push('option-faces-collapsed');
    if (mod.KETTLE_SCENE_STATES.length !== 3) bad.push('scene-states-collapsed');
    /* ⑧ 拆不出说话人的行要报数。 */
    const sp = mod.splitTranscript('阿棠：走吧。' + NL + '我：那就等它滚。', '阿棠');
    if (sp.unattributed < 1) bad.push('unattributed-not-reported');
    if (sp.messages.length !== 2) bad.push('split-count-lost');
    /* ⑨ 破折号体检要真会报密。 */
    if (mod.dashAudit('他——停顿——又开口——说了半句——就停下——真的。').dense !== true) bad.push('dash-density-lost');
    /* ⑩ 封包三因不许塔成一个。 */
    if (mod.settleRecord({ partner: 'x', messages: [] }).reasons.join(',') !== 'no_note') bad.push('settle-reasons-collapsed');
    if (mod.settleRecord({ messages: mod.settleRecord({ partner: 'x', messages: [{ role: 'a' }] }).snapshot.map(() => ({})) }).ok !== false) bad.push('settle-ok-lost');
    /* ⑪ 读数面三档 + 数不出来 = 总数。 */
    const rd = mod.kettleReadings([{ rounds: 1 }, { rounds: null }], {});
    if (rd.unknownRounds !== 1) bad.push('readings-unknown-lost');
    return bad;
};

/** App 面判据（在**破坏副本**上真的 new 一个 App 跑）。 */
const appFaceProblems = (mod) => {
    const bad = [];
    /* ★ 面键取**数据层**的（App 模块只导出类）：从 mod 取会拿到 undefined
     *   而让比较恒真——判据变成「恒红」，对照组就会假绿。 */
    const F = DAT.KETTLE_FACES;
    const a = new mod.KettleApp(shellStub(), hostileStorage());
    if (a.faceOf() !== F[3]) bad.push('storage-absent-lost');
    if (a.probe() !== null) bad.push('projection-not-null-on-absent');
    if (a.readings() !== null) bad.push('readings-not-null-on-absent');
    for (const r of a.roundRows()) if (r.count !== null) bad.push('round-count-not-null-on-absent');
    for (const r of a.optionRows()) if (r.count !== null) bad.push('option-count-not-null-on-absent');
    const ok = new mod.KettleApp(shellStub(), memStorage());
    if (ok.faceOf() !== F[1]) bad.push('empty-face-lost');
    for (const r of ok.roundRows()) if (r.count !== 0) bad.push('zero-count-lost');
    return bad;
};

const appBadContentProblems = (mod) => {
    const bad = [];
    const a = new mod.KettleApp(shellStub(), memStorage({ kettle_notes: '{坏' }));
    /* ★ 「写了但认不出来」必须与「没写过」**不同形**。 */
    if (a.faceOf() !== DAT.KETTLE_FACES[2]) bad.push('malformed-face-lost');
    if (a.faceOf() === DAT.KETTLE_FACES[1]) bad.push('malformed-face-lost');
    return bad;
};

const appGateProblems = (mod) => {
    const bad = [];
    const a = new mod.KettleApp(shellStub(), memStorage());
    /* ★ 上限常量在数据层导出（App 模块只导出类），从 mod 取会拿到 undefined
     *   而让比较恒真——判据变成「恒红」，对照组就会假绿。 */
    for (const v of [0, -3, 1.5, 'abc', null, undefined]) {
        if (a.setLedgerKeep(v).took !== DAT.KETTLE_MAX_NOTES) bad.push('keep-fallback-lost');
    }
    if (a.setLedgerKeep(9999).took !== DAT.KETTLE_MAX_NOTES) bad.push('keep-cap-lost');
    /* 三因门必须在 settle 里生效。 */
    if (a.settle({ partner: 'x', messages: [] }).reasons[0] !== 'no_note') bad.push('no-note-accepted');
    if (a.settle({ messages: [{ role: 'assistant' }] }).reasons[0] !== 'no_partner') bad.push('no-partner-accepted');
    return bad;
};

const appChatProblems = (mod) => {
    const bad = [];
    const st = sessionStorage();
    const app = new mod.KettleApp(shellStub(), st);
    app.settleDemo('阿棠', '汤铺', '晚');
    app.parseReply(0, '一句话');
    app.openNote(0);
    st.switchTo('c2');
    app.onChatChanged();
    if (app.noteCount() !== 0) bad.push('chat-change-no-notes-reload');
    if (app.receiptRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    if (app.draftOf() !== '') bad.push('chat-change-no-draft-reset');
    if (app.currentKey() !== '') bad.push('chat-change-no-detail-reset');
    if (app.ledgerKeepOf() !== 40) bad.push('chat-change-no-policy-reload');
    return bad;
};

/** 结构面判据（手写键面 / 视图形态 —— 本仓 J7 那一族，只能静态判）。 */
const appHandKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const FACE_OK = KETTLE_FACES[')) bad.push('face-constant-handwritten');
    if (new RegExp('const FACE_OK\\s*=\\s*' + Q).test(code)) bad.push('face-constant-handwritten');
    return bad;
};

const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('FACE_TONE[KETTLE_FACES[')) bad.push('face-tone-not-by-source');
    /* ★ 四态四色：逐态抽出色相，塔成一色就算四态在用户眼里同形。 */
    const tones = [];
    for (const m of code.matchAll(/FACE_TONE\[KETTLE_FACES\[(\d)\]\] = '([a-z]+)';/g)) tones.push(m[2]);
    /* 四态**逐态赋色**（4 行都得在），且不允许全部同色；
     * ★ 后两态（写了但认不出来 / 取不出来）**故意共用一色**：它们都是「你看到的东西不对，且原因不在你」。 */
    if (tones.length !== 4) bad.push('face-tone-not-by-source');
    else if (new Set(tones).size < 3) bad.push('face-tone-not-by-source');
    if (!code.includes('app.faceTextOf(')) bad.push('face-text-not-from-app');
    return bad;
};

const viewCardProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const climb = (from, pred)')) bad.push('card-climb-lost');
    const ia = code.indexOf("climb(t, (n) => n.getAttribute('data-act'))");
    const ic = code.indexOf("climb(t, (n) => n.getAttribute('data-open')");
    if (!(ia > 0 && ic > 0 && ia < ic)) bad.push('card-climb-order-lost');
    return bad;
};

const viewEmptyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    const i = code.indexOf('ktl-list-none');
    if (i < 0) { bad.push('empty-face-lost'); return bad; }
    const seg = code.slice(i, i + 200);
    if (!seg.includes('faceTextOf')) bad.push('empty-and-bad-collapsed');
    return bad;
};

const viewCommaProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (new RegExp('\\)\\s*,' + NL).test(code)) bad.push('trailing-comma-expression');
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 轮次坏值落进末档（源就是 NaN 落「很久」）。 */
    q1: [KT_DATA,
        '    if (n === null || !Number.isInteger(n) || n < 1) {',
        '    if (n === null) {'],
    /* ② 选项不足三个也算合格。 */
    q2: [KT_DATA,
        '    if (seen.length < KETTLE_OPTIONS_MIN) face = KETTLE_OPTION_FACES[1];',
        '    if (false) face = KETTLE_OPTION_FACES[1];'],
    /* ③ 场景缺了沿用上一次的地点。 */
    q3: [KT_DATA,
        "    if (i < 0) return { state: KETTLE_SCENE_STATES[1], scene: " + Q + Q + ", saw: " + Q + Q + " };",
        "    if (i < 0) return { state: KETTLE_SCENE_STATES[0], scene: " + Q + "上一次的地点" + Q + ", saw: " + Q + Q + " };",],
    /* ④ 单字语气词改成「可保留」（源就是留着的）。 */
    q4: [KT_DATA,
        '    return { hits: hits.length, chars: hits.map((h) => h.char), lone: lone, canKeep: false };',
        '    return { hits: hits.length, chars: hits.map((h) => h.char), lone: 0, canKeep: true };'],
    /* ⑤ 坏内容当空（源 try/catch 后当空）。 */
    q5: [KT_DATA,
        "        } catch (_e) {" + NL + "            return { state: KETTLE_NOTE_STATES[2], notes: [], saw: t.slice(0, 40) };" + NL + "        }",
        "        } catch (_e) {" + NL + "            return { state: KETTLE_NOTE_STATES[1], notes: [], saw: " + Q + Q + " };" + NL + "        }"],
    /* ⑥ 取数三态塔成一态（「写了但认不出来」合流进「取不出来」）。 */
    q6: [KT_DATA,
        '    if (malformed) return KETTLE_FACES[2];',
        '    if (false) return KETTLE_FACES[2];'],
    /* ⑦ 三档塔成两档。 */
    q7: [KT_DATA,
        "Object.freeze(['short', 'eventful', 'long'])",
        "Object.freeze(['short', 'long'])"],
    /* ⑧ 拆不出说话人的行也当对面说（源就是自己假定数组）。 */
    q8: [KT_DATA,
        '        const isPartner = !!name && (who === name || who.indexOf(name) >= 0);',
        '        const isPartner = true;'],
    /* ⑨ 破折号不再报密（源只把它当写作）。 */
    q9: [KT_DATA,
        '    const dense = worstRun > KETTLE_DASH_LONG;',
        '    const dense = false;'],
    /* ⑩ 封包三因塔成一个。 */
    q10: [KT_DATA,
        "    if (!messages || !messages.length) reasons.push('no_note');",
        "    if (!messages || !messages.length) reasons.push('bad_rounds');"],
    /* ⑪ App：取不出来不当一回事（源把取不到读成空）。 */
    q11: [KT_APP,
        '        const storageOk = !!(rn.ok && rp.ok && rl.ok);',
        '        const storageOk = true;'],
    /* ⑫ App：读数三态门塔平。 */
    q12: [KT_APP,
        '        this._readingsOk = storageOk;',
        '        this._readingsOk = true;'],
    /* ⑬ App：面常量退回手写一份（本仓 J7 形态）。 */
    q13: [KT_APP,
        'const FACE_OK = KETTLE_FACES[0];',
        'const FACE_OK = ' + Q + 'ok' + Q + ';'],
    /* ⑭ App：保留数取值门塔平（坏值照收，台账一存就空）。 */
    q14: [KT_APP,
        '    if (n === null || !Number.isInteger(n) || n < 1) return KETTLE_MAX_NOTES;',
        '    if (false) return KETTLE_MAX_NOTES;'],
    /* ⑮ App：换会话不再重取（三格全留着 —— 源就是切角色原样留着）。 */
    q15: [KT_APP,
        '        this.probe();' + NL + '        if (this._view) this._view.refresh();' + NL + '    }' + NL + '    render() {',
        '        if (false) this.probe();' + NL + '        if (this._view) this._view.refresh();' + NL + '    }' + NL + '    render() {'],
    /* Ⅶ App：「写了但认不出来」不再单列（源就是把它当空）。 */
    q19: [KT_APP,
        '            this._bad = this._loadNotes(rn);',
        '            this._bad = false;'],
    /* ⑯ 视图：面色相塔平（四态只有一种色）。 */
    q16: [KT_VIEW,
        'FACE_TONE[KETTLE_FACES[2]] = ' + Q + 'err' + Q + ';',
        'FACE_TONE[KETTLE_FACES[2]] = FACE_TONE[KETTLE_FACES[0]];'],
    /* ⑰ 视图：卡片判定退回直点元素。 */
    q17: [KT_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute(" + Q + "data-open" + Q + ") !== null);",
        "            const cardEl = (t.getAttribute(" + Q + "data-open" + Q + ") !== null) ? t : null;"],
    /* ⑱ 视图：空与坏塔成一话。 */
    q18: [KT_VIEW,
        "            parts.push('<div class=\"ktl-list-none\">'" + NL + "                + this._esc(app.faceTextOf(app.faceOf())) + '</div>');",
        "            parts.push('<div class=\"ktl-list-none\">' + this._esc('还没有记过一条') + '</div>');"],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3400_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    const kd = path.join(dir, 'apps', 'kettle');
    fs.mkdirSync(kd, { recursive: true });
    for (const f of ['kettle-data.js', 'kettle-view.js', 'kettle-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'kettle', f), path.join(kd, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「轮次数不出来不许与聊了很久同形」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['rounds-unknown-collapsed']],
    ['I2 破坏「选项不足三个不许当合」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['options-too-few-accepted']],
    ['I3 破坏「场景缺了不许沿用上一次」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['scene-absent-collapsed']],
    ['I4 破坏「单字语气词只登记不保存」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['solo-keep-enabled', 'solo-lone-lost']],
    ['I5 破坏「坏内容不许与没写过同形」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['bad-input-swallowed']],
    ['I6 破坏「取数三态不许塔成一态」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['ledger-face-collapsed']],
    ['I7 破坏「三档不得塔成少于三档」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['round-buckets-collapsed']],
    ['I8 破坏「拆不出说话人必须报数」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['unattributed-not-reported']],
    ['I9 破坏「破折号体检要真报密」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['dash-density-lost']],
    ['I10 破坏「封包三因不许塔成一个」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['settle-reasons-collapsed']],
    ['I11 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q11', 'appmod', appFaceProblems,
        ['storage-absent-lost', 'projection-not-null-on-absent', 'readings-not-null-on-absent', 'round-count-not-null-on-absent']],
    ['I12 破坏「读数三态门」（App）⇒ 行为判据必须转红', 'q12', 'appmod', appFaceProblems,
        ['readings-not-null-on-absent', 'round-count-not-null-on-absent', 'option-count-not-null-on-absent']],
    ['I13 破坏「面常量取真源」（App）⇒ 结构面判据必须转红', 'q13', 'src', appHandKeyProblems, ['face-constant-handwritten']],
    ['I14 破坏「保留数取值门」（App）⇒ 行为判据必须转红', 'q14', 'appmod', appGateProblems,
        ['keep-fallback-lost', 'keep-cap-lost']],
    ['I15 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q15', 'appmod', appChatProblems,
        ['chat-change-no-notes-reload', 'chat-change-no-policy-reload']],
    ['I16 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appBadContentProblems, ['malformed-face-lost']],
    ['I17 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q16', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I18 破坏「点卡片向上找祖先」（视图）⇒ 视图判据必须转红', 'q17', 'src', viewCardProblems, ['card-climb-lost', 'card-climb-order-lost']],
    ['I19 破坏「空与坏不同形」（视图）⇒ 视图判据必须转红', 'q18', 'src', viewEmptyProblems, ['empty-and-bad-collapsed']],
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
    for (const rel of [KT_DATA, KT_APP, KT_VIEW]) {
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3400k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [KT_DATA, KT_APP, KT_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J4 十道静态门必须在场（含本版两处缺陷所属的那两道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});

test('J5 判据两向自证：真模块上每一条行为判据都必须干净（且真的会跑）', () => {
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), []);
    assert.deepEqual(appBadContentProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(appHandKeyProblems(read(KT_APP)), []);
    assert.deepEqual(viewFaceProblems(read(KT_VIEW)), []);
    assert.deepEqual(viewCardProblems(read(KT_VIEW)), []);
    assert.deepEqual(viewEmptyProblems(read(KT_VIEW)), []);
    assert.deepEqual(viewCommaProblems(read(KT_VIEW)), []);
});

/* ====================== K - 版本与交棒 ====================== */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 40),
        '本套件成立于 RubyPhone 3.40.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    const iter = read('ITERATION_LOG.md');
    assert.ok(iter.includes(man.version), 'ITERATION_LOG.md 必须含本版号');
});

test('K2 交棒必须指向小鼠机余件的真实现状（路线图字面不成立时以实测为准）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.40.0'] || {}).items || [];
    const text = own.join(String.fromCharCode(10));
    assert.ok(text.includes('对话水壶'), 'v3.40.0 条目必须自述本件名');
    assert.ok(text.includes('xiaoshuji'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('desktop'), '交棒必须指向剩余三块');
});
