/* ========================================================
 * system-v4111.test.mjs — [v4.110.0 · 第十三期 R13-X2] 模糊回忆「那次约摸在…… 到底是什么时候」
 * --------------------------------------------------------
 * 本套件守的是 R13-X2 的六条验收（计划书 §1 该项原文 + §5 共同验收）：
 *   A 拆条件：问句 → 时间 / 天气 / 人物 / 语义残余，**五种处境各不相同**；
 *   B 判定：天气是硬条件、时间读不出不误杀、人物只认原名；
 *   C 归并：同一份数据跑两次**逐字相同**；
 *   D 自检：每条命中必须说得出为什么（`why` 空 = 没命中），没听懂的解不许带结果出门；
 *   E 接线：真入口在 `apps/search`（App 一个方法 + 视图一个折叠区），且**折叠着不算**；
 *   F 负控制：把「为什么」抹掉 / 把代词猜成具体人 / 把相对指代切成硬区间 —— 判据都必须转红。
 *
 * 【为什么负控制用真源码破坏而不是造个假对象】造假对象只能证明「我写的判据认识我写的假数据」，
 *   证明不了真源码里有这条规矩。故 F 组一律：读真文件 → 定点破坏（锚点必须恰中一次）
 *   → 落到临时树 → 在副本上重跑**同一份判据**。
 * ============================================================ */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-04T12:00:00');
const temps = [];
process.on('exit', () => { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 清理失败不影响结论 */ } } });

const V = await import(path.join(ROOT, 'config', 'vague-recall.js'));
const B = await import(path.join(ROOT, 'config', 'vague-recall-batch.js'));
const TM = await import(path.join(ROOT, 'config', 'vague-recall-terms.js'));

/** 一行固定的假数据（不放太多噪声：判据要能被读出来，而不是被堆死）。 */
function fixture() {
    return [
        { title: '雨天搬家', body: '那天雨很大，她说要搬家，我们忙了一整天', ts: NOW - 5 * 86400000, sourceId: 'wechat-chat', appId: 'wechat' },
        { title: '晴天散步', body: '那天很晴，只是散步，没提搬家', ts: NOW - 5 * 86400000, sourceId: 'diary', appId: 'diary' },
        { title: '很早的雨', body: '她提到下雨，也说搬家，但那是很久以前', ts: NOW - 400 * 86400000, sourceId: 'diary', appId: 'diary' },
        { title: '没有时间的旧事', body: '她说下雨那天搬家的事，我不知道是哪天', sourceId: 'memory', appId: 'memory' },
        { title: '带天气字段', body: '她记了一段流水账', weather: '小雨', ts: NOW - 3 * 86400000, sourceId: 'diary', appId: 'diary' }
    ];
}

/* ══════════ A 拆条件 ══════════ */

test('A1 词表与闭集：命中因由四类、状态两态，且零 import 的业务依赖', () => {
    assert.deepEqual([...TM.VAGUE_WHY_KINDS], ['weather', 'time', 'actor', 'keyword']);
    assert.equal(Object.keys(TM.VAGUE_STATES).length, 2);
    assert.equal(TM.VAGUE_STATES.ok, 'ok');
    assert.equal(TM.VAGUE_STATES.unresolved, 'unresolved');
    /* 词表件必须是**零 import 叶子**：词表一旦引了别处，改词就可能连带改算法。 */
    const src = fs.readFileSync(path.join(ROOT, 'config', 'vague-recall-terms.js'), 'utf8');
    assert.equal(/^\s*import\s/m.test(src), false, '词表件不许 import 任何东西');
});

test('A2 拆条件：天气 / 相对指代 / 代词 / 语义残余四格各自落位且互不同形', () => {
    const c = V.parseVague('上次她说下雨那天搬家', { now: NOW, knownActors: ['林安安'] });
    assert.equal(c.ok, true);
    assert.deepEqual([...c.weatherKinds], ['rain']);
    assert.deepEqual([...c.weatherWords], ['下雨']);
    assert.equal(c.softTime, '上次', '「上次」是相对指代');
    assert.equal(c.from, null, '相对指代**不许**切成硬区间');
    assert.equal(c.toExcl, null);
    assert.equal(c.pronoun, '她', '代词要认出来（认出来才好如实说不猜）');
    assert.equal(c.actor, '', '代词**不许**被换算成人名');
    assert.ok(c.rest.length >= 1, '语义残余要留住「那天搬家」这类块');
    /* 相对指代与代词各自都要在 gaps 里说一句 —— 不让用户以为「筛过了」。 */
    const kinds = c.gaps.map((g) => g.kind);
    assert.ok(kinds.includes('soft-time'), '相对指代必须进 gaps');
    assert.ok(kinds.includes('pronoun'), '代词必须进 gaps');
});

