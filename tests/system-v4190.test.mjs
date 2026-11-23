// SYS-V4190 三件大件的「可纯化部分」抽取验收（undercover 规则 / bilibili 换算 / music 歌词与播放模式）
// 为什么只抽一部分：三件的源都是 700~1500 行的类，类里绝大多数方法在动 this.state
//   （发牌 / 投票结算 / 弹幕拉取 / 播放队列 / fetch 音乐源），那是有副作用的编排，
//   不能也不该在本仓的「纯函数内核 + 控制器 + 视图」四件套纪律下整只搬过来。
//   判据因此只审两件事：抽出来的内核是不是**真的纯**，以及接线是不是**真的接上**。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 r25_o3 / r27_o1 / v4186 / v4187 / v4188 / v4189 同一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);

const UC = await import('../apps/games/undercover/undercover-rules.js');
const BF = await import('../apps/bilibili/bili-format.js');
const MC = await import('../apps/music/music-core.js');

const UC_SRC = 'apps/games/undercover/undercover-data.js';
const BF_SRC = 'apps/bilibili/bili-data.js';
const MC_SRC = 'apps/music/music-data.js';

/* 判据用的确定性随机源：同一序列 => 同一局。 */
const seqRng = (xs) => { let i = 0; return () => xs[(i++) % xs.length]; };

const seats = () => ([
    { id: 'c1', name: '阿澈', isUser: true },
    { id: 'c2', name: '小满' },
    { id: 'c3', name: '老周' },
    { id: 'c4', name: '林一' },
    { id: 'c5', name: '阿远' },
    { id: 'c6', name: '木木' }
]);

/* ══════════ A 组 · 三个内核的纯度 ══════════ */
test('A1 undercover 内核：座位 / 卧底挑选可复现，rng 由调用方给', () => {
    const humans = [{ id: 'u1', name: '阿澈', isUser: true }, { id: 'c2', name: '小满' }];
    const s1 = UC.seatPlayers(humans, [3, 5, 1, 2, 4, 6]);
    const s2 = UC.seatPlayers(humans, [3, 5, 1, 2, 4, 6]);
    assert.deepEqual(s1.players, s2.players, '同一座位表必须坐出同一桌');
    assert.equal(s1.players.length, UC.PLAYER_COUNT);
    assert.equal(s1.players[2].id, 'u1', '用户坐第 3 个座位');
    assert.equal(s1.players[2].isUser, true);
    assert.equal(UC.pickUndercoverSeat(seqRng([0.5])), 4);
    assert.equal(UC.pickUndercoverSeat(seqRng([0.5])), UC.pickUndercoverSeat(seqRng([0.5])), '同一个 rng 序列挑同一个卧底');
    const a1 = UC.buildAiProfiles(3, [], []);
    assert.equal(a1.length, 3, '补 AI 人设补到 3 个');
    const sh1 = UC.shuffle([1, 2, 3, 4, 5, 6], seqRng([0.11, 0.42, 0.77, 0.03, 0.66, 0.91]));
    const sh2 = UC.shuffle([1, 2, 3, 4, 5, 6], seqRng([0.11, 0.42, 0.77, 0.03, 0.66, 0.91]));
    assert.deepEqual(sh1, sh2, '同一个 rng 序列洗出同一副');
    const src = [1, 2, 3];
    UC.shuffle(src, seqRng([0.5]));
    assert.deepEqual(src, [1, 2, 3], 'shuffle 不许改入参');
});

test('A2 内核绝不自己造随机 / 自己读时钟（源码与行为两头钉）', () => {
    for (const f of ['apps/games/undercover/undercover-rules.js', 'apps/bilibili/bili-format.js', 'apps/music/music-core.js']) {
        const s = read(f);
        assert.equal(s.indexOf('Math.random'), -1, f + ' 不许自己取随机源');
        assert.equal(s.indexOf('Date.now'), -1, f + ' 不许自己读系统时钟');
        for (const bad of ['localStorage', 'sessionStorage', 'window.', 'document.', 'fetch(', 'new Audio', 'XMLHttpRequest']) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.equal(s.indexOf('class '), -1, f + ' 内核不许有类');
    }
    /* 行为面：bili 的 timeAgo 同一个 ts 配不同 nowMs 必须给不同文案（说明 now 真由外部给）。 */
    const ts = 1763808000000 - 3 * 3600 * 1000;
    assert.equal(BF.timeAgo(ts, 1763808000000), '3小时前');
    assert.notEqual(BF.timeAgo(ts, 1763808000000), BF.timeAgo(ts, 1763808000000 - 40 * 24 * 3600 * 1000));
    assert.equal(BF.wallStampText(ts, 1763808000000), '今天 07:40', '固定时刻必须给固定墙钟文案');
});

