/* ============================================================
 * apps/app-injection.js — [v3.96.0 · R3-O6] 免实例装配（跨 App 生成侧注入）
 * ------------------------------------------------------------
 * 【为什么有这个模块】
 *   装配类 App（地点 / 钱袋 / 档案 / 剧情线 / 群像 / 时计 / 账本 / 资产 / 撩语 / 金手指）
 *   此前只有两条注入路径，而两条都有一个共同前提：这个 App 已经被打开过。
 *     · 主链路：各 App 在自己的构造期往 GENERATE_BEFORE_COMBINE_PROMPTS 挂钩子；
 *     · 微信链路：apps/wechat/chat-view.js 的 _injectApps 表按已实例化对象取块。
 *   而实例只在 phone:openApp 懒加载时才 new（见 config/app-lazy-routes.js）。
 *
 *   后果（本项要修的那件事）：用户保存过设置之后重载，只要没有先点开那个 App，
 *   那份设置就完全不生效 —— 不报错、不提示、请求里就是没有那一块。
 *   这正是本仓最贵的一族形态（不报错、只错行为）：用户会以为「我设了」，
 *   而实际请求里那一块从未出现。
 *
 * 【本模块做什么】把「有效装配」从「是否打开过 App」解耦到
 *   存储读面 + 只读快照读面：
 *     · 设置：直接按各 App 的同一个 storage 键读，默认值一律复用各 App 的
 *       default*Settings() —— 不在这里抄第二份默认值（抄了必然漂移）；
 *     · 数据面：只读快照走 readPushProbe，各 App 的 read*Face() 纯函数照旧是唯一真源；
 *     · 注入块：复用各 App 的 *PromptBlock() 纯函数，一个字不改。
 *   故本模块不重写提示词系统（计划明确要求沿用 context-compose / injection-priority）；
 *   它只把既有的纯函数读面在没有实例时接上。
 *
 * 【与既有两条路径的关系（同事实不重复）】
 *   collectMissingAppInjections() 只对没有实例的 App 出块（isInstantiated 判定）。
 *   实例在场的 App 仍由它自己的钩子 / 微信表注入 —— 本模块不抢、也不重复。
 *
 * 【三态不同形（本仓反复点名的形态纪律）】
 *   instantiated（有实例，交给它自己）· disabled（开关关掉）· empty（开关关但真没内容）
 *   · deferred（重型数据未就绪）—— 四者必须分得开。把 deferred 并进 disabled，
 *   诊断页就再也答不出「这块是没配、还是没加载完」：两者处置方向相反
 *   （前者等用户去开开关，后者等这一次加载完成）。
 *
 * 【重型数据（撩语 / 金手指 / 资产）为什么是 deferred 而不是当场加载】
 *   这三者的正文是 MB 级静态数据（data/cheats.js 1.6MB、data/dirtytalk*.js 0.9MB）
 *   与 LA 引擎簇（apps/asset/engine 584KB）；它们当初就是按需加载的。
 *   若本模块静态 import 它们，等于把「一个外挂都没装的用户」也拖上全部语料 ——
 *   那是把懒加载反向做掉。故：先看存储里有没有非空的装配清单 / 已启用配置，
 *   有才动态 import（一次，缓存）；加载完成之前该 App 本次不出块，
 *   并如实记进 deferred（不静默、不假装没配）。
 *
 * 【只读纪律】本模块只读 storage 与只读快照，绝不写任何键、不碰上游任何状态。
 *   唯一的一次写是「一次性的动态加载缓存」，落在模块级变量里，不落盘。
 * ============================================================ */
'use strict';
import { readPushProbe } from '../config/world-bridge.js';
import { planInjection, INJECTION_TIERS } from '../config/injection-priority.js';
import { numOrNull } from '../config/num-gate.js';
import { defaultPlaceSettings, readSceneFace, scenePromptBlock } from './place/place-data.js';
import { defaultWalletSettings, readWalletFace, walletPromptBlock } from './wallet/wallet-data.js';
import { defaultProfileSettings, readProfileFace, profilePromptBlock } from './profile/profile-data.js';
import { defaultPlotlineSettings, readPlotlineFace, plotlinePromptBlock } from './plotline/plotline-data.js';
import { defaultCharsSettings, readCharsFace, charsPromptBlock } from './chars/chars-data.js';
import { defaultClockSettings, readClockFace, CLOCK_REASONS, clockPromptBlock } from './clock/clock-data.js';
import { defaultLedgerSettings, readLedgerFace, LEDGER_REASONS, ledgerPromptBlock } from './ledger/ledger-data.js';

