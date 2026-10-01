// tools/probe3350c.mjs — 量清 tests/system-v3350.test.mjs 首轮自红的真因
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

console.log('=== C1：createNovel 后 novelsAll ===');
{
    const st = sessionStorage();
    const a1 = new PixivApp(null, st);
    a1.probe();
    const r = a1.createNovel({ title: '第一段关系里的作品', tagLine: '純愛' });
    console.log('  createNovel →', JSON.stringify(r));
    console.log('  novelsAll.length =', a1.novelsAll().length);
    console.log('  projection?', a1.projection() ? Object.keys(a1.projection()).join(',') : 'null');
    console.log('  _box keys =', [...st._box.keys()].join(' | '));
    const raw = st._box.get('c1::pixiv_content');
    console.log('  content raw 头 =', raw ? raw.slice(0, 120) : '(none)');
    console.log('  probe 后 novels 内部 =', a1.novels ? a1.novels.length : '(no field)');
    const names = typeof a1._ctxNames === 'function' ? a1._ctxNames() : null;
    console.log('  _ctxNames =', JSON.stringify(names));
}

console.log('');
console.log('=== C1b：memStorage（不换会话）对比 ===');
{
    const st = memStorage();
    const app = new PixivApp(null, st);
    app.probe();
    const r = app.createNovel({ title: 'x', tagLine: '純愛' });
    console.log('  createNovel →', JSON.stringify(r), 'novelsAll =', app.novelsAll().length);
}

console.log('');
console.log('=== E1：App 里 pickDiverseAuthors 调用点原文 ===');
{
    const app = read(PX_APP);
    const idx = app.indexOf('pickDiverseAuthors(');
    while (idx >= 0) {
        console.log('  --- @' + idx + ' ---');
        console.log(JSON.stringify(app.slice(idx, idx + 140)));
        const nx = app.indexOf('pickDiverseAuthors(', idx + 1);
        if (nx === idx) break;
        if (nx < 0) break;
        if (nx === idx) break;
        // 防止死循环
        if (app.slice(idx + 1).indexOf('pickDiverseAuthors(') < 0) break;
        var _tmp = idx;
        idx = nx;
        if (idx <= _tmp) break;
    }
}

console.log('');
console.log('=== H2：copyPrompt 与 PIXIV_PURITY_RULE ===');
{
    console.log('  PURITY_RULE repr =', JSON.stringify(DAT.PIXIV_PURITY_RULE));
    console.log('  slice(0,24) =', JSON.stringify(DAT.PIXIV_PURITY_RULE.slice(0, 24)));
    const st = memStorage();
    const app = new PixivApp(null, st);
    app.probe();
    const r = app.createNovel({ title: 'x', tagLine: '純愛' });
    const n = app.novelById(r.id);
    const jp = app.copyPrompt('chapter', { novel: n, chapterNum: 3, language: 'jp-cn' });
    console.log('  jp.ok =', jp.ok, 'text 长度 =', jp.text ? jp.text.length : 0);
    if (jp.text) {
        console.log('  text 头 200 =', JSON.stringify(jp.text.slice(0, 200)));
        console.log('  含 purity 前 24 =', jp.text.includes(DAT.PIXIV_PURITY_RULE.slice(0, 24)));
        for (const k of ['chapter', 'comment', 'illust', 'sns']) {
            const rr = app.copyPrompt(k, { novel: n, chapterNum: 3, prompt: '海', count: 1, language: 'jp-cn' });
            console.log('  mode ' + k + ' → ok=' + rr.ok + ' len=' + (rr.text ? rr.text.length : 0) +
                ' hasPurity=' + (rr.text ? rr.text.includes(DAT.PIXIV_PURITY_RULE.slice(0, 24)) : 'n/a'));
        }
    }
    /* 看 copyPrompt 的签名与语言取值 */
    const src = read(PX_APP);
    const ci = src.indexOf('copyPrompt(');
    console.log('  copyPrompt 定义原文 =', JSON.stringify(src.slice(ci, ci + 400)));
}

console.log('');
console.log('=== A14：自指数据的树 ===');
{
    const cyc = [{ id: 'a', content: '1', replyToCommentId: 'b' }, { id: 'b', content: '2', replyToCommentId: 'a' }];
    const t = DAT.buildCommentTree(cyc, 3);
    console.log('  roots =', t.roots.length, 'truncated =', t.truncated, 'orphans =', t.orphans);
    console.log('  roots ids =', t.roots.map((x) => x.id).join(','));
    const flat = DAT.flattenComments({ children: t.roots });
    console.log('  flatten 全树 =', flat.length);
}

console.log('');
console.log('=== A7：章号各形态 ===');
{
    for (const v of ['nope', undefined, 0, '3', -5, 1.7, '  7  ', null]) {
        console.log('  num=' + JSON.stringify(v) + ' → ' + JSON.stringify(DAT.normalizeChapter({ num: v, content: 'x' }, 3).num));
    }
}

console.log('');
console.log('=== C5：css 类名（未剥注释） ===');
{
    const css = read(PX_CSS);
    const classes = css.match(/\.[a-zA-Z][a-zA-Z0-9_-]*/g) || [];
    console.log('  全部 =', [...new Set(classes)].join(' '));
    console.log('  非 .pxv- 的 =', [...new Set(classes)].filter((c) => c.indexOf('.pxv-') !== 0).join(' '));
    console.log('  注释行 =', css.split('\n').filter((l) => l.trim().startsWith('/*')).slice(0, 8).map((l) => l.trim()).join(' || '));
}
