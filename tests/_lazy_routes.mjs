/* ============================================================
 * tests/_lazy_routes.mjs — 懒加载路由表 → 判据面装载视图（共享单源）
 *   [v3.61.0 · 计划 O6]
 * ------------------------------------------------------------
 * 为什么需要（**本版 O6 重构的直接产物，实测不是推演**）：
 *   phone:openApp 处理器把 67 段「结构上完全同构」的懒加载五件套
 *   （instrumentImport → 单例 new → render → catch）从 index.js 搬进了
 *   config/app-lazy-routes.js 的单源表。
 *   代码的扫描面变了，**判据的扫描面没跟着走** —— 40 个套件里 57 处
 *   「index.js 必须有懒加载分支」全数落空，造出「真功能在跑、判据判不到」
 *   的假红。本仓口径：**扫描面口径必须跟着代码走**。
 *
 * 做法：把表行**渲染回**重构前的内联分支文本，与 index.js 里真正内联的
 *   14 个分支拼成「装载后的路由面」，判据改读这个面。
 *   渲染形与重构前的五件套**逐字同构**（缩进 / 字段顺序 / 文案拼接都一样），
 *   故判据只需换数据源，不必逐条改写断言 —— 这才是「同一口径只留一份」。
 *
 * 为什么不是放水（与 dead-export 门同一纪律）：
 *   · 表解析不到 >= MIN_ROWS 行 ⇒ fail-closed 抛（拒判），不静默返回空面；
 *     否则「表被删了」会变成「所有路由判据一起变绿」，比假红更伤。
 *   · 渲染只认表里**真有的字段**（id/module/key/cls/errTitle 五样齐备才渲染），
 *     缺字段的行整行跳过并计数，不凭空造 id。
 *   · 表里没有的 id（14 个有真实差异逻辑的内联分支：settings / wechat /
 *     diary / phone / music / weibo / honey / mofo / wangxiang / games /
 *     album / calendar / lexiscore / graph）由真 index.js 原文提供。
 *
 * 用法（在 *.test.mjs 内）：
 *   import { routeSurface, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';
 *   const idx = routeSurface(read('index.js'), read(LAZY_ROUTE_TABLE_REL));
 * ============================================================ */

/** 表文件相对仓库根的路径（dead-export 门认的同一个文件）。 */
export const LAZY_ROUTE_TABLE_REL = 'config/app-lazy-routes.js';

/** 表行数下限：低于它即视为表被删/结构漂移，fail-closed 拒判。 */
export const MIN_ROWS = 60;

/** 解析表原文 → [{ id, module, key, cls, errTitle }]。
 *  只认**五字段齐备**的行；字段缺失的行跳过并计入 `skipped`（挂在校验器上）。 */
export function parseLazyRoutes(tableSrc) {
    if (typeof tableSrc !== 'string' || !tableSrc.length) return [];
    const rows = [];
    const re = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*module:\s*['"]([^'"]+)['"]\s*,\s*key:\s*['"]([^'"]+)['"]\s*,\s*cls:\s*['"]([^'"]+)['"]\s*,\s*errTitle:\s*['"]([^'"]+)['"]\s*\}/g;
    for (const m of tableSrc.matchAll(re)) {
        rows.push({ id: m[1], module: m[2], key: m[3], cls: m[4], errTitle: m[5] });
    }
    return rows;
}

/** 渲染一行 → 与重构前逐字同构的内联五件套文本。
 *  `errTitle` 是**标题**（不含「加载失败」后缀）：装配器自己拼
 *  `'❌ 加载' + errTitle + '失败:'` 与 `errTitle + '加载失败'`。 */
export function renderLazyBranch(row) {
    const { id, module: mod, key, cls, errTitle } = row;
    return [
        `                } else if (appId === '${id}') {`,
        `                    bootTiming.instrumentImport(import('${mod}'), '${mod}')`,
        `                        .then(module => {`,
        `                            if (!window.VirtualPhone.${key}) {`,
        `                                window.VirtualPhone.${key} = new module.${cls}(phoneShell, storage);`,
        `                            }`,
        `                            window.VirtualPhone.${key}.render();`,
        `                        })`,
        `                        .catch(err => {`,
        `                            console.error('❌ 加载${errTitle}失败:', err);`,
        `                            phoneShell?.showNotification('错误', '${errTitle}加载失败', '❌');`,
        `                        });`,
    ].join('\n');
}