/* ------------------------------------------------------------------
 * 一、storage 键（与各 App 逐字一致；这里只做读，不登记新键）
 *   命名一律 <APP>_<THING>_KEY，命中 keys-audit 的常量层抽取（[A-Z][A-Z0-9_]*_KEY），
 *   使「这些键被谁读」在门禁的 --list 里可见，而不是散成裸字面量。
 * ---------------------------------------------------------------- */
const PLACE_SETTINGS_KEY = 'place_settings_v1';
const WALLET_SETTINGS_KEY = 'wallet_settings_v1';
const PROFILE_SETTINGS_KEY = 'profile_settings_v1';
const PLOTLINE_SETTINGS_KEY = 'plotline_settings_v1';
const CHARS_SETTINGS_KEY = 'chars_settings_v1';
const CLOCK_SETTINGS_KEY = 'clock_settings';
const LEDGER_SETTINGS_KEY = 'ledger_settings';
/* 重型三者：只用来判「有没有非空装配 / 是否已启用」，读到的值不当数据用 */
const CHEAT_STATE_KEY = 'cheat_state_v1';
const DT_STATE_KEY = 'dt_state_v1';
const ASSET_SETTINGS_KEY = 'asset_settings_v1';
const ASSET_CONFIG_KEY = '__la_asset_config_v1';

/**
 * 读一份会话设置：容错口径与各 App 的 getSettings() 逐字同规
 *   （storage 缺失 / 值畸形 / JSON 解析失败 ⇒ 一律回落默认值，绝不抛）。
 * @param {object|null} storage 宿主 storage 句柄
 * @param {string} key storage 键
 * @param {Function} defaults 该 App 的 default*Settings 工厂（唯一真源，不在此重写）
 * @returns {object}
 */
function readSettings(storage, key, defaults) {
    const base = (typeof defaults === 'function') ? defaults() : {};
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(key, false) : null;
        const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
        return (obj && typeof obj === 'object') ? { ...base, ...obj } : { ...base };
    } catch (_e) { return { ...base }; }
}

/** 行数/个数上限：缺项或非数回落各自默认（取值门只此一份，不写裸 Number）。 */
function limitOf(v, fallback) {
    const n = numOrNull(v);
    return Math.max(1, (n === null ? fallback : n) || fallback);
}

/**
 * 通用探针形状：与 place / wallet / profile / plotline / chars 五 App 的
 *   probeBridge() 返回逐字同形（{mounted, hasSnapshot, snapshot}）。
 *   刻意不做「统一成一种形状再让各 face 去适配」—— 那会把各 App 的归因口径
 *   在本模块里再写一遍，而它们的六态/五态判定各自钉在自己的 data 模块里。
 */
function pushProbeOf(p) {
    return { mounted: p.mounted, hasSnapshot: p.hasSnapshot, snapshot: p.snapshot };
}

/** 时计探针：clock-app 的口径（hasBridge 而非 mounted，另带 clock 面） */
function clockProbeOf(p) {
    const snap = p.snapshot;
    return { hasBridge: p.mounted, hasSnapshot: p.hasSnapshot, clock: (snap && typeof snap === 'object') ? snap.clock : null };
}

/** 账本探针：ledger-app 的口径（面名是 worldLedgerRead，不是 ledger） */
function ledgerProbeOf(p) {
    const snap = p.snapshot;
    return { hasBridge: p.mounted, hasSnapshot: p.hasSnapshot, ledger: (snap && typeof snap === 'object') ? snap.worldLedgerRead : null };
}

/* ------------------------------------------------------------------
 * 二、轻量装配表（静态 import 的七个 App）
 *   顺序即档位序（rule → persona → fact → ambient）：planInjection 按档配额，
 *   档内保序，故输出天然是「规则/人设在前、氛围在后」。
 *   tier 一律显式给（不靠 label 猜）—— tierOf 的标签猜法是为上游自由文本准备的，
 *   本表知道自己是什么，没必要让猜法参与。
 * ---------------------------------------------------------------- */
