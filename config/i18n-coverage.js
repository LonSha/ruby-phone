/**
 * config/i18n-coverage.js — 两语言包键集合对等 + 缺键面（哪个 App 缺哪个键）[R26-O7]
 *
 * 立项时的空缺（原文）：缺键目前在**运行时**才暴露；
 * 验收口径是「两包键集合相等；缺键面能看到『哪个 App 缺哪个键』」。
 *
 * 四条纪律：
 *   ① 两包键集合必须**相等**（双向差集都为空）：只查「B 缺 A 的键」会漏掉「B 多出孤儿键」。
 *   ② 缺键面必须**精确到 App + 键**：只给一个总数等于把定位工作丢回给用户。
 *   ③ 期望键由**闭集规则**生成（核心键 + 每个 App 的 name/empty），
 *      不手抄清单 —— 手抄清单必然与 `config/apps.js` 漂移。
 *   ④ 没有语言包时**不编造** per-locale 缺口（没有 locale 就没有「谁缺」），
 *      但文案必须直说「没有任何语言包（全部键都缺）」，绝不许说成「0 缺键、一切正常」。
 *
 * 纯逻辑件：包与 appId 全由调用方注入（父件 `config/i18n.js` 只提供 keyDiff 与语言闭集）。
 */
import { keyDiff, LANGUAGES } from './i18n.js';

/** 全 App 通用核心键（闭集；缺了任何一个都是硬伤）。 */
export const CORE_KEYS = Object.freeze(['common.ok', 'common.cancel', 'common.retry']);

/** 每个 App 必须有的键后缀（闭集）。 */
export const APP_KEY_SUFFIXES = Object.freeze(['name', 'empty']);

/** 由闭集规则生成期望键：核心键 + 每个 App 的每类键。顺序稳定，便于逐字对拍。 */
export function expectedKeys(appIds) {
  const ids = Array.isArray(appIds) ? appIds.map(String) : [];
  const out = [...CORE_KEYS];
  for (const id of ids) {
    for (const suffix of APP_KEY_SUFFIXES) out.push('app.' + id + '.' + suffix);
  }
  return out;
}

/**
 * 审计两包覆盖率。
 * @param {Object<string, object>} packs 形如 { 'zh-CN': {...}, 'en-US': {...} }
 * @param {Array<string>} appIds 真 App id 列表（来自 config/apps.js）
 */
export function auditI18nCoverage(packs, appIds) {
  const p = packs && typeof packs === 'object' ? packs : {};
  const locales = Object.keys(p).filter((k) => LANGUAGES[k] || k);
  const ids = Array.isArray(appIds) ? appIds.map(String) : [];
  const expected = expectedKeys(ids);

  const perLocale = {};
  const gaps = [];
  const coreGaps = [];
  for (const locale of locales) {
    const pack = p[locale] && typeof p[locale] === 'object' ? p[locale] : {};
    const missing = [];
    for (const key of expected) {
      if (!Object.prototype.hasOwnProperty.call(pack, key)) {
        missing.push(key);
        const m = /^app\.(.+)\.(name|empty)$/.exec(key);
        if (m) gaps.push({ locale, appId: m[1], key });
        else coreGaps.push({ locale, key });
      }
    }
    perLocale[locale] = { total: expected.length, missing, coverRate: expected.length ? (expected.length - missing.length) / expected.length : 1 };
  }

  /* 包间对等：两两比，取第一对不等的差异（多于两个包时也逐对报）。 */
  const parity = [];
  for (let i = 0; i < locales.length; i += 1) {
    for (let j = i + 1; j < locales.length; j += 1) {
      const a = locales[i];
      const b = locales[j];
      const d = keyDiff(p[a] || {}, p[b] || {});
      parity.push({ a, b, ...d });
    }
  }

  return {
    locales,
    apps: ids.length,
    expectedKeys: expected.length,
    perLocale,
    parity,
    parityOk: parity.every((x) => x.same),
    gaps,
    coreGaps,
    summary: { gapCount: gaps.length, coreGapCount: coreGaps.length, locales: locales.length, apps: ids.length },
  };
}

/** 一行裁定文案：说清「差多少、差在哪」。 */
export function i18nCoverageText(report) {
  if (!report || typeof report !== 'object') return '多语言覆盖：未审计';
  if (!report.locales.length) return '多语言覆盖：没有任何语言包（全部键都缺）';
  const gaps = report.gaps;
  if (!gaps.length && report.parityOk && !report.coreGaps.length) {
    return `多语言覆盖：${report.locales.join(' / ')} 齐全（${report.expectedKeys} 键 × ${report.apps} App）`;
  }
  const head = gaps.slice(0, 3).map((g) => `${g.locale}:${g.appId}.${g.key.split('.').pop()}`).join('、');
  const more = gaps.length > 3 ? ` 等 ${gaps.length} 处` : '';
  return `多语言覆盖：缺 ${gaps.length} 键${report.coreGaps.length ? ` + 核心键 ${report.coreGaps.length} 处` : ''}`
    + `${report.parityOk ? '' : '（两包键集合不等）'}${head ? `；首几处：${head}${more}` : ''}`;
}

/** 自检：只验纪律。 */
export function i18nCoverageSelfCheck() {
  const bad = [];
  const apps = ['wechat', 'gallery'];
  const zh = { 'common.ok': '好', 'common.cancel': '取消', 'common.retry': '重试', 'app.wechat.name': '微信', 'app.wechat.empty': '没有消息', 'app.gallery.name': '相册', 'app.gallery.empty': '没有照片' };
  const en = { 'common.ok': 'OK', 'common.cancel': 'Cancel', 'common.retry': 'Retry', 'app.wechat.name': 'WeChat', 'app.wechat.empty': 'No messages', 'app.gallery.name': 'Gallery', 'app.gallery.empty': 'No photos' };

  const ok = auditI18nCoverage({ 'zh-CN': zh, 'en-US': en }, apps);
  if (!ok.parityOk) bad.push('两包键集合相等却判不等');
  if (ok.gaps.length) bad.push(`两包齐全却报缺键 ${ok.gaps.length} 处`);

  // 精确到 App + 键
  const missingOne = { ...zh };
  delete missingOne['app.gallery.empty'];
  const one = auditI18nCoverage({ 'zh-CN': missingOne, 'en-US': en }, apps);
  if (!one.gaps.some((g) => g.appId === 'gallery' && g.key === 'app.gallery.empty')) bad.push('缺键未精确到 App + 键');
  if (one.parityOk) bad.push('一包少键却判两包对等');

  // 空包不是「全绿」
  const empty = auditI18nCoverage({}, apps);
  if (empty.gaps.length !== 0) bad.push('没有任何语言包时不该有 per-App gap（应报 coreGaps=全量/无包）');
  if (!i18nCoverageText(empty).includes('没有任何语言包')) bad.push('空包文案未说清');

  return { ok: bad.length === 0, bad, sample: i18nCoverageText(one) };
}