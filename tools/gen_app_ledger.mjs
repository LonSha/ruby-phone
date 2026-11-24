/* ============================================================
 * tools/gen_app_ledger.mjs — App 重构台账**生成器**（口径 v2）
 * ------------------------------------------------------------
 * 【为什么需要这个文件】
 *   「20 版 60 只 App 重构」这个标题从 v4.191.0 起沿用了 8 个版本，
 *   但仓里**从来没有一份文件定义过「60 只」是哪 60 只**。
 *   磁盘实读是：`apps/` 下 **101 个目录**、`config/apps.js` 里 **105 条 id**。
 *
 * 【为什么 v4.200.0 要改口径】
 *   v4.199.0 立账时的口径是「目录下存在 `*-core.js`」。实测这个口径有两处硬伤：
 *     ① **假负**：v3.5x 时代落地的那批四件套，内核文件叫 `*-data.js`
 *        （`share-data.js` / `clock-data.js` / `chars-data.js` …）。它们与
 *        `-core.js` 是同一件东西的两个年代名字，按文件名记账会把 71 个
 *        四件齐备的目录记成「待重构」。
 *     ② **不可执行**：`待重构 93` 里混着两堆难度与病相完全不同的事 ——
 *        一堆是「内核文件根本没有」，另一堆是「内核在场但里面带 Date.now /
 *        Math.random / localStorage」。二者排在同一个数里，批次就无法排序。
 *
 *   所以 v2 把口径从「文件名」换成「**内核文件在场 + 内核静态纯度达标**」：
 *     · 内核文件 = 目录下的 `*-core.js` 或 `*-data.js`；
 *     · 纯度 = 剥注释与字符串后，内核里不出现 PURITY_BANS 里的任何符号；
 *     · 三态分开记：`refactored`（纯）/ `core_impure`（在场但不纯，带明细）/
 *       `no_core`（没有内核文件）。
 *   这不是放宽 —— 「不出现 Date.now」比「文件名叫 -core.js」严格得多
 *   （实测 `apps/health/medical-core.js` 名叫 core、也拿了数值门，但仍在
 *   v3.57.0 的十三处取数逃逸点清单里）。
 *
 * 【三条纪律（与 tools/gen_status_ledger.mjs 同源）】
 *   ① **未知不报 0**：数不出来一律 null，并在 unknown[] 里写为什么；
 *   ② **声明面为真源**：一个 App 算哪一态，只认本文件声明的判据，不猜「看起来像」；
 *   ③ **目录 ≠ App**：`apps/` 下的目录不全是 App（实测 7 个是内核散件，
 *      没有对应 id），`config/apps.js` 的 id 也不全有独立目录
 *      （实测 12 个是重构产出的子 App）。两本账分开记，不许合成一个数。
 *
 * 【这道判据的已知边界（不许后来者当成「已验收」）】
 *   它只证明「内核抽出来了、且内核里没直接碰时间/随机/DOM/存储/网络」。
 *   **不证明**：行为等价、接线完整、真机上跑对、以及「纯函数真的没被绕过」
 *   （例如控制器把 Date.now 算好再传进去，那是合法用法，本账不判）。
 *   此外纯度扫描会剥掉模板字符串 `${}` 之外的文本面 —— ${} 内部按代码扫，
 *   但字符串里拼出来的符号（如 'Math' + '.random'）扫不到，这是已知漏网。
 *
 * 用法：
 *   node tools/gen_app_ledger.mjs            # 打印 JSON 到 stdout
 *   node tools/gen_app_ledger.mjs --write    # 写入 tests/audit/app-refactor-ledger.json
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/**
 * 「内核文件」的两个年代名字（声明面，唯一口径）：
 *   `-core.js` = v4.191.0 起那批；`-data.js` = v3.5x 那批。
 *   两份都算「内核文件在场」，但**在场不等于已重构** —— 还要过纯度闸。
 */
export const CORE_MARKERS = Object.freeze(['-core.js', '-data.js']);

/** 兼容旧名（v4.199.0 的判据引用过它）：现在是两个标记拼起来的字符串。 */
export const REFACTORED_MARKER = CORE_MARKERS.join('|');

/**
 * 纯度闸：内核里**不许直接出现**的符号。
 * 判据口径：不是「不许有这样的逻辑」，而是「不许存在内核自己取时间/随机/碰宿主」
 * —— 时间与随机必须由调用方传入（本仓 v3.51.0 起的四件套就是没做到这一条）。
 */
