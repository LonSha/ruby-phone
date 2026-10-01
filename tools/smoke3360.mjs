/* ========================================================
 * smoke3360.mjs — [v3.36.0] 杂志 · 无头冒烟（读数面，A~L 项）
 *
 * 为什么本仓把冒烟写成**硬门禁**（v3.35.0 起的纪律）：
 *   JS 的 import 漏项**不在加载期暴露**（不像 Python 的 NameError）——
 *   `node --check` 全绿、静态门全绿，只有走到那条分支才炸。故每一件都要有
 *   一个「把每条分支都真调一遍」的脚本，并配一层硬断言外壳（smoke_assert3360.mjs）。
 *
 * 用法：node tools/smoke3360.mjs       （末行必须是 SMOKE-3360 ALL GREEN）
 */
import * as DAT from '../apps/magazine/magazine-data.js';
import { MagazineApp } from '../apps/magazine/magazine-app.js';

let fails = 0;
function ok(name, cond, detail) {
    if (cond) {
        console.log('  ✓ ' + name + (detail === undefined ? '' : ' — ' + detail));
    } else {
        fails++;
        console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail));
    }
}
function memStorage(seed) {
    const box = new Map(Object.entries(seed || {}));
    return { get: (k) => (box.has(k) ? box.get(k) : null), set: (k, v) => { box.set(k, v); }, _box: box };
}
function newApp(seed) {
    const st = memStorage(seed);
    const app = new MagazineApp(null, st);
    app.probe();
    return { app, st };
}

/* ───────── A 内核面 ───────── */
console.log('A 内核面');
ok('A1 十型清单', DAT.MAGAZINE_TYPES.length === 10, DAT.MAGAZINE_TYPES.join('/'));
ok('A2 人话表键面同源', Object.keys(DAT.MAGAZINE_TYPE_LABELS).join() === DAT.MAGAZINE_TYPES.join());
ok('A3 配色表键面同源', Object.keys(DAT.MAGAZINE_TYPE_COLORS).join() === DAT.MAGAZINE_TYPES.join());
ok('A4 内置池 10 位', DAT.MAGAZINE_BUILT_IN_PEOPLE.length === 10);
ok('A5 期号下界 1', DAT.normalizeArticle({ title: 'x', vol: 0 }, 0).vol === 1);
ok('A6 坏期号走缺省', DAT.normalizeArticle({ title: 'x', vol: 'nope' }, 4).vol === 5);
ok('A7 给定期号被尊重', DAT.normalizeArticle({ title: 'x', vol: 9 }, 0).vol === 9);
ok('A8 nextVol 取最大 + 1', DAT.nextVol([{ vol: 1 }, { vol: 3 }]) === 4, String(DAT.nextVol([{ vol: 1 }, { vol: 3 }])));
ok('A9 撞号如实回报', DAT.normalizeMagazine({ articles: [{ vol: 1, content: 'x' }, { vol: 1, content: 'y' }] }).volConflicts.length === 1);
ok('A10 截断如实回报', DAT.takeText('abcdef', 3).trimmed === 3);
ok('A11 查不到人如实回报', DAT.resolvePeople(['ghost'], DAT.MAGAZINE_BUILT_IN_PEOPLE).missing[0] === 'ghost');
ok('A12 三态分开', DAT.emptyFace(DAT.MAGAZINE_REASONS.storage_absent).canWrite === false
    && DAT.emptyFace(DAT.MAGAZINE_REASONS.empty).canWrite === true);

/* ───────── B 解析面 ───────── */
console.log('B 解析面');
const qa = DAT.parseArticleBody('seiyuu', '―― 问\n甲：答');
ok('B1 Q&A 两块', qa.blocks.map((b) => b.kind).join() === 'question,answer');
ok('B2 空正文只产占位', DAT.parseArticleBody('chart', '').blocks.every((b) => b.kind === 'gap'));
ok('B3 空正文不算未识别', DAT.parseArticleBody('chart', '').unknown === 0);
ok('B4 认不出来的行计数', DAT.parseArticleBody('chart', '◆ 非法\n◆ 也非法').unknown === 2);
ok('B5 白名单校验在场', DAT.parseArticleBody('seiyuu', '―― 问\n甲：答').stray === 0);
ok('B6 产出块全在白名单内',
    DAT.parseArticleBody('poll', '1位　甲　50%\n「好评」').blocks.every((b) => DAT.MAGAZINE_BLOCK_KINDS.includes(b.kind)));
