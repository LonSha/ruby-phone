/** R-X8: A structure / A2 purity / B behaviour / C real adapters / D mutants / E version.
 *
 *  本套件答四件事（与 R-X1..R-X7 同规格）：
 *    ① 内核四态不同形 + 替代操作齐 + 跨仓提示分「读不出 / 偏低」两事；
 *    ② 咽喉那一层**只读**：不写存储、不发网络、不调模型（剥注释后逐条核）；
 *    ③ 三层与诊断面的接线**逐字段对齐**（本版实测抓到过一处键名错位）；
 *    ④ 负控制：真源码副本定点破坏 ⇒ 同款判据必须转红（含两向自证）。
 *
 *  【本套件刻意不做的两件事】
 *    · 不跑产品面（那是浏览器实机的事，边界写在运行时验证边界文档）；
 *    · 不把「构建期门禁绿」写成「运行时没坏」—— 两者不是一回事。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as CH from '../config/capability-health.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const IDX = read('index.js');
const APP = read('apps/caphealth/caphealth-app.js');
const VIEW = read('apps/caphealth/caphealth-view.js');
const DATA = read('apps/diagnose/diagnose-data.js');
const DVIEW = read('apps/diagnose/diagnose-view.js');
const CSS = read('apps/caphealth/caphealth.css');
const KERNEL = 'config/capability-health.js';
const MAN = JSON.parse(read('manifest.json'));

/** 剥注释（本仓旧病：注释里提一嘴「没有 fetch」被当成出现） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
/** 取咽喉里 R-X8 那一段（从段标题到 cwInvokeOwner 之前） */
const throatSeg = () => {
    const a = IDX.indexOf('[v3.92.0 · 拓展计划 R-X8] 宿主与能力健康中心');
    const b = IDX.indexOf('function cwInvokeOwner(req) {');
    assert.ok(a > 0 && b > a, '咽喉 R-X8 段未找到（判据面与真码脱钩 ⇒ 拒判）');
    return IDX.slice(a, b);
};

/* ───────── 判据（可被负控制复用的纯函数形态） ───────── */

/** 判①：四态不同形 + 面缺席/无自述都判未验证（不是坏） */
export function judgeFourStates(m) {
    const a = m.capStateOf('search', { present: true, probe: 'service', healthy: 'ok' });
    const b = m.capStateOf('search', { present: true, probe: 'service', healthy: 'partial' });
    const c = m.capStateOf('search', { present: true, probe: 'service', healthy: 'unavailable' });
    const d = m.capStateOf('search', null);
    if (new Set([a.state, b.state, c.state, d.state]).size !== 4) return { ok: false, why: '四态未做到不同形' };
    if (a.state !== m.CAP_STATES.OK) return { ok: false, why: '服务级可用应判 ok：' + a.state };
    if (b.state !== m.CAP_STATES.PARTIAL) return { ok: false, why: '部分可用应判 partial：' + b.state };
    if (c.state !== m.CAP_STATES.UNAVAILABLE) return { ok: false, why: '报不可用应判 unavailable：' + c.state };
    if (d.state !== m.CAP_STATES.UNVERIFIED) return { ok: false, why: '面缺席应判 unverified（不是坏）：' + d.state };
    const absent = m.capStateOf('notify', { present: false, probe: 'service', healthy: 'unavailable' });
    if (absent.state !== m.CAP_STATES.UNVERIFIED) return { ok: false, why: '面缺席即使自述不可用也应是未验证：' + absent.state };
    return { ok: true };
}

/** 判②：只知道接口在场 ⇒ 最高只能到部分可用（验收②） */
export function judgeApiOnly(m) {
    const r = m.capStateOf('memory', { present: true, probe: 'api', healthy: 'ok' });
    if (r.state === m.CAP_STATES.OK) return { ok: false, why: '仅接口在场被判成可用（验收②禁止）' };
    if (r.state !== m.CAP_STATES.PARTIAL) return { ok: false, why: '仅接口在场应降 partial：' + r.state };
    if (m.apiOnlyDegrade(m.CAP_STATES.OK) !== m.CAP_STATES.PARTIAL) return { ok: false, why: 'apiOnlyDegrade 未把 ok 降 partial' };
    return { ok: true };
}