/** 表行校验：结构漂移一律 fail-closed 抛（拒判，不静默降级）。
 *  返回 `{ rows, ids }`；`ids` 是去重后的 id 集合。 */
export function assertLazyRouteTable(tableSrc, minRows = MIN_ROWS) {
    const rows = parseLazyRoutes(tableSrc);
    if (rows.length < minRows) {
        throw new Error('[lazy-routes] 表解析异常：解析到 ' + rows.length + ' 行（低于下限 ' + minRows
            + '）—— 扫描面判定失效，fail-closed 拒判（表被删/字段漂移都会走到这里）');
    }
    const ids = new Set(rows.map((r) => r.id));
    return { rows, ids };
}

/** 判据面：index.js 内联分支 ∪ 渲染出的表分支。
 *  ★ 这是本模块唯一的出口 —— 套件不许自己拼一份（同一口径 40+ 份各自实现
 *    正是这一轮全量假红的成因）。
 *
 *  为什么渲染部分要包一层合成壳（`;(function () { … })();`）：
 *    渲染形与重构前的分支链逐字同构 —— 每条以 `} else if (appId === 'x') {` 起首，
 *    即「上一条的收尾」。这样拼在任意 index.js 后面都不是独立语句，语法不成立；
 *    而本仓多套件会把判据面**写进临时文件交给 `node --check` 验语法**
 *    （v3330/v3340/…/v3470 的 J2 破坏表自证）。故这里补一个 `if (false) {`
 *    的头与一个收尾 `}`，让整段成为合法 JS：链首 `}` 闭合 `if (false)`，
 *    链尾 `}` 闭合最后一条分支。壳本身不含任何 id、也不进任何断言的扫描面。 */
export function routeSurface(indexSrc, tableSrc) {
    const idx = typeof indexSrc === 'string' ? indexSrc : '';
    const { rows } = assertLazyRouteTable(tableSrc);
    if (!idx.length) {
        throw new Error('[lazy-routes] index.js 原文为空 —— 拒判');
    }
    const head = '\n;(function () {' + '\n    var appId = null;' + '\n    if (false) {';
    const tail = '\n    }' + '\n})();';
    return idx + head + '\n' + rows.map(renderLazyBranch).join('\n') + tail;
}

/** 面上的路由 id 集合（内联 + 表）。 */
export function routeIds(indexSrc, tableSrc) {
    const surface = routeSurface(indexSrc, tableSrc);
    const ids = new Set();
    for (const m of surface.matchAll(/appId === '([a-zA-Z0-9-]+)'/g)) ids.add(m[1]);
    return ids;
}

/* ── 便于套件一行接入的两个辅助（ROOT 由 import.meta.url 自解，套件不必自己算） ── */

import fs from 'node:fs';
import path from 'node:path';

/** 本仓根目录（tests/ 的上一级）。 */
export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** 读真仓的表原文。 */
export function readRepoTable() {
    return fs.readFileSync(path.join(REPO_ROOT, LAZY_ROUTE_TABLE_REL), 'utf8');
}

/** 包装一个「按相对路径读文件」的函数：读 index.js 时返回**判据面**（内联 ∪ 表）。
 *  · 副本树优先：若副本目录里存在表文件，就用副本的表（负控制破坏表时才判得出来）；
 *    否则回落真仓的表（破坏落在 index.js 上的老形态，表仍是真源）。
 *  · 只有 `index.js` 走这条通道，其余路径一字不动（本模块不做任何额外解释）。 */
export function withRouteSurface(readFn, rootDir) {
    const base = rootDir || REPO_ROOT;
    return (rel, ...rest) => {
        if (rel !== 'index.js') return readFn(rel, ...rest);
        const raw = readFn(rel, ...rest);
        const copyTable = path.join(base, LAZY_ROUTE_TABLE_REL);
        let table;
        if (path.resolve(base) !== path.resolve(REPO_ROOT) && fs.existsSync(copyTable)) {
            table = fs.readFileSync(copyTable, 'utf8');
        } else {
            table = readRepoTable();
        }
        return routeSurface(raw, table);
    };
}

/** 把表原文渲染成「装载后的路由面」的另一种取法：给定**表目录**，表缺席即回落真仓。 */
export function tableIn(dir) {
    const p = path.join(dir, LAZY_ROUTE_TABLE_REL);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : readRepoTable();
}
