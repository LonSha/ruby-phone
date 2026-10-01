/**
 * smoke_assert3350.mjs — 把 Pixiv 冒烟从「打印读数」升成**硬门禁**。
 *
 * ★ 为什么要这层壳：`tools/smoke3350.mjs` 逐项打印读数，一条 `must` 失败只是
 *   多打一行 `✗`；而**任何一处调用炸掉**（如 `PIXIV_COMMENT_DELIM` 漏导入
 *   导致 `ReferenceError`）会让脚本 exit 非零，但从来没人把它当门禁 ——
 *   本次这条真缺陷就是这样漏进来的（`node --check` 全绿、冷路径不报错）。
 *   故 v3.35.0 起：外壳 spawnSync 跑冒烟，三条件同时成立才算过 ——
 *   ① exit code = 0；② 末行逐字等于 `SMOKE-3350 ALL GREEN`；③ 全程无 `✗`。
 *
 * ★ 契约探针：再逐个核对「本件对外声明的符号真的可用」——
 *   这一栏专抓 `export` 了但**通路断开**（漏导入 / 名字写错 / 被后写的定义覆盖）
 *   这类不报错、只是拿不到的形态。
 *
 * 用法：node tools/smoke_assert3350.mjs
 * 断言失败即 exit 1（**不用 try/catch 吞**）。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const bad = [];
const say = (k, v) => { console.log((bad.length ? '· ' : '✓ ') + k + (v === undefined ? '' : ' — ' + v)); };

/* ── ① 跑冒烟，三条件 ───────────────────────────────────── */
const r = spawnSync(process.execPath, [join(HERE, 'smoke3350.mjs')], { encoding: 'utf8', timeout: 120000 });
const out = (r.stdout || '') + (r.stderr || '');
const tailLine = (r.stdout || '').trim().split('\n').pop() || '';
if (r.status !== 0) bad.push('smoke exit=' + r.status + '（应为 0）');
if (tailLine !== 'SMOKE-3350 ALL GREEN') bad.push('冒烟末行不是 ALL GREEN，实为 ' + JSON.stringify(tailLine));
const crossCount = (out.match(/✗/g) || []).length;
if (crossCount !== 0) bad.push('冒烟里有 ' + crossCount + ' 处 ✗');
say('冒烟硬断言 exit=0 / 末行 ALL GREEN / 无 ✗', 'exit=' + r.status + ' cross=' + crossCount);

/* ── ② 契约探针：数据层 export 逐个可真取 ────────────────── */
const data = await import(join(ROOT, 'apps/pixiv/pixiv-data.js'));
const MUST_EXPORT = [
    'PIXIV_ACTIVE_TYPES', 'PIXIV_IDLE_TYPES', 'PIXIV_TYPE_LABELS', 'PIXIV_BUILT_IN_AUTHORS',
    'PIXIV_WRITING_STYLES', 'PIXIV_LANGUAGE_MODES', 'PIXIV_PURITY_RULE', 'PIXIV_REASONS',
    'PIXIV_LIMITS', 'PIXIV_ALLOWED_TAGS', 'PIXIV_ALLOWED_ATTRS', 'PIXIV_COMMENT_DELIM',
    'isActivePixivType', 'readPixivFace', 'normalizeWritingStyles', 'defaultPixivSettings',
    'normalizePixivSettings', 'clampInt', 'normalizeComment', 'normalizeChapter', 'normalizeNovel',
    'normalizeIllust', 'coldOfNovelId', 'deriveHeatBase', 'deriveChapterHearts',
    'initNovelPopularity', 'heartsFace', 'topAncestorId', 'buildCommentTree', 'flattenComments',
    'commentCountFace', 'chapterIdentityFace', 'totalWords', 'readingMinutes', 'visibleNovels',
    'novelsOfTag', 'groupByMonth', 'searchNovels', 'snippetOf', 'prevChapterContext',
    'nextChapterNum', 'chapterPositionFace', 'sanitizeBody', 'toDisplayParagraphs',
    'parseCommentsBlock',
];
const missingData = MUST_EXPORT.filter((k) => data[k] === undefined);
if (missingData.length) bad.push('数据层声明了却取不到：' + missingData.join(' / '));
say('数据层契约 ' + MUST_EXPORT.length + ' 个符号全部可取', '缺 ' + missingData.length + ' 个');

