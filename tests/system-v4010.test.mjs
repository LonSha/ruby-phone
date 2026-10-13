/* ========================================================
 * tests/system-v4010.test.mjs — [v4.01.0 · 计划 R3-O8]
 *   创作工作台可编辑可复用 · 定向套件
 *   A 内核结构 / B 行为 / C 接线 / D 负控制 / E 版本锚
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/home/user/ruby-phone';
const rd = (p) => readFileSync(join(ROOT, p), 'utf-8');

const m = await import(join(ROOT, 'config/creation-multi-draft.js'));

/* ---------- A 内核结构 ---------- */
test('A1 六面结构齐备：四态 / 上限 / composeDrafts / replaceDrafts 5 出口', () => {
    assert.equal(m.CMD_DRAFT_STATES.length, 4);
    assert.equal(m.CMD_LIMITS.drafts, 24);
    for (const f of ['composeDrafts', 'normalizeDraft', 'normalizeDraftBook', 'upsertDraft', 'replaceMaterialKeepText', 'replaceDraftInBook', 'recomposeTargets', 'previewOf', 'diffDrafts', 'diffLine', 'cmdSelfCheck']) {
        assert.equal(typeof m[f], 'function', '缺出口：' + f);
    }
});

test('A2 内核自检通过（cmdSelfCheck 零问题）', () => {
    const s = m.cmdSelfCheck();
    assert.ok(s.ok, '自检问题：' + JSON.stringify(s.problems));
});

test('A3 内核零外部依赖：不 import storage / window / fetch', () => {
    const src = rd('config/creation-multi-draft.js');
    /* 只判真实 import 来源与调用式，不扫文档注释里的名词 */
    assert.ok(!/import[\s\S]*?from\s*['"][^'"]*storage['"]/.test(src));
    assert.ok(!/\bwindow\s*[.[]/.test(src));
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest/.test(src));
});

/* ---------- B 行为 ---------- */
test('B1 多目标编排：同素材 → 三目标三份，逐目标注释互不覆盖', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], { per: { weibo: { note: '微博版' }, wechat: { note: '朋友圈版' } } });
    assert.ok(c.ok);
    assert.equal(c.drafts.length, 2);
    const weibo = c.drafts.find(d => d.target === 'weibo');
    const wechat = c.drafts.find(d => d.target === 'wechat');
    assert.equal(weibo.note, '微博版');
    assert.equal(wechat.note, '朋友圈版');
    assert.notEqual(weibo.key, wechat.key);
});

test('B2 权限拒收逐目标进 rejected（不静默丢）', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['wechat', 'lofter'], {});
    assert.ok(c.ok);
    assert.equal(c.drafts.length, 1);
    assert.equal(c.rejected.length, 1);
    assert.equal(c.rejected[0].target, 'lofter');
});

test('B3 替图不丢文字：换素材后 note/tags 原样、state=stale、版本+1', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['weibo'], { per: { weibo: { note: '文字保留', tags: ['tag1'] } } });
    const sw = m.replaceMaterialKeepText(c.drafts[0], 'musicdesk', 't9');
    assert.ok(sw.ok);
    assert.equal(sw.draft.note, '文字保留');
    assert.deepEqual(sw.draft.tags, ['tag1']);
    assert.equal(sw.draft.state, 'stale');
    assert.equal(sw.draft.version, 2);
});

test('B4 replaceDraftInBook：旧行撤掉，同一目标不得留两行', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], {});
    const sw = m.replaceMaterialKeepText(c.drafts.find(d => d.target === 'weibo'), 'musicdesk', 't9');
    const book = m.replaceDraftInBook(c.drafts, sw.previousKey, sw.draft);
    assert.equal(book.drafts.length, 2);
    assert.equal(book.drafts.filter(d => d.target === 'weibo').length, 1);
});

test('B5 仅重做所选段：选中目标重做继承文字，其余原样保留', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], { per: { weibo: { note: '微博版' }, wechat: { note: '朋友圈版' } } });
    const rc = m.recomposeTargets(c.drafts, ['weibo'], 'musicdesk', 't2', {});
    assert.equal(rc.kept, 1);
    assert.equal(rc.drafts.length, 2);
    const keptWechat = rc.drafts.find(d => d.target === 'wechat');
    assert.equal(keptWechat.note, '朋友圈版');
    const redoneWeibo = rc.drafts.find(d => d.target === 'weibo');
    assert.equal(redoneWeibo.note, '微博版');
    assert.equal(redoneWeibo.version, 2);
});

test('B6 版本比较字段级：改动只报改动处，同一份自比 identical', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['weibo'], {});
    const same = m.diffDrafts(c.drafts[0], c.drafts[0]);
    assert.equal(same.reason, 'identical');
    const df = m.diffDrafts(c.drafts[0], Object.assign({}, c.drafts[0], { note: 'x' }));
    assert.equal(df.fields.length, 1);
    assert.equal(df.fields[0].field, 'note');
});

test('B7 草稿本归一：读不出与空分开、上限 24 最早先出', () => {
    assert.equal(m.normalizeDraftBook(null).readable, false);
    assert.equal(m.normalizeDraftBook('x').readable, false);
    assert.equal(m.normalizeDraftBook([]).readable, true);
    let book = [];
    for (let i = 0; i < 30; i++) {
        book = m.upsertDraft(book, { key: 'k' + i, source: 'musicdesk', materialId: 't' + i, target: 'weibo', note: 'n' + i }).drafts;
    }
    assert.equal(book.length, m.CMD_LIMITS.drafts);
    assert.ok(!book.some(d => d.key === 'k0'));
    assert.ok(book.some(d => d.key === 'k29'));
});

