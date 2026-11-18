/**
 * config/i18n.js — R24-X6 多语言最小闭环：中英双语（v4.158.0）
 *
 * 【治的欠债】全仓中文硬编码（config/ 345 模块、apps/ 101 目录、`config/apps.js` 的 name 都是中文），
 *   没有 i18n 目录、没有语言切换。SillyTavern 是国际项目，非中文用户装上就是一堆方块字。
 *
 * 【唯一出口】取词只走 `t(key, vars)`。缺键**返回 `⟪key⟫` 而不是空串**
 *   （空串会让界面静默少一行，是本仓最讨厌的「不报错只错表现」），并且每个缺键只 warn 一次。
 *
 * 【两包键集合必须相等】`keyDiff()` 双向报缺（缺键逐条列出），测试与门禁都读它。
 *
 * 【三态语言】`auto`（跟随宿主）/ `zh-CN` / `en-US`；`setLanguage` 即时生效，不重启、不重建。
 *
 * 【数据是数据】语言包是 `i18n/zh-CN.json` 与 `i18n/en-US.json`，本模块只做取词与校验，
 *   不把文案写进代码（新增一门语言 = 加一个 JSON，不改代码）。
 */
import { numOrNull } from './num-gate.js';

export const LANGUAGES = Object.freeze({
    auto: '跟随宿主',
    'zh-CN': '中文',
    'en-US': 'English'
});

export const DEFAULT_LANGUAGE = 'auto';
export const FALLBACK_LOCALE = 'zh-CN';

/** 缺键形状：显式可见，永不返回空串。 */
export function missingMarker(key) {
    return '\u27ea' + String(key) + '\u27eb';
}

function interpolate(text, vars) {
    if (!vars || typeof vars !== 'object') return text;
    return String(text).replace(/\{([a-zA-Z0-9_.-]+)\}/g, function (m, name) {
        if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null) {
            return String(vars[name]);
        }
        return m;
    });
}

/** 双向键差：两包键集合必须完全相等。 */
export function keyDiff(a, b) {
    const left = a && typeof a === 'object' ? Object.keys(a) : [];
    const right = b && typeof b === 'object' ? Object.keys(b) : [];
    const missingInB = left.filter(function (k) { return !Object.prototype.hasOwnProperty.call(b || {}, k); });
    const missingInA = right.filter(function (k) { return !Object.prototype.hasOwnProperty.call(a || {}, k); });
    return { missingInA, missingInB, same: missingInA.length === 0 && missingInB.length === 0 };
}

/**
 * @param {{packs?:Object<string,object>, language?:string, hostLocale?:string, warn?:Function}} options
 */
export function createI18n(options) {
    const o = options && typeof options === 'object' ? options : {};
    const packs = o.packs && typeof o.packs === 'object' ? o.packs : {};
    const warn = typeof o.warn === 'function' ? o.warn : function () {};
    let language = typeof o.language === 'string' && LANGUAGES[o.language] ? o.language : DEFAULT_LANGUAGE;
    let hostLocale = typeof o.hostLocale === 'string' && o.hostLocale !== '' ? o.hostLocale : FALLBACK_LOCALE;
    const warned = new Set();
    let lookups = 0;
    let misses = 0;

    function resolveLanguage() {
        if (language !== 'auto') return language;
        return hostLocale.toLowerCase().indexOf('en') === 0 ? 'en-US' : FALLBACK_LOCALE;
    }

    function packOf() {
        const locale = resolveLanguage();
        const pack = packs[locale];
        return pack && typeof pack === 'object' ? pack : null;
    }

    function t(key, vars) {
        lookups += 1;
        const k = String(key);
        const pack = packOf();
        if (!pack || !Object.prototype.hasOwnProperty.call(pack, k)) {
            misses += 1;
            if (!warned.has(k)) {
                warned.add(k);
                warn('[i18n] 缺键 ' + k + '（语言 ' + resolveLanguage() + '）');
            }
            return missingMarker(k);
        }
        return interpolate(pack[k], vars);
    }

    function setLanguage(lang) {
        if (!LANGUAGES[lang]) return { ok: false, bad: ['unknown-language'], language };
        language = lang;
        warned.clear();
        return { ok: true, language, resolved: resolveLanguage() };
    }

    function setHostLocale(locale) {
        hostLocale = typeof locale === 'string' && locale !== '' ? locale : FALLBACK_LOCALE;
        return { hostLocale, resolved: resolveLanguage() };
    }

    function appName(appId) {
        return t('app.' + String(appId) + '.name');
    }

    function appEmptyText(appId) {
        return t('app.' + String(appId) + '.empty');
    }

    function stats() {
        return { language, resolved: resolveLanguage(), lookups, misses, warned: warned.size, packs: Object.keys(packs) };
    }

    function diff(localeA, localeB) {
        return keyDiff(packs[localeA] || {}, packs[localeB] || {});
    }

    return { t, setLanguage, setHostLocale, resolveLanguage, appName, appEmptyText, stats, diff, keyDiff };
}

export function i18nSelfCheck() {
    const bad = [];
    const zh = { 'app.wechat.name': '微信', 'common.ok': '好', 'greet': '你好，{name}' };
    const en = { 'app.wechat.name': 'WeChat', 'common.ok': 'OK', 'greet': 'Hi, {name}' };
    const warns = [];
    const i18n = createI18n({ packs: { 'zh-CN': zh, 'en-US': en }, warn: function (m) { warns.push(m); } });

    if (i18n.t('app.wechat.name') !== '微信') bad.push('默认应回落 zh-CN');
    if (i18n.t('greet', { name: '阿明' }) !== '你好，阿明') bad.push('插值应生效');
    i18n.setLanguage('en-US');
    if (i18n.t('app.wechat.name') !== 'WeChat') bad.push('切英文应即时生效');
    if (i18n.t('nope.key') !== '⟪nope.key⟫') bad.push('缺键必须返回 ⟪key⟫ 而不是空串');
    i18n.t('nope.key');
    if (warns.length !== 1) bad.push('同一缺键只 warn 一次');
    if (i18n.t('app.wechat.name') === '') bad.push('取词不许返回空串');

    const d = i18n.diff('zh-CN', 'en-US');
    if (!d.same) bad.push('两包键集合应相等');
    const d2 = keyDiff({ a: 1 }, { a: 1, b: 2 });
    if (d2.missingInA[0] !== 'b' || d2.same) bad.push('双向键差应报出缺键');

    i18n.setHostLocale('en-GB');
    if (i18n.setLanguage('auto').ok !== true) bad.push('auto 应可用');
    if (i18n.resolveLanguage() !== 'en-US') bad.push('auto 应跟随宿主（en-GB → en-US）');
    if (i18n.setLanguage('xx').ok) bad.push('未知语言应拒收');

    return { ok: bad.length === 0, bad, sample: 'packs=2 lookups=' + i18n.stats().lookups + ' misses=' + i18n.stats().misses };
}

export default {
    LANGUAGES,
    DEFAULT_LANGUAGE,
    FALLBACK_LOCALE,
    missingMarker,
    keyDiff,
    createI18n,
    i18nSelfCheck
};