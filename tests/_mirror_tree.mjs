/* ============================================================
 * tests/_mirror_tree.mjs — 镜像一棵树：容忍「瞬态文件在复制途中消失」[v3.23.0]
 * ------------------------------------------------------------
 * 为什么需要（**实测缺陷，不是推演**）：
 *   `fs.cpSync(src, dest, { recursive: true })` 对每个条目**先 lstat 再 copyDir**。
 *   若某个文件在「readdir 拿到名字」之后、「lstat」之前被别的东西删掉，就抛
 *       ENOENT: no such file or directory, lstat '<file>'
 *   而报错点指向一个用户从没听说过的临时文件名。实测栈（全量门禁 v3.23.0 首跑）：
 *       Error: ENOENT: ... lstat '.../tests/audit/.tmp_v315_probe_1790708298427.js'
 *         at getStats (node:internal/fs/cp/cp-sync:64:19)
 *         at copyDir (node:internal/fs/cp/cp-sync:176:9)
 *   肇事者是 `tests/system-v315.test.mjs` 的 N1 负控制：它**必须**往被快照的树里
 *   写一个探针文件再删掉（判据观测的就是「快照比对能抓到新增文件」），所以不能靠
 *   「让探针文件搬到仓外」来消 —— 它搬出 tests/audit/ 之后漂移就不在被快照的树里了。
 *
 * 这不是偶发环境抖动，而是一次真·竞态 —— 而且**可确定性复现**：
 *   `filter` 回调在 lstat **之前**被调用，所以在 filter 里把源文件删掉，下一次 lstat
 *   必抛 ENOENT（本仓实测：`RESULT=threw code=ENOENT sawB=true`）。
 *   该复现器被 `tests/system-v3230.test.mjs` 用作**真负控制**（破坏 copyTreeSafe
 *   的容忍分支 ⇒ 同款判据必须转红）。
 *
 * 为什么容忍是对的（而不是「吞错」）：
 *   · 镜像类测试要观察的是「门禁在退化输入上的行为」，**不是**「仓库在那一瞬间的
 *     文件集合」。为一条瞬态竞态让整个套件转红，是**把测量误差当成了测量结果**。
 *   · 被容忍的只是 ENOENT（且只重试有限次）。其它错误码立即抛出；重试耗尽仍抛出
 *     —— 真·持续失败必须看得见。对不存在的 src 调用会照样抛 ENOENT（三向自证之一）。
 *   · 受影响的树（含 tests/ 或 assets/）与那些瞬态文件无关：**差集为空才是正确结果**，
 *     一条无关的临时文件不该让它变成「红」。
 *
 * 用法（在 *.test.mjs 内）：
 *   import { copyTreeSafe } from './_mirror_tree.mjs';
 *   copyTreeSafe(ROOT, dir, { filter: (s) => !s.split(path.sep).includes('.git') });
 *   opts.filter 与 `fs.cpSync` 同义（返回 false 即跳过该条目）。
 *
 * 口径（可被机器复核）：**同一块代码只留一份**。这条纪律在本仓已有三个独立实现
 *（v314 的 cpWithRetry / v323 手写 copyTree 的 try-catch / v3171 裸 cpSync 无防护），
 * 第四个实现是「同一件事被写了四次、其中一次忘了」。故上收为本模块，全部镜像点引用它。
 * ============================================================ */
import fs from 'node:fs';

/** fs.cpSync 的瞬态容忍版：ENOENT 时清掉半成品重试，最多 4 次；其它错误立即抛。 */
export function copyTreeSafe(src, dest, opts = {}) {
    const userFilter = typeof opts.filter === 'function' ? opts.filter : null;
    const cpOpts = Object.assign({}, opts, {
        recursive: true,
        filter: userFilter ? (p) => Boolean(userFilter(p)) : undefined,
    });
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            fs.cpSync(src, dest, cpOpts);
            return;
        } catch (e) {
            if (e === null || typeof e !== 'object' || e.code !== 'ENOENT') throw e;
            lastErr = e;
            /* 首次可能只建了一半：清掉再试，否则残留会让下一次 copy 撞 EEXIST/ENOTEMPTY */
            try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_e2) { /* 忽略 */ }
        }
    }
    throw lastErr;
}
