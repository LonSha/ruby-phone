/* ============================================================
 * config/style-skin-v3.js — v3.3 / v3.4 / v3.5 / v3.6 App 皮肤的账与执行器（ESM 纯模块，doc 注入）
 * v3.6：版本 3.6.0（皮肤里小字强调色改用文字安全色、5 个 App 热区补到 44pt；登记表、识别前缀、加载逻辑都不变）。
 * v3.5：70 个 App 的皮肤改成手写（文件路径不变）；版本 3.5.0；修 caphealth / taskentry 的识别前缀（v3.3 登记为空数组，DOM 认不出）；自检加 2 项。
 * v3.4：公共层加 app-skins-inline-v3.4.css；版本 3.4.0；自检加 2 项（公共层含内联令牌样式、对弈 / 2048 DOM 认得出是游戏）。
 * ------------------------------------------------------------
 * 与 config/style-lazy.js 同一套纪律（同一个回执函数 styleReceipt，三态不塌）：
 *   · 皮肤只在 iOS 拟真外观打开（#phone-panel[data-rp-ios="3"]，theme-controller.enableIosV3(true)）时加载；
 *     关掉时 detachAll() 摘掉全部皮肤 <link>，外观回到 v3 / v2；
 *   · 公共层（图标遮罩 token + 公共皮肤）在第一次打开 v3 时加载一次；
 *   · 每个 App 的皮肤在该 App 第一次出现（打开或被识别出 DOM）时加载一次；
 *   · 失败 / 超时不抛、不挂住 App：回执 face = degraded / unknown，App 照开（只是没有 v3 外观）。
 * 本文件不碰 document 顶层：doc 由调用方注入（node 里可测）。
 * ============================================================ */
import { styleReceipt, STYLE_LAZY_TIMEOUT_MS } from './style-lazy.js';

