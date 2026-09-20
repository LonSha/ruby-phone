/* ========================================================
 * dt-data.js — [v2.48.0] 撩语 · 语料内核（纯函数）
 *
 * 本模块**不碰 window / 不碰 storage / 不碰 DOM**，只做纯计算：
 *   选模块 → 装配校验 → 注入块组装 → 概览统计。
 *   状态读写与生成侧钩子都在 dt-app.js（控制器），视图在 dt-view.js。
 *
 * 三条纪律（与 cheat-data.js 同规格）：
 *   ① 只读：语料正文是内置静态事实源（data/dirtytalk.js），本模块绝不改写它；
 *   ② 不抛：任何畸形入参（null / 非数组 / 未知 id）一律降级为空结果，绝不 throw；
 *   ③ 不猜：未知 id、未知档位**如实丢弃或如实透传原值**，绝不编造模块顶替。
 *
 * 【与抽卡侧的契约】撩语在幸运转盘里以模块 id 自身（已带 `dt_` 前缀）作 itemId 入包
 *   （前缀唯一真源在 data/dirtytalk-index.js 的 DT_ITEM_PREFIX）。本模块 re-export
 *   这两个映射函数，避免抽卡侧与撩语侧各写一套前缀常量。
 *
 * 【抽卡品阶映射】扭蛋 QUALITY_META 只有神话/传说/史诗/稀有/优秀/普通六档，
 *   撩语的「轻/中/重」映射为 普通/优秀/稀有，否则上色与权重会塌进未知档。
 * ======================================================== */
'use strict';
import { dirtyTalkModules } from '../../data/dirtytalk.js';
import { dirtyTalkCorpus } from '../../data/dirtytalk-corpus.js';
import {
  dirtyTalkIndex,
  DT_TIER_META as TIER_META,
  DT_TIER_ORDER as TIER_ORDER,
  DT_CAT_ORDER as CAT_ORDER,
  DT_CAT_LABEL as CAT_LABEL,
  DT_STYLES,
  dtItemId,
  dtModuleIdOfItem,
} from '../../data/dirtytalk-index.js';

export { dtItemId, dtModuleIdOfItem, TIER_META, TIER_ORDER, CAT_ORDER, CAT_LABEL, DT_STYLES };

/** 撩语档位 → 扭蛋六档（只在抽卡映射处使用，App 内部仍用轻/中/重） */
export const DT_TIER_TO_QUALITY = Object.freeze({
  '重': '稀有',
  '中': '优秀',
  '轻': '普通',
});

/** 未知档位一律排到末位（不塌进任一已知档） */
export function tierOrderOf(t) {
  const m = TIER_META[t];
  return m ? m.order : TIER_ORDER.length + 1;
}
export function tierColorOf(t) {
  const m = TIER_META[t];
  return m ? m.color : '#64748b';
}

/** 装配上限的可调范围（设置页滑块） */
export const INSTALL_MIN = 1;
export const INSTALL_MAX = 8;

/** 设置默认值：键名必须匹配 config/storage.js 的 `/^dt_/`，否则跨会话串味 */
export function defaultDtSettings() {
  return {
    maxInstall: 4,        // 同时装配的模块数（1–8；语料比外挂轻，默认比金手指多一档）
    injectToPrompt: true, // 是否把已装配模块交给生成侧
    showDiagnostics: false,
  };
}

/** 全部模块（只读快照，防调用方就地排序污染事实源） */
export function allModules() {
  return Array.isArray(dirtyTalkModules) ? dirtyTalkModules.slice() : [];
}

/** 按 id 取模块；未知 id 返回 null（不猜、不造） */
export function getModuleById(id) {
  const k = String(id || '');
  if (!k) return null;
  return allModules().find((p) => p.id === k) || null;
}

/** 按档位取模块；未知档位返回空数组 */
export function modulesByTier(tier) {
  const t = String(tier || '');
  if (!t) return [];
  return allModules().filter((p) => p.tier === t);
}

