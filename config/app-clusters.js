/* ============================================================
 * config/app-clusters.js — 应用聚合表（唯一真源）[v4.92.0]
 * ------------------------------------------------------------
 * 为什么存在（用户原话：「APP 怎么聚合？我要缩减数量，很多都用不到，
 *   质量太差，不如聚合起来」）：
 *   桌面 89 个 App 平铺早已失控（v4.87.0 曾把 20 个留在桌面、其余收进应用库，
 *   但「应用库」仍是一个列表，没有「按用途聚合」的层级）。本表把呈现层再收一层：
 *   桌面 = 8 个核心 App + 7 个聚合壳（cluster）= 15 格，89 项功能全部保留在壳内。
 *
 * 为什么是「聚合壳」而不是「删 App」：
 *   · R1 双向覆盖（scripts/registry-audit.mjs）要求 APPS id 集合与懒加载分支
 *     互为子集 —— 删 id = 路由孤儿 + 用户已落盘数据变孤儿；
 *   · 用户已存的聊天记录/日记/账本都挂在具体 appId 下，删不得。
 *   故本表只改**呈现归属**（哪个壳收哪个 App），不动任何 id/路由/存储键。
 *
 * 与 app-library.js 的关系：本表的聚合类目**复用** APP_LIBRARY_CATEGORIES 的
 *   7 类目（social/content/creative/life/money/body/system），壳 id 与类目 id
 *   一一对应，只是把「类目」从「应用库列表的分组标题」提升为「桌面上的像素文件夹」。
 *   8 核心仍走 CORE_APP_IDS（不进任何壳），桌面只铺这两族。
 * ============================================================ */
import { APP_LIBRARY_CATEGORIES } from './app-library.js';

/** 桌面核心 App（不进聚合壳，直接平铺）。顺序即桌面顺序。 */
export const CORE_DESKTOP_IDS = Object.freeze([
    'wechat', 'honey', 'phone', 'diary', 'album', 'calendar', 'games', 'settings'
]);

/** 类目 → 像素文件夹底色（16 色盘内，视觉区分但同族）。 */
const CLUSTER_BG = Object.freeze({
    social: '#5d7fa6',   // 蓝
    content: '#8a5636',  // 棕
    creative: '#f77b8f', // 粉
    life: '#9de64e',     // 浅绿
    money: '#f9e14e',    // 黄
    body: '#d93744',     // 红
    system: '#7d8590'    // 灰
});

/** 7 个聚合壳（壳 id = 类目 id；图标色取色盘，视觉统一）。
 *  iconBg/iconFg 是像素文件夹的底/线条色（16 色盘内）。 */
export const APP_CLUSTERS = Object.freeze(
    APP_LIBRARY_CATEGORIES.map(c => ({
        id: c.id,
        name: c.name,
        hint: c.hint,
        iconBg: CLUSTER_BG[c.id] || '#5d7fa6',
        iconFg: '#1a1c2c'
    }))
);

/** 聚合壳在桌面上的呈现标记（伪 appId 前缀，绝不与真 appId 冲突）。 */
export const CLUSTER_ID_PREFIX = '__cluster_';

/** 该 appId 是否核心桌面 App（不进壳）。 */
export function isCoreDesktop(appId) {
    return CORE_DESKTOP_IDS.includes(String(appId || ''));
}

/** 该 App 属于哪个聚合壳（核心返回 null；未归类的归 system，同 app-library 口径）。 */
export function clusterOf(app, categoryResolver) {
    const id = String(app?.id || '');
    if (isCoreDesktop(id)) return null;
    const cat = (app && app.libraryCategory)
        || (typeof categoryResolver === 'function' ? categoryResolver(id) : null)
        || 'system';
    return CLUSTER_ID_PREFIX + cat;
}

/** 由类目 id 取聚合壳定义（含像素色）。 */
export function clusterByCategory(catId) {
    return APP_CLUSTERS.find(c => c.id === String(catId || '')) || null;
}

/** 把一组已 decorate 的 App 装配成桌面呈现序列：
 *  返回 [...8 核心 App, ...7 个聚合壳伪对象]。壳伪对象带 isCluster=true，
 *  渲染层据此走「文件夹」分支（打开聚合壳弹窗而非直接开 App）。 */
export function buildDesktopTiles(apps) {
    const all = Array.isArray(apps) ? apps : [];
    const cores = CORE_DESKTOP_IDS
        .map(id => all.find(a => a && a.id === id))
        .filter(Boolean);
    const shells = APP_CLUSTERS.map(cat => {
        const members = all.filter(a => a && !isCoreDesktop(a.id) &&
            (a.libraryCategory || 'system') === cat.id);
        return {
            id: CLUSTER_ID_PREFIX + cat.id,
            clusterOf: cat.id,
            name: cat.name,
            hint: cat.hint,
            iconBg: cat.iconBg,
            memberCount: members.length,
            members,
            isCluster: true,
            zone: 'desktop'
        };
    }).filter(sh => sh.memberCount > 0);
    return [...cores, ...shells];
}