export const SKIN_V3_VERSION = '3.6.0';
/** 公共层：只在 v3 打开时加载（顺序即层内顺序；层序本身由 rp-entry.css 第一行决定）。 */
export const SKIN_V3_COMMON = Object.freeze([
    './phone/design/phone-icon-tokens-v3.3.css',
    './phone/design/app-skins-common-v3.3.css',
    './phone/design/app-skins-inline-v3.4.css'      // v3.4：逐站点内联映射令牌（rp.skins.inline）
]);
/** appId -> 皮肤文件；detect = DOM 类名前缀（用于「没经过 openApp 也能认出是哪个 App」）。 */
export const SKIN_V3 = Object.freeze([
    {appId: "accessdesk", css: "./apps/accessdesk/accessdesk.v3.css", detect: ["axd"], family: "desk"},
    {appId: "accounting", css: "./apps/accounting/accounting.v3.css", detect: ["ac"], family: "finance"},
    {appId: "achievement", css: "./apps/achievement/achievement.v3.css", detect: ["ach"], family: "companion"},
    {appId: "affairs", css: "./apps/affairs/affairs.v3.css", detect: ["af"], family: "desk"},
    {appId: "album", css: "./apps/album/album.v3.css", detect: ["album", "av"], family: "media"},
    {appId: "annidate", css: "./apps/annidate/annidate.v3.css", detect: ["ad"], family: "companion"},
    {appId: "archive", css: "./apps/archive/archive.v3.css", detect: ["arc"], family: "desk"},
    {appId: "asset", css: "./apps/asset/asset.v3.css", detect: ["as"], family: "finance"},
    {appId: "avatarframe", css: "./apps/avatarframe/avatarframe.v3.css", detect: ["avf"], family: "media"},
    {appId: "backupdesk", css: "./apps/backupdesk/backupdesk.v3.css", detect: ["bk"], family: "desk"},
    {appId: "bilibili", css: "./apps/bilibili/bilibili.v3.css", detect: ["bl"], family: "social"},
    {appId: "block", css: "./apps/block/block.v3.css", detect: ["blk"], family: "system"},
    {appId: "calendar", css: "./apps/calendar/calendar.v3.css", detect: ["yzp-calendar"], family: "system"},
    {appId: "caphealth", css: "./apps/caphealth/caphealth.v3.css", detect: ["cph"], family: "desk"},
    {appId: "cardtable", css: "./apps/cardtable/cardtable.v3.css", detect: ["ct"], family: "games"},
    {appId: "chars", css: "./apps/chars/chars.v3.css", detect: ["cs"], family: "companion"},
    {appId: "cheat", css: "./apps/cheat/cheat.v3.css", detect: ["ch"], family: "companion"},
    {appId: "clock", css: "./apps/clock/clock.v3.css", detect: ["cl"], family: "system"},
    {appId: "comms", css: "./apps/comms/comms.v3.css", detect: ["cm"], family: "comm"},
    {appId: "cotdesk", css: "./apps/cotdesk/cotdesk.v3.css", detect: ["cd"], family: "desk"},
    {appId: "creationdesk", css: "./apps/creationdesk/creationdesk.v3.css", detect: ["cwb"], family: "desk"},
    {appId: "date", css: "./apps/date/date.v3.css", detect: ["dat"], family: "companion"},
    {appId: "diagdesk", css: "./apps/diagdesk/diagdesk.v3.css", detect: ["dd"], family: "desk"},
    {appId: "diagnose", css: "./apps/diagnose/diagnose.v3.css", detect: ["dg"], family: "desk"},
    {appId: "diary", css: "./apps/diary/diary.v3.css", detect: ["diary"], family: "companion"},
    {appId: "dirtytalk", css: "./apps/dirtytalk/dirtytalk.v3.css", detect: ["dt"], family: "comm"},
    {appId: "doujin", css: "./apps/doujin/doujin.v3.css", detect: ["djn"], family: "finance"},
    {appId: "focus", css: "./apps/focus/focus.v3.css", detect: ["fc"], family: "system"},
    {appId: "freehome", css: "./apps/freehome/freehome.v3.css", detect: ["fh"], family: "system"},
    {appId: "gacha", css: "./apps/gacha/gacha.v3.css", detect: ["ga"], family: "companion"},
    {appId: "games", css: "./apps/games/games.v3.css", detect: ["games", "ld"], family: "games"},
    {appId: "graph", css: "./apps/memory/graph.v3.css", detect: ["gph"], family: "companion"},
    {appId: "health", css: "./apps/health/health.v3.css", detect: ["hl"], family: "system"},
    {appId: "honey", css: "./apps/honey/honey.v3.css", detect: ["honey"], family: "comm"},
    {appId: "kettle", css: "./apps/kettle/kettle.v3.css", detect: ["ktl"], family: "companion"},
    {appId: "ledger", css: "./apps/ledger/ledger.v3.css", detect: ["lg"], family: "finance"},
    {appId: "lexiscore", css: "./apps/lexiscore/lexiscore.v3.css", detect: ["ls"], family: "companion"},
    {appId: "line", css: "./apps/line/line.v3.css", detect: ["ln"], family: "social"},
    {appId: "lofter", css: "./apps/lofter/lofter.v3.css", detect: ["lof"], family: "social"},
    {appId: "loverspace", css: "./apps/loverspace/loverspace.v3.css", detect: ["lov"], family: "companion"},
    {appId: "magazine", css: "./apps/magazine/magazine.v3.css", detect: ["mgz"], family: "social"},
    {appId: "memory", css: "./apps/memory/memory.v3.css", detect: ["mem"], family: "companion"},
    {appId: "memtable", css: "./apps/memtable/memtable.v3.css", detect: ["mt"], family: "desk"},
    {appId: "mofo", css: "./apps/mofo/mofo.v3.css", detect: ["mofo"], family: "companion"},
    {appId: "mood", css: "./apps/mood/mood.v3.css", detect: ["mood"], family: "companion"},
    {appId: "music", css: "./apps/music/music.v3.css", detect: ["music"], family: "media"},
    {appId: "musicdesk", css: "./apps/musicdesk/musicdesk.v3.css", detect: ["msd"], family: "desk"},
    {appId: "needsim", css: "./apps/needsim/needsim.v3.css", detect: ["nsm"], family: "companion"},
    {appId: "notifications", css: "./apps/notifications/notifications.v3.css", detect: ["nc"], family: "system"},
    {appId: "peek", css: "./apps/peek/peek.v3.css", detect: ["pk"], family: "companion"},
    {appId: "periodmath", css: "./apps/periodmath/periodmath.v3.css", detect: ["pm"], family: "companion"},
    {appId: "phone", css: "./apps/phone/phone.v3.css", detect: ["phone-call", "phone-dot", "phone-prompt", "phone-sms"], family: "comm"},
    {appId: "piggy", css: "./apps/piggy/piggy.v3.css", detect: ["pg"], family: "finance"},
    {appId: "pixiv", css: "./apps/pixiv/pixiv.v3.css", detect: ["pxv"], family: "social"},
    {appId: "place", css: "./apps/place/place.v3.css", detect: ["pl"], family: "system"},
    {appId: "playbook", css: "./apps/playbook/playbook.v3.css", detect: ["pb", "playbook"], family: "companion"},
    {appId: "plotline", css: "./apps/plotline/plotline.v3.css", detect: ["pn"], family: "companion"},
    {appId: "profile", css: "./apps/profile/profile.v3.css", detect: ["pf"], family: "system"},
    {appId: "punchcard", css: "./apps/punchcard/punchcard.v3.css", detect: ["pch"], family: "companion"},
    {appId: "pvdesk", css: "./apps/pvdesk/pvdesk.v3.css", detect: ["pvd"], family: "desk"},
    {appId: "reading", css: "./apps/reading/reading.v3.css", detect: ["rd"], family: "media"},
    {appId: "recall", css: "./apps/recall/recall.v3.css", detect: ["rcl"], family: "companion"},
    {appId: "regexfilter", css: "./apps/regexfilter/regexfilter.v3.css", detect: ["rgx"], family: "system"},
    {appId: "search", css: "./apps/search/search.v3.css", detect: ["gs"], family: "system"},
    {appId: "settings", css: "./apps/settings/settings.v3.css", detect: ["app-name-custom", "cropper", "dock-config", "image-cropper", "phone-api", "phone-clock-alignment", "phone-floating-entry", "phone-gesture", "phone-image", "phone-lobby", "phone-memory", "phone-password", "phone-secret", "phone-settings", "phone-shell-scale", "phone-theme", "phone-version", "phone-worldbook", "r22-settings", "r25-ia", "recycle-bin", "setting", "settings", "tts-section", "upload-app-icon", "yzp-device-face", "yzp-frame-color", "yzp-settings"], family: "system"},
    {appId: "shop", css: "./apps/shop/shop.v3.css", detect: ["shp"], family: "finance"},
    {appId: "socialguard", css: "./apps/socialguard/socialguard.v3.css", detect: ["sg"], family: "desk"},
    {appId: "soundkit", css: "./apps/soundkit/soundkit.v3.css", detect: ["snd"], family: "media"},
    {appId: "sourcebook", css: "./apps/sourcebook/sourcebook.v3.css", detect: ["sbr"], family: "companion"},
    {appId: "stickerdesk", css: "./apps/stickerdesk/stickerdesk.v3.css", detect: ["sd"], family: "companion"},
    {appId: "sullydesk", css: "./apps/sullydesk/sullydesk.v3.css", detect: ["sd2"], family: "desk"},
    {appId: "summdesk", css: "./apps/summdesk/summdesk.v3.css", detect: ["sm"], family: "desk"},
    {appId: "taobao", css: "./apps/taobao/taobao.v3.css", detect: ["tbo"], family: "finance"},
    {appId: "tarot", css: "./apps/tarot/tarot.v3.css", detect: ["tarot"], family: "companion"},
    {appId: "taskentry", css: "./apps/taskentry/taskentry.v3.css", detect: ["te"], family: "desk"},
    {appId: "theater", css: "./apps/theater/theater.v3.css", detect: ["th"], family: "social"},
    {appId: "tieba", css: "./apps/tieba/tieba.v3.css", detect: ["tb"], family: "social"},
    {appId: "timeweaver", css: "./apps/timeweaver/timeweaver.v3.css", detect: ["tw"], family: "companion"},
    {appId: "traveldesk", css: "./apps/traveldesk/traveldesk.v3.css", detect: ["tv"], family: "system"},
    {appId: "usage", css: "./apps/usage/usage.v3.css", detect: ["uq"], family: "system"},
    {appId: "uterus", css: "./apps/uterus/uterus.v3.css", detect: ["ud"], family: "companion"},
    {appId: "wallet", css: "./apps/wallet/wallet.v3.css", detect: ["wl"], family: "finance"},
    {appId: "wangxiang", css: "./apps/wangxiang/wangxiang.v3.css", detect: ["wangxiang"], family: "companion"},
    {appId: "weather", css: "./apps/weather/weather.v3.css", detect: ["wth"], family: "system"},
    {appId: "wechat", css: "./apps/wechat/wechat.v3.css", detect: ["chat", "contact", "contacts", "moment", "moments", "wechat"], family: "comm", extra: ["./apps/moments/moments.v3.css"]},
    {appId: "weibo", css: "./apps/weibo/weibo.v3.css", detect: ["weibo", "wnc"], family: "social"},
    {appId: "widget", css: "./apps/widget/widget.v3.css", detect: ["wgt"], family: "media"},
    {appId: "workflow", css: "./apps/workflow/workflow.v3.css", detect: ["wfl"], family: "desk"},
    {appId: "worldpulse", css: "./apps/worldpulse/worldpulse.v3.css", detect: ["wp"], family: "social"},
    {appId: "xhs", css: "./apps/xhs/xhs.v3.css", detect: ["xhs"], family: "social"}
].map(Object.freeze));

