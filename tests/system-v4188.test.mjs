// SYS-V4188 四件小 App 一起重构的验收（call / social / daily / keyboard）
// 为什么并成一条：四件的源内核都是同一个病 ——
//   类持状态 + 自己 Date.now/Math.random + 认不出就悄悄兜默认 + 叙事写死在描述里。
//   判据分四组 A/B/C/D 各钉一件，负控制共三条（每组至少一条）。
// 实现纪律：本档不用正则，一律 indexOf（生成链会吃反斜杠，与 r25_o3 / r27_o1 同一条）。
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
const CALL = await import('../apps/call/call-data.js');
const SOCIAL = await import('../apps/social/social-data.js');
const DAILY = await import('../apps/daily/daily-data.js');
const KB = await import('../apps/keyboard/keyboard-data.js');

/* 叙事词表：跟 iot/share 同族，另加四件源里写死的那些。 */
const NARRATIVE_WORDS = ['暖黄', '微光', '意境', '私密', '悄然', '微风', '纱帘', '气氛', '氛围感',
    '呼啸狂风', '噼啪', '喘息', '压低了嗓音', '黑咖啡', '烫嘴', '人间尚有温度', '梧桐树影', '推介清单', '高分餐厅'];
function narrationHits(text) {
    const hits = [];
    for (const w of NARRATIVE_WORDS) if (String(text).indexOf(w) >= 0) hits.push(w);
    return hits;
}

/* ══════════ A 组 · call ══════════ */
test('A1 场景封闭词表：认不出就拒，不悄悄兜成暴雨', () => {
    assert.equal(CALL.sceneProfile('rain_fleeing').lowPassHz, 3500);
    assert.equal(CALL.sceneProfile('party_mode'), null);
    assert.equal(CALL.sceneProfile('constructor'), null);
    const r = CALL.startCall(CALL.defaultCallState(), { scene: 'party_mode', callerName: '甲' }, 1);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown_scene');
    assert.equal(r.state.active, null, '拒了就不许把通话起起来');
});

test('A2 信号越界夹取并记账（不静默归零）', () => {
    const up = CALL.clampSignal(9);
    assert.equal(up.bars, 5);
    assert.ok(up.note.indexOf('9') >= 0 && up.note.indexOf('5') >= 0, '记账要写出越界前后');
    const down = CALL.clampSignal(-3);
    assert.equal(down.bars, 0);
    const bad = CALL.clampSignal('强');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'not_number');
});

test('A3 已有通话不许再起一通；没通话不许挂', () => {
    const st = CALL.startCall(CALL.defaultCallState(), { scene: 'quiet_room', callerName: '甲' }, 1).state;
    const twice = CALL.startCall(st, { scene: 'night_drive', callerName: '乙' }, 2);
    assert.equal(twice.ok, false);
    assert.equal(twice.reason, 'already_active');
    assert.equal(twice.state.active.callerName, '甲', '拒了不许把在打的那通顶掉');
    const none = CALL.endCall(CALL.defaultCallState(), 1);
    assert.equal(none.ok, false);
    assert.equal(none.reason, 'no_active_call');
    const done = CALL.endCall(st, 9);
    assert.equal(done.ok, true);
    assert.equal(done.state.history.length, 1, '挂断事实要进流水');
    assert.equal(done.ended.endedAt, 9);
});

test('A4 注入面零叙事词（只给滤波数值）', () => {
    const st = CALL.startCall(CALL.defaultCallState(), { scene: 'rain_fleeing', callerName: '甲', signalBars: 2 }, 1).state;
    const text = CALL.callPromptBlock(st).join(NL);
    assert.deepEqual(narrationHits(text), [], '注入面出现了叙事词：' + JSON.stringify(narrationHits(text)));
    assert.equal(text.indexOf('3500') >= 0, true);
    assert.equal(text.indexOf('0.25') >= 0, true);
    assert.equal(text.indexOf('2/5') >= 0, true);
});

