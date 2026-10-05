// tests/system-v3580.test.mjs — O4 会话切换与异步回信一起失效 [v3.58.0]
//
// 本套件守五件事（两面真调用行为 + 一面接线台账 + 一面诊断消费 + 版本锚与破坏表）：
//   ① R1 唯一实现面：`config/session-gate.js` 四导出齐、裁决**两维**（id 与 epoch 都要真）、
//      fail-closed（拿不到身份即判不当前）、账本有界；
//   ② R2 真调用行为面（真 import 真模块 + 假 storage）：计划验收点名的四条序列
//      （A 发请求→切 B→A 回信 / A 清空→旧保存回调 / 切走又切回 / 反复开关 20 次）
//      逐条断言「旧回信被拒 + 当前会话状态逐字不受影响 + 拒绝原因可读」；
//   ③ R3 接线台账：三条会话身份变更路径**都**抬世代（且与 `_chatSessionGeneration` 同址）、
//      删楼/滑动/重新生成三条**会话内**路径**不**抬世代（判开是双向的：漏判与误判同样是错）、
//      REBIND 表含搜索 App、七族写回口的令牌与栅栏**成对**在场且域名字符串逐条对账；
//   ④ R4 诊断消费面：账本有可见出口（`sessionGate` 面 + `sessionGateFaceText` 三态互不相同）；
//   ⑤ V 面版本锚 + D 面真源码定点破坏表（每条破坏必须让对应判据转红）。
//
// 判据纪律（本仓硬纪律，逐条沿用）：
//   · 破坏只落副本树，真仓全程只读；破坏锚点必须恰中 1 次（不唯一即抛）；
//   · **两个输入面必须分开**：`codeKeepStr`（只抹注释、保留字符串）用于「锚点本身含字面量」
//     的判定；`codeOnly`（注释与字符串都抹）用于「这个名字是不是真代码里写的」。
//     混用是假红的常客 —— 本套件首跑就在这上面红过一轮（带引号的锚点被一并抹除后全数失配）；
//   · 行为面**真跑真模块**（动态 import 真模块），不拿文本在场当行为成立；
//   · 每条破坏两侧都断言：破坏后必须红，原版上同款判据必须真（否则「恒红」也能骗过破坏表）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NL = String.fromCharCode(10);
const Q = String.fromCharCode(39);
const BS = String.fromCharCode(92);
const GATE_REL = 'config/session-gate.js';
const NUM_GATE_REL = 'config/num-gate.js';
const INDEX_REL = 'index.js';
const DIAG_DATA_REL = 'apps/diagnose/diagnose-data.js';
const DIAG_VIEW_REL = 'apps/diagnose/diagnose-view.js';
const MIN_VERSION = '3.58.0';
const DROP_LOG_MAX_EXPECT = 60;
const REBIND_MIN = 66;   // 当版真读数 66（含 searchApp）：只作下限，防「表被摘空」而不防新增
const temps = [];
let seq = 0;
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function readFrom(root, rel) {
    const p = path.join(root, rel);
    if (root !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}
const hits = (s, sub) => s.split(sub).length - 1;

/* ============================================================
 * 两个输入面（本套件首跑踩过的那一坑，务必保留说明）
 * ============================================================ */
/** 只抹注释、**保留字符串**：用于锚点本身含字面量的判定（如带引号的拒绝原因）。 */
function codeKeepStr(src) {
    const out = new Array(src.length);
    let i = 0; const n = src.length;
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '*') {
            const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2;
            for (let k = i; k < stop; k++) out[k] = src[k] === NL ? NL : ' ';
            i = stop; continue;
        }
        if (c === '/' && c2 === '/') {
            const end = src.indexOf(NL, i + 2); const stop = end < 0 ? n : end;
            for (let k = i; k < stop; k++) out[k] = ' ';
            i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}
/** 注释与字符串**都**抹掉：用于「这个名字是不是真代码里写的」（注释里提一嘴、字符串里写一嘴都不算）。 */
function codeOnly(src) {
    const out = new Array(src.length);
    let i = 0; const n = src.length;
    const blank = (a, b) => { for (let k = a; k < b; k++) out[k] = src[k] === NL ? NL : ' '; };
    const tick = String.fromCharCode(96);
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? n : end + 2; blank(i, stop); i = stop; continue; }
        if (c === '/' && c2 === '/') { const end = src.indexOf(NL, i + 2); const stop = end < 0 ? n : end; blank(i, stop); i = stop; continue; }
        if (c === Q || c === String.fromCharCode(34) || c === tick) {
            let j = i + 1;
            while (j < n) {
                if (src[j] === BS) { j += 2; continue; }
                if (src[j] === c) { j += 1; break; }
                j += 1;
            }
            const stop = Math.min(j, n);
            /* 保留首尾引号本身，只抹内容：`'x'` 抹后仍看得出「这里有一个字符串」 */
            out[i] = c;
            for (let k = i + 1; k < stop; k++) out[k] = src[k] === NL ? NL : ' ';
            if (stop > i + 1) out[stop - 1] = src[stop - 1] === c ? c : ' ';
            i = stop; continue;
        }
        out[i] = c; i += 1;
    }
    return out.join('');
}

