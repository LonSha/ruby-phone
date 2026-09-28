// tests/system-v3200.test.mjs — 续玩简报（计划二 F8 手机侧）[v3.20.0]
//
//   计划原文：「隔几天回来能快速知道**上次停在哪里、眼下最相关的人和事、我有哪些可选行动**，
//   并直接继续游玩。」「每个简报项目能回到原文或业务入口；**无新剧情时不编造更新**；
//   **回档后不带未来事实**；手机关闭不继续无边界生成；普通短会话也可用，不要求所有 App 和插件同时安装。」
//
//   修前实测：这四样每一样都已有真源（九账证据面 / 约定五态 / 上游承诺投影 / 表格锚点），
//   但**没有任何一处把它们收在同一个读数里**；且本仓反复治过的那类错读数
//   （把「本机还没接上面」与「接上了、确实没有」显示成同一句话）在这一面同样会复发。
//
//   覆盖：
//     A 内核：分节、缺口、零项不给绿灯、上限不静默截断
//     B 挡未来事实（回档/删楼后不得把未来当现在）+ 楼层 null 不许补 0
//     C 口径：数值走唯一取值门；总述唯一实现；逐面台账只此一份清单
//     D 接线：收集器复用已取好的面（不重取）；视图消费台账、不自列面名
//     E 负控制：真源码破坏 → 临时副本 → **逐字同一段**判据必须转红
//     F 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const KERNEL = 'config/resume-brief.js';

const RB = await import(at(KERNEL));

/* 判据工具：剥注释后核对 token。
 *   本仓纪律：**注释里的提及不算消费**（E6 / v299 A4 / v3190 A4 同一口径）。
 *   本套件必须自己实现一遍 —— 判据不许「用被审对象自己的实现来审它自己」。
 *   ★ 这条工具是**当场被 D1 的假红换来的**：D1 初版直接读原文，而内核注释里
 *     提到了 `readLonshaEvidence` / `evidenceFaceOf`（说明输入从哪来），于是判据
 *     把「注释里说了这个名字」读成了「内核自己带取数点」—— 正是本仓治过多次的形态。 */
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

/** 一份「什么都读得到、而且都为空」的输入（面在、确实没有 —— 真读数，不是缺口）。 */
function allEmpty(extra = {}) {
    return Object.assign({
        commitments: { version: 1, items: [] },
        worldProgress: [],
        evidence: { state: 'empty', items: [] },
        storyClock: { present: true, verdict: '一致' },
        updateGap: { state: 'clear' },
        floorCount: 10,
        at: 1
    }, extra);
}

/* ══════════ A ── 内核 ══════════ */

test('A1 空输入：零项一律不给绿灯，且五个面各记一条缺口', () => {
    const r = RB.resumeBrief({});
    assert.equal(r.present, false);
    assert.equal(/全部就绪/.test(r.headline), false, '★ 未发生的好消息不得当结论');
    assert.match(r.headline, /还没有可续的剧情/);
    assert.deepEqual(r.gaps.map((g) => g.face).sort(), [...RB.RESUME_FACES].sort(),
        '五个输入面必须各有一条缺口登记（面名取自唯一清单）');
    assert.equal(r.sections.length, 0);
});

test('A2 「面在、确实为空」**不是**缺口 —— 与「读不到」相反，不许压成一态', () => {
    const r = allEmpty();
    const brief = RB.resumeBrief(r);
    assert.equal(brief.present, false);
    assert.equal(brief.gaps.length, 0,
        '★ 面读到了、确实没有条目 ⇒ 真读数（等剧情推进）；记成缺口就变成「等装插件」');
});

