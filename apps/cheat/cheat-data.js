/* ========================================================
 * cheat-data.js — [v2.47.0] 万界武库 · 外挂内核（纯函数）
 *
 * 本模块**不碰 window / 不碰 storage / 不碰 DOM**，只做纯计算：
 *   选包 → 装配校验 → 注入块组装 → 概览统计。
 *   状态读写与生成侧钩子都在 cheat-app.js（控制器），视图在 cheat-view.js。
 *
 * 三条纪律（与 place-data.js 同规格）：
 *   ① 只读：外挂正文是内置静态事实源（data/cheats.js），本模块绝不改写它；
 *   ② 不抛：任何畸形入参（null / 非数组 / 未知 id）一律降级为空结果，绝不 throw；
 *   ③ 不猜：未知 id、未知品阶**如实丢弃或如实透传原值**，绝不编造外挂顶替。
 *
 * 【与抽卡侧的契约】外挂在幸运转盘里以 `cheat_<packId>` 作 itemId 入包
 *   （前缀唯一真源在 data/cheats.js 的 CHEAT_ITEM_PREFIX）。本模块 re-export
 *   这两个映射函数，避免抽卡侧与外挂侧各写一套前缀常量。
 * ======================================================== */
'use strict';
import { cheatPacks } from '../../data/cheats.js';
/* 品阶权重/颜色/顺序 + itemId 映射**都取自轻量索引**：抽卡侧读的是同一份文件，
 * 若哪天要调权重，只改生成脚本一处，两边同时变，不会出现「抽卡按 1:30、App 按 1:20」的漂移。 */
import {
  CHEAT_QUALITY_META as QUALITY_META,
  CHEAT_QUALITY_ORDER as QUALITY_ORDER,
  cheatItemId,
  cheatPackIdOfItem,
} from '../../data/cheat-index.js';

/* 前缀映射的再导出：抽卡侧/控制器用它把背包 itemId 反解回 packId，不各自硬编码 'cheat_' */
export { cheatItemId, cheatPackIdOfItem };


/** 未知品阶一律排到末位（不塌进任一已知档） */
export function qualityOrderOf(q) {
  const m = QUALITY_META[q];
  return m ? m.order : QUALITY_ORDER.length + 1;
}
export function qualityColorOf(q) {
  const m = QUALITY_META[q];
  return m ? m.color : '#64748b';
}

/** 装配上限的可调范围（设置页滑块） */
export const INSTALL_MIN = 1;
export const INSTALL_MAX = 5;

/** 设置默认值：键名必须匹配 config/storage.js 的 `/^cheat_/`，否则跨会话串味 */
export function defaultCheatSettings() {
  return {
    maxInstall: 3,        // 同时装配的外挂数（1–5）
    injectToPrompt: true, // 是否把已装配外挂交给生成侧
    showDiagnostics: false,
  };
}

/** 全部外挂（只读快照，防调用方就地排序污染事实源） */
export function allCheats() {
  return Array.isArray(cheatPacks) ? cheatPacks.slice() : [];
}

/** 按 id 取外挂；未知 id 返回 null（不猜、不造） */
export function getCheatById(id) {
  const k = String(id || '');
  if (!k) return null;
  return allCheats().find((p) => p.id === k) || null;
}

/** 按品阶取外挂；未知品阶返回空数组 */
export function cheatsByQuality(quality) {
  const q = String(quality || '');
  if (!q) return [];
  return allCheats().filter((p) => p.quality === q);
}

/** 按名称模糊查（视图搜索用）；空关键词返回全部 */
export function searchCheats(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return allCheats();
  return allCheats().filter((p) => p.name.includes(k) || String(p.desc || '').includes(k));
}

/** 品阶分组（视图按 QUALITY_ORDER 渲染；组内按名称排序稳定） */
export function cheatsGroupedByQuality() {
  const groups = [];
  for (const q of QUALITY_ORDER) {
    const list = cheatsByQuality(q).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    if (list.length) groups.push({ quality: q, color: qualityColorOf(q), list });
  }
  return groups;
}

/** 概览统计（视图头部/设置页显示） */
export function vaultOverview() {
  const packs = allCheats();
  const byQuality = {};
  let chars = 0;
  for (const p of packs) {
    const q = String(p.quality || '未知');
    byQuality[q] = (byQuality[q] || 0) + 1;
    chars += Number(p.chars) || 0;
  }
  return { total: packs.length, chars, byQuality };
}