const INDEX = new Map(SKIN_V3.map((e) => [e.appId, e]));
/**
 * 已按「照现实重写」升到 v4 的 App：**v3 皮肤对它们不再生效**。
 * 为什么还留在 SKIN_V3 里：这份表是「89 个 App 都有皮肤登记」的账本，删条目会让那条自检
 *   变成一句空话，也会让「某个 App 忘了登记」这种真缺陷失去对照。
 * 为什么不再出注入计划：v3 皮肤文件只认 `.tb-root` / `.bl-root` 这类旧根节点，v4 换了
 *   `.tb-app` / `.bl-app`，挂上去就是「加载成功但一行都不命中」——
 *   这种假成功比不加载更难查（打开皮肤看着没反应，谁也想不到是选择器没中）。
 * 以后每做完一个 App 的「照现实重写」，就往这里加一条。
 */
const SKIN_V3_RETIRED = Object.freeze(['bilibili', 'tieba']);
const RETIRED = new Set(SKIN_V3_RETIRED);
/** 前缀表按长度倒序：phone-call 先于 phone，避免短前缀抢先。 */
const DETECT = SKIN_V3.flatMap((e) => e.detect.map((p) => [p, e.appId])).sort((a, b) => b[0].length - a[0].length);
export function skinEntry(appId) {
    const id = String(appId == null ? '' : appId);
    if (RETIRED.has(id)) return null;
    return INDEX.get(id) || null;
}
/** 从一个元素的 className 认出它属于哪个 App（认不出 => null）。 */
export function skinAppForClassName(className) {
    const toks = String(className || '').split(/\s+/);
    for (const t of toks) {
        if (!t || t.startsWith('fa-')) continue;
        for (const [p, id] of DETECT) {
            if (t === p || t.startsWith(p + '-')) return RETIRED.has(id) ? null : id;
        }
    }
    return null;
}
/** 一条皮肤注入计划（与 stylePlan 同形：mode = 'skin' | 'none'） */
export function skinPlan(appId, baseUrl) {
    const e = skinEntry(appId);
    if (!e) return { mode: 'none', appId: String(appId == null ? '' : appId) };
    const base = String(baseUrl == null ? '' : baseUrl);
    return { mode: 'lazy', appId: e.appId, href: base + e.css, linkId: 'rp33-skin-' + e.appId, extra: (e.extra || []).map((x) => base + x), bytes: 0 };
}

