// tests/system-v3390.test.mjs — 时光胶囊 [v3.39.0]
//
// 本套件守三件事：
//  ① 封存取回内核的六条口径（封存时间三态互不同形 / 天数算不出来的不许与「当天」同形 /
//     坏输入不许静默成了空列表 / 未填心情不许与默认值同形 / 两条硬约束要报出「哪一句里的哪个词」/
//     台账「一条都没有」不许与「取不出来」同形）；
//  ② 四块不缝真的没缝（零网络零密钥 / 不碰宿主对象 / 不跨 App 读 / 不收外链不落数据库）；
//  ③ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 / v3.36 / v3.37 / v3.38 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/sourcebook/sourcebook-data.js';
import * as APP from '../apps/sourcebook/sourcebook-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SB_DATA = 'apps/sourcebook/sourcebook-data.js';
const SB_APP = 'apps/sourcebook/sourcebook-app.js';
const SB_VIEW = 'apps/sourcebook/sourcebook-view.js';
const SB_CSS = 'apps/sourcebook/sourcebook.css';
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

/** 剥注释（字符状态机，与 v3300…3380 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词（先不说）是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故 L 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}

/** 内存假存储：`key -> 字符串`。App 只经 `storage.get/set`，与真件同形。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^sourcebook_/` 前缀拼 chatId 实现）。
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

/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new APP.SourcebookApp(shellStub(), storage);

/** 一封合法的信（三必填都齐）。 */
const good = (over = {}) => Object.assign({
    message: '写给你的一封信',
    openDate: '2027-01-01',
    createdAt: '2026-01-01'
}, over);

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 封存时间三态互不同形：没写与写了但坏的不许同为 ok（源 createdAt || Date.now()）', () => {
    const c = (x) => DAT.spanOf({ message: 'x', openDate: '2027-01-01', createdAt: x });
    assert.equal(c('').created, DAT.CREATED_STATES.absent, '空的必须是「没写」');
    assert.equal(c('   ').created, DAT.CREATED_STATES.absent);
    assert.equal(c('2026-01-01').created, DAT.CREATED_STATES.ok);
    assert.equal(c('45000').created, DAT.CREATED_STATES.ok, '日序号也是一种合法形态');
    assert.equal(c('三年前').created, DAT.CREATED_STATES.malformed, '写了但不是日期也不是序号 = 坏');
    /* 三态必须互不相同（塔成两态就不合格）。 */
    const triCreated = [c('').created, c('三年前').created, c('2026-01-01').created];
    assert.equal(new Set(triCreated).size, 3, '三态必须互不同形');
    /* 取不出来时 days 必须是 null（**不许编 0、不许当今天**）。 */
    assert.equal(c('').days, null);
    assert.equal(c('三年前').days, null);
    assert.equal(c('三年前').known, false);
    /* 真源表也要在场（视图与校验共用这一张）。 */
    assert.equal(DAT.CREATED_STATE_KEYS.length, 3);
    assert.equal(DAT.CREATED_STATES.absent, 'absent');
    assert.equal(DAT.CREATED_STATES.malformed, 'malformed');
});

test('A2 天数算不出来的不许与「当天或隔天」同形（源默认档喰掉两种）', () => {
    /* 两个日期都缺 ⇒ 算不出来。 */
    const unk = DAT.spanOf({ message: 'x' });
    assert.equal(unk.known, false, '算不出来必须 known=false');
    assert.equal(unk.days, null, '不许编 0');
    /* 同天封同天拆 ⇒ 真·首档。 */
    const same = DAT.spanOf({ message: 'x', createdAt: '2026-01-01', openDate: '2026-01-01' });
    assert.equal(same.known, true);
    assert.equal(same.days, 0);
    assert.equal(same.bucket, 'same_day');
    /* 两种处境不许同形。 */
    assert.notEqual(unk.bucket, same.bucket, '算不出来的不许与首档同形');
    assert.equal(unk.days === null, true);
    assert.equal(same.days === null, false);
    /* 六档各带自己的天数下限（塔成一档 = 收信口吻永远偏档）。 */
    assert.equal(DAT.SPAN_BUCKETS.length, 6);
    const floors = DAT.SPAN_BUCKETS.map((k) => DAT.SPAN_META[k].floorDays);
    assert.deepEqual(floors, [0, 2, 7, 30, 90, 365], '六档下限必须逐档递增且取真源');
    /* 分档边界实测。 */
    assert.equal(DAT.spanBucket(1).bucket, 'same_day');
    assert.equal(DAT.spanBucket(2).bucket, 'few_days');
    assert.equal(DAT.spanBucket(6).bucket, 'few_days');
    assert.equal(DAT.spanBucket(7).bucket, 'few_weeks');
    assert.equal(DAT.spanBucket(29).bucket, 'few_weeks');
    assert.equal(DAT.spanBucket(30).bucket, 'few_months');
    assert.equal(DAT.spanBucket(89).bucket, 'few_months');
    assert.equal(DAT.spanBucket(90).bucket, 'months');
    assert.equal(DAT.spanBucket(364).bucket, 'months');
    assert.equal(DAT.spanBucket(365).bucket, 'years');
    assert.equal(DAT.spanBucket(null).known, false);
});

test('A3 坏输入不许静默成了空列表（源 try/catch 后 return []）', () => {
    /* 四种坏输入各有各的因，不许塔成一因。 */
    assert.equal(DAT.foldCapsules('{bad').reason, 'bad_json');
    assert.equal(DAT.foldCapsules(7).reason, 'not_array');
    assert.equal(DAT.foldCapsules(null).reason, 'not_array');
    const empty = DAT.foldCapsules('   ');
    assert.equal(empty.ok, true);
    assert.equal(empty.shape, 'empty_string', '空串是「真的一格都没有」，不是坏');
    assert.notEqual(empty.shape, 'bad_json');
    /* 五种形态都能折（源支持 string / data / items / capsules / timeCapsules）。 */
    const arr = [{ message: 'a', openDate: '2027-01-01' }];
    assert.equal(DAT.foldCapsules(arr).list.length, 1);
    assert.equal(DAT.foldCapsules(JSON.stringify(arr)).list.length, 1);
    assert.equal(DAT.foldCapsules({ data: arr }).list.length, 1);
    assert.equal(DAT.foldCapsules({ items: arr }).list.length, 1);
    assert.equal(DAT.foldCapsules({ capsules: arr }).list.length, 1);
    assert.equal(DAT.foldCapsules({ timeCapsules: arr }).list.length, 1);
    /* 最多折四层：第五层不再折（源同款）。 */
    assert.equal(DAT.foldCapsules({ data: { items: { capsules: { timeCapsules: { data: arr } } } } }).reason, 'not_array');
    /* 逐条筛选：被丢掉的条数与为什么必须报出来（源静默丢）。 */
    const n = DAT.normalizeCapsules([{ message: 'a', openDate: 'x' }, { openDate: 'x' }, 7, { message: 'b', openDate: 'x' }]);
    assert.equal(n.ok, true);
    assert.equal(n.list.length, 2);
    assert.equal(n.dropped, 2, '被剔除的条数必须报');
    assert.equal(n.why.no_message, 1);
    assert.equal(n.why.not_object, 1);
    assert.equal(n.dropped, n.why.no_message + n.why.no_open_date + n.why.not_object,
        '被剔条数必须等于各因之和（塔成一因就丢了线索）');
    for (const k of ['no_message', 'no_open_date', 'not_object']) {
        assert.ok(Object.prototype.hasOwnProperty.call(n.why, k), '三个因必须各自在场：' + k);
    }
    /* 换一组输入：两因计数必须各自独立（同一个计数器就分不出是哪一步剔的）。 */
    const n2 = DAT.normalizeCapsules([{ message: 'a', openDate: 'x' }, 7, 8]);
    assert.equal(n2.why.no_message, 0);
    assert.equal(n2.why.not_object, 2);
    assert.notEqual(n2.why.no_message, n2.why.not_object, '两因必须是各自独立计数');
});

test('A4 未填心情不许与填了默认值同形（源 mood || quiet）', () => {
    const un = DAT.moodOf({ message: 'x' });
    assert.equal(un.filled, false, '没填必须报未填');
    assert.equal(un.key, DAT.MOOD_FALLBACK, '缺省键取真源');
    const filled = DAT.moodOf({ message: 'x', mood: 'quiet' });
    assert.equal(filled.filled, true, '明确填了就必须报填了');
    assert.equal(filled.key, 'quiet');
    /* 两种处境不许同形（键相同、状态不同）。 */
    assert.equal(un.key === filled.key, true);
    assert.notEqual(un.filled, filled.filled);
    const other = DAT.moodOf({ message: 'x', mood: '开心' });
    assert.equal(other.filled, true);
    assert.equal(other.key, '开心');
    /* 空白串算没填（不许当成填了空白）。 */
    assert.equal(DAT.moodOf({ message: 'x', mood: '   ' }).filled, false);
});

test('A5 两条硬约束要报出「哪一句里的哪个词」（源抛异常，调用方常吞掉）', () => {
    const g = DAT.guardEcho({ roleMessage: '我请你吃饭吧' });
    assert.equal(g.ok, false);
    assert.equal(g.hits.length, 1);
    assert.equal(g.hits[0].reason, 'offline_or_gift');
    assert.equal(g.hits[0].field, 'roleMessage', '必须报出是哪一句');
    assert.equal(g.hits[0].word, '请你吃', '必须报出是哪个词（词表里先命中的那个）');
    /* 压力那一条同理（且前后两段判也算一种命中形）。 */
    const p = DAT.guardEcho({ receiptNote: '你必须坚持下去' });
    assert.equal(p.ok, false);
    assert.equal(p.hits[0].reason, 'pressure');
    assert.equal(p.hits[0].field, 'receiptNote');
    const pair = DAT.guardEcho({ note: '不要让未来的你失望' });
    assert.equal(pair.ok, false);
    assert.equal(pair.hits[0].reason, 'pressure');
    assert.equal(pair.hits[0].word, '不要让...失望', '两段判要合成一个整词形报出去');
    /* 干净的回信必须过。 */
    assert.equal(DAT.guardEcho({ roleMessage: '今天的风很轻' }).ok, true);
    assert.equal(DAT.guardEcho({}).ok, true);
    /* 两因各自计数，不许塔成一个「有问题」。 */
    const both = DAT.guardEcho({ roleMessage: '我请你吃饭', note: '你必须加油' });
    assert.equal(both.reasons.offline_or_gift, 1);
    assert.equal(both.reasons.pressure, 1);
    assert.equal(DAT.GUARD_KEYS.length, 2);
    /* 词库规模必须从真源读（不许手抄）。 */
    const v = DAT.guardVocab();
    assert.ok(v.offline >= 20, '线下词库条数要像话');
    assert.ok(v.pressure >= 10, '压力词库条数要像话');
    assert.equal(v.fields, 5);
    assert.equal(DAT.GUARD_FIELDS.length, 5);
    assert.ok(v.pressure > DAT.GUARD_FIELDS.length, '压力一栏要含那条两段判');
});