/* ============================================================
 * 载体与台账：谁被本套件守着（每一个都必须被至少一条判据读到）
 * ============================================================ */
/* 七族写回口的**域名台账**：域名 → 载体文件 → 该域名在文件里必须出现的次数。
 *   逐条对账的理由：域名既是诊断面「挡了谁」的唯一线索，也是本套件判「令牌与栅栏成对」的锚点
 *   —— 名称漂移（改了域名字符串却没跟上判据）会让读数面出现一个谁也认不出的域名。 */
const WIRED = [
    ['diary-photo', 'apps/diary/diary-data.js', 1],
    ['diary-photo-failed', 'apps/diary/diary-data.js', 1],
    ['diary-batch', 'apps/diary/diary-data.js', 2],
    ['weibo-recommend', 'apps/weibo/weibo-data.js', 1],
    ['weibo-hot-detail', 'apps/weibo/weibo-data.js', 1],
    ['weibo-hot-append', 'apps/weibo/weibo-data.js', 1],
    ['weibo-reaction', 'apps/weibo/weibo-data.js', 1],
    ['weibo-comment-reply', 'apps/weibo/weibo-data.js', 1],
    ['weibo-more-comments', 'apps/weibo/weibo-data.js', 1],
    ['weibo-auto-cursor', 'apps/weibo/weibo-data.js', 3],
    ['weibo-reaction-comments', 'apps/weibo/weibo-view.js', 1],
    ['weibo-reaction-likes', 'apps/weibo/weibo-view.js', 1],
    ['weibo-comment-replies', 'apps/weibo/weibo-view.js', 1],
    ['honey-host-summary', 'apps/honey/honey-data.js', 1],
    ['calendar-schedule', 'apps/calendar/calendar-app.js', 1],
    ['wechat-image-prompt-failed', 'apps/wechat/chat-view.js', 1],
    ['wechat-image-prompt', 'apps/wechat/chat-view.js', 1],
    ['wechat-image-video', 'apps/wechat/chat-view.js', 1],
    ['wechat-image', 'apps/wechat/chat-view.js', 1],
    ['wechat-image-failed', 'apps/wechat/chat-view.js', 1],
    ['wechat-moment-image', 'apps/wechat/moments-view.js', 1],
    ['wechat-moment-image-failed', 'apps/wechat/moments-view.js', 1],
];
const WRITE_FILES = [...new Set(WIRED.map((r) => r[1]))];
const CARRIERS = [GATE_REL, INDEX_REL, DIAG_DATA_REL, DIAG_VIEW_REL].concat(WRITE_FILES);

/* ============================================================
 * R1 面：唯一实现的结构契约
 * ============================================================ */
const GATE_ANCHORS = [
    ['世代推进口', 'export function bumpSessionEpoch('],
    ['令牌记取口', 'export function captureSessionToken('],
    ['写回裁决口', 'export function guardSessionWrite('],
    ['账本读出口', 'export function sessionDropLog('],
    ['账本上限常量', 'const DROP_LOG_MAX = ' + String(DROP_LOG_MAX_EXPECT) + ';'],
    ['账本截断（有界）', 'gate.drops.splice(0, gate.drops.length - DROP_LOG_MAX)'],
    ['两维裁决 · 先比 id', 'if (nowId !== tokenId) return ' + Q + 'chat-changed' + Q + ';'],
    ['两维裁决 · 再比 epoch', 'if (tokenEpoch !== gate.epoch) return ' + Q + 'epoch-bumped' + Q + ';'],
    ['世代不分桶（整体 +1）', 'gate.epoch += 1;'],
    ['唯一取数门', 'import { numOrNull } from ' + Q + './num-gate.js' + Q + ';'],
];
function gateProblems(root) {
    const bad = [];
    const src = readFrom(root, GATE_REL);
    const code = codeKeepStr(src);
    for (const [label, anchor] of GATE_ANCHORS) {
        const n = hits(code, anchor);
        if (n !== 1) bad.push('R1 「' + label + '」锚点命中 ' + String(n) + ' 次（应 1）');
    }
    /* 四种拒绝原因文案必须**互不相同**（同形文案等于没有归因），且都必须是非空 */
    const texts = [];
    for (const r of ['invalid-token', 'no-identity', 'chat-changed', 'epoch-bumped']) {
        const m = new RegExp(Q + r + Q + '\\s*:\\s*' + Q + '([^' + Q + ']+)' + Q).exec(code);
        if (!m) { bad.push('R1 拒绝原因缺可读文案：' + r); continue; }
        texts.push(m[1]);
    }
    if (new Set(texts).size !== texts.length) bad.push('R1 拒绝原因文案彼此重复（不可读）：' + JSON.stringify(texts));
    /* fail-closed：身份取不到必须判不当前 —— 不得出现「取不到就给个默认身份」那种 fail-open 写法 */
    if (/return\s+[^;]*default_chat/.test(codeOnly(src))) bad.push('R1 身份取不到时给了默认身份（fail-open）');
    return bad;
}

