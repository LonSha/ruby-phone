// SYS-V4187 近场快传（重构验收）
// 为什么单独立一条：本件是从两个死内核重构来的 ——
//   nfc-airdrop-proximity-exchange.js（类持有 Map 自算 status）、
//   universal-sharesheet-intent-bus.js（编造 handlerUri 而全仓无人监听）。
//   源里三块「本仓不能有」的东西必顷在代码面上钉住：
//     ① 阈值不看就收（冒充满格）② 热心兜底（认不出就当成 text）
//     ③ 自己产叙事（把“空中涓过一丝静电般的礁感”写进描述里）。
// 实现纪律：本档不用正则，一律 indexOf（生成链会把反斜杠吃掉，与 r25_o3 / r27_o1 同一条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const D = await import('../apps/share/share-data.js');

/* 叙事词表：这些词只能出现在生成侧，不该出现在 App 的注入面里。
 * [v4.187.0] 跟 iot 的词表同族（暖黄 / 微光 / ...），另加近场场景常见的三个。 */
const NARRATIVE_WORDS = ['暖黄', '微光', '意境', '私密', '悄然', '微风', '纱帘', '极致安宁', '气氛', '氛围感', '涓过', '手温', '呼吸声'];
function narrationHits(text) {
    const hits = [];
    for (const w of NARRATIVE_WORDS) if (String(text).indexOf(w) >= 0) hits.push(w);
    return hits;
}

const DEV = (id, signal, name) => ({ id, signal, name: name || id });

/* ══════════ A 内核 ══════════ */
test('A1 载荷种类是封闭词表：认不出就拒答，不兜成 text', () => {
    assert.ok(D.SHARE_KINDS.text, '词表里应有 text');
    const r = D.mimeOfKind('hologram');
    assert.equal(r, null, '表外种类必须认不出');
    const d = D.dispatchShare({ kind: 'hologram' }, []);
    assert.equal(d.ok, false);
    assert.equal(d.reason, D.SHARE_REJECT.unknownKind);
    assert.equal(d.mime, null, '拒答时不许顺手给个 mime');
    // 原型链上的名字也不许认
    assert.equal(D.mimeOfKind('constructor'), null);
    assert.equal(D.mimeOfKind('toString'), null);
});

test('A2 没人接得住就如实说没接住，不编造受体', () => {
    const r = D.dispatchShare({ kind: 'contactCard' }, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, D.SHARE_REJECT.noReceiver);
    assert.deepEqual(r.targets, []);
    const notList = D.dispatchShare({ kind: 'text' }, 'wechat');
    assert.equal(notList.reason, D.SHARE_REJECT.notList, '受体表不是数组要拒答，不是当成空表');
});

test('A3 派发名单按 MIME 严格对应（多一个少一个都不行）', () => {
    const receivers = [
        { id: 'wechat', name: '微信', icon: 'W', supportedMimes: ['text/plain'] },
        { id: 'album', name: '相册', icon: 'A', supportedMimes: ['image/png'] },
        { id: 'diary', name: '日记', icon: 'D', supportedMimes: ['text/markdown', 'text/plain'] },
        { id: 'bad', name: '坏受体' },
    ];
    const r = D.dispatchShare({ kind: 'text' }, receivers);
    assert.equal(r.ok, true);
    assert.equal(r.mime, 'text/plain');
    assert.deepEqual(r.targets.map((t) => t.appId), ['wechat', 'diary'], '相册不接文本、坏受体不许进名单');
    for (const t of r.targets) {
        assert.equal(typeof t.handlerUri, 'undefined', '不许编造 handlerUri（源里的那处就是反例）');
    }
});

test('A4 信号不够就是不在范围：真拒，且不改入参', () => {
    const st = D.defaultShareState();
    const before = JSON.stringify(st);
    const weak = D.bumpDevice(st, DEV('npc1', 12), 1000);
    assert.equal(weak.ok, false);
    assert.equal(weak.reason, D.SHARE_REJECT.outOfRange);
    assert.equal(weak.state.nearby.length, 0, '拒了就不许进名册');
    assert.equal(JSON.stringify(st), before, '纯函数不许改入参');
    const missing = D.bumpDevice(st, DEV('npc2', 90), 1000);
    assert.equal(missing.ok, true, '信号够就得收');
});

test('A5 同一台重复碰只认一次（不叠条、不刷新旧读数）', () => {
    const a = D.bumpDevice(D.defaultShareState(), DEV('npc1', 80, '苏离的机'), 1000);
    const b = D.bumpDevice(a.state, DEV('npc1', 99, '苏离的机'), 2000);
    assert.equal(b.ok, false);
    assert.equal(b.reason, D.SHARE_REJECT.alreadyNearby);
    assert.equal(b.state.nearby.length, 1);
    assert.equal(b.state.nearby[0].signal, 80, '旧读数就是当时的事实，不被后来者盖掉');
    assert.equal(b.state.nearby[0].at, 1000);
});