/** 按类别取模块；未知类别返回空数组 */
export function modulesByCat(cat) {
  const c = String(cat || '');
  if (!c) return [];
  return allModules().filter((p) => p.cat === c);
}

/** 按名称/简介/类别模糊查（视图搜索用）；空关键词返回全部 */
export function searchModules(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return allModules();
  return allModules().filter((p) =>
    p.name.includes(k)
    || String(p.desc || '').includes(k)
    || String(p.label || '').includes(k)
    || String(p.cat || '').includes(k)
  );
}

/** 类别分组（视图按 CAT_ORDER 渲染；组内按档位再按名称排序稳定） */
export function modulesGroupedByCat() {
  const groups = [];
  for (const c of CAT_ORDER) {
    const list = modulesByCat(c).sort((a, b) => {
      const d = tierOrderOf(a.tier) - tierOrderOf(b.tier);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'zh');
    });
    if (list.length) groups.push({ cat: c, label: CAT_LABEL[c] || c, list });
  }
  return groups;
}

/** 概览统计（视图头部/设置页显示） */
export function vaultOverview() {
  const packs = allModules();
  const byCat = {};
  const byTier = {};
  let chars = 0;
  for (const t of TIER_ORDER) byTier[t] = modulesByTier(t).length;
  for (const p of packs) {
    const c = String(p.cat || '未知');
    byCat[c] = (byCat[c] || 0) + 1;
    chars += Number(p.chars) || 0;
  }
  return { total: packs.length, chars, byCat, byTier, styles: DT_STYLES.slice() };
}

/** 语料档概览（只读参考，不参与注入；让设置页能看见库里还有一份不注入的素材） */
export function corpusOverview() {
  const list = Array.isArray(dirtyTalkCorpus) ? dirtyTalkCorpus : [];
  let chars = 0;
  for (const p of list) chars += Number(p.chars) || 0;
  return { total: list.length, chars };
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
    if (!getModuleById(id)) { dropped.push(id); continue; }
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
    const p = getModuleById(id);
    if (!p) continue;
    chars += Number(p.chars) || 0;
    count += 1;
  }
  return { count, chars };
}

/**
 * 生成侧注入块：把已装配模块的正文交给生成侧，让说话方式就是用户装的那几个。
 * 空清单返回 ''（不产生空块），与 cheat/place/worldpulse 的 promptBlock 同规格。
 * @param {string[]} ids 装配清单（本函数内部会再归一一次，调用方传脏数据也不炸）
 * @param {{settings?:object}} [opts]
 */
/**
 * 场景联动关键词表（纯常量）：位置链片段 → 推荐风格。
 * 只匹配「场所名里出现了什么词」，不猜剧情；未命中返回空（不编推荐）。
 */
export const SCENE_STYLE_MAP = Object.freeze([
    { kw: ['街', '商场', '地铁', '餐厅', '餐馆', '咖啡', 'bar', 'KTV', '大厅', '广场', '超市', '夜市'], style: '高压', why: '公共场所，克制里带压迫' },
    { kw: ['卧室', '家里', '房间', '酒店', '浴室', '床', '客厅'], style: '甜撩', why: '私密空间，可以放开来哄' },
    { kw: ['办公室', '公司', '教室', '学校', '会议室', '图书馆'], style: '规训', why: '秩序感场所，压抑与放开的反差' },
    { kw: ['天台', '雨', '阳台', '夜', '傍晚', '河边', '海边'], style: '沉浸', why: '环境氛围浓，情绪先行' }
]);
/**
 * 场景联动：把「当前所在」的位置链映射成推荐风格（词库页顶部展示）。
 * 纯函数、不抛、零 window 依赖：位置链由调用方从 place 侧只读桥取出传入。
 * @param {string[]} chain 当前位置链（由粗到细，如 ['老城','钟楼','顶层']）
 * @param {{max?:number}} [opts]
 * @returns {{chain:string[], styles:Array<{name:string, why:string}>}}
 */
