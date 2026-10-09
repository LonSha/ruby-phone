// tests/system-v3270.test.mjs — 头像框 + 商城 + 拉黑 + 天气：四件都不做「第二个权威」[v3.27.0]
//
//   本版接的是素材缝合路线图 L1 余下小件里的四件：
//     ① 头像框 —— 源 EPhone·xintuk `avatar-frames/001.js`（打包载荷 51639 字节 / 1823 行）+ `main-app/033.js`
//     ② 商城   —— 源 EPhone·xINOVO `js/modules/shop.js`（1068 行 / 38254 字符）
//     ③ 拉黑   —— 源 MyPhone `block.js`
//     ④ 天气   —— 源 xINOVO 四家 provider + MyPhone 两处 fetch
//
//   缝合**不是搬运**。四件各有一块「源有本仓不能有」的东西，本套件守的就是「它们没被搬进来」：
//     ① 头像框的禁区是 **外链图床 + 自建 IndexedDB**：源 364 条框全部指向 `i.postimg.cc`，
//        上传的框 base64 化后进 `db.customAvatarFrames`（Dexie）。本仓**零数据库铁律 + 不新增外链消费**
//        （见 tests/audit.test.mjs 第 8 段），故本件**从不内置那 364 个 URL**、一条 URL 都没有，
//        只做「认得出你贴进来的是什么」——C5 守这条（先剥注释再判，且两向自证）。
//     ② 商城的禁区是 **商品靠模型生成 + 口令从正文正则抓**：源商品桶装的是「等模型填」的位置；
//        源 `handlePickupConfirm` 遍历 `chat.history` 用正则从**正文**里抠口令。
//        本仓正文归属在聊天层（App 读正文＝在别人的账本上写第二套账；正则漂移即静默失效），
//        故口令改由本 App 自己签发、商品由用户登记。C5 守这条。
//     ③ 拉黑的禁区是 **自己调模型判答不答应 + 自己轮询**：源 `aiDecideAndMaybeSendRequest`
//        调模型判接受/拒绝；`autoNextCheck` 是个自己转的定时器。本仓模型调用走宿主生成侧，
//        故申请一律落成 pending 等生成侧回，倒计时只是**读数不是定时器**。C5 守这条。
//     ④ 天气的禁区是 **源自己发请求 + 自己定位 + 读别的 App 的表**：四家 provider 直连、
//        `navigator.geolocation`、`indexedDB.open('PhoneSimOctopus')` 读章鱼助手的任务表。
//        本仓零外部请求、不碰权限面、没有跨 App 引用。C5 守这条。
//
//   本套件守七类会**静默失效**的形态（都不报错、不崩溃，只是结果不对）：
//     A 头像框内核：六态认源 / 「无框」是正式选项 / **按 URL 去重而不是按 id**（源 id 重复 82 次）/ 坏输入如实拒（不静默截成半张图）/ 归因先判可读 / 挂载点「框已被删」要标 orphan；
//     B 商城内核：钱一律整数分（`0.1+0.2` 类误差会让两处合计差一分）/ 默认分类 id 撞车要拦 /
//       购物车是「条目+数量」/ 缺货单独计数不静默吞 / **下单是快照不是引用** / 口令忽略大小写空格；
//     C 拉黑内核：两本账对称 / 重复拉黑不开第二段历史 / pending 不叠第二条 /
//       接受即自动解除 / 倒计时是读数不是定时器（auto 模式不拦）/ 改模式不抹已等过的时间；
//     D 天气内核：码要翻成人话 / 未知码不猜成晴 / 算不算下雨含冻雨雷阵雨 / 城市与温度至少一个 /
//       码非法不拒收（码表会扩）/ 过期只标「未必是当下的」不删数据；
//     E 接线：四件各四处注册齐备 / **视图调用面必须闭合在 App 上**（v3250 记过的
//       「视图调了 App 上不存在的方法」静默断裂）/ 样式源与 phone.css 逐字同源 / 前缀不与他人撞；
//     F 键归属：十二条新键在门禁账本里且 scope=chat；
//     G 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红（八条）；
//     H 判据工具自证：剥注释器两向、替换必须保真、锚点必须在场。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/<app>/<file>.js` + `<tmp>/config/num-gate.js`），否则 `../../config/num-gate.js`
//   会解析到 `/config/num-gate.js`（差两级，首跑即 ERR_MODULE_NOT_FOUND）；
//   判据函数仍只吃**数据对象**，不吃模块内部实现。
//
//   取段纪律（v3.27.0 交棒，同 v3260 C3）：**段尾按下一个段头截断，不取文件尾** ——
//   phone.css 是追加式产物，本版往后接了四段，取到文件尾会把新段并进来 ⇒ 以「逐字同源失败」假红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    AVATAR_FRAME_REASONS, AVATAR_FRAME_TARGETS, AVATAR_FRAME_LIMITS, DEFAULT_AVATAR_FRAME_SETTINGS,
    defaultAvatarFrameSettings, normalizeAvatarFrameSettings, classifySource, isStorable,
    parsePresetFrames, dedupeFrames, normalizeFrame, normalizeFrames, resolveFrame,
    readAvatarFrameFace, assignStats, projectFrames, avatarFramePromptBlock,
} from '../apps/avatarframe/avatarframe-data.js';

import {
    SHOP_REASONS, SHOP_PRESET_CATEGORIES, SHOP_LIMITS, DEFAULT_SHOP_SETTINGS,
    defaultShopSettings, normalizeShopSettings, yuanToCents, formatCents, normalizeProduct,
    normalizeProducts, normalizeCategories, allCategories, categoryLabel, addToCart, setQty,
    removeFromCart, clearCart, cartTotal, makePickupCode, checkout, pickup, cancelOrder,
    removeOrder, readShopFace, projectShop, shopPromptBlock,
} from '../apps/shop/shop-data.js';

import {
    BLOCK_REASONS, BLOCK_REAPPLY_MODES, BLOCK_LIMITS, DEFAULT_BLOCK_SETTINGS,
    defaultBlockSettings, normalizeBlockSettings, emptyBlockState, normalizeBlockState,
    setBlocked, clearBlocked, charApplyRequest, resolveRequest, setReapply, cooldownRemaining,
    setCharBlocked, clearCharBlocked, myApply, resolveMyRequest, clearAllHistory, resetBlockState,
    readBlockFace, lastRejectReason, projectBlock, formatCooldown, blockPromptBlock,
} from '../apps/block/block-data.js';

import {
    WEATHER_REASONS, WEATHER_SLOTS, WEATHER_LIMITS, DEFAULT_WEATHER_SETTINGS,
    defaultWeatherSettings, normalizeWeatherSettings, WEATHER_KINDS, WEATHER_CODES,
    WEATHER_RAIN_CODES, isRainCode, describeCode, kindOfCode, formatTempC, formatAge,
    normalizeWeatherState, emptyWeatherState, setObservation, clearObservation,
    clearAllObservations, readWeatherFace, slotReading, projectWeather, weatherPromptBlock,
} from '../apps/weather/weather-data.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AVF_REL = 'apps/avatarframe/avatarframe-data.js';
const SHP_REL = 'apps/shop/shop-data.js';
const BLK_REL = 'apps/block/block-data.js';
const WTH_REL = 'apps/weather/weather-data.js';
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
const VNUM32 = (v) => String(v).split('.').reduce((a, x) => a * 1000 + Number(x), 0);

/** 固定「现在」：倒计时与时效是时间逻辑，判据必须与真实时钟解耦。 */
const NOW = new Date('2026-09-30T12:00:00').getTime();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** 剥注释（字符状态机，与 v3200 / v3201 / v3250 / v3260 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本版四件的文件头逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`postimg`、`indexedDB`、`fetch(`、
 *    `geolocation`、`aiDecideAndMaybeSendRequest`…）是**说明**不是**消费**。
 *    判据必须自己实现一遍：不许用被审对象自己的实现来审它自己。 */
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

/* ── 小夹具 ── */
/** 一条最简自包含框（data-url 是最短的可落地形态）。 */
const D1 = 'data:image/png;base64,AAAA';
const D2 = 'data:image/gif;base64,BBBB';
const mkFrame = (src, name) => ({ src, name: name || 'f' });

/* ══════════════════════ 判据本体（纯函数，可对真模块或破坏副本跑） ══════════════════════ */

/* ── A1 六态认源 + 可落地门控 + 身份是 src 不是 id ── */
function avatarClassifyProblems(api) {
    const bad = [];
    const cases = [
        ['', 'empty'], ['   ', 'empty'], [null, 'empty'], [undefined, 'empty'],
        ['frame_cat_ear', 'preset-token'], ['frame_14', 'preset-token'],
        [D1, 'data-url'], ['data:image/svg+xml;base64,XX', 'data-url'],
        ['data:text/html,<b>1</b>', 'invalid'],
        ['blob:https://x/y', 'blob-url'],
        ['https://i.postimg.cc/a.png', 'external-url'], ['HTTP://x/y.png', 'external-url'],
        ['javascript:alert(1)', 'invalid'], ['data', 'invalid'], ['frame_', 'invalid'],
    ];
    for (const [src, want] of cases) {
        const got = api.classifySource(src);
        if (got !== want) bad.push('classify(' + JSON.stringify(src) + ')=' + got + ' want ' + want);
    }
    /* 可落地门控：外链只有显式打开 allowExternal 才算「落地」。 */
    const on = api.defaultAvatarFrameSettings();
    if (api.isStorable('https://i.postimg.cc/a.png', on) !== false) bad.push('ext-default-off');
    if (api.isStorable('https://i.postimg.cc/a.png', { allowExternal: true }) !== true) bad.push('ext-on');
    if (api.isStorable(D1, on) !== true) bad.push('data-ok');
    if (api.isStorable('blob:x', on) !== false) bad.push('blob-not-storable');
    if (api.isStorable('', on) !== true) bad.push('empty-is-none-option');
    /* 默认设置：注入开、外链关（源是直连图床，本仓默认不接）。 */
    if (on.injectToPrompt !== true || on.allowExternal !== false) bad.push('defaults');
    const s = api.normalizeAvatarFrameSettings({ maxInjectFrames: 999, allowExternal: 'yes' });
    if (s.maxInjectFrames !== 20) bad.push('clamp-max:' + s.maxInjectFrames);
    if (s.allowExternal !== false) bad.push('allowExternal-strict');
    const s2 = api.normalizeAvatarFrameSettings({ maxInjectFrames: '' });
    if (s2.maxInjectFrames !== DEFAULT_AVATAR_FRAME_SETTINGS.maxInjectFrames) bad.push('empty-not-zero:' + s2.maxInjectFrames);
    if (AVATAR_FRAME_TARGETS.length !== 2 || AVATAR_FRAME_TARGETS.join() !== 'my,ai') bad.push('two-targets');
    return bad;
}