test('A3 undercover 票型：平票无人出局 / 最高票唯一才出局 / 卧底全灭好人胜', () => {
    const players = seats().map((p, i) => ({ ...p, seat: i + 1, alive: true }));
    players[0].role = 'civilian'; players[1].role = 'civilian'; players[2].role = 'civilian';
    players[3].role = 'civilian'; players[4].role = 'civilian'; players[5].role = 'undercover';
    const game = { players, round: 1 };
    const tie = UC.resolveVotes(game, [
        { voterSeat: 1, targetSeat: 2 }, { voterSeat: 2, targetSeat: 1 },
        { voterSeat: 3, targetSeat: 4 }, { voterSeat: 4, targetSeat: 3 },
        { voterSeat: 5, targetSeat: 6 }
    ], null);
    assert.equal(tie.eliminatedSeat, 0, '平票不得出任何人');
    const solo = UC.resolveVotes(game, [
        { voterSeat: 1, targetSeat: 6 }, { voterSeat: 2, targetSeat: 6 },
        { voterSeat: 3, targetSeat: 6 }, { voterSeat: 4, targetSeat: 5 }, { voterSeat: 5, targetSeat: 5 }
    ], null);
    assert.equal(solo.eliminatedSeat, 6, '最高票唯一才出局');
    assert.equal(solo.winner, 'civilian', '卧底全灭好人胜');
    const p = players.map((x, i) => (i === 5 ? { ...x, role: 'undercover' } : { ...x, role: 'civilian' }));
    /* 只剩 2 个卧底活着（其余已死）：卧底胜。 */
    const wolfWin = p.slice(0, 2).map((x) => ({ ...x, role: 'undercover' }))
        .concat(p.slice(2).map((x) => ({ ...x, alive: false })));
    const w = UC.resolveVotes({ players: wolfWin, round: 1 }, [], null);
    assert.equal(w.winner, 'undercover', '卧底还在且活人 <= 2，卧底胜');
    /* 卧底被投掉后：5 个平民活着，好人胜。 */
    const civilianWin = p.map((x) => ({ ...x, role: 'civilian' }));
    const cw = UC.resolveVotes({ players: civilianWin, round: 1 }, [], null);
    assert.equal(cw.winner, 'civilian', '没有卧底就平民胜');
});

test('A4 词对归一：坏词对拒答，同一词对同一结果', () => {
    const a = UC.normalizeWordPair({ civilian: '面馆', undercover: '拉面' });
    assert.equal(a.ok, true);
    assert.equal(a.civilian, '面馆');
    assert.equal(a.undercover, '拉面');
    assert.equal(a.fromFallback, false, '用户给的词不算兜底');
    assert.equal(UC.normalizeWordPair({ civilian: '面馆', undercover: '面馆' }).fromFallback, true, '两边一样必须落到兜底池');
    assert.equal(UC.normalizeWordPair(null).ok, true, '坏的也给一对能用的');
    const h1 = UC.normalizeWordHistory([{ civilian: '面馆', undercover: '拉面' }, { civilian: '拉面', undercover: '面馆' }, { civilian: '火锅', undercover: '麻辣烫' }]);
    assert.equal(h1.length, 3, '历史按条目留，不去重条目');
    assert.deepEqual(h1[0], { civilian: '面馆', undercover: '拉面' });
    const h2 = UC.normalizeWordHistory([{ civilian: '面馆', undercover: '' }, null, '坏条目']);
    assert.deepEqual(h2, [], '坏条目与空词一律丢');
});

test('A5 发言切分与下一发言者：环形找未发言人，全员说完转投票', () => {
    const segs = UC.splitSpeechSegments('我觉得他是卧底，因为他不说话');
    assert.ok(Array.isArray(segs) && segs.length >= 1);
    const players = seats().map((p, i) => ({ ...p, seat: i + 1, alive: true, spoken: i < 5 }));
    const next = UC.nextSpeaker({ players, roundSpokenSeats: [1, 2, 3, 4, 5], currentSpeakerSeat: 5 });
    assert.equal(next.currentSpeakerSeat, 6, '第 6 人还没说');
    const done = UC.nextSpeaker({ players, roundSpokenSeats: [1, 2, 3, 4, 5, 6], currentSpeakerSeat: 6 });
    assert.equal(done.phase, 'voting', '全员说完转投票');
});

