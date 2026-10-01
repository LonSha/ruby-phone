// tools/probe3350d.mjs — 量清首轮自红的全部真因（判据侧 vs 产品侧）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/ruby-phone';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PX_APP = 'apps/pixiv/pixiv-app.js';
const PX_DATA = 'apps/pixiv/pixiv-data.js';
const PX_VIEW = 'apps/pixiv/pixiv-view.js';
const PX_CSS = 'apps/pixiv/pixiv.css';

const DAT = await import(path.join(ROOT, PX_DATA));
const { PixivApp } = await import(path.join(ROOT, PX_APP));

function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return { get: (k) => (box.has(k) ? box.get(k) : null), set: (k, v) => { box.set(k, v); }, _box: box };
}

console.log('=== T1：dataProblems(DAT) 在真模块上到底报了什么 ===');
{
    const bad = [];
    if (DAT.normalizeChapter({ num: 'nope', content: 'x' }, 4).num !== null) bad.push('bad-num-filled');
    if (DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num !== 0) bad.push('zero-num-coerced');
    const nv = DAT.normalizeNovel({ id: 'n', chapters: [{ num: 1, content: 'a' }, { num: 'bad', content: 'b' }] });
    if (nv.chapters.length !== 2) bad.push('bad-num-chapter-dropped');
    const onlyBad = DAT.normalizeNovel({ id: 'n', hearts: 500, chapters: [{ num: 'bad', content: 'a' }] });
    if (onlyBad.hearts === 0 && 500 > 0) bad.push('cache-hearts-zeroed-by-bad-num');
    const want = DAT.PIXIV_ACTIVE_TYPES.concat(DAT.PIXIV_IDLE_TYPES);
    const got = Object.keys(DAT.PIXIV_TYPE_LABELS);
    if (got.length !== want.length || got.some((k, i) => k !== want[i])) bad.push('labels-keys-handwritten');
    const nrt = DAT.commentCountFace({});
    const fl = DAT.commentCountFace({ commentsAttempted: true, commentsFailed: true });
    if (nrt.face === fl.face) bad.push('failed-collides-with-not-read');
    if (DAT.commentCountFace({ commentsLoaded: true, commentsList: [] }).count !== 0) bad.push('read-zero-count-not-zero');
    const chain = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + (i + 1), content: 'x', replyToCommentId: i ? 'c' + i : null }));
    const rows = DAT.flattenComments(DAT.buildCommentTree(chain, 3).roots[0] || {});
    if (rows.length && Math.max.apply(null, rows.map((r) => r.depth)) > 3) bad.push('comment-depth-unbounded');
    if (DAT.readPixivFace({ novels: [], illustrations: [] }) !== DAT.PIXIV_REASONS.empty) bad.push('face-empty-broken');
    if (DAT.readPixivFace(null) !== DAT.PIXIV_REASONS.storage_absent) bad.push('face-absent-broken');
    console.log('  →', bad.length ? bad.join(' , ') : '（干净）');
    console.log('  onlyBad.hearts =', onlyBad.hearts, '（期望 500）');
    console.log('  label keys  =', got.join(','), '| want =', want.join(','));
}

console.log('');
console.log('=== T2：视图里 recommendAuthors / recommendFace 出现次数 ===');
{
    const v = read(PX_VIEW);
    const cnt = (s) => v.split(s).length - 1;
    console.log('  app.recommendAuthors( →', cnt('app.recommendAuthors('));
    console.log('  app.recommendFace(   →', cnt('app.recommendFace('));
    console.log('  pxv-cmt-again        →', cnt('pxv-cmt-again'));
    console.log('  this._open = this._open →', cnt('this._open = this._open'));
    const i = v.indexOf('app.recommendAuthors(');
    console.log('  上下文 =', JSON.stringify(v.slice(Math.max(0, i - 120), i + 160)));
}

console.log('');
console.log('=== T3：App 里 _readRaw 出现次数与定义 ===');
{
    const s = read(PX_APP);
    const cnt = s.split('_readRaw(').length - 1;
    console.log('  _readRaw( →', cnt, '次');
    const i = s.indexOf('    _readRaw(');
    console.log('  定义 =', JSON.stringify(s.slice(i, i + 500)));
    const probeI = s.indexOf('probe()');
    console.log('  probe =', JSON.stringify(s.slice(probeI, probeI + 900)));
}

console.log('');
console.log('=== T4：novelsAll / novelById / probe / readings 实现 ===');
{
    const s = read(PX_APP);
    for (const key of ['novelById(', 'novelsAll(', 'statsOf(', 'probe()']) {
        const i = s.indexOf('    ' + key);
        console.log('  --- ' + key + ' ---');
        console.log(JSON.stringify(s.slice(i, i + 420)));
    }
}

console.log('');
console.log('=== T5：css 里的候选类名 ===');
{
    const css = read(PX_CSS);
    const noCm = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = [...new Set(noCm.match(/\.[a-zA-Z][a-zA-Z0-9_-]*/g) || [])];
    console.log('  剥注释后全部 =', classes.join(' '));
    console.log('  非 .pxv- 的 =', classes.filter((c) => c.indexOf('.pxv-') !== 0).join(' '));
    console.log('  .is-bad 行 =', css.split('\n').filter((l) => l.includes('is-bad')).join(' || '));
}

console.log('');
console.log('=== T6：createNovel 后各种读数 ===');
{
    const app = new PixivApp(null, memStorage());
    app.probe();
    const r = app.createNovel({ title: '草稿篇', tagLine: '純愛' });
    console.log('  novelById →', app.novelById(r.id) ? '有' : '无');
    console.log('  novelsAll.length =', app.novelsAll().length);
    console.log('  readings =', JSON.stringify(app.readings()));
    console.log('  settings.showInvalidNovels =', app.settings ? app.settings.showInvalidNovels : '(no)');
    console.log('  settings keys =', app.settings ? Object.keys(app.settings).join(',') : '(no)');
    const r2 = app.ingestChapter(r.id, '第一話。' + 'あ'.repeat(200));
    console.log('  ingest 后 novelsAll.length =', app.novelsAll().length);
    console.log('  statsOf =', JSON.stringify(app.statsOf(r.id)));
}

console.log('');
console.log('=== T7：互指环的树 ===');
{
    const cyc = [{ id: 'a', content: '1', replyToCommentId: 'b' }, { id: 'b', content: '2', replyToCommentId: 'a' }];
    const t = DAT.buildCommentTree(cyc, 3);
    console.log('  roots =', t.roots.length, 'truncated =', t.truncated, 'orphans =', t.orphans);
    const t2 = DAT.buildCommentTree([{ id: 'a', content: '1', replyToCommentId: 'a' }], 3);
    console.log('  自指单点：roots =', t2.roots.length, 'trunc =', t2.truncated, 'orph =', t2.orphans);
    const t3 = DAT.buildCommentTree([{ id: 'a', content: '1', replyToCommentId: 'b' }], 3);
    console.log('  悬空父：roots =', t3.roots.length, 'orph =', t3.orphans);
}