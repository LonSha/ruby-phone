/* ========================================================
 * system-v4154.test.mjs — v4.153.0 · R21-X10 Bodycord 档案桥（严格纯读）
 * 判据面：五态分形 / 纯读硬证据 / 产品侧真接线 / 自检同源 / 版本锚。
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBodycordFace, bodycordBridgeSelfCheck, BODYCORD_FACES, BODYCORD_STATE_KEY } from '../config/bodycord-bridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const mk = (ctx) => ({ SillyTavern: { getContext: () => ctx } });

/* ---------- A 组：五态分形（读得出与读不出分句，绝不压平） ---------- */
test('v4154 A1. 五态分形：五条路各自归位，互不压平', () => {
    const a = readBodycordFace(mk(null));
    assert.equal(a.state, BODYCORD_FACES.NO_CONTEXT);
    const b = readBodycordFace(mk({}));
    assert.equal(b.state, BODYCORD_FACES.NO_METADATA);
    const c = readBodycordFace(mk({ chat_metadata: {} }));
    assert.equal(c.state, BODYCORD_FACES.ABSENT, '未安装不是缺陷，单独立态');
    const d = readBodycordFace(mk({ chat_metadata: { bodycord_state: 'oops' } }));
    assert.equal(d.state, BODYCORD_FACES.MALFORMED);
    const d2 = readBodycordFace(mk({ chat_metadata: { bodycord_state: { targets: null, order: [] } } }));
    assert.equal(d2.state, BODYCORD_FACES.MALFORMED, 'targets 缺位同归 malformed');
    const st = { schema: 1, order: [], targets: {} };
    const e = readBodycordFace(mk({ chat_metadata: { bodycord_state: st } }));
    assert.equal(e.state, BODYCORD_FACES.PRESENT, '空档案也是档案（present 而非 absent）');
});

test('v4154 A2. 投影口径：全列不丢、轻档如实、三本账计数、原样带出', () => {
    const st = {
        schema: 1, order: ['user', '甲', '乙'], active: '甲',
        dateMode: 'fiction', fictionDate: '3年07月14日',
        snapshots: [1, 2, 3], insems: [1], ovuJudgments: [{ roll: 1 }, { roll: 2 }],
        targets: {
            user: { key: 'user', name: '{{user}}', isUser: true, light: false, profile: null, period: null, vars: {}, note: '', raw: '' },
            '甲': { key: '甲', name: '甲', light: true, profile: { x: 1 }, period: {}, vars: { a: 1, b: 2 }, note: 'n', raw: 'r' },
            '乙': { key: '乙', name: '乙', light: false, present: false, profile: null, period: null, vars: null, note: '', raw: '' }
        }
    };
    const before = JSON.stringify(st);
    const f = readBodycordFace(mk({ chat_metadata: { bodycord_state: st } }));
    assert.equal(f.state, BODYCORD_FACES.PRESENT);
    assert.equal(f.targets.length, 3, 'order 三份全列，不截不丢');
    assert.equal(f.targets[0].name, '{{user}}');
    assert.equal(f.targets[0].isUser, true);
    assert.equal(f.lightCount, 1, '轻档如实计数');
    assert.equal(f.targets[1].hasProfile, true, '有推演档如实报');
    assert.equal(f.targets[1].varsCount, 2);
    assert.equal(f.targets[2].present, false, '不在场如实报');
    assert.equal(f.targets[2].varsCount, null, 'vars 缺位报 null（不是 0）');
    assert.equal(f.active, '甲');
    assert.equal(f.fictionDate, '3年07月14日');
    assert.deepEqual(f.counts, { snapshots: 3, insems: 1, judgments: 2 });
    assert.equal(JSON.stringify(st), before, '宿主对象序列化前后逐字不变（纯读）');
});

test('v4154 A3. 纯读硬证据：零写、冻结入参不改写、会抛的宿主不外抛', () => {
    const st = { order: ['k'], targets: { k: { key: 'k', name: 'k' } }, snapshots: [], insems: [], ovuJudgments: [] };
    Object.freeze(st);
    Object.freeze(st.targets);
    const f = readBodycordFace(mk({ chat_metadata: { bodycord_state: st } }));
    assert.equal(f.state, BODYCORD_FACES.PRESENT, '冻结宿主照常可读');
    const throwing = { get chat_metadata() { throw new Error('boom'); } };
    const f2 = readBodycordFace(mk({ chat_metadata: undefined }));
    assert.equal(f2.state, BODYCORD_FACES.NO_METADATA, 'chat_metadata 缺位不外抛');
    const ctx = { get chat_metadata() { throw new Error('boom'); } };
    let threw = false;
    try { readBodycordFace(mk(ctx)); } catch (_e) { threw = true; }
    assert.equal(threw, false, '宿主 getter 抛错必须降级，不外抛');
    assert.ok(f.targets.length === 1);
});