test('A3 分节：未完成约定进「未完成的约定」，终态不进（终态集合走 commitment-flow 唯一真源）', () => {
    const brief = RB.resumeBrief(allEmpty({
        commitments: { version: 1, items: [
            { id: 'apt_1', actor: '甲', content: '周六看展', dateKey: '2026-10-03', status: 'confirmed' },
            { id: 'apt_2', actor: '乙', content: '已经办完的事', dateKey: '2026-10-01', status: 'fulfilled' },
            { id: 'apt_3', actor: '丙', content: '取消掉的事', dateKey: '2026-10-02', status: 'cancelled' }
        ] }
    }));
    const sec = brief.sections.find((s) => s.key === 'open');
    assert.equal(sec.rows.length, 1, '终态（已完成/已取消）不得出现在「未完成」里');
    assert.match(sec.rows[0].text, /周六看展/);
    assert.match(sec.rows[0].text, /已确认/);
});

test('A4 上游未了承诺与支线各占一节（支线是可选面：不给就不建节，也不记缺口）', () => {
    const withArcs = RB.resumeBrief(allEmpty({
        worldProgress: [{ character: '甲', content: '还账', deadline: '第 12 楼', status: 'open' }],
        arcs: [{ title: '旧宅的钥匙', clue: '门廊的信', status: 'active' }]
    }));
    assert.ok(withArcs.sections.some((s) => s.key === 'wants'), '上游未了承诺应成一节');
    assert.ok(withArcs.sections.some((s) => s.key === 'arcs'), '支线给了就应成一节');
    const noArcs = RB.resumeBrief(allEmpty());
    assert.equal(noArcs.sections.some((s) => s.key === 'arcs'), false);
    assert.equal(noArcs.gaps.length, 0, '可选面不给**不算**缺口');
});

test('A5 超上限只报 more，不静默截断；且 sections 的 rows 数就是 present 的账', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ title: 't' + i, floor: i, ledger: 'a', ledgerLabel: 'A' }));
    const brief = RB.resumeBrief(allEmpty({ evidence: { state: 'ok', items } }));
    const sec = brief.sections.find((s) => s.key === 'recent');
    assert.equal(sec.rows.length, 5);
    assert.equal(sec.more, 4, '超出部分必须报出来');
    assert.equal(brief.present, true);
    assert.match(brief.headline, /5 项可续/);
});

/* ══════════ B ── 挡未来事实（回档/删楼后不得把未来当现在） ══════════ */

test('B1 楼层 >= 当前正文长度 ⇒ 丢掉并计数；剩余部分照常进节', () => {
    const brief = RB.resumeBrief(allEmpty({
        evidence: { state: 'ok', items: [
            { title: '早先的一楼', floor: 2, ledger: 'promise', ledgerLabel: '伏笔账' },
            { title: '回档后已不存在的一楼', floor: 30, ledger: 'promise', ledgerLabel: '伏笔账' }
        ] }
    }));
    assert.equal(brief.dropped.staleFloors, 1);
    const sec = brief.sections.find((s) => s.key === 'recent');
    assert.equal(sec.rows.length, 1);
    assert.match(sec.rows[0].text, /早先的一楼/);
    assert.equal(brief.complete, false, '丢过行 ⇒ 这次读数不完整');
    assert.match(brief.headline, /已挡下 1 条不可达楼层/,
        '★ 挡掉是正确行为，但**静默**挡掉会让用户以为「本来就只有这些」');
});

test('B2 正文长度未知（floorCount 取不到）⇒ 不做挡判（少报胜过多报：宁可多留也不误删）', () => {
    const brief = RB.resumeBrief(allEmpty({
        floorCount: null,
        evidence: { state: 'ok', items: [{ title: 'x', floor: 999, ledger: 'a', ledgerLabel: 'A' }] }
    }));
    assert.equal(brief.floorCount, null);
    assert.equal(brief.dropped.staleFloors, 0, '长度未知时不得拿任何数字当长度');
    assert.equal(brief.sections.find((s) => s.key === 'recent').rows.length, 1);
});

