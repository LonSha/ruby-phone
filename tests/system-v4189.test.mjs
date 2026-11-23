// SYS-V4189 两件大件的「可纯化部分」抽取验收（poker 牌型评估 / werewolf 规则判定）
// 为什么只抽一部分：两件的源都是 1000+ 行的类，类里绝大多数方法在动 this.state
//   （下注轮 / 盲注 / AI / 侧池 / 夜晚结算 / _persist），那是有副作用的编排，
//   不能也不该在本仓的「纯函数内核 + 控制器 + 视图」四件套纪律下整只搬过来。
//   判据因此只审两件事：抽出来的内核是不是**真的纯**，以及接线是不是**真的接上**。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 r25_o3 / r27_o1 / v4186 / v4187 / v4188 同一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NL = String.fromCharCode(10);
const POKER = await import('../apps/games/poker/poker-eval.js');
const WW = await import('../apps/games/werewolf/werewolf-rules.js');

const C = (suit, value, label) => ({ suit, value, label });
const spade = (v, l) => C('spades', v, l);
const heart = (v, l) => C('hearts', v, l);

/* ══════════ A 组 · poker 内核 ══════════ */
test('A1 牌型评估：同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条', () => {
    const sf = [spade(10, '10'), spade(11, 'J'), spade(12, 'Q'), spade(13, 'K'), spade(14, 'A')];
    const quads = [spade(9, '9'), heart(9, '9'), C('diamonds', 9, '9'), C('clubs', 9, '9'), spade(2, '2')];
    const boat = [spade(8, '8'), heart(8, '8'), C('diamonds', 8, '8'), spade(3, '3'), heart(3, '3')];
    const flush = [spade(2, '2'), spade(4, '4'), spade(6, '6'), spade(8, '8'), spade(10, '10')];
    const straight = [spade(5, '5'), heart(6, '6'), C('diamonds', 7, '7'), C('clubs', 8, '8'), spade(9, '9')];
    const trips = [spade(7, '7'), heart(7, '7'), C('diamonds', 7, '7'), spade(4, '4'), heart(2, '2')];
    assert.equal(POKER.evaluateBestHand(sf).score, POKER.HAND_SCORES.straightFlush);
    assert.equal(POKER.evaluateBestHand(quads).score, POKER.HAND_SCORES.fourOfAKind);
    assert.equal(POKER.evaluateBestHand(boat).score, POKER.HAND_SCORES.fullHouse);
    assert.equal(POKER.evaluateBestHand(flush).score, POKER.HAND_SCORES.flush);
    assert.equal(POKER.evaluateBestHand(straight).score, POKER.HAND_SCORES.straight);
    assert.equal(POKER.evaluateBestHand(trips).score, POKER.HAND_SCORES.threeOfAKind);
    assert.ok(POKER.compareHands(POKER.evaluateBestHand(sf), POKER.evaluateBestHand(quads)) > 0);
    assert.ok(POKER.compareHands(POKER.evaluateBestHand(quads), POKER.evaluateBestHand(boat)) > 0);
    assert.ok(POKER.compareHands(POKER.evaluateBestHand(boat), POKER.evaluateBestHand(flush)) > 0);
    assert.ok(POKER.compareHands(POKER.evaluateBestHand(flush), POKER.evaluateBestHand(straight)) > 0);
    assert.ok(POKER.compareHands(POKER.evaluateBestHand(straight), POKER.evaluateBestHand(trips)) > 0);
});

test('A2 A 既能当 14 也能当 1：A-K-Q-J-10 是高 A 的顺子，A-2-3-4-5 是高 5', () => {
    const wheel = [spade(14, 'A'), heart(2, '2'), C('diamonds', 3, '3'), C('clubs', 4, '4'), spade(5, '5')];
    const broadway = [spade(14, 'A'), spade(13, 'K'), spade(12, 'Q'), spade(11, 'J'), spade(10, '10')];
    assert.equal(POKER.evaluateBestHand(wheel).ranks[0], 5, '轮子顺的最高张是 5，不是 14');
    assert.equal(POKER.evaluateBestHand(broadway).ranks[0], 14);
    assert.equal(POKER.evaluateBestHand(wheel).label.indexOf('5') >= 0, true);
});