test('A6 台账「一条都没有」不许与「取不出来」同形（源把回执堆在同一个键里）', () => {
    assert.equal(DAT.ledgerFace(null), DAT.SOURCEBOOK_FACES.storage_absent);
    assert.equal(DAT.ledgerFace({ receipts: [] }), DAT.SOURCEBOOK_FACES.empty);
    assert.equal(DAT.ledgerFace({ receipts: [{}] }), DAT.SOURCEBOOK_FACES.ok);
    const triFace = [DAT.ledgerFace(null), DAT.ledgerFace({ receipts: [] }), DAT.ledgerFace({ receipts: [{}] })];
    assert.equal(new Set(triFace).size, 3, '三态必须互不同形');
    assert.equal(DAT.SOURCEBOOK_FACES.ok, 'ok');
    assert.equal(DAT.SOURCEBOOK_FACES.empty, 'empty');
    assert.equal(DAT.SOURCEBOOK_FACES.storage_absent, 'storage_absent');
});

/** 读数面：跨度 / 口吻 / 心情三类计数分开报，且取不出来的条数要单列。 */
test('A7 读数面：跨度档分布与口吻族分布与心情两态分开算', () => {
    const list = [
        { message: '今天很开心', openDate: '2026-01-01', createdAt: '2026-01-01', mood: '甜' },
        { message: '好难过', openDate: '2027-01-01', createdAt: '2026-01-01' },
        { message: '算不出来的一封' }
    ];
    const r = DAT.sourcebookReadings(list, { receipts: [{}, {}] });
    assert.equal(r.total, 3);
    assert.equal(r.spanUnknown, 1, '算不出来的要单列');
    assert.equal(r.createdMissing, 1, '封存时间取不出来的要单列');
    assert.equal(r.moodFilled, 1);
    assert.equal(r.moodMissing, 2);
    assert.equal(r.moodFilled + r.moodMissing, r.total);
    assert.equal(r.receipts, 2);
    /* 六档 / 六族的计数键必须逐档逐族在场（包括零的），否则视图会漏画一档。 */
    for (const k of DAT.SPAN_BUCKETS) assert.equal(typeof r.spanCounts[k], 'number', k + ' 必须有一格');
    for (const k of DAT.TONE_TYPES) assert.equal(typeof r.toneCounts[k], 'number', k + ' 必须有一族');
    assert.equal(Object.keys(r.spanCounts).length, 6);
    assert.equal(Object.keys(r.toneCounts).length, 6);
    /* 档计数之和 + 算不出来 = 总数（不许丢条）。 */
    const sumSpan = DAT.SPAN_BUCKETS.reduce((a, k) => a + r.spanCounts[k], 0);
    assert.equal(sumSpan + r.spanUnknown, r.total);
    const sumTone = DAT.TONE_TYPES.reduce((a, k) => a + r.toneCounts[k], 0);
    assert.equal(sumTone, r.total, '每一封都要落在一族里');
    /* 口吻六族逐族各异其形（塔成一族 = 所有回信都是同一种腔）。 */
    const labels = DAT.TONE_TYPES.map((k) => DAT.toneLabel(k));
    assert.equal(new Set(labels).size, 6, '六族人话必须互不相同');
    const feels = DAT.TONE_TYPES.map((k) => DAT.TONE_META[k].feel);
    assert.equal(new Set(feels).size, 6, '六族说话指引必须互不相同');
});

/** 口吻分族：优先级与源一致（混合 > 正 > 难 > 期待 > 柔软 > 日常）。 */
test('A8 口吻分族：确定性与优先级与源一致', () => {
    assert.equal(DAT.toneOf({ message: '很开心，但也好难过' }).type, 'mixed');
    assert.equal(DAT.toneOf({ message: '今天很开心' }).type, 'happy');
    assert.equal(DAT.toneOf({ message: '真的好难过' }).type, 'difficult');
    assert.equal(DAT.toneOf({ message: '期待下一次出发' }).type, 'anticipation');
    assert.equal(DAT.toneOf({ message: '很想念你' }).type, 'tender');
    assert.equal(DAT.toneOf({ message: '今天吃了面' }).type, 'daily');
    /* 同输入必得同族（确定性）。 */
    assert.equal(DAT.toneOf({ message: '开心又难过' }).type, DAT.toneOf({ message: '开心又难过' }).type);
    /* 心情也参与分词（源同款）。 */
    assert.equal(DAT.toneOf({ message: '今天吃了面', mood: '开心' }).type, 'happy');
    /* 四位命中表要在场（模型与视图据此说清「为什么是这一族」）。 */
    const t = DAT.toneOf({ message: '开心又难过' });
    assert.equal(t.matches.positive, true);
    assert.equal(t.matches.difficult, true);
    assert.equal(typeof t.matches.anticipation, 'boolean');
    assert.equal(typeof t.matches.tender, 'boolean');
    /* 认不出的族名不许报成空字符串（视图徽章要有话说）。 */
    assert.equal(DAT.toneLabel('nope'), DAT.toneLabel('daily'));
    assert.equal(DAT.spanLabel('nope'), DAT.spanLabel('same_day'));
});

/* ══════════════════════ B — App 行为面（真跑内存存储） ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一条信都没有」', () => {
    /* 情形①：storage 一取就抛 —— 这是「取不出来」，不是「空的」。 */
    const hostile = { get: () => { throw new Error('boom'); }, set: () => {} };
    const a1 = newApp(hostile);
    assert.equal(a1.faceOf(), DAT.SOURCEBOOK_FACES.storage_absent, '取不出来必须报 storage_absent');
    assert.equal(a1.probe(), null, '取不出来时投影必须是 null（视图拿不到投影）');
    /* 情形②：storage 根本没给 get —— 同样算取不出来。 */
    const a2 = newApp({});
    assert.equal(a2.faceOf(), DAT.SOURCEBOOK_FACES.storage_absent);
    assert.equal(a2.probe(), null);
    /* 情形③：storage 好的、只是没东西 —— 这是「还没有存过信」，不是「取不出来」。 */
    const a3 = newApp(memStorage());
    assert.equal(a3.faceOf(), DAT.SOURCEBOOK_FACES.empty, '空的必须是 empty，不能与 storage_absent 同形');
    assert.notEqual(a3.faceOf(), a1.faceOf());
    /* 情形④：有信 ⇒ ok，且投影是一份对象。 */
    const a4 = newApp(memStorage({ sourcebook_capsules: JSON.stringify({ capsules: [good()] }) }));
    assert.equal(a4.faceOf(), DAT.SOURCEBOOK_FACES.ok);
    assert.ok(a4.probe() && typeof a4.probe() === 'object');
    /* 情形⑤：三条键里只要有一条取不出来，一律 storage_absent（不许只当那一格空）。 */
    let n = 0;
    const flaky = { get: (k) => { if (k === 'sourcebook_policy') { n += 1; throw new Error('boom'); } return null; }, set: () => {} };
    const a5 = newApp(flaky);
    assert.equal(a5.faceOf(), DAT.SOURCEBOOK_FACES.storage_absent);
    assert.equal(n > 0, true, '策略键必须真被取过');
});

/** 读数三态：读数取不出来时读数一律 null（视图画「拿不到」而不是零点）。 */
test('B2 读数取不出来不许画成零点（「读不到」与「这一档零封」不同形）', () => {
    const hostile = { get: () => { throw new Error('boom'); }, set: () => {} };
    const app = newApp(hostile);
    assert.equal(app.readingsOk(), false);
    assert.equal(app.readings(), null, '读数取不出来必须是 null');
    /* 六档六族的计数一律 null（不是 0）。 */
    for (const r of app.spanRows()) assert.equal(r.count, null, '取不出来时档计数必须是 null');
    for (const r of app.toneRows()) assert.equal(r.count, null, '取不出来时族计数必须是 null');
    /* 读数行不许报一串 0。 */
    assert.ok(app.summaryLine().includes('拿不到'), '读数行必须说「拿不到」，实测：' + app.summaryLine());
    /* 对照：storage 好且真没信时，计数是 0（不是 null）。 */
    const ok = newApp(memStorage());
    assert.equal(ok.readingsOk(), true);
    for (const r of ok.spanRows()) assert.equal(r.count, 0, '真没信时计数是 0');
    for (const r of ok.toneRows()) assert.equal(r.count, 0);
    assert.equal(ok.summaryLine().includes('拿不到'), false);
    assert.ok(ok.summaryLine().includes('共 0 封信'));
});

test('B3 封存三必填分因拒绝：坏值不许静默入库（源直接 push）', () => {
    const app = newApp(memStorage());
    /* 四种拒绝因各有各的名，不许塔成一句「存不下」。 */
    assert.equal(app.seal({ openDate: '2027-01-01', createdAt: '2026-01-01' }).reason, 'no_message');
    assert.equal(app.seal({ message: '  ', openDate: '2027-01-01', createdAt: '2026-01-01' }).reason, 'no_message');
    const bad = app.seal(good({ openDate: '明年' }));
    assert.equal(bad.reason, 'bad_open_date');
    assert.equal(bad.why, 'malformed', '拆开日期的坏法要分出来');
    assert.equal(app.seal(good({ openDate: '2027-13-01' })).why, 'out_of_range');
    assert.equal(app.seal(good({ openDate: '' })).why, 'absent');
    const bc = app.seal(good({ createdAt: '三年前' }));
    assert.equal(bc.reason, 'bad_created_at');
    assert.equal(bc.saw, '三年前', '填了什么要如实回报（不许只说坏）');
    /* 三种坏日期不许同形。 */
    const whys = [app.seal(good({ openDate: '' })).why, app.seal(good({ openDate: '明年' })).why, app.seal(good({ openDate: '2027-13-01' })).why];
    assert.equal(new Set(whys).size, 3, '缺 / 畸形 / 越界三态必须互不同形');
    /* 以上全拒，书架必须还是空的。 */
    assert.equal(app.capsuleCount(), 0);
    /* 合法信真入库，且封存时间三态在架面上可读。 */
    const okr = app.seal(good());
    assert.equal(okr.ok, true);
    assert.equal(okr.capsule.createdAtState, DAT.CREATED_STATES.ok);
    const okr2 = app.seal(good({ createdAt: '', message: '没写封存时间的一封' }));
    assert.equal(okr2.reason, 'bad_created_at', '没写封存时间一律拒（不许当今天）');
    assert.equal(app.capsuleCount(), 1);
});