/**
 * 装配清单归一：去重 + 丢未知 id + 上限截断。
 * 顺序**保持调用方给的次序**（先装的排在前面，注入时也按此序，便于用户预期）。
 * @param {string[]} ids
 * @param {{limit?:number}} [opts]
 * @returns {{ids:string[], dropped:string[], truncated:string[]}}
 */
export function sanitizeInstalled(ids, opts) {
  const limit = Math.max(INSTALL_MIN, Math.min(INSTALL_MAX, Number(opts?.limit) || INSTALL_MIN));
  const list = Array.isArray(ids) ? ids : [];
  const seen = new Set();
  const kept = [];
  const dropped = [];
  const truncated = [];
  for (const raw of list) {
    const id = String(raw || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!getCheatById(id)) { dropped.push(id); continue; }  // 未知 id 如实丢弃并可上报
    if (kept.length >= limit) { truncated.push(id); continue; }
    kept.push(id);
  }
  return { ids: kept, dropped, truncated };
}

/**
 * 装配清单的字数合计（视图实时反馈「当前注入多少字」，让用户自己判断负担）。
 * 未知 id 不计入（不猜其长度）。
 */
export function installedChars(ids) {
  const list = Array.isArray(ids) ? ids : [];
  let chars = 0;
  let count = 0;
  for (const id of list) {
    const p = getCheatById(id);
    if (!p) continue;
    chars += Number(p.chars) || 0;
    count += 1;
  }
  return { count, chars };
}

/**
 * 生成侧注入块：把已装配外挂的正文交给生成侧，让正文里的权能效果就是用户装的那几个。
 * 空清单返回 ''（不产生空块），与 place/worldpulse 的 promptBlock 同规格。
 * @param {string[]} ids 装配清单（本函数内部会再归一一次，调用方传脏数据也不炸）
 * @param {{settings?:object}} [opts]
 */
export function buildCheatPromptBlock(ids, opts) {
  try {
    const s = { ...defaultCheatSettings(), ...(opts?.settings || {}) };
    if (!s.injectToPrompt) return '';
    const { ids: kept } = sanitizeInstalled(ids, { limit: s.maxInstall });
    if (!kept.length) return '';
    const parts = kept.map((id) => {
      const p = getCheatById(id);
      if (!p) return '';
      const head = `〔${p.quality}·${p.name}〕`;
      return `${head}\n${String(p.content || '').trim()}`;
    }).filter(Boolean);
    if (!parts.length) return '';
    const header = '【当前外挂】以下权能是{{user}}已经获得的既定事实，除剧情中被明确剥夺外始终生效：';
    return header + '\n\n' + parts.join('\n\n');
  } catch (_e) {
    return ''; // 注入失败绝不阻断生成
  }
}

/**
 * 抽卡侧道具表：把外挂映射成幸运转盘认得的道具结构。
 * 每个包的 weight 直接取品阶权重、stackable=false / unique=true（外挂是唯一权能，不该叠成 ×N）。
 */
export function cheatGachaItems() {
  return allCheats().map((p) => ({
    id: cheatItemId(p.id),
    name: p.name,
    type: '外挂',
    quality: p.quality,
    description: String(p.desc || '').trim(),
    weight: (QUALITY_META[p.quality] || QUALITY_META['普通']).weight,
    stackable: false,
    unique: true,
    grantQuantity: 1,
    rewardTarget: 'inventory',
    poolTags: ['pool_cheat'],
  }));
}

/** 卡池定义（供 gacha-data 合并；includeInAll=false：外挂不进「全部」混杂池，避免污染既有概率） */
export function cheatGachaPool() {
  return {
    id: 'pool_cheat',
    name: '万界武库',
    builtin: false,
    includeInAll: false,
    order: 6,
  };
}

export default {
  QUALITY_META,
  QUALITY_ORDER,
  INSTALL_MIN,
  INSTALL_MAX,
  defaultCheatSettings,
  allCheats,
  getCheatById,
  cheatsByQuality,
  cheatsGroupedByQuality,
  searchCheats,
  vaultOverview,
  sanitizeInstalled,
  installedChars,
  buildCheatPromptBlock,
  cheatGachaItems,
  cheatGachaPool,
  cheatItemId,
  cheatPackIdOfItem,
};