test('A6 bili 换算：计数 / 时长 / 时间 / 标识往返一致，时间由调用方给', () => {
    assert.equal(BF.fmtCount(BF.parseCount('12.8万')), '12.8万');
    assert.equal(BF.parseCount('12.8万'), 128000);
    assert.equal(BF.fmtDur(BF.parseDur('12:34')), '12:34');
    assert.equal(BF.parseDur('12:34'), 754);
    assert.equal(BF.timeAgo(1763808000000 - 3 * 3600 * 1000, 1763808000000).indexOf('3'), 0);
    const bvid = BF.makeBvid('凌晨的面馆');
    assert.equal(bvid, BF.makeBvid('凌晨的面馆'), '同一个种子永远同一个 BV 号');
    assert.ok(bvid.indexOf('BV1') === 0, 'BV 号形如 BV1...');
    const mid = BF.makeMid('凌晨的面馆');
    assert.ok(Number(mid) > 0, 'UID 是正整数');
    assert.equal(BF.seededInt('x', 120, 1500), BF.seededInt('x', 120, 1500), '同种子同结果');
    assert.ok(BF.isBilibiliEntryUrl('https://www.bilibili.com/video/BV1xx411c7mD'));
    assert.equal(BF.isBilibiliEntryUrl('https://example.com'), false);
});

test('A7 music 内核：LRC 解析多时间戳成条 / 元数据行剔除 / 坏档不抛', () => {
    const lines = MC.parseLrc('[00:00.00]第一句' + NL + '[00:12.50][01:30.00]副歌' + NL + '[ar: someone]');
    assert.equal(lines.length, 3, '两行出三条');
    assert.equal(lines[0].t, 0);
    assert.equal(lines[1].t, 12.5);
    assert.equal(lines[2].t, 90);
    assert.deepEqual(MC.parseLrc(null), []);
    assert.deepEqual(MC.parseLrc('没有时间戳的行'), []);
    assert.equal(MC.currentLyricIndex(lines, 20), 1);
    assert.equal(MC.currentLyricIndex(lines, 0), 0);
    assert.equal(MC.currentLyricIndex([], 10), -1);
    assert.equal(MC.hasLyrics(lines), true);
    assert.equal(MC.hasLyrics([]), false);
});

test('A8 music 播放模式闭环：once -> repeat-one -> repeat-all -> once，认不出归 once', () => {
    assert.equal(MC.nextPlaybackMode('once'), 'repeat-one');
    assert.equal(MC.nextPlaybackMode('repeat-one'), 'repeat-all');
    assert.equal(MC.nextPlaybackMode('repeat-all'), 'once');
    assert.equal(MC.nextPlaybackMode('鬼知道是什么'), 'repeat-one', '认不出先归 once 再推进一步');
    assert.equal(MC.shouldLoop('repeat-one'), true);
    assert.equal(MC.shouldLoop('repeat-all'), false);
    assert.equal(MC.modeFromRepeatOne(true), 'repeat-one');
    assert.equal(MC.modeFromRepeatOne('true'), 'repeat-one');
    assert.equal(MC.modeFromRepeatOne(false), 'repeat-all');
});

/* ══════════ B 组 · 源类仍是类、仍是 this.state（抽的是副本不是改写） ══════════ */
test('B1 三个源文件仍是「类 + 自持状态」，只把纯逻辑面转调内核', () => {
    const uc = read(UC_SRC);
    assert.ok(uc.indexOf('class UndercoverData') > 0, 'undercover 源类必须还在');
    assert.ok(uc.indexOf('this.state') > 0, 'undercover 源类必须仍持 state');
    const bf = read(BF_SRC);
    assert.ok(bf.indexOf('class BiliData') > 0, 'bili 源类必须还在');
    assert.ok(bf.indexOf('this.storageKey') > 0, 'bili 源类必须仍自持状态');
    assert.ok(bf.indexOf("export { isBilibiliEntryUrl } from './bili-format.js';") > 0, '旧导出名必须转发到内核');
    assert.equal(bf.indexOf('export function isBilibiliEntryUrl('), -1, '不许再留一份本地实现');
    const mc = read(MC_SRC);
    assert.ok(mc.indexOf('class MusicData') > 0, 'music 源类必须还在');
    assert.ok(mc.indexOf('this._playlist') > 0, 'music 源类必须仍自持歌单');
    assert.ok(mc.indexOf('new Audio()') > 0, 'music 源类构造器的 Audio 不许被搬走');
});