test('B4 封存时间三态在架面上可读（没填与填坏了不同形）', () => {
    /* 直接播种一条「没填封存时间」的旧数据（源时代留下的脏数据）。 */
    const app = newApp(memStorage({
        sourcebook_capsules: JSON.stringify({ capsules: [
            { message: '没填的一封', openDate: '2027-01-01' },
            { message: '填坏了的一封', openDate: '2027-01-01', createdAt: '三年前' },
            { message: '好的一封', openDate: '2027-01-01', createdAt: '2026-01-01' }
        ] })
    }));
    const rows = app.shelfRows();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].createdAtState, DAT.CREATED_STATES.absent);
    assert.equal(rows[1].createdAtState, DAT.CREATED_STATES.malformed);
    assert.equal(rows[2].createdAtState, DAT.CREATED_STATES.ok);
    assert.equal(new Set(rows.map((r) => r.createdAtState)).size, 3, '三态必须都在架面上能区分');
    /* 三态各自的读数也要分开数。 */
    assert.equal(app.readings().createdMissing, 2, '缺与坏都算「取不出来」，但读数要能数出来');
    assert.ok(app.summaryLine().includes('封存时间取不出 2'), '实测：' + app.summaryLine());
    /* 跨度：三条都算不出来（前两条因封存时间、第三条因跨年但可算 —— 真算） */
    assert.equal(rows[0].spanKnown, false);
    assert.equal(rows[1].spanKnown, false);
    assert.equal(rows[2].spanKnown, true);
    assert.equal(rows[0].spanLabel, DAT.SPAN_UNKNOWN_LABEL);
});

test('B5 撤信与越界：下标越界一律拒，撤完还剩几封要报', () => {
    const app = newApp(memStorage());
    app.seal(good({ message: 'a' }));
    app.seal(good({ message: 'b' }));
    assert.equal(app.capsuleCount(), 2);
    assert.equal(app.unseal(5).reason, 'out_of_range');
    assert.equal(app.unseal(-1).reason, 'out_of_range');
    assert.equal(app.unseal('x').reason, 'out_of_range');
    assert.equal(app.unseal(1.5).reason, 'out_of_range', '小数不是合法下标');
    assert.equal(app.capsuleAt(9), null);
    const r = app.unseal(0);
    assert.equal(r.ok, true);
    assert.equal(r.left, 1, '还剩几封要如实报');
    /* 撤了要真落盘。 */
    assert.equal(JSON.parse(app.storage.get('sourcebook_capsules')).capsules.length, 1);
    /* 下标 0 是**合法**的（本仓楼层门同族教训）。 */
    assert.equal(app.capsuleAt(0).message, 'b');
});

/** 上限：书架封顶 50，满了拒绝且报上限（不许静默丢）。 */
test('B6 书架封顶：满了要拒并报上限（不许静默丢新信）', () => {
    const app = newApp(memStorage());
    for (let i = 0; i < DAT.SOURCEBOOK_MAX_CAPSULES; i += 1) {
        assert.equal(app.seal(good({ message: 'm' + i })).ok, true);
    }
    const over = app.seal(good({ message: 'overflow' }));
    assert.equal(over.ok, false);
    assert.equal(over.reason, 'over_max');
    assert.equal(over.max, DAT.SOURCEBOOK_MAX_CAPSULES);
    assert.equal(app.capsuleCount(), DAT.SOURCEBOOK_MAX_CAPSULES);
    assert.equal(app.shelfRows()[DAT.SOURCEBOOK_MAX_CAPSULES - 1].message, 'm' + (DAT.SOURCEBOOK_MAX_CAPSULES - 1), '被封的必须是新信，老信不许被顶掉');
});

test('B7 产要求文本：本件不替你发请求，只把要求写清楚（且跨度按三态写）', () => {
    const app = newApp(memStorage());
    app.seal(good({ message: '记得下雨那天' }));
    const r = app.buildRequest(0);
    assert.equal(r.ok, true);
    assert.ok(typeof r.text === 'string' && r.text.length > 100);
    /* 要求文本的口径全来自真源表（六族指词 / 四段名 / 上限）。 */
    assert.equal(r.tone.type, 'tender', '这封信的真族由分词表定（记得两字在柔软族）');
    assert.ok(r.text.includes(DAT.toneLabel(r.tone.type)), '口吻族名必须取真源（按真族取）');
    assert.ok(r.text.includes(DAT.TONE_META[r.tone.type].feel), '手感也取真源');
    assert.ok(r.text.includes(String(DAT.SOURCEBOOK_MAX_KEYWORDS)), '关键词上限必须取真源');
    for (const seg of DAT.ECHO_SEGMENTS) assert.ok(r.text.includes(seg), '四段之一必须在要求里：' + seg);
    /* 两条硬约束必须写进要求里（否则模型不知道规矩）。 */
    assert.ok(r.text.includes('不许出现线下互动') || r.text.includes('线下互动'));
    assert.ok(r.text.includes('不许给用户压力') || r.text.includes('压力'));
    /* 词库规模与见证语上限取真源（不许手抄）。 */
    assert.deepEqual(r.guardWords, DAT.guardVocab());
    assert.equal(r.witnessMax, DAT.SOURCEBOOK_RECEIPT_WITNESS_MAX);
    /* 跨度算不出来的信一样能产要求，但文本里要写「不要猜」。 */
    app.seal(good({ message: '没封存时间不行' }));
    /* 那一条被拒了，故用直接播种的方式造一封跨度算不出来的信。 */
    const app2 = newApp(memStorage({ sourcebook_capsules: JSON.stringify({ capsules: [{ message: 'x', openDate: '2027-01-01' }] }) }));
    const r2 = app2.buildRequest(0);
    assert.equal(r2.ok, true);
    assert.ok(r2.text.includes(DAT.SPAN_UNKNOWN_LABEL), '算不出来时要求文本要写明取不出来');
    assert.ok(r2.text.includes('不要猜'), '且必须写「不要猜」（源会当今天封的）');
    assert.equal(r2.span.known, false);
    /* 越界一律拒（不许静默产一段空文本）。 */
    const bad = app2.buildRequest(9);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'out_of_range');
});

test('B8 收回信：四类拒绝分因 + 三段落兜底如实报（源缺字段就走默认文案）', () => {
    const app = newApp(memStorage());
    app.seal(good({ message: '写给你的一封信' }));
    /* 四类拒绝各有其名。 */
    assert.equal(app.acceptEcho(0, '   ').reason, 'empty_input');
    assert.equal(app.acceptEcho(0, '{bad').reason, 'bad_json');
    assert.equal(app.acceptEcho(0, '7').reason, 'not_object');
    const g = app.acceptEcho(0, JSON.stringify({ roleMessage: '我请你吃饭' }));
    assert.equal(g.reason, 'guard', '碰硬约束的回信一律不入台账');
    assert.equal(g.guard.hits[0].field, 'roleMessage');
    assert.equal(g.guard.hits[0].word, '请你吃');
    assert.equal(app.receiptRows().length, 0, '被拒的回信不许留回执');
    /* 干净回信入库，三段落兜底要如实报（不许报成模型真写了）。 */
    const okr = app.acceptEcho(0, JSON.stringify({ roleMessage: '那天的雨很大' }));
    assert.equal(okr.ok, true);
    assert.equal(okr.fellBack.title, true, '没给标题就必须报落兜底');
    assert.equal(okr.fellBack.keywords, true);
    assert.equal(okr.fellBack.witness, true);
    assert.equal(okr.provided.roleMessage, true, '真写了的必须报真写了');
    assert.equal(okr.segments.title.length > 0, true, '落兜底也要给一段能看的文案');
    /* 全都给了 ⇒ 三项都不落兜底。 */
    const full = app.acceptEcho(0, JSON.stringify({
        title: '拆信', roleMessage: '那天的雨很大', receiptNote: '好好收下这句话', keywords: ['雨', '那天']
    }));
    assert.equal(full.ok, true);
    assert.equal(full.fellBack.title, false);
    assert.equal(full.fellBack.keywords, false);
    assert.equal(full.fellBack.witness, false);
    assert.deepEqual(full.segments.keywords, ['雨', '那天']);
    /* 回执行：三段落兜底标记要能在台账面上读出来。 */
    const rows = app.receiptRows();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].fellBack.title, true);
    assert.equal(rows[1].fellBack.title, false);
    assert.equal(rows[0].guardOk, true);
    /* 回执行自带跨度（认得出来 / 认不出来分开）。 */
    assert.equal(typeof rows[0].spanKnown, 'boolean');
    assert.equal(typeof rows[0].spanLabel, 'string');
});

test('B9 台账容量可调：超上限截最近，且「满了」与「就这几条」不同形', () => {
    const app = newApp(memStorage());
    app.seal(good());
    for (let i = 0; i < 8; i += 1) app.acceptEcho(0, JSON.stringify({ roleMessage: 'r' + i }));
    assert.equal(app.receiptRows().length, 8);
    assert.equal(app.policyRow().receiptFull, false, '8 / 60 不是满');
    /* 调小保留数 ⇒ 立刻截最近。 */
    const r = app.setLedgerKeep(3);
    assert.equal(r.ok, true);
    assert.equal(r.took, 3);
    assert.equal(app.receiptRows().length, 3, '超上限必须截最近');
    assert.equal(app.policyRow().receiptFull, true, '削到上限之后必须报「满」');
    /* 截的必须是**最近**的（旧的先丢）。 */
    assert.equal(app.receiptRows()[2].capsuleId, app.receiptRows()[0].capsuleId);
    assert.ok(JSON.parse(app.storage.get('sourcebook_ledger')).receipts.length === 3, '截完要落盘');
    /* 落盘读回后仍是 3 条（策略也落盘）。 */
    assert.equal(JSON.parse(app.storage.get('sourcebook_policy')).ledgerKeep, 3);
    /* 清空台账。 */
    app.clearLedger();
    assert.equal(app.receiptRows().length, 0);
});