/* ── A2 解析预置清单：真解析、坏条目如实报 ── */
function avatarParseProblems(api) {
    const bad = [];
    const text = '{ id: "frame_a", url: "' + D1 + '", name: "耳朵" },\n'
        + '{ id: "frame_b", url: "https://i.postimg.cc/b.png", name: "帽子" },\n'
        + '{ id: "frame_c", name: "坏条目缺 url" },';
    const r = api.parsePresetFrames(text);
    if (r.matched !== 2) bad.push('matched:' + r.matched);
    if (r.malformed !== 1) bad.push('malformed-not-reported:' + r.malformed);
    if (r.frames[0].kind !== 'data-url') bad.push('kind0:' + r.frames[0].kind);
    if (r.frames[1].kind !== 'external-url') bad.push('kind1:' + r.frames[1].kind);
    if (r.frames[0].name !== '耳朵') bad.push('name');
    if (api.parsePresetFrames('').matched !== 0) bad.push('empty-text');
    /* 逐字形态认不出就如实 0 匹配，不许把垃圾当条目。 */
    if (api.parsePresetFrames('const x = [1,2,3]').matched !== 0) bad.push('not-a-list');
    /* name 截断到上限（长名不炸面板）。 */
    const long = api.parsePresetFrames('{ id: "frame_z", url: "' + D1 + '", name: "' + 'x'.repeat(99) + '" }');
    if (long.frames[0].name.length !== AVATAR_FRAME_LIMITS.maxNameLen) bad.push('name-cap');
    return bad;
}

/* ── A3 身份是 URL：按 src 去重（源 id 重复 82 次，id 不是身份） ── */
function avatarIdentityProblems(api) {
    const bad = [];
    /* 同一个 URL 配两个不同 id ⇒ 只留一条（源 365 条里 id 只有 123 个唯一值）。 */
    const dup = api.dedupeFrames([
        { id: 'frame_14', src: D1, name: '1' },
        { id: 'frame_15', src: D1, name: '2' },
    ]);
    if (dup.frames.length !== 1) bad.push('dedupe-by-url:' + dup.frames.length);
    if (dup.dropped !== 1) bad.push('dedupe-dropped:' + dup.dropped);
    /* 「无框」多条只留一条。 */
    const noneDup = api.dedupeFrames([mkFrame(''), mkFrame(''), mkFrame(D1)]);
    if (noneDup.frames.length !== 2) bad.push('none-once:' + noneDup.frames.length);
    /* normalizeFrame：invalid 拒收、超长拒收、空名补序号。 */
    if (api.normalizeFrame({ src: 'javascript:1' }, 0) !== null) bad.push('reject-invalid');
    if (api.normalizeFrame({ src: 'data:image/png;base64,' + 'A'.repeat(AVATAR_FRAME_LIMITS.maxSrcLen) }, 0) !== null) bad.push('reject-too-long');
    const nf = api.normalizeFrame({ src: D2 }, 3);
    if (nf.name !== '框 4') bad.push('auto-name:' + nf.name);
    if (nf.kind !== 'data-url') bad.push('nf-kind');
    /* normalizeFrames：拒收计数如实。 */
    const nfs = api.normalizeFrames([{ src: D1 }, { src: 'javascript:1' }, { src: D2 }, { src: D1 }]);
    if (nfs.frames.length !== 2) bad.push('nfs-frames:' + nfs.frames.length);
    if (nfs.rejected !== 1) bad.push('nfs-rejected:' + nfs.rejected);
    if (nfs.dropped !== 1) bad.push('nfs-dropped:' + nfs.dropped);
    /* 按 src 找框；空 src 是「摘掉」。 */
    const list = nfs.frames;
    const hitD2 = api.resolveFrame(list, D2);
    /* 补名用的是**原列表下标**（被拒的那条也占一位）⇒ D2 在下标 2，补名「框 3」。 */
    if (!hitD2 || hitD2.src !== D2 || hitD2.name !== '框 3') bad.push('resolve:' + JSON.stringify(hitD2));
    if (api.resolveFrame(list, '') !== null) bad.push('resolve-empty-null');
    if (api.resolveFrame(list, 'https://x/y.png') !== null) bad.push('resolve-miss');
    return bad;
}

/* ── A4 归因 / 投影 / 注入：先判可读、orphan 要标、注入只给事实 ── */
function avatarProjectProblems(api) {
    const bad = [];
    if (api.readAvatarFrameFace(null) !== AVATAR_FRAME_REASONS.storage_absent) bad.push('face-null');
    if (api.readAvatarFrameFace({ storageOk: false, hasFrames: true }) !== AVATAR_FRAME_REASONS.storage_absent) bad.push('face-absent-first');
    if (api.readAvatarFrameFace({ storageOk: true, hasFrames: false }) !== AVATAR_FRAME_REASONS.empty) bad.push('face-empty');
    if (api.readAvatarFrameFace({ storageOk: true, hasFrames: true }) !== AVATAR_FRAME_REASONS.ready) bad.push('face-ready');
    const list = api.normalizeFrames([{ src: D1, name: '耳朵' }, { src: 'https://i.postimg.cc/x.png', name: '外链' }]).frames;
    const p = api.projectFrames(list, { my: D1, ai: 'https://gone/x.png' });
    if (p.mounts.length !== 2) bad.push('mounts:' + p.mounts.length);
    const my = p.mounts.find((m) => m.target === 'my');
    const ai = p.mounts.find((m) => m.target === 'ai');
    if (!my.frame || my.frame.name !== '耳朵' || my.orphan || my.none) bad.push('mount-my');
    /* 挂了 URL 但清单里没有它 ⇒ orphan，且**不是** none（这是本件记的两态）。 */
    if (!ai.orphan || ai.none || ai.frame !== null) bad.push('mount-orphan:' + JSON.stringify(ai));
    if (p.hasAny !== true) bad.push('hasAny');
    /* stats 按 kind 归类。 */
    const st = api.assignStats(list);
    if (st.total !== 2 || st['data-url'] !== 1 || st['external-url'] !== 1) bad.push('stats:' + JSON.stringify(st));
    /* 注入：无框空串 / 开关关空串 / max 截断 / 只给事实。 */
    const set = api.defaultAvatarFrameSettings();
    if (api.avatarFramePromptBlock(p, set) === '') bad.push('inject-empty-when-has');
    if (api.avatarFramePromptBlock(p, { ...set, injectToPrompt: false }) !== '') bad.push('inject-off');
    if (api.avatarFramePromptBlock(p, { ...set, maxInjectFrames: 0 }) !== '') bad.push('inject-max0');
    const empty = api.projectFrames([], {});
    if (api.avatarFramePromptBlock(empty, set) !== '') bad.push('inject-no-frames');
    const txt = api.avatarFramePromptBlock(p, set);
    if (!txt.includes('耳朵')) bad.push('inject-fact-name');
    /* orphan 的那一格必须说明「清单里已没有这个框」，不许静默少一行。 */
    if (!txt.includes('已没有这个框')) bad.push('inject-orphan-label:' + txt);
    return bad;
}

test('A1 六态认源与可落地门控：外链默认不收、blob 不算落地、「无框」是正式选项', () => {
    const bad = avatarClassifyProblems({ classifySource, isStorable, defaultAvatarFrameSettings, normalizeAvatarFrameSettings });
    assert.deepEqual(bad, [], '六态认源必须与设计一致，实测问题：' + bad.join(' , '));
});