export const PURITY_BANS = Object.freeze([
    { key: 'Date.now', re: /\bDate\s*\.\s*now\s*\(/g },
    { key: 'new Date', re: /\bnew\s+Date\s*\(/g },
    { key: 'Math.random', re: /\bMath\s*\.\s*random\s*\(/g },
    { key: 'document', re: /\bdocument\s*\./g },
    { key: 'window', re: /\bwindow\s*\./g },
    { key: 'localStorage', re: /\blocalStorage\b/g },
    { key: 'sessionStorage', re: /\bsessionStorage\b/g },
    { key: 'setTimeout', re: /\bsetTimeout\s*\(/g },
    { key: 'setInterval', re: /\bsetInterval\s*\(/g },
    { key: 'fetch', re: /\bfetch\s*\(/g }
]);

/** 列目录下的 .js 文件（不含子目录）。 */
function listJs(dirAbs) {
    try { return fs.readdirSync(dirAbs).filter((n) => n.endsWith('.js')).sort(); }
    catch (_e) { return []; }
}

/** 递归统计一个目录的 .js 文件数与总物理行数。 */
function measure(dirAbs) {
    let files = 0;
    let lines = 0;
    const stack = [dirAbs];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
        catch (_e) { continue; }
        for (const e of entries) {
            const p = path.join(cur, e.name);
            if (e.isDirectory()) { stack.push(p); continue; }
            if (!e.name.endsWith('.js')) continue;
            files += 1;
            try { lines += fs.readFileSync(p, 'utf8').split('\n').length; }
            catch (_e) { /* 读不到的文件不计行数，但计入文件数（两个数不许互相冒充） */ }
        }
    }
    return { files, lines };
}

/**
 * 剥注释与字符串字面量，只留代码面（纯度扫描用）。
 * 模板字符串的 `${...}` **按代码保留**（不然表达式里的 Date.now 会被当成文本漏掉）；
 * 其余文本面一律抹成空，避免「注释里提了一句 Math.random」被算成副作用。
 */
export function stripForPurity(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let mode = 'code';
    const stack = [];
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (mode === 'code') {
            if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
            if (c === "'") { mode = 'sq'; i += 1; out += ' '; continue; }
            if (c === '"') { mode = 'dq'; i += 1; out += ' '; continue; }
            if (c === '`') { mode = 'tmpl'; i += 1; out += ' '; continue; }
            if (c === '{' && stack.length && stack[stack.length - 1] === 'tmpl') { stack.push('brace'); out += c; i += 1; continue; }
            if (c === '}' && stack.length && stack[stack.length - 1] === 'brace') { stack.pop(); mode = 'tmpl'; i += 1; out += ' '; continue; }
            out += c; i += 1; continue;
        }
        if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } i += 1; continue; }
        if (mode === 'block') {
            if (c === '*' && d === '/') { mode = 'code'; i += 2; continue; }
            if (c === '\n') out += '\n';
            i += 1; continue;
        }
        if (mode === 'sq' || mode === 'dq') {
            const q = mode === 'sq' ? "'" : '"';
            if (c === '\\') { i += 2; continue; }
            if (c === q) { mode = 'code'; }
            i += 1; continue;
        }
        /* mode === 'tmpl'：文本面跳过，遇到 ${ 进代码面 */
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { mode = 'code'; i += 1; continue; }
        if (c === '$' && d === '{') { stack.push('tmpl'); mode = 'code'; i += 2; out += ' ' + '{'; continue; }
        i += 1; continue;
    }
    return out;
}

/** 扫一个内核文件的副作用面。返回 { Date.now: 2, ... }（空对象 = 纯）。 */
export function scanImpurities(src) {
    const code = stripForPurity(String(src || ''));
    const hits = {};
    for (const ban of PURITY_BANS) {
        const re = new RegExp(ban.re.source, 'g');
        const m = code.match(re);
        if (m && m.length) hits[ban.key] = m.length;
    }
    return hits;
}

function isCoreFile(name) { return CORE_MARKERS.some((m) => name.endsWith(m)); }

/**
 * 现场取数。返回一份可序列化的账。
 *
 * 三本账分开记（不许合成一个「App 总数」）：
 *   · dirs      ：`apps/` 下的目录（磁盘实读）
 *   · ids       ：`config/apps.js` 的 id 条数
 *   · overlap   ：两边都在的（真 App）
 *   · dir_only  ：有目录无 id（内核散件，不是独立 App）
 *   · id_only   ：有 id 无目录（重构产出的子 App）
 */
export function collectAppLedger() {
    const unknown = [];
    const appsDir = path.join(ROOT, 'apps');
    let dirNames = null;
    try {
        dirNames = fs.readdirSync(appsDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
    } catch (_e) {
        unknown.push('apps/ 读不到，目录清单为 null');
        dirNames = [];
    }

    /* ── config/apps.js 的 id 条数 ──
     * 口径与 tools/gen_status_ledger.mjs 的 scale.apps_ids 一致：
     *   只数 `^\s*id:\s*'` 行首形（那条正则同时被浏览器场景 A1 用）。
     *   两处取数必须同源，否则「101 个目录 / 105 条 id」这句话自己在两处打架。 */
    let ids = null;
    let idList = null;
    try {
        const src = fs.readFileSync(path.join(ROOT, 'config/apps.js'), 'utf8');
        idList = (src.match(/^\s*id:\s*'([^']+)'/gm) || [])
            .map((line) => (/^\s*id:\s*'([^']+)'/.exec(line) || [])[1]);
        ids = idList.length;
        if (ids === 0) { ids = null; unknown.push('config/apps.js 里 id 条数解析为 0（口径可能变了），如实记 null'); }
    } catch (_e) {
        unknown.push('config/apps.js 读不到，id 条数为 null');
    }

    /* ── 逐目录实读 ── */
    const dirSet = new Set(dirNames);
    const rows = dirNames.map((name) => {
        const abs = path.join(appsDir, name);
        const js = listJs(abs);
        const cores = js.filter(isCoreFile);
        const impurities = {};
        const impureFiles = [];
        for (const f of cores) {
            let src = '';
            try { src = fs.readFileSync(path.join(abs, f), 'utf8'); }
            catch (_e) { unknown.push('内核文件读不到，纯度未判：apps/' + name + '/' + f); continue; }
            const hits = scanImpurities(src);
            if (Object.keys(hits).length) { impurities[f] = hits; impureFiles.push(f); }
        }
        const hasCore = cores.length > 0;
        const pure = hasCore && impureFiles.length === 0;
        const state = !hasCore ? 'no_core' : (pure ? 'refactored' : 'core_impure');
        const m = measure(abs);
        return {
            dir: name,
            js_files: m.files,
            js_lines: m.lines,
            core_files: cores,
            state,
            refactored: pure,
            impurities,
            has_app_id: idList ? idList.includes(name) : null,
        };
    });

    const refactored = rows.filter((r) => r.state === 'refactored');
    const impure = rows.filter((r) => r.state === 'core_impure');
    const noCore = rows.filter((r) => r.state === 'no_core');
    const pending = rows.filter((r) => r.state !== 'refactored');

    return {
        schema: 'app-refactor-ledger@2',
        generated_by: 'tools/gen_app_ledger.mjs',
        /* 判据口径的唯一声明处 —— 后来者改这里，判据跟着变，不许只改一处 */
        refactor_marker: REFACTORED_MARKER,
        purity_bans: PURITY_BANS.map((b) => b.key),
        refactor_marker_note: '已重构 = 目录下存在 *-core.js 或 *-data.js **且**该内核剔注释与字符串后不出现 purity_bans 里的任何符号。'
            + '三态互斥：refactored（内核纯）/ core_impure（内核在场但不纯）/ no_core（无内核文件）；pending = 后两态之和。'
            + 'js_lines 为该目录全部 .js 行数合计，不是单个文件；settings 的 config/phone-color-face.js 属跨 App 复用纯函数族，与 apps/<dir>/*-core.js 不同层，不计入本判据。'
            + '只证明内核抽出且未直接取时间/随机/碰宿主，不证明行为等价 / 接线完整 / 真机跑对',
        scale: {
            app_dirs: dirNames === null ? null : dirNames.length,
            apps_ids: ids,
            /* 两本账的差不许合成一个数，但可以把差集列出来供人看。
             * ★ dir_only 必须拿 idList 比，不是拿 dirSet 比自己（那恒为空数组，是假账）；
             *   id_only 同理，必须拿真清单比。两个差集都是磁盘实读。 */
            dir_only: idList ? dirNames.filter((d) => !idList.includes(d)) : null,
            id_only: idList ? idList.filter((i) => !dirSet.has(i)) : null,
        },
        counts: {
            refactored: refactored.length,
            core_impure: impure.length,
            no_core: noCore.length,
            pending: pending.length,
            total_dirs: rows.length,
        },
        refactored_dirs: refactored.map((r) => r.dir),
        core_impure_dirs: impure.map((r) => r.dir),
        no_core_dirs: noCore.map((r) => r.dir),
        pending_dirs: pending.map((r) => r.dir),
        rows,
        unknown,
        unknown_count: unknown.length,
    };
}

/* ── CLI ── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const out = collectAppLedger();
    const text = JSON.stringify(out, null, 2) + '\n';
    if (process.argv.includes('--write')) {
        const dest = path.join(ROOT, 'tests/audit/app-refactor-ledger.json');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text);
        console.log(`[app-ledger] 已写入 ${path.relative(ROOT, dest)} —— 目录 ${out.counts.total_dirs} / 已重构 ${out.counts.refactored} / 内核不纯 ${out.counts.core_impure} / 无内核 ${out.counts.no_core} / unknown=${out.unknown_count}`);
    } else {
        process.stdout.write(text);
    }
}