test('B10 策略取值门：坏值一律回落且如实报「我填的没被采纳」', () => {
    const app = newApp(memStorage());
    /* 合法值采纳。 */
    const a = app.setLedgerKeep(12);
    assert.equal(a.saw, 12);
    assert.equal(a.took, 12);
    assert.equal(app.ledgerKeepOf(), 12);
    /* 坏值一律回落真源上限，并如实报 saw（用户能看出没被采纳）。 */
    for (const bad of [0, -3, 1.5, 'abc', null, undefined, {}, '']) {
        const r = app.setLedgerKeep(bad);
        assert.equal(r.took, DAT.SOURCEBOOK_MAX_RECEIPTS, '坏值必须回落（实测 saw=' + String(bad) + ' took=' + r.took + '）');
    }
    /* 超上限一律封顶（不许把保留数填成比上限还大）。 */
    assert.equal(app.setLedgerKeep(9999).took, DAT.SOURCEBOOK_MAX_RECEIPTS);
    /* 数字字符串照样认（表单给的就是字符串）。 */
    assert.equal(app.setLedgerKeep('7').took, 7);
});

test('B11 投影与视图口：视图只调 App 的口，自己不拆内部结构', () => {
    const app = newApp(memStorage());
    app.seal(good({ message: '投影测试' }));
    const p = app.probe();
    assert.ok(p && typeof p === 'object');
    for (const k of ['face', 'readings', 'shelf', 'spanRows', 'toneRows', 'receipts', 'policy']) {
        assert.ok(Object.prototype.hasOwnProperty.call(p, k), '投影必须含 ' + k);
    }
    assert.equal(p.shelf.length, 1);
    assert.equal(p.spanRows.length, 6);
    assert.equal(p.toneRows.length, 6);
    /* 页签口：坏页签一律落回书架（不许静默停在不可见的面）。 */
    assert.equal(app.setTab('span'), 'span');
    assert.equal(app.tab(), 'span');
    assert.equal(app.setTab('nope'), 'shelf');
    assert.equal(app.setTab(''), 'shelf');
    /* 详情口：打开 / 收起 / 当前键。 */
    assert.equal(app.openCapsule(0).ok, true);
    assert.equal(app.currentKey(), '0');
    assert.equal(app.openCapsule(9).ok, false);
    assert.equal(app.currentKey(), '0', '打不开的不许把当前的清掉');
    assert.equal(app.closeCapsule(), 'shelf');
    assert.equal(app.currentKey(), '');
    /* 目录口：键面人话全取真源（视图不手写第二份）。 */
    const cat = app.catalogs();
    assert.equal(cat.spans, DAT.SPAN_BUCKETS);
    assert.equal(cat.tones, DAT.TONE_TYPES);
    assert.equal(cat.moodFallback, DAT.MOOD_FALLBACK);
    assert.deepEqual(cat.guardVocab, DAT.guardVocab());
    assert.equal(cat.limits.maxCapsules, DAT.SOURCEBOOK_MAX_CAPSULES);
    assert.equal(cat.limits.maxReceipts, DAT.SOURCEBOOK_MAX_RECEIPTS);
    assert.equal(cat.limits.maxReceiptWitness, DAT.SOURCEBOOK_RECEIPT_WITNESS_MAX);
    assert.equal(cat.recipientKeys.length, 2);
    assert.equal(cat.createdKeys.length, 3);
    assert.deepEqual(cat.tabs, ['shelf', 'span', 'tone', 'ledger', 'policy']);
    assert.equal(app.spanLabelOf('years'), DAT.spanLabel('years'));
    assert.equal(app.toneLabelOf('tender'), DAT.toneLabel('tender'));
    assert.equal(app.guardLabelOf('pressure'), DAT.guardLabel('pressure'));
    /* 草案口：产过要求文本才有草案。 */
    assert.equal(app.draftOf(), '');
    app.buildRequest(0);
    assert.ok(app.draftOf().length > 0);
});

/* ══════════════════════ C — 接线与隔离 ══════════════════════ */
test('C1 三条会话键随会话隔离（换角色后不许读到别人的信）', () => {
    const st = sessionStorage();
    const app = newApp(st);
    app.seal(good({ message: '第一段关系里写的' }));
    app.acceptEcho(0, JSON.stringify({ roleMessage: '回信' }));
    app.setLedgerKeep(5);
    assert.equal(app.capsuleCount(), 1);
    assert.equal(app.receiptRows().length, 1);
    /* 换会话 ⇒ 全部重取（旧会话的信不许留着）。 */
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.capsuleCount(), 0, '换会话后书架必须清空');
    assert.equal(app.receiptRows().length, 0, '换会话后台账必须清空');
    assert.equal(app.ledgerKeepOf(), DAT.SOURCEBOOK_MAX_RECEIPTS, '换会话后策略必须回缺省');
    assert.equal(app.faceOf(), DAT.SOURCEBOOK_FACES.empty);
    assert.equal(app.currentKey(), '', '换会话必须把详情态清掉');
    assert.equal(app.draftOf(), '', '换会话必须把草案清掉');
    assert.equal(app.tab(), 'shelf', '换会话必须把页签收回书架');
    /* 切回去 ⇒ 原来的信还在。 */
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.capsuleCount(), 1, '换回来必须能读回自己的信');
    assert.equal(app.receiptRows().length, 1);
    assert.equal(app.ledgerKeepOf(), 5);
    assert.equal(app.faceOf(), DAT.SOURCEBOOK_FACES.ok);
    /* 三条键必须真的各自落在一个带前缀的格上（抄错前缀 = 串味）。 */
    for (const k of ['sourcebook_capsules', 'sourcebook_policy', 'sourcebook_ledger']) {
        assert.equal(st._box.has('c1::' + k), true, k + ' 必须落在会话隔离的格上');
    }
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    /* ① App 注册表：id 必须在册。 */
    assert.ok(/id: 'sourcebook'/.test(apps), 'config/apps.js 必须有 sourcebook 条目');
    /* ② 会话键前缀：不登记 ⇒ 三条键走全局存储（串味）。 */
    assert.ok(/\/\^sourcebook_\//.test(read(STORAGE)), 'config/storage.js 必须有 /^sourcebook_/ 前缀');
    /* ③ 入口：懒加载分支 + 重绑表。 */
    const idx = read(INDEX);
    assert.ok(idx.includes("appId === 'sourcebook'"), 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/sourcebook/sourcebook-app.js')"), 'index.js 必须真 import 本件');
    assert.ok(idx.includes('sourcebookApp'), 'index.js 重绑表必须有 sourcebookApp（换会话才重取）');
    /* ④ 会话键审计：三条键都要在册。 */
    const keys = read(KEYS);
    for (const k of ['sourcebook_capsules', 'sourcebook_policy', 'sourcebook_ledger']) {
        assert.ok(keys.includes("'" + k + "'"), k + ' 必须在 keys-audit 登记');
    }
    /* ⑤ 懒加载目录映射（v255 套件用）。 */
    assert.ok(read(V255).includes("sourcebookApp: 'sourcebook'"), 'v255 dirMap 必须登记 sourcebook 目录');
    /* ⑥ 样式段（段头独立成行）。 */
    const css = read(PHONE_CSS);
    assert.ok(css.includes('[v3.39.0] 时光胶囊'), 'phone.css 必须有本版段头');
    assert.ok(css.includes('.sbr-root'), 'phone.css 必须贴上本件样式正文');
    /* 段序：最新版必须在最前（本仓约定）。 */
    assert.ok(css.indexOf('[v3.39.0] 时光胶囊') < css.indexOf('[v3.38.0] 召回治理台'),
        '本版段必须在 v3.38.0 段之前（最新版在最前）');
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const idx = css.indexOf('[v3.39.0] 时光胶囊');
    assert.ok(idx > 0);
    const lineStart = css.lastIndexOf(NL, idx) + 1;
    const lineEnd = css.indexOf(NL, idx);
    const line = css.slice(lineStart, lineEnd);
    /* 段头行必须是「行首块注释起头、行尾块注释收尾」。 */
    assert.ok(line.startsWith('/*'), '段头行必须以块注释起头，实测：' + line.slice(0, 40));
    assert.ok(line.trimEnd().endsWith('*/'), '段头行必须以块注释收尾，实测：' + line.slice(-40));
    assert.ok(lineStart === 0 || css[lineStart - 1] === NL, '段头不许接在上一段尾后');
    /* 段头行内不许夹着别的东西（行里只能有一个注释对）。 */
    assert.equal(line.split('/*').length, 2, '段头行只许有一个块注释起头');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const src = read(SB_CSS).trim();
    const css = read(PHONE_CSS);
    assert.ok(css.includes(src), 'sourcebook.css 正文必须逐字出现在 phone.css 的本版段里');
});

test('C5 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const v = read(SB_VIEW);
    const a = read(SB_APP);
    const members = new Set();
    for (const m of a.matchAll(/^ {4}([a-zA-Z_$][\w$]*)\(/gm)) members.add(m[1]);
    const used = new Set();
    /* ★ 视图里的 App 句柄是局部变量 app（不是 this.app），故匹配面要盖住两种形。 */
    for (const m of v.matchAll(/\bapp\.([a-zA-Z_$][\w$]*)/g)) used.add(m[1]);
    assert.ok(used.size >= 15, '视图调用面要像话，实测 ' + used.size);
    const missing = [...used].filter((x) => !members.has(x));
    assert.deepEqual(missing, [], '视图调用了 App 上不存在的口：' + missing.join(', '));
});