test('B2 三个源文件都真的调了内核，不是复制一份留着', () => {
    const bf = read(BF_SRC);
    for (const k of ['fmtHash32', 'makeBvid', 'makeMid', 'parseCount', 'parseDur', 'fmtDur', 'wallStampText', 'compactText', 'seededInt']) {
        assert.ok(bf.indexOf(k) > 0, BF_SRC + ' 必须引用内核符号 ' + k);
    }
    const mc = read(MC_SRC);
    for (const k of ['normalizePlaybackMode', 'nextPlaybackMode', 'shouldLoop', 'modeFromRepeatOne', 'parseLrc']) {
        assert.ok(mc.indexOf(k) > 0, MC_SRC + ' 必须引用内核符号 ' + k);
    }
    assert.equal(mc.indexOf('const timeRegex'), -1, 'music 不许再留一份本地 LRC 正则');
    assert.ok(mc.indexOf('return parseLrc(text);') > 0, '_parseLrc 必须转调内核');
});

test('B3 负控制：票数真的决定出局（同款判据在唯一最高票下必须给出出局）', () => {
    const players = seats().map((p, i) => ({ ...p, seat: i + 1, alive: true }));
    players[5].role = 'undercover';
    const game = { players, round: 1 };
    const tie = UC.resolveVotes(game, [
        { voterSeat: 1, targetSeat: 2 }, { voterSeat: 2, targetSeat: 1 },
        { voterSeat: 3, targetSeat: 4 }, { voterSeat: 4, targetSeat: 3 },
        { voterSeat: 5, targetSeat: 6 }
    ], null);
    assert.equal(tie.eliminatedSeat, 0, '未破坏时平票不出局');
    const solo = UC.resolveVotes(game, [
        { voterSeat: 1, targetSeat: 6 }, { voterSeat: 2, targetSeat: 6 },
        { voterSeat: 3, targetSeat: 6 }, { voterSeat: 4, targetSeat: 5 }, { voterSeat: 5, targetSeat: 5 }
    ], null);
    assert.equal(solo.eliminatedSeat, 6, '唯一最高票必须出局：证明出不出局真由票数决定');
    assert.equal(UC.UC_REJECT.badState, 'bad_state', '拒绝原因必须是封闭词表');
        const bad = UC.resolveVotes(null, [], null);
    assert.equal(bad.ok, false, '没有对局必须拒答而不是崩');
    assert.equal(bad.reason, UC.UC_REJECT.badState);
});

/* ══════════ C 组 · 三个控制器 ══════════ */
test('C1 三个控制器都走 writeReceipt，且不许绕开它直写', () => {
    for (const f of [
        'apps/games/undercover/undercover-rules-app.js',
        'apps/bilibili/bili-format-app.js',
        'apps/music/music-core-app.js'
    ]) {
        const s = read(f);
        assert.ok(s.indexOf('writeReceipt') > 0, f + ' 必须走唯一回执实现');
        assert.equal(s.indexOf('storage.set('), -1, f + ' 不许绕开 writeReceipt 直写');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest', 'requestAnimationFrame']) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.ok(s.indexOf('_readSnapshot') > 0 && s.indexOf('_saveSnapshot') > 0, f + ' 必须有快照读写');
    }
});

test('C2 三个控制器的会话键都命中登记与存储前缀', () => {
    const a = read('apps/games/undercover/undercover-rules-app.js');
    assert.ok(a.indexOf("STATE_KEY = 'games_uc_rules_v1'") > 0);
    const b = read('apps/bilibili/bili-format-app.js');
    assert.ok(b.indexOf("STATE_KEY = 'bili_format_v1'") > 0);
    assert.ok(b.indexOf('DEMO_NOW') > 0, 'bili 控制器必须给固定时刻，内核不许自己取时间');
    const m = read('apps/music/music-core-app.js');
    assert.ok(m.indexOf("STATE_KEY = 'music_core_v1'") > 0);
    const storage = read('config/storage.js');
    for (const p of ['/^games_uc_rules_/', '/^bili_format_/', '/^music_core_/']) {
        assert.ok(storage.indexOf(p) > 0, '会话前缀缺 ' + p);
    }
    const keys = read('scripts/keys-audit.mjs');
    for (const k of ['games_uc_rules_v1', 'bili_format_v1', 'music_core_v1']) {
        assert.ok(keys.indexOf(k) > 0, '键未登记：' + k);
    }
});