test('A3 少于五张拒答，不当默认值用', () => {
    assert.equal(POKER.evaluateBestHand(null), null);
    assert.equal(POKER.evaluateBestHand([]), null);
    assert.equal(POKER.evaluateBestHand([spade(2, '2'), spade(3, '3'), spade(4, '4'), spade(5, '5')]), null);
    assert.equal(POKER.rankFive([spade(2, '2')]), null, 'rankFive 只吃正好五张');
});

test('A4 六/七张取最优，且不改入参', () => {
    const seven = [
        spade(14, 'A'), heart(14, 'A'), C('diamonds', 14, 'A'), C('clubs', 14, 'A'),
        spade(13, 'K'), heart(13, 'K'), spade(2, '2')
    ];
    const before = JSON.stringify(seven);
    const r = POKER.evaluateBestHand(seven);
    assert.equal(r.score, POKER.HAND_SCORES.fourOfAKind, '七张里应挑出四条 A');
    assert.equal(JSON.stringify(seven), before, '评估不许把用户选的牌改掉');
});

test('A5 drawCards 不改入参，返回 drawn + rest 两份', () => {
    const deck = POKER.createDeck();
    assert.equal(deck.length, 52);
    const ids = new Set(deck.map((c) => c.suit + c.value));
    assert.equal(ids.size, 52, '一副牌 52 张不重不漏');
    const before = JSON.stringify(deck);
    const r = POKER.drawCards(deck, 2);
    assert.equal(r.drawn.length, 2);
    assert.equal(r.rest.length, 50);
    assert.equal(JSON.stringify(deck), before, '抽牌不许把牌堆掏空');
    const over = POKER.drawCards(deck, 999);
    assert.equal(over.drawn.length, 52);
    assert.equal(over.rest.length, 0);
});

test('A6 洗牌可复现：同一副 + 同一个 rng 序列 => 同一个结果', () => {
    const deck = POKER.createDeck();
    let seed = 7;
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const a = POKER.shuffleDeck(deck, rng);
    seed = 7;
    const b = POKER.shuffleDeck(deck, rng);
    assert.equal(JSON.stringify(a), JSON.stringify(b), '同一个 rng 必须洗出同一副');
    assert.equal(a.length, 52);
    assert.equal(JSON.stringify(deck), JSON.stringify(POKER.createDeck()), '洗牌不许改原牌堆');
});