test('C6 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const v = read(SB_VIEW);
    const css = read(SB_CSS);
    /* 视图产出的全部 sbr- 名字（含拼接前缀）。 */
    const names = new Set();
    for (const m of v.matchAll(/sbr-[a-z0-9_-]+/g)) names.add(m[0]);
    /* 拼出来的（以连字符结尾）按前缀族核：族名必须出现在样式里。 */
    const stems = [...names].filter((x) => x.endsWith('-'));
    for (const s of stems) {
        assert.ok(css.includes('.' + s), '拼接族必须有样式落点：' + s);
    }
    /* 静态类名逐个核（拼出来的那几个除外：它们的后半截在运行时）。 */
    const missing = [];
    for (const n of names) {
        if (n.endsWith('-')) continue;
        if (css.includes('.' + n)) continue;
        missing.push(n);
    }
    assert.deepEqual(missing, [], '视图产出的类没样式落点：' + missing.join(', '));
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
test('D1 不碰模型：三件里一个网络调用都没有（源直读 localStorage 三密钥拼 chat 请求）', () => {
    for (const rel of [SB_DATA, SB_APP, SB_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
        assert.equal(/\bapiKey\b/i.test(code), false, rel + ' 不许读 apiKey');
        assert.equal(/\bAuthorization\b/i.test(code), false, rel + ' 不许出现 Authorization');
        assert.equal(/\bselectedModel\b/i.test(code), false, rel + ' 不许读 selectedModel');
    }
});

test('D2 不碰宿主对象、不落数据库、不跨 App 读（源写宿主微信键与 roles 全局）', () => {
    /* 数据层与 App 层一个字都不许碰宿主（视图是唯一允许碰 DOM 的那一层）。 */
    for (const rel of [SB_DATA, SB_APP]) {
        const code = stripComments(read(rel));
        for (const bad of ['indexedDB', 'IDBDatabase', 'wechatTimeCapsules', 'VirtualPhone', 'DataStorage', 'document.', 'window.', 'messages[']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
    /* ★ 视图层：允许 document.createElement 建**自己那棵子树**，但不许摸宿主全局
     *   （body / head / cookie / window.location / postMessage / iframe）与宿主数据。 */
    const view = stripComments(read(SB_VIEW));
    for (const bad of ['indexedDB', 'IDBDatabase', 'wechatTimeCapsules', 'VirtualPhone', 'DataStorage', 'messages[']) {
        assert.equal(view.includes(bad), false, SB_VIEW + ' 不许出现 ' + bad);
    }
    for (const bad of ['document.body', 'document.head', 'document.cookie', 'window.location', 'postMessage', 'iframe']) {
        assert.equal(view.includes(bad), false, SB_VIEW + ' 不许摸宿主全局：' + bad);
    }
    assert.ok(view.includes('getContentContainer'), '视图必须经 shell 的容器口取容器');
    assert.ok(view.includes('document.createElement('), '视图必须自己建根子树（不整块覆写宿主容器）');
});

test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of [SB_DATA, SB_APP, SB_VIEW, SB_CSS]) {
        const code = stripComments(read(rel));
        /* 样式层里没有引号形态的 url(...)，故 url 一词只会在注释里。 */
        for (const bad of ['http://', 'https://', '//cdn', 'data:image', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.woff']) {
            assert.equal(code.includes(bad), false, rel + ' 不许出现 ' + bad);
        }
    }
});

test('D4 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const app = stripComments(read(SB_APP));
    assert.ok(app.includes('this.storage.get('), '必须经 get 口取数');
    assert.ok(app.includes('this.storage.set('), '必须经 set 口落盘');
    for (const bad of ['this.storage.remove', 'this.storage.delete', 'this.storage.clear', 'this.storage.keys', 'this.storage.all']) {
        assert.equal(app.includes(bad), false, 'storage 出口不许有第三口：' + bad);
    }
    /* 键面必须只有本件三条（拄别版的键名 = 串味）。 */
    const keys = new Set();
    for (const m of app.matchAll(/'(sourcebook_[a-z]+)'/g)) keys.add(m[1]);
    assert.deepEqual([...keys].sort(), ['sourcebook_capsules', 'sourcebook_ledger', 'sourcebook_policy']);
});

/* ══════════════════════ E — 真源消费与手写键 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    /* ★ 消费域与 dead-export 门禁同口径：本模块内部消费也算消费。
     *   否则「被 spanOf 调用的 dayNumber」会被误报成零消费 —— 判据面比门禁严，
     *   就会把合法形态判成欠债（本仓踩过一次）。 */
    const dataCode = stripComments(read(SB_DATA));
    const both = dataCode + NL + stripComments(read(SB_APP)) + NL + stripComments(read(SB_VIEW));
    /* ★ 定义行与默认转出块不算消费（否则任何导出都会自我命中 ⇒ 判据恒绿，
     *   I 组的「破坏后必须转红」就假绿了）。只抹定义行与转出块，**不抹调用行**。 */
    const stripDef = (src) => src
        .replace(/export default \{[\s\S]*?\};/g, '')
        .replace(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+\w+.*$/gm, '');
    const flat = stripDef(both);
    /* ★ 数据层导出的每一张真源表都必须在产品侧被用到。
     *   这条是「功能级失效」的防线（本仓老形态：导出了 API 但全库零调用）。 */
    const tables = ['SPAN_BUCKETS', 'SPAN_META', 'TONE_TYPES', 'TONE_META', 'MOOD_FALLBACK',
        'GUARD_REASONS', 'GUARD_KEYS', 'ECHO_SEGMENTS', 'SPAN_UNKNOWN_LABEL',
        'RECIPIENT_KINDS', 'RECIPIENT_KEYS', 'CREATED_STATES', 'CREATED_STATE_KEYS',
        'SOURCEBOOK_FACES', 'SOURCEBOOK_MAX_CAPSULES', 'SOURCEBOOK_MAX_TITLE',
        'SOURCEBOOK_MAX_MESSAGE', 'SOURCEBOOK_MAX_KEYWORDS', 'SOURCEBOOK_RECEIPT_WITNESS_MAX',
        'SOURCEBOOK_MAX_RECEIPTS'];
    /* 内核函数面同样不许零消费。 */
    const fns = ['parseOpenDate', 'dayNumber', 'spanBucket', 'spanLabel', 'spanOf', 'moodOf',
        'toneOf', 'toneLabel', 'foldCapsules', 'normalizeCapsules', 'guardEcho', 'guardVocab',
        'guardLabel', 'cleanText', 'inlineText', 'clampText', 'normalizeEcho', 'composeRequest',
        'sourcebookReadings', 'ledgerFace'];
    const fnUnused = fns.filter((n) => !flat.includes(n));
    assert.deepEqual(fnUnused, [], '内核函数导出但零消费：' + fnUnused.join(', '));
    /* 默认导出表必须把上面每一张表与每一个函数都收进去（少一项就是半套真源）。 */
    const data = stripComments(read(SB_DATA));
    const def = data.match(/export default \{([\s\S]*?)\};/);
    assert.ok(def, '必须有默认导出表');
    const listed = def[1].split(',').map((x) => x.trim()).filter(Boolean);
    for (const n of tables.concat(fns)) {
        assert.ok(listed.includes(n), '默认导出表漏了：' + n);
    }
});

test('E2 手写键不许回潮：三态与两因的键面必须取真源', () => {
    const app = stripComments(read(SB_APP));
    const view = stripComments(read(SB_VIEW));
    /* App 层的 FACE 常量必须取真源（不许再写一份）。 */
    assert.ok(app.includes('const FACE = SOURCEBOOK_FACES'), 'App 的两态常量必须取真源');
    assert.equal(/const FACE\s*=\s*Object\.freeze\s*\(\s*\{/.test(app), false, '不许手写一份常量表');
    /* 视图的三态人话表必须用计算键（取真源），不许写标识符形键。 */
    assert.ok(view.includes('[SOURCEBOOK_FACES.ok]'), '视图人话表必须用计算键');
    assert.ok(view.includes('[CREATED_STATES.absent]'), '视图三态表必须用计算键');
    assert.equal(view.includes("    storage_absent: "), false, '不许写标识符形键面');
    /* 视图不许写第二份六档 / 六族清单（清单由 App 现算）。 */
    assert.equal(view.includes('SPAN_BUCKETS'), false, '视图不许再持一份六档清单');
    assert.equal(view.includes('TONE_TYPES'), false, '视图不许再持一份六族清单');
    /* 词库规模一律取真源（不许手抄 30 / 10 这种数字）。 */
    assert.equal(/offline:\s*\d/.test(app), false, 'App 不许手抄词库数字');
    assert.ok(app.includes('guardVocab()'), '词库规模必须从真源读');
    assert.ok(view.includes('cat.guardVocab'), '视图的词库读数必须走目录口');
});

test('E3 视图不自己算内核（那是数据层与 App 的事）', () => {
    const view = stripComments(read(SB_VIEW));
    /* 视图不许自己算跨度分档 / 天数 / 分族。 */
    for (const bad of ['floorDays >', 'days >= 365', 'indexOf(\'开心\')', 'spanBucket(', 'toneOf(', 'spanOf(', 'parseOpenDate(']) {
        assert.equal(view.includes(bad), false, '视图不许自己算内核：' + bad);
    }
    /* 视图只许经 app.* 的口拿现算值（现算面必须够宽）。 */
    const calls = new Set();
    for (const m of view.matchAll(/\bapp\.([a-zA-Z_$][\w$]*)/g)) calls.add(m[1]);
    for (const need of ['shelfRows', 'spanRows', 'toneRows', 'receiptRows', 'policyRow', 'summaryLine']) {
        assert.ok(calls.has(need), '视图必须经目录口拿现算值：' + need);
    }
});

/* ══════════════════════ F — 视图面纪律 ══════════════════════ */
test('F1 三态必须分开画：视图必须画出三态人话与三色徽章（不许塔成一句）', () => {
    const view = read(SB_VIEW);
    assert.ok(view.includes('CREATED_LABEL'), '封存时间三态人话表必须在场');
    assert.ok(view.includes('CREATED_TONE'), '封存时间三色表必须在场');
    assert.ok(view.includes('r.createdAtState'), '卡片必须带上三态值');
    for (const k of ['ok', 'absent', 'malformed']) {
        assert.ok(view.includes('[CREATED_STATES.' + k + ']'), '三态之一必须有人话落点：' + k);
    }
    /* 三态人话必须互不相同。 */
    const labels = ['已填', '没填', '认不出来'];
    for (const l of labels) assert.ok(view.includes(l), '三态人话之一必须在场：' + l);
    /* 心情两态分开画。 */
    assert.ok(view.includes('r.moodFilled'), '心情两态必须在场');
    assert.ok(view.includes('心情未填'), '未填必须有自己的话');
});

test('F2 空与坏不同形：同一句话不许两种处境共用（且逗号表达式坑不许回潮）', () => {
    const view = stripComments(read(SB_VIEW));
    /* 两种处境必须各自有话说。 */
    assert.ok(view.includes('存储读不出来，不是「没有信」'), '书架的空与坏必须分开说');
    assert.ok(view.includes('读不出来，不是「没写过」'), '台账的空与坏必须分开说');
    /* ★ 回潮守卫：拼字符串时多一个逗号会把三目表达式与下一行拼串变成**逗号表达式** ——
     *  语法合法、不报错，只是界面上少画一段（前一个操作数被丢弃）。
     *  本仓踩过一次（两处空态各一行）。 */
    const bad = view.split(NL).filter((l) => /\s,\s*$/.test(l));
    assert.deepEqual(bad, [], '行尾不许留裸逗号（会把拼串吞掉）：' + bad.join(' | '));
    /* 计数「—」与 0 不同形。 */
    assert.ok(view.includes('_count'), '计数位必须有单一口');
    assert.ok(view.includes('\u2014'), '取不出来必须画「—」而不是 0');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const view = read(SB_VIEW);
    /* 四个转义字符必须从 String.fromCharCode 拼。 */
    for (const code of ['String.fromCharCode(34)', 'String.fromCharCode(39)', 'String.fromCharCode(38)', 'String.fromCharCode(10)']) {
        assert.ok(view.includes(code), '转义字符必须拼装：' + code);
    }
    const code = stripComments(view);
    /* ★ 不许出现实体字面量（一旦出现，说明有人写了字符串里的实体）。

     *   判据面不是子串：转义函数里本来就有 AMP + 'amp;' 这种拼装形，

     *   真正的危险形态是**裸的 &** 后面紧跟 amp; / lt; / gt; / quot; 等。

     *   （本仓踩过：子串判法把拼装形误报成实体字面量。） */
    const AMP_CH = String.fromCharCode(38);
    for (const tail of ['amp;', 'lt;', 'gt;', 'quot;', '#39;']) {
        assert.equal(code.includes(AMP_CH + tail), false, '不许写实体字面量：' + AMP_CH + tail);
    }
    /* 转义函数必须真把五个字符转完。 */
    const esc = code.match(/_esc\(s\) \{[\s\S]*?\n {4}\}/);
    assert.ok(esc, '必须有转义函数');
    for (const piece of ['AMP', '<', '>', 'DQUOTE', 'SQ']) assert.ok(esc[0].includes(piece), '转义必须盖住 ' + piece);
});

test('F4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const view = stripComments(read(SB_VIEW));
    /* 四类封存拒绝因各有话（不许塔成一句「存不下」）。 */
    for (const r of ['no_message', 'bad_open_date', 'bad_created_at', 'over_max']) {
        assert.ok(view.includes("'" + r + "'"), '封存拒绝因必须分因：' + r);
    }
    /* 四类收信拒绝因各有话。 */
    for (const r of ['empty_input', 'bad_json', 'not_object', 'guard']) {
        assert.ok(view.includes("'" + r + "'"), '收信拒绝因必须分因：' + r);
    }
    /* 硬约束命中必须报「哪一句里的哪个词」。 */
    assert.ok(view.includes('h.field') && view.includes('h.word'), '命中位置必须报出字段与词');
    /* 三段落兜底必须在台账面上写出来。 */
    for (const f of ['标题落兜底', '关键词落兜底', '见证语落兜底']) assert.ok(view.includes(f), '兜底项必须写明：' + f);
    /* 失败面必须有出口（不许把英文键面报给用户）。 */
    assert.ok(view.includes('_buildWhy'), '产要求文本的失败面必须有分因出口');
});

test('F5 点卡片要能打开：判定必须向上找祖先（不许只认直点元素）', () => {
    const view = stripComments(read(SB_VIEW));
    /* ★ 回潮守卫：修前用 ev.target.className 判卡片，点卡片里的正文文字没反应。 */
    assert.ok(view.includes('parentNode'), '点击分派必须向上找祖先（点正文也要能打开）');
    assert.equal(/\bt\.className/.test(view), false, '不许再靠直点元素的 className 判卡片（子串判法会误中 this._root.className）');
    assert.equal(/\.target\.className/.test(view), false, '不许读直点元素的 className');
    /* 动作按钮必须**先于**卡片判：按钮在卡片里，先判卡片会把按钮吃掉。 */
    const act = view.indexOf("getAttribute('data-act')");
    const card = view.indexOf("getAttribute('data-open')");
    assert.ok(act > 0 && card > 0, '两个面都必须有');
    assert.ok(act < card, '动作面必须先判（否则卡片会把按钮吃掉）');
});

/* ══════════════════════ G — 会话键登记 ══════════════════════ */
test('G1 三条会话键在 keys-audit 登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['sourcebook_capsules', 'sourcebook_policy', 'sourcebook_ledger']) {
        const i = keys.indexOf("'" + k + "'");
        assert.ok(i > 0, k + ' 必须在册');
        const line = keys.slice(keys.lastIndexOf(NL, i) + 1, keys.indexOf(NL, i));
        assert.ok(line.includes("scope: 'chat'"), k + ' 必须归 chat 域（否则切角色会串味）：' + line);
        assert.ok(line.includes('[v3.39.0]'), k + ' 的 note 必须带本版标（便于回溯）');
    }
    /* 宽前缀必须在 storage 里，且三个键都落在它里面（前缀写错 = 隔离失效）。 */
    assert.ok(/\/\^sourcebook_\//.test(read(STORAGE)));
    for (const k of ['sourcebook_capsules', 'sourcebook_policy', 'sourcebook_ledger']) {
        assert.ok(k.startsWith('sourcebook_'), k + ' 必须以本件前缀开头');
    }
});