test('B3 楼层取不到 ⇒ null（**绝不补 0**：0 是「第 0 楼」这个真实读数）', () => {
    const brief = RB.resumeBrief(allEmpty({
        evidence: { state: 'ok', items: [{ title: 'x', floor: null, ledger: 'a', ledgerLabel: 'A' }] }
    }));
    assert.equal(brief.sections.find((s) => s.key === 'recent').rows[0].floor, null);
    const brief2 = RB.resumeBrief(allEmpty({
        evidence: { state: 'ok', items: [{ title: 'y', floor: 0, ledger: 'a', ledgerLabel: 'A' }] }
    }));
    assert.equal(brief2.sections.find((s) => s.key === 'recent').rows[0].floor, 0, '0 是合法读数，必须如实给');
});

/* ══════════ C ── 口径 ══════════ */

test('C1 数值取值走**全仓唯一实现**（弱口径签名与本地取值助手都不得出现在本内核）', () => {
    const src = readRel(KERNEL);
    assert.equal(/Number\.isFinite\(Number\(/.test(src), false, '弱口径签名（`Number(null) === 0` 一族）');
    assert.match(src, /import \{ numOrNull \} from '\.\/num-gate\.js'/, '必须引用唯一实现');
    assert.equal(/function (num|numOrNull|finite|finiteFloor)\s*\(/.test(src), false, '不得本地自成一版取值助手');
    /* 行为面：null / '' / [] / {} 一律判「没给」 */
    for (const bad of [null, '', [], {}, true]) {
        assert.equal(RB.resumeBrief({ at: bad }).at, null, 'at=' + JSON.stringify(bad) + ' 应判没给');
    }
    assert.equal(RB.resumeBrief({ at: 5 }).at, 5, '真给了数就要如实出数（门不得关成谁都取不到）');
});

test('C2 总述唯一实现：内核给的行与独立调用逐字相同', () => {
    const brief = RB.resumeBrief({});
    assert.equal(brief.headline, RB.resumeBriefText(brief));
    const src = readRel(KERNEL);
    assert.equal(src.split('export function resumeBriefText(').length - 1, 1, 'resumeBriefText 只许一份实现');
});

test('C3 逐面台账与唯一面清单一一对应（视图不得自己列一遍面名）', () => {
    const brief = RB.resumeBrief({});
    assert.equal(brief.faceLedger.length, RB.RESUME_FACES.length);
    assert.deepEqual(brief.faceLedger.map((f) => f.face), [...RB.RESUME_FACES], '顺序也照清单（不重排）');
    assert.equal(brief.faceLedger.every((f) => f.missing === true), true);
    const ok = RB.resumeBrief(allEmpty({ evidence: null }));
    assert.equal(ok.faceLedger.find((f) => f.face === 'evidence').missing, true);
    assert.equal(ok.faceLedger.find((f) => f.face === 'commitments').missing, false);
});

/* ══════════ D ── 接线 ══════════ */

test('D1 收集器：**已取好的面一律复用**（同一轮不重取），且取数口在收集器而非内核', () => {
    const col = readRel('apps/timeweaver/timeweaver-collector.js');
    assert.match(col, /import \{ resumeBrief, resumeBriefText \} from '\.\.\/\.\.\/config\/resume-brief\.js'/);
    assert.match(col, /evidence,/u, '必须把（可能已取好的）证据面传下去');
    /* 内核必须零取数：不得出现桥读取或 storage 访问（口径只此一份，取数在调用方）。
     *   ★ 剥注释后核对 —— 内核注释里**说明输入从哪来**时会提到 `readLonshaEvidence`
     *     这类名字，那是散文不是代码（「注释里的提及不算消费」）。 */
    const kernelCode = stripComments(readRel(KERNEL));
    assert.equal(/readLonshaSnapshot|readLonshaEvidence|storage\.get|window\.|globalThis/.test(kernelCode), false,
        '★ 内核不得自带取数点（否则口径与取数各一份，必然漂移）');
    /* 反向自证：剥注释必须真的剥掉了东西（防「工具没干活所以看着干净」） */
    assert.ok(stripComments(readRel(KERNEL)).length < readRel(KERNEL).length, '剥注释工具没有生效');
});

test('D2 收集器读的是**已登记键**，不新增命名空间', () => {
    const col = readRel('apps/timeweaver/timeweaver-collector.js');
    assert.match(col, /storage\.get\('calendar_commitments'\)|storage\?\.get\('calendar_commitments'\)/,
        '约定面读既有键（新开键必须先登记，见 keys 门）');
});

test('D3 视图消费内核台账，**不自列面名**、不自拼总述', () => {
    const view = readRel('apps/timeweaver/timeweaver-view.js');
    assert.match(view, /this\._resumeBlock\(m\)/, '续玩简报卡必须真被渲染');
    assert.match(view, /rb\.faceLedger/, '必须消费内核的逐面台账');
    assert.match(view, /rb\.headline/, '总述必须走内核给的唯一实现');
    assert.equal(/RESUME_FACES/.test(view), false, '视图不得引用面清单（那是第二份实现）');
    assert.equal(/还没有可续的剧情/.test(view.split('_resumeBlock')[1] || ''), false,
        '视图不得复述总述文案（文案的唯一实现在内核里）');
});

test('D4 空态也要能看见简报（「没有生活碎片」≠「没有可续的剧情」）', () => {
    const view = readRel('apps/timeweaver/timeweaver-view.js');
    assert.match(view, /_empty\(m\)/, '空态必须带入模型');
    assert.match(view, /const resumeBlock = m \? this\._resumeBlock\(m\) : ''/);
});

/* ══════════ E ── 负控制（真源码破坏 → 临时副本 → 逐字同一段判据必须转红） ══════════ */

function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3200_'));
    for (const rel of ['config', 'apps/timeweaver', 'apps/plotline']) {
        fs.mkdirSync(path.join(dir, rel), { recursive: true });
    }
    for (const name of fs.readdirSync(path.join(ROOT, 'config'))) {
        if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'config', name), path.join(dir, 'config', name));
    }
    for (const sub of ['apps/timeweaver', 'apps/plotline']) {
        for (const name of fs.readdirSync(path.join(ROOT, sub))) {
            if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, sub, name), path.join(dir, sub, name));
        }
    }
    return dir;
}
function damage(dir, rel, anchor, replacement) {
    const p = path.join(dir, rel);
    const txt = fs.readFileSync(p, 'utf8');
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
    fs.writeFileSync(p, txt.split(anchor).join(replacement));
}
/** 同款判据：把**逐字同一段判据**跑在指定模块上，断言不成立即 exit 1。 */
function judgeWith(url, body) {
    return spawnSync(process.execPath, ['-e',
        `import(${JSON.stringify(url)}).then(async (m)=>{ const bad = ${body}; if (bad) process.exit(1); })`],
        { encoding: 'utf8' });
}
const K_URL = (root) => pathToFileURL(path.join(root, KERNEL)).href;
const STALE_INPUT = `{ evidence: { state: 'ok', items: [{ title: 'f', floor: 30, ledger: 'a', ledgerLabel: 'A' }] }, commitments: { version: 1, items: [] }, worldProgress: [], storyClock: { present: true, verdict: 'x' }, updateGap: { state: 'clear' }, floorCount: 10, at: 1 }`;