/** 判③：缺能力必须给替代操作（顺序即优先级），且替代操作非空 */
export function judgeFallbacks(m) {
    for (const id of m.CAPABILITY_IDS) {
        const fb = m.CAP_FALLBACKS[id];
        if (!fb || fb.length === 0) return { ok: false, why: id + ' 缺替代操作（验收②）' };
        const r = m.capStateOf(id, { present: true, probe: 'service', healthy: 'unavailable' });
        if (!r.fallbacks || r.fallbacks.length !== fb.length) return { ok: false, why: id + ' 判定行没带上替代操作' };
    }
    return { ok: true };
}

/** 判④：跨仓提示必须把「版本读不出」与「版本偏低」分开（两事处置相反） */
export function judgeCrossRepo(m) {
    const a = m.crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'x', version: '' }], minUpstream: '3.170.0' });
    if (a.missing.length !== 1 || a.outdated.length !== 0) return { ok: false, why: '版本读不出应记 missing 且不记 outdated' };
    const b = m.crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'x', version: '3.1.0' }], minUpstream: '3.170.0' });
    if (b.outdated.length !== 1 || b.missing.length !== 0) return { ok: false, why: '版本偏低应记 outdated 且不记 missing' };
    const c = m.crossRepoNotice({ phone: '3.92.0', upstreams: [{ id: 'x', version: '3.1.0' }], minUpstream: '' });
    if (c.outdated.length !== 0) return { ok: false, why: '没有门限不得判版本偏低（不拿假门限比）' };
    if (!m.semverLess('3.9.0', '3.10.0')) return { ok: false, why: 'semverLess 必须逐段比' };
    return { ok: true };
}

/** 判⑤：宿主版本「读不出」不得写成「不支持」；身份行只说身份、不塞面级契约 */
export function judgeHostVersionHonesty(m) {
    const withHost = m.crossRepoNotice({ phone: '3.92.0', hostVersion: '1.12.6', upstreams: [], totalFaces: 0 });
    const noHost = m.crossRepoNotice({ phone: '3.92.0', upstreams: [], totalFaces: 0 });
    if (withHost.line.indexOf('宿主 1.12.6') < 0) return { ok: false, why: '宿主版本必须进跨仓段（功能点 ①）' };
    if (noHost.line.indexOf('读不出') < 0) return { ok: false, why: '宿主版本缺席时必须明说是「读不出」' };
    if (noHost.line.indexOf('不支持') < 0) return { ok: false, why: '读不出不得写成「宿主不支持」（两事处置相反）' };
    if (withHost.line.indexOf('读不出') >= 0) return { ok: false, why: '宿主版本读得到时不得再说「读不出」' };
    if (withHost.idLine.indexOf('宿主 1.12.6') < 0) return { ok: false, why: '身份行必须带宿主版本' };
    if (withHost.idLine.indexOf('面级契约') >= 0) return { ok: false, why: '身份行不得塞面级契约（两处用途不同）' };
    if (noHost.idLine.indexOf('不支持') < 0) return { ok: false, why: '身份行不得把「读不出」写成「不支持」' };
    const rep = m.capHealthReport(m.capHealthSummary(null), withHost);
    if (rep.indexOf('宿主 1.12.6') < 0) return { ok: false, why: '报告必须带上宿主版本' };
    if (rep.indexOf('【跨仓】') < 0) return { ok: false, why: '报告缺跨仓段' };
    return { ok: true };
}

/** 判⑥：汇总面四态计数之和必须等于总数（漏一层就没有守恒） */
export function judgeSummaryConservation(m) {
    const s = m.capHealthSummary({ search: { present: true, probe: 'service', healthy: 'ok' } });
    if (s.counts.ok !== 1) return { ok: false, why: '应 1 项可用，实际 ' + s.counts.ok };
    if (s.counts.unverified !== 5) return { ok: false, why: '其余五项应记未验证，实际 ' + s.counts.unverified };
    const sum = s.counts.ok + s.counts.partial + s.counts.unavailable + s.counts.unverified;
    if (sum !== s.total) return { ok: false, why: '四态计数之和应等于总数（有态的读数漏了）' };
    if (m.capHealthSummary(null).counts.unverified !== 6) return { ok: false, why: '什么都没给时应六项全未验证（不是全可用）' };
    return { ok: true };
}