const LIGHT_SPECS = Object.freeze([
    {
        appId: 'profile', key: 'profileApp', name: 'SYSTEM (档案)', tier: INJECTION_TIERS.PERSONA,
        settingsKey: PROFILE_SETTINGS_KEY, defaults: defaultProfileSettings,
        build: (p, s) => profilePromptBlock(readProfileFace(pushProbeOf(p)), { maxLines: limitOf(s.maxInject, 8) })
    },
    {
        appId: 'chars', key: 'charsApp', name: 'SYSTEM (群像)', tier: INJECTION_TIERS.PERSONA,
        settingsKey: CHARS_SETTINGS_KEY, defaults: defaultCharsSettings,
        build: (p, s) => charsPromptBlock(readCharsFace(pushProbeOf(p)).chars, { maxRoles: limitOf(s.maxInject, 5) })
    },
    {
        appId: 'plotline', key: 'plotlineApp', name: 'SYSTEM (剧情线)', tier: INJECTION_TIERS.PERSONA,
        settingsKey: PLOTLINE_SETTINGS_KEY, defaults: defaultPlotlineSettings,
        build: (p, s) => plotlinePromptBlock(readPlotlineFace(pushProbeOf(p)), { maxLines: limitOf(s.maxInject, 10) })
    },
    {
        appId: 'clock', key: 'clockApp', name: 'SYSTEM (时计)', tier: INJECTION_TIERS.FACT,
        settingsKey: CLOCK_SETTINGS_KEY, defaults: defaultClockSettings,
        build: (p) => {
            const probe = clockProbeOf(p);
            /* 三态同规：只有 ready 才出块 —— 「桥不在」「没这面」「上游声明了但空」
             *   都不该被压成一句「今天」写进上下文（那是编事实，不是注入读数）。 */
            if (readClockFace(probe, p.snapshot) !== CLOCK_REASONS.ready) return '';
            return clockPromptBlock(probe.clock);
        }
    },
    {
        appId: 'place', key: 'placeApp', name: 'SYSTEM (地点)', tier: INJECTION_TIERS.FACT,
        settingsKey: PLACE_SETTINGS_KEY, defaults: defaultPlaceSettings,
        build: (p, s) => scenePromptBlock(readSceneFace(pushProbeOf(p)).snapshot, { maxLines: limitOf(s.maxInject, 8) })
    },
    {
        appId: 'wallet', key: 'walletApp', name: 'SYSTEM (钱袋)', tier: INJECTION_TIERS.FACT,
        settingsKey: WALLET_SETTINGS_KEY, defaults: defaultWalletSettings,
        build: (p, s) => walletPromptBlock(readWalletFace(pushProbeOf(p)).ledger, { maxLines: limitOf(s.maxInject, 6) })
    },
    {
        appId: 'ledger', key: 'ledgerApp', name: 'SYSTEM (世界账本)', tier: INJECTION_TIERS.FACT,
        settingsKey: LEDGER_SETTINGS_KEY, defaults: defaultLedgerSettings,
        build: (p) => {
            const probe = ledgerProbeOf(p);
            if (readLedgerFace(probe, p.snapshot) !== LEDGER_REASONS.ready) return '';
            return ledgerPromptBlock(probe.ledger);
        }
    }
]);

/* ------------------------------------------------------------------
 * 三、重型装配（撩语 / 金手指 / 资产）：按需加载 + 一次性缓存
 *   加载触发条件只看存储（有没有非空清单 / 有没有启用配置），
 *   不看设置开关 —— 「开关开着但没装东西」不该触发 MB 级加载。
 * ---------------------------------------------------------------- */
let _heavy = null;          /* 就绪后的模块缓存：{ cheat, dt, asset } */
let _heavyLoading = false;
let _heavyFailed = false;   /* 加载失败留痕：诊断面据此报「加载失败」，不报「没配」 */

/** 读一份 JSON 存储值（容错；只读不写） */
function readJson(storage, key) {
    try {
        const raw = storage && typeof storage.get === 'function' ? storage.get(key, null) : null;
        const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
        return (obj && typeof obj === 'object') ? obj : null;
    } catch (_e) { return null; }
}

/** 装配清单是否非空（读的是各 App 自己的状态键；形状读不懂一律当「没装」） */
function installedOf(storage, key) {
    const st = readJson(storage, key);
    const list = st && Array.isArray(st.installed) ? st.installed : [];
    return list.length > 0;
}

/** 资产是否已引导/启用（onboarded 是引擎自己的开关位；读不懂当「没启用」） */
function assetOnboarded(storage) {
    const cfg = readJson(storage, ASSET_CONFIG_KEY);
    return !!(cfg && cfg.onboarded === true);
}