test('A5 负控制：把场景兜底改回来，A1 必须转红', async () => {
    const src = read('apps/call/call-data.js');
    const needle = "if (!sceneProfile(spec.scene)) return { state: s, ok: false, reason: CALL_REJECT.unknownScene };";
    const i = src.indexOf(needle);
    assert.ok(i > 0, '找不到场景校验就该红');
    const broken = src.slice(0, i) + "if (!sceneProfile(spec.scene)) spec.scene = 'rain_fleeing';" + src.slice(i + needle.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-c-'));
    const f = path.join(dir, 'call-data-broken.mjs');
    fs.writeFileSync(f, broken, 'utf8');
    try {
        const B = await import(pathToFileURL(f).href);
        const r = B.startCall(B.defaultCallState(), { scene: 'party_mode', callerName: '甲' }, 1);
        assert.equal(r.ok, true, '兜了默认就会把认不出的场景放进来 —— A1 正是在拦这个');
        assert.equal(r.state.active.scene, 'rain_fleeing');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/* ══════════ B 组 · social ══════════ */
test('B1 时段与心情都是封闭词表，mood 不收任何字面量', () => {
    const ok = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p1', author: '甲', body: '晚好', part: 'night', mood: 'calm' }, 1);
    assert.equal(ok.ok, true);
    const badPart = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p2', author: '甲', body: '晚好', part: 'midnight', mood: 'calm' }, 1);
    assert.equal(badPart.reason, 'unknown_part');
    const badMood = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p3', author: '甲', body: '晚好', part: 'night', mood: 'nonsense' }, 1);
    assert.equal(badMood.reason, 'unknown_mood');
    const empty = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p4', author: '甲', body: '   ', part: 'night', mood: 'calm' }, 1);
    assert.equal(empty.reason, 'empty_body');
});

test('B2 点赞幂等；评论要正文', () => {
    let st = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p1', author: '甲', body: '晚好', part: 'night', mood: 'calm' }, 1).state;
    st = SOCIAL.interactPost(st, 'p1', '我', 'like', '', 0).state;
    const twice = SOCIAL.interactPost(st, 'p1', '我', 'like', '', 0);
    assert.equal(twice.ok, false, '同一 actor 再赞一次要拒');
    assert.equal(twice.state.posts[0].likes.length, 1, '拒了不许把赞数加上去');
    const empty = SOCIAL.interactPost(st, 'p1', '我', 'comment', '  ', 2);
    assert.equal(empty.reason, 'empty_body');
    const ok = SOCIAL.interactPost(st, 'p1', '我', 'comment', '确实', 2);
    assert.equal(ok.ok, true);
    assert.equal(ok.comments, 1);
});

test('B3 坏档归一不抛，半截数据不当好档', () => {
    assert.deepEqual(SOCIAL.normalizeSocialState(null), { posts: [], notes: [] });
    assert.deepEqual(SOCIAL.normalizeSocialState('x'), { posts: [], notes: [] });
    const half = SOCIAL.normalizeSocialState({
        posts: [
            { postId: 'a', author: '甲', part: 'night', mood: 'calm' },
            { author: '没 id 的', part: 'night', mood: 'calm' },
            { postId: 'b', author: '乙', part: 'midnight', mood: 'calm' },
            { postId: 'c', author: '丙', part: 'night', mood: 'whatever' },
            { postId: 'd', author: '丁', part: 'night', mood: 'calm' },
        ],
    });
    assert.equal(half.posts.length, 2, '没 id 的、时段不认得的、心情不认得的都要丢');
    assert.deepEqual(half.posts.map((p) => p.postId), ['a', 'd']);
});

test('B4 注入面零叙事词（只给计数）', () => {
    let st = SOCIAL.postToFeed(SOCIAL.defaultSocialState(),
        { postId: 'p1', author: '甲', body: '夜里还醒着', part: 'night', mood: 'reflective' }, 1).state;
    st = SOCIAL.postToFeed(st, { postId: 'p2', author: '乙', body: '早起', part: 'morning', mood: 'calm' }, 2).state;
    st = SOCIAL.interactPost(st, 'p1', '我', 'like', '', 0).state;
    const text = SOCIAL.socialPromptBlock(st).join(NL);
    assert.deepEqual(narrationHits(text), [], JSON.stringify(narrationHits(text)));
    assert.equal(text.indexOf('帖子 2 条') >= 0, true);
    assert.equal(text.indexOf('收赞 1') >= 0, true);
});

/* ══════════ C 组 · daily ══════════ */
test('C1 规则表可审：App 与事件类型都是封闭词表', () => {
    assert.equal(DAILY.ruleById('food').app, 'takeout');
    assert.equal(DAILY.ruleById('nope'), null);
    const bad = DAILY.triggerRule(DAILY.defaultDailyState(), 'nope', '吃火锅', 1, 'e1');
    assert.equal(bad.reason, 'unknown_rule');
    assert.equal(bad.state.events.length, 0);
    for (const r of DAILY.LIFE_RULES) {
        assert.ok(Object.prototype.hasOwnProperty.call(DAILY.LIFE_APPS, r.app), '规则指向的 App 必须在词表里：' + r.app);
        assert.ok(DAILY.EVENT_TYPES.indexOf(r.type) >= 0, '事件类型必须在词表里：' + r.type);
    }
});

test('C2 命中词如实记账，一个都没中就拒（不猜）', () => {
    const hit = DAILY.triggerRule(DAILY.defaultDailyState(), 'food', '晚上吃火锅吧', 5, 'e1');
    assert.equal(hit.ok, true);
    assert.equal(hit.event.hit, '吃', '命中的是词表里第一个对上的词（顺序即优先级，写死可审）');
    assert.equal(hit.event.app, 'takeout');
    const miss = DAILY.triggerRule(DAILY.defaultDailyState(), 'food', '今天天气不错', 5, 'e2');
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, 'no_match');
    assert.equal(miss.state.events.length, 0, '没命中不许造事件');
    const empty = DAILY.triggerRule(DAILY.defaultDailyState(), 'food', '   ', 5, 'e3');
    assert.equal(empty.reason, 'empty_text');
});

test('C3 注入面零叙事词（只给规则计数）', () => {
    let st = DAILY.defaultDailyState();
    st = DAILY.triggerRule(st, 'food', '吃烤肉', 1, 'e1').state;
    st = DAILY.triggerRule(st, 'schedule', '明天见', 2, 'e2').state;
    st = DAILY.triggerRule(st, 'food', '喝奶茶', 3, 'e3').state;
    const text = DAILY.dailyPromptBlock(st).join(NL);
    assert.deepEqual(narrationHits(text), [], JSON.stringify(narrationHits(text)));
    assert.equal(text.indexOf('事件 3 条') >= 0, true);
    assert.equal(text.indexOf('food → takeout | 2 次') >= 0, true);
    assert.equal(text.indexOf('命中') >= 0, true, '最近一次要把命中的词报出来');
});

/* ══════════ D 组 · keyboard ══════════ */
test('D1 口癖表不是数组就拒，不兜底成笨蛋三连', () => {
    const r = KB.predictCandidates('笨', { slangs: '笨蛋' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not_array');
    assert.deepEqual(r.candidates, []);
    const empty = KB.predictCandidates('笨', { slangs: [] });
    assert.equal(empty.reason, 'not_array', '空表也不许兜底');
});

test('D2 没匹配就如实空，不拿输入内容硬凑一条', () => {
    const prof = { slangs: ['笨蛋', '才没有', '听好了'] };
    const none = KB.predictCandidates('zzzz', prof);
    assert.equal(none.ok, false);
    assert.equal(none.reason, 'empty_query');
    assert.deepEqual(none.candidates, [], '源里那句 matches.length > 0 ? matches : [p] 正是反例');
    const some = KB.predictCandidates('笨', prof);
    assert.deepEqual(some.candidates, ['笨蛋']);
    const all = KB.predictCandidates('', prof);
    assert.equal(all.candidates.length, 3);
});

test('D3 草稿超长拒收，不静默截断', () => {
    const long = 'x'.repeat(KB.KB_LIMITS.maxDraftLen + 1);
    const r = KB.checkDraft(long);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'too_long');
    const ok = KB.checkDraft('短');
    assert.equal(ok.ok, true);
    assert.equal(ok.text, '短');
});

/* ══════════ E 接线（四件共用一套判法） ══════════ */
test('E1 四件的五处接线都在', () => {
    const apps = read('config/apps.js');
    for (const id of ['callscene', 'social', 'daily', 'keyboard']) {
        assert.ok(apps.indexOf("id: '" + id + "'") > 0, 'config/apps.js 缺 ' + id);
    }
    const routes = read('config/app-lazy-routes.js');
    for (const m of ['apps/call/call-app.js', 'apps/social/social-app.js', 'apps/daily/daily-app.js', 'apps/keyboard/keyboard-app.js']) {
        assert.ok(routes.indexOf(m) > 0, '懒加载路由缺 ' + m);
    }
    const storage = read('config/storage.js');
    for (const p of ['/^call_scene_/', '/^social_/', '/^daily_/', '/^ime_/']) {
        assert.ok(storage.indexOf(p) > 0, '会话前缀缺 ' + p);
    }
    const keys = read('scripts/keys-audit.mjs');
    for (const k of ['call_scene_state_v1', 'social_feed_v1', 'daily_fabric_v1', 'ime_profile_v1', 'ime_draft_v1']) {
        assert.ok(keys.indexOf(k) > 0, '键未登记：' + k);
    }
    const index = read('index.js');
    for (const k of ['callApp', 'socialApp', 'dailyApp', 'keyboardApp']) {
        assert.ok(index.indexOf("'" + k + "'") > 0, '重绑表缺 ' + k);
    }
});

test('E2 四个控制器都走 writeReceipt，零定时器零网络', () => {
    for (const f of ['apps/call/call-app.js', 'apps/social/social-app.js', 'apps/daily/daily-app.js', 'apps/keyboard/keyboard-app.js']) {
        const s = read(f);
        assert.ok(s.indexOf('writeReceipt') > 0, f + ' 必须走唯一回执实现');
        assert.equal(s.indexOf('storage.set('), -1, f + ' 不许绕开 writeReceipt 直写');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest', 'requestAnimationFrame']) {
            assert.equal(s.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
    }
    for (const f of ['apps/call/call-view.js', 'apps/social/social-view.js', 'apps/daily/daily-view.js', 'apps/keyboard/keyboard-view.js']) {
        const v = read(f);
        assert.ok(v.indexOf('_boundRoot === root') > 0, f + ' 根容器监听必须去重');
        assert.ok(v.indexOf('-css') > 0, f + ' CSS 必须自注入');
        for (const bad of ['setInterval', 'setTimeout', 'fetch(']) {
            assert.equal(v.indexOf(bad), -1, f + ' 里不许有 ' + bad);
        }
    }
});

test('E3 三个内核都不取 now、不 Math.random（时间由调用方给）', () => {
    for (const f of ['apps/call/call-data.js', 'apps/social/social-data.js', 'apps/daily/daily-data.js', 'apps/keyboard/keyboard-data.js']) {
        const s = read(f);
        /* 注释里出现 Date.now / Math.random 是写「源里哪儿有病」，不算违规；
         *   只查非注释行：去掉 * 开头的行与含 /* 的行再扫。 */
        const codeLines = s.split(NL).filter((l) => {
            const t = l.trim();
            return t && t.indexOf('*') !== 0 && t.indexOf('/*') !== 0 && t.indexOf('//') !== 0;
        });
        const code = codeLines.join(NL);
        assert.equal(code.indexOf('Date.now'), -1, f + ' 的代码里不许自己取时间');
        assert.equal(code.indexOf('Math.random'), -1, f + ' 的代码里不许自己造随机 id');
    }
    for (const f of ['apps/call/call-app.js', 'apps/social/social-app.js', 'apps/daily/daily-app.js', 'apps/keyboard/keyboard-app.js']) {
        const s = read(f);
        assert.equal(s.indexOf('Math.random'), -1, f + ' 控制器也不许造随机 id');
    }
});

/* ══════════ V 版本锚 ══════════ */
test('V1 版本锚：package.json 已抬到 4.188.0', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, '4.188.0');
    assert.ok(read('index.js').indexOf('4.188.0') > 0);
});