/**
 * 执行器。opts = { doc, baseUrl, timeoutMs, isOn: () => boolean }
 * 返回 { ensureCommon, ensure(appId), detachAll, collect }
 */
export function createSkinLoader(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    const baseUrl = String(o.baseUrl == null ? '' : o.baseUrl);
    const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : STYLE_LAZY_TIMEOUT_MS;
    const isOn = typeof o.isOn === 'function' ? o.isOn : () => true;
    const inflight = new Map();
    const receipts = [];
    const note = (r) => { receipts.push(r); if (receipts.length > 64) receipts.shift(); return r; };

    function inject(linkId, href, appId) {
        const plan = { mode: 'lazy', appId, href, linkId, bytes: 0 };
        if (!doc || typeof doc.createElement !== 'function' || !doc.head) return Promise.resolve(note(styleReceipt(plan, { loaded: null, reason: 'no-doc' })));
        if (inflight.has(linkId)) return inflight.get(linkId);
        const p = new Promise((resolve) => {
            let done = false; let timer = null;
            const settle = (loaded, reason) => {
                if (done) return; done = true;
                if (timer !== null) { try { clearTimeout(timer); } catch (_e) { /* 忽略 */ } }
                if (loaded !== true) inflight.delete(linkId);
                resolve(note(styleReceipt(plan, { loaded, reason })));
            };
            try {
                const old = doc.getElementById(linkId);
                if (old && old.getAttribute('href') === href) {
                    if (old.dataset && old.dataset.rp33Loaded === 'true') { settle(true, 'already-loaded'); return; }
                    old.addEventListener('load', () => settle(true, 'existing-load'), { once: true });
                    old.addEventListener('error', () => settle(false, 'existing-error'), { once: true });
                } else {
                    if (old) old.remove();
                    const link = doc.createElement('link');
                    link.id = linkId; link.rel = 'stylesheet'; link.href = href;
                    link.setAttribute('data-rp33-skin', appId);
                    link.addEventListener('load', () => { try { link.dataset.rp33Loaded = 'true'; } catch (_e) { /* 忽略 */ } settle(true, 'load'); }, { once: true });
                    link.addEventListener('error', () => settle(false, 'error'), { once: true });
                    doc.head.appendChild(link);
                }
                timer = setTimeout(() => settle(null, 'timeout'), timeoutMs);
            } catch (e) { settle(false, 'throw:' + String((e && e.message) || e)); }
        });
        inflight.set(linkId, p);
        return p;
    }
    function ensureCommon() {
        if (!isOn()) return Promise.resolve([]);
        return Promise.all(SKIN_V3_COMMON.map((css, i) => inject('rp33-skin-common-' + i, baseUrl + css, '__common__')));
    }
    function ensure(appId) {
        const plan = skinPlan(appId, baseUrl);
        if (plan.mode !== 'lazy' || !isOn()) return Promise.resolve(styleReceipt({ mode: 'bundled', appId: plan.appId }, null));
        const jobs = [ensureCommon(), inject(plan.linkId, plan.href, plan.appId)];
        plan.extra.forEach((href, i) => jobs.push(inject(plan.linkId + '-x' + i, href, plan.appId)));
        return Promise.all(jobs).then((rs) => rs[1]);
    }
    function detachAll() {
        inflight.clear();
        if (!doc || typeof doc.querySelectorAll !== 'function') return 0;
        const links = doc.querySelectorAll('link[data-rp33-skin]');
        links.forEach((l) => l.remove());
        return links.length;
    }
    function collect() {
        const face = (f) => receipts.filter((r) => r.face === f).length;
        return { entryCount: SKIN_V3.length, loaded: face('loaded'), degraded: face('degraded'), unknown: face('unknown'), receipts: receipts.slice() };
    }
    return { ensureCommon, ensure, detachAll, collect };
}