test('A3 能切硬区间的词真切、且上界是闭开（今天不算在「这几天」里）', () => {
    const c = V.parseVague('这几天她说下雨', { now: NOW, knownActors: ['林安安'] });
    assert.equal(c.ok, true);
    assert.equal(c.timeWord, '这几天');
    assert.ok(c.from, '硬区间要有起点');
    assert.ok(c.toExcl, '硬区间要有闭开上界');
    assert.equal(c.from, '2026-10-28', '七天前');
    assert.equal(c.toExcl, '2026-11-04', '上界 = 今天零点（不含）');
});

test('A4 只有代词 / 只有相对指代时**不许**当条件成立（否则「上次」= 全部记录）', () => {
    const c1 = V.parseVague('上次', { now: NOW });
    assert.equal(c1.ok, false);
    assert.equal(c1.state, 'unresolved');
    assert.ok(c1.gaps.some((g) => g.kind === 'no-condition'));
    const c2 = V.parseVague('她', { now: NOW });
    assert.equal(c2.ok, false, '只有代词不算条件');
    const c3 = V.parseVague('', { now: NOW });
    assert.equal(c3.ok, false);
    /* ★ 三者的 gaps 不能塌成同一句：没听懂的原因不同，处置也不同。 */
    assert.notEqual(c1.gaps.map((g) => g.kind).join(','), c3.gaps.map((g) => g.kind).join(','));
});

test('A5 人名只认 given knownActors 的原名，最长优先；缺席则不按人名筛', () => {
    const c = V.parseVague('林安安还款那天下雨', { now: NOW, knownActors: ['林安', '林安安'] });
    assert.equal(c.actor, '林安安', '最长优先');
    const c2 = V.parseVague('林安安还款那天下雨', { now: NOW });
    assert.equal(c2.actor, '');
    assert.ok(c2.gaps.some((g) => g.kind === 'no-actor'));
    assert.equal(c2.ok, true, '人名缺席不挡其余条件');
});

/* ══════════ B 判定 ══════════ */

test('B1 天气是硬条件：认得出天气却不是要的那种 ⇒ 排除', () => {
    const cond = V.parseVague('下雨', { now: NOW });
    const sunny = { title: '晴天散步', body: '那天很晴，散步', ts: NOW };
    assert.equal(V.matchRow(sunny, cond).hit, false, '晴天行不许命中「下雨」');
    const rainy = { title: '雨天', body: '那天下雨', ts: NOW };
    assert.equal(V.matchRow(rainy, cond).hit, true);
    /* 认得出天气的另一条路：源自带的 weather 字段 */
    const field = { title: '流水', body: '记了一段', weather: '小雨', ts: NOW };
    assert.equal(V.matchRow(field, cond).hit, true, 'weather 字段也要认');
});

test('B2 时间读不出的行**不因时间被误杀**（同 search-facets 口径）', () => {
    const cond = V.parseVague('这几天下雨', { now: NOW });
    assert.ok(cond.from);
    const noTs = { title: '没有时间的旧事', body: '那天下雨', sourceId: 'memory' };
    const r = V.matchRow(noTs, cond);
    assert.equal(r.hit, true, '读不出时间不等于不在区间里');
});

test('B3 每次命中都必须交出「为什么」：hit 当且仅当 why 非空', () => {
    const cond = V.parseVague('下雨搬家', { now: NOW });
    const rows = fixture();
    for (const row of rows) {
        const r = V.matchRow(row, cond);
        assert.equal(r.hit, r.why.length > 0, '命中与因由必须同生同灭：' + String(row.title));
        for (const w of r.why) {
            assert.ok(TM.VAGUE_WHY_KINDS.includes(w.kind), '因由类别在闭集里');
            assert.ok(String(w.text || '').trim(), '因由要写成人话');
            assert.ok(String(w.hit || '').trim(), '因由要说是哪个词');
        }
    }
});