export function sceneStyleHints(chain, opts = {}) {
    const out = { chain: [], styles: [] };
    try {
        const segs = (Array.isArray(chain) ? chain : []).map((s) => String(s || '').trim()).filter(Boolean);
        out.chain = segs;
        if (!segs.length) return out;
        const max = Math.max(1, Number(opts.max) || 3);
        const joined = segs.join('|').toLowerCase();
        for (const rule of SCENE_STYLE_MAP) {
            if (out.styles.length >= max) break;
            const hit = rule.kw.some((k) => joined.includes(String(k).toLowerCase()));
            if (hit && !out.styles.some((s) => s.name === rule.style)) {
                out.styles.push({ name: rule.style, why: rule.why });
            }
        }
        return out;
    } catch (_e) { return out; }
}
export function buildDtPromptBlock(ids, opts) {
  try {
    const s = { ...defaultDtSettings(), ...(opts?.settings || {}) };
    if (!s.injectToPrompt) return '';
    const { ids: kept } = sanitizeInstalled(ids, { limit: s.maxInstall });
    if (!kept.length) return '';
    const parts = kept.map((id) => {
      const p = getModuleById(id);
      if (!p) return '';
      const head = `〔${p.label || p.cat}·${p.name}〕`;
      return `${head}\n${String(p.content || '').trim()}`;
    }).filter(Boolean);
    if (!parts.length) return '';
    const header = '【当前撩语】以下说话方式是{{user}}已经选定的既定风格，除剧情中被明确改口外始终生效：';
    return header + '\n\n' + parts.join('\n\n');
  } catch (_e) {
    return ''; // 注入失败绝不阻断生成
  }
}

/**
 * 抽卡侧道具表：把撩语模块映射成幸运转盘认得的道具结构。
 * 每个模块的 weight 直接取档位权重、stackable=false / unique=true（风格是唯一模块，不该叠成 ×N）。
 * quality 走六档映射（重→稀有 / 中→优秀 / 轻→普通），避免扭蛋 QUALITY_META 不认「轻/中/重」塌档。
 */
export function dtGachaItems() {
  /* 抽卡侧只读轻量索引，不把 686KB 正文拖进转盘 */
  const rows = Array.isArray(dirtyTalkIndex) ? dirtyTalkIndex : [];
  return rows.map((p) => ({
    id: dtItemId(p.id),
    name: p.name,
    type: '撩语',
    quality: DT_TIER_TO_QUALITY[p.tier] || '普通',
    description: String(p.desc || '').trim(),
    weight: (TIER_META[p.tier] || TIER_META['轻']).weight,
    stackable: false,
    unique: true,
    grantQuantity: 1,
    rewardTarget: 'inventory',
    poolTags: ['pool_dt'],
  }));
}

/** 卡池定义（供 gacha-data 合并；includeInAll=false：撩语不进「全部」混杂池，避免污染既有概率） */
export function dtGachaPool() {
  return {
    id: 'pool_dt',
    name: '撩语词库',
    builtin: false,
    includeInAll: false,
    order: 7,
  };
}

export default {
  TIER_META,
  TIER_ORDER,
  CAT_ORDER,
  CAT_LABEL,
  DT_STYLES,
  DT_TIER_TO_QUALITY,
  INSTALL_MIN,
  INSTALL_MAX,
  defaultDtSettings,
  allModules,
  getModuleById,
  modulesByTier,
  modulesByCat,
  modulesGroupedByCat,
  searchModules,
  vaultOverview,
  corpusOverview,
  sanitizeInstalled,
  installedChars,
  buildDtPromptBlock,
  dtGachaItems,
  dtGachaPool,
  dtItemId,
  dtModuleIdOfItem,
  tierOrderOf,
  tierColorOf,
};