/** 有没有值得为它加载 MB 级数据的理由 */
function heavyWanted(storage) {
    return {
        cheat: installedOf(storage, CHEAT_STATE_KEY),
        dt: installedOf(storage, DT_STATE_KEY),
        asset: assetOnboarded(storage)
    };
}

/**
 * 一次性加载重型模块（fire-and-forget：调用方是同步的生成钩子，
 *   不可能 await；故本次如实记 deferred，下一次生成时缓存已就绪）。
 * 刻意不抛：加载失败只置 _heavyFailed，绝不阻断生成。
 */
function ensureHeavy(storage) {
    if (_heavy || _heavyLoading) return;
    const want = heavyWanted(storage);
    if (!want.cheat && !want.dt && !want.asset) return;
    _heavyLoading = true;
    const jobs = [];
    if (want.cheat) {
        jobs.push(import('./cheat/cheat-data.js').then((m) => {
            _heavy = _heavy || {};
            _heavy.cheat = m;
        }));
    }
    if (want.dt) {
        jobs.push(import('./dirtytalk/dt-data.js').then((m) => {
            _heavy = _heavy || {};
            _heavy.dt = m;
        }));
    }
    if (want.asset) {
        jobs.push(Promise.all([
            import('./asset/asset-data.js'),
            import('./asset/engine/asset-store.js'),
            import('./asset/asset-app.js')
        ]).then((mods) => {
            _heavy = _heavy || {};
            _heavy.asset = { data: mods[0], store: mods[1], app: mods[2] };
        }));
    }
    Promise.all(jobs).then(() => {
        _heavyLoading = false;
    }).catch(() => {
        _heavyLoading = false;
        _heavyFailed = true;
        _heavy = null;   /* 部分失败不留半份缓存：宁可下一次整份重来，不要半残读数 */
    });
}

/** 金手指免实例块：装配清单 + 设置全从存储读，纯函数复用 cheat-data */
function cheatBlock(storage, heavy) {
    const m = heavy && heavy.cheat;
    if (!m) return '';
    try {
        const st = readJson(storage, CHEAT_STATE_KEY) || {};
        const settings = { ...m.defaultCheatSettings(), ...((st.settings && typeof st.settings === 'object') ? st.settings : {}) };
        if (!settings.injectToPrompt) return '';
        const cleaned = m.sanitizeInstalled(st.installed, { limit: settings.maxInstall });
        return m.buildCheatPromptBlock(cleaned.ids, { settings: settings });
    } catch (_e) { return ''; }
}

/** 撩语免实例块：同金手指口径（语料正文只在真装了模块时才被用到） */
function dtBlock(storage, heavy) {
    const m = heavy && heavy.dt;
    if (!m) return '';
    try {
        const st = readJson(storage, DT_STATE_KEY) || {};
        const settings = { ...m.defaultDtSettings(), ...((st.settings && typeof st.settings === 'object') ? st.settings : {}) };
        if (!settings.injectToPrompt) return '';
        const cleaned = m.sanitizeInstalled(st.installed, { limit: settings.maxInstall });
        return m.buildDtPromptBlock(cleaned.ids, { settings: settings });
    } catch (_e) { return ''; }
}

/**
 * 资产免实例块：走 asset-store 引擎（与 asset-app 同一份宿主桥，见其 makeHost）。
 *   剧情日只认 TimeManager；拿不到就不推进、也不编 —— 与 asset-app 的 era() 同规。
 */
function assetBlock(storage, heavy, win) {
    const pack = heavy && heavy.asset;
    if (!pack) return '';
    try {
        const d = pack.data;
        const app = pack.app;
        const storeApi = (pack.store && pack.store.default) ? pack.store.default : pack.store;
        const factory = storeApi && typeof storeApi.createAssetStore === 'function' ? storeApi.createAssetStore : null;
        if (typeof factory !== 'function') return '';
        if (!app || typeof app.makeHost !== 'function') return '';
        const settings = readSettings(storage, ASSET_SETTINGS_KEY, d.defaultAssetSettings);
        if (!settings.injectToPrompt) return '';
        const store = factory({ host: app.makeHost(storage) });
        let hasConfig = false;
        let enabled = false;
        let ledger = null;
        try { hasConfig = !!store.hasConfig(); } catch (_e) { hasConfig = false; }
        try { enabled = !!store.isEnabled(); } catch (_e) { enabled = false; }
        try { ledger = store.readLedger(); } catch (_e) { ledger = null; }
        const face = d.readAssetFace({ hasConfig: hasConfig, enabled: enabled, ledger: ledger });
        if (face.reason !== 'ready') return '';
        const names = {};
        const actors = face.ledger && face.ledger.actors ? face.ledger.actors : {};
        const ks = Object.keys(actors);
        for (let i = 0; i < ks.length; i++) names[ks[i]] = ks[i];
        /* era 判定与 asset-app.era() 同规：设置里显式指定优先，否则按剧情时间推 */
        let story = null;
        try {
            const tm = win && win.VirtualPhone ? win.VirtualPhone.timeManager : null;
            story = (tm && typeof tm.getCurrentStoryTime === 'function') ? tm.getCurrentStoryTime() : null;
        } catch (_e) { story = null; }
        const forced = d.normalizeEraOf(settings.era);
        const era = (settings.era === 'modern' || settings.era === 'ancient' || settings.era === 'xianxia')
            ? forced
            : d.eraFromStoryTime(story, forced);
        return d.assetPromptBlock(face.ledger, { era: era, names: names, injectToPrompt: true });
    } catch (_e) { return ''; }
}