/* ══════════ C 归并 ══════════ */

test('C1 同一份数据跑两次逐字相同（确定性排序）', () => {
    const cond = V.parseVague('上次下雨搬家', { now: NOW });
    const a = B.recallRows(fixture(), cond, { now: NOW });
    const b = B.recallRows(fixture(), cond, { now: NOW });
    assert.equal(JSON.stringify(a), JSON.stringify(b), '两次必须逐字相同');
    assert.ok(a.total >= 2, '应该有命中');
});

test('C2 排序：命中条件多者优先，其次时间新者优先', () => {
    const cond = V.parsePause ? V.parseVague('这几天下雨搬家', { now: NOW }) : V.parseVague('这几天下雨搬家', { now: NOW });
    const res = B.recallRows(fixture(), cond, { now: NOW });
    assert.ok(res.rows.length >= 1);
    for (let i = 1; i < res.rows.length; i++) {
        const prev = res.rows[i - 1];
        const cur = res.rows[i];
        assert.ok(prev.why.length >= cur.why.length, '命中条件多的排前面');
    }
});

/* ══════════ D 自检 ══════════ */

test('D1 真结果过自检；四类破坏都要被 auditRecall 逮到', () => {
    const cond = V.parseVague('下雨搬家', { now: NOW });
    const res = B.recallRows(fixture(), cond, { now: NOW });
    assert.equal(B.auditRecall(res).ok, true, '真结果必须过');

    const noWhy = JSON.parse(JSON.stringify(res));
    noWhy.rows[0].why = [];
    assert.equal(B.auditRecall(noWhy).ok, false, '抹掉 why 必须转红');

    const badKind = JSON.parse(JSON.stringify(res));
    badKind.rows[0].why[0].kind = '猜的';
    assert.equal(B.auditRecall(badKind).ok, false, '闭集外的因由必须转红');

    const noText = JSON.parse(JSON.stringify(res));
    noText.rows[0].why[0].text = '';
    assert.equal(B.auditRecall(noText).ok, false, '因由没说成人话必须转红');

    const leak = JSON.parse(JSON.stringify(res));
    leak.ok = false;
    assert.equal(B.auditRecall(leak).ok, false, '没听懂的解带结果出门必须转红');
});

test('D2 没听懂的解：一行结果都不许带（含 total 为 0）', () => {
    const cond = V.parseVague('上次', { now: NOW });
    const res = B.recallRows(fixture(), cond, { now: NOW });
    assert.equal(res.ok, false);
    assert.equal(res.rows.length, 0);
    assert.equal(res.total, 0);
    assert.equal(B.auditRecall(res).ok, true, '空解本身是诚实的');
});

test('D3 一句话读数：说得出按什么条件找的，也报得出翻了多少条', () => {
    const cond = V.parseVague('下雨搬家', { now: NOW });
    const res = B.recallRows(fixture(), cond, { now: NOW });
    const line = B.vagueLine(cond, res);
    assert.ok(line.includes('天气'), '要点名天气条件');
    assert.ok(line.includes('条'), '要报条数');
    assert.ok(line.includes(String(res.scanned)), '要报翻了多少条');
});

/* ══════════ E 接线 ══════════ */

test('E1 真入口：App 有 vagueRecall、视图有折叠区，且都引的是这两件内核', () => {
    const app = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-app.js'), 'utf8');
    const view = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-view.js'), 'utf8');
    assert.ok(app.includes('vagueRecall('), 'App 必须有 vagueRecall 方法');
    assert.ok(app.includes("from '../../config/vague-recall.js'"), 'App 要引判定件');
    assert.ok(app.includes("from '../../config/vague-recall-batch.js'"), 'App 要引归并件');
    assert.ok(view.includes('_vagueHtml('), '视图必须有折叠区渲染');
    assert.ok(view.includes('gs-vague-toggle'), '折叠开关要有真 id');
});