test('A7 负控制：把「少于五张拒答」改成兜一手高牌，A3 必须转红', async () => {
    const src = read('apps/games/poker/poker-eval.js');
    const needle = 'if (!Array.isArray(cards) || cards.length < EVAL_LIMITS.handSize) return null;';
    const i = src.indexOf(needle);
    assert.ok(i > 0, '找不到牌数校验就该红');
    const broken = src.slice(0, i)
        + "if (!Array.isArray(cards) || cards.length < EVAL_LIMITS.handSize) return rankFive([{suit:'spades',value:2,label:'2'},{suit:'hearts',value:3,label:'3'},{suit:'diamonds',value:4,label:'4'},{suit:'clubs',value:5,label:'5'},{suit:'spades',value:6,label:'6'}]);"
        + src.slice(i + needle.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-c-'));
    const f = path.join(dir, 'poker-eval-broken.mjs');
    fs.writeFileSync(f, broken, 'utf8');
    try {
        const B = await import(pathToFileURL(f).href);
        assert.notEqual(B.evaluateBestHand([]), null, '兜了默认就会给四张以下的牌也算出牌型 —— A3 正是在拦这个');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ══════════ B 组 · werewolf 内核 ══════════ */
test('B1 身份分配：8 人才发得动，人数不对就拒', () => {
    const ok = WW.assignRoles(8, () => 0);
    assert.equal(ok.ok, true);
    assert.equal(ok.roles.length, 8);
    assert.equal(ok.roles.filter((r) => r === '狼人').length, 2, '8 人局固定 2 狼');
    assert.equal(ok.roles.filter((r) => r === '村民').length, 3);
    const bad = WW.assignRoles(6, () => 0);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, WW.WW_REJECT.notEnoughPlayers);
    assert.deepEqual(bad.roles, [], '拒了就不许发半副身份');
    const same1 = WW.assignRoles(8, () => 0.5);
    const same2 = WW.assignRoles(8, () => 0.5);
    assert.deepEqual(same1.roles, same2.roles, '同一个 rng 必须分出同一副');
});

test('B2 夜晚步骤封闭：认不出就拒，推进到尾返回 done', () => {
    assert.equal(WW.advanceNightStep('guard').next, 'werewolf');
    assert.equal(WW.advanceNightStep('witch').done, true);
    assert.equal(WW.advanceNightStep('witch').next, null);
    const bad = WW.advanceNightStep('noon');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, WW.WW_REJECT.unknownStep);
    assert.equal(WW.roleForStep('guard').role, '守卫');
    assert.equal(WW.roleForStep('seer').role, '预言家');
    assert.equal(WW.roleForStep('noon').ok, false);
    assert.equal(WW.nightStepOf('werewolf'), 'werewolf');
    assert.equal(WW.nightStepOf(42), null);
});

test('B3 胜负：狼全灭好人胜 / 狼数>=非狼数狼人胜 / 否则未分', () => {
    const players = [
        { seat: 1, role: '狼人', alive: true },
        { seat: 2, role: '狼人', alive: true },
        { seat: 3, role: '预言家', alive: true },
        { seat: 4, role: '村民', alive: true },
        { seat: 5, role: '村民', alive: true }
    ];
    const going = WW.checkWinCondition(players);
    assert.equal(going.ok, true);
    assert.equal(going.winner, null, '2 狼 3 好，还没分');
    assert.equal(going.wolves, 2);
    assert.equal(going.nonWolves, 3);
    const good = players.map((p) => (p.role === '狼人' ? Object.assign({}, p, { alive: false }) : p));
    assert.equal(WW.checkWinCondition(good).winner, 'good');
    const wolves = players.filter((p) => p.seat !== 4 && p.seat !== 5);
    assert.equal(WW.checkWinCondition(wolves).winner, 'wolves', '2 狼 1 好就该狼胜');
    const edge = players.filter((p) => p.seat !== 5);
    assert.equal(WW.checkWinCondition(edge).winner, 'wolves', '2 狼 2 好，狼数>=非狼数即狼胜');
    assert.equal(WW.checkWinCondition([]).ok, false);
    assert.equal(WW.checkWinCondition([]).reason, WW.WW_REJECT.badState);
});

test('B4 揭示模式封闭词表：认不出就拒，不悄悄兜成 hidden', () => {
    assert.equal(WW.normalizeRevealMode('open'), 'open');
    assert.equal(WW.normalizeRevealMode('self'), 'self');
    assert.equal(WW.normalizeRevealMode('hidden'), 'hidden');
    assert.equal(WW.normalizeRevealMode('all'), null);
    assert.equal(WW.normalizeRevealMode(7), null);
    assert.equal(WW.normalizeRevealMode(''), null);
});

test('B5 女巫药水只认 antidote / poison，别的拒', () => {
    assert.equal(WW.normalizePotion({ usePotion: 'antidote' }).potion, 'antidote');
    assert.equal(WW.normalizePotion({ usePotion: 'poison' }).potion, 'poison');
    assert.equal(WW.normalizePotion({ usePotion: '' }).potion, '');
    const bad = WW.normalizePotion({ usePotion: '解药' });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, WW.WW_REJECT.unknownStep);
    assert.equal(WW.normalizePotion(null).ok, true);
});

test('B6 状态自检：必须有且只有一个用户，身份都得出自池子', () => {
    const good = {
        players: [
            { seat: 1, role: '狼人', isUser: true },
            { seat: 2, role: '预言家' },
            { seat: 3, role: '村民' }
        ]
    };
    assert.equal(WW.isValidState(good).ok, true);
    const none = { players: [{ seat: 1, role: '狼人' }, { seat: 2, role: '村民' }] };
    assert.equal(WW.isValidState(none).ok, false, '没有用户就该红');
    const two = { players: [{ seat: 1, isUser: true }, { seat: 2, isUser: true }] };
    assert.equal(WW.isValidState(two).ok, false, '两个用户也该红');
    const stray = { players: [{ seat: 1, role: '狼人', isUser: true }, { seat: 2, role: '村长' }] };
    assert.equal(WW.isValidState(stray).ok, false, '池外身份该红');
    assert.equal(WW.isValidState(null).ok, false);
});

test('B7 座位读数：环形找活人 / 最后一个活人 / 是不是用户', () => {
    const players = [
        { seat: 1, role: '狼人', alive: false, isUser: true },
        { seat: 2, role: '村民', alive: true },
        { seat: 3, role: '村民', alive: false },
        { seat: 4, role: '村民', alive: true }
    ];
    assert.equal(WW.alivePlayers(players).length, 2);
    assert.equal(WW.aliveWolves(players).length, 0);
    assert.equal(WW.aliveNonWolves(players).length, 2);
    assert.equal(WW.firstAliveSeatFrom(players, 3), 4, '从 3 起找，跳过死的 3，落到 4');
    assert.equal(WW.firstAliveSeatFrom(players, 5), 2, '绕回表头');
    assert.equal(WW.lastAliveSeat(players), 4);
    assert.equal(WW.isUserSeat(players, 1), true);
    assert.equal(WW.isUserSeat(players, 2), false);
    assert.equal(WW.firstAliveSeatFrom([], 1), null);
    assert.equal(WW.lastAliveSeat([]), null);
});

test('B8 负控制：把揭示模式兜底改回来，B4 必须转红', async () => {
    const src = read('apps/games/werewolf/werewolf-rules.js');
    const needle = "    return REVEAL_MODES.indexOf(mode) >= 0 ? mode : null;";
    const i = src.indexOf(needle);
    assert.ok(i > 0, '找不到揭示模式归一就该红');
    const broken = src.slice(0, i) + "    return REVEAL_MODES.indexOf(mode) >= 0 ? mode : 'hidden';" + src.slice(i + needle.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-c-'));
    const f = path.join(dir, 'werewolf-rules-broken.mjs');
    fs.writeFileSync(f, broken, 'utf8');
    try {
        const B = await import(pathToFileURL(f).href);
        assert.equal(B.normalizeRevealMode('all'), 'hidden', '兜了默认就会把认不出的模式放进来 —— B4 正是在拦这个');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ══════════ C 组 · 源库不动（只抽，不重写整只类） ══════════ */
test('C1 源类一行没动：抽的是副本，不是改写', () => {
    for (const f of ['apps/games/poker/poker-data.js', 'apps/games/werewolf/werewolf-data.js']) {
        const s = read(f);
        assert.ok(s.indexOf('class ') > 0, f + ' 应仍是那只类');
        assert.ok(s.indexOf('this.state') > 0, f + ' 的编排状态还在原处');
    }
    assert.equal(read('apps/games/poker/poker-eval.js').indexOf('class '), -1, '内核不许有类');
    assert.equal(read('apps/games/werewolf/werewolf-rules.js').indexOf('class '), -1, '内核不许有类');
});

test('C2 两个内核零存储 / 零 DOM / 零时间 / 零随机', () => {
    for (const f of ['apps/games/poker/poker-eval.js', 'apps/games/werewolf/werewolf-rules.js']) {
        const s = read(f);
        const codeLines = s.split(NL).filter((l) => {
            const t = l.trim();
            return t && t.indexOf('*') !== 0 && t.indexOf('/*') !== 0 && t.indexOf('//') !== 0;
        });
        const code = codeLines.join(NL);
        assert.equal(code.indexOf('Date.now'), -1, f + ' 的代码里不许自己取时间');
        assert.equal(code.indexOf('Math.random'), -1, f + ' 的代码里不许自己造随机');
        assert.equal(code.indexOf('localStorage'), -1, f + ' 不许碰存储');
        assert.equal(code.indexOf('document.'), -1, f + ' 不许碰 DOM');
        assert.equal(code.indexOf('window.'), -1, f + ' 不许挂全局');
        assert.equal(code.indexOf('storage.set('), -1, f + ' 不许直写存储');
    }
});

/* ══════════ E 组 · 接线 ══════════ */
test('E1 两件的五处接线都在', () => {
    const apps = read('config/apps.js');
    assert.ok(apps.indexOf("id: 'pokereval'") > 0, 'config/apps.js 缺 pokereval');
    assert.ok(apps.indexOf("id: 'wwrules'") > 0, 'config/apps.js 缺 wwrules');
    const routes = read('config/app-lazy-routes.js');
    for (const m of ['apps/games/poker/poker-eval-app.js', 'apps/games/werewolf/werewolf-rules-app.js']) {
        assert.ok(routes.indexOf(m) > 0, '懒加载路由缺 ' + m);
    }
    const storage = read('config/storage.js');
    for (const p of ['/^games_poker_eval_/', '/^games_ww_rules_/']) {
        assert.ok(storage.indexOf(p) > 0, '会话前缀缺 ' + p);
    }
    const keys = read('scripts/keys-audit.mjs');
    for (const k of ['games_poker_eval_v1', 'games_ww_rules_v1']) {
        assert.ok(keys.indexOf(k) > 0, '键未登记：' + k);
    }
    const index = read('index.js');
    for (const k of ['pokerEvalApp', 'wwRulesApp']) {
        assert.ok(index.indexOf("'" + k + "'") > 0, '重绑表缺 ' + k);
    }
});

test('E2 两个控制器都走 writeReceipt，且新键真被使用（keys-audit 不报红）', () => {
    for (const f of ['apps/games/poker/poker-eval-app.js', 'apps/games/werewolf/werewolf-rules-app.js']) {
        const s = read(f);
        assert.ok(s.indexOf('writeReceipt') > 0, f + ' 必须走唯一回执实现');
        assert.equal(s.indexOf('storage.set('), -1, f + ' 不许绕开 writeReceipt 直写');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest', 'requestAnimationFrame']) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.ok(s.indexOf('_readSnapshot') > 0 && s.indexOf('_saveSnapshot') > 0, f + ' 必须有快照读写');
    }
    const pa = read('apps/games/poker/poker-eval-app.js');
    assert.ok(pa.indexOf("STATE_KEY = 'games_poker_eval_v1'") > 0, 'poker 控制器键名对不上登记');
    const wa = read('apps/games/werewolf/werewolf-rules-app.js');
    assert.ok(wa.indexOf("STATE_KEY = 'games_ww_rules_v1'") > 0, 'werewolf 控制器键名对不上登记');
});

test('E3 两个视图：根容器监听去重 + CSS 自注入 + 零定时器零网络', () => {
    for (const f of ['apps/games/poker/poker-eval-view.js', 'apps/games/werewolf/werewolf-rules-view.js']) {
        const v = read(f);
        assert.ok(v.indexOf('_boundRoot === root') > 0, f + ' 根容器监听必须去重');
        assert.ok(v.indexOf('-css') > 0, f + ' CSS 必须自注入');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest']) {
            assert.equal(v.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
        assert.equal(v.indexOf('.phone-screen'), -1, f + ' 不许直接写外壳 screen');
    }
    for (const f of ['apps/games/poker/poker-eval.css', 'apps/games/werewolf/werewolf-rules.css']) {
        assert.ok(read(f).indexOf('.pe-root') > 0 || read(f).indexOf('.ww-root') > 0, f + ' 样式要挂在自己的根类上');
    }
});

/* ══════════ V 版本锚 ══════════ */
test('V1 版本锚：4.189.0 已进版本史（下限形，跟随当前版）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    assert.equal(man.version, pkg.version, '五源同源：package.json 与 manifest.json 必须同版本');
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, pkg.version, '五源同源：update-log latest 必须等于当前版本');
    assert.equal(log.head, pkg.version, '五源同源：update-log head 必须等于当前版本');
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, '4.189.0'), '4.189.0 必须已进版本史');
    assert.ok(read('index.js').indexOf("const ST_PHONE_VERSION = '" + pkg.version + "';") > 0, 'index.js 版本常量必须跟着抬版');
    assert.ok(read('ITERATION_LOG.md').indexOf('迭代 305') > 0, '迭代日志必须留下 4.189.0 那一次');
});