test('G2 三条键真被产品消费（写面必须落到这三条上）', () => {
    const app = stripComments(read(SB_APP));
    for (const k of ['CAPSULES_KEY', 'POLICY_KEY', 'LEDGER_KEY']) {
        assert.ok(app.includes('const ' + k + " = '"), k + ' 必须有一个常量定义');
        assert.ok(app.split(k + ')').length - 1 >= 1, k + ' 必须被真用（不只是定义）');
    }
    /* 真跑一遍：三条键都真落盘。 */
    const st = memStorage();
    const a = newApp(st);
    a.seal(good());
    a.setLedgerKeep(9);
    a.acceptEcho(0, JSON.stringify({ roleMessage: 'r' }));
    for (const k of ['sourcebook_capsules', 'sourcebook_policy', 'sourcebook_ledger']) {
        assert.equal(st._box.has(k), true, k + ' 必须真被写入');
    }
});

/* ══════════════════════ H — 生命周期面 ══════════════════════ */
test('H1 换会话必须全量重取 + 清视图态（源把胶囊挂在宿主键下，切角色原样留着）', () => {
    const code = stripComments(read(SB_APP));
    const i = code.indexOf('    onChatChanged() {');
    assert.ok(i > 0, '必须有 onChatChanged');
    const rest = code.slice(i + 20);
    const endRel = rest.indexOf(NL + '    }' + NL);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    /* 三条键都必须重取（少一条就会留旧会话的账）。 */
    for (const call of ['this._loadCapsules()', 'this._loadPolicy()', 'this._loadLedger()', 'this.probe()']) {
        assert.ok(body.includes(call), 'onChatChanged 必须调 ' + call);
    }
    /* 三个视图态必须清（否则详情/草案/页签会串到新会话）。 */
    for (const reset of ["this._current = ''", "this._draft = ''", "this._tab = 'shelf'"]) {
        assert.ok(body.includes(reset), 'onChatChanged 必须重置 ' + reset);
    }
    /* 行为实测：草案与详情态必须真清掉。 */
    const st = sessionStorage();
    const app = newApp(st);
    app.seal(good());
    app.openCapsule(0);
    app.buildRequest(0);
    assert.equal(app.draftOf() !== '', true);
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.draftOf(), '');
    assert.equal(app.currentKey(), '');
});

test('H2 取数分两种回报：认源不许走吞异常的读法（坏 storage 不许读成空）', () => {
    const code = stripComments(read(SB_APP));
    const i = code.indexOf('    probe() {');
    assert.ok(i > 0, '必须有 probe');
    const body = code.slice(i, i + 2200);
    for (const k of ['CAPSULES_KEY', 'POLICY_KEY', 'LEDGER_KEY']) {
        assert.ok(body.includes('this._readRaw(' + k + ')'), '取数必须走 _readRaw（分两种回报）：' + k);
    }
    assert.ok(new RegExp('storageOk\\s*=').test(body), '必须真算 storageOk');
    /* 面的优先级：取不出来 > 有信 > 台账三态。 */
    assert.ok(body.includes('this.capsules.length > 0 ? FACE.ok'), '有信必须优先报 ok');
    /* 行为实测：有信时不许被空台账拉成 empty。 */
    const app = newApp(memStorage({ sourcebook_capsules: JSON.stringify({ capsules: [good()] }) }));
    assert.equal(app.faceOf(), DAT.SOURCEBOOK_FACES.ok, '有信 + 空台账 = ok（不是 empty）');
    assert.equal(app.receiptRows().length, 0);
    /* 且 take 出来的投影必须非空。 */
    assert.ok(app.probe());
});

/* ====================== I - 负控制（破坏必须可观测） ====================== */
/** 数据层判据（加载**真破坏副本**后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 封存时间三态互不同形。 */
    const sp = (x) => mod.spanOf({ message: 'x', openDate: '2027-01-01', createdAt: x });
    if (sp('').created !== 'absent') bad.push('created-absent-lost');
    if (sp('三年前').created !== 'malformed') bad.push('created-malformed-lost');
    if (sp('').created === sp('三年前').created) bad.push('created-states-collapsed');
    /* ② 算不出天数不许与首档同形、不许编 0。 */
    if (mod.spanBucket(null).known !== false) bad.push('unknown-days-collapsed');
    if (mod.spanOf({ message: 'x' }).days !== null) bad.push('unknown-days-not-null');
    if (mod.spanOf({ message: 'x' }).known !== false) bad.push('unknown-not-known-false');
    /* ③ 坏输入不许静默成空列表。 */
    if (mod.foldCapsules('{bad').ok !== false) bad.push('bad-input-swallowed');
    if (mod.normalizeCapsules([{ openDate: 'x' }]).dropped !== 1) bad.push('dropped-not-reported');
    /* ④ 未填心情不许与默认值同形。 */
    if (mod.moodOf({ message: 'x' }).filled !== false) bad.push('mood-unfilled-collapsed');
    /* ⑤ 硬约束必须报「哪一句里的哪个词」+ 必须真拦住。 */
    const g = mod.guardEcho({ roleMessage: '我请你吃饭' });
    if (!g.hits.length || g.hits[0].field !== 'roleMessage') bad.push('guard-field-lost');
    if (g.hits.length && g.hits[0].word !== '请你吃') bad.push('guard-word-lost');
    if (mod.normalizeEcho({ roleMessage: '我请你吃饭' }, { message: 'x' }).ok !== false) bad.push('guard-not-enforced');
    /* ⑥ 空与取不出来不许同形。 */
    if (mod.ledgerFace(null) !== 'storage_absent') bad.push('ledger-face-collapsed');
    if (mod.ledgerFace({ receipts: [] }) !== 'empty') bad.push('ledger-empty-face-lost');
    /* ⑦ 算不出来的条数要单列。 */
    if (mod.sourcebookReadings([{ message: 'x' }], {}).spanUnknown !== 1) bad.push('span-unknown-not-counted');
    /* ⑧ 口吻分族优先级（塔了 = 所有回信同一种腔）。 */
    if (mod.toneOf({ message: '很开心，但也好难过' }).type !== 'mixed') bad.push('tone-priority-lost');
    if (mod.SPAN_BUCKETS.length !== 6) bad.push('span-buckets-collapsed');
    if (mod.TONE_TYPES.length !== 6) bad.push('tone-types-collapsed');
    /* ⑨ 三段落兜底必须如实报（不许报成模型真写了）。 */
    const ne = mod.normalizeEcho({ roleMessage: 'x' }, { message: 'x', openDate: '2027-01-01', createdAt: '2026-01-01' });
    if (ne.fellBack.title !== true) bad.push('fallback-not-reported');
    if (ne.provided.roleMessage !== true) bad.push('provided-lost');
    return bad;
};