/* ── ③ 契约探针：App 层对外方法逐个存在（**且真调一次不炸**） ── */
const appMod = await import(join(ROOT, 'apps/pixiv/pixiv-app.js'));
const PixivApp = appMod.PixivApp;
if (typeof PixivApp !== 'function') bad.push('PixivApp 不是可构造的类');
const MUST_METHOD = [
    'probe', 'faceReason', 'projection', 'readings', 'limits', 'stored', 'summaryLine',
    'faceOf', 'statsOf', 'tab', 'setTab', 'onChatChanged', 'render',
    'authorsAll', 'authorsActive', 'addAuthor', 'novelById', 'chaptersOf', 'chapterAt',
    'createNovel', 'ingestChapter', 'nextNumOf', 'prevContextOf', 'heartsOf', 'positionOf',
    'commentTreeOf', 'commentCountOf', 'addComment', 'ingestComments', 'ingestCommentsText',
    'toggleChapterLike', 'subscribeTag', 'ingestIllust', 'illustById', 'sanitize', 'paragraphsOf',
    'copyPrompt', 'recommendAuthors', 'recommendFace', 'patchSettings', 'saveSettings',
    'addStyle', 'removeStyle', 'toggleStyle', 'setCompleted',
];
const proto = PixivApp && PixivApp.prototype ? PixivApp.prototype : {};
const missingM = MUST_METHOD.filter((k) => typeof proto[k] !== 'function');
if (missingM.length) bad.push('App 声明了却没实现：' + missingM.join(' / '));
say('App 层契约 ' + MUST_METHOD.length + ' 个方法全部实现', '缺 ' + missingM.length + ' 个');

/* 真调一次：拿一个内存 storage 把所有**无参可调**的读数面走一遍（不吞异常） */
const mem = (() => {
    const m = new Map();
    return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); } };
})();
const app = new PixivApp(null, mem);
app.probe();
const faces = [app.faceReason(), app.limits(), app.readings(), app.stored(), app.summaryLine(), app.statsOf(), app.faceOf()];
if (faces.some((v) => v === undefined)) bad.push('冷启动读数面有 undefined（应各自有形态）');
// ★ 判据口径（v3.35.0 当场踩过）：**storage 可用但没数据**与**storage 用不了**
//   是两回事 —— 前者 face=empty 且照旧现算一份空投影（视图要能渲染空壳），
//   后者才是 face=storage_absent 且投影为 null。首版把两者写成一个断言，
//   产品没错、判据自红。分开守：
if (app.faceReason() !== data.PIXIV_REASONS.empty) bad.push('冷启动应为 empty，实为 ' + app.faceReason());
const proj0 = app.projection();
if (!proj0 || !Array.isArray(proj0.novels) || proj0.novels.length !== 0) bad.push('冷启动应给一份空投影（不是 null）');
const throwStore = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); } };
const badApp = new PixivApp(null, throwStore);
badApp.probe();
if (badApp.faceReason() !== data.PIXIV_REASONS.storage_absent) bad.push('坏 storage 应为 storage_absent，实为 ' + badApp.faceReason());
if (badApp.projection() !== null) bad.push('坏 storage 投影应为 null');
const emptyIngest = app.ingestCommentsText('nope', 1, '  ');
if (emptyIngest.ok !== false) bad.push('空文本回填应被拒');
say('冷启动读数面逐项真调（7 面）', 'undefined ' + faces.filter((v) => v === undefined).length + ' 处');
say('两态分开守：可用的空 storage vs 用不了的 storage', 'empty+空投影 / storage_absent+null');

/* ── ④ 视图层：假面禁止语不得回来 ────────────────────────── */
const viewSrc = (await import('node:fs')).readFileSync(join(ROOT, 'apps/pixiv/pixiv-view.js'), 'utf8');
const FORBIDDEN = ['pxv-cmt-again', 'this._open = this._open'];
const came = FORBIDDEN.filter((s) => viewSrc.indexOf(s) >= 0);
if (came.length) bad.push('视图里假面禁止语回来了：' + came.join(' / '));
say('视图假面禁止语 ' + FORBIDDEN.length + ' 条零命中');

if (bad.length) {
    console.log('\nSMOKE-ASSERT-3350 FAILED：');
    for (const b of bad) console.log('  ✗ ' + b);
    process.exit(1);
}
console.log('\nSMOKE-ASSERT-3350 ALL GREEN');
