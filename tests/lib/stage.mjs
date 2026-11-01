/* ============================================================
 * tests/lib/stage.mjs — 暂存树的静态闭包补齐（判据基建，不是被测件）
 *
 * 【为什么需要这一层（真实现场，三次复发都是同一个形状）】
 *   好几套负控制会在 /tmp 里造一棵只含“本判据关心的那几件”的暂存树，
 *   在副本上做真源码破坏，然后 import 副本。树里没列到的同库依赖，
 *   一旦被测件后来新增了一个 import，立刻变成 ERR_MODULE_NOT_FOUND。
 *   而它报的不是“你应该补哪个依赖”，而是“模块找不到”，看起来像被测件坏了。
 *   实测复发三段：
 *     · v3.58.0 给 calendar-app 加会话栅栏（session-gate / num-gate）
 *     · v4.41.0 / v4.44.0 加周期契约与群投票交接
 *     · v4.105.0 给多个视图加 config/destructive-confirm.js
 *     · v4.104.0 给多个 data/app 加 config/recycle-bin.js
 *   每次都是在“判据批量转红”的时候才被发现，而真因不在判据里。
 *
 * 【本模块做什么】
 *   只做一件事：把暂存树里**已经出现过的模块**的**静态 import 闭包**从真仓拷齐。
 *   它不决定“该拷哪几件”（那是各判据自己的事），只解决“拷了的那几件
 *   它们的依赖也得在”，从而把“漏拷依赖”从一类红灯降成零类。
 *
 * 【边界（如实写）】
 *   · 只认静态 import / export-from（与 scripts/lib/binding-consumption.mjs 同口径）：
 *     不解析动态 import() 与拼接说明符；仓内实测未用于暂存树。
 *   · 不拷 ../ 开头的说明符（暂存树不模拟仓库外部）；仓内模块全为相对同库引用。
 *   · 不删不改已存在文件：已写入的破坏副本永远优先，本工具只**填空位**。
 *   · 拷不到（真仓也没有）就安静跳过 —— 让 ERR_MODULE_NOT_FOUND 继续响，
 *     不在此处伪造一个空壳抵消它（那会把真缺件洗白）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const RE_FROM = /(?:from|import)\s+['\"](\.[^'\"]+)['\"]/g;
const RE_EXPORT = /export\s+\*?\s*(?:as\s+\w+\s+)?from\s+['\"](\.[^'\"]+)['\"]/g;

function specsOf(src) {
    const out = [];
    let m;
    RE_FROM.lastIndex = 0;
    while ((m = RE_FROM.exec(src))) out.push(m[1]);
    RE_EXPORT.lastIndex = 0;
    while ((m = RE_EXPORT.exec(src))) out.push(m[1]);
    return out;
}

function relOf(fromRel, spec) {
    const bare = String(spec).split('?')[0].split('#')[0];
    if (!bare || !bare.startsWith('.')) return null;
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), bare));
    if (joined.startsWith('..')) return null;
    return joined;
}

/** 列出树内全部 .js（相对路径，posix 分隔符）。 */
function listJs(root, rel = '') {
    const abs = path.join(root, rel);
    const out = [];
    for (const name of fs.readdirSync(abs)) {
        const r = rel ? rel + '/' + name : name;
        const st = fs.statSync(path.join(root, r));
        if (st.isDirectory()) out.push(...listJs(root, r));
        else if (name.endsWith('.js')) out.push(r);
    }
    return out;
}

/**
 * 把暂存树里已存在模块的静态依赖从真仓补齐。
 * @param {string} dir   暂存树根
 * @param {string} repo  真仓根（默认由调用方传 path.resolve(...)）
 * @returns {{filled:string[], miss:string[]}} filled = 本次补的，miss = 真仓也没有的
 */
export function fillClosure(dir, repo) {
    if (!dir || !repo) throw new Error('fillClosure 需要 (dir, repo) 两个参数');
    const filled = [];
    const miss = [];
    const done = new Set();
    let queue = listJs(dir);
    while (queue.length) {
        const rel = queue.shift();
        if (done.has(rel)) continue;
        done.add(rel);
        const abs = path.join(dir, rel);
        if (!fs.existsSync(abs)) continue;
        const src = fs.readFileSync(abs, 'utf8');
        for (const spec of specsOf(src)) {
            const dep = relOf(rel, spec);
            if (!dep || !dep.endsWith('.js')) continue;
            if (done.has(dep)) continue;
            const inTree = path.join(dir, dep);
            if (!fs.existsSync(inTree)) {
                const inRepo = path.join(repo, dep);
                if (!fs.existsSync(inRepo)) { miss.push(dep); continue; }
                fs.mkdirSync(path.dirname(inTree), { recursive: true });
                fs.copyFileSync(inRepo, inTree);
                filled.push(dep);
            }
            queue.push(dep);
        }
    }
    return { filled, miss };
}

export default { fillClosure };