/** 判⑦：最低上游版本必须从登记面真源派生，且 null since 不参与 */
export function judgeMinUpstream(m) {
    const feats = [
        { owner: 'lonsha', since: '3.100.0' },
        { owner: 'lonsha', since: '3.181.0' },
        { owner: 'lonsha', since: null },
        { owner: 'worldaxis', since: '3.9.0' },
    ];
    if (m.minUpstreamOf(feats, 'lonsha') !== '3.181.0') return { ok: false, why: '最低版本应取该 owner 名下最大的 since' };
    if (m.minUpstreamOf(feats, 'nobody') !== '') return { ok: false, why: '无该 owner 的面应返回空串（不造假门限）' };
    if (m.minUpstreamOf([{ owner: 'lonsha', since: null }], 'lonsha') !== '') return { ok: false, why: 'null since 不得参与版本比对' };
    if (m.minUpstreamOf(null, 'lonsha') !== '') return { ok: false, why: '登记面缺席应返回空串（不抛）' };
    return { ok: true };
}

/* ───────── 负控制基座 ───────── */

const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function anchorOnce(s, a) {
    assert.equal(s.split(a).length - 1, 1, '负控制锚点字面量必须恰中 1 次：' + JSON.stringify(a.slice(0, 50)));
    return a;
}
let NEG_SEQ = 0;
async function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const seq = (NEG_SEQ += 1);
    const dstAbs = path.join(ROOT, rel.replace(/\.js$/, '.' + seq + NEG_SUFFIX));
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    const back = fs.readFileSync(dstAbs, 'utf8');
    assert.equal(back, next, '破坏副本必须逐字等于刚写的内容');
    return { mod: await import(pathToFileURL(dstAbs).href + '?neg=' + seq + '-' + Date.now()), file: dstAbs, src: back };
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});
function callJudge(fn, m) {
    try { return fn(m); } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}
const isRed = (r) => !(r && r.ok === true);

/* ───────── A · 结构面 ───────── */

test('v3920 A1 kernel shape: four states, six capabilities, fallbacks, registry and four consistent names', () => {
    assert.equal(CH.CAP_STATE_KEYS.length, 4, '四态必须四个');
    assert.equal(CH.CAPABILITY_IDS.length, 6, '能力面必须六个');
    assert.equal(CH.CAP_PROBE_KEYS.length, 4, '观测级必须四档（服务 / 接口 / 版本 / 无）');
    assert.equal(Object.keys(CH.CAP_FALLBACKS).length, 6, '替代操作必须六组（六项能力各一组）');
    assert.deepEqual(CH.capHealthSelfCheck().problems, [], '内核自检必须为空');
    assert.equal(CH.capHealthSelfCheck().states, 4);
    assert.equal(CH.capHealthSelfCheck().capabilities, 6);
    /* 四态文案互不相同（同形即压平） */
    assert.equal(new Set(CH.CAP_STATE_KEYS.map((k) => CH.CAP_STATE_TEXT[k])).size, 4, '四态文案出现重复（压平了两态）');
    /* 三处注册面 + 咽喉 + 诊断面（新增模块必进这些扫描面） */
    assert.ok(read('config/apps.js').indexOf("id: 'caphealth'") >= 0, 'APPS 必须登记');
    assert.ok(read('config/app-lazy-routes.js').indexOf('"caphealth"') >= 0, '懒加载路由必须登记');
    assert.ok(read('config/app-lazy-routes.js').indexOf('"caphealthApp"') >= 0, '槽位名必须与目录名同源');
    assert.ok(read('config/app-consumption-matrix.js').indexOf('"caphealth"') >= 0, '消费矩阵必须登记');
    assert.ok(IDX.indexOf('refreshCapHealth') >= 0 && IDX.indexOf('applyCaphealthAction') >= 0, '咽喉必须有取数口与动作口');
    assert.ok(DATA.indexOf('capHealthFace') >= 0, '诊断面必须有协议面读数');
    assert.ok(DVIEW.indexOf('_capHealthHtml') >= 0, '诊断视图必须有对应卡片');
    /* ★ 目录 / 文件名 / 类名 / 槽位名四一致（全仓约定：apps/<dir>/<dir>-{app,view}.js + <Dir>App + <dir>App）。
     *   R-X6 / R-X7 两版都在这条上栽过：用了别名文件名与不挂钩目录名的类名 ⇒ 凡按
     *   `<dir>-app.js` 派生路径的判据全部**静默漏过**这个 App。 */
    for (const rel of ['apps/caphealth/caphealth-app.js', 'apps/caphealth/caphealth-view.js']) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), '四一致：' + rel + ' 必须存在');
    }
    assert.ok(APP.indexOf('export class CaphealthApp') >= 0, '类名必须由目录名派生（<Dir>App）');
    /* ★ 进 REBIND 表（同族缺陷先例两次：v3.48.0 / v3.91.0 —— 实现了 onChatChanged 却没进表，
     *   换会话只换 storage，实例态原样留着：不报错、只错结果）。 */
    const tbl = (IDX.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.indexOf("'caphealthApp'") >= 0, '能力体检必须进 REBIND 表（换会话丢实例态）');
    assert.ok(/\n\s*onChatChanged\s*\(/.test(APP), 'App 必须实现 onChatChanged');
    /* ★ 样式投递：类前缀族 `.cph-*` 必须能在 phone.css 找到（机制 A）。
     *   **为什么是 cph 而不是 ch**：`.ch-*` 已被金手指 App（apps/cheat，v2.47.0）占用，
     *   两个 App 有八个类名逐字重名（ch-root / ch-head / ch-title / ch-badge / ch-btn /
     *   ch-note / ch-pre / ch-row）且取值方向相反 ⇒ 并进 phone.css 会当场打坏金手指界面，
     *   而 registry 门只看「前缀族在不在」，**看不出撞车**。这一条钉住改名结果。 */
    assert.ok(/\n\.cph-[a-z]/.test(CSS), '样式必须用 .cph-* 族（.ch-* 与金手指撞车）');
    assert.ok(!/(?<![\w-])\.ch-/.test(CSS), 'css 里不得再留裸 .ch- 选择器');
    assert.ok(/\n\.cph-[a-z]/.test(read('phone.css')), '类前缀族必须能在 phone.css 找到（机制 A）');
});