test('E2 折叠着的时候**一次都不算**（算力只在用户主动要时才花）', () => {
    const view = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-view.js'), 'utf8');
    /* 结构断言：`if (!open) return head + '</div>';` 必须**在**调 vagueRecall 之前。 */
    const iOpen = view.indexOf('if (!open) return head');
    const iCall = view.indexOf('this.app.vagueRecall?.(kw)');
    assert.ok(iOpen > 0 && iCall > 0);
    assert.ok(iOpen < iCall, '收起时必须早返回，不许先算再藏');
});

test('E3 只在有关键词时出现（空面板不许摆一栏「模糊回忆」）', () => {
    const view = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-view.js'), 'utf8');
    const i = view.indexOf('_vagueHtml()');
    const seg = view.slice(i, i + 260);
    assert.ok(/if \(!kw\) return ''/.test(seg), '空关键词必须早返回空串');
});

test('E4 索引读不出来与「没有这段」不同形（readError 要能传到界面）', () => {
    const app = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-app.js'), 'utf8');
    const view = fs.readFileSync(path.join(ROOT, 'apps', 'search', 'search-view.js'), 'utf8');
    assert.ok(app.includes('readError'), 'App 要记索引读失败');
    assert.ok(view.includes('res.readError'), '视图要把它摆出来');
    assert.ok(view.includes('这不等于没有这段'), '文案必须明说「不等于没有」');
});

/* ══════════ F 负控制（真源码破坏） ══════════ */

/** 造一棵真目录结构的暂存树（副本按真相对路径落盘，相对 import 才解得了）。
 * ★ 依赖清单是**手工白名单**：本组要测的两件内核所 import 的每一件都得在树里，
 *   少一件就是 MODULE_NOT_FOUND —— 那时判据根本没跑到，破坏有没有发生已经不重要了（典型假红）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4111_'));
    temps.push(dir);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const f of ['num-gate.js', 'search-facets.js', 'vague-recall.js', 'vague-recall-terms.js', 'vague-recall-batch.js']) {
        fs.copyFileSync(path.join(ROOT, 'config', f), path.join(dir, 'config', f));
    }
    return dir;
}

/** 定点破坏：锚点必须恰中一次，否则「破坏」本身就不确定在破什么。 */
function damage(rel, from, to) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '破坏锚点必顶恰中一次：' + rel + ' -> ' + String(n) + ' 次');
    const dir = stageTree();
    fs.writeFileSync(path.join(dir, rel), src.split(from).join(to), 'utf8');
    return dir;
}

test('F1 破坏「说不出为什么 = 没命中」（失败分支交出 why）⇒ B3 判据必须转红', async () => {
    /* 真源码破坏：把失败分支 `why: []` 改回 `why: why`（等于交回已攒下的部分因由）。
     * ★ 这正是本轮自己抓到的那个缺陷形态：早先版本这么写，于是出现「hit:false 却带一条 why」的行。 */
    const dir = damage('config/vague-recall.js',
        "        if (!got) return { hit: false, why: [] };",
        "        if (!got) return { hit: false, why: why };");
    const mod = await import(path.join(dir, 'config', 'vague-recall.js'));
    /* 一条**先命中天气、再在关键词上失败**的行 —— 只有这种行才会攒下一条 why。 */
    const row = { title: '雨天的散步', body: '那天下雨，但只散了步', ts: NOW };
    const cond = V.parseVague('下雨搬家', { now: NOW });
    const condBroke = mod.parseVague('下雨搬家', { now: NOW });
    /* 原版：失败分支交回空 why（B3 的断言成立）。 */
    const real = V.matchRow(row, cond);
    assert.equal(real.hit, false);
    assert.equal(real.why.length, 0, '原版：没命中就不许留任何因由');
    assert.equal(real.hit, real.why.length > 0, 'B3 的断言在原版上成立');
    /* 破坏版：仍然不算命中，却交回一条 why —— B3 的断言**不成立**。 */
    const broke = mod.matchRow(row, condBroke);
    assert.equal(broke.hit, false, '仍然不算命中');
    assert.ok(broke.why.length > 0, '破坏后被交出了部分因由（证明破坏生效）');
    assert.notEqual(broke.hit, broke.why.length > 0, 'B3 的断言在破坏版上必须不成立');
});

