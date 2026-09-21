/**
 * 起名台服务（v2.60.0）——封装 name-data.js 的 NAME_DATA，纯本地、零依赖、只读。
 * NAME_DATA 顶层：
 *   surnames: { western: [...], chinese: [...], japanese: [...] }   扁平字符串数组
 *   given:
 *     western/japanese: { female: [...], male: [...] }              扁平字符串数组
 *     chinese:          { female: {single:[...],double:[...]}, male: {...} }  按字长分组
 * 本层把三种语言的不一致结构统一成"可抽取的池"，对外只暴露随机起名 + 池查询。
 */
import { NAME_DATA } from './name-data.js';

function _surnamePool(lang) {
  return (NAME_DATA.surnames && NAME_DATA.surnames[lang]) || [];
}

// 统一抽取给定名数组：chinese 的 nested {single,double} 展平，其余直接取
function _givenPool(lang, gender) {
  const g = NAME_DATA.given && NAME_DATA.given[lang] ? NAME_DATA.given[lang][gender] : null;
  if (!g) return [];
  if (Array.isArray(g)) return g;
  return [].concat(g.single || [], g.double || []);
}

function _pick(arr, forced) {
  if (!arr.length) return '';
  if (forced && arr.indexOf(forced) >= 0) return forced;
  return arr[Math.floor(Math.random() * arr.length)];
}

// 支持的语言（以姓池非空为准）
export function nameLangs() {
  return Object.keys(NAME_DATA.surnames || {}).filter((l) => _surnamePool(l).length);
}

// 单语言规模 { surnames, female, male }
export function nameStats() {
  const out = {};
  for (const l of nameLangs()) {
    out[l] = { surnames: _surnamePool(l).length, female: _givenPool(l, 'female').length, male: _givenPool(l, 'male').length };
  }
  return out;
}

/**
 * 随机起名。opts: { lang, gender, surname }（surname 可选，传入且存在于该语言姓池则固定姓）
 * 返回 { lang, gender, surname, given, full }；姓池为空返回 null。
 */
export function generateName(opts) {
  opts = opts || {};
  let lang = opts.lang;
  if (!lang || !_surnamePool(lang).length) lang = nameLangs()[0] || 'chinese';
  const gender = (opts.gender === 'male' || opts.gender === 'female') ? opts.gender : 'female';
  const surname = _pick(_surnamePool(lang), opts.surname);
  const given = _pick(_givenPool(lang, gender), null);
  if (!surname) return null;
  return { lang, gender, surname, given, full: surname + given };
}