test('v3920 A2 pure kernel and a read-only throat: no storage writes, no network, no model calls', () => {
    const src = strip(read(KERNEL));
    for (const bad of ['localStorage', 'sessionStorage', 'document.', 'setTimeout', 'setInterval', 'new Date(', 'window.', 'VirtualPhone', 'fetch(', 'XMLHttpRequest', 'navigator']) {
        assert.equal(src.indexOf(bad) >= 0, false, '纯内核不得出现 ' + bad);
    }
    /* 咽喉那一段（计划验收③「能力检测本身不得触发真实写入或模型调用」的落点）。 */
    const seg = strip(throatSeg());
    for (const bad of ['fetch(', 'XMLHttpRequest', 'generateRaw', 'new Image(', 'localStorage', 'setTimeout', 'storage.set', 'storage.remove', 'getUserMedia(']) {
        assert.equal(seg.indexOf(bad) >= 0, false, '咽喉 R-X8 段不得出现 ' + bad);
    }
    assert.ok(seg.indexOf('writes: 0') >= 0, '读数里必须带「零写入」这一格');
    /* 视图：不写存储、不 eval、不 iframe、不取网。 */
    const v = strip(VIEW);
    for (const bad of ['storage.', 'localStorage', 'eval(', 'new Function', 'srcdoc', 'iframe', 'fetch(']) {
        assert.equal(v.indexOf(bad) >= 0, false, '视图不得出现 ' + bad);
    }
    /* 动作白名单只有一个（本 App 是纯读数面，没有任何写动作）。 */
    const acts = [];
    const re = /data-ch-act="?(\w+)"?/g;
    let m;
    while ((m = re.exec(VIEW)) !== null) acts.push(m[1]);
    assert.deepEqual(Array.from(new Set(acts)).sort(), ['report'], '动作白名单必须恰好一个（report）');
    const keys = (IDX.match(/const CAPHEALTH_ACTION_KEYS = \[([^\]]*)\];/) || [])[1] || '';
    assert.deepEqual(keys.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean), ['report'], '咽喉白名单必须与视图一致');
    assert.equal(APP.indexOf('storage.set'), -1, 'App 不得自己写存储');
});

/* ───────── B · 行为面 ───────── */

test('v3920 B1 four states are distinct in form and shape (missing face is unverified, not broken)', () => {
    const r = judgeFourStates(CH);
    assert.equal(r.ok, true, r.why);
});