test('v4154 A4. 父窗口兜底链：本窗口无 ST 时读 parent（与 floor-store 同链路）', () => {
    const parentCtx = { chat_metadata: { bodycord_state: { order: [], targets: {} } } };
    const fakeParent = { SillyTavern: { getContext: () => parentCtx } };
    const f = readBodycordFace({ SillyTavern: undefined, parent: fakeParent });
    assert.equal(f.state, BODYCORD_FACES.PRESENT, '父窗口链应兜底');
});

/* ---------- B 组：判据面必须基于真代码（剥注释与字符串） ---------- */
test('v4154 B1. 内核零写路径（剥注释后真代码不含写调用）', () => {
    const src = read('config/bodycord-bridge.js');
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'[^'\n]*'|"[^"\n]*"/g, "''");
    assert.ok(!/saveMetadata|saveChat|\.set\s*\(|prune/i.test(code), '真代码里不得有写路径');
    assert.ok(!/localStorage|sessionStorage/.test(code), '不得走浏览器存储');
});

test('v4154 B2. 产品侧真接线（uterus：探针 + 页签 + 面板 + 自检转发）', () => {
    const app = read('apps/uterus/uterus-app.js');
    assert.match(app, /import \{ readBodycordFace, bodycordBridgeSelfCheck, BODYCORD_FACES \} from '\.\.\/\.\.\/config\/bodycord-bridge\.js'/, 'App 未接桥');
    assert.match(app, /extarchProbe\(\)/, 'App 无探针');
    assert.match(app, /extarchSelfCheck\(\) \{ return bodycordBridgeSelfCheck\(\); \}/, '自检必须原样转发，不得零消费');
    const view = read('apps/uterus/uterus-view.js');
    assert.match(view, /key: 'extarch'/, '页签未登记');
    assert.match(view, /_extarchPanel\(\)/, '面板未接');
    assert.match(view, /extarchProbe\(\)/, '面板未真取数');
    assert.match(view, /外部档案 · Bodycord/, '面板标题未落地');
    const css = read('apps/uterus/uterus.css');
    assert.ok(css.includes('ud-tabs'), '样式基座在场（页签沿用既有 ud- 盘）');
});

test('v4154 B3. 与对方插件的关系：不携带对方代码、不重算口径', () => {
    const src = read('config/bodycord-bridge.js') + read('apps/uterus/uterus-app.js');
    /* 许可名（PolyForm Strict）作为**事实陈述**可以出现；受保护的是条款表达——
     *   禁的是照抄对方的许可散文与代码，不是提它的名字。 */
    assert.ok(!src.includes('不可转发或分享给别人'), '不得照抄许可条款散文');
    assert.ok(!src.includes('改完再发出去'), '不得照抄许可条款散文');
    assert.ok(!/src\//.test(src), '不得携带对方源文件路径');
    assert.ok(!/soduiz\/SillyTavern-Bodycord/.test(src.replace(/soduiz\/SillyTavern-Bodycord/g, '')), '无自指残留');
    /* 只投影在场事实：不得出现第二套生理数值口径（重算即缝实现）。 */
    for (const banned of ['pregDaysOf(', 'gestDays', '受孕率', 'fetusCountOf']) {
        assert.ok(!src.includes(banned), '不得重算对方的数值口径：' + banned);
    }
});

/* ---------- C 组：自检同源 + 版本锚 ---------- */
test('v4154 C1. 内核自检与判据同源（正控必真）', () => {
    const self = bodycordBridgeSelfCheck();
    assert.equal(self.ok, true, '内核自检必须全绿：' + JSON.stringify(self.problems));
});

test('v4154 C2. 版本锚：五源同源且不低于 4.153.0（下限形，不把本版号写死进判据）', () => {
    const pkg = JSON.parse(read('package.json'));
    const man = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const idx = read('index.js');
    const il = read('ITERATION_LOG.md');
    const ver = pkg.version;
    const cmp = (a, b) => {
        const A = a.split('.').map(Number), B = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; }
        return 0;
    };
    assert.ok(cmp(ver, '4.153.0') >= 0, '版本低于本版下限：' + ver);
    assert.equal(man.version, ver, 'manifest 与 package 同源');
    assert.equal(log.latest, ver, 'update-log.latest 同源');
    assert.ok(log.versions[ver], '当版条目在场');
    assert.ok(idx.includes("const ST_PHONE_VERSION = '" + ver + "';"), 'index.js 版本常量同源');
    assert.ok(il.includes('版本升至 ' + ver), '迭代段收口条目在场');
    for (const it of log.versions[ver].items) {
        assert.ok(idx.includes(JSON.stringify(it)), '弹窗条目逐字同源：' + it.slice(0, 20));
    }
});