test('A6 不在范围就发不出去，且不落流水（失败不许当成已发生）', () => {
    const st = D.defaultShareState();
    const r = D.exchangePayload(st, 'npc1', { kind: 'text', title: 'hi' }, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, D.SHARE_REJECT.outOfRange);
    assert.equal(r.record, null);
    assert.equal(r.state.history.length, 0);

    const near = D.bumpDevice(st, DEV('npc1', 88), 1000).state;
    const bad = D.exchangePayload(near, 'npc1', { kind: 'hologram', title: 'x' }, 2000);
    assert.equal(bad.reason, D.SHARE_REJECT.unknownKind, '种类认不出一样不许落流水');
    assert.equal(bad.state.history.length, 0);

    const ok = D.exchangePayload(near, 'npc1', { kind: 'contactCard', title: '我的名片' }, 3000);
    assert.equal(ok.ok, true);
    assert.equal(ok.state.history.length, 1);
    assert.equal(ok.state.history[0].deviceName, 'npc1');
    assert.equal(ok.state.nearby.length, 1, '发完东西设备还在范围（不许顺手把人踢了）');
});

test('A7 坏档归一：不抛、半截数据不许当好档', () => {
    assert.deepEqual(D.normalizeShareState(null), { nearby: [], history: [] });
    assert.deepEqual(D.normalizeShareState('{}'), { nearby: [], history: [] });
    assert.deepEqual(D.normalizeShareState(42), { nearby: [], history: [] });
    const half = D.normalizeShareState({
        nearby: [{ id: 'a', signal: 70 }, { name: '没 id 的' }, null, 7],
        history: [{ deviceId: 'a', kind: 'text' }, { deviceId: 'a', kind: 'hologram' }, { kind: 'text' }],
    });
    assert.equal(half.nearby.length, 1, '没 id 的、null、数字都不进名册');
    assert.equal(half.history.length, 1, '种类认不出的、没 deviceId 的流水要丢');
    assert.equal(half.nearby[0].name, 'a', '没 name 用 id 补，不编');
    assert.equal(half.nearby[0].at, 0, '没时间就 0，不取 now');
});

test('A8 面态三态：空档 / 有设备 / 只剩流水', () => {
    assert.equal(D.readShareFace(D.defaultShareState()), D.SHARE_FACE.IDLE);
    const near = D.bumpDevice(D.defaultShareState(), DEV('a', 90), 1).state;
    assert.equal(D.readShareFace(near), D.SHARE_FACE.NEARBY);
    const left = D.leaveDevice(near, 'a').state;
    assert.equal(D.readShareFace(left), D.SHARE_FACE.IDLE);
    const hist = D.exchangePayload(near, 'a', { kind: 'text', title: 't' }, 2).state;
    assert.equal(D.readShareFace(D.leaveDevice(hist, 'a').state), D.SHARE_FACE.HISTORY);
});

/* ══════════ B 注入面 ══════════ */
test('B1 注入面零叙事词（只报事实读数）', () => {
    const st = D.bumpDevice(D.defaultShareState(), DEV('a', 88, '苏离的机'), 1).state;
    const withHist = D.exchangePayload(st, 'a', { kind: 'contactCard', title: '我的名片' }, 2).state;
    const text = D.sharePromptBlock(withHist).join(String.fromCharCode(10));
    assert.deepEqual(narrationHits(text), [], '注入面出现了叙事词：' + JSON.stringify(narrationHits(text)));
    assert.equal(text.indexOf('88') >= 0, true, '读数要真在');
    assert.equal(text.indexOf('苏离的机') >= 0, true, '谁要真在');
});

test('B2 注入行数跟真设备数同源（不多报也不少报）', () => {
    let st = D.defaultShareState();
    assert.equal(D.sharePromptBlock(st).length, 3, '空档：标题 + 台数 + 最近一次');
    st = D.bumpDevice(st, DEV('a', 70), 1).state;
    st = D.bumpDevice(st, DEV('b', 90), 2).state;
    const lines = D.sharePromptBlock(st);
    assert.equal(lines.length, 3 + 2, '两台就多两行');
    const devLines = lines.filter((l) => l.indexOf('- ') === 0);
    assert.equal(devLines.length, st.nearby.length);
});