test('v3920 B2 api-only never reports as service-available (acceptance ②)', () => {
    const r = judgeApiOnly(CH);
    assert.equal(r.ok, true, r.why);
});

test('v3920 B3 every capability has ordered fallbacks, and rows carry them', () => {
    const r = judgeFallbacks(CH);
    assert.equal(r.ok, true, r.why);
});

test('v3920 B4 cross-repo notice keeps "unreadable" and "outdated" apart', () => {
    const r = judgeCrossRepo(CH);
    assert.equal(r.ok, true, r.why);
});

test('v3920 B5 host version honesty: unreadable is never written as unsupported', () => {
    const r = judgeHostVersionHonesty(CH);
    assert.equal(r.ok, true, r.why);
});

test('v3920 B6 summary conservation and min-upstream derivation', () => {
    const a = judgeSummaryConservation(CH);
    assert.equal(a.ok, true, a.why);
    const b = judgeMinUpstream(CH);
    assert.equal(b.ok, true, b.why);
});

test('v3920 B7 report is assembled from judged readings only (never re-detects)', () => {
    const sum = CH.capHealthSummary({ voice: { present: true, probe: 'api', healthy: 'ok' } });
    const rep = CH.capHealthReport(sum, CH.crossRepoNotice({ phone: '3.92.0', upstreams: [], totalFaces: 0 }));
    assert.ok(rep.indexOf('替代操作') >= 0, '需处置项必须带替代操作行（部分可用也要给）');
    assert.ok(rep.indexOf('【能力健康】') >= 0, '报告首行必须是汇总行');
    assert.ok(rep.indexOf('搜索') >= 0 && rep.indexOf('恢复交接') >= 0, '六项能力必须逐项列出');
    /* 咽喉的 report 分支不得再采一次观测（只吃已判定的读数）。 */
    const i = IDX.indexOf('function applyCaphealthAction(payload) {');
    const seg = IDX.slice(i, i + 1800);
    assert.ok(seg.indexOf('chCollectObservations') < 0, 'report 分支不得重新检测（chCollectObservations 不得出现）');
    assert.ok(seg.indexOf('capHealthReport(face.summary, face.notice)') >= 0, '报告必须用已判定的读数拼');
});

test('v3920 B8 host version probe tries several sources and stays honest on failure', () => {
    const i = IDX.indexOf('function chHostVersion(win) {');
    const seg = IDX.slice(i, i + 1200);
    assert.ok(seg.indexOf('SillyTavern') >= 0, '第一来源：宿主 API');
    assert.ok(seg.indexOf('getContext') >= 0, '第二来源：getContext()');
    assert.ok(seg.indexOf('version_display') >= 0, '第三来源：页面元素（DOM）');
    assert.ok(/return ''/.test(seg), '全拿不到必须如实返回空串（上层写「读不出」，不写「不支持」）');
    /* 观测采集：六项能力必须齐，且不得真跑用户可见的副作用动作。 */
    const j = IDX.indexOf('function chCollectObservations(win) {');
    const obs = IDX.slice(j, IDX.indexOf('function chUpstreamVersions(win)'));
    for (const id of ['search', 'memory', 'image', 'voice', 'notify', 'handoff']) {
        assert.ok(obs.indexOf('out.' + id + ' ') >= 0 || obs.indexOf('out.' + id + '=') >= 0 || obs.indexOf('out.' + id + ' =') >= 0, '六项观测缺 ' + id);
    }
    assert.ok(obs.indexOf('getUserMedia') >= 0 && obs.indexOf('getUserMedia()') < 0, '只检查录音接口在场，**不得调用** getUserMedia（会弹授权）');
});

/* ───────── C · 真实接线面 ───────── */