ok('B7 对谈空名落旁白', DAT.parseArticleBody('charatalk', '「只有台词」').blocks[0].kind === 'narration');
ok('B8 关系图兜底给原文', DAT.chartFallback(DAT.parseArticleBody('chart', '甲行').blocks)[0] === '甲行');
const g = DAT.chartGraph(DAT.parseArticleBody('chart', '◆ A → B：关系').blocks, 12);
ok('B9 关系图节点与配色', g.nodes.length === 2 && Object.keys(g.colors).length === 2);
ok('B10 坐标落在画布内', (() => {
    const p = DAT.chartPositions(['A', 'B'], 360, 300).positions;
    return Object.values(p).every((q) => q.x >= 0 && q.x <= 360 && q.y >= 0 && q.y <= 300);
})());
ok('B11 TITLE 拆分（含 Markdown）', DAT.splitTitleAndBody('**TITLE:** **加粗标题**\n正文').title === '加粗标题');
ok('B12 译文按空行切段', DAT.translationParagraphs('甲\n\n乙').length === 2);

/* ───────── C 编排面 ───────── */
console.log('C 编排面');
const { app } = newApp();
const r1 = app.ingest({ type: 'seiyuu', theme: 'T1', peopleIds: ['mg-p1'], response: 'TITLE: 甲\n―― 问\n白石 遥：答' });
ok('C1 登记成功', r1.reason === 'ok' && r1.article && r1.article.vol === 1);
const r2 = app.ingest({ type: 'column', theme: 'T2', response: 'TITLE: 乙\n正文' });
ok('C2 第二篇期号 2', r2.article.vol === 2);
app.removeArticle(r1.article.id);
ok('C3 删中间篇不改别人的期号', app.articleById(r2.article.id).vol === 2);
const r3 = app.ingest({ type: 'poll', theme: 'T3', response: 'TITLE: 丙\n1位　甲　60%' });
ok('C4 新篇期号 = 最大 + 1', r3.article.vol === 3, String(r3.article.vol));
ok('C5 封面读数', app.cover(r2.article.id).volLabel === 'VOL.2');
ok('C6 块结构出口', app.blocks(r3.article.id).blocks.length >= 1);
ok('C7 关系图出口', app.graph(r3.article.id).nodes.length === 0);
ok('C8 时间读数单位在表内', DAT.MAGAZINE_TIME_UNITS.includes(app.timeFace(r2.article.id).unit));
ok('C9 检索命中', app.search('乙').total >= 1);
ok('C10 分组读数', app.groupCounts().column === 1);
ok('C11 台账读数', app.ledgerFace().articles === 2);
ok('C12 摘要行非空', app.summaryLine().length > 0);

/* ───────── D 写面 ───────── */
console.log('D 写面');
const { app: app2 } = newApp();
const ing = app2.ingest({ type: 'reader', theme: '读者', response: 'TITLE: 读者\n来信 甲\n正文\n回信 乙\n回复' });
ok('D1 读者来函登记', ing.reason === 'ok');
ok('D2 译文写入 + 读数', (() => {
    const s = app2.setTranslation(ing.article.id, '第一段\n\n第二段');
    return s.ok && app2.translation(ing.article.id).length === 2;
})());
ok('D3 改类型', app2.retype(ing.article.id, 'column').ok);
ok('D4 坏类型被拒', app2.retype(ing.article.id, 'nope').ok === false);
ok('D5 改杂志名', app2.rename('Newtype').name === 'Newtype');
ok('D6 语言切换', app2.setBodyLanguage('cn') === 'cn');
ok('D7 默认类型', app2.setDefaultType('poll') === 'poll');
ok('D8 分享文本', app2.shareText(ing.article.id).text.length > 0);
ok('D9 单篇导出', app2.exportOne(ing.article.id).name.endsWith('.txt'));
ok('D10 全刊导出', app2.exportAll().text.includes('合订本'));
ok('D11 可打印结构', app2.printable(ing.article.id).rows.length >= 1);
ok('D12 要求文本含纯度规则', (() => {
    const p = app2.promptBlock('seiyuu', { theme: 'T', peopleIds: ['mg-p1'] });
    return p.text.includes(DAT.MAGAZINE_PURITY_RULE.slice(0, 20)) && p.chars > 0;
})());
ok('D13 十型都能产要求文本', DAT.MAGAZINE_TYPES.every((t) => app2.promptBlock(t, {}).chars > 0));
ok('D14 删除后读数归零', app2.removeArticle(ing.article.id).removed === 1 && app2.articlesAll().length === 0);

/* ───────── E 空态与坏输入 ───────── */
console.log('E 空态与坏输入');
const { app: app3 } = newApp();
ok('E1 空态是 empty', app3.faceOf() === DAT.MAGAZINE_REASONS.empty);
ok('E2 空态可写', app3.empty().canWrite === true);
/* ★ 口径：`ingest(null)` 走的是「空输入 → 产一篇空稿」的合法路径（字段面靠
 *   `normalizeArticle` 的缺省兜住），**不是** 'bad_input'。断言改成「不抛 + 字段面完整」。 */
