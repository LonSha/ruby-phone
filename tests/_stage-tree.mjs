// tests/_stage-tree.mjs — 临时文件树：**自动补齐相对导入依赖**（[v4.106.0 · R13-O4 顺手治的存量债]）
//
// 【它治的形态】
//   本仓多套件用 `stageTree({...})` 手工列出要放进临时树的文件。这份清单是**手写**的，
//   于是每新增一个跨模块依赖，老套件就会在负控制用例里抛
//   `ERR_MODULE_NOT_FOUND`（副本上少一件模块）——判据表面在验「破坏后必须转红」，
//   实际上验的是「临时树没装全」。v4.104.0 引入 `config/recycle-bin.js` 后，
//   system-v290（2 红）/ system-v292（1 红）/ system-v3410（7 红）就是这样红的。
//
// 【为什么不能靠「再多抄几行」】
//   手写清单永远落后一步：本版又给四个数据层加了 `config/time-source.js`，
//   下一次还会加。故这里改成**按源码里的相对 import 递归补齐**：
//   套件只列出「被测的那几个文件」，其余依赖从真仓原样复制。
//
// 【纪律】
//   · 只复制**相对路径**的 import（`./` 或 `../`）；裸包名不碰（本仓零依赖）；
//   · 不覆盖调用方显式给出的内容（破坏副本优先）；
//   · 递归有上限（防环）；找不到的依赖**不静默跳过**，而是记进 `missing` 供套件断言。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 从源码里抽相对 import 的说明符（静态 import / 动态 import / export ... from）。 */
export function relativeSpecifiers(src) {
    const out = new Set();
    const push = (spec) => {
        const s = String(spec || '').trim();
        if (!s.startsWith('./') && !s.startsWith('../')) return;
        out.add(s.split('?')[0]);
    };
    /* import ... from '...'  /  export ... from '...' */
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) push(m[1]);
    /* import '...'（副作用导入） */
    for (const m of src.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) push(m[1]);
    /* import('...') 动态导入 */
    for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
    return Array.from(out);
}

/**
 * 把 `files`（rel → 内容）写进一个新的临时树，并把它们的相对 import 依赖从真仓补齐。
 *
 * @param {Record<string,string>} files 显式给出的文件（相对仓库根、正斜杠）
 * @param {{root?:string, prefix?:string, maxDepth?:number}} [opts]
 *        root    —— 真仓根（默认：本文件所在目录的上一级）
 *        prefix  —— 临时目录名前缀（便于识别是哪个套件留下的）
 *        maxDepth—— 依赖递归上限
 * @returns {{dir:string, missing:string[], copied:string[]}}
 */
export function stageTreeWithDeps(files, opts = {}) {
    const root = opts.root || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const prefix = opts.prefix || 'stage-tree-';
    const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 12;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

    const written = new Set();
    const missing = [];
    const copied = [];

    const writeRel = (rel, content) => {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        written.add(rel);
    };

    for (const [rel, content] of Object.entries(files)) writeRel(rel, content);

    /* 队列式补齐：每写进一个文件，就看它引用了谁 */
    let queue = Array.from(written);
    for (let depth = 0; depth < maxDepth && queue.length > 0; depth += 1) {
        const next = [];
        for (const rel of queue) {
            const abs = path.join(dir, rel);
            let src = '';
            try { src = fs.readFileSync(abs, 'utf8'); } catch (_e) { continue; }
            for (const spec of relativeSpecifiers(src)) {
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
                if (written.has(target)) continue;
                const realAbs = path.join(root, target);
                if (!fs.existsSync(realAbs)) {
                    /* 不静默跳过：本仓的模块都是实体文件，找不到就是真缺东西。
                     *   但要在**这里**记下来让套件自己决定（有些套件故意验证缺依赖行为）。 */
                    if (!missing.includes(target)) missing.push(target);
                    written.add(target);          // 防同一缺失项反复入队
                    continue;
                }
                writeRel(target, fs.readFileSync(realAbs, 'utf8'));
                copied.push(target);
                next.push(target);
            }
        }
        queue = next;
    }

    return { dir, missing, copied };
}