test('v3920 C1 throat keys and the app/view read the same names (the mismatch caught this round)', () => {
    const seg = IDX.slice(IDX.indexOf('function refreshCapHealth() {'), IDX.indexOf('function applyCaphealthAction(payload) {'));
    for (const k of ['hostVersion', 'hostVersionText', 'readable', 'why', 'summary', 'notice', 'writes', 'ids', 'actions', 'selfCheck']) {
        assert.ok(seg.indexOf(k + ':') >= 0, '咽喉缓存缺格 ' + k);
    }
    /* ★ 本版实测抓到过的错位：App 读 hostVersionLine、咽喉写 hostVersionText ⇒
     *   宿主版本永远显示「还没取到」，且 faceReadable 恒 false（一条假故障红字）。 */
    assert.ok(APP.indexOf('hostVersionText') >= 0, 'App 必须读咽喉那份键名（hostVersionText）');
    assert.equal(APP.indexOf('host.hostVersionLine'), -1, 'App 不得再读不存在的 hostVersionLine');
    assert.ok(APP.indexOf('host.readable') >= 0, 'App 必须读 readable');
    assert.ok(APP.indexOf('host.why') >= 0, 'App 必须读 why');
    /* 视图侧：四态必须同时给符号与文字（不只依赖颜色）。 */
    assert.ok(VIEW.indexOf('[可用]') >= 0 && VIEW.indexOf('[未验证]') >= 0, '视图必须给文字符号（不只依赖颜色）');
    assert.ok(VIEW.indexOf('CAP_STATE_TEXT') >= 0, '四态文案唯一实现必须来自内核');
});

test('v3920 C2 host action gate: whitelist declared before the reader, epoch checked, read-only reader', () => {
    /* 白名单声明必须在取数口**之前**（取数口要在读数里带上它，const 有 TDZ）。 */
    assert.ok(IDX.indexOf("const CAPHEALTH_ACTION_KEYS = ['report'];") < IDX.indexOf('function refreshCapHealth() {'), '白名单必须声明在取数口之前（避 const TDZ）');
    const i = IDX.indexOf('function applyCaphealthAction(payload) {');
    const seg = IDX.slice(i, i + 1800);
    assert.ok(seg.indexOf("CAPHEALTH_ACTION_KEYS.indexOf(action) < 0") >= 0, '必须先判动作白名单');
    assert.ok(seg.indexOf('handoffEpoch') >= 0 && seg.indexOf('stale-epoch') >= 0, '必须判世代（给了 token 才比）');
    assert.ok(seg.indexOf("p.token !== undefined && p.token !== null") >= 0, '世代检查只在视图真给了 token 时才做（否则误拒会让按钮看起来坏了）');
    /* 只读读数口挂上 VirtualPhone，且**每次读都重采**（设备级读数，宿主重载会变）。 */
    assert.ok(IDX.indexOf('capHealthFace: function () { refreshCapHealth();') >= 0, '只读读数口必须现采后读缓存');
    assert.ok(IDX.indexOf('applyCaphealthAction: applyCaphealthAction') >= 0, '唯一动作口必须挂上 VirtualPhone');
});

test('v3920 C3 diagnose face reads only the throat cache and keeps three states apart', () => {
    const i = DATA.indexOf('const capHealthFace = (() => {');
    assert.ok(i > 0, '诊断协议面未接线');
    const seg = DATA.slice(i, i + 4200);
    assert.ok(seg.indexOf('vp._caphealth') >= 0, '诊断面只读咽喉那一份缓存（不自己采观测）');
    assert.ok(seg.indexOf('chCollectObservations') < 0, '诊断面不得出现第二份观测采集（同一读数两个来源必然漂移）');
    assert.ok(seg.indexOf('capHealthFace') >= 0 && seg.indexOf('typeof vp.capHealthFace') >= 0, '必须区分「咽喉未挂」');
    assert.ok(seg.indexOf('尚未取数') >= 0, '必须区分「尚未取数」');
    assert.ok(seg.indexOf('不是「六项都不可用」') >= 0 || seg.indexOf('不是「六项能力都不可用」') >= 0, '面缺席必须明说不是「六项都不可用」');
    assert.ok(seg.indexOf('numOrNull') >= 0, '写入计数必须走全仓唯一数值门（不得自己写 Number 兜底）');
    /* default 导出与具名导出都要带上（诊断视图按具名导入）。 */
    assert.ok(/export function capHealthFaceText\(face\)/.test(DATA), '一行读数函数必须具名导出');
    assert.ok(/\n    capHealthFaceText,\n/.test(DATA), 'default 导出必须带上（与既有面同形）');
    assert.ok(DVIEW.indexOf('capHealthFaceText') >= 0, '诊断视图必须转发内核文案（不自拼）');
});

/* ───────── D · 负控制（真源码定点破坏） ───────── */

