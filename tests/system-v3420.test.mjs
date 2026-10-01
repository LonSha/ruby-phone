// tests/system-v3420.test.mjs — 曲库案头 [v3.42.0]
//
// 本套件守四件事：
//  ① 收拾内核的口径（曲目归一逐项报 / 去重与超限逐条报 / 封面零外链四态 /
//     歌词坏行分两类报 / 时长四态与毫秒折算 / 播放模式拒而不夹 / 游标五因与绕回留痕 /
//     来源四形与偏好冷却一起画 / 回执六因 / 读数不编 0）；
//  ② 四块不缝真的没缝（不发请求 / 不读账号与 cookie / 不碰 audio 元件 / 不收外链不落数据库）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 ~ v3.41 各踩过一次）：
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
import * as DAT from '../apps/musicdesk/musicdesk-data.js';
import * as APP from '../apps/musicdesk/musicdesk-app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MD_DATA = 'apps/musicdesk/musicdesk-data.js';
const MD_APP = 'apps/musicdesk/musicdesk-app.js';
const MD_VIEW = 'apps/musicdesk/musicdesk-view.js';
const MD_CSS = 'apps/musicdesk/musicdesk.css';
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
/** 双引号（造 JSON 文本用）：拼装形，源码里不出现裸双引号。 */
const DQ = String.fromCharCode(34);
/** 竖线（来源清单文本用）：拼装形。 */
const PIPE = String.fromCharCode(124);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 剥注释（字符状态机，与 v3300…v3410 同款）。
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
            if (c === Q || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
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

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^musicdesk_/` 前缀拼 chatId 实现）。
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
const newApp = (storage) => new APP.MusicdeskApp(shellStub(), storage);

/** 一条源那套形状的曲目（ar / al / dt）。 */
function rawSong(over) {
    return Object.assign({
        id: 's1', name: '夏日', ar: [{ name: '张三' }], al: { name: '专辑一', picUrl: 'cover://x' }, dt: 215000
    }, over || {});
}
/** 一条回信文本（用 JSON.stringify 拼，源码里不出现裸引号）。 */
function replyText(over) {
    const base = {
        songs: [rawSong()],
        lrc: '[00:01.00]第一行' + NL + '这一行没有时间标签' + NL + '[00:02.00]'
    };
    return JSON.stringify(Object.assign(base, over || {}));
}

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 曲目归一逐项报「替用户编了什么」（源三处静默兜底）', () => {
    /* id 缺失 ⇒ 判成认不出来，不是「一首正常的歌」。 */
    const noId = DAT.normalizeSong({ name: 'x' });
    assert.equal(noId.ok, false);
    assert.equal(noId.why, 'no_id');
    assert.ok(noId.filled.indexOf('id') >= 0);
    /* 名字 / 艺人缺失 ⇒ 各记一笔 filled，且用真源缺省字面。 */
    const bare = DAT.normalizeSong({ id: 'a' });
    assert.equal(bare.ok, true);
    assert.equal(bare.why, 'filled_missing');
    assert.ok(bare.filled.indexOf('name') >= 0);
    assert.ok(bare.filled.indexOf('artist') >= 0);
    assert.equal(bare.song.name, DAT.MUS_UNKNOWN_TITLE);
    assert.equal(bare.song.artist, DAT.MUS_UNKNOWN_ARTIST);
    /* 全齐 ⇒ why 是 ok 且 filled 空。 */
    const full = DAT.normalizeSong(rawSong());
    assert.equal(full.why, 'ok');
    assert.deepEqual(full.filled, []);
    assert.equal(full.song.artist, '张三');
    assert.equal(full.song.album, '专辑一');
    assert.equal(full.song.seconds, 215);
    /* 非对象一律拒。 */
    for (const v of [null, undefined, 3, 'x', []]) assert.equal(DAT.normalizeSong(v).ok, false);
});

test('A2 归一后的形状必须能**回读**（只认源那套键会让重开 App 丢字段）', () => {
    /* ★ 本版真踩到的一族：归一函数只认 ar / al / dt，而落盘后回读给的是
     *   本件自己的形状（artist 字串 / album 字串 / seconds）—— 收拾一次之后
     *   重开 App，艺人全变回「未知艺人」、专辑与时长整批丢掉，而且一个字都不报。 */
    const once = DAT.normalizeSong(rawSong());
    const twice = DAT.normalizeSong(once.song);
    assert.equal(twice.ok, true);
    assert.equal(twice.song.artist, '张三', '回读后艺人必须还在');
    assert.equal(twice.song.album, '专辑一', '回读后专辑必须还在');
    assert.equal(twice.song.seconds, 215, '回读后时长必须还在');
    assert.equal(twice.song.coverRaw, 'cover://x', '回读后封面引用必须还在');
    assert.deepEqual(twice.filled, [], '回读不该再报「替用户编了什么」');
    /* 艺人字串（不是数组）也要认。 */
    const s = DAT.normalizeSong({ id: 'z', name: 'n', artist: '李四', album: 'A', seconds: 30 });
    assert.equal(s.song.artist, '李四');
    assert.equal(s.song.album, 'A');
    assert.equal(s.song.seconds, 30);
});

test('A3 去重与超限逐条报（源塞进 alternatives 且不报 / 到 limit 就 break）', () => {
    const list = [
        { id: '1', name: 'A', artist: 'x', album: 'z' },
        { id: '2', name: 'A', artist: 'x', album: 'z' },
        { id: '3', name: 'A', artist: 'x', album: 'q' },
        { id: '', name: 'B' },
        { id: '4', name: '   ' },
        { id: '5', name: 'C' }
    ];
    const r = DAT.dedupeSongs(list, 2);
    assert.equal(r.given, 6);
    assert.equal(r.kept, 2);
    assert.equal(r.merged.length, 1, '被合并的那一条必须报出来');
    assert.equal(r.merged[0].into, '1');
    assert.equal(r.merged[0].count, 1);
    assert.equal(r.dropped.no_id, 1);
    assert.equal(r.dropped.no_name, 1);
    assert.equal(r.capped, 1, '超上限截掉几条必须报出来');
    assert.equal(r.limit, 2);
    /* 版本不同即不合并（本件键里带专辑段 —— 源只按名字 + 艺人）。 */
    const v = DAT.dedupeSongs([
        { id: '1', name: 'A', artist: 'x', album: '原版' },
        { id: '2', name: 'A', artist: 'x', album: '现场版' }
    ], 40);
    assert.equal(v.kept, 2, '原版与现场版不许被判成同一首');
    assert.equal(v.merged.length, 0);
    /* 基键不带专辑段（判「同一个东西的不同版本」）。 */
    assert.equal(DAT.baseIdOf({ name: 'A', artist: 'x' }), DAT.baseIdOf({ name: 'A', artist: 'x', album: 'z' }));
});

test('A4 封面零外链四态互不同形（源没有就换一条外链托底图）', () => {
    const ok = DAT.coverOf({ name: '夏日', coverRaw: 'u' });
    const partial = DAT.coverOf({ name: '...', coverRaw: 'u' });
    const absent = DAT.coverOf({ name: '夏日' });
    const malformed = DAT.coverOf({ name: '夏日', coverRaw: {} });
    assert.equal(ok.state, DAT.MUS_STATES[0]);
    assert.equal(partial.state, DAT.MUS_STATES[1]);
    assert.equal(absent.state, DAT.MUS_STATES[2]);
    assert.equal(malformed.state, DAT.MUS_STATES[3]);
    assert.equal(new Set([ok.i, partial.i, absent.i, malformed.i]).size, 4, '四态下标必须互不相同');
    /* 有封面才给色相与首字；没封面不给色相（视图画虚线框）。 */
    assert.ok(ok.tone && ok.initial);
    assert.equal(absent.tone, '');
    assert.equal(absent.initial, '夏日'.charAt(0));
    assert.equal(malformed.tone, '');
    /* 同一首歌每次同一档（色相由歌曲键决定）。 */
    assert.equal(DAT.coverOf({ name: '夏日', artist: 'a', coverRaw: 'u' }).tone,
        DAT.coverOf({ name: '夏日', artist: 'a', coverRaw: 'u' }).tone);
    /* 八档互不相同。 */
    assert.equal(new Set(DAT.MUS_COVER_TONES).size, 8);
    /* ★ 零外链：本件不产任何 URL 形。 */
    assert.equal(ok.piece, ok.initial, '封面那口给的必须是首字，不是地址');
});

test('A5 歌词坏行分两类报（源不中即 continue，丢了几行不报）', () => {
    const text = '[ti:标题]' + NL + '[00:01.00]第一行' + NL + '这一行没有时间标签'
        + NL + '[00:02.00]' + NL + '[00:03.00][00:04.00]两个标签' + NL + '';
    const r = DAT.parseLrc(text, 0);
    assert.equal(r.kept, 3, '两个标签那一行要按标签个数展开成两行');
    assert.equal(r.dropped.noTime, 2, '没有时间标签的按行计');
    assert.equal(r.dropped.noText, 1, '标签后没字的按标签个数计');
    assert.equal(r.tags, 4);
    assert.equal(r.why, 'ok');
    /* 空 / 坏输入分形。 */
    assert.equal(DAT.parseLrc('', 0).why, 'no_text');
    assert.equal(DAT.parseLrc(null, 0).why, 'no_text');
    /* 超上限要报 capped。 */
    const cap = DAT.parseLrc('[00:01.00]a' + NL + '[00:02.00]b' + NL + '[00:03.00]c', 2);
    assert.equal(cap.kept, 2);
    assert.equal(cap.capped, 1);
    /* 刻意放宽：一位分钟、三位小数都认。 */
    assert.equal(DAT.parseLrc('[1:02]x', 0).kept, 1, '一位分钟也要认（源要求恰好两位）');
    assert.equal(DAT.parseLrc('[00:01.1234]x', 0).lines[0].at, 1.1234);
});

test('A6 时长四态与毫秒折算都报出来（源把非数画成 00:00）', () => {
    /* 毫秒折算要报 normalized。 */
    const ms = DAT.durationOf(215000);
    assert.equal(ms.ok, true);
    assert.equal(ms.seconds, 215);
    assert.equal(ms.why, 'from_millis');
    assert.equal(ms.normalized, true);
    /* 秒就是秒。 */
    assert.equal(DAT.durationOf(215).why, 'ok');
    assert.equal(DAT.durationOf(215).normalized, false);
    /* 太小 / 太大各自一形（源会照收九十万秒那种）。 */
    assert.equal(DAT.durationOf(0).why, 'too_small');
    assert.equal(DAT.durationOf(99999999).why, 'too_large');
    assert.equal(DAT.durationOf('abc').why, 'not_number');
    /* ★ 格式化：读不出来与真的 0 秒**不是一回事**。 */
    const zero = DAT.formatTime(0);
    const absent = DAT.formatTime(null);
    const malformed = DAT.formatTime('abc');
    const negative = DAT.formatTime(-5);
    assert.equal(zero.state, DAT.MUS_STATES[0]);
    assert.equal(zero.text, '00:00', '真的 0 秒才画 00:00');
    assert.equal(absent.state, DAT.MUS_STATES[2]);
    assert.equal(absent.text, '', '读不出来不许画 00:00');
    assert.equal(malformed.state, DAT.MUS_STATES[3]);
    assert.equal(negative.why, 'negative');
    assert.equal(new Set([zero.i, absent.i, malformed.i, negative.i]).size >= 3, true);
    /* 分秒切分。 */
    assert.equal(DAT.formatTime(215).text, '03:35');
    assert.equal(DAT.formatTime(3661).text, '61:01', '超过一小时按分钟累计（源同款）');
});

test('A7 播放模式坏值拒而不夹（源 includes 判不过就静默不动）', () => {
    const absent = DAT.modeOf(null);
    const nt = DAT.modeOf(3);
    const unk = DAT.modeOf('nope');
    const ok = DAT.modeOf('random');
    assert.equal(absent.why, 'absent');
    assert.equal(nt.why, 'not_text');
    assert.equal(unk.why, 'unknown_mode');
    assert.equal(ok.mode, 'random');
    assert.equal(absent.mode, '', '认不出来时不许回落成某一档');
    assert.equal(unk.saw, 'nope', '必须把「认不出的那串字」带回来');
    assert.equal(nt.saw, 3);
    /* 三种模式互不相同且都在真源表里。 */
    assert.equal(DAT.MUS_PLAYBACK_MODES.length, 3);
    assert.equal(new Set(DAT.MUS_PLAYBACK_MODES).size, 3);
});

test('A8 队列游标五因与绕回留痕（源拿游标直接当数组下标用）', () => {
    assert.equal(DAT.seekTo(null, 0).why, 'no_list');
    assert.equal(DAT.seekTo([], 0).why, 'empty_queue');
    assert.equal(DAT.seekTo(['a'], 'x').why, 'not_number');
    assert.equal(DAT.seekTo(['a'], 1.5).why, 'not_integer');
    const oor = DAT.seekTo(['a'], 5);
    assert.equal(oor.why, 'out_of_range');
    assert.equal(oor.given, 5, '越界要把「给的是几」带回来');
    assert.equal(oor.size, 1);
    assert.equal(DAT.seekTo(['a', 'b'], 1).ok, true);
    /* 跳曲：绕回要留痕。 */
    assert.equal(DAT.nextIndex('sequential', 2, 3).why, 'wrapped');
    assert.equal(DAT.nextIndex('sequential', 2, 3).wrapped, true);
    assert.equal(DAT.nextIndex('sequential', 0, 3).why, 'ok');
    assert.equal(DAT.nextIndex('single', 1, 3).why, 'single');
    assert.equal(DAT.nextIndex('random', 0, 1, 0.5).why, 'only_one');
    assert.equal(DAT.nextIndex('random', 0, 3, 0.9).why, 'picked');
    /* ★ 随机不许挑到当前这首，也不许出界。 */
    for (const p of [0, 0.25, 0.5, 0.75, 0.999]) {
        const r = DAT.nextIndex('random', 1, 3, p);
        assert.equal(r.ok, true);
        assert.notEqual(r.index, 1, '随机不许挑到当前这首');
        assert.ok(r.index >= 0 && r.index < 3);
    }
    assert.equal(DAT.nextIndex('random', 0, 3, 0).index, 1);
    assert.equal(DAT.nextIndex('random', 0, 3, undefined).ok, true, '宿主没给数也要能走（回落 0）');
    assert.equal(DAT.nextIndex('nope', 0, 3).why, 'unknown_mode');
    assert.equal(DAT.nextIndex('sequential', 0, 0).why, 'no_total');
    assert.equal(DAT.nextIndex('sequential', 9, 3).why, 'bad_index');
});

test('A9 来源四形与偏好冷却一起画（源冷静期过了不标注、读不出来当作没问题）', () => {
    const absent = DAT.healthOf({}, 0);
    assert.equal(absent.state, DAT.MUS_STATES[2], '成败都没给过是 absent，不是「都好」');
    const cooling = DAT.healthOf({ fails: 3, coolingUntil: 1000 }, 500);
    assert.equal(cooling.state, DAT.MUS_STATES[1]);
    assert.equal(cooling.why, 'cooling');
    assert.equal(cooling.left, 500, '冷却剩余毫秒要带回来');
    const cold = DAT.healthOf({ fails: 3, coolingUntil: 1000 }, 2000);
    assert.equal(cold.why, 'cold', '冷却窗口过了要单列一形');
    assert.equal(DAT.healthOf({ fails: 1 }, 0).why, 'ok');
    /* 失败够数但没有冷却窗口 ⇒ 仍是 ok（不许凭空说它在冷却）。 */
    assert.equal(DAT.healthOf({ fails: 9 }, 0).state, DAT.MUS_STATES[0]);
    /* 排序：偏好在先，但状态一起画出来。 */
    const rows = DAT.sortSources([
        { key: 'p', preferred: true, fails: 3, coolingUntil: 9000 },
        { key: 'q' },
        { key: 'r', fails: 1 }
    ], 1000);
    assert.equal(rows[0].key, 'p', '偏好那条仍然在先（那是用户的意思）');
    assert.equal(rows[0].pending, true);
    assert.equal(rows[0].state, DAT.MUS_STATES[1], '但它正在冷却这件事要画出来');
    assert.deepEqual(rows.map((x) => x.key), ['p', 'q', 'r']);
    /* 三形。 */
    assert.equal(DAT.pickSource([], 0).why, 'absent');
    assert.equal(DAT.pickSource([{ key: 'a', fails: 3, coolingUntil: 9000 }], 1000).why, 'cooling_only');
    assert.equal(DAT.pickSource([{ key: 'a' }], 0).why, 'ok');
    /* 校验序三形。 */
    assert.equal(DAT.verifyOrder('a', []).why, 'absent');
    assert.equal(DAT.verifyOrder('a', ['a', 'b']).why, 'ok');
    assert.equal(DAT.verifyOrder('b', ['a', 'b']).why, 'append');
    assert.equal(DAT.verifyOrder('z', ['a', 'b']).why, 'absent');
});

test('A10 把握分带「为什么」（源只返回一个数）', () => {
    assert.equal(DAT.matchScore({ name: 'x', artist: 'y' }, { name: 'x', artist: 'y' }).score, 100);
    assert.equal(DAT.matchScore({ name: 'x', artist: 'y' }, { name: 'x', artist: 'y' }).why, 'same_name');
    const inName = DAT.matchScore({ name: 'xy', artist: 'y' }, { name: 'x', artist: 'y' });
    assert.equal(inName.score, 75);
    assert.equal(inName.why, 'name_in');
    const none = DAT.matchScore({ name: 'x' }, { name: 'q' });
    assert.equal(none.score, 0);
    assert.equal(none.pass, false);
    assert.equal(none.why, 'none');
    assert.equal(DAT.MUS_MATCH_MIN, 45, '阈值必须与源 filter 的那条线一致');
    /* 名字完全没对上时，艺人再像也不该过线。 */
    assert.equal(DAT.matchScore({ name: 'a', artist: 'z' }, { name: 'b', artist: 'z' }).score, 30);
    assert.equal(DAT.matchScore({ name: 'a', artist: 'z' }, { name: 'b', artist: 'z' }).pass, false);
});

test('A11 回执六因（键不是话）且裸数组也要认', () => {
    assert.equal(DAT.extractObject('').why, 'no_text');
    assert.equal(DAT.extractObject('hi').why, 'no_object');
    assert.equal(DAT.extractObject('{oops').why, 'unbalanced');
    assert.equal(DAT.extractObject('{oops').depth, 1, '配平深度要带回来（看得出是被截断了）');
    assert.equal(DAT.extractObject('{a:1}').text, '{a:1}');
    /* ★ 裸数组：本版真踩到 —— 只认花括号会让整张曲目表一条都收不进来。 */
    const arr = DAT.extractObject('[' + DQ + 'a' + DQ + ']');
    assert.equal(arr.ok, true, '裸数组必须认得出来');
    assert.equal(arr.text, '[' + DQ + 'a' + DQ + ']');
    /* 六因必须是键（不是中文话），否则程序没法比对。 */
    const keys = Object.keys(DAT.MUS_REPLY_WHYS);
    assert.equal(keys.length, 6);
    for (const k of keys) assert.ok(/^[a-z_]+$/.test(k), '因必须是键形：' + k);
    assert.equal(DAT.parseReply('hi', 0).why, 'no_object');
    assert.equal(DAT.parseReply('{oops}', 0).why, 'bad_json');
    assert.equal(DAT.parseReply('[]', 0).why, 'empty');
    assert.equal(DAT.parseReply('1', 0).why, 'no_object');
    assert.equal(DAT.parseReply('{' + DQ + 'songs' + DQ + ':[]}', 0).why, 'empty');
    /* 成功路径。 */
    const ok = DAT.parseReply(replyText(), 0);
    assert.equal(ok.ok, true);
    assert.equal(ok.count, 1);
    assert.equal(ok.list[0].name, '夏日');
    assert.equal(ok.lrc !== undefined, true, '歌词要一并带回来');
});

test('A12 读数面一律不编 0（空与读不到不是一回事）', () => {
    const none = DAT.readingsOf({});
    assert.equal(none.songs, null, '曲库没读到 ⇒ null，不是 0');
    assert.equal(none.covers, null, '封面计数整格 null，不是四个零');
    const empty = DAT.readingsOf({ songs: [] });
    assert.equal(empty.songs, 0);
    assert.deepEqual(empty.covers, { ok: 0, partial: 0, absent: 0, malformed: 0 });
    const one = DAT.readingsOf({ songs: [{ name: 'a', coverRaw: 'u' }] });
    assert.equal(one.songs, 1);
    assert.equal(one.covers.ok, 1);
    assert.equal(one.lrc, null, '歌词没给 ⇒ null');
    assert.equal(one.sources, null);
    assert.equal(one.queue, null);
    /* 面四态互不同形。 */
    const F = DAT.MUS_FACES;
    /* ★ 四态人话**不许塔平**：这四条话按真源键取，键写错会查不到、静默走兜底，
     *   于是四种处境显示成同一句话（本仓 J7 形态的文案面）。 */
    assert.equal(new Set(F.map((f) => DAT.MUS_FACE_TEXT[f])).size, 4, '四态人话必须互不相同');
    assert.equal(DAT.faceOf({ storage: false }).text, DAT.MUS_FACE_TEXT[F[3]]);
    assert.equal(DAT.faceOf({ songs: [1] }).text, DAT.MUS_FACE_TEXT[F[0]]);
    assert.equal(DAT.faceOf({ storage: false }).face, F[3]);
    assert.equal(DAT.faceOf({ songs: null }).face, F[2]);
    assert.equal(DAT.faceOf({ songs: 'x' }).face, F[2]);
    assert.equal(DAT.faceOf({ songs: [] }).face, F[1]);
    assert.equal(DAT.faceOf({ songs: [1] }).face, F[0]);
    assert.equal(new Set(F).size, 4);
    /* 四态词表十条齐。 */
    assert.equal(DAT.MUS_STATES.length, 4);
    assert.equal(DAT.MUS_STATES.length, Object.keys(DAT.MUS_STATE_TEXT).length);
});

test('A13 真源表在场且取值互不相同（塔平就是同形）', () => {
    assert.equal(DAT.MUS_COVER_TONES.length, 8);
    assert.equal(new Set(DAT.MUS_COVER_TONES).size, 8);
    assert.equal(DAT.MUS_PLAYBACK_MODES.length, 3);
    assert.equal(Object.keys(DAT.MUS_PLAYBACK_MODE_META).length, 3);
    assert.equal(DAT.MUS_MODES.length, 3);
    assert.equal(Object.keys(DAT.MUS_MODE_META).length, 3);
    assert.equal(DAT.MUS_STATES.length, 4);
    assert.equal(DAT.MUS_FACES.length, 4);
    assert.ok(DAT.MUS_QUEUE_LIMIT > 0);
    assert.ok(DAT.MUS_MAX_UNITS >= DAT.MUS_QUEUE_LIMIT);
    assert.equal(DAT.MUS_COOLING_FAILS, 3);
    assert.equal(DAT.MUS_COOLING_MS, 120000);
    assert.equal(DAT.MUS_MATCH_MIN, 45);
    /* 日期口径只此一处，且不许用 padStart（本仓踩过运行环境小版本差异）。 */
    assert.equal(DAT.todayKeyOf(Date.UTC(2026, 9, 6)), DAT.todayKeyOf(Date.UTC(2026, 9, 6)));
    assert.ok(DAT.todayKeyOf(0).indexOf('-') > 0);
});

/* ══════════════════════ B — App 行为面 ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一条都没收进来」', () => {
    for (const st of [null, undefined, {}, { get: () => null }, { set: () => {} }, hostileStorage()]) {
        const a = newApp(st);
        assert.equal(a.faceOf(), DAT.MUS_FACES[3]);
        assert.equal(a.probe(), null);
        assert.equal(a.readings(), null);
        assert.equal(a.coverRows(), null);
        assert.equal(a.lyricRows().kept, null, '歌词读数取不出来时是 null，不是 0');
        assert.equal(a.summaryLine(), '读数拿不到（存储不可用）');
        /* 动作口在存储不可用时也不许崩。 */
        assert.equal(a.ingestReply('x').ok, false);
        /* ★ 动作口分两种回报：「认不认得出这个动作」与「做的东西存没存下来」。
         *   存储不可用时，模式**认得出**（ok 仍是 true），但含落盘的动作
         *   必须报 saved === false —— 界面据此说「这次记不下，重开就没了」。 */
        const mm = a.setMode('random');
        assert.equal(mm.ok, true, '认得出这个模式');
        assert.equal(mm.saved, false, '存储不可用时落盘必须报 false');
        const lk = a.setLedgerKeep(3);
        assert.equal(lk.took, DAT.MUS_MAX_UNITS);
        assert.equal(lk.saved, false);
        assert.equal(a.setSources([{ key: 'x' }]).saved, false);
        assert.equal(a.clearSongs().saved, false);
        assert.equal(a.clearLedger().saved, false);
    }
    /* 「能读不能写」也算不可用（本件的核心动作就是落盘）。 */
    const ro = newApp({ get: () => null });
    assert.equal(ro.faceOf(), DAT.MUS_FACES[3]);
});

test('B2 「写了但认不出来」单列：坏内容不许与「还没收进来」同形', () => {
    const a = newApp(memStorage());
    assert.equal(a.faceOf(), DAT.MUS_FACES[1]);
    const b = newApp(memStorage({ musicdesk_lib: '{bad' }));
    assert.equal(b.faceOf(), DAT.MUS_FACES[2], '写了但认不出来要单列一态');
    assert.equal(b.probe().malformed, true);
    /* 再来一次不许把痕迹洗掉（第二次取数仍要报 malformed）。 */
    b.probe();
    assert.equal(b.faceOf(), DAT.MUS_FACES[2]);
    /* 四格各自单列：歌词格坏、曲库格好 ⇒ 仍是 malformed 且在册。 */
    const c = newApp(memStorage({
        musicdesk_lib: JSON.stringify({ songs: [DAT.normalizeSong(rawSong()).song] }),
        musicdesk_lyrics: '{bad'
    }));
    assert.equal(c.probe().malformed, true);
    assert.equal(c.faceOf(), DAT.MUS_FACES[0], '有可用内容时面是 ok，但 malformed 标记要在');
});

test('B3 曲目逐行：时长四态与封面四态都逐条落到行上', () => {
    const a = newApp(memStorage());
    a.ingestReply(replyText());
    const rows = a.songRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, '夏日');
    assert.equal(rows[0].artist, '张三');
    assert.equal(rows[0].album, '专辑一');
    assert.equal(rows[0].durationOk, true, '时长读得出来这一档必须是 true');
    assert.equal(rows[0].durationText, '03:35');
    assert.equal(rows[0].durationWhy, 'ok');
    assert.equal(rows[0].coverState, DAT.MUS_STATES[0]);
    assert.equal(rows[0].coverInitial, '夏');
    assert.ok(rows[0].coverTone);
    /* 时长读不出来的那条：画横线（text 空）且 why 保留因。 */
    const b = newApp(memStorage());
    b.ingestReply(JSON.stringify({ songs: [{ id: 'x', name: '无时长' }] }));
    const r2 = b.songRows()[0];
    assert.equal(r2.durationOk, false);
    assert.equal(r2.durationText, '', '读不出来不许画 00:00');
    assert.equal(r2.durationWhy, 'not_number');
    /* ★ 回读之后仍然读得出来（本版真踩到的一族）。 */
    const c = newApp(memStorage());
    c.ingestReply(replyText());
    const reread = newApp(c.storage);
    assert.equal(reread.songRows()[0].durationText, '03:35', '重开 App 后时长必须还在');
    assert.equal(reread.songRows()[0].artist, '张三');
});

test('B4 收拾回信：成功逐项报，失败分因且**不动现有曲库**', () => {
    const a = newApp(memStorage());
    const r = a.ingestReply(replyText());
    assert.equal(r.ok, true);
    assert.equal(r.given, 1);
    assert.equal(r.kept, 1);
    assert.equal(r.bad, 0);
    assert.ok(r.lyrics, '歌词读数要一并报');
    assert.equal(r.lyrics.kept, 1);
    assert.equal(r.lyrics.noTime, 1);
    assert.equal(r.receipt.kind, 'ingest');
    /* 失败：六因 + 空白输入，且曲库不许被清。 */
    const before = a.songRows().length;
    assert.equal(a.ingestReply('').reason, 'empty_input');
    assert.equal(a.ingestReply('hi').reason, 'no_object');
    assert.equal(a.ingestReply('{oops').reason, 'unbalanced');
    assert.equal(a.ingestReply('{oops}').reason, 'bad_json');
    assert.equal(a.ingestReply('[]').reason, 'empty');
    assert.equal(a.songRows().length, before, '失败时不许动现有曲库（源会清一遍）');
    /* 失败也要落台账（用户看得到「刚才那次没成」）。 */
    assert.ok(a.receiptRows().some((x) => x.why !== 'ok'));
    /* 逐条报合并 / 截断 / 丢两因。 */
    const b = newApp(memStorage());
    const msg = b.ingestReply(JSON.stringify({
        songs: [rawSong(), rawSong(), rawSong({ id: '' }), { id: '9', name: '   ' }]
    }));
    assert.equal(msg.given, 4);
    assert.equal(msg.merged.length, 1);
    assert.equal(msg.droppedNoId, 1);
    assert.equal(msg.droppedNoName, 1);
});

test('B5 播放模式：认不出来保持原样并报 saw 与 why（源静默不动）', () => {
    const a = newApp(memStorage());
    const bad = a.setMode('nope');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'unknown_mode');
    assert.equal(bad.saw, 'nope');
    assert.equal(bad.kept, DAT.MUS_PLAYBACK_MODES[0], '保持原样');
    assert.equal(a.modeRows().filter((x) => x.on)[0].key, DAT.MUS_PLAYBACK_MODES[0]);
    const ok = a.setMode('random');
    assert.equal(ok.ok, true);
    assert.equal(a.modeRows().filter((x) => x.on)[0].key, 'random');
    /* 模式的持久化要真的落盘（重开 App 后仍是 random）。 */
    assert.equal(newApp(a.storage).modeRows().filter((x) => x.on)[0].key, 'random');
});

test('B6 跳曲与定位：绕回留痕，坏游标拒并落台账', () => {
    const a = newApp(memStorage());
    a.ingestReply(JSON.stringify({ songs: [rawSong({ id: '1' }), rawSong({ id: '2', name: 'b' }), rawSong({ id: '3', name: 'c' })] }));
    a.seek(2);
    const step = a.stepIndex(0.5);
    assert.equal(step.ok, true);
    assert.equal(step.index, 0, '顺序播放到底要绕回第一首');
    assert.equal(step.wrapped, true, '绕回必须留痕');
    assert.ok(a.receiptRows().some((x) => x.kind === 'step'));
    /* 坏游标一律拒。 */
    const s = a.seek(9);
    assert.equal(s.ok, false);
    assert.equal(s.reason, 'out_of_range');
    assert.equal(s.size, 3);
    assert.ok(a.receiptRows().some((x) => x.kind === 'seek' && x.why === 'out_of_range'));
    assert.equal(a.seek('x').reason, 'not_number');
    assert.equal(a.seek(1.5).reason, 'not_integer');
    /* 空队列的跳曲要有话说。 */
    const e = newApp(memStorage());
    assert.equal(e.stepIndex(0.5).ok, false);
});

test('B7 来源：偏好与冷却一起画；本件只记不发请求', () => {
    const a = newApp(memStorage());
    const set = a.setSources([{ key: 'n1', url: 'u', preferred: true }, { key: 'n2' }]);
    assert.equal(set.ok, true);
    assert.equal(set.count, 2);
    assert.equal(set.pick, 'ok');
    /* 失败到真源阈值即进冷却。 */
    a.recordSource('n1', false);
    a.recordSource('n1', false);
    const third = a.recordSource('n1', false);
    assert.equal(third.state, DAT.MUS_STATES[1]);
    assert.equal(third.why, 'cooling');
    assert.ok(third.left > 0);
    /* 偏好那条仍然排第一，但状态一起画出来。 */
    const rows = a.sourceRows();
    assert.equal(rows[0].key, 'n1');
    assert.equal(rows[0].pending, true);
    assert.equal(rows[0].why, 'cooling');
    assert.ok(rows[0].leftText.indexOf('秒') > 0);
    /* 成功一次即清冷却。 */
    const okOne = a.recordSource('n1', true);
    assert.equal(okOne.why, 'ok');
    assert.equal(a.sourceRows()[0].leftText, '');
    /* 没有的那条要有话说。 */
    const miss = a.recordSource('zz', true);
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, 'no_source');
    assert.equal(miss.saw, 'zz');
});

test('B8 策略：坏值一律回落且如实报「我填的没被采纳」', () => {
    const a = newApp(memStorage());
    for (const v of [0, -3, 1.5, 'abc', null, undefined, 9999]) {
        const r = a.setQueueKeep(v);
        assert.equal(r.took, DAT.MUS_QUEUE_LIMIT, '坏值必须回落真源上限');
    }
    const saw = a.setQueueKeep('abc');
    assert.equal(saw.saw, 'abc', '填了不收必须回显原值');
    assert.equal(a.setQueueKeep(3).took, 3);
    for (const v of [0, -1, 2.5, 'x', null]) {
        assert.equal(a.setLedgerKeep(v).took, DAT.MUS_MAX_UNITS);
    }
    assert.equal(a.setLedgerKeep(2).saw, 2);
    assert.equal(a.setLedgerKeep(2).took, 2);
    /* ★ 裁台账自带下界：上游被绕过时也不许把台账清成零（下界 1）。
     *   ★ 这里刻意用 **0** 而不用负数：负数在缺下界的实现上会让循环条件恒真
     *     （0 条也 > -1）—— 那会把「这条判据能观测」变成「测试挂死」，
     *     观测点就没了。0 既能测出下界丢失，也不会把判据自己拖死。 */
    a.ledgerKeep = 0;
    a.receipts = [{ at: '', kind: 'x', label: '', line: '', given: 0, kept: 0, merged: 0, capped: 0, dropped: 0, saw: '', why: '' }];
    a._trimLedger();
    assert.equal(a.receiptRows().length, 1, '下游归一被绕过时下界必须仍然守住一条');
});

test('B9 页签与详情态：越界一律拒，换会话收回', () => {
    const a = newApp(memStorage());
    a.ingestReply(replyText());
    assert.equal(a.tab(), 'shelf');
    assert.equal(a.setTab('nope'), 'shelf', '不认的页签回落第一页');
    assert.equal(a.setTab('queue'), 'queue');
    assert.equal(a.openSong(9).ok, false);
    assert.equal(a.openSong(9).reason, 'out_of_range');
    assert.equal(a.openSong(0).ok, true);
    assert.equal(a.currentKey(), '0');
    assert.equal(a.closeSong().ok, true);
    assert.equal(a.currentKey(), '');
    /* 投影是视图唯一入口，且读数与四态都在里面。 */
    const p = a.probe();
    for (const k of ['face', 'faceText', 'malformed', 'readings', 'songs', 'covers', 'lyrics', 'queue', 'modes', 'sources', 'receipts', 'policy', 'request']) {
        assert.ok(Object.prototype.hasOwnProperty.call(p, k), '投影必须带 ' + k);
    }
    /* 手写的键面不许回潮：四态与模式键都取真源。 */
    assert.equal(a.catalogs().states.length, 4);
    assert.equal(a.catalogs().faces.length, 4);
    assert.equal(a.catalogs().tabs.length, 6);
    assert.equal(a.faceTextOf('ok'), DAT.MUS_FACE_TEXT.ok);
    assert.equal(a.stateTextOf('absent'), DAT.MUS_STATE_TEXT.absent);
});

test('B10 要求文本：本件唯一写出去的字（不发请求）', () => {
    const a = newApp(memStorage());
    const r = a.requestText('');
    assert.equal(r.ok, true);
    assert.ok(r.text.indexOf('songs') > 0, '要说清要什么形状');
    assert.ok(r.text.indexOf('别替我删重复的') > 0, '要带三条要求之一');
    assert.equal(a.draftOf(), r.text);
    assert.equal(a.probe().request, r.text);
    const withHint = a.requestText('另外只要她的歌');
    assert.ok(withHint.text.indexOf('另外只要她的歌') > 0);
    assert.equal(a.clearDraft().ok, true);
    assert.equal(a.draftOf(), '');
});

test('B11 清曲库只清曲库（歌词与台账不动 —— 源把三者混在一个开关上）', () => {
    const a = newApp(memStorage());
    a.ingestReply(replyText());
    const led = a.receiptRows().length;
    assert.equal(a.clearSongs().cleared, 1);
    assert.equal(a.songRows().length, 0);
    assert.equal(a.lyricRows().kept, 1, '歌词不许被一起清掉');
    assert.equal(a.receiptRows().length, led, '台账不许被一起清掉');
    assert.equal(a.clearLedger().ok, true);
    assert.equal(a.receiptRows().length, 0);
});

/* ══════════════════════ C — 接线与同源 ══════════════════════ */
test('C1 四条会话键随会话隔离（换角色后不许读到别人的曲库与游标）', () => {
    const st = sessionStorage();
    const a = newApp(st);
    a.ingestReply(replyText());
    a.setMode('single');
    assert.equal(a.readings().songs, 1);
    assert.ok(st._box.has('c1::musicdesk_lib'), '曲库必须落在带会话前缀的键上');
    assert.ok(st._box.has('c1::musicdesk_lyrics'));
    assert.ok(st._box.has('c1::musicdesk_ledger'));
    /* 换会话：四格一起收回。 */
    st.switchTo('c2');
    a.onChatChanged();
    assert.equal(a.readings().songs, 0, '换会话后不许读到 c1 的曲库');
    assert.equal(a.receiptRows().length, 0);
    assert.equal(a.tab(), 'shelf');
    assert.equal(a.currentKey(), '');
    assert.equal(a.draftOf(), '');
    assert.equal(a.modeRows().filter((x) => x.on)[0].key, DAT.MUS_PLAYBACK_MODES[0]);
    /* 换回去仍是 c1 的那份。 */
    st.switchTo('c1');
    a.onChatChanged();
    assert.equal(a.readings().songs, 1);
    assert.equal(a.modeRows().filter((x) => x.on)[0].key, 'single');
    /* 四条键的真源前缀必须能被宿主存储层认出来。 */
    const pat = read(STORAGE);
    assert.ok(pat.indexOf('/^musicdesk_/') >= 0, 'storage.js 必须有一条覆盖四键的宽前缀');
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    assert.ok(apps.indexOf("id: 'musicdesk'") > 0, 'config/apps.js 必须有本件条目');
    assert.ok(apps.indexOf("name: '曲库案头'") > 0);
    const idx = read(INDEX);
    assert.ok(idx.indexOf("appId === 'musicdesk'") > 0, 'index.js 必须有懒加载分支');
    assert.ok(idx.indexOf('musicdeskApp') > 0, 'index.js 必须有换会话重绑');
    assert.ok(idx.indexOf("import('./apps/musicdesk/musicdesk-app.js')") > 0);
    assert.ok(read(STORAGE).indexOf('/^musicdesk_/') > 0, 'storage.js 必须有会话键前缀');
    const keys = read(KEYS);
    for (const k of ['musicdesk_lib', 'musicdesk_lyrics', 'musicdesk_ledger', 'musicdesk_policy']) {
        assert.ok(keys.indexOf(k) >= 0, 'keys-audit 必须登记 ' + k);
    }
    const v255 = read(V255);
    assert.ok(v255.indexOf("musicdeskApp: 'musicdesk'") > 0, 'system-v255 的 A5 表必须加本件');
    /* 重绑表必须真的挂在「换会话要重取」那张表上，不是挂在别处。 */
    const rebind = idx.slice(idx.indexOf('musicdeskApp') - 400, idx.indexOf('musicdeskApp') + 10);
    assert.ok(rebind.indexOf('needsimApp') > 0, '本件必须挂在重绑表中（紧邻上一版）');
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(MD_CSS);
    assert.ok(css.indexOf('.msd-root') > 0, '样式必须挂在 .msd-root 下');
    assert.ok(css.indexOf('@@') < 0, '样式文件不许留占位符（本版真踩到过）');
    const phone = read(PHONE_CSS);
    const mark = '[v3.42.0] 曲库案头';
    const at = phone.indexOf(mark);
    assert.ok(at > 0, 'phone.css 必须有本版段');
    const lineStart = phone.lastIndexOf(NL, at) + 1;
    assert.ok(phone.slice(lineStart, at).indexOf('/*') >= 0 || phone.slice(at - 2, at).indexOf('/*') >= 0,
        '段头必须独占一行（不许与上一段尾粘连）');
    /* 段序：最新版在最前。 */
    const heads = [];
    let i = phone.indexOf('/* ' + String.fromCharCode(9552) + String.fromCharCode(9552));
    while (i >= 0) {
        heads.push(phone.slice(i, i + 40));
        i = phone.indexOf('/* ' + String.fromCharCode(9552) + String.fromCharCode(9552), i + 1);
    }
    assert.ok(heads.length >= 2);
    assert.ok(heads[0].indexOf('[v3.42.0]') > 0, '本版段必须排在最前');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const phone = read(PHONE_CSS);
    const src = read(MD_CSS).trim();
    assert.ok(phone.indexOf(src) > 0, 'phone.css 里的本版段必须与源文件逐字同源');
});

test('C5 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const view = stripComments(read(MD_VIEW));
    const app = read(MD_APP);
    const called = new Set();
    for (const m of view.matchAll(/app\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) called.add(m[1]);
    assert.ok(called.size >= 12, '视图至少要调十几个口（实测 ' + called.size + '）');
    for (const name of called) {
        assert.ok(app.indexOf(name + '(') > 0, '视图调了 App 上没有的口：' + name);
    }
});

test('C6 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = read(MD_VIEW);
    const css = read(MD_CSS);
    const produced = new Set();
    for (const m of view.matchAll(/msd-[a-z0-9-]+/g)) produced.add(m[0]);
    const styled = new Set();
    for (const m of css.matchAll(/\.(msd-[a-z0-9-]+)/g)) styled.add(m[1]);
    const missing = [];
    for (const c of produced) {
        if (styled.has(c)) continue;
        /* 动态拼的类（色相 / 状态 / 面色）以带尾空拼装形出现，逐档核对。 */
        if (c === 'msd-tone-') {
            /* ★ 真源表里的档位**自带前缀**（'msd-tone-a'…）：这里再拼一遍前缀
             *   会变成核对 'msd-tone-msd-tone-a'，八档全报「缺」而实际都在。 */
            for (const t of DAT.MUS_COVER_TONES) assert.ok(styled.has(t), '缺色相档 ' + t);
            assert.ok(styled.has('msd-tone-none'));
            continue;
        }
        if (c === 'msd-state-') {
            for (const s of ['ok', 'warn', 'off', 'err']) assert.ok(styled.has('msd-state-' + s), '缺状态色 ' + s);
            continue;
        }
        if (c === 'msd-face-') {
            for (const t of ['ok', 'warn', 'err']) assert.ok(styled.has('msd-face-' + t), '缺面色 ' + t);
            continue;
        }
        missing.push(c);
    }
    assert.deepEqual(missing, [], '这些类在视图里有、在样式里没有落点');
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
/** 被审四件（含样式）里允许出现「源侧词」的地方：**只在注释里**。
 *  本函数返回剥掉注释后的代码。 */
const codeOf = (rel) => stripComments(read(rel));

test('D1 不发请求：四件里一个网络调用都没有（源直连多家聚合 API 与 NCM 节点）', () => {
    for (const rel of [MD_DATA, MD_APP, MD_VIEW]) {
        const code = codeOf(rel);
        for (const w of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'EventSource']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许出现 ' + w);
        }
        assert.equal(code.indexOf('http://') >= 0 || code.indexOf('https://') >= 0, false, rel + ' 不许出现协议地址');
    }
});

test('D2 不读账号与 cookie / 不碰 audio / 不落数据库（源直读 uid 与 cookie、new Audio() 验链接、走 IndexedDB）', () => {
    for (const rel of [MD_DATA, MD_APP, MD_VIEW]) {
        const code = codeOf(rel);
        for (const w of ['indexedDB', 'localStorage', 'sessionStorage', 'document.cookie', 'new Audio', 'AudioContext']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许出现 ' + w);
        }
    }
    /* ★ 单列：源从本地存储直读账号 uid 与 cookie —— 本件零密钥度。 */
    for (const rel of [MD_DATA, MD_APP]) {
        const code = codeOf(rel);
        for (const w of ['cookie', 'uid', 'token', 'apiKey', 'password']) {
            assert.equal(code.indexOf(w) >= 0, false, rel + ' 不许出现 ' + w);
        }
    }
});

test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名', () => {
    for (const rel of [MD_DATA, MD_APP, MD_VIEW, MD_CSS]) {
        const code = (rel === MD_CSS) ? read(rel) : codeOf(rel);
        assert.equal(code.indexOf('data:image') >= 0, false, rel + ' 不许内联图');
        for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']) {
            assert.equal(code.indexOf(ext) >= 0, false, rel + ' 不许图片扩展名 ' + ext);
        }
    }
    /* 封面那口给的必须是首字（不是地址）。 */
    assert.equal(codeOf(MD_DATA).indexOf('image/png') >= 0, false);
});

test('D4 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const code = codeOf(MD_APP);
    assert.ok(code.indexOf('this.storage.get') > 0);
    assert.ok(code.indexOf('this.storage.set') > 0);
    for (const w of ['remove', 'clear(', 'keys', 'allKeys', 'entries']) {
        assert.equal(code.indexOf('this.storage.' + w) >= 0, false, 'storage 出口不许有 ' + w);
    }
});

/* ══════════════════════ E — 消费面 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    const data = read(MD_DATA);
    const app = read(MD_APP);
    const view = read(MD_VIEW);
    const consumed = stripComments(app) + stripComments(view);
    /* 数据层的每一个 export 名，都要在产品侧（App 或视图）出现。 */
    const names = [];
    for (const m of data.matchAll(/^export (?:const|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)) names.push(m[1]);
    assert.ok(names.length >= 40, '数据层导出数（实测 ' + names.length + '）');
    /* ★ 消费面**两处都算**：产品侧（App / 视图）与数据层内部互调 ——
     *   只算产品侧会把「真源表 + 内核函数」这一整类误判成零消费
     *   （MUS_COVER_TONES 只被 coverOf 用、textOf 是全层的取字口）。 */
    const own = stripComments(data);
    const orphan = [];
    for (const n of names) {
        if (consumed.indexOf(n) >= 0) continue;
        const inOwn = own.split(n).length - 1;
        if (inOwn > 1) continue;
        orphan.push(n);
    }
    assert.deepEqual(orphan, [], '这些导出在产品侧与数据层内部都零消费（建好了没人用）');
});

test('E2 手写键不许回潮：四态与定档的键面必须取真源', () => {
    const code = codeOf(MD_APP);
    assert.ok(code.indexOf('const FACE_OK = MUS_FACES[') > 0, '面常量必须取真源');
    assert.equal(new RegExp('const FACE_OK\\s*=\\s*' + Q).test(code), false, '面常量不许手写标识符形');
    const vcode = codeOf(MD_VIEW);
    assert.ok(vcode.indexOf('FACE_TONE[MUS_FACES[') > 0, '面色相必须按真源键挂');
    assert.ok(vcode.indexOf('STATE_TONE[MUS_STATES[') > 0, '状态色相必须按真源键挂');
    const tones = [];
    for (const m of vcode.matchAll(/FACE_TONE\[MUS_FACES\[(\d)\]\] = '([a-z]+)';/g)) tones.push(m[2]);
    assert.equal(tones.length, 4, '四态必须逐档挂色');
    assert.ok(new Set(tones).size >= 3, '四态色不许塔成一种');
});

test('E3 视图不自己算内核（那是数据层与 App 的事）', () => {
    const code = codeOf(MD_VIEW);
    /* 视图只许 import 键面（三张表），不许 import 内核函数。 */
    const imp = code.slice(code.indexOf('import'), code.indexOf('import') + 200);
    assert.ok(imp.indexOf('MUS_FACES') > 0);
    assert.ok(imp.indexOf('MUS_STATES') > 0);
    assert.equal(imp.indexOf('normalizeSong') >= 0, false, '视图不许自己做归一');
    assert.equal(imp.indexOf('parseLrc') >= 0, false, '视图不许自己解歌词');
    assert.equal(imp.indexOf('guardQueue') >= 0, false, '视图不许自己去重');
});

/* ══════════════════════ F — 视图层 ══════════════════════ */
test('F1 四态必须分开画：视图画出四态人话与四色徽章（不许塔成一句）', () => {
    const code = codeOf(MD_VIEW);
    assert.ok(code.indexOf('app.stateTextOf(') > 0, '状态人话必须取 App 的口');
    assert.ok(code.indexOf('app.faceTextOf(') > 0, '面人话必须取 App 的口');
    assert.ok(code.indexOf('STATE_TONE[') > 0, '状态色相必须逐态挂');
    /* 六个面板都在。 */
    for (const p of ['_shelfPanel', '_lyricPanel', '_queuePanel', '_sourcePanel', '_formPanel', '_policyPanel']) {
        assert.ok(code.indexOf(p + '(') > 0, '缺面板 ' + p);
    }
});

test('F2 空与坏不同形：同一句话不许两种处境共用（且逗号表达式坑不许回潮）', () => {
    const code = codeOf(MD_VIEW);
    /* 计数位在取不出来时画横线（DASH），不是零。 */
    assert.ok(code.indexOf('? DASH :') > 0, '计数位必须在取不出来时画横线');
    assert.ok(code.indexOf('_count(') > 0, '必须走统一的计数口');
    /* ★ 封面读数整格没有时要单列一句话（不是把四个零画成「四种封面各 0 首」）。 */
    assert.ok(code.indexOf('if (!covers)') > 0, '封面读数整格没有时必须单列一句话');
    assert.ok(code.indexOf('封面读数拿不到') > 0, '那句话必须写出来（别只写个横线）');
    /* 封面读数整格没有时要单独一句话。 */
    assert.ok(code.indexOf('封面读数拿不到') > 0 || code.indexOf('封面读数') > 0);
    /* 逗号表达式不许回潮（本仓踩过：括号收尾接逗号被解析成序列表达式）。 */
    assert.equal(new RegExp('\\)\\s*,' + NL).test(code), false, '不许出现括号收尾接逗号的写法');
});

test('F3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const code = codeOf(MD_VIEW);
    assert.ok(code.indexOf('String.fromCharCode(38)') > 0, '与号必须走拼装形');
    assert.ok(code.indexOf('String.fromCharCode(34)') > 0, '双引号必须走拼装形');
    assert.ok(code.indexOf('_esc(') > 0, '人给的文本必须过转义');
    /* 不许把实体字面量写进源码（落盘链会把它解码成真字符）。 */
    assert.equal(code.indexOf('&amp;') >= 0, false, '不许写实体字面量');
    assert.equal(code.indexOf('&lt;') >= 0, false, '不许写实体字面量');
});

test('F4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const code = codeOf(MD_VIEW);
    /* 收拾失败、换模式失败、记来源失败、定位失败都要落到提示条。 */
    assert.ok(code.indexOf('_flashOf(') > 0);
    assert.ok(code.indexOf('收拾不了') > 0, '收拾失败必须有话');
    assert.ok(code.indexOf('不认这个模式') > 0, '模式拒绝必须有话');
    assert.ok(code.indexOf('没有这条来源') > 0, '来源没有必须有话');
    assert.ok(code.indexOf('换不了') > 0, '跳曲失败必须有话');
});

test('F5 点卡片要能打开：判定必须向上找祖先（不许只认直点元素）', () => {
    const code = codeOf(MD_VIEW);
    assert.ok(code.indexOf('const climb = (from, pred)') > 0, '必须有向上找祖先的工具');
    const ia = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-act' + Q + '))');
    const ic = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-open' + Q + ')');
    assert.ok(ia > 0, '动作按钮必须走 climb');
    assert.ok(ic > 0, '卡片必须走 climb');
    assert.ok(ia < ic, '动作按钮必须先于卡片（按钮在卡片内部，先判卡片会把按钮吃掉）');
    /* 页签 / 模式 / 来源按钮也走 climb。 */
    for (const k of ['data-tab', 'data-mode', 'data-src']) {
        assert.ok(code.indexOf('climb(t, (n) => n.getAttribute(' + Q + k + Q + '))') > 0, k + ' 必须走 climb');
    }
});

/* ══════════════════════ G — 会话键 ══════════════════════ */
test('G1 四条会话键在 keys-audit 登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['musicdesk_lib', 'musicdesk_lyrics', 'musicdesk_ledger', 'musicdesk_policy']) {
        const at = keys.indexOf(k);
        assert.ok(at > 0, '必须登记 ' + k);
        const line = keys.slice(keys.lastIndexOf(NL, at) + 1, keys.indexOf(NL, at));
        assert.ok(line.indexOf('chat') > 0, k + ' 的 scope 必须是 chat');
    }
    const wide = read('scripts/registry-audit.mjs');
    assert.ok(wide.length > 0);
});

test('G2 四条键真被产品消费（写面必须落到这四条上）', () => {
    const code = codeOf(MD_APP);
    for (const k of ['musicdesk_lib', 'musicdesk_lyrics', 'musicdesk_ledger', 'musicdesk_policy']) {
        assert.ok(code.indexOf(k) > 0, 'App 必须真用上 ' + k);
    }
    assert.ok(code.indexOf('_persistLibrary()') > 0);
    assert.ok(code.indexOf('_persistLyrics()') > 0);
    assert.ok(code.indexOf('_persistLedger()') > 0);
    assert.ok(code.indexOf('_persistPolicy()') > 0);
});

/* ══════════════════════ H — 换会话 ══════════════════════ */
test('H1 换会话必须全量重取 + 清视图态（源把这些放在没有角色维度的键下）', () => {
    const st = sessionStorage();
    const a = newApp(st);
    a.ingestReply(replyText());
    a.setTab('policy');
    a.openSong(0);
    a.setSources([{ key: 'n1' }]);
    a.setLedgerKeep(3);
    st.switchTo('c2');
    a.onChatChanged();
    const p = a.probe();
    assert.equal(p.readings.songs, 0, '曲库必须重取');
    assert.equal(a.sourceRows().length, 0, '来源必须重取');
    assert.equal(a.receiptRows().length, 0, '台账必须重取');
    assert.equal(a.ledgerKeepOf(), DAT.MUS_MAX_UNITS, '策略必须重取');
    assert.equal(a.tab(), 'shelf');
    assert.equal(a.currentKey(), '');
    assert.equal(a.draftOf(), '');
});

test('H2 无 storage 也不许崩：四格一起报「取不出来」', () => {
    for (const st of [null, undefined, {}, { get: () => null }, { set: () => {} }, hostileStorage()]) {
        const a = newApp(st);
        assert.equal(a.faceOf(), DAT.MUS_FACES[3]);
        assert.equal(a.probe(), null);
        assert.equal(a.readings(), null);
        assert.equal(a.summaryLine(), '读数拿不到（存储不可用）');
        assert.equal(a.setSources([{ key: 'x' }]).ok, true, '动作口不许崩（写不进去要报，不是抛）');
        assert.equal(a.clearSongs().ok, true);
        assert.equal(a.clearLedger().ok, true);
        a.onChatChanged();
        assert.equal(a.faceOf(), DAT.MUS_FACES[3]);
        a.render();
    }
});

/* ══════════════════════ I — 负控制（破坏必须可观测） ══════════════════════ */
/** 数据层判据（加载**真破坏副本**后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 曲目归一不许静默兜底（id 缺失要判 false）。 */
    if (mod.normalizeSong({ name: 'x' }).ok !== false) bad.push('song-no-id-accepted');
    if (mod.normalizeSong({ id: 'a' }).filled.indexOf('artist') < 0) bad.push('song-fill-unreported');
    /* ② 回读不许丢字段。 */
    const once = mod.normalizeSong({ id: 's1', name: 'n', ar: [{ name: '张三' }], al: { name: 'A', picUrl: 'u' }, dt: 215000 });
    const twice = mod.normalizeSong(once.song);
    if (twice.song.artist !== '张三') bad.push('roundtrip-artist-lost');
    if (twice.song.album !== 'A') bad.push('roundtrip-album-lost');
    if (twice.song.seconds !== 215) bad.push('roundtrip-seconds-lost');
    /* ③ 去重不许静默。 */
    /* ★ 夹具要**真的造出超限**：六条里有 1 条被合并、2 条被丢、2 条留下、
     *   1 条超上限 —— 少于六条时 capped 会是 0，而那等于把这条判据测成空气。 */
    const d = mod.dedupeSongs([
        { id: '1', name: 'A', artist: 'x', album: 'z' },
        { id: '2', name: 'A', artist: 'x', album: 'z' },
        { id: '', name: 'B' }, { id: '3', name: '  ' },
        { id: '4', name: 'C' }, { id: '5', name: 'D' }
    ], 2);
    if (d.merged.length !== 1) bad.push('dedupe-merge-unreported');
    if (d.dropped.no_id !== 1 || d.dropped.no_name !== 1) bad.push('dedupe-drop-unreported');
    if (d.capped !== 1) bad.push('dedupe-cap-unreported');
    /* ④ 封面四态不许塔平且不许出外链。 */
    const cov = [mod.coverOf({ name: 'A', coverRaw: 'u' }), mod.coverOf({ name: '...', coverRaw: 'u' }),
        mod.coverOf({ name: 'A' }), mod.coverOf({ name: 'A', coverRaw: {} })];
    if (new Set(cov.map((x) => x.i)).size !== 4) bad.push('cover-states-collapsed');
    for (const c of cov) if (c.piece && c.piece.length > 2) bad.push('cover-leaked-url');
    /* ⑤ 歌词坏行两因不许塔平。 */
    const lrc = mod.parseLrc('[ti:x]' + NL + '[00:01.00]a' + NL + 'no tag' + NL + '[00:02.00]', 0);
    if (lrc.dropped.noTime !== 2) bad.push('lrc-notime-lost');
    if (lrc.dropped.noText !== 1) bad.push('lrc-notext-lost');
    if (lrc.kept !== 1) bad.push('lrc-kept-lost');
    /* ⑥ 时长四态与毫秒折算。 */
    const msr = mod.durationOf(215000);
    if (msr.why !== 'from_millis' || msr.normalized !== true) bad.push('duration-millis-lost');
    if (mod.formatTime(null).text !== '') bad.push('duration-absent-drawn-as-zero');
    if (mod.formatTime(0).text !== '00:00') bad.push('duration-real-zero-lost');
    if (mod.formatTime('abc').text !== '') bad.push('duration-malformed-drawn');
    /* ⑦ 播放模式三形与拒而不夹。 */
    if (mod.modeOf(null).why !== 'absent') bad.push('mode-absent-lost');
    if (mod.modeOf(3).why !== 'not_text') bad.push('mode-not-text-lost');
    const unk = mod.modeOf('nope');
    if (unk.why !== 'unknown_mode') bad.push('mode-unknown-lost');
    if (unk.mode !== '') bad.push('mode-silently-clamped');
    if (unk.saw !== 'nope') bad.push('mode-saw-lost');
    /* ⑧ 游标五因与绕回留痕。 */
    if (mod.seekTo(null, 0).why !== 'no_list') bad.push('seek-nolist-lost');
    if (mod.seekTo([], 0).why !== 'empty_queue') bad.push('seek-empty-lost');
    if (mod.seekTo([1], 'x').why !== 'not_number') bad.push('seek-notnumber-lost');
    if (mod.seekTo([1], 1.5).why !== 'not_integer') bad.push('seek-notinteger-lost');
    /* ★ 越界要**拒**：ok 必须 false 且 index 必须 < 0 ——
     *   只看 why 的话，「why 照记、位置照样夹到 0」这种夹法会被判成没事。 */
    const oor = mod.seekTo([1], 5);
    if (oor.ok !== false || oor.index >= 0) bad.push('seek-oor-lost');
    const w = mod.nextIndex('sequential', 2, 3);
    if (w.wrapped !== true) bad.push('cursor-wrap-unreported');
    /* ⑨ 来源四形与偏好冷却一起画。 */
    if (mod.healthOf({}, 0).state !== mod.MUS_STATES[2]) bad.push('health-absent-lost');
    if (mod.healthOf({ fails: 3, coolingUntil: 1000 }, 500).why !== 'cooling') bad.push('health-cooling-lost');
    if (mod.healthOf({ fails: 3, coolingUntil: 1000 }, 2000).why !== 'cold') bad.push('health-cold-lost');
    const sorted = mod.sortSources([{ key: 'p', preferred: true, fails: 3, coolingUntil: 9000 }, { key: 'q' }], 1000);
    if (sorted[0].key !== 'p') bad.push('source-preferred-lost');
    if (sorted[0].why !== 'cooling') bad.push('source-cooling-hidden');
    if (mod.pickSource([], 0).why !== 'absent') bad.push('pick-absent-lost');
    if (mod.pickSource([{ key: 'a', fails: 3, coolingUntil: 9000 }], 1000).why !== 'cooling_only') bad.push('pick-cooling-only-lost');
    /* ⑩ 把握分带 why。 */
    if (mod.matchScore({ name: 'x', artist: 'y' }, { name: 'x', artist: 'y' }).why !== 'same_name') bad.push('score-why-lost');
    if (mod.matchScore({ name: 'x' }, { name: 'q' }).pass !== false) bad.push('score-threshold-lost');
    /* ⑪ 回执六因是键、裸数组要认。 */
    if (Object.keys(mod.MUS_REPLY_WHYS).length !== 6) bad.push('reply-whys-collapsed');
    for (const k of Object.keys(mod.MUS_REPLY_WHYS)) if (!/^[a-z_]+$/.test(k)) bad.push('reply-why-not-key');
    if (mod.extractObject('[' + DQ + 'a' + DQ + ']').ok !== true) bad.push('bare-array-rejected');
    if (mod.extractObject('{oops').why !== 'unbalanced') bad.push('unbalanced-lost');
    if (mod.parseReply('{oops}', 0).why !== 'bad_json') bad.push('bad-json-why-lost');
    /* ⑫ 读数不编 0。 */
    if (mod.readingsOf({}).songs !== null) bad.push('readings-faked-zero');
    if (mod.readingsOf({}).covers !== null) bad.push('covers-faked-zero');
    if (mod.readingsOf({}).lrc !== null) bad.push('lrc-faked-zero');
    /* ⑬ 面四态不许塔平。 */
    const F = mod.MUS_FACES;
    if (new Set([mod.faceOf({ storage: false }).face, mod.faceOf({ songs: null }).face,
        mod.faceOf({ songs: [] }).face, mod.faceOf({ songs: [1] }).face]).size !== 4) bad.push('face-states-collapsed');
    if (mod.faceOf({ storage: false }).face !== F[3]) bad.push('face-storage-absent-lost');
    /* ⑭ 真源表条目不许少。 */
    if (mod.MUS_COVER_TONES.length !== 8) bad.push('tones-collapsed');
    if (mod.MUS_PLAYBACK_MODES.length !== 3) bad.push('playback-modes-collapsed');
    if (mod.MUS_STATES.length !== 4) bad.push('states-collapsed');
    return bad;
};

/** App 面判据（在**破坏副本**上真的 new 一个 App 跑）。 */
const appFaceProblems = (mod) => {
    const bad = [];
    /* ★ 面键取**数据层**的（App 模块只导出类）：从 mod 取会拿到 undefined
     *   而让比较恒真——判据变成「恒红」，对照组就会假绿。 */
    const F = DAT.MUS_FACES;
    const a = new mod.MusicdeskApp(shellStub(), hostileStorage());
    if (a.faceOf() !== F[3]) bad.push('storage-absent-lost');
    if (a.probe() !== null) bad.push('projection-not-null-on-absent');
    if (a.readings() !== null) bad.push('readings-not-null-on-absent');
    if (a.coverRows() !== null) bad.push('covers-not-null-on-absent');
    if (a.summaryLine() !== '读数拿不到（存储不可用）') bad.push('summary-not-absent');
    const ok = new mod.MusicdeskApp(shellStub(), memStorage());
    if (ok.faceOf() !== F[1]) bad.push('empty-face-lost');
    const bad4 = new mod.MusicdeskApp(shellStub(), memStorage({ musicdesk_lib: '{bad' }));
    if (bad4.faceOf() !== F[2]) bad.push('malformed-face-lost');
    bad4.probe();
    if (bad4.faceOf() !== F[2]) bad.push('malformed-face-lost');
    return bad;
};

const appContentProblems = (mod) => {
    const bad = [];
    const a = new mod.MusicdeskApp(shellStub(), memStorage());
    const r = a.ingestReply(replyText());
    if (r.ok !== true) bad.push('ingest-ok-lost');
    if (a.songRows().length !== 1) bad.push('ingest-songs-lost');
    if (a.receiptRows().length !== 1) bad.push('ingest-receipt-lost');
    if (a.receiptRows()[0] && a.receiptRows()[0].kind !== 'ingest') bad.push('receipt-kind-lost');
    if (!(r.lyrics && r.lyrics.kept === 1)) bad.push('ingest-lyrics-lost');
    /* ★ 逐曲行的时长判定不许恒假（本版真踩到的一族）。 */
    const row = a.songRows()[0];
    if (row.durationOk !== true) bad.push('song-duration-always-unknown');
    if (row.durationText !== '03:35') bad.push('song-duration-text-lost');
    if (row.artist !== '张三') bad.push('song-artist-lost');
    /* 回读之后仍要读得出来。 */
    const again = new mod.MusicdeskApp(shellStub(), a.storage);
    if (again.songRows()[0].durationText !== '03:35') bad.push('song-duration-lost-on-reload');
    if (again.songRows()[0].artist !== '张三') bad.push('song-artist-lost-on-reload');
    /* 失败不许动现有曲库。 */
    const n = a.songRows().length;
    if (a.ingestReply('hi').reason !== 'no_object') bad.push('no-object-reply-accepted');
    if (a.songRows().length !== n) bad.push('failed-ingest-wiped-library');
    /* 模式拒绝要报 saw。 */
    const m = a.setMode('nope');
    if (m.why !== undefined && m.ok !== false) bad.push('unknown-mode-accepted');
    if (m.saw !== 'nope') bad.push('mode-saw-lost');
    if (m.kept !== DAT.MUS_PLAYBACK_MODES[0]) bad.push('mode-not-kept');
    /* 定位越界要拒。 */
    if (a.seek(9).reason !== 'out_of_range') bad.push('seek-oor-accepted');
    if (a.seek(1.5).reason !== 'not_integer') bad.push('seek-fraction-accepted');
    return bad;
};

const appGateProblems = (mod) => {
    const bad = [];
    const a = new mod.MusicdeskApp(shellStub(), memStorage());
    for (const v of [0, -3, 1.5, 'abc', null, undefined, 9999]) {
        if (a.setQueueKeep(v).took !== DAT.MUS_QUEUE_LIMIT) bad.push('queue-keep-fallback-lost');
        if (a.setLedgerKeep(v).took !== DAT.MUS_MAX_UNITS) bad.push('ledger-keep-fallback-lost');
    }
    /* ★ 填了不收必须回显原值（用户得知道「我填的没被采纳」）。 */
    if (a.setQueueKeep('abc').saw !== 'abc') bad.push('queue-keep-saw-lost');
    if (a.setLedgerKeep('abc').saw !== 'abc') bad.push('ledger-keep-saw-lost');
    if (a.setQueueKeep(3).took !== 3) bad.push('queue-keep-ok-lost');
    /* 裁台账自带下界：上游归一被绕过时也不许把台账清成零。
     *   ★ 用 0 而不是负数 —— 负数在缺下界的实现上会死循环，判据就观测不到了。 */
    a.ledgerKeep = 0;
    a.receipts = [{ at: '', kind: 'x', label: '', line: '', given: 0, kept: 0, merged: 0, capped: 0, dropped: 0, saw: '', why: '' }];
    a._trimLedger();
    if (a.receiptRows().length === 0) bad.push('trim-ledger-lower-bound-lost');
    /* 空输入要分形。 */
    if (a.ingestReply('').reason !== 'empty_input') bad.push('empty-reply-accepted');
    if (a.ingestReply('{oops').reason !== 'unbalanced') bad.push('unbalanced-reply-accepted');
    if (a.ingestReply('[]').reason !== 'empty') bad.push('empty-list-accepted');
    /* 来源：没有的那条要报 saw。 */
    /* ★ 「没这条来源」必须**拒**：ok 为 false 且把那串字带回来 ——
     *   只看 saw 的话，「照样回 ok:true」这种谎报会被判成没事。 */
    const miss = a.recordSource('zz', true);
    if (miss.ok !== false || miss.saw !== 'zz') bad.push('no-source-saw-lost');
    return bad;
};

const appChatProblems = (mod) => {
    const bad = [];
    const st = sessionStorage();
    const app = new mod.MusicdeskApp(shellStub(), st);
    app.ingestReply(replyText());
    app.setMode('single');
    app.setTab('policy');
    app.setLedgerKeep(3);
    app.setSources([{ key: 'n1' }]);
    app.openSong(0);
    st.switchTo('c2');
    app.onChatChanged();
    /* ★ 这里**不再显式调 probe()** —— probe 就是「重取」本身，
     *   显式再调一次会把「换会话没重取」这条缺陷当场抹平（负控制变装饰）。 */
    const rd = app.readings();
    if (!rd) return ['chat-change-projection-lost'];
    if (rd.songs !== 0) bad.push('chat-change-no-library-reload');
    if (app.receiptRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    if (app.sourceRows().length !== 0) bad.push('chat-change-no-source-reload');
    if (app.ledgerKeepOf() !== DAT.MUS_MAX_UNITS) bad.push('chat-change-no-policy-reload');
    if (app.currentKey() !== '') bad.push('chat-change-no-detail-reset');
    if (app.tab() !== 'shelf') bad.push('chat-change-no-tab-reset');
    if (app.draftOf() !== '') bad.push('chat-change-no-draft-reset');
    if (app.modeRows().filter((x) => x.on)[0].key !== DAT.MUS_PLAYBACK_MODES[0]) bad.push('chat-change-no-mode-reload');
    return bad;
};

/** 视图面判据（静态）。 */
const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    /* ★ 逐档核对：只查「出现过某个色」是不够的 —— 把某一档改成引用别的档
     *   （塔平）时，色字面量仍在场，松判据会判成没事。四档必须**各按各的键、
     *   各是各的色**，且相邻两档不许重色。 */
    const want = [['0', 'ok'], ['1', 'warn'], ['2', 'err'], ['3', 'err']];
    for (const [k, t] of want) {
        if (!code.includes('FACE_TONE[MUS_FACES[' + k + ']] = ' + Q + t + Q + ';')) {
            bad.push('face-tone-not-by-source');
        }
    }
    if (!code.includes('FACE_TONE[MUS_FACES[2]] = ' + Q + 'err' + Q + ';')) bad.push('face-tone-collapsed');
    if (!code.includes('FACE_TONE[MUS_FACES[0]] = ' + Q + 'ok' + Q + ';')) bad.push('face-tone-collapsed');
    if (!code.includes('app.faceTextOf(')) bad.push('face-text-not-from-app');
    return bad;
};

const viewCountProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('? DASH :')) bad.push('empty-and-bad-collapsed');
    if (!code.includes('_count(')) bad.push('empty-and-bad-collapsed');
    /* ★ 逗号表达式：判据只看**行尾是「) + 逗号」**这一形态。
     *   多行方法调用（实参跨行）也是这个形态，所以**被审视图里不许出现
     *   跨行实参**这一条同时由 viewClimbProblems 之外的编码风格守住 ——
     *   本件把 recordSource 那一处并成单行，就是为了让这条判据的语义纯粹。 */
    if (new RegExp('\\)\\s*,' + NL).test(code)) bad.push('trailing-comma-expression');
    /* 封面读数整格没有时不许走四格（否则四个零会被画成四种封面各 0 首）。 */
    if (!code.includes('if (!covers)')) bad.push('cover-readout-absent-collapsed');
    return bad;
};

const viewClimbProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const climb = (from, pred)')) bad.push('card-climb-lost');
    const ia = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-act' + Q + '))');
    const ic = code.indexOf('climb(t, (n) => n.getAttribute(' + Q + 'data-open' + Q + ')');
    if (!(ia > 0 && ic > 0 && ia < ic)) bad.push('card-climb-order-lost');
    return bad;
};

/** 结构面判据（手写键面 / 样式落点 —— 本仓 J7 那一族，只能静态判）。 */
const dataKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    /* 六因必须是键形（写成中文话就没法被程序比对）。 */
    const at = code.indexOf('export const MUS_REPLY_WHYS = Object.freeze({');
    if (at < 0) return ['reply-whys-missing'];
    const seg = code.slice(at, at + 600);
    for (const k of ['no_text', 'unbalanced', 'no_object', 'bad_json', 'not_object', 'empty']) {
        if (seg.indexOf(k + ':') < 0) bad.push('reply-why-not-key');
    }
    return bad;
};

/** 破坏表：每一条破坏都必须**语义可观测**（不是装饰）。 */
const DAMAGE = {
    /* ① 曲目缺 id 也照收（源就是这个形态）。 */
    q1: [MD_DATA,
        "    if (!id) return { ok: false, song: null, why: 'no_id', filled: ['id'] };",
        "    if (false) return { ok: false, song: null, why: 'no_id', filled: ['id'] };"],
    /* ② 回读丢字段（归一函数只认源那套键）—— 本版归一已收三形状，
     *   故破坏方式改为「干脆不认源那套键」（回读形状仍认，正是本版修好的那条）。 */
    q2: [MD_DATA,
        "        (r.ar !== undefined && r.ar !== null) ? r.ar" + NL + "            : ((r.artists !== undefined && r.artists !== null) ? r.artists : r.artist)",
        "        (r.artist !== undefined && r.artist !== null) ? r.artist" + NL + "            : ((r.artists !== undefined && r.artists !== null) ? r.artists : r.artist)"],
    /* ③ 去重静默（重复项既不报也不数）。 */
    q3: [MD_DATA,
        '            merged.push({ key: key, into: hit.song.id, title: hit.song.name, count: hit.mergedCount });',
        '            hit.mergedCount += 0;'],
    /* ④ 超限静默截断（源到 limit 就 break）。 */
    q4: [MD_DATA,
        '        if (order.length >= lim) { capped += 1; continue; }',
        '        if (order.length >= lim) { continue; }'],
    /* ⑤ 封面四态塔平（源干脆换一张托底图）。 */
    q5: [MD_DATA,
        "    if (!hasRaw) return { state: MUS_STATES[2], i: 2, tone: '', initial: initial, piece: '', why: 'no_cover' };",
        "    if (!hasRaw) return { state: MUS_STATES[0], i: 0, tone: tone, initial: initial, piece: initial, why: 'no_cover' };"],
    /* ⑥ 歌词坏行不再分两因。 */
    q6: [MD_DATA,
        '            dropped.noText += ats.length;',
        '            dropped.noTime += ats.length;'],
    /* ⑦ 毫秒折算不再报。 */
    q7: [MD_DATA,
        "        return { ok: true, seconds: s, why: 'from_millis', normalized: true };",
        "        return { ok: true, seconds: s, why: 'ok', normalized: true };"],
    /* ⑧ 时长读不出来画成 00:00（源就是这个形态）。 */
    q8: [MD_DATA,
        "        return { state: MUS_STATES[si], i: si, text: '', why: blank ? 'no_number' : 'not_number' };",
        "        return { state: MUS_STATES[2], i: 2, text: '00:00', why: blank ? 'no_number' : 'not_number' };"],
    /* ⑨ 播放模式认不出来静默回落（源 includes 不过就 return）。 */
    q9: [MD_DATA,
        "        return { state: MUS_STATES[3], i: 3, mode: '', saw: mode, why: 'unknown_mode' };",
        "        return { state: MUS_STATES[0], i: 0, mode: MUS_PLAYBACK_MODES[0], saw: mode, why: 'unknown_mode' };"],
    /* ⑩ 游标越界静默夹成第一首（源有的分支就是 || 0）。 */
    q10: [MD_DATA,
        "        return { ok: false, index: -1, size: list.length, given: cursor, why: 'out_of_range' };",
        "        return { ok: true, index: 0, size: list.length, given: cursor, why: 'out_of_range' };"],
    /* ⑪ 绕回不再留痕（源取模后不报）。 */
    q11: [MD_DATA,
        '        if (next >= total) return { ok: true, index: 0, wrapped: true, why: \'wrapped\' };',
        '        if (next >= total) return { ok: true, index: 0, wrapped: false, why: \'ok\' };'],
    /* ⑫ 来源读不出来当作「都好」（源就是这个形态）。 */
    q12: [MD_DATA,
        '        return { state: MUS_STATES[2], i: 2, why: MUS_SORT_WHY.ok, left: 0, fails: 0, oks: 0 };',
        '        return { state: MUS_STATES[0], i: 0, why: MUS_SORT_WHY.ok, left: 0, fails: 0, oks: 0 };'],
    /* ⑬ 偏好那条的冷却状态被藏起来（源把偏好永远排第一且不标状态）。 */
    q13: [MD_DATA,
        "            pending: (i === 0 && !!n.preferred),",
        '            pending: (i === 0 && !!n.preferred && h.state !== MUS_STATES[1]),'],
    /* ⑭ 把握分不再给「为什么」。 */
    q14: [MD_DATA,
        "        if (na === nb) { score += 70; why = 'same_name'; }",
        "        if (na === nb) { score += 70; why = 'none'; }"],
    /* ⑮ 回执只认花括号（裸数组收不进来 —— 本版真踩到）。 */
    q15: [MD_DATA,
        '            if (c === CHAR_BRACKET_L) { start = i; open = c; close = CHAR_BRACKET_R; depth = 1; continue; }',
        '            if (false) { start = i; open = c; close = CHAR_BRACKET_R; depth = 1; continue; }'],
    /* ⑯ 读数编 0（空与坏塔平）。 */
    q16: [MD_DATA,
        '    let covers = null;',
        '    let covers = { ok: 0, partial: 0, absent: 0, malformed: 0 };'],
    /* ⑰ 面四态塔平（源整页没有「可不可信」这一句）。 */
    q17: [MD_DATA,
        "        return { face: MUS_FACES[2], i: 2, text: MUS_FACE_TEXT[MUS_FACES[2]], why: 'not_list' };",
        "        return { face: MUS_FACES[1], i: 1, text: MUS_FACE_TEXT[MUS_FACES[1]], why: 'not_list' };"],
    /* ⑱ App：取不出来当没事（源把取不到读成空）。 */
    q18: [MD_APP,
        '        const storageOk = !!(rl.ok && ry.ok && rg.ok && rp.ok);',
        '        const storageOk = true;'],
    /* ⑲ App：「写了但认不出来」不再单列（源就是把它当空）。
     *   ★ 锚点必须落在**面的判**上：先前把 `_libBad` 在调用前清掉是**装饰性破坏** ——
     *     `_loadLibrary` 自己会把 `_libBad` 重设回去（实测 face 仍是 malformed），
     *     负控制看不见任何变化。 */
    q19: [MD_APP,
        '        else if (anyBad) this.face = FACE_MALFORMED;',
        '        else if (false && anyBad) this.face = FACE_MALFORMED;'],
    /* ⑳ App：**时长判定恒假**（本版真踩到的那个形态：重取一个不存在的字段）。 */
    q20: [MD_APP,
        '            const hasDur = (typeof s.seconds === \'number\');',
        '            const hasDur = false;'],
    /* ㉑ App：保留数取值门塔平（坏值照收）。 */
    q21: [MD_APP,
        '    if (n === null || !Number.isInteger(n) || n < 1) return fb;',
        '    if (false) return fb;'],
    /* ㉒ App：裁台账的下界没了（负保留数会让循环条件恒真 ⇒ 挂死）。 */
    q22: [MD_APP,
        '        const lim = Math.max(1, numOrSelf(this.ledgerKeep, MUS_MAX_UNITS));',
        '        const lim = numOrSelf(this.ledgerKeep, MUS_MAX_UNITS);'],
    /* ㉓ App：换会话不再重取（源就是切角色原样留着）。 */
    q23: [MD_APP,
        '        this._lastKey = \'\';' + NL + '        this.probe();',
        '        this._lastKey = \'\';' + NL + '        if (false) this.probe();'],
    /* ㉔ App：失败时把现有曲库清掉（源在解析失败时也会清一遍）。
     *   ★ 破坏要落在**失败分支**上：先前落空输入分支，行为判据根本不走那里。 */
    q24: [MD_APP,
        "        if (!r.ok) {" + NL + "            const rec = this._receipt({" + NL
        + "                kind: 'ingest', label: '收拾回信', line: '',",
        "        if (!r.ok) {" + NL + "            this.songs = [];" + NL
        + "            const rec = this._receipt({" + NL
        + "                kind: 'ingest', label: '收拾回信', line: '',"],
    /* ㉕ App：来源记不上也当成功（用户以为记上了）。 */
    q25: [MD_APP,
        "            return { ok: false, reason: 'no_source', saw: k };",
        "            return { ok: true, reason: 'no_source', saw: k };"],
    /* ㉖ App：封面读数整格给零（视图把「读不到」画成「四种封面各 0 首」）。
     *   ★ 锚点必须落在**读数不可用**那一处早退上：落在后面那处会被它挡住。 */
    q26: [MD_APP,
        '        if (!this._readingsOk) return null;',
        '        if (!this._readingsOk) return [{ state: MUS_STATES[0], text: MUS_STATE_TEXT[MUS_STATES[0]], n: 0 }];'],
    /* ㉗ 结构性：六因写成中文话（程序没法比对）。 */
    q27: [MD_DATA,
        "    no_text: '没给正文',",
        "    noText: '没给正文',"],
    /* ㉘ 视图：面色相塔平（四态只有一种色）。 */
    q28: [MD_VIEW,
        "FACE_TONE[MUS_FACES[2]] = 'err';",
        'FACE_TONE[MUS_FACES[2]] = FACE_TONE[MUS_FACES[0]];'],
    /* ㉙ 视图：卡片判定退回直点元素。 */
    q29: [MD_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);",
        "            const cardEl = (t.getAttribute('data-open') !== null) ? t : null;"],
    /* ㉚ 视图：空与坏塔成一话（null 也当零画）。 */
    q30: [MD_VIEW,
        '        return (v === null || v === undefined) ? DASH : String(v);',
        '        return String(v === null || v === undefined ? 0 : v);'],
    /* ㉛ 视图：封面读数整格没有时不再单列（四个零画成四种封面各 0 首）。 */
    q31: [MD_VIEW,
        '        if (!covers) {',
        '        if (false) {'],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3420_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const kd = path.join(dir, 'apps', 'musicdesk');
    fs.mkdirSync(kd, { recursive: true });
    for (const f of ['musicdesk-data.js', 'musicdesk-view.js', 'musicdesk-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'musicdesk', f), path.join(kd, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「曲目缺 id 不照收」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['song-no-id-accepted']],
    ['I2 破坏「归一形状必须能回读」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['roundtrip-artist-lost', 'roundtrip-album-lost', 'roundtrip-seconds-lost']],
    ['I3 破坏「去重不许静默」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['dedupe-merge-unreported']],
    ['I4 破坏「超限不许静默截」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['dedupe-cap-unreported']],
    ['I5 破坏「封面四态不许塔平」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['cover-states-collapsed']],
    ['I6 破坏「歌词坏行分两因」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['lrc-notime-lost', 'lrc-notext-lost']],
    ['I7 破坏「毫秒折算要报」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['duration-millis-lost']],
    ['I8 破坏「读不出来不许画 00:00」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['duration-absent-drawn-as-zero']],
    ['I9 破坏「播放模式拒而不夹」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['mode-silently-clamped']],
    ['I10 破坏「游标越界一律拒」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['seek-oor-lost']],
    ['I11 破坏「绕回要留痕」⇒ 内核判据必须转红', 'q11', 'data', dataProblems, ['cursor-wrap-unreported']],
    ['I12 破坏「来源读不出来单列一形」⇒ 内核判据必须转红', 'q12', 'data', dataProblems, ['health-absent-lost']],
    ['I13 破坏「偏好项的冷却状态一起画」⇒ 内核判据必须转红', 'q13', 'data', dataProblems,
        ['source-cooling-hidden', 'source-preferred-lost']],
    ['I14 破坏「把握分带为什么」⇒ 内核判据必须转红', 'q14', 'data', dataProblems, ['score-why-lost']],
    ['I15 破坏「裸数组回执要认」⇒ 内核判据必须转红', 'q15', 'data', dataProblems, ['bare-array-rejected']],
    ['I16 破坏「读数不编 0」⇒ 内核判据必须转红', 'q16', 'data', dataProblems, ['covers-faked-zero']],
    ['I17 破坏「面四态不许塔平」⇒ 内核判据必须转红', 'q17', 'data', dataProblems, ['face-states-collapsed']],
    ['I18 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q18', 'appmod', appFaceProblems,
        ['storage-absent-lost', 'projection-not-null-on-absent', 'readings-not-null-on-absent']],
    ['I19 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appFaceProblems, ['malformed-face-lost']],
    ['I20 破坏「逐曲行的时长判定」（App）⇒ 行为判据必须转红', 'q20', 'appmod', appContentProblems,
        ['song-duration-always-unknown', 'song-duration-text-lost']],
    ['I21 破坏「保留数取值门」（App）⇒ 行为判据必须转红', 'q21', 'appmod', appGateProblems,
        ['queue-keep-fallback-lost', 'ledger-keep-fallback-lost']],
    ['I22 破坏「裁台账自带下界」（App）⇒ 行为判据必须转红', 'q22', 'appmod', appGateProblems, ['trim-ledger-lower-bound-lost']],
    ['I23 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q23', 'appmod', appChatProblems,
        ['chat-change-no-library-reload', 'chat-change-no-ledger-reload', 'chat-change-no-source-reload']],
    ['I24 破坏「失败不许动现有曲库」（App）⇒ 行为判据必须转红', 'q24', 'appmod', appContentProblems, ['failed-ingest-wiped-library']],
    ['I25 破坏「来源记不上要拒」（App）⇒ 行为判据必须转红', 'q25', 'appmod', appGateProblems, ['no-source-saw-lost']],
    ['I26 破坏「封面读数整格 null」（App）⇒ 行为判据必须转红', 'q26', 'appmod', appFaceProblems, ['covers-not-null-on-absent']],
    ['I27 破坏「六因必须是键」（数据层结构面）⇒ 结构判据必须转红', 'q27', 'src', dataKeyProblems, ['reply-why-not-key']],
    ['I28 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q28', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I29 破坏「点卡片向上找祖先」（视图）⇒ 视图判据必须转红', 'q29', 'src', viewClimbProblems, ['card-climb-lost', 'card-climb-order-lost']],
    ['I30 破坏「空与坏不同形」（视图）⇒ 视图判据必须转红', 'q30', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I31 破坏「封面读数整格没有要单列」（视图）⇒ 视图判据必须转红', 'q31', 'src', viewCountProblems, ['cover-readout-absent-collapsed']],
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
    for (const rel of [MD_DATA, MD_APP, MD_VIEW]) {
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3420k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [MD_DATA, MD_APP, MD_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J4 十道静态门必须在场（含本版缺陷所属的那几道）', () => {
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
    assert.deepEqual(viewFaceProblems(read(MD_VIEW)), []);
    assert.deepEqual(viewClimbProblems(read(MD_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(MD_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(MD_DATA)), []);
});

/* ====================== K - 版本与交棒 ====================== */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 42),
        '本套件成立于 RubyPhone 3.42.0 及以后，当前 ' + man.version);
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
    const own = (log.versions['3.42.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('曲库案头'), 'v3.42.0 条目必须自述本件名');
    assert.ok(text.includes('xiaoshuji'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
    assert.ok(text.includes('natease') || text.includes('netease'), '交棒必须指向小鼠机 netease 一族的处置');
    assert.ok(text.includes('desktop'), '交棒必须写明 desktop 一族的重判结论');
});