test('B3 注入的最后一条就是流水末条（投影与注入同源）', () => {
    let st = D.defaultShareState();
    st = D.bumpDevice(st, DEV('a', 90, '甲机'), 1).state;
    st = D.exchangePayload(st, 'a', { kind: 'text', title: '第一' }, 2).state;
    st = D.exchangePayload(st, 'a', { kind: 'snippet', title: '第二' }, 3).state;
    const last = D.sharePromptBlock(st).slice(-1)[0];
    assert.equal(last.indexOf('第二') >= 0, true, '末条要报最新的，不是最旧的');
    assert.equal(last.indexOf('第一') < 0, true);
    assert.equal(last.indexOf('甲机') >= 0, true);
});

/* ══════════ C 负控制（证伪，不证真） ══════════ */
test('C1 负控制：往注入面掺一句场景描写，B1 必须转红', () => {
    const st = D.bumpDevice(D.defaultShareState(), DEV('a', 88), 1).state;
    const clean = D.sharePromptBlock(st);
    assert.deepEqual(narrationHits(clean.join(String.fromCharCode(10))), []);
    const dirty = clean.concat(['对方手温还留在机身上，空气里涓过一丝静电感']);
    const hits = narrationHits(dirty.join(String.fromCharCode(10)));
    assert.ok(hits.length >= 2, '词表必须真掃得出来，否则 B1 就是空门');
});

test('C2 负控制：把信号阈值检查拿掉，A4 必须转红', async () => {
    const src = read('apps/share/share-data.js');
    const needle = 'if (signal < NEARBY_LIMITS.minSignal) {';
    const i = src.indexOf(needle);
    assert.ok(i > 0, '找不到阈值检查就该红（否则这条负控制失效）');
    const broken = src.slice(0, i) + 'if (false) {' + src.slice(i + needle.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-c2-'));
    const f = path.join(dir, 'share-data-broken.mjs');
    fs.writeFileSync(f, broken, 'utf8');
    try {
        const B = await import(pathToFileURL(f).href);
        const r = B.bumpDevice(B.defaultShareState(), DEV('weak', 3), 1);
        assert.equal(r.ok, true, '不检查阈值就会把 3 格信号的机器收进来 —— A4 正是在拦这个');
        assert.equal(r.state.nearby.length, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('C3 词表自证：每个叙事词都能被自己抓到（防词表被害死）', () => {
    for (const w of NARRATIVE_WORDS) {
        assert.deepEqual(narrationHits('前' + w + '后'), [w]);
    }
});

/* ══════════ E 接线 ══════════ */
test('E1 五处接线都在（图标 / 路由 / 会话前缀 / 键登记 / 重绑表）', () => {
    const apps = read('config/apps.js');
    assert.ok(apps.indexOf("id: 'share'") > 0, 'config/apps.js 缺条目');
    const routes = read('config/app-lazy-routes.js');
    assert.ok(routes.indexOf('apps/share/share-app.js') > 0, '懒加载路由缺行');
    const storage = read('config/storage.js');
    assert.ok(storage.indexOf('/^share_/') > 0, '会话前缀缺 /^share_/');
    const keys = read('scripts/keys-audit.mjs');
    assert.ok(keys.indexOf('share_nearby_v1') > 0, '键未登记');
    const index = read('index.js');
    assert.ok(index.indexOf("'shareApp'") > 0, '重绑表缺 shareApp');
});

test('E2 控制器只走 writeReceipt，零定时器零网络', () => {
    const s = read('apps/share/share-app.js');
    assert.ok(s.indexOf('writeReceipt') > 0, '落盘必须走唯一回执实现');
    assert.ok(s.indexOf('storage.set') < 0, '不许绕开 writeReceipt 直写');
    for (const bad of ['setInterval', 'setTimeout', 'fetch(', 'XMLHttpRequest', 'requestAnimationFrame']) {
        assert.equal(s.indexOf(bad), -1, '控制器里不许有 ' + bad);
    }
    const v = read('apps/share/share-view.js');
    for (const bad of ['setInterval', 'setTimeout', 'fetch(']) {
        assert.equal(v.indexOf(bad), -1, '视图里不许有 ' + bad);
    }
});

test('E3 视图只绑一次 + 样式自注入（否则界面裸奔不报错）', () => {
    const v = read('apps/share/share-view.js');
    assert.ok(v.indexOf('_boundRoot === root') > 0, '根容器监听必须去重');
    assert.ok(v.indexOf('share-css') > 0, 'CSS 必须自注入');
    assert.ok(v.indexOf('./share.css') > 0, '注入的必须是本 App 的样式');
    assert.equal(v.indexOf("addEventListener('input'"), -1, '本件不该有 input 监听');
});

/* ══════════ V 版本锚 ══════════ */
test('V1 版本锚：package.json 已抬到 4.187.0', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, '4.187.0');
    assert.ok(read('index.js').indexOf('4.187.0') > 0, 'index.js 版本行要同源');
});