test('v3920 D1. apiOnlyDegrade is neutered => "interface present" becomes service-available (judge must go red)', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    return state === CAP_STATES.OK ? CAP_STATES.PARTIAL : state;"),
        "    return state;"));
    assert.equal(isRed(callJudge(judgeApiOnly, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D2. a missing face is judged unavailable => four-state judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        state = CAP_STATES.UNVERIFIED;\n        why = n.note || '没有观测到这一面（宿主未提供或本版未接）—— 未验证不是坏';"),
        "        state = CAP_STATES.UNAVAILABLE;\n        why = n.note || '没有观测到这一面（宿主未提供或本版未接）—— 未验证不是坏';"));
    assert.equal(isRed(callJudge(judgeFourStates, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D3. version-unreadable is folded into outdated => cross-repo judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        if (!ver) { missing.push(id + '（版本读不到 —— 这是「读不出」，不是「没装」）'); continue; }"),
        "        if (!ver) { outdated.push(id + '（版本读不到 —— 这是「读不出」，不是「没装」）'); continue; }"));
    assert.equal(isRed(callJudge(judgeCrossRepo, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D4. "unreadable host" is rewritten as "host unsupported" => honesty judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    const hostTxt = strOf(i.hostVersion) || '**读不出** —— 这是「读不出」，不是「宿主不支持」';"),
        "    const hostTxt = strOf(i.hostVersion) || '宿主不支持';"));
    assert.equal(isRed(callJudge(judgeHostVersionHonesty, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D5. absent capabilities stop being counted as unverified => conservation judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        return capStateOf(id, given ? src[id] : null);"),
        "        return capStateOf(id, given ? src[id] : { present: true, probe: 'service', healthy: 'ok' });"));
    assert.equal(isRed(callJudge(judgeSummaryConservation, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D6. min-upstream takes the first since instead of the max => derivation judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "        if (!best || semverLess(best, since)) best = since;"),
        "        if (!best) best = since;"));
    assert.equal(isRed(callJudge(judgeMinUpstream, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D7. fallbacks table loses an entry => fallback judge must go red', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    voice: Object.freeze(['改用文字输入', '用系统输入法的语音转文字', '把内容贴进输入框']),"),
        "    voice: Object.freeze([]),"));
    assert.equal(isRed(callJudge(judgeFallbacks, n.mod)), true, '破坏后同款判据必须转红');
});

test('v3920 D8. self-proof: the mutant is really loaded and the break really changes behaviour', async () => {
    const n = await negCopy(KERNEL, (s) => s.replace(
        anchorOnce(s, "    return state === CAP_STATES.OK ? CAP_STATES.PARTIAL : state;"),
        "    return state === CAP_STATES.OK ? CAP_STATES.UNAVAILABLE : state;"));
    assert.ok(typeof n.mod.capHealthSelfCheck === 'function', '破坏副本必须真被加载');
    assert.ok(String(n.file).indexOf(NEG_SUFFIX) >= 0);
    assert.ok(n.src.indexOf('CAP_STATES.UNAVAILABLE : state') >= 0, '破坏点必须真的写进了副本');
    assert.equal(CH.capStateOf('memory', { present: true, probe: 'api', healthy: 'ok' }).state, CH.CAP_STATES.PARTIAL, '原版：仅接口在场 ⇒ 部分可用');
    assert.equal(n.mod.capStateOf('memory', { present: true, probe: 'api', healthy: 'ok' }).state, CH.CAP_STATES.UNAVAILABLE, '破坏副本必须给出不同判定（行为真的变了）');
    assert.deepEqual(CH.capHealthSelfCheck().problems, [], '原版自检必须为空');
    assert.ok(n.mod.capHealthSelfCheck().problems.length > 0, '破坏副本自检必须报出问题（判据面真的看见了）');
});

/* ───────── E · 版本锚 ───────── */

test('v3920 E1 version anchor: five sources agree and not below 3.92.0', () => {
    const ver = String(MAN.version);
    const parts = ver.split('.').map(Number);
    assert.ok(parts[0] === 3 && parts[1] >= 92, '版本必须不低于 3.92.0，实际 ' + ver);
    assert.ok(IDX.indexOf("const ST_PHONE_VERSION = '" + ver + "'") >= 0);
    assert.equal(JSON.parse(read('package.json')).version, ver);
    const log = JSON.parse(read('update-log.json'));
    assert.ok(log.versions && log.versions[ver]);
    assert.equal(log.latest, ver);
    assert.ok(read('ITERATION_LOG.md').indexOf(ver) >= 0);
});