/* ------------------------------------------------------------------
 * 四、对外入口
 * ---------------------------------------------------------------- */

/**
 * 收集「没有实例的装配类 App」应注入的生成侧块。
 *
 * @param {object} win 宿主 window（缺省回落全局）
 * @param {object|null} storage 宿主 storage 句柄（读设置用；缺省时各 App 一律走默认值）
 * @param {object} [opts]
 *   · isInstantiated(appId, key) — 由调用方判定「这个 App 是否已有实例」；
 *       缺省实现看 win.VirtualPhone[key]。本模块不猜：有实例就整块让给实例路径。
 *   · budgetChars — 预算（字符）。不给就不裁（走 MAX_SAFE_INTEGER，
 *       与 config/injection-contract.js 的既有先例同口径：不编一个默认预算，
 *       编了会让「上游没报预算」被读成「预算够」）。
 * @returns {{blocks:Array<{appId:string,name:string,content:string,tier:string}>, notes:object}}
 */
export function collectMissingAppInjections(win, storage, opts = {}) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    const notes = {
        instantiated: [], disabled: [], empty: [], deferred: [], heavyFailed: false,
        mounted: false, hasSnapshot: false, plan: null
    };
    const out = [];
    try {
        const isInstantiated = (typeof opts.isInstantiated === 'function')
            ? opts.isInstantiated
            : function (appId, key) {
                try { return !!(w && w.VirtualPhone && w.VirtualPhone[key]); } catch (_e) { return false; }
            };
        /* 探针取一次：同一份快照喂给全部 App，避免各取一次得到不同修订的读数 */
        let probe = { mounted: false, hasSnapshot: false, snapshot: null };
        try {
            const p = readPushProbe(w);
            probe = {
                mounted: !!p.mounted,
                hasSnapshot: !!p.hasSnapshot,
                snapshot: p.snapshot || null
            };
        } catch (_e) { /* 探针异常：快照按「拿不到」处理，各 face 会各自如实归因 */ }
        notes.mounted = probe.mounted;
        notes.hasSnapshot = probe.hasSnapshot;

        const candidates = [];
        for (const spec of LIGHT_SPECS) {
            if (isInstantiated(spec.appId, spec.key)) { notes.instantiated.push(spec.appId); continue; }
            const s = readSettings(storage, spec.settingsKey, spec.defaults);
            if (!s.injectToPrompt) { notes.disabled.push(spec.appId); continue; }
            let content = '';
            try { content = String(spec.build(probe, s) || ''); } catch (_e) { content = ''; }
            if (!content) { notes.empty.push(spec.appId); continue; }
            candidates.push({ appId: spec.appId, name: spec.name, tier: spec.tier, content: content });
        }

        /* 重型三者：先看「有没有理由加载」，未就绪一律记 deferred（不静默跳过） */
        const heavyKeys = { cheat: 'cheatApp', dt: 'dtApp', asset: 'assetApp' };
        const heavyNames = { cheat: 'SYSTEM (金手指)', dt: 'SYSTEM (撩语)', asset: 'SYSTEM (资产)' };
        const heavyTiers = {
            cheat: INJECTION_TIERS.RULE,
            dt: INJECTION_TIERS.PERSONA,
            asset: INJECTION_TIERS.FACT
        };
        const wanted = heavyWanted(storage);
        const wantedIds = Object.keys(heavyKeys).filter(function (id) { return wanted[id]; });
        if (wantedIds.length) {
            if (!_heavy) ensureHeavy(storage);
            const ready = _heavy || {};
            for (const id of wantedIds) {
                if (isInstantiated(id, heavyKeys[id])) { notes.instantiated.push(id); continue; }
                let content = '';
                if (id === 'cheat') content = cheatBlock(storage, ready);
                else if (id === 'dt') content = dtBlock(storage, ready);
                else content = assetBlock(storage, ready, w);
                /* 四态不同形（本仓点名的形态纪律）：模块**已就绪**却没出块 ⇒ 真没内容（empty）；
                 *   模块还没到 / 加载失败 ⇒ 本次未就绪（deferred）。二者处置方向相反：
                 *   前者等用户去装东西，后者等这一次加载完成 —— 压成一态会让诊断页答不出「为什么这次没注入」。 */
                if (!content) {
                    const modReady = (id === 'asset')
                        ? !!(ready.asset && ready.asset.data && ready.asset.store)
                        : !!(ready[id]);
                    if (modReady && !_heavyFailed) notes.empty.push(id);
                    else notes.deferred.push(id);
                    continue;
                }
                candidates.push({ appId: id, name: heavyNames[id], tier: heavyTiers[id], content: content });
            }
        }
        notes.heavyFailed = _heavyFailed;

        /* 预算裁定：档位序已由 LIGHT_SPECS / heavyTiers 固定，这里只做「谁让位」的算术。
         *   不编预算：调用方不给就走 MAX_SAFE_INTEGER（等价于「本次不裁」）。 */
        const budgetGiven = numOrNull(opts.budgetChars);
        const planRows = candidates.map(function (c) {
            return { ref: c.appId, label: c.name, tier: c.tier, content: c.content, chars: c.content.length };
        });
        let plan = null;
        try {
            plan = planInjection(planRows, {
                budgetChars: (budgetGiven === null ? Number.MAX_SAFE_INTEGER : budgetGiven)
            });
            notes.plan = plan;
        } catch (_e) { plan = null; }
        const byRef = {};
        for (const c of candidates) byRef[c.appId] = c;
        if (plan && Array.isArray(plan.kept)) {
            for (const row of plan.kept) {
                const c = byRef[row.ref];
                if (c) out.push({ appId: c.appId, name: c.name, content: c.content, tier: c.tier });
            }
        } else {
            /* 裁定异常（不该发生）时不静默丢块：退回未裁的原序输出，并如实报空 plan */
            for (const c of candidates) out.push({ appId: c.appId, name: c.name, content: c.content, tier: c.tier });
        }
    } catch (_e) {
        /* 装配失败绝不阻断生成：如实返回已收到的部分（可能为空），由调用方照常发送 */
        return { blocks: out, notes: notes };
    }
    return { blocks: out, notes: notes };
}