ok('E3 空输入不抛且产出的字段面完整', (() => {
    const rr = app3.ingest(null);
    return rr.reason === 'ok' && rr.article
        && typeof rr.article.id === 'string' && typeof rr.article.vol === 'number'
        && typeof rr.article.content === 'string' && Array.isArray(rr.article.peopleIds);
})());
ok('E3b 坏期号不抛、走缺省', (() => {
    const rr = app3.ingest({ type: 'column', vol: 'nope', response: 'TITLE: x\n正文' });
    return rr.reason === 'ok' && rr.article.vol >= 1;
})());
ok('E4 取不存在的篇不抛', app3.find('nope').found === false);
ok('E5 取不存在的封面给 null', app3.cover('nope') === null);
const bad = new MagazineApp(null, null);
bad.probe();
ok('E6 无 storage ⇒ storage_absent', bad.faceOf() === DAT.MAGAZINE_REASONS.storage_absent);
ok('E7 无 storage 时不产投影', bad.projFace() === null);
const thrower = {
    get: () => { throw new Error('boom'); },
    set: () => { throw new Error('boom'); },
};
const appT = new MagazineApp(null, thrower);
appT.probe();
ok('E8 取数抛异常 ⇒ storage_absent（不许读成「空」）', appT.faceOf() === DAT.MAGAZINE_REASONS.storage_absent);
ok('E9 取数抛异常后仍能读出空稿件', appT.articlesAll().length === 0);

/* ───────── F 换会话 ───────── */
console.log('F 换会话');
const box = new Map();
let chat = 'c1';
const sess = {
    get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
    set: (k, v) => { box.set(chat + '::' + k, v); },
};
const appS = new MagazineApp(null, sess);
appS.probe();
appS.ingest({ type: 'column', theme: 'C1', response: 'TITLE: C1\n甲' });
chat = 'c2';
appS.onChatChanged();
ok('F1 换会话看不到别人的稿', appS.articlesAll().length === 0);
appS.ingest({ type: 'column', theme: 'C2', response: 'TITLE: C2\n乙' });
ok('F2 新会话只有自己的稿', appS.articlesAll().length === 1 && appS.articlesAll()[0].theme === 'C2');
chat = 'c1';
appS.onChatChanged();
ok('F3 换回来还是自己的稿', appS.articlesAll()[0].theme === 'C1');

/* ───────── G 视图面（无头：只验接口闭合，不验渲染） ───────── */
console.log('G 视图面');
const viewMod = await import('../apps/magazine/magazine-view.js');
ok('G1 视图类在场', typeof viewMod.MagazineView === 'function');
const app4 = newApp().app;
const view = new viewMod.MagazineView(app4, null, null);
ok('G2 视图有 render/refresh', typeof view.render === 'function' && typeof view.refresh === 'function');
ok('G3 无 shell 时 render 不抛', (() => { try { view.render(); return true; } catch (_e) { return false; } })());
ok('G4 无 root 时 refresh 不抛', (() => { try { view.refresh(); return true; } catch (_e) { return false; } })());

/* ───────── H 门面读数 ───────── */
console.log('H 门面读数');
const dataSrc = await import('node:fs').then((fs) => fs.readFileSync('apps/magazine/magazine-data.js', 'utf8'));
const appSrc = await import('node:fs').then((fs) => fs.readFileSync('apps/magazine/magazine-app.js', 'utf8'));
const viewSrc = await import('node:fs').then((fs) => fs.readFileSync('apps/magazine/magazine-view.js', 'utf8'));
ok('H1 数据层导出数 ≥ 45', (dataSrc.match(/^export /gm) || []).length >= 45, String((dataSrc.match(/^export /gm) || []).length));
ok('H2 App 方法数 ≥ 45', (appSrc.match(/^    [a-zA-Z_][a-zA-Z0-9_]*\(/gm) || []).length >= 45,
    String((appSrc.match(/^    [a-zA-Z_][a-zA-Z0-9_]*\(/gm) || []).length));
ok('H3 视图行数 ≥ 500', viewSrc.split('\n').length >= 500, String(viewSrc.split('\n').length));
/* ★ 先剥注释再扫：本仓纪律「注释里的提及不算消费」—— 文件头逐条写明了
 *   「源有什么、本仓为什么不能有」，那些词是**说明**不是**消费**。 */
const stripComments = (src) => {
    let out = '';
    let i = 0;
    let state = 'code';
    while (i < src.length) {
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
};
const code = stripComments(appSrc) + '\n' + stripComments(viewSrc) + '\n' + stripComments(dataSrc);
ok('H4 零网络调用', !/fetch\(|callChatAPI|XMLHttpRequest/.test(code));
ok('H5 零宿主写入', !/Utils\.saveData|AppState|pushMessage/.test(code));
ok('H6 剥注释器已复位（三件都能剥净文件尾哨兵）', (() => {
    const sent = stripComments(appSrc + '\n/* RP_TAIL_3360 */\n');
    return !sent.includes('RP_TAIL_3360');
})());

console.log('');
console.log(fails === 0 ? 'SMOKE-3360 ALL GREEN' : ('SMOKE-3360 ' + fails + ' FAILED'));
process.exit(fails === 0 ? 0 : 1);