/* ============================================================
 * R2 面：真调用行为 —— 真 import 真模块，假 storage 驱动验收序列
 *   为什么必须真调：文本在场只证明「写过」；「旧回信会不会落进新会话」是**行为**。
 * ============================================================ */
/** 建一棵只含栅栏模块与其依赖的副本树，返回可独立 import 的模块 URL（每次都是新实例，世代从 0 起）。 */
function gateSandbox() {
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3580-' + String(seq) + '-'));
    temps.push(d);
    for (const rel of [GATE_REL, NUM_GATE_REL]) {
        const p = path.join(d, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), p);
    }
    return pathToFileURL(path.join(d, GATE_REL)).href + '?s=' + String(seq);
}
/** 「两个会话桶」的假 storage：写进哪个桶由**当前**身份决定，桶内容逐字可对账。 */
function fakePhone(initialBuckets) {
    const buckets = Object.assign({ A: '', B: '' }, initialBuckets || {});
    const state = { id: 'A' };
    return {
        buckets,
        state,
        storage: {
            get currentConversationId() { return state.id; },
            set currentConversationId(v) { state.id = v; },
            getContext() { return { chatId: state.id }; },
        },
        /* 模拟「旧回信写回」：不设栅栏时它会写进**当前**桶 —— 这正是要消灭的形态 */
        write(text) { buckets[state.id] += text; },
    };
}
const C = { A: 'A', B: 'B' };
async function behaviorProblems() {
    const bad = [];
    /* ⓪ 夹具自证：不设栅栏时写回必须真落进当前桶 —— 否则后面每条「没落盘」都是空断言 */
    const probe = fakePhone();
    probe.write('x');
    if (probe.buckets.A !== 'x' || probe.buckets.B !== '') bad.push('R2 夹具自证失败：写回没有落进当前桶');

    /* ① A 发请求 → 切 B → A 的回信回来：必须被拒，B 逐字不受影响 */
    {
        const G = await import(gateSandbox());
        const p = fakePhone({ B: 'B-既有内容' });
        const token = G.captureSessionToken(p.storage);
        p.state.id = C.B;                       // 宿主直接换会话（即使扩展没收到 CHAT_CHANGED）
        const snapshotB = p.buckets.B;
        const allow = G.guardSessionWrite(p.storage, token, 'weibo-recommend');
        if (allow !== false) bad.push('R2 序列① 换会话后旧回信仍被允许写回（id 维失守）');
        /* 调用方口径：**只有放行才写**（这正是所有写回点接入后的写法）。不当前即一条都不落盘。
         *   夹具自证已在 ⓪ 做过配对面：不设栅栏时，同一次写会落进**当前**桶。 */
        if (allow === true) p.write('旧回信');
        if (p.buckets.B !== snapshotB) bad.push('R2 序列① B 会话状态被改动：' + JSON.stringify(p.buckets.B));
        const log = G.sessionDropLog();
        if (log.count !== 1) bad.push('R2 序列① 拒绝未落账本，count=' + String(log.count));
        const row = log.rows[0];
        if (!row || row.reason !== 'chat-changed') bad.push('R2 序列① 拒绝原因不可读/不对：' + JSON.stringify(row));
        if (!row || !row.text || !row.domain) bad.push('R2 序列① 账本缺域名或可读文案');
    }
    /* ② A 清空（id 不变、世代变）→ 旧保存回调：必须被拒（只比 id 会漏这条） */
    {
        const G = await import(gateSandbox());
        const p = fakePhone();
        const token = G.captureSessionToken(p.storage);
        G.bumpSessionEpoch('clear-current-data');
        const allow = G.guardSessionWrite(p.storage, token, 'diary-batch');
        if (allow !== false) bad.push('R2 序列② 清当前数据后旧回信仍被允许（epoch 维失守）');
        const row = G.sessionDropLog().rows[0];
        if (!row || row.reason !== 'epoch-bumped') bad.push('R2 序列② 原因应为 epoch-bumped：' + JSON.stringify(row));
        if (p.buckets.A !== '') bad.push('R2 序列② 清空后的旧回信落盘了：' + JSON.stringify(p.buckets.A));
    }
    /* ③ 切走 A → 到 B → 再切回 A：id 相同、世代已不同，途中那一轮必须被拒 */
    {
        const G = await import(gateSandbox());
        const p = fakePhone();
        const token = G.captureSessionToken(p.storage);
        p.state.id = C.B; G.bumpSessionEpoch('chat-changed');
        p.state.id = C.A; G.bumpSessionEpoch('chat-changed');
        const allow = G.guardSessionWrite(p.storage, token, 'honey-host-summary');
        if (allow !== false) bad.push('R2 序列③ 切走又切回后旧回信仍被允许（只比 id 必漏这条）');
        if (G.sessionDropLog().rows[0].reason !== 'epoch-bumped') bad.push('R2 序列③ 原因应为 epoch-bumped');
        /* 反坐实面：切回后**新**发起的那一轮（令牌在最后一次 bump 之后记）必须放行 ——
         *   否则栅栏成了「一律拒绝」，那是同一种错的反方向。 */
        const fresh = G.captureSessionToken(p.storage);
        if (G.guardSessionWrite(p.storage, fresh, 'honey-host-summary') !== true) {
            bad.push('R2 序列③ 反坐实：切回后新发起的请求被误拒（栅栏关死了）');
        }
    }
    /* ④ fail-closed：身份取不到 ⇒ 拒（no-identity）；令牌畸形 ⇒ 拒（invalid-token） */
    {
        const G = await import(gateSandbox());
        const noId = { get: () => null, set: () => { }, currentConversationId: '', getContext: () => null };
        const token = G.captureSessionToken(noId);
        if (token.id !== '') bad.push('R2 令牌在拿不到身份时未如实留空：' + JSON.stringify(token.id));
        if (G.guardSessionWrite(noId, token, 'weibo-reaction') !== false) bad.push('R2 拿不到身份却放行了（fail-open）');
        const p = fakePhone();
        for (const badToken of [null, undefined, 7, { epoch: 'x' }, {}]) {
            if (G.guardSessionWrite(p.storage, badToken, 'weibo-reaction') !== false) {
                bad.push('R2 畸形令牌被放行：' + JSON.stringify(badToken));
            }
        }
        const reasons = new Set(G.sessionDropLog().rows.map((r) => r.reason));
        if (!reasons.has('no-identity') || !reasons.has('invalid-token')) {
            bad.push('R2 两种拒绝原因未如实分面：' + JSON.stringify([...reasons]));
        }
        /* 世代确为 0 的合法令牌必须放行；而**取不到数**的世代不得被读成 0 而与真世代撞车
         *   （本仓 v3.57.0 治过的那族错读数：Number(null) === 0） */
        if (G.guardSessionWrite(p.storage, G.captureSessionToken(p.storage), 'weibo-reaction') !== true) {
            bad.push('R2 真世代 0 的合法令牌被误拒');
        }
        if (G.guardSessionWrite(p.storage, { id: p.state.id, epoch: null }, 'weibo-reaction') !== false) {
            bad.push('R2 空世代被读成 0 并与真世代 0 撞车（Number(null) 那族错读数复发）');
        }
    }
    /* ⑤ 反复开关 20 次：每轮旧回信都被拒、新请求都放行；账本读数可解释 */
    {
        const G = await import(gateSandbox());
        const p = fakePhone();
        let dropped = 0;
        for (let i = 0; i < 20; i += 1) {
            const token = G.captureSessionToken(p.storage);
            p.state.id = (p.state.id === C.A) ? C.B : C.A;
            G.bumpSessionEpoch('chat-changed');
            if (G.guardSessionWrite(p.storage, token, 'wechat-image') !== false) {
                bad.push('R2 序列④ 第 ' + String(i + 1) + ' 次开关后旧回信被放行');
            } else dropped += 1;
            if (G.guardSessionWrite(p.storage, G.captureSessionToken(p.storage), 'wechat-image') !== true) {
                bad.push('R2 序列④ 第 ' + String(i + 1) + ' 次开关后新请求被误拒');
            }
        }
        const log = G.sessionDropLog();
        if (dropped !== 20) bad.push('R2 序列④ 20 次开关应有 20 次拒绝，实得 ' + String(dropped));
        if (log.count !== 20) bad.push('R2 序列④ 账本应保留 20 条（未触顶），实得 ' + String(log.count));
        if (log.epoch !== 20) bad.push('R2 序列④ 世代应推进 20 次，实得 ' + String(log.epoch));
        if (p.buckets.A !== '' || p.buckets.B !== '') bad.push('R2 序列④ 被拒的回信仍落了盘');
        /* 账本必须是快照副本：改它不得动内部状态 */
        log.rows.length = 0;
        if (G.sessionDropLog().count !== 20) bad.push('R2 账本读出口返回的不是副本（外部可改内部状态）');
    }
    /* ⑥ 账本触顶后按住最近 60 条（有界：遥测不得成为新的泄漏源） */
    {
        const G = await import(gateSandbox());
        const p = fakePhone();
        for (let i = 0; i < 75; i += 1) {
            const t = G.captureSessionToken(p.storage);
            G.bumpSessionEpoch('stress');
            G.guardSessionWrite(p.storage, t, 'wechat-moment-image');
        }
        const log = G.sessionDropLog();
        if (log.count !== DROP_LOG_MAX_EXPECT) bad.push('R2 账本应截到 ' + String(DROP_LOG_MAX_EXPECT) + '，实得 ' + String(log.count));
        if (log.rows[log.rows.length - 1].domain !== 'wechat-moment-image') bad.push('R2 账本截断把最新的丢了（应保留最近）');
    }
    return bad;
}