test('A2 预置清单真解析：逐字形态认出，坏条目如实报 malformed（不 eval 外来文本）', () => {
    const bad = avatarParseProblems({ parsePresetFrames });
    assert.deepEqual(bad, [], '解析口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(AVATAR_FRAME_LIMITS.maxFrames, 120, '单会话框数上限（源无上限，本仓随会话存档走）');
    assert.equal(read(AVF_REL).split('eval(').length - 1, 0, '本仓不 eval 外来文本');
});

test('A3 身份是 URL 不是 id：按 src 去重（源 365 条的 id 只有 123 个唯一值）', () => {
    const bad = avatarIdentityProblems({ dedupeFrames, normalizeFrame, normalizeFrames, resolveFrame });
    assert.deepEqual(bad, [], '身份口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('A4 归因与投影：先判能不能读；「框已被删而挂载点还指着它」必须标 orphan', () => {
    const bad = avatarProjectProblems({
        AVATAR_FRAME_REASONS, defaultAvatarFrameSettings, normalizeFrames, readAvatarFrameFace,
        assignStats, projectFrames, avatarFramePromptBlock,
    });
    assert.deepEqual(bad, [], '投影与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
    /* 视图文案表的键必须取归因常量的**值**（连字符形），不另写一套下划线形。 */
    const view = read('apps/avatarframe/avatarframe-view.js');
    assert.ok(view.includes('[AVATAR_FRAME_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.ok(read(AVF_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ── B1 钱是整数分：元→分、分→显示串、合计与订单两处必须一致 ── */
function shopMoneyProblems(api) {
    const bad = [];
    if (api.yuanToCents(0.1) + api.yuanToCents(0.2) !== 30) bad.push('float-error:' + (api.yuanToCents(0.1) + api.yuanToCents(0.2)));
    if (api.yuanToCents(12.3) !== 1230) bad.push('12.3:' + api.yuanToCents(12.3));
    if (api.yuanToCents('8') !== 800) bad.push('str-num');
    /* 非法输入一律 null，不猜 0（与 num-gate 同口径）。 */
    for (const v of ['', null, undefined, 'abc', -1, []]) {
        if (api.yuanToCents(v) !== null) bad.push('yuan-null:' + JSON.stringify(v) + '=' + api.yuanToCents(v));
    }
    if (api.formatCents(1230) !== '\u00a512.30') bad.push('fmt:' + api.formatCents(1230));
    if (api.formatCents(0) !== '\u00a50.00') bad.push('fmt0:' + api.formatCents(0));
    if (api.formatCents(5) !== '\u00a50.05') bad.push('fmt5:' + api.formatCents(5));
    for (const v of ['', null, 'x', -3]) {
        if (api.formatCents(v) !== '') bad.push('fmt-empty:' + JSON.stringify(v));
    }
    /* 两处合计必须同源：购物车合计与订单总额在同一个数据上必须相等。 */
    const products = api.normalizeProducts([
        { id: 'p1', name: '饭', priceCents: 1230, category: 'food' },
        { id: 'p2', name: '水', priceCents: 199, category: 'food' },
    ]);
    const c1 = api.addToCart([], 'p1', 3).cart;
    const c2 = api.addToCart(c1, 'p2', 2).cart;
    const t = api.cartTotal(c2, products);
    if (t.cents !== 1230 * 3 + 199 * 2) bad.push('cart-total:' + t.cents);
    if (t.count !== 5 || t.rows !== 2 || t.missing !== 0) bad.push('cart-counts:' + JSON.stringify(t));
    const co = api.checkout([], c2, products, NOW, () => 0.5);
    if (co.order.totalCents !== t.cents) bad.push('order-vs-cart:' + co.order.totalCents + '!=' + t.cents);
    return bad;
}

/* ── B2 默认分类 id 撞车要拦（源 `addCategory` 明确拦 5 个默认 id） ── */
function shopCategoryProblems(api) {
    const bad = [];
    if (api.SHOP_PRESET_CATEGORIES.length !== 5) bad.push('preset-count:' + api.SHOP_PRESET_CATEGORIES.length);
    const ids = api.SHOP_PRESET_CATEGORIES.map((c) => c.id).join(',');
    if (ids !== 'recommend,food,general,guess,character_choice') bad.push('preset-ids:' + ids);
    const r = api.normalizeCategories([
        { id: 'food', name: '想撞车' },
        { id: 'my', name: '我的' },
        { id: 'my', name: '重了' },
        { id: 'nosuch', name: '' },
    ]);
    if (r.categories.length !== 1 || r.categories[0].id !== 'my') bad.push('cats:' + JSON.stringify(r.categories));
    if (r.rejected !== 3) bad.push('cats-rejected:' + r.rejected);
    /* 全部可选分类 = 5 默认 + 自定义；preset 标记要标对。 */
    const all = api.allCategories([{ id: 'my', name: '我的' }]);
    if (all.length !== 6) bad.push('all:' + all.length);
    if (all[0].preset !== true || all[5].preset !== false) bad.push('preset-flag');
    if (api.categoryLabel([{ id: 'my', name: '我的' }], 'my') !== '我的') bad.push('label-custom');
    if (api.categoryLabel([], 'food') !== '食堂') bad.push('label-preset');
    /* 未知 id 回显原串（不编标签）。 */
    if (api.categoryLabel([], 'zzz') !== 'zzz') bad.push('label-unknown');
    return bad;
}

/* ── B3 购物车是「条目+数量」：累加、截上限、缺货单独计数 ── */
function shopCartProblems(api) {
    const bad = [];
    const a1 = api.addToCart([], 'p1', 2);
    if (a1.cart.length !== 1 || a1.cart[0].qty !== 2) bad.push('add-new');
    const a2 = api.addToCart(a1.cart, 'p1', 3);
    if (a2.cart[0].qty !== 5) bad.push('add-accum:' + a2.cart[0].qty);
    /* 超上限**如实截到上限**并回报 clamped（不静默吞）。 */
    const a3 = api.addToCart([{ productId: 'p1', qty: api.SHOP_LIMITS.maxQty }], 'p1', 5);
    if (a3.cart[0].qty !== api.SHOP_LIMITS.maxQty) bad.push('clamp-qty');
    if (a3.clamped !== true) bad.push('clamp-flagged');
    /* 空 productId 不产生条目。 */
    if (api.addToCart([], '', 2).cart.length !== 0) bad.push('empty-id');
    /* setQty 0 = 移出。 */
    if (api.setQty(a2.cart, 'p1', 0).cart.length !== 0) bad.push('setqty-0');
    if (api.setQty(a2.cart, 'p1', 7).cart[0].qty !== 7) bad.push('setqty-7');
    if (api.removeFromCart(a2.cart, 'p1').cart.length !== 0) bad.push('remove');
    if (api.clearCart().cart.length !== 0) bad.push('clear');
    /* 缺货（商品已不在目录）单独计数，且**不静默当 0**。 */
    const products = api.normalizeProducts([{ id: 'p1', name: '饭', priceCents: 100 }]);
    const mixed = api.addToCart(api.addToCart([], 'p1', 1).cart, 'gone', 1).cart;
    const t = api.cartTotal(mixed, products);
    if (t.cents !== 100) bad.push('missing-cents:' + t.cents);
    if (t.missing !== 1) bad.push('missing-count:' + t.missing);
    if (t.count !== 2) bad.push('missing-count-includes:' + t.count);
    return bad;
}

/* ── B4 下单是快照不是引用：商品改价后历史订单不动 ── */
function shopOrderProblems(api) {
    const bad = [];
    const products = api.normalizeProducts([{ id: 'p1', name: '饭', priceCents: 1200, category: 'food' }]);
    const cart = api.addToCart([], 'p1', 1).cart;
    const co = api.checkout([], cart, products, NOW, () => 0.25);
    if (!co.order || co.error) bad.push('checkout-failed:' + co.error);
    if (co.order.totalCents !== 1200) bad.push('order-total:' + co.order.totalCents);
    if (co.order.rows[0].name !== '饭') bad.push('order-snapshot-name');
    /* ★ 快照：把商品改名改价，订单里的那一行必须**一字不变**。 */
    const changed = api.normalizeProducts([{ id: 'p1', name: '贵饭', priceCents: 9900, category: 'food' }]);
    if (co.order.rows[0].name !== '饭' || co.order.rows[0].priceCents !== 1200) bad.push('snapshot-mutated');
    if (changed[0].priceCents !== 9900) bad.push('product-changed-not-taken');
    /* 空车不下单、缺货不下单，都**如实说明**。 */
    const e1 = api.checkout([], [], products, NOW, () => 0.5);
    if (e1.order !== null || !e1.error) bad.push('empty-cart-order');
    const badCart = api.addToCart([], 'gone', 1).cart;
    const e2 = api.checkout([], badCart, products, NOW, () => 0.5);
    if (e2.order !== null || !e2.error) bad.push('missing-product-order');
    /* 口令：六位、去易混、忽略大小写与空格比对。 */
    const code = api.makePickupCode(() => 0);
    if (code.length !== 6) bad.push('code-len:' + code);
    if (/[IO01]/.test(code)) bad.push('code-mixed-up:' + code);
    const ok = api.pickup(co.orders, ' ' + co.order.code.toLowerCase() + ' ', NOW + MIN);
    if (!ok.ok) bad.push('pickup-case-space');
    if (!ok.orderId) bad.push('pickup-id');
    /* 已取的单不再被同码命中（pending 才可核销）。 */
    const again = api.pickup(ok.orders, co.order.code, NOW + 2 * MIN);
    if (again.ok) bad.push('pickup-twice');
    const noCode = api.pickup(co.orders, '', NOW);
    if (noCode.ok) bad.push('pickup-empty');
    /* 取消与删除：只有 pending 能被取消。 */
    const cxl = api.cancelOrder(co.orders, co.order.id);
    if (cxl.changed !== 1 || cxl.orders[0].status !== 'canceled') bad.push('cancel');
    if (api.cancelOrder(ok.orders, co.order.id).changed !== 0) bad.push('cancel-picked');
    if (api.removeOrder(co.orders, co.order.id).removed !== 1) bad.push('remove-order');
    return bad;
}

/* ── B5 归因 / 投影 / 注入：空目录才算 empty，注入只给事实 ── */
function shopProjectProblems(api) {
    const bad = [];
    if (api.readShopFace(null) !== SHOP_REASONS.storage_absent) bad.push('face-null');
    if (api.readShopFace({ storageOk: true, hasProducts: false }) !== SHOP_REASONS.empty) bad.push('face-empty');
    if (api.readShopFace({ storageOk: true, hasProducts: true }) !== SHOP_REASONS.ready) bad.push('face-ready');
    const products = api.normalizeProducts([
        { id: 'p1', name: '饭', priceCents: 1200, category: 'food' },
        { id: 'p2', name: '衣', priceCents: 5000, category: 'general' },
        { id: 'p3', name: '无价', category: 'food' },
    ]);
    const cart = api.addToCart([], 'p1', 2).cart;
    const co = api.checkout([], cart, products, NOW, () => 0);
    const p = api.projectShop(products, [{ id: 'my', name: '我的' }], cart, co.orders);
    if (p.productCount !== 3) bad.push('pcount:' + p.productCount);
    if (p.unPricedCount !== 1) bad.push('unpriced:' + p.unPricedCount);
    if (p.categoryCount !== 6) bad.push('catcount:' + p.categoryCount);
    if (p.customCategoryCount !== 1) bad.push('customcat:' + p.customCategoryCount);
    if (p.byCat.food !== 2 || p.byCat.general !== 1) bad.push('bycat:' + JSON.stringify(p.byCat));
    if (p.cartCents !== 2400 || p.cartCount !== 2) bad.push('cart-read:' + p.cartCents);
    if (p.orderCount !== 1 || p.pendingOrders.length !== 1) bad.push('orders-read');
    if (p.hasAny !== true) bad.push('hasAny');
    const set = api.defaultShopSettings();
    const txt = api.shopPromptBlock(p, set);
    if (!txt.includes('待取自提')) bad.push('inject-shape:' + txt);
    if (!txt.includes(co.order.code)) bad.push('inject-code');
    if (!txt.includes('饭\u00d72')) bad.push('inject-rows:' + txt);
    /* 无待取订单 ⇒ 空串；开关关 ⇒ 空串；max 0 ⇒ 空串。 */
    if (api.shopPromptBlock(api.projectShop(products, [], [], []), set) !== '') bad.push('inject-none');
    if (api.shopPromptBlock(p, { ...set, injectToPrompt: false }) !== '') bad.push('inject-off');
    if (api.shopPromptBlock(p, { ...set, maxInjectOrders: 0 }) !== '') bad.push('inject-max0');
    /* 设置钳制：读不出回落默认，越界夹住。 */
    const s = api.normalizeShopSettings({ pageSize: 999, maxOrders: 1, maxInjectOrders: '' });
    if (s.pageSize !== 50) bad.push('clamp-page:' + s.pageSize);
    if (s.maxOrders !== 10) bad.push('clamp-orders:' + s.maxOrders);
    if (s.maxInjectOrders !== DEFAULT_SHOP_SETTINGS.maxInjectOrders) bad.push('empty-default:' + s.maxInjectOrders);
    return bad;
}

test('B1 钱一律整数分：元→分、分→显示串，购物车合计与订单总额必须同源', () => {
    const bad = shopMoneyProblems({ yuanToCents, formatCents, normalizeProducts, addToCart, cartTotal, checkout });
    assert.deepEqual(bad, [], '金额口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B2 分类可扩展但默认 id 撞车必须拦（源 addCategory 明确拦 5 个默认 id）', () => {
    const bad = shopCategoryProblems({ SHOP_PRESET_CATEGORIES, normalizeCategories, allCategories, categoryLabel });
    assert.deepEqual(bad, [], '分类口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(SHOP_LIMITS.maxPriceCents, 100000000, '单价上限（源无上限，随会话存档走）');
});

test('B3 购物车是「条目 + 数量」：累加、截上限如实回报、缺货单独计数', () => {
    const bad = shopCartProblems({ SHOP_LIMITS, addToCart, setQty, removeFromCart, clearCart, cartTotal, normalizeProducts });
    assert.deepEqual(bad, [], '购物车口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B4 下单是快照不是引用：商品改名改价后历史订单一字不动；口令忽略大小写空格', () => {
    const bad = shopOrderProblems({ normalizeProducts, addToCart, checkout, makePickupCode, pickup, cancelOrder, removeOrder });
    assert.deepEqual(bad, [], '订单与口令口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('B5 归因与投影：空目录才算 empty；注入只给事实、无单即空串', () => {
    const bad = shopProjectProblems({
        SHOP_REASONS, DEFAULT_SHOP_SETTINGS, normalizeProducts, addToCart, checkout, cartTotal,
        normalizeShopSettings, defaultShopSettings, readShopFace, projectShop, shopPromptBlock,
    });
    assert.deepEqual(bad, [], '投影与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
    const view = read('apps/shop/shop-view.js');
    assert.ok(view.includes('[SHOP_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.ok(read(SHP_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ── C1 两本账对称：重复拉黑不开第二段历史，解除给末段补结束时间 ── */
function blockLedgerProblems(api) {
    const bad = [];
    const e = api.emptyBlockState();
    if (!e.direct || !e.reverse) bad.push('two-ledgers');
    if (e.direct.blocked !== false || e.reverse.blocked !== false) bad.push('empty-not-blocked');
    const b1 = api.setBlocked(e, NOW);
    if (b1.changed !== 1 || !b1.state.direct.blocked) bad.push('set-blocked');
    if (b1.state.direct.history.length !== 1 || b1.state.direct.history[0].unblockedAt !== 0) bad.push('first-segment');
    /* ★ 重复拉黑**不开第二段历史**（源每次 push，会多出一段空账）。 */
    const b2 = api.setBlocked(b1.state, NOW + MIN);
    if (b2.changed !== 0) bad.push('repeat-changed');
    if (b2.state.direct.history.length !== 1) bad.push('repeat-second-segment:' + b2.state.direct.history.length);
    /* 解除：给最后一段补结束时间。 */
    const c1 = api.clearBlocked(b2.state, NOW + 5 * MIN);
    if (c1.changed !== 1 || c1.state.direct.blocked) bad.push('clear');
    if (c1.state.direct.history[0].unblockedAt !== NOW + 5 * MIN) bad.push('clear-stamp');
    if (api.clearBlocked(c1.state, NOW + 6 * MIN).changed !== 0) bad.push('clear-twice');
    /* 再拉黑一次 ⇒ 第二段历史（上段已结束）。 */
    const b3 = api.setBlocked(c1.state, NOW + 10 * MIN);
    if (b3.state.direct.history.length !== 2) bad.push('second-segment:' + b3.state.direct.history.length);
    /* 反向那本账对称地写。 */
    const r1 = api.setCharBlocked(b3.state, '', NOW + 11 * MIN);
    if (!r1.state.reverse.blocked) bad.push('char-blocked');
    if (r1.state.reverse.reason !== '不想再聊了') bad.push('char-default-reason:' + r1.state.reverse.reason);
    if (r1.state.reverse.history.length !== 1 || r1.state.reverse.history[0].reason !== '不想再聊了') bad.push('char-hist');
    if (api.setCharBlocked(r1.state, 'x', NOW + 12 * MIN).changed !== 0) bad.push('char-blocked-twice');
    if (api.clearCharBlocked(r1.state, NOW + 13 * MIN).state.reverse.blocked) bad.push('char-clear');
    /* 清账：四个桶全清、如实报 removed、**不动 blocked 状态位**。 */
    const cl = api.clearAllHistory(b3.state);
    if (cl.removed !== 2) bad.push('clear-all-removed:' + cl.removed);
    const z = cl.state;
    if (z.direct.history.length || z.direct.requests.length || z.reverse.history.length || z.reverse.myRequests.length) bad.push('clear-all-rest');
    if (!z.direct.blocked) bad.push('clear-all-keeps-state');
    const rs = api.resetBlockState();
    if (rs.changed !== 1 || rs.state.direct.blocked) bad.push('reset');
    return bad;
}

/* ── C2 pending 不叠第二条；接受即自动解除；by 只认 char / user ── */
function blockRequestProblems(api) {
    const bad = [];
    const s = api.setBlocked(api.emptyBlockState(), NOW).state;
    /* 没拉黑它就没有「重新加好友」这回事。 */
    const no = api.charApplyRequest(api.emptyBlockState(), 'x', NOW);
    if (no.added !== 0 || !no.error) bad.push('apply-without-block:' + JSON.stringify(no));
    const q1 = api.charApplyRequest(s, '想聊聊', NOW + MIN);
    if (q1.added !== 1 || !q1.id) bad.push('apply-1');
    if (q1.state.direct.reapply.lastRequestTime !== NOW + MIN) bad.push('apply-stamps-time');
    /* ★ pending 不叠第二条（否则界面上会浮出两条一样的申请）。 */
    const q2 = api.charApplyRequest(q1.state, '再来一条', NOW + 2 * MIN);
    if (q2.added !== 0 || !q2.error) bad.push('pending-stack:' + JSON.stringify(q2));
    if (q2.state.direct.requests.length !== 1) bad.push('pending-count:' + q2.state.direct.requests.length);
    /* 拒绝：理由带上，且**不解除拉黑**。 */
    const rj = api.resolveRequest(q2.state, q1.id, false, '不想', NOW + 3 * MIN, 'user');
    if (rj.changed !== 1) bad.push('reject-changed');
    const req = rj.state.direct.requests[0];
    if (req.status !== 'rejected' || req.rejectReason !== '不想') bad.push('reject-shape:' + JSON.stringify(req));
    if (req.decidedBy !== 'user') bad.push('reject-by');
    if (!rj.state.direct.blocked) bad.push('reject-keeps-block');
    if (api.lastRejectReason(rj.state.direct.requests) !== '不想') bad.push('last-reject');
    /* ★ 接受 ⇒ 自动解除拉黑（源 acceptFriendRequest 就连着解除）。 */
    const q3 = api.charApplyRequest(rj.state, '再试一次', NOW + 4 * MIN);
    const ac = api.resolveRequest(q3.state, q3.id, true, '', NOW + 5 * MIN, 'char');
    if (ac.state.direct.blocked) bad.push('accept-auto-unblock');
    /* 按 id 找那一条（requests[0] 是更早那条被拒的）—— 按下标回读就是本仓记过的串项形态。 */
    const acc = ac.state.direct.requests.find((r) => r.id === q3.id);
    if (!acc || acc.status !== 'accepted' || acc.decidedBy !== 'char') bad.push('accept-shape:' + JSON.stringify(acc));
    if (ac.state.direct.requests.length !== 2) bad.push('accept-keeps-history:' + ac.state.direct.requests.length);
    /* 已定过的申请再定一次 = 无变化。 */
    if (api.resolveRequest(ac.state, q3.id, true, '', NOW + 6 * MIN, 'user').changed !== 0) bad.push('resolve-twice');
    /* 野 decidedBy 不收录（不编来源）。 */
    const q4 = api.charApplyRequest(api.setBlocked(api.emptyBlockState(), NOW).state, 'x', NOW);
    const dz = api.resolveRequest(q4.state, q4.id, true, '', NOW, 'model');
    if (dz.state.direct.requests[0].decidedBy !== '') bad.push('wild-by:' + dz.state.direct.requests[0].decidedBy);
    /* 反向那条申请（源 submitUserFriendRequest 在此调模型 —— 本件不调）。 */
    const rs = api.setCharBlocked(api.emptyBlockState(), '忙', NOW).state;
    const mine = api.myApply(rs, '对不起', NOW + MIN);
    if (mine.added !== 1) bad.push('my-apply');
    if (api.myApply(mine.state, '又一条', NOW + 2 * MIN).added !== 0) bad.push('my-pending-stack');
    const mr = api.resolveMyRequest(mine.state, mine.id, true, '', NOW + 3 * MIN, 'char');
    if (mr.changed !== 1 || mr.state.reverse.blocked) bad.push('my-accept-auto-unblock');
    if (api.myApply(api.emptyBlockState(), 'x', NOW).added !== 0) bad.push('my-apply-without-block');
    return bad;
}

/* ── C3 倒计时是**读数不是定时器**：auto 不拦、fixed 按间隔、改模式不抹已等过的时间 ── */
function blockCooldownProblems(api) {
    const bad = [];
    const s0 = api.setBlocked(api.emptyBlockState(), NOW).state;
    /* 默认 fixed / 30 分：刚拉黑时还差 30 分。 */
    if (s0.direct.reapply.mode !== 'fixed' || s0.direct.reapply.intervalMin !== 30) bad.push('default-reapply');
    if (api.cooldownRemaining(s0, NOW) !== 30 * MIN) bad.push('cd-fresh:' + api.cooldownRemaining(s0, NOW));
    if (api.cooldownRemaining(s0, NOW + 10 * MIN) !== 20 * MIN) bad.push('cd-10min');
    if (api.cooldownRemaining(s0, NOW + 31 * MIN) !== 0) bad.push('cd-expired');
    /* 没拉黑 ⇒ 0（不拦）。 */
    if (api.cooldownRemaining(api.emptyBlockState(), NOW) !== 0) bad.push('cd-unblocked');
    /* auto 模式 ⇒ 0（谁来什么时候由角色自己看着办）。 */
    const auto = api.setReapply(s0, 'auto', 30).state;
    if (api.cooldownRemaining(auto, NOW) !== 0) bad.push('cd-auto');
    /* ★ 改模式**保留** lastRequestTime：那笔账是既成事实，不该把已等过的时间抹掉。 */
    const applied = api.charApplyRequest(s0, 'x', NOW + MIN).state;
    const toAuto = api.setReapply(applied, 'auto', 60).state;
    if (toAuto.direct.reapply.lastRequestTime !== NOW + MIN) bad.push('mode-keeps-last');
    const backFixed = api.setReapply(toAuto, 'fixed', 60).state;
    if (backFixed.direct.reapply.lastRequestTime !== NOW + MIN) bad.push('mode-keeps-last-2');
    if (api.cooldownRemaining(backFixed, NOW + 11 * MIN) !== 50 * MIN) bad.push('cd-after-mode:' + api.cooldownRemaining(backFixed, NOW + 11 * MIN));
    /* 野模式收敛成 fixed；间隔夹到 [1, 1440]。 */
    if (api.setReapply(s0, 'wild', 30).state.direct.reapply.mode !== 'fixed') bad.push('wild-mode');
    if (api.setReapply(s0, 'fixed', 0).state.direct.reapply.intervalMin !== 1) bad.push('interval-lo');
    if (api.setReapply(s0, 'fixed', 99999).state.direct.reapply.intervalMin !== 1440) bad.push('interval-hi');
    /* formatCooldown 两档口径（与视图/注入共用）。 */
    if (api.formatCooldown(30 * MIN) !== '30 分钟') bad.push('fmt-30:' + api.formatCooldown(30 * MIN));
    if (api.formatCooldown(90 * MIN) !== '1 小时 30 分') bad.push('fmt-90:' + api.formatCooldown(90 * MIN));
    if (api.formatCooldown(120 * MIN) !== '2 小时') bad.push('fmt-120:' + api.formatCooldown(120 * MIN));
    if (api.formatCooldown(0) !== '' || api.formatCooldown(null) !== '') bad.push('fmt-none');
    return bad;
}

/* ── C4 归因 / 投影 / 注入：两本账都平才算 empty；注入不给它出主意 ── */
function blockProjectProblems(api) {
    const bad = [];
    if (api.readBlockFace(null) !== BLOCK_REASONS.storage_absent) bad.push('face-null');
    if (api.readBlockFace({ storageOk: true, hasAny: false }) !== BLOCK_REASONS.empty) bad.push('face-empty');
    if (api.readBlockFace({ storageOk: true, hasAny: true }) !== BLOCK_REASONS.ready) bad.push('face-ready');
    /* 空账的投影：读数全 0，且 hasAny=false（不编数）。 */
    const empty = api.projectBlock(api.emptyBlockState(), NOW);
    if (empty.directBlocked || empty.reverseBlocked) bad.push('proj-empty-blocked');
    if (empty.directTimes !== 0 || empty.requestCount !== 0 || empty.cooldownMs !== 0) bad.push('proj-empty-counts');
    if (empty.hasAny !== false) bad.push('proj-empty-hasAny');
    const set = api.defaultBlockSettings();
    if (api.blockPromptBlock(empty, set) !== '') bad.push('inject-empty');
    /* 有账：facts 在场、且**不能替它答不答应**。 */
    let s = api.setBlocked(api.emptyBlockState(), NOW).state;
    s = api.charApplyRequest(s, 'x', NOW + MIN).state;
    s = api.resolveRequest(s, s.direct.requests[0].id, false, '我还没准', NOW + 2 * MIN, 'user').state;
    const p = api.projectBlock(s, NOW + 3 * MIN);
    if (!p.directBlocked || p.directTimes !== 1) bad.push('proj-direct');
    if (p.pendingFromChar.length !== 0 || p.rejectedCount !== 1) bad.push('proj-req-kind');
    if (p.lastReject !== '我还没准') bad.push('proj-lastReject');
    /* 已提过申请 + fixed 30 分 ⇒ NOW+3 分时还差 28 分（读数是**剩余**，不是「能不能」）。 */
    if (p.cooldownMs !== 28 * MIN) bad.push('proj-cd:' + p.cooldownMs);
    const txt = api.blockPromptBlock(p, set);
    if (!txt.includes('正在拉黑你')) bad.push('inject-direct:' + txt);
    if (!txt.includes('我还没准')) bad.push('inject-lastReject');
    /* 反向那本账：它拉黑你时要说清楚「你当时给的理由」。 */
    const rv = api.setCharBlocked(s, '不想再聊', NOW + 4 * MIN).state;
    const pr = api.projectBlock(rv, NOW + 5 * MIN);
    if (!pr.reverseBlocked || pr.reverseReason !== '不想再聊') bad.push('proj-reverse');
    if (!api.blockPromptBlock(pr, set).includes('你当时给的理由：不想再聊')) bad.push('inject-reverse');
    /* 已过去的两本账（现在都不 blocked）也要有读数。 */
    const past = api.clearBlocked(rv, NOW + 6 * MIN).state;
    const pp = api.projectBlock(past, NOW + 7 * MIN);
    if (pp.directBlocked || pp.directTimes !== 1) bad.push('proj-past');
    if (!api.blockPromptBlock(pp, set).includes('曾拉黑过你')) bad.push('inject-past');
    /* 开关 / max 门。 */
    if (api.blockPromptBlock(pp, { ...set, injectToPrompt: false }) !== '') bad.push('inject-off');
    if (api.blockPromptBlock(pp, { ...set, maxInjectLines: 0 }) !== '') bad.push('inject-max0');
    /* 设置钳制。 */
    const ns = api.normalizeBlockSettings({ maxInjectLines: 99, defaultIntervalMin: 0 });
    if (ns.maxInjectLines !== 20 || ns.defaultIntervalMin !== 1) bad.push('clamp:' + JSON.stringify(ns));
    return bad;
}

test('C1 两本账对称：重复拉黑不开第二段历史，解除给末段补结束时间', () => {
    const bad = blockLedgerProblems({ emptyBlockState, setBlocked, clearBlocked, setCharBlocked, clearCharBlocked, clearAllHistory, resetBlockState });
    assert.deepEqual(bad, [], '拉黑账口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('C2 申请不叠第二条；接受即自动解除拉黑；来源只认 char / user', () => {
    const bad = blockRequestProblems({ emptyBlockState, setBlocked, charApplyRequest, resolveRequest, myApply, resolveMyRequest, setCharBlocked, lastRejectReason });
    assert.deepEqual(bad, [], '申请口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('C3 倒计时是读数不是定时器：auto 不拦、fixed 按间隔、改模式不抹已等过的时间', () => {
    const bad = blockCooldownProblems({ emptyBlockState, setBlocked, charApplyRequest, setReapply, cooldownRemaining, formatCooldown });
    assert.deepEqual(bad, [], '倒计时口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(BLOCK_REAPPLY_MODES.join(), 'fixed,auto', '源就这两个重来模式');
});

test('C4 归因与投影：两本账都平才算 empty；注入只给事实、不替它回答', () => {
    const bad = blockProjectProblems({
        BLOCK_REASONS, defaultBlockSettings, normalizeBlockSettings, emptyBlockState,
        setBlocked, clearBlocked, charApplyRequest, resolveRequest, setCharBlocked,
        readBlockFace, projectBlock, blockPromptBlock,
    });
    assert.deepEqual(bad, [], '投影与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
    const view = read('apps/block/block-view.js');
    assert.ok(view.includes('[BLOCK_REASONS.'), '视图文案表的键必须由归因常量计算');
    assert.ok(read(BLK_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ── D1 码表：翻译成人话、未知码不猜、算不算下雨含冻雨雷阵雨 ── */
function weatherCodeProblems(api) {
    const bad = [];
    if (api.describeCode(0) !== '晴') bad.push('code0');
    if (api.describeCode(61) !== '小雨') bad.push('code61');
    if (api.describeCode(95) !== '雷阵雨') bad.push('code95');
    /* ★ 未收录的码 == 未知，不许猜成晴（源也是这个兼底）。 */
    for (const c of [4, 999, null, '', 'x']) {
        if (api.describeCode(c) !== '未知') bad.push('unknown-desc:' + JSON.stringify(c) + '=' + api.describeCode(c));
        if (api.kindOfCode(c) !== WEATHER_KINDS.unknown) bad.push('unknown-kind:' + JSON.stringify(c));
    }
    /* 算不算下雨：源的码表逐字句句含冻雨 / 雷阵雨。 */
    for (const c of [51, 56, 66, 80, 95, 99]) if (api.isRainCode(c) !== true) bad.push('rain:' + c);
    for (const c of [0, 1, 3, 45, 71, 77]) if (api.isRainCode(c) !== false) bad.push('norain:' + c);
    if (api.isRainCode(null) !== false || api.isRainCode('x') !== false) bad.push('rain-null');
    /* 温度格式化：整数不带小数、非整数保留一位；非法给空串。 */
    if (api.formatTempC(3) !== '3\u2103') bad.push('temp-int:' + api.formatTempC(3));
    if (api.formatTempC(3.25) !== '3.3\u2103') bad.push('temp-dec:' + api.formatTempC(3.25));
    if (api.formatTempC(-0.04) !== '0\u2103') bad.push('temp-neg0:' + api.formatTempC(-0.04));
    if (api.formatTempC(null) !== '' || api.formatTempC('x') !== '') bad.push('temp-none');
    /* 年龄说法四档。 */
    if (api.formatAge(30 * 1000) !== '刚刚') bad.push('age0:' + api.formatAge(30 * 1000));
    if (api.formatAge(5 * MIN) !== '5 分钟前') bad.push('age-min:' + api.formatAge(5 * MIN));
    if (api.formatAge(3 * HOUR) !== '3 小时前') bad.push('age-hour:' + api.formatAge(3 * HOUR));
    if (api.formatAge(2 * 24 * HOUR) !== '2 天前') bad.push('age-day:' + api.formatAge(2 * 24 * HOUR));
    if (api.formatAge(null) !== '') bad.push('age-none');
    if (WEATHER_SLOTS.join() !== 'char,user') bad.push('slots:' + WEATHER_SLOTS.join());
    return bad;
}

/* ── D2 记观测：城市与温度至少一个；码非法不拒收；温度夹到界内 ── */
function weatherRecordProblems(api) {
    const bad = [];
    const e = api.emptyWeatherState();
    if (e.char.tempC !== null || e.char.city !== '' || e.char.code !== null) bad.push('empty-slot');
    /* 两样都空 ⇒ 拒收并说明（不静默存一条空白）。 */
    const no = api.setObservation(e, 'char', {}, NOW);
    if (no.ok !== false || !no.error) bad.push('reject-empty:' + JSON.stringify(no));
    if (no.state.char.observedAt !== 0) bad.push('reject-no-write');
    /* 未知槽位拒收。 */
    if (api.setObservation(e, 'zz', { city: 'x' }, NOW).ok !== false) bad.push('reject-slot');
    /* ★ 只给城市也收（不用非得知道几度）。 */
    const c1 = api.setObservation(e, 'char', { city: '东京' }, NOW);
    if (!c1.ok || c1.state.char.city !== '东京' || c1.state.char.tempC !== null) bad.push('city-only');
    /* 温度夹到 [-80, 60]（不存下不去的数）。 */
    const c2 = api.setObservation(e, 'char', { tempC: 999 }, NOW);
    if (c2.state.char.tempC !== 60) bad.push('clamp-hi:' + c2.state.char.tempC);
    const c3 = api.setObservation(e, 'char', { tempC: -999 }, NOW);
    if (c3.state.char.tempC !== -80) bad.push('clamp-lo:' + c3.state.char.tempC);
    /* ★ 码非法（不在表里）**不拒收**，只是描述成未知（码表会随年份扩）。 */
    const c4 = api.setObservation(e, 'char', { city: '东京', code: 123 }, NOW);
    if (!c4.ok) bad.push('unknown-code-rejected');
    if (c4.state.char.code !== 123 || c4.state.char.desc !== '未知' || c4.state.char.isRain !== false) bad.push('unknown-code-shape');
    /* 补丁只动给的那格：只给 code 不把已记的城市抹了。 */
    const base = api.setObservation(e, 'user', { city: '成都', tempC: 22, code: 0 }, NOW).state;
    const patched = api.setObservation(base, 'user', { code: 61 }, NOW + MIN).state;
    if (patched.user.city !== '成都' || patched.user.tempC !== 22) bad.push('patch-keeps-rest');
    if (patched.user.code !== 61 || patched.user.desc !== '小雨' || patched.user.isRain !== true) bad.push('patch-code');
    if (patched.user.observedAt !== NOW + MIN) bad.push('patch-time');
    /* 清一个槽位只清观测。 */
    const cl = api.clearObservation(patched, 'user');
    if (cl.cleared !== 1 || cl.state.user.city !== '') bad.push('clear-one');
    if (api.clearObservation(patched, 'zz').cleared !== 0) bad.push('clear-bad-slot');
    const ca = api.clearAllObservations(patched);
    if (ca.cleared !== 1 || ca.state.user.city || ca.state.user.code !== null) bad.push('clear-all:' + ca.cleared);
    return bad;
}

/* ── D3 时效：过期只标「未必是当下的」，不删数据；注入只给事实 ── */
function weatherAgingProblems(api) {
    const bad = [];
    const set = api.defaultWeatherSettings();
    if (set.freshHours !== 24 || set.injectToPrompt !== true) bad.push('defaults');
    let s = api.setObservation(api.emptyWeatherState(), 'char', { city: '东京', tempC: 3, code: 61 }, NOW).state;
    s = api.setObservation(s, 'user', { city: '成都', tempC: 22, code: 0 }, NOW).state;
    /* 新鲜：不标过期。 */
    const fresh = api.projectWeather(s, set, NOW + HOUR);
    if (fresh.observedCount !== 2 || fresh.rainCount !== 1 || fresh.staleCount !== 0) bad.push('proj-fresh:' + JSON.stringify([fresh.observedCount, fresh.rainCount, fresh.staleCount]));
    if (!fresh.hasAny) bad.push('proj-hasAny');
    const t1 = api.weatherPromptBlock(fresh, set);
    if (!t1.includes('小雨') || !t1.includes('3\u2103')) bad.push('inject-facts:' + t1);
    if (t1.includes('未必是当下的')) bad.push('inject-not-stale');
    /* ★ 过期：**不删数据**，只把「这条是几时的」标出来（源把 24 小时前的照样当当前天气用）。 */
    const old = api.projectWeather(s, set, NOW + 30 * HOUR);
    if (old.staleCount !== 2) bad.push('proj-stale:' + old.staleCount);
    if (old.observedCount !== 2) bad.push('proj-stale-keeps-data');
    const t2 = api.weatherPromptBlock(old, set);
    if (!t2.includes('未必是当下的')) bad.push('inject-stale-mark:' + t2);
    if (!t2.includes('1 天前')) bad.push('inject-stale-age:' + t2);
    /* 没记的槽位 has=false 且 isStale=false（不报假过期）。 */
    const one = api.projectWeather(api.setObservation(api.emptyWeatherState(), 'char', { city: '东京' }, NOW).state, set, NOW + 48 * HOUR);
    const userRow = one.rows.find((r) => r.slot === 'user');
    if (!userRow || userRow.has || userRow.isStale) bad.push('empty-slot-not-stale');
    /* 设置：freshHours 夹到 [1, 168]；改它就改过期线。 */
    const s2 = api.normalizeWeatherSettings({ freshHours: 999, maxInjectLines: 0 });
    if (s2.freshHours !== 168 || s2.maxInjectLines !== 0) bad.push('clamp:' + JSON.stringify(s2));
    const tight = api.projectWeather(s, { ...set, freshHours: 1 }, NOW + 2 * HOUR);
    if (tight.staleCount !== 2) bad.push('tight-stale:' + tight.staleCount);
    /* 开关 / max 门；两处都没记 ⇒ 空串。 */
    if (api.weatherPromptBlock(fresh, { ...set, injectToPrompt: false }) !== '') bad.push('inject-off');
    if (api.weatherPromptBlock(fresh, { ...set, maxInjectLines: 0 }) !== '') bad.push('inject-max0');
    const none = api.projectWeather(api.emptyWeatherState(), set, NOW);
    if (api.weatherPromptBlock(none, set) !== '') bad.push('inject-none');
    /* 归因：先判能不能读。 */
    if (api.readWeatherFace(null) !== WEATHER_REASONS.storage_absent) bad.push('face-null');
    if (api.readWeatherFace({ storageOk: true, hasAny: false }) !== WEATHER_REASONS.empty) bad.push('face-empty');
    if (api.readWeatherFace({ storageOk: true, hasAny: true }) !== WEATHER_REASONS.ready) bad.push('face-ready');
    return bad;
}

test('D1 天气码表：翻译成人话、未知码不猜、算不算下雨含冻雨雷阵雨', () => {
    const bad = weatherCodeProblems({ describeCode, kindOfCode, isRainCode, formatTempC, formatAge });
    assert.deepEqual(bad, [], '码表口径必须与设计一致，实测问题：' + bad.join(' , '));
    assert.equal(WEATHER_LIMITS.freshMs, 24 * 3600000, '源的缓存时长就是 24 小时');
    assert.ok(read(WTH_REL).includes('WMO'), '码表来源（WMO 4677）必须在文件头写明');
});

test('D2 记观测：城市与温度至少一个；码非法不拒收；温度夹到界内', () => {
    const bad = weatherRecordProblems({ emptyWeatherState, setObservation, clearObservation, clearAllObservations });
    assert.deepEqual(bad, [], '观测口径必须与设计一致，实测问题：' + bad.join(' , '));
});

test('D3 时效：过期只标「未必是当下的」不删数据；注入只给事实', () => {
    const bad = weatherAgingProblems({
        WEATHER_REASONS, defaultWeatherSettings, normalizeWeatherSettings, emptyWeatherState,
        setObservation, readWeatherFace, projectWeather, weatherPromptBlock,
    });
    assert.deepEqual(bad, [], '时效与注入口径必须与设计一致，实测问题：' + bad.join(' , '));
    const view = read('apps/weather/weather-view.js');
    assert.ok(view.includes('[WEATHER_REASONS.'), '视图文案表必须由归因常量计算键');
    assert.ok(read(WTH_REL).includes("storage_absent: 'storage-absent'"), '连字符形必须在数据层定义');
});

/* ══════════════════════ E ── 接线（四件各四处 + 调用面 + 样式 + 前缀） ══════════════════════ */
const FOUR = [
    ['avatarframe', 'AvatarFrameApp', '.avf-', 'avatarframe'],
    ['shop', 'ShopApp', '.shp-', 'shop'],
    ['block', 'BlockApp', '.blk-', 'block'],
    ['weather', 'WeatherApp', '.wth-', 'weather'],
];

test('E1 四件各四处注册齐备：APPS / 懒加载分支 / REBIND 表 / 会话键前缀', () => {
    const idx = read('index.js');
    const apps = read('config/apps.js');
    const storage = read('config/storage.js');
    const tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    assert.ok(tbl.length > 0, 'index.js 必须有 ST_PHONE_REBIND_APP_KEYS 表');
    for (const [id, cls, , pref] of FOUR) {
        assert.ok(apps.includes("id: '" + id + "'"), 'config/apps.js 必须登记 id: ' + id);
        assert.ok(idx.includes("appId === '" + id + "'"), 'index.js 必须有懒加载分支 ' + id);
        assert.ok(idx.includes("import('./apps/" + id + "/" + id + "-app.js')"), '分支必须指向真实路径 apps/' + id);
        assert.ok(idx.includes('new module.' + cls + '('), cls + ' 必须被构造');
        /* ★ 槽位名是**驼峰**（window.VirtualPhone.avatarFrameApp / shopApp / blockApp / weatherApp），
         *   不是 `<前缀>App`（前缀全是小写）。REBIND 表与三处清理按的就是这个**槽位**，
         *   名字对不上时换会话不会重绑，而门禁不报错 —— 故这里钉死三处同源：赋值点 / 表 / 键前缀。 */
        const slot = cls.slice(0, 1).toLowerCase() + cls.slice(1);  // AvatarFrameApp -> avatarFrameApp
        assert.ok(idx.includes('window.VirtualPhone.' + slot + ' = new module.' + cls + '('),
            'index.js 必须把 ' + cls + ' 留在 window.VirtualPhone.' + pref + 'App（REBIND 与清理都按这个槽位走）');
        assert.ok(tbl.includes("'" + slot + "'"), 'REBIND 表必须含 ' + slot + ' 槽位');
        assert.ok(storage.includes('/^' + pref + '_/'), '会话隔离表必须有 /^' + pref + '_/');
    }
});

test('E2 视图调用面必须闭合在 App 上：视图调了 App 上不存在的方法＝静默断裂', () => {
    /* 本仓记过的形态（v3250 修正过两处）：视图 `this.app.xxx()` 而 App 上根本没有 xxx，
     * 界面在**用户真的点到那个按钮时**才炸，平时完全看不出来。这里做成静态契约检查。 */
    const FIELDS = new Set(['settings', 'face', 'storage', 'shell', 'limits', 'proj', 'projection',
        'view', '_view', 'app', 'state', 'products', 'orders', 'cart', 'categories', 'frames',
        'mounts', 'assignments', 'faceReason', 'presets', 'cards']);
    for (const [id, , , pref] of FOUR) {
        const appRel = 'apps/' + id + '/' + id + '-app.js';
        const viewRel = 'apps/' + id + '/' + id + '-view.js';
        const appSrc = read(appRel);
        const methods = new Set();
        for (const m of appSrc.matchAll(/^[ \t]+(?:get |set )?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm)) methods.add(m[1]);
        const viewSrc = read(viewRel);
        const called = new Set();
        for (const m of viewSrc.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
        const missing = [...called].filter((n) => !methods.has(n) && !FIELDS.has(n));
        assert.deepEqual(missing, [], viewRel + ' 调了 App 上不存在的东西：' + missing.join(' , '));
        assert.ok(methods.size >= 15, appRel + ' 的方法面异常小（' + methods.size + '）');
        assert.ok(called.size >= 8, viewRel + ' 的调用面异常小（' + called.size + '）');
    }
});

test('E3 样式源与 phone.css 逐字同源，且视图产出的每个类名都有落点', () => {
    const phone = read('phone.css');
    /* ★ [v3.27.0 交棒] 段尾按**下一个段头**截断，不取文件尾：本版往后接了四段，
     *   取到文件尾会把新段并进来 ⇒ 以「逐字同源失败」假红（同 v3250 B3 / v3260 C3）。 */
    const HDR = '/* ---------- [v3.27.0] ';
    const norm = (x) => x.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
    for (const [id, , prefix] of FOUR) {
        const cssRel = 'apps/' + id + '/' + id + '.css';
        const at = phone.indexOf(HDR);
        assert.ok(at >= 0, 'phone.css 必须带本版段注释');
        /* 逐段往后找：按 App 名列定位本段的段头。 */
        const nameMap = { avatarframe: '头像框 App', shop: '商城 App', block: '拉黑 App', weather: '天气 App' };
        const hdr = HDR + nameMap[id] + '（' + prefix + '*） ---------- */';
        const start = phone.indexOf(hdr);
        assert.ok(start >= 0, 'phone.css 必须带本段段头：' + hdr);
        const rest = phone.slice(start);
        const nxt = rest.indexOf('/* ---------- [', 1);
        const seg = nxt >= 0 ? rest.slice(0, nxt) : rest;
        assert.equal(norm(seg), norm(read(cssRel)), 'phone.css 的本版段必须与 ' + cssRel + ' 逐字同源');
        const n = seg.split(prefix).length - 1;
        assert.ok(n >= 5, hdr + ' 段必须真的带样式（实测 ' + n + '）');
    }
    /* 每个产出的类名都要有**样式落点**：自己有条规则 / 是 JS 选择器锚点。 */
    for (const [id, , prefix] of FOUR) {
        const viewRel = 'apps/' + id + '/' + id + '-view.js';
        const view = read(viewRel);
        const js = view + read('apps/' + id + '/' + id + '-app.js');
        const css = read('apps/' + id + '/' + id + '.css');
        /* ★ 类名 token 是**不带点**的（`avf-root` / `shp-list`），而 FOUR 里的 prefix 是为了
         *   拼 phone.css 段头才带点的（`.avf-`）。这里必须换成裸前缀，否则 startsWith 恒不成立
         *   ⇒ produced 恒为空 ⇒ 以「类名异常少」假红（本轮踩到的坑，第一段已用裸前缀）。 */
        const bare = prefix.slice(1);
        const cssNames = new Set(css.match(new RegExp('[.]' + bare + '[a-z0-9-]+', 'g')) || []);
        const anchors = new Set();
        /* ★ 本仓的取值助手是 `const q = (sel) => this._root.querySelector(sel);`，视图一律写
         *   `q('.blk-block')` —— 旧口径只认「querySelector( 紧跟选择器」，会把全部 q(...) 锚点漏掉，
         *   以「这些类名既无样式规则也不是锚点」假红（本轮踩到的坑）。两种形态一起收。 */
        for (const m of js.matchAll(/(?:querySelector(?:All)?|\bq)\s*\(\s*['"]([^'"]*)['"]/g)) {
            for (const tok of m[1].match(/\.[A-Za-z0-9_-]+/g) || []) anchors.add(tok.slice(1));
        }
        for (const m of js.matchAll(/classList[.](?:add|remove|toggle|contains)[(]\s*['"]([a-z0-9-]+)/g)) anchors.add(m[1]);
        const produced = new Set();
        for (const m of view.matchAll(/class=["']([^"']+)/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare) && !tok.endsWith('-')) produced.add(tok);
        }
        for (const m of view.matchAll(/className\s*=\s*'([^']+)'/g)) {
            for (const tok of m[1].split(/\s+/)) if (tok.startsWith(bare)) produced.add(tok);
        }
        /* ★ 容器类名的豁免（同 v3250 B3 的 inheritHooks 口径）：视图会渲染纯布局容器
         *   （`.shp-list` 这种），样式全落在子元素上，自身既无规则也不必被 JS 查。
         *   豁免必须**非空洞**：容器要真被视图产出，且它的兄弟规则必须在场。 */
        /* 按 App 收窄：豁免表只在它所属的那一轮生效（全局表会让别的 App 轮次空口豁免）。 */
        const containerHooks = id === 'shop' ? new Map([['shp-list', '.shp-list-title']]) : new Map();
        const missing = [...produced].filter((x) =>
            !cssNames.has('.' + x) && !anchors.has(x) && !containerHooks.has(x));
        assert.deepEqual(missing, [], viewRel + ' 这些类名既无样式规则也不是锚点：' + missing.join(' , '));
        for (const [hook, sibling] of containerHooks) {
            assert.ok(produced.has(hook), hook + ' 被豁免为容器，但它根本没被视图产出（空口豁免）');
            assert.ok(cssNames.has(sibling), hook + ' 声明样式落在 ' + sibling + ' 上，该规则必须存在');
        }
        assert.ok(produced.size >= 20, viewRel + ' 产出的类名异常少（' + produced.size + '）');
        /* 锚点自证：每个被当选择器用的类名，必须真能在**源码**里找到 selector 痕迹，
         *   不是靠正则把空集吞掉。 */
        assert.ok(anchors.size >= 3, viewRel + ' 的选择器锚点异常少（' + anchors.size + '）');
    }
});

test('E4 前缀不与他人撞：.avf- / .shp- / .blk- / .wth- 全仓唯一（仅本 App 目录与 phone.css）', () => {
    const walk = (dir, out) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === '.git' || e.name === 'node_modules') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full, out);
            else if (/\.(js|css)$/.test(e.name)) out.push(full);
        }
        return out;
    };
    const files = walk(ROOT, []);
    assert.ok(files.length > 200, '扫描面异常小（' + files.length + '）');
    for (const [id, , prefix] of FOUR) {
        const owner = '/apps/' + id + '/';
        const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes(prefix));
        assert.ok(users.length > 0, prefix + ' 必须在仓里被用到');
        for (const f of users) {
            assert.ok(f.includes(owner) || f.endsWith('phone.css'),
                prefix + ' 只应出现在 ' + owner + ' 与 phone.css，实测还有：' + f.replace(ROOT, ''));
        }
    }
});

test('E5 App 文件四件套齐备，且 data 层保持纯函数（不碰 window / DOM / 网络）', () => {
    for (const [id, , prefix] of FOUR) {
        for (const f of ['-data.js', '-app.js', '-view.js', '.css']) {
            assert.ok(fs.existsSync(path.join(ROOT, 'apps', id, id + f)), 'apps/' + id + '/' + id + f + ' 必须存在');
        }
        const data = read('apps/' + id + '/' + id + '-data.js');
        const code = stripComments(data);
        for (const banned of ['document', 'window', 'localStorage', 'sessionStorage',
            'fetch(', 'XMLHttpRequest', 'indexedDB', 'Dexie', 'openDB',
            'getChatMessages', 'setChatMessages', 'chatMetadata', 'geolocation']) {
            assert.equal(code.includes(banned), false, id + ' 的 data 层**代码**里不得出现：' + banned);
        }
        assert.ok(data.includes("from '../../config/num-gate.js'"), id + ' 的 data 层应走共享取数门');
        assert.ok(read('apps/' + id + '/' + id + '.css').includes(prefix), 'apps/' + id + '/' + id + '.css 必须用 ' + prefix + ' 前缀');
    }
});

/* ══════════════════════ F ── 键归属 ══════════════════════ */
test('F1 十二条新键必须在 keys 门账本里登记且 scope=chat（会话隔离族）', () => {
    const audit = read('scripts/keys-audit.mjs');
    const keys = [];
    for (const [id, , , pref] of FOUR) {
        const src = read('apps/' + id + '/' + id + '-app.js');
        const hits = [...src.matchAll(new RegExp("'(" + pref + "_[a-z_]+)'", 'g'))].map((m) => m[1]);
        const uniq = [...new Set(hits)];
        assert.ok(uniq.length >= 2, 'apps/' + id + '/' + id + '-app.js 的键面异常小：' + uniq.join(','));
        keys.push(...uniq);
    }
    assert.equal(new Set(keys).size, 12, '四件共十二条键，实测 ' + keys.join(','));
    for (const key of keys) {
        assert.equal(audit.split("key: '" + key + "'").length - 1, 1, '键 ' + key + ' 必须在 KEY_REGISTRY 恰好登记一次');
        assert.ok(new RegExp("\{ key: '" + key + "', scope: 'chat'").test(audit), '键 ' + key + ' 必须是会话隔离（scope: chat）');
    }
});

/* ══════════════════════ G ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════════════════ */
/** 破坏表集中在一处：H2 会拿它做「锚点在场性 + 替换保真」的批量自证。 */
const DAMAGE = {
    /* 外链一律当可落地 ⇒ 「默认不收外链」必须转红。 */
    d1: [AVF_REL,
        "    if (kind === 'external-url') return !!(settings && settings.allowExternal === true);",
        "    if (kind === 'external-url') return true;"],
    /* 去重改用 id 当身份 ⇒ 「同一 URL 两条只留一条」必须转红。 */
    d2: [AVF_REL,
        "        const key = src || '__none__';",
        "        const key = f.id || src;"],
    /* unPriced 不再粘住 ⇒ 「存储往返后未定价标记不能消失」必须转红。 */
    d3: [SHP_REL,
        "    const unPriced = o.unPriced === true || !priced;",
        "    const unPriced = !priced;"],
    /* 口令比对不忽略大小写空格 ⇒ 「大小写空格都能核销」必须转红。 */
    d4: [SHP_REL,
        "    const want = String(code || '').replace(/\\s+/g, '').toUpperCase();",
        "    const want = String(code || '');"],
    /* 重复拉黑也开第二段历史 ⇒ 「不开第二段」必须转红。
     *   ★ 要真破坏这一格必须**一次改两处**（本仓既有记录：只去短路不算破坏，后面还有一个门）：
     *      ① 去掉「已拉黑就原样返回」的短路；② 让「上一段还没结束」也照 push。
     *   只做 ① 时 changed 由 0 变 1，但第二段仍被 `if (!open || open.unblockedAt)` 拦下，
     *   `history.length` 依旧是 1 ⇒ 判据只报 repeat-changed（本轮踩到的坑）。 */
    d5: [BLK_REL,
        "    if (s.direct.blocked) return { state: s, changed: 0 };\n"
        + "    s.direct.blocked = true;\n"
        + "    s.direct.blockedAt = t;\n"
        + "    const open = s.direct.history.length ? s.direct.history[s.direct.history.length - 1] : null;\n"
        + "    if (!open || open.unblockedAt) {",
        "    s.direct.blocked = true;\n"
        + "    s.direct.blockedAt = t;\n"
        + "    if (true) {"],
    /* 接受申请不自动解除拉黑 ⇒ 「接受即自动解除」必须转红。 */
    d6: [BLK_REL,
        "    if (!changed) return { state: s, changed: 0 };\n    if (accept) {\n        s.direc",
        "    if (!changed) return { state: s, changed: 0 };\n    if (false) {\n        s.direc"],
    /* auto 模式也拦 ⇒ 「auto 不拦」必须转红。 */
    d7: [BLK_REL,
        "    if (s.direct.reapply.mode === 'auto') return 0;",
        "    if (false) return 0;"],
    /* 未知码猜成晴 ⇒ 「未知码不猜」必须转红。 */
    d8: [WTH_REL,
        "    return hit ? hit.desc : '未知';",
        "    return hit ? hit.desc : '晴';"],
    /* 过期就不标 stale ⇒ 「过期不删数据、只标未必是当下的」必须转红。 */
    d9: [WTH_REL,
        "        isStale: has ? !fresh : false,",
        "        isStale: false,"],
    /* 城市与温度都空也收 ⇒ 「至少要知道一个」必须转红。 */
    d10: [WTH_REL,
        "    if (!city && tempC === null) return { state: s, ok: false, error: '至少要知道在哪儿、或者几度' };",
        "    if (false) return { state: s, ok: false, error: 'never' };"],
};

/** num-gate 的**等价桩**（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v === 'number') return Number.isFinite(v) ? v : null;\n"
    + "    if (typeof v !== 'string') return null;\n"
    + "    if (!v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';

/**
 * 造一份破坏副本并加载。
 * ★ 副本按**真目录结构**建：data 层写的是 `../../config/num-gate.js`，
 *   若把副本摊在 <tmp> 根下，那条相对路径会解析成 `/config/num-gate.js`（差两级，
 *   首跑即 ERR_MODULE_NOT_FOUND —— 与破坏本身无关的假红）。
 */
function loadDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v327_'));
    const target = path.join(dir, 'apps', path.basename(path.dirname(rel)), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    const gateDir = path.join(dir, 'config');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'num-gate.js'), NUM_GATE_STUB);
    /* [v3.84.0 · R-O8] 副本里也要有 num-clamp 的**真件字节副本**：
     *   被加载的模块现在从它取有界取数（口径唯一），缺了会 ERR_MODULE_NOT_FOUND ——
     *   那与破坏本身无关（假红）。刻意用 copyFileSync 而不是手写桩：副本就是真件的副本。 */
    fs.copyFileSync(new URL('../config/num-clamp.js', import.meta.url), path.join(gateDir, 'num-clamp.js'));
    return import(pathToFileURL(target).href);
}

test('G1 破坏「外链一律可落地」⇒ A1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d1;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = avatarClassifyProblems({ classifySource: mod.classifySource, isStorable: mod.isStorable, defaultAvatarFrameSettings: mod.defaultAvatarFrameSettings, normalizeAvatarFrameSettings: mod.normalizeAvatarFrameSettings });
    assert.ok(bad.some((x) => x.startsWith('classify') || x.startsWith('ext-default-off')), '外链当可落地后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(avatarClassifyProblems({ classifySource, isStorable, defaultAvatarFrameSettings, normalizeAvatarFrameSettings }), [], '对照：真实现必须把外链认出来');
});

test('G2 破坏「按 URL 去重」为「按 id 去重」⇒ A3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d2;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = avatarIdentityProblems({ dedupeFrames: mod.dedupeFrames, normalizeFrame: mod.normalizeFrame, normalizeFrames: mod.normalizeFrames, resolveFrame: mod.resolveFrame });
    assert.ok(bad.some((x) => x.startsWith('dedupe-by-url')), '改按 id 去重后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(avatarIdentityProblems({ dedupeFrames, normalizeFrame, normalizeFrames, resolveFrame }), [], '对照：真实现必须按 URL 去重');
});

test('G3 破坏「未定价标记粘住」⇒ B5 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d3;
    const mod = await loadDamagedCopy(rel, from, to);
    const products = mod.normalizeProducts([{ id: 'p1', name: 'a', priceCents: 0, unPriced: true }]);
    assert.equal(products[0].unPriced, false, '对照：破坏后标记必须丢（否则这条负控制测的是空气）');
    const b = shopProjectProblems({
        SHOP_REASONS, DEFAULT_SHOP_SETTINGS, normalizeProducts: mod.normalizeProducts, addToCart: mod.addToCart,
        checkout: mod.checkout, cartTotal: mod.cartTotal, normalizeShopSettings: mod.normalizeShopSettings,
        defaultShopSettings: mod.defaultShopSettings, readShopFace: mod.readShopFace, projectShop: mod.projectShop,
        shopPromptBlock: mod.shopPromptBlock,
    });
    assert.ok(b.some((x) => x.startsWith('unpriced')) || b.some((x) => x.startsWith('pcount')), '标记丢失后必须报出，实测：' + b.join(' , '));
});

test('G4 破坏「口令忽略大小写空格」⇒ B4 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d4;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = shopOrderProblems({ normalizeProducts: mod.normalizeProducts, addToCart: mod.addToCart, checkout: mod.checkout, makePickupCode: mod.makePickupCode, pickup: mod.pickup, cancelOrder: mod.cancelOrder, removeOrder: mod.removeOrder });
    assert.ok(bad.some((x) => x.startsWith('pickup-case-space')), '不忽略大小写空格后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(shopOrderProblems({ normalizeProducts, addToCart, checkout, makePickupCode, pickup, cancelOrder, removeOrder }), [], '对照：真实现必须忽略大小写与空格');
});

test('G5 破坏「重复拉黑不开第二段历史」⇒ C1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d5;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = blockLedgerProblems({ emptyBlockState: mod.emptyBlockState, setBlocked: mod.setBlocked, clearBlocked: mod.clearBlocked, setCharBlocked: mod.setCharBlocked, clearCharBlocked: mod.clearCharBlocked, clearAllHistory: mod.clearAllHistory, resetBlockState: mod.resetBlockState });
    assert.ok(bad.some((x) => x.startsWith('repeat-second-segment')), '重复拉黑开第二段后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(blockLedgerProblems({ emptyBlockState, setBlocked, clearBlocked, setCharBlocked, clearCharBlocked, clearAllHistory, resetBlockState }), [], '对照：真实现不开第二段');
});

test('G6 破坏「接受即自动解除拉黑」⇒ C2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d6;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = blockRequestProblems({ emptyBlockState: mod.emptyBlockState, setBlocked: mod.setBlocked, charApplyRequest: mod.charApplyRequest, resolveRequest: mod.resolveRequest, myApply: mod.myApply, resolveMyRequest: mod.resolveMyRequest, setCharBlocked: mod.setCharBlocked, lastRejectReason: mod.lastRejectReason });
    assert.ok(bad.some((x) => x.startsWith('accept-auto-unblock')), '接受不解除后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(blockRequestProblems({ emptyBlockState, setBlocked, charApplyRequest, resolveRequest, myApply, resolveMyRequest, setCharBlocked, lastRejectReason }), [], '对照：真实现接受即解除');
});

test('G7 破坏「auto 不拦」⇒ C3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d7;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = blockCooldownProblems({ emptyBlockState: mod.emptyBlockState, setBlocked: mod.setBlocked, charApplyRequest: mod.charApplyRequest, setReapply: mod.setReapply, cooldownRemaining: mod.cooldownRemaining, formatCooldown: mod.formatCooldown });
    assert.ok(bad.some((x) => x.startsWith('cd-auto')), 'auto 也拦后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(blockCooldownProblems({ emptyBlockState, setBlocked, charApplyRequest, setReapply, cooldownRemaining, formatCooldown }), [], '对照：真实现 auto 不拦');
});

test('G8 破坏「未知码不猜」⇒ D1 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d8;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = weatherCodeProblems({ describeCode: mod.describeCode, kindOfCode: mod.kindOfCode, isRainCode: mod.isRainCode, formatTempC: mod.formatTempC, formatAge: mod.formatAge });
    assert.ok(bad.some((x) => x.startsWith('unknown-desc')), '未知码猜成晴后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(weatherCodeProblems({ describeCode, kindOfCode, isRainCode, formatTempC, formatAge }), [], '对照：真实现未知就是未知');
});

test('G9 破坏「过期不删数据」⇒ D3 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d9;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = weatherAgingProblems({
        WEATHER_REASONS: mod.WEATHER_REASONS, defaultWeatherSettings: mod.defaultWeatherSettings,
        normalizeWeatherSettings: mod.normalizeWeatherSettings, emptyWeatherState: mod.emptyWeatherState,
        setObservation: mod.setObservation, readWeatherFace: mod.readWeatherFace,
        projectWeather: mod.projectWeather, weatherPromptBlock: mod.weatherPromptBlock,
    });
    assert.ok(bad.some((x) => x.startsWith('proj-stale')), '不标过期后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(weatherAgingProblems({ WEATHER_REASONS, defaultWeatherSettings, normalizeWeatherSettings, emptyWeatherState, setObservation, readWeatherFace, projectWeather, weatherPromptBlock }), [], '对照：真实现必须标过期');
});

test('G10 破坏「城市与温度至少一个」⇒ D2 同款判据必须转红', async () => {
    const [rel, from, to] = DAMAGE.d10;
    const mod = await loadDamagedCopy(rel, from, to);
    const bad = weatherRecordProblems({ emptyWeatherState: mod.emptyWeatherState, setObservation: mod.setObservation, clearObservation: mod.clearObservation, clearAllObservations: mod.clearAllObservations });
    assert.ok(bad.some((x) => x.startsWith('reject-empty')), '空白记录也收后必须报出，实测：' + bad.join(' , '));
    assert.deepEqual(weatherRecordProblems({ emptyWeatherState, setObservation, clearObservation, clearAllObservations }), [], '对照：真实现必须拒收空白记录');
});

/* ══════════════════════ H ── 判据工具自证 ══════════════════════ */
test('H1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    /* ★ 为什么必须有：E5 / C5 的「不出现」方向**完全依赖** stripComments。若剥器被改成
     *   「什么都剥」，那些断言只会**更绿** —— 判据工具的破坏方向与判据同向，属本仓记过的
     *   「假绿」族（对原文件断言 / 破坏写死成常量 / 判据自我指涉之外：工具被削成空闸）。
     *   故必须两向自证。 */
    const raw = '// 注释里写 postimg\n'
        + 'const a = "postimg";\n'
        + '/* 块注释 indexedDB */\n'
        + 'const b = 1;\n'
        + "const c = 'x//not-a-comment';";
    const stripped = stripComments(raw);
    assert.ok(stripped.includes('"postimg"'), '字符串字面量必须留住（剥器不得把字符串里的同形文本一起吃掉）');
    assert.ok(stripped.includes("'x//not-a-comment'"), '字符串里的 // 不是注释起头（剥器不得在字符串内切换状态）');
    assert.equal(stripped.includes('注释里写'), false, '行注释必须真被剥掉');
    assert.equal(stripped.includes('块注释'), false, '块注释必须真被剥掉');
    assert.ok(stripped.includes('const b = 1;'), '普通代码必须原样留下');
    /* 模板串与转义引号也是状态机必须正确处理的两种输入。 */
    assert.equal(stripComments('const t = `a${"//"}b`; // 真注释').includes('真注释'), false, '模板串后的注释必须剥掉');
    assert.ok(stripComments("const s = 'a\\'//b';").includes("a\\'//b"), '转义引号不得让状态机提前收尾');
    /* 四件 data 层剥注释后必须真的变短（否则 E5 的「不出现」是空闸）。 */
    for (const rel of [AVF_REL, SHP_REL, BLK_REL, WTH_REL]) {
        assert.ok(read(rel).length > stripComments(read(rel)).length, rel + ' 剥注释后必须真的变短');
    }
});

test('H2 破坏表自证：锚点必须在场（恰 1 次）、不落在注释里、替换必须保真', () => {
    /* ★ 负控制自身最隐蔽的失效形态是**锚点漂移**——产品改动让锚点失配，
     *   split 不中 ⇒ 破坏没发生 ⇒ 断言仍绿。故「在场性」必须与「保真」一起被自证。 */
    assert.ok(Object.keys(DAMAGE).length >= 10, '破坏表异常小（' + Object.keys(DAMAGE).length + '）');
    for (const [name, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, name + ' 锚点在真源码里必须恰 1 次：' + JSON.stringify(from.slice(0, 60)));
        const out = src.split(from).join(to);
        assert.notEqual(out, src, name + ' 替换必须真的发生');
        assert.equal(out.split(from).length - 1, 0, name + ' 替换后旧串必须归零');
        assert.ok(out.includes(to), name + ' 替换后新串必须在场');
        assert.notEqual(from, to, name + ' 的 from/to 不得相同（那样不是破坏）');
        /* 锚点必须落在**代码**里 —— 落在注释里的锚点破坏不了任何行为。
         *   若用剥注释器判这件事，带正则字面量的锚点会假红（naive 状态机把 `\/\/` 里的 `//`
         *   当行注释开头，见 H1 的局限说明）—— 故这里用「块注释配对 + 行首不是注释」两步判。 */
        const at = src.indexOf(from);
        const before = src.slice(0, at);
        const opens = (before.match(/\/\*/g) || []).length;
        const closes = (before.match(/\*\//g) || []).length;
        assert.equal(opens, closes, name + ' 的锚点不得落在块注释里');
        const lineStart = src.lastIndexOf('\n', at) + 1;
        const lineEnd = src.indexOf('\n', at);
        const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
        assert.ok(!line.startsWith('//') && !line.startsWith('*'), name + ' 的锚点不得落在注释行里：' + line.slice(0, 60));
    }
    /* 为什么一律用**字面 split/join** 而不用 String.replace：替换串里一旦出现 `$`，
     *   `replace` 会把它当替换模式解释（`$&` = 命中的整串）⇒ 破坏静默变形、负控制失去判别力。 */
    assert.equal('AAA'.replace('AAA', 'x$&y'), 'xAAAy', 'replace 会把 $& 解释成整串命中');
    assert.equal('AAA'.split('AAA').join('x$&y'), 'x$&y', 'split/join 是字面替换');
    /* 副本的结构自证：`../../config/num-gate.js` 必须真能解析到桩（否则会出 ERR_MODULE_NOT_FOUND 假红）。 */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v327_selfcheck_'));
    fs.mkdirSync(path.join(tmp, 'apps', 'x'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'num-gate.js'), NUM_GATE_STUB);
    fs.writeFileSync(path.join(tmp, 'apps', 'x', 'm.mjs'),
        "import { numOrNull } from '../../config/num-gate.js';\nexport const v = [numOrNull(0), numOrNull(''), numOrNull('3')];\n");
    return import(pathToFileURL(path.join(tmp, 'apps', 'x', 'm.mjs')).href).then((m) => {
        assert.deepEqual(m.v, [0, null, 3], 'num-gate 桩必须与真件同口径（0 是合法读数、空串是没给）');
    });
});

/* ══════════════════════ V ── 版本锚 ══════════════════════ */
test('V1 版本锚（下限形）+ 四源同源 + update-log 条目', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 27),
        '本套件成立于 RubyPhone 3.27.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* 本版条目必须在场且非空（审计门会查这一条，这里先钉住）。
     * ★ [v3.30.0 交棒] 这里守的是**本套件自己那一版**，不是「当版」：
     *   此前写 `log.versions[man.version]`，读的是抬版后的 latest —— 于是 v3.30.0 抬版当场把
     *   本条判红（「本版条目必须写到 头像框」），而 3.27.0 的条目其实好好的。
     *   口径：判据钉自己那一版的历史事实，抬版不该动它。
     *   （同款口径错 v3.28.0 / v3.29.0 已同法改为读自己那一版。） */
    const SELF = '3.27.0';
    assert.ok(VNUM32(man.version) >= VNUM32(SELF), '本套件成立于 ' + SELF + ' 及以后');
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 3, '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['头像框', '商城', '拉黑', '天气']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
});