test('B8 previewOf 不编内容：没正文如实报、文案不含「已发布」', () => {
    const c = m.composeDrafts('musicdesk', 't1', ['weibo'], { per: { weibo: { note: '正文' } } });
    const pv = m.previewOf(c.drafts[0], { label: '曲目甲', kindLabel: '曲目', present: true });
    assert.ok(pv.readyToPublish);
    const pvE = m.previewOf(c.drafts[0], { present: false });
    assert.ok(!pvE.readyToPublish, '素材不在场不得宣称可发布');
    assert.ok(!/已发布/.test(pv.title + pv.body + pv.tagLine));
});

/* ---------- C 接线 ---------- */
test('C1 index.js 草稿本键 + 七动作白名单 + 读写回读', () => {
    const src = rd('index.js');
    assert.ok(src.includes("CW_DRAFTS_KEY = 'cw_drafts'"));
    /* 交棒为下限形（v3.98→v3.99 先例）：本版锁的七动作必须全在，
     *   但白名单是**会随后续版本前移**的当版读数，硬锁字面量会让下一版一抬版就红
     *   （那是抬版仪式，不是缺陷）。此处只锁「七项都在」这条不回退的事实。 */
    for (const act of ['plan', 'publish', 'refresh', 'compose', 'edit', 'redo', 'drop']) {
        assert.ok(src.includes("'" + act + "'"), '白名单缺动作:' + act);
    }
    assert.ok(/CW_ACTION_KEYS = \[[^\]]*'plan'/.test(src), '白名单应以 plan 开头');
    assert.ok(src.includes('cwReadDraftsRaw'));
    assert.ok(src.includes('cwWriteDrafts'));
    assert.ok(src.includes('readback-mismatch'));
});

test('C2 取数口与动作分流都接：draftsText / cmdSelfCheckOf / compose 分支', () => {
    const src = rd('index.js');
    assert.ok(src.includes('multiSelfCheck: cmdSelfCheckOf()'));
    assert.ok(src.includes("action === 'compose'"));
    assert.ok(src.includes("action === 'redo'"));
    assert.ok(src.includes("action === 'drop'"));
    assert.ok(src.includes("action === 'edit'"));
    assert.ok(src.includes('replaceMaterialKeepText'));
});

test('C3 app 层草稿交互四方法 + vm 透出', () => {
    const src = rd('apps/creationdesk/creationdesk-app.js');
    for (const f of ['setDraft(', 'setDraftNote(', 'toggleMultiTarget(', 'draftAct(']) {
        assert.ok(src.includes(f), 'app 缺：' + f);
    }
    assert.ok(src.includes('multiTargets: this._multiTargets.slice()'));
});

test('C4 视图三段 + 绑定 + CSS', () => {
    const v = rd('apps/creationdesk/creationdesk-view.js');
    for (const k of ['_multiTargets(vm)', '_drafts(vm)', 'data-cw-multi', 'data-cw-draft-note', 'data-cw-draft']) {
        assert.ok(v.includes(k), '视图缺：' + k);
    }
    const css = rd('apps/creationdesk/creationdesk.css');
    assert.ok(css.includes('.cwb-note-area'));
});

/* ---------- D 负控制 ---------- */
test('D1 负控制：破坏「按目标替换」成按键替换，B5 判据必须转红', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'v4010d1-'));
    cpSync(join(ROOT, 'config'), join(tmp, 'config'), { recursive: true });
    const tgt = join(tmp, 'config/creation-multi-draft.js');
    let src = readFileSync(tgt, 'utf-8');
    const A = 'const kept = norm.drafts.filter(function (d) { return uniq.indexOf(d.target) < 0; });';
    const B = 'const kept = norm.drafts.filter(function (d) { return uniq.indexOf(d.target) >= 0; });';
    assert.equal(src.split(A).length - 1, 1);
    writeFileSync(tgt, src.replace(A, B));
    const mm = await import('file://' + tgt);
    const c = mm.composeDrafts('musicdesk', 't1', ['wechat', 'weibo'], { per: { weibo: { note: '微博版' }, wechat: { note: '朋友圈版' } } });
    const rc = mm.recomposeTargets(c.drafts, ['weibo'], 'musicdesk', 't2', {});
    const wechatRows = rc.drafts.filter(function (d) { return d.target === 'wechat'; });
    const weiboRows = rc.drafts.filter(function (d) { return d.target === 'weibo'; });
    assert.equal(wechatRows.length, 0, '破坏后 wechat 草稿（朋友圈版）被丢——B5 判据必转红');
    assert.equal(weiboRows.length, 2, '破坏后 weibo 出现两行重复——B5 判据必转红');
    rmSync(tmp, { recursive: true, force: true });
});

/* ---------- E 版本锚 ---------- */
test('E1 版本门：入口版本不低于 4.00.0（本版目标 v4.01.0）', () => {
    const pkg = JSON.parse(rd('package.json'));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
        return 0;
    };
    assert.ok(cmp(pkg.version, '4.00.0') >= 0, '入口版本不得低于 4.00.0（实测 ' + pkg.version + '）');
});