/* ============================================================
 * R3 面：接线台账 —— 抬世代的**三条**与会话内失效的**三条**都要各就各位
 * ============================================================ */
/* 入口的**代码面**：先剥掉内置公告块，再按需要的面处理。
 *   为什么必须剥公告块：`ST_PHONE_CURRENT_UPDATE.items` 是**面向用户的文案**，里面会出现
 *   `bumpSessionEpoch('chat-changed')` 这样的字样（本版条目正当地描述了这件事）。
 *   不剥它，判据数到的「抬世代路径」会把文案也算一条 ⇒ 命中 2 次、且首个命中落在文案里，
 *   于是「同址断言」去比一段数据而不是代码（本仓既有套件同样剥公告块，理由一致）。
 *   ⚠️ **两个面必须取自同一份剥过公告块的文本**：否则 `code` 里的下标拿到 `clear` 里去切片，
 *   会被剥掉的那一段整体错位（本套件第二跑即踩中：三条同址断言全红）。 */
function indexPeeled(src) {
    const START = 'const ST_PHONE_CURRENT_UPDATE = {';
    const i = src.indexOf(START);
    if (i < 0) return src;
    const j = src.indexOf(NL + '};', i);
    if (j < 0) return src;
    return src.slice(0, i) + src.slice(j + 3);
}
const BUMP_TEXT = ['chat-changed', 'clear-current-data', 'clear-all-data'];
function wiringProblems(root) {
    const bad = [];
    const peeled = indexPeeled(readFrom(root, INDEX_REL));
    const code = codeKeepStr(peeled);
    const clear = codeOnly(peeled);
    /* ① 三条会话身份变更路径都必须抬世代，且各自与文件内会话代号同址 */
    const bumpCalls = BUMP_TEXT.map((r) => 'bumpSessionEpoch(' + Q + r + Q + ')');
    for (const call of bumpCalls) {
        const n = hits(code, call);
        if (n !== 1) bad.push('R3 抬世代路径缺一或多：' + call + ' 命中 ' + String(n) + ' 次');
    }
    const gens = hits(clear, '_chatSessionGeneration += 1;');
    if (gens !== 3) bad.push('R3 会话代号自增点应恰 3 处，实得 ' + String(gens));
    /* 同址断言：每处 bump 之前 900 字符内必须有过一次 _chatSessionGeneration += 1
     *   （两把尺子必须一起抬：少抬哪一下，旧回信就会跨会话落盘） */
    for (const call of bumpCalls) {
        const at = code.indexOf(call);
        if (at < 0) continue;
        const win = clear.slice(Math.max(0, at - 900), at);
        if (win.indexOf('_chatSessionGeneration += 1;') < 0) bad.push('R3 抬世代未与文件内会话代号同址：' + call);
    }
    /* ② 反向：会话**内**的失效（删楼 / 滑动 / 重新生成）不得抬世代 ——
     *   它们并没有换会话，抬了会把同一段会话里其它在飞的正常回信整段误杀（方向相反的同一类错）。 */
    const intraAnchors = [
        ['删楼', 'context.event_types.MESSAGE_DELETED'],
        ['滑动', 'context.event_types.MESSAGE_SWIPED'],
        ['重新生成按钮', 'data-i18n=' + String.fromCharCode(34) + 'Regenerate' + String.fromCharCode(34)],
    ];
    for (const [label, anchor] of intraAnchors) {
        const at = code.indexOf(anchor);
        if (at < 0) { bad.push('R3 会话内路径锚点不在场（判据前提失效）：' + label); continue; }
        const seg = code.slice(at, at + 3000);
        if (seg.indexOf('bumpSessionEpoch(') >= 0) bad.push('R3 会话内路径错误抬世代：' + label);
    }
    /* ③ 换会话重绑表必须含搜索 App（它持扫描代际与指向当前会话的宿主源表） */
    const m = /ST_PHONE_REBIND_APP_KEYS\s*=\s*\[([\s\S]*?)\];/.exec(code);
    if (!m) { bad.push('R3 未找到换会话重绑表'); return bad; }
    const keys = m[1].split(',').map((s) => s.trim()).filter((s) => s.indexOf(Q) === 0).map((s) => s.split(Q)[1]);
    if (keys.indexOf('searchApp') < 0) bad.push('R3 重绑表缺 searchApp');
    if (keys.length < REBIND_MIN) bad.push('R3 重绑表收窄到 ' + String(keys.length) + ' 键（下限 ' + String(REBIND_MIN) + '）');
    /* ④ 七族写回口：令牌与栅栏**成对**在场 + 引用唯一真源 + 域名逐条对账 */
    for (const rel of WRITE_FILES) {
        const c = codeKeepStr(readFrom(root, rel));
        const importMark = 'from ' + Q + '../../config/session-gate.js' + Q;
        if (hits(c, importMark) !== 1) bad.push('R3 ' + rel + ' 未以唯一真源引用栅栏模块');
        if (!/\bcaptureSessionToken\s*\(/.test(c)) bad.push('R3 ' + rel + ' 只设栅栏不记令牌（栅栏等于没建：回来时才取身份必然恒真）');
        if (!/\bguardSessionWrite\s*\(/.test(c)) bad.push('R3 ' + rel + ' 有令牌却无栅栏');
    }
    const ledgerDomains = WIRED.map((r) => r[0]);
    for (const [dom, rel, expect] of WIRED) {
        const n = hits(readFrom(root, rel), Q + dom + Q);
        if (n !== expect) bad.push('R3 域名对账失配：' + dom + ' 在 ' + rel + ' 应 ' + String(expect) + ' 次，实得 ' + String(n));
    }
    /* 未登记域名：抓出所有 guard 调用里的域名实参，逐个比对台账（防「改了域名、判据跟不上」） */
    const seen = [];
    for (const rel of WRITE_FILES) {
        const c = codeKeepStr(readFrom(root, rel));
        const re = new RegExp('guardSessionWrite\\s*\\([^;]*?' + Q + '([a-z][a-z0-9-]*)' + Q, 'g');
        let mm;
        while ((mm = re.exec(c)) !== null) seen.push({ dom: mm[1], rel });
    }
    for (const s of seen) {
        if (ledgerDomains.indexOf(s.dom) < 0) bad.push('R3 未登记域名（诊断面会出现认不出的域）：' + s.rel + ' -> ' + s.dom);
    }
    const expectCalls = WIRED.reduce((a, r) => a + r[2], 0);
    if (seen.length !== expectCalls) {
        bad.push('R3 栅栏调用数与台账不符：实得 ' + String(seen.length) + '，台账 ' + String(expectCalls));
    }
    return bad;
}

/* ============================================================
 * R4 面：账本的**消费面** —— 挡下了要有人看得见（计划验收：可读的拒绝原因）
 * ============================================================ */
function diagnoseProblems(root) {
    const bad = [];
    const rawData = readFrom(root, DIAG_DATA_REL);
    const dcode = codeKeepStr(rawData);
    const deref = codeOnly(rawData);
    const vraw = readFrom(root, DIAG_VIEW_REL);
    const vcode = codeKeepStr(vraw);
    if (!/from\s+'\.\.\/\.\.\/config\/session-gate\.js'/.test(dcode)) bad.push('R4 诊断内核未读账本真源');
    if (hits(dcode, 'sessionDropLog()') < 1) bad.push('R4 诊断内核未调读出口');
    if (hits(dcode, 'export function sessionGateFaceText(') !== 1) bad.push('R4 缺一行读数出口 sessionGateFaceText');
    if (hits(dcode, 'sessionGateFaceText,') !== 1) bad.push('R4 一行读数未进默认导出面');
    if (hits(dcode, 'sessionGate }') < 1) bad.push('R4 账本面未进 collectDiagnose 的返回面');
    /* 视图面消费：既要在导入面点到名，也要真调它（只导入不调 = 接线在场而行为没有） */
    if (!/sessionGateFaceText/.test(vcode)) bad.push('R4 诊断视图零消费（账本被读出来却没人显示）');
    if (hits(codeOnly(vraw), 'sessionGateFaceText(') < 1) bad.push('R4 诊断视图只导入不调用');
    /* 面名对账：四种读数必须各自成字段（读到与否 / 归因 / 条数 / 逐条），不靠猜 */
    for (const k of ['ok:', 'reason:', 'count:', 'rows:']) {
        if (deref.indexOf(k) < 0) bad.push('R4 账本面缺字段：' + k);
    }
    return bad;
}
/** 三态文案必须互不相同，且「读不到」不得说成「没挡过」。 */
async function faceTextProblems() {
    const bad = [];
    const M = await import(pathToFileURL(path.join(ROOT, DIAG_DATA_REL)).href);
    const f = M.sessionGateFaceText;
    if (typeof f !== 'function') return ['R4 sessionGateFaceText 不是函数'];
    const a = String(f({ ok: false, reason: 'gate-threw', epoch: null, count: 0, rows: [] }));
    const b = String(f({ ok: true, reason: 'ok', epoch: 3, count: 0, rows: [] }));
    const c = String(f({ ok: true, reason: 'ok', epoch: 3, count: 2, rows: [] }));
    const d = String(f(null));
    if (a === b || b === c || a === c || a === d) bad.push('R4 三态文案未互不相同：' + JSON.stringify([a, b, c, d]));
    if (b.indexOf('未被挡下') < 0) bad.push('R4 零条态未如实说成正常读数：' + b);
    if (!/3/.test(b) || !/3/.test(c) || !/2/.test(c)) bad.push('R4 文案未带上世代号与条数：' + JSON.stringify([b, c]));
    if (a.indexOf('没有被挡下') >= 0 && a.indexOf('不是') < 0) bad.push('R4 读不到态未做反向澄清：' + a);
    return bad;
}

/* ============================================================
 * V 面：版本锚（下限 + 四源自洽）
 * ============================================================ */
function versionProblems(root) {
    const bad = [];
    const man = JSON.parse(readFrom(root, 'manifest.json'));
    const pkg = JSON.parse(readFrom(root, 'package.json'));
    const log = JSON.parse(readFrom(root, 'update-log.json'));
    const idx = readFrom(root, INDEX_REL);
    const vnum = (v) => String(v).split('.').map((x) => Number(x)).reduce((a, b) => a * 1000 + b, 0);
    if (vnum(man.version) < vnum(MIN_VERSION)) bad.push('V1 manifest 版本低于本套件出生版：' + man.version);
    for (const [name, v] of [['package', pkg.version], ['update-log.latest', log.latest], ['update-log.head', log.head]]) {
        if (v !== man.version) bad.push('V1 ' + name + ' = ' + String(v) + '（应与 manifest ' + man.version + ' 同源）');
    }
    if (hits(idx, 'const ST_PHONE_VERSION = ' + Q + man.version + Q + ';') !== 1) bad.push('V1 index.js 版本常量不同源');
    if (!log.versions || !log.versions[man.version]) bad.push('V1 update-log 缺当版条目');
    return bad;
}

/* ============================================================
 * 破坏面：单文件副本树（真源码定点破坏 → 在副本上重跑同款真判据）
 * ============================================================ */
function breakIn(rel, from, to, extraRels = []) {
    const src = readRel(rel);
    const n = hits(src, from);
    if (n !== 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(n));
    seq += 1;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3580-b-' + String(seq) + '-'));
    temps.push(d);
    for (const dep of extraRels) {
        const p = path.join(d, dep);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(ROOT, dep), p);
    }
    const target = path.join(d, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return d;
}

/* ============================================================
 * 顶层用例（真仓读数必须全绿）
 * ============================================================ */
test('R1 唯一实现面：四导出齐 / 两维裁决 / 账本有界 / 四种可读拒绝原因', () => {
    const bad = gateProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R2 真调用行为面：四条验收序列 + fail-closed + 账本有界（真 import 真模块）', async () => {
    const bad = await behaviorProblems();
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R3 接线台账：三条抬世代同址 / 三条会话内路径不抬 / 重绑表含搜索 / 七族写回口成对', () => {
    const bad = wiringProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('R4 诊断消费面：账本有可见出口，三态文案互不相同且不反向归因', async () => {
    const bad = diagnoseProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
    const bad2 = await faceTextProblems();
    assert.deepEqual(bad2, [], bad2.join(' | '));
});
test('V1 ★ 版本下限锚：本套件只在 3.58.0 及以后成立', () => {
    const bad = versionProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V2 载体台账：本版每一处载体都必须被至少一条判据读到', () => {
    for (const rel of CARRIERS) {
        assert.ok(readRel(rel).length > 0, '载体文件为空：' + rel);
    }
    assert.ok(CARRIERS.length >= 11, '载体台账不许少于 11 处（四契约件 + 七族写回口）');
    assert.ok(WIRED.length >= 20, '域名台账不许少于 20 条');
    assert.ok(WRITE_FILES.length >= 7, '写回口文件不许少于七族');
});

/* ============================================================
 * D 面：破坏表 —— 每条真源码定点破坏都必须让对应判据转红
 * ============================================================ */
const D = [
    /* D1：清当前数据那条路径不再抬世代（少抬一处 ⇒ 旧保存回调复活） */
    ['R3 清当前数据不抬世代', INDEX_REL,
        "bumpSessionEpoch('clear-current-data');", 'void 0;', 'wiring'],
    /* D2：清全部数据那条路径不再抬世代 */
    ['R3 清全部数据不抬世代', INDEX_REL,
        "bumpSessionEpoch('clear-all-data');", 'void 0;', 'wiring'],
    /* D3：裁决只剩 id 一维（切走又切回那条必漏） */
    ['R2 裁决只比 id（切回后旧回信被放行）', GATE_REL,
        "    if (tokenEpoch !== gate.epoch) return 'epoch-bumped';",
        '    void tokenEpoch;', 'behavior'],
    /* D4：裁决只剩 epoch 一维（宿主直接换会话那条必漏） */
    ['R2 裁决只比 epoch（直接换会话后旧回信被放行）', GATE_REL,
        "    if (nowId !== tokenId) return 'chat-changed';",
        '    void nowId;', 'behavior'],
    /* D5：身份取不到时 fail-open（给个默认身份让它过） */
    ['R2 身份取不到时 fail-open', GATE_REL,
        "    if (!nowId || !tokenId) return 'no-identity';",
        "    if (!nowId || !tokenId) return 'current';", 'behavior'],
    /* D6：账本无界（遥测变成新的泄漏源） */
    ['R2 账本无界', GATE_REL,
        'if (gate.drops.length > DROP_LOG_MAX) gate.drops.splice(0, gate.drops.length - DROP_LOG_MAX);',
        'void DROP_LOG_MAX;', 'behavior'],
    /* D7：某个写回口摘掉栅栏（旧会话回信直接落盘） */
    ['R3 微博推荐摘掉栅栏', 'apps/weibo/weibo-data.js',
        "if (!guardSessionWrite(this.storage, sessionToken, 'weibo-recommend')) return parsed;",
        'void 0;', 'wiring'],
    /* D8：某个写回口只设栅栏不记令牌（栅栏恒真 = 没建） */
    ['R3 微信生图只设栅栏不记令牌', 'apps/wechat/chat-view.js',
        'const sessionToken = captureSessionToken(storage);',
        'const sessionToken = readClockStamp(storage);', 'wiring'],
    /* D9：重绑表摘掉搜索 App（换会话后旧扫描仍算当前代际） */
    ['R3 重绑表摘掉 searchApp', INDEX_REL,
        "    'searchApp'", '    ' + Q + 'searchApX' + Q, 'wiring'],
    /* D10：诊断内核不再读账本（挡下了也没人看得见） */
    ['R4 诊断内核不读账本', DIAG_DATA_REL,
        'const log = sessionDropLog();', 'const log = null;', 'diagnose'],
    /* D11：三条会话内路径被误抬世代（过度拦截 = 方向相反的同一类错） */
    ['R3 删楼误抬世代', INDEX_REL,
        'rollbackPhoneSmsToFloor(deletedFloor, false);',
        'bumpSessionEpoch(' + Q + 'wrong' + Q + ');' + NL + '                            rollbackPhoneSmsToFloor(deletedFloor, false);', 'wiring'],
    /* D12：诊断视图只导入不调用（接线在场而行为没有） */
    ['R4 诊断视图只导入不调用', DIAG_VIEW_REL,
        'escapeHtml(sessionGateFaceText(face))', 'escapeHtml(String(face))', 'diagnose'],
];
const JUDGES = {
    wiring: (root) => Promise.resolve(wiringProblems(root)),
    diagnose: (root) => Promise.resolve(diagnoseProblems(root)),
    behavior: async (root) => {
        /* 行为判据跑在**副本树里的那一份模块**上（不是真仓模块去测副本文件） */
        const modUrl = pathToFileURL(path.join(root, GATE_REL)).href + '?b=' + String(seq);
        const G = await import(modUrl);
        const bad = [];
        const p = fakePhone();
        const t1 = G.captureSessionToken(p.storage);
        p.state.id = C.B;
        if (G.guardSessionWrite(p.storage, t1, 'weibo-recommend') !== false) bad.push('id 维失守');
        const p2 = fakePhone();
        const t2 = G.captureSessionToken(p2.storage);
        G.bumpSessionEpoch('x');
        if (G.guardSessionWrite(p2.storage, t2, 'weibo-recommend') !== false) bad.push('epoch 维失守');
        const noId = { get: () => null, set: () => { }, currentConversationId: '', getContext: () => null };
        if (G.guardSessionWrite(noId, G.captureSessionToken(noId), 'weibo-recommend') !== false) bad.push('fail-open');
        if (G.guardSessionWrite(p2.storage, { id: p2.state.id, epoch: null }, 'weibo-recommend') !== false) bad.push('空世代撞车');
        for (let i = 0; i < 75; i += 1) {
            const t = G.captureSessionToken(p2.storage);
            G.bumpSessionEpoch('s');
            G.guardSessionWrite(p2.storage, t, 'weibo-recommend');
        }
        if (G.sessionDropLog().count > DROP_LOG_MAX_EXPECT) bad.push('账本无界');
        return bad;
    },
};
const EXTRA_DEPS = {
    [GATE_REL]: [NUM_GATE_REL],
};
async function runBreak(row) {
    const [label, rel, from, to, judgeName] = row;
    const judge = JUDGES[judgeName];
    if (typeof judge !== 'function') throw new Error('判据名不存在：' + judgeName);
    const ws = breakIn(rel, from, to, EXTRA_DEPS[rel] || []);
    try { return await judge(ws); } catch (_e) { return [judgeName]; }
}
test('D1~D12 破坏表：每条真源码定点破坏都必须让对应判据转红', async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        assert.ok(Array.isArray(bad) && bad.length >= 1, row[0] + ' 破坏未被观测到（判据没响）');
    }
});
test('D13 原版真：未破坏的副本树上，同款行为判据必须真（否则「恒红」也能骗过破坏表）', async () => {
    const ws = breakIn(GATE_REL, 'const DROP_LOG_MAX = ', 'const DROP_LOG_MAX = ', [NUM_GATE_REL]);
    const bad = await JUDGES.behavior(ws);
    assert.deepEqual(bad, [], '原版上行为判据不真：' + bad.join(' | '));
});
test('D14 真仓只读：全部破坏跑完后，真仓五面判据必须仍然干净', async () => {
    const rounds = [
        ['R1', gateProblems(ROOT)],
        ['R3', wiringProblems(ROOT)],
        ['R4', diagnoseProblems(ROOT)],
        ['R2', await behaviorProblems()],
        ['R4-text', await faceTextProblems()],
    ];
    for (const [name, bad] of rounds) assert.deepEqual(bad, [], name + '：' + bad.join(' | '));
});