/** App 行为判据（在**破坏副本**上真的 new 一个 App 跑）。 */
const appFaceProblems = (mod) => {
    const bad = [];
    const hostile = { get: () => { throw new Error('boom'); }, set: () => {} };
    const a = new mod.SourcebookApp(shellStub(), hostile);
    if (a.faceOf() !== 'storage_absent') bad.push('storage-absent-lost');
    if (a.probe() !== null) bad.push('projection-not-null-on-absent');
    if (a.readings() !== null) bad.push('readings-not-null-on-absent');
    for (const r of a.spanRows()) if (r.count !== null) bad.push('span-count-not-null-on-absent');
    for (const r of a.toneRows()) if (r.count !== null) bad.push('tone-count-not-null-on-absent');
    const ok = new mod.SourcebookApp(shellStub(), memStorage());
    if (ok.faceOf() !== 'empty') bad.push('empty-face-lost');
    for (const r of ok.spanRows()) if (r.count !== 0) bad.push('zero-count-lost');
    return bad;
};

const appPriorityProblems = (mod) => {
    const bad = [];
    const app = new mod.SourcebookApp(shellStub(), memStorage({ sourcebook_capsules: JSON.stringify({ capsules: [good()] }) }));
    if (app.faceOf() !== 'ok') bad.push('face-priority-lost');
    return bad;
};

const appGateProblems = (mod) => {
    const bad = [];
    const app = new mod.SourcebookApp(shellStub(), memStorage());
    for (const v of [0, -3, 1.5, 'abc', null]) {
        /* ★ 上限常量在数据层导出（App 模块只导出类），从 mod 取会拿到 undefined

         *   而让比较恒真 —— 判据变成「恒红」，I 组对照假绿。 */

        if (app.setLedgerKeep(v).took !== DAT.SOURCEBOOK_MAX_RECEIPTS) bad.push('keep-fallback-lost');
    }
    if (app.setLedgerKeep(9999).took !== DAT.SOURCEBOOK_MAX_RECEIPTS) bad.push('keep-cap-lost');
    /* 封存时间三态门必须在 seal 里生效。 */
    if (app.seal({ message: 'x', openDate: '2027-01-01', createdAt: '三年前' }).reason !== 'bad_created_at') bad.push('bad-created-accepted');
    if (app.seal({ message: 'x', openDate: '2027-01-01' }).reason !== 'bad_created_at') bad.push('absent-created-accepted');
    if (app.seal({ message: '', openDate: '2027-01-01', createdAt: '2026-01-01' }).reason !== 'no_message') bad.push('empty-message-accepted');
    return bad;
};

const appChatProblems = (mod) => {
    const bad = [];
    const st = sessionStorage();
    const app = new mod.SourcebookApp(shellStub(), st);
    app.seal(good());
    app.openCapsule(0);
    app.buildRequest(0);
    st.switchTo('c2');
    app.onChatChanged();
    if (app.capsuleCount() !== 0) bad.push('chat-change-no-capsules-reload');
    if (app.receiptRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    if (app.draftOf() !== '') bad.push('chat-change-no-draft-reset');
    if (app.currentKey() !== '') bad.push('chat-change-no-detail-reset');
    return bad;
};

/** 结构面判据（手写键面 —— 本仓 J7/E2 那一族，只能静态判）。 */
const appHandKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const FACE = SOURCEBOOK_FACES')) bad.push('face-constant-handwritten');
    if (new RegExp('const FACE\\s*=\\s*Object\\.freeze\\s*\\(\\s*\\{').test(code)) bad.push('face-constant-handwritten');
    return bad;
};

const viewBadgeProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('CREATED_TONE[r.createdAtState]')) bad.push('created-tone-not-by-three-state');
    return bad;
};

const viewKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('[CREATED_STATES.ok]')) bad.push('three-state-keys-handwritten');
    if (code.includes('    ok: ')) bad.push('three-state-keys-handwritten');
    return bad;
};

const viewEmptyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('存储读不出来，不是「没有信」')) bad.push('empty-and-bad-collapsed');
    if (!code.includes('读不出来，不是「没写过」')) bad.push('ledger-empty-and-bad-collapsed');
    return bad;
};

const viewCommaProblems = (src) => {
    const bad = [];
    const lines = stripComments(src).split(NL).filter((l) => /\s,\s*$/.test(l));
    if (lines.length) bad.push('trailing-comma-expression');
    return bad;
};

const viewCardProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('climb(t, (n) => n.getAttribute(' + "'" + 'data-open' + "'" + ') !== null)')) bad.push('card-climb-lost');
    if (/\bt\.className/.test(code)) bad.push('card-climb-lost');

    if (/\.target\.className/.test(code)) bad.push('card-climb-lost');
    return bad;
};

const appChatSrcProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    const i = code.indexOf('    onChatChanged() {');
    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }
    const rest = code.slice(i + 20);
    const endRel = rest.indexOf(NL + '    }' + NL);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!body.includes('this._loadPolicy()')) bad.push('chat-change-no-policy-reload');
    if (!body.includes('this._loadCapsules()')) bad.push('chat-change-no-capsules-reload');
    if (!body.includes('this.probe()')) bad.push('chat-change-no-refetch');
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 封存时间三态塌成两态：「写了但坏的」合流进「没写」（源就是这个形态）。 */
    d1: [SB_DATA,
        "    else createdState = " + Q + "malformed" + Q + ";",
        "    else createdState = " + Q + "absent" + Q + ";"],
    /* ② 算不出天数合流进首档（源默认档喰掉两种）。 */
    d2: [SB_DATA,
        "    if (d === null) return { bucket: " + Q + "same_day" + Q + ", known: false, sawDays: String(days) };",
        "    if (d === null) return { bucket: " + Q + "same_day" + Q + ", known: true, days: 0, sawDays: String(days) };"],
    /* ③ 坏 JSON 静默成空列表（源 try/catch 后 return []）。 */
    d3: [SB_DATA,
        "            catch (_e) { return { ok: false, reason: " + Q + "bad_json" + Q + ", list: [], folded: folded }; }",
        "            catch (_e) { return { ok: true, list: [], shape: " + Q + "empty_string" + Q + ", folded: folded }; }"],
    /* ④ 未填心情合流进「填了默认值」。 */
    d4: [SB_DATA,
        "    if (!raw) return { key: MOOD_FALLBACK, filled: false, saw: " + Q + Q + " };",
        "    if (!raw) return { key: MOOD_FALLBACK, filled: true, saw: " + Q + Q + " };"],
    /* ⑤ 硬约束只报「有问题」不报哪个词（源抛异常无位置）。 */
    d5: [SB_DATA,
        "                hits.push({ reason: " + Q + "offline_or_gift" + Q + ", field: f, word: OFFLINE_WORDS[w] });",
        "                hits.push({ reason: " + Q + "offline_or_gift" + Q + ", field: f, word: " + Q + Q + " });"],
    /* ⑥ 硬约束不再拦回信（源抛异常而调用方常吞掉）。 */
    d6: [SB_DATA,
        "    if (!guard.ok) return { ok: false, reason: " + Q + "guard" + Q + ", guard: guard, segments: {} };",
        "    if (false) return { ok: false, reason: " + Q + "guard" + Q + ", guard: guard, segments: {} };"],
    /* ⑦ 空台账与「取不出来」合流。 */
    d7: [SB_DATA,
        "    if (receipts.length === 0) return SOURCEBOOK_FACES.empty;",
        "    if (false) return SOURCEBOOK_FACES.empty;"],
    /* ⑧ 算不出跨度的条数不再单列。 */
    d8: [SB_DATA,
        "        else spanUnknown += 1;",
        "        else spanUnknown += 0;"],
    /* ⑨ 口吻分族优先级塔平（所有回信都是同一种腔）。 */
    d9: [SB_DATA,
        "    if (hasPositive && hasDifficult) type = " + Q + "mixed" + Q + ";",
        "    if (false) type = " + Q + "mixed" + Q + ";"],
    /* ⑩ 六档塔成五档。 */
    d10: [SB_DATA,
        "    " + Q + "same_day" + Q + ", " + Q + "few_days" + Q + ", " + Q + "few_weeks" + Q + ", " + Q + "few_months" + Q + ", " + Q + "months" + Q + ", " + Q + "years" + Q,
        "    " + Q + "same_day" + Q + ", " + Q + "few_days" + Q + ", " + Q + "few_weeks" + Q + ", " + Q + "few_months" + Q + ", " + Q + "years" + Q],
    /* ⑪ 六族塔成五族。 */
    d11: [SB_DATA,
        "    " + Q + "mixed" + Q + ", " + Q + "happy" + Q + ", " + Q + "difficult" + Q + ", " + Q + "anticipation" + Q + ", " + Q + "tender" + Q + ", " + Q + "daily" + Q,
        "    " + Q + "mixed" + Q + ", " + Q + "happy" + Q + ", " + Q + "difficult" + Q + ", " + Q + "anticipation" + Q + ", " + Q + "tender" + Q],
    /* ⑫ App：取不出来不当一回事（坏 storage 被读成「一条信都没有」）。 */
    a1: [SB_APP,
        '        const storageOk = !!(rc.ok && rp.ok && rl.ok);',
        '        const storageOk = true;'],
    /* ⑬ App：读数三态门塔平（取不出来也画零点）。 */
    a2: [SB_APP,
        '        this._readingsOk = storageOk;',
        '        this._readingsOk = true;'],
    /* ⑭ App：两态常量退回手写一份（本仓 J7 形态）。 */
    a3: [SB_APP,
        'const FACE = SOURCEBOOK_FACES;',
        "const FACE = { ok: " + Q + "ok" + Q + ", empty: " + Q + "empty" + Q + ", storage_absent: " + Q + "storage_absent" + Q + " };"],
    /* ⑮ App：面的优先级塔平（有信被空台账拉成 empty）。 */
    a4: [SB_APP,
        '            ? (this.capsules.length > 0 ? FACE.ok : ledgerFace(ledger))',
        '            ? ledgerFace(ledger)'],
    /* ⑯ App：策略取值门塔平（0 / 坏值也照收，台账一存就空）。 */
    a5: [SB_APP,
        '    if (n === null || !Number.isInteger(n) || n < 1) return SOURCEBOOK_MAX_RECEIPTS;',
        '    if (false) return SOURCEBOOK_MAX_RECEIPTS;'],
    /* ⑰ App：封存时间三态门塔平（取不出来也收，源就是这么干的）。 */
    a6: [SB_APP,
        '        if (cst !== CREATED_STATES.ok) {',
        '        if (false) {'],
    /* ⑱ App：换会话不再清草案（旧会话的草稿串到新会话）。 */
    a7: [SB_APP,
        "    onChatChanged() {" + NL + "        this._current = " + Q + Q + ";" + NL + "        this._draft = " + Q + Q + ";" + NL + "        this._tab = " + Q + "shelf" + Q + ";",
        "    onChatChanged() {" + NL + "        this._current = " + Q + Q + ";" + NL + "        this._tab = " + Q + "shelf" + Q + ";"],
    /* ⑲ App：换会话少重取一条（结构面：probe 内部会重读，故只能静态判）。 */
    a8: [SB_APP,
        "        this._loadCapsules();" + NL + "        this._loadPolicy();" + NL + "        this._loadLedger();" + NL + "        this.probe();" + NL + "        if (this._view) this._view.refresh();" + NL + "    }" + NL + "    render() {",
        "        this._loadCapsules();" + NL + "        this._loadLedger();" + NL + "        this.probe();" + NL + "        if (this._view) this._view.refresh();" + NL + "    }" + NL + "    render() {"],
    /* ⑳ 视图：封存时间三色塔平（三态又只有一种色相）。 */
    v1: [SB_VIEW,
        '            const ct = CREATED_TONE[r.createdAtState] || "warn";',
        '            const ct = "warn";'],
    /* ㉑ 视图：三态人话表退回手写标识符形键。 */
    v2: [SB_VIEW,
        '    [CREATED_STATES.ok]: ' + Q + '已填' + Q + ',',
        '    ok: ' + Q + '已填' + Q + ','],
    /* ㉒ 视图：空与坏塔成一话。 */
    v3: [SB_VIEW,
        "                + (app.faceOf() === SOURCEBOOK_FACES.storage_absent ? " + Q + "存储读不出来，不是「没有信」" + Q + " : " + Q + "还没有存过信" + Q + ")",
        "                + " + Q + "还没有存过信" + Q],
    /* ㉓ 视图：行尾多一个逗号（拼串变成逗号表达式，界面上少画一段）。 */
    v4: [SB_VIEW,
    /* ★ 破坏语义：三目那一行行尾插一个裸逗号 —— 拼串变成逗号表达式，
     *   「+ 下一行」被当成一元加号丢给 push（界面上少画一段，语法合法）。
     *   锚点必须是**两行连体**，否则 to 里残留 from（J2 的「替换后不许残留」自证红）。 */
        "                + (app.faceOf() === SOURCEBOOK_FACES.storage_absent ? " + Q + "读不出来，不是「没写过」" + Q + " : " + Q + "还没有任何回执" + Q + ")" + NL + "                + " + Q + "</div>" + Q + ");",
        "                + (app.faceOf() === SOURCEBOOK_FACES.storage_absent ? " + Q + "读不出来，不是「没写过」" + Q + " : " + Q + "还没有任何回执" + Q + ") ," + NL + "                + " + Q + "</div>" + Q + ");"],
    /* ㉔ 视图：卡片判定退回直点元素（点卡片里的正文文字没反应）。 */
    v5: [SB_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute(" + Q + "data-open" + Q + ") !== null);",
        "            const cardEl = (t.getAttribute(" + Q + "data-open" + Q + ") !== null) ? t : null;"],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3390_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const sbDir = path.join(dir, 'apps', 'sourcebook');
    fs.mkdirSync(sbDir, { recursive: true });
    for (const f of ['sourcebook-data.js', 'sourcebook-view.js', 'sourcebook-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'sourcebook', f), path.join(sbDir, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「封存时间三态分开」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['created-malformed-lost', 'created-states-collapsed']],
    ['I2 破坏「算不出天数不许与首档同形」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['unknown-days-collapsed', 'unknown-days-not-null', 'unknown-not-known-false']],
    ['I3 破坏「坏输入不许静默成空列表」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['bad-input-swallowed']],
    ['I4 破坏「未填心情与默认值不同形」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['mood-unfilled-collapsed']],
    ['I5 破坏「硬约束要报出哪个词」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['guard-word-lost']],
    ['I6 破坏「硬约束真拦回信」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['guard-not-enforced']],
    ['I7 破坏「空与取不出来不同形」⇒ 内核判据必须转红', 'd7', 'data', dataProblems, ['ledger-face-collapsed', 'ledger-empty-face-lost']],
    ['I8 破坏「算不出来的条数单列」⇒ 内核判据必须转红', 'd8', 'data', dataProblems, ['span-unknown-not-counted']],
    ['I9 破坏「口吻分族优先级」⇒ 内核判据必须转红', 'd9', 'data', dataProblems, ['tone-priority-lost']],
    ['I10 破坏「六档不得塔成少于六档」⇒ 内核判据必须转红', 'd10', 'data', dataProblems, ['span-buckets-collapsed']],
    ['I11 破坏「六族不得塔成少于六族」⇒ 内核判据必须转红', 'd11', 'data', dataProblems, ['tone-types-collapsed']],
    ['I12 破坏「取不出来不许当成一条信都没有」（App）⇒ 行为判据必须转红', 'a1', 'appmod', appFaceProblems,
        ['storage-absent-lost', 'projection-not-null-on-absent', 'readings-not-null-on-absent', 'span-count-not-null-on-absent']],
    ['I13 破坏「读数三态门」（App）⇒ 行为判据必须转红', 'a2', 'appmod', appFaceProblems,
        ['readings-not-null-on-absent', 'span-count-not-null-on-absent', 'tone-count-not-null-on-absent']],
    ['I14 破坏「两态常量取真源」（App）⇒ 结构面判据必须转红', 'a3', 'src', appHandKeyProblems, ['face-constant-handwritten']],
    ['I15 破坏「面的优先级」（App）⇒ 行为判据必须转红', 'a4', 'appmod', appPriorityProblems, ['face-priority-lost']],
    ['I16 破坏「策略取值门」（App）⇒ 行为判据必须转红', 'a5', 'appmod', appGateProblems, ['keep-fallback-lost', 'keep-cap-lost']],
    ['I17 破坏「封存时间三态门」（App）⇒ 行为判据必须转红', 'a6', 'appmod', appGateProblems, ['bad-created-accepted', 'absent-created-accepted']],
    ['I18 破坏「换会话清草案」（App）⇒ 行为判据必须转红', 'a7', 'appmod', appChatProblems, ['chat-change-no-draft-reset']],
    ['I19 破坏「换会话三条都重取」（App）⇒ 结构面判据必须转红', 'a8', 'src', appChatSrcProblems, ['chat-change-no-policy-reload']],
    ['I20 破坏「封存时间三色徽章」（视图）⇒ 视图判据必须转红', 'v1', 'src', viewBadgeProblems, ['created-tone-not-by-three-state']],
    ['I21 破坏「三态人话表取真源计算键」（视图）⇒ 视图判据必须转红', 'v2', 'src', viewKeyProblems, ['three-state-keys-handwritten']],
    ['I22 破坏「空与坏不同形（视图）」⇒ 视图判据必须转红', 'v3', 'src', viewEmptyProblems, ['empty-and-bad-collapsed']],
    ['I23 破坏「拼串不留尾逗号」（视图）⇒ 视图判据必须转红', 'v4', 'src', viewCommaProblems, ['trailing-comma-expression']],
    ['I24 破坏「点卡片向上找祖先」（视图）⇒ 视图判据必须转红', 'v5', 'src', viewCardProblems, ['card-climb-lost']],
];

for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judge(damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            /* 对照：真源码必须干净（否则「转红」可能只是因为判据本来就红）。 */
            assert.deepEqual(judge(src), [], '对照：真源码必须干净');
            return;
        }
        /* 行为面：把破坏副本按真目录结构落盘，再真加载 / 真跑。 */
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judge(mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        /* 对照：真模块必须干净。 */
        const real = (kind === 'data') ? DAT : APP;
        assert.deepEqual(judge(real), [], '对照：真模块必须干净');
    });
}

/* ====================== J - 判据工具自证 ====================== */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const bt = String.fromCharCode(96);
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 fetch(';").includes('fetch('), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + bt + '模板里的 fetch(' + bt + ';').includes('fetch('), true, '模板串里的必须留住');
    for (const rel of [SB_DATA, SB_APP, SB_VIEW]) {
        const sentinel = stripComments(read(rel) + NL + '/* RP_TAIL_3390 */');
        assert.equal(sentinel.includes('RP_TAIL_3390'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3390k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [SB_DATA, SB_APP, SB_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split(NL)[0]);
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
    /* 负控制已经在 I 组里“破坏→转红、真件→干净”两向都验了；
     * 这里再单向验一次真件：防止“判据恒为红”使 I 组的对照假绿。 */
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), [], 'App 面判据在真模块上必须干净');
    assert.deepEqual(appPriorityProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(appHandKeyProblems(read(SB_APP)), []);
    assert.deepEqual(appChatSrcProblems(read(SB_APP)), []);
    assert.deepEqual(viewBadgeProblems(read(SB_VIEW)), []);
    assert.deepEqual(viewKeyProblems(read(SB_VIEW)), []);
    assert.deepEqual(viewEmptyProblems(read(SB_VIEW)), []);
    assert.deepEqual(viewCommaProblems(read(SB_VIEW)), []);
    assert.deepEqual(viewCardProblems(read(SB_VIEW)), []);
});

test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 39),
        '本套件成立于 RubyPhone 3.39.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    /* 迭代日志必须真有本版段（边界文档的层）。 */
    const iter = read('ITERATION_LOG.md');
    assert.ok(iter.includes(man.version), 'ITERATION_LOG.md 必须含本版号');
});

test('L2 交棒必须指向第 3 层余件的真实现状（路线图字面不成立时以实测为准）', () => {
    const src = read(INDEX);
    /* 本件是第 3 层第三件，交棒必须改写为余下的两件。 */
    assert.ok(src.includes('第 3 层第三件'), 'index.js 公告的交接段必须指向本件');
    assert.ok(src.includes('xiaoshuji'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(src.includes('EPhone'), '交棒必须指向下一件');
    /* 运行时验证边界那句必须与文档同源（本仓边界判据靠它）。 */
    assert.ok(src.includes('运行时验证边界'), '公告条目必须带运行时验证边界段');
});