/**
 * 把免实例装配挂到主链路的生成前钩子（宿主无事件源时静默不挂，不影响任何 App 本体）。
 *   为何要挂：装配类 App 的钩子长在**各自的构造期**，未打开过的 App 根本没有构造期，
 *   故需要一个「不依赖任何 App 实例」的挂载点 —— 就是本函数。
 *   与各 App 自己的钩子**不重复**：本函数只出「没有实例的 App」的块。
 *
 * @returns {boolean} 是否挂上（已挂过 / 宿主无事件源均返回 false）
 */
export function mountMissingAppInjection(win, storage) {
    const w = win || (typeof window !== 'undefined' ? window : null);
    if (!w || w.__rpMissingAppInjectionMounted) return false;
    try {
        const ctx = w.SillyTavern && typeof w.SillyTavern.getContext === 'function' ? w.SillyTavern.getContext() : null;
        const es = ctx && ctx.eventSource;
        const et = ctx && ctx.event_types;
        if (!es || !et || !et.GENERATE_BEFORE_COMBINE_PROMPTS) return false;
        es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, function (payload) {
            /* 注入失败绝不阻断生成：本块是一致性约束，不是必需上下文 */
            try {
                if (!payload || !Array.isArray(payload.prompt)) return;
                const got = collectMissingAppInjections(w, storage);
                for (const b of got.blocks) {
                    payload.prompt.push({ role: 'system', content: b.content });
                }
            } catch (_e) { /* 静默失败：生成照常进行 */ }
        });
        w.__rpMissingAppInjectionMounted = true;
        return true;
    } catch (_e) { return false; }
}

export default { collectMissingAppInjections, mountMissingAppInjection };