/* ══════════ D 组 · 三个视图 ══════════ */
test('D1 三个视图：根容器监听去重 + CSS 自注入 + 零定时器零网络', () => {
    for (const f of [
        'apps/games/undercover/undercover-rules-view.js',
        'apps/bilibili/bili-format-view.js',
        'apps/music/music-core-view.js'
    ]) {
        const v = read(f);
        assert.ok(v.indexOf('_boundRoot === root') > 0, f + ' 根容器监听必须去重');
        assert.ok(v.indexOf('-css') > 0, f + ' CSS 必须自注入');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest']) {
            assert.equal(v.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.equal(v.indexOf('.phone-screen'), -1, f + ' 不许直接写外壳 screen');
    }
});

test('D2 三个视图的按钮都真被绑定（data-act 委派有落点）', () => {
    const v = read('apps/games/undercover/undercover-rules-view.js');
    assert.ok(v.indexOf('data-act') > 0 && v.indexOf('_bind(root)') > 0, 'undercover 视图必须委派');
    const b = read('apps/bilibili/bili-format-view.js');
    for (const act of ['count', 'dur', 'ago', 'id']) {
        assert.ok(b.indexOf('data-act="' + act + '"') > 0, 'bili 视图缺按钮 ' + act);
        assert.ok(b.indexOf("act === '" + act + "'") > 0, 'bili 视图缺分支 ' + act);
    }
    const m = read('apps/music/music-core-view.js');
    for (const act of ['lrc', 'cycle', 'seek30', 'seek65']) {
        assert.ok(m.indexOf('data-act="' + act + '"') > 0, 'music 视图缺按钮 ' + act);
        assert.ok(m.indexOf("act === '" + act + "'") > 0, 'music 视图缺分支 ' + act);
    }
});

test('D3 三个样式只挂自己的根类，不碰外壳', () => {
    for (const f of ['apps/games/undercover/undercover-rules.css', 'apps/bilibili/bili-format.css', 'apps/music/music-core.css']) {
        const s = read(f);
        assert.equal(s.indexOf('.phone-screen'), -1, f + ' 不许碰外壳');
        assert.ok(s.indexOf('max-width: 340px') > 0, f + ' 必须有窄屏兜底');
    }
    assert.ok(read('apps/games/undercover/undercover-rules.css').indexOf('.uc-root') > 0);
    assert.ok(read('apps/bilibili/bili-format.css').indexOf('.bf-root') > 0);
    assert.ok(read('apps/music/music-core.css').indexOf('.mc-root') > 0);
});

/* ══════════ E 组 · 五处接线 ══════════ */
test('E1 三件的五处接线都在（注册 / 懒加载 / 存储前缀 / 键登记 / 重绑表）', () => {
    const apps = read('config/apps.js');
    for (const id of ['ucrules', 'bilifmt', 'musiccore']) {
        assert.ok(apps.indexOf("id: '" + id + "'") > 0, 'apps.js 缺 ' + id);
    }
    const routes = read('config/app-lazy-routes.js');
    for (const k of ['ucRulesApp', 'biliFmtApp', 'musicCoreApp']) {
        assert.ok(routes.indexOf('"' + k + '"') > 0, '懒加载表缺 ' + k);
    }
    const index = read('index.js');
    for (const k of ['ucRulesApp', 'biliFmtApp', 'musicCoreApp']) {
        assert.ok(index.indexOf("'" + k + "'") > 0, '重绑表缺 ' + k);
    }
});

test('E2 三个懒加载模块路径真能解析到盘上文件', () => {
    const routes = read('config/app-lazy-routes.js');
    for (const m of [
        './apps/games/undercover/undercover-rules-app.js',
        './apps/bilibili/bili-format-app.js',
        './apps/music/music-core-app.js'
    ]) {
        assert.ok(routes.indexOf('"' + m + '"') > 0, '懒加载表缺 ' + m);
        assert.ok(fs.existsSync(path.join(ROOT, m.slice(2))), m + ' 必须真在盘上');
    }
});

/* ══════════ V 版本锚 ══════════ */
test('V1 版本锚：4.190.0 已进版本史（下限形，跟随当前版）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    assert.equal(man.version, pkg.version, '五源同源：package.json 与 manifest.json 必须同版本');
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, pkg.version, '五源同源：update-log latest 必须等于当前版本');
    assert.equal(log.head, pkg.version, '五源同源：update-log head 必须等于当前版本');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, '4.190.0'), '4.190.0 必须已进版本史');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + pkg.version + "';") > 0, 'index.js 版本常量必须跟着抬版');
});