/** 自检（与 styleLazySelfCheck 同形） */
export function skinV3SelfCheck() {
    const items = [];
    const push = (name, ok, detail) => items.push({ name, ok: !!ok, detail });
    push('89 个 App 都有皮肤登记', SKIN_V3.length === 89, String(SKIN_V3.length));
    push('appId 不重复', new Set(SKIN_V3.map((e) => e.appId)).size === SKIN_V3.length, '');
    push('前缀识别：xhs-card -> xhs', skinAppForClassName('xhs-card active') === 'xhs', '');
    push('前缀识别：phone-call-btn -> phone（长前缀优先）', skinAppForClassName('phone-call-btn') === 'phone', '');
    push('fa-* 不参与识别', skinAppForClassName('fa-solid fa-xmark') === null, '');
    const p = skinPlan('wechat', 'https://x/');
    push('微信计划带朋友圈 extra', p.mode === 'lazy' && p.extra.length === 1 && p.href === 'https://x/./apps/wechat/wechat.v3.css', JSON.stringify(p));
    push('未登记 App => none', skinPlan('nope').mode === 'none', '');
    push('v3.4 公共层含内联令牌样式', SKIN_V3_COMMON.some((x) => /app-skins-inline-v3\.4\.css$/.test(x)), SKIN_V3_COMMON.join(','));
    push('对弈 / 2048 认得出是游戏（games-app gb-app / games-2048-cell）', skinAppForClassName('games-app gb-app') === 'games' && skinAppForClassName('games-2048-cell') === 'games', '');
    push('v3.5 能力检测：cph-root -> caphealth、te-root -> taskentry（v3.3 登记为空）', skinAppForClassName('cph-root') === 'caphealth' && skinAppForClassName('te-root') === 'taskentry', '');
    push('v3.6 版本号', SKIN_V3_VERSION === '3.6.0', SKIN_V3_VERSION);
    /* v4.162.0：照现实重写过的 App 脱离 v3 皮肤体系 —— 出计划必须是 none，
     * 前缀识别也必须认不出来（否则打开皮肤时挂一份「一行都不命中」的 CSS）。 */
    push('v4 重写过的 App 不再出 v3 皮肤计划', SKIN_V3_RETIRED.every((id) => skinPlan(id).mode === 'none' && skinEntry(id) === null), SKIN_V3_RETIRED.join(','));
    push('v4 重写过的 App 前缀不再被认成 v3 皮肤目标', skinAppForClassName('tb-app') === null && skinAppForClassName('bl-app') === null && skinAppForClassName('tbo-card') !== null, 'tb-app / bl-app / tbo-card');
    return { ok: items.every((i) => i.ok), items };
}