test('E1 拆掉「挡未来事实」⇒ 不可达楼层进了简报 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.resumeBrief(${STALE_INPUT}).dropped.staleFloors !== 1)`;
    assert.equal(judgeWith(K_URL(ROOT), body).status, 0, '对照：真源码下该行确实被挡下并计数');
    damage(dir, KERNEL,
        '                if (floor !== null && floorCount !== null && floor >= floorCount) { dropped.staleFloors += 1; continue; }',
        '                if (false && floor !== null && floorCount !== null && floor >= floorCount) { dropped.staleFloors += 1; continue; }');
    assert.equal(judgeWith(K_URL(dir), body).status, 1,
        '★ 破坏后回档带来的未来事实会进简报 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('E2 让「确实为空」也记缺口 ⇒ 真读数被说成「读不到」⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.resumeBrief({ evidence: { state: 'empty', items: [] }, commitments: { version: 1, items: [] }, worldProgress: [], storyClock: { present: true, verdict: 'x' }, updateGap: { state: 'clear' } }).gaps.length !== 0)`;
    assert.equal(judgeWith(K_URL(ROOT), body).status, 0, '对照：面在且为空时不该有缺口');
    damage(dir, KERNEL,
        "            /* 面在、确实没有条目 ⇒ **不是** gap（真读数：等剧情推进），也不允许填占位句。 */",
        "            gaps.push({ face: 'evidence', reason: 'empty' });");
    assert.equal(judgeWith(K_URL(dir), body).status, 1,
        '★ 破坏后「确实为空」被记成缺口 ⇒ 两种处置相反的处境同形 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('E3 让空简报也给绿灯 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(/全部就绪/.test(m.resumeBrief({}).headline))`;
    assert.equal(judgeWith(K_URL(ROOT), body).status, 0, '对照：零项时不得出现「全部就绪」');
    damage(dir, KERNEL,
        "        bits.push('续玩简报：本机还没有可续的剧情');",
        "        bits.push('续玩简报：全部就绪');");
    assert.equal(judgeWith(K_URL(dir), body).status, 1,
        '★ 破坏后零项给了绿灯 ⇒ 把未发生的好消息当结论 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('E4 让楼层取不到时补 0 ⇒ 「没给」被读成「第 0 楼」⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.resumeBrief({ evidence: { state: 'ok', items: [{ title: 'x', floor: null, ledger: 'a', ledgerLabel: 'A' }] }, commitments: { version: 1, items: [] }, worldProgress: [], storyClock: { present: true, verdict: 'x' }, updateGap: { state: 'clear' }, floorCount: 50, at: 1 }).sections[0].rows[0].floor !== null)`;
    assert.equal(judgeWith(K_URL(ROOT), body).status, 0, '对照：取不到 ⇒ null');
    damage(dir, KERNEL,
        '    const n = numOrNull(v);\n    return (n !== null && Number.isInteger(n) && n >= 0) ? n : null;',
        '    const n = numOrNull(v);\n    return (n !== null && Number.isInteger(n) && n >= 0) ? n : 0;');
    assert.equal(judgeWith(K_URL(dir), body).status, 1,
        '★ 破坏后「楼层未知」被写成「第 0 楼」⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('E5 破坏可观测自证：真源码与破坏副本必须逐字节不同（否则这一组是假绿）', () => {
    const dir = sandbox();
    damage(dir, KERNEL, '    const gaps = [];', '    const gaps = [];  /* damaged */');
    assert.notEqual(readRel(KERNEL), fs.readFileSync(path.join(dir, KERNEL), 'utf8'),
        '破坏没有真正写进副本');
    /* 正向对照：同一个破坏副本仍应能正常导出（说明破坏本身不致命，转红只可能来自判据面） */
    const ok = judgeWith(K_URL(dir), '(typeof m.resumeBrief !== "function")');
    assert.equal(ok.status, 0, '破坏副本本身必须仍可导入，否则负控制验的是「跑不起来」而不是判据');
    fs.rmSync(dir, { recursive: true, force: true });
});

/* ══════════ F ── 版本锚 ══════════ */
test('F1 五源同源（下限形）', () => {
    const idx = readRel('index.js');
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const mv = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx)[1];
    assert.ok(/^3\.(1[89]|[2-9]\d)\./.test(mv), '本套件成立于 RubyPhone 3.19.0 及以后，当前 ' + mv);
    assert.equal(man.version, mv, 'manifest 与入口同源');
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(log.versions[mv], 'update-log 必须有当版条目');
});