test('F2 破坏「相对指代不许切硬区间」⇒ 解析结果必须与真身不同', async () => {
    /* 这是最容易被后来者「顺手优化」掉的一处：它看着像少做了一步。 */
    const dir = damage('config/vague-recall.js',
        "gaps.push({ kind: 'soft-time', why: '「' + w + '」是相对指代，没切具体区间（只在排序上偏向近期）' });",
        "out.from = isoOf(new Date(nowMs - 30 * 86400000)); out.toExcl = isoOf(new Date(nowMs)); gaps.push({ kind: 'soft-time', why: '切了' });");
    const mod = await import(path.join(dir, 'config', 'vague-recall.js'));
    const broke = mod.parseVague('上次下雨', { now: NOW });
    assert.ok(broke.from, '破坏后「上次」被硬切成区间（证明破坏生效）');
    const real = V.parseVague('上次下雨', { now: NOW });
    assert.equal(real.from, null, '真身里「上次」不设区间');
    assert.equal(real.toExcl, null);
    assert.notEqual(broke.from, real.from, '破坏版与真身必须不同形');
});

test('F3 破坏「代词不许猜成人名」⇒ 代词会被当成已知人物', async () => {
    const dir = damage('config/vague-recall.js',
        "gaps.push({ kind: 'pronoun', why: '「' + p + '」指谁我不猜 —— 只按其余条件找，你看着对不对' });",
        "out.actor = p; gaps.push({ kind: 'pronoun', why: '猜了' });");
    const mod = await import(path.join(dir, 'config', 'vague-recall.js'));
    const broke = mod.parseVague('她说下雨', { now: NOW });
    assert.equal(broke.actor, '她', '破坏后代词被当成了人名（证明破坏生效）');
    assert.equal(V.parseVague('她说下雨', { now: NOW }).actor, '', '真身里代词不许进 actor');
});

test('F4 破坏「天气是硬条件」⇒ 晴天行会被误命中', async () => {
    /* 条件必须同时含天气与一个残余词，才能看出「硬筛」与「不筛」的差别：
     * 只打「下雨」时晴天行本来就一条条件都不满足，破坏了也看不出来。 */
    const dir = damage('config/vague-recall.js',
        'if (!hit.length) return { hit: false, why: [] };',
        'if (!hit.length) { /* 破坏：不排除 */ }');
    const mod = await import(path.join(dir, 'config', 'vague-recall.js'));
    const sunny = { title: '晴天散步', body: '那天很晴，只是散步', ts: NOW };
    const condReal = V.parseVague('下雨散步', { now: NOW });
    const condBroke = mod.parseVague('下雨散步', { now: NOW });
    assert.equal(V.matchRow(sunny, condReal).hit, false, '原版：晴天行必须被天气筛掉');
    assert.equal(mod.matchRow(sunny, condBroke).hit, true, '破坏版：晴天行被误命中（证明破坏生效）');
});

test('F5 破坏「residual 覆盖率阈值」⇒ 阈值提到全覆盖后真命中必须被判掉', async () => {
    /* ★ 破坏方向的选择本身就是一条经验：把阈值改 **0** 会让两侧都命中（「不同形」不成立），
     *   那不是判据没用，是破坏选错了方向。必须选一条**跨在阈值两侧**的行，并把阈值推向**更严**。 */
    const row = { title: '无题', body: '搬家那天很累，别的什么都没提', ts: NOW };
    /* 残余词取全串，令它与 `row` 的 bigram 覆盖恰在 0.5 附近。 */
    const q = '搬家很累那天';
    const realCond = V.parseVague(q, { now: NOW });
    const realHit = V.matchRow(row, realCond).hit;

    /* 方向一：阈值提到 1（要求全覆盖）⇒ 原版命中的行必须被判掉。 */
    const dirHigh = damage('config/vague-recall.js',
        'if (ratio >= VAGUE_LIMITS.restCover) {', 'if (ratio >= 1) {');
    const modHigh = await import(path.join(dirHigh, 'config', 'vague-recall.js'));
    const highHit = modHigh.matchRow(row, modHigh.parseVague(q, { now: NOW })).hit;
    assert.equal(realHit, true, '原版：覆盖率过半要算「提过」');
    assert.equal(highHit, false, '阈值提到 1 后必须判掉（证明阈值真管事）');
});
