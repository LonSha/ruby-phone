/* audit-orphan-modules.mjs — 找出「文件存在但生产侧无人引用」的模块
 * ---------------------------------------------------------------
 * 为什么需要它：本仓有 15 个 phone/ 引擎长期零引用（文件在、有单测、能力为零），
 *   靠人眼是发现不了的 —— 每个文件看起来都「正常」。本工具把这种死代码变成
 *   一条可回归的判据。
 *
 * 两档口径（关键设计：不能混为一谈）：
 *   [DEAD]   生产代码与测试都没引用 → 纯死文件，应当删除或接线；
 *   [TESTONLY] 只有 tests/ 引用、生产侧零消费 → 文件活着但能力为零，
 *            这是本仓历史病灶的典型形态（有测试所以 CI 永远绿，实际从未被调用）。
 *
 * 「被引用」判据（宁严勿滥，一次判到位）：
 *     1. 静态 / 动态 import、new URL(...).href、含 `?v=xxx` 查询串；
 *     2. 清单类文件用字符串路径登记（本仓 app 是懒加载的：
 *        config/app-lazy-routes.js 的 `module: "./apps/x/x-app.js"` 是唯一引用点，
 *        只看 import 会把这 100+ 个 app 全判死 —— 这是本工具第一版的真实误报）；
 *     3. 文件名（去扩展名）作为独立标识符出现（word 边界，防 a11y 之类子串误命中）。
 *
 * 排除目录：tests/ tools/ scripts/ docs/ workers/ node_modules/ .git/ .agents/
 *   —— 这些是被执行/被阅读的入口，不是被依赖的模块。
 *   注意 tests/ 不参与「生产侧引用」判定，但它单独构成 TESTONLY 这一档的证据。
 *
 * 用法：node tools/audit-orphan-modules.mjs [根] [--strict]
 *   --strict：存在 [DEAD] 项时以退出码 1 结束（TESTONLY 只报告不阻断）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const STRICT = process.argv.includes('--strict');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests', 'tools', 'scripts', 'docs', 'workers', 'dist', 'build', '.github', '.agents']);
const ENTRY = new Set(['index.js']);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(path.join(dir, e.name), out);
        } else if (/\.(m?js)$/.test(e.name)) {
            out.push(path.join(dir, e.name));
        }
    }
    return out;
}
/* 测试目录单独收集：它们不算生产引用，但算「有人知道这个文件存在」的证据 */
function walkTests(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkTests(p, out);
        else if (/\.(m?js)$/.test(e.name)) out.push(p);
    }
    return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const text = new Map(files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));
const testFiles = walkTests(path.join(ROOT, 'tests'));
const testText = new Map(testFiles.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));

function matchers(relPath) {
    const baseNoExt = path.basename(relPath).replace(/\.m?js$/, '');
    const esc = baseNoExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
        /* 路径字符串形态：'.../name.js'、'.../name.js?v=1'、import(\`./x/name\`) */
        reString: new RegExp(`['"\`][^'"\`\\n]*\\/${esc}(?:\\.m?js)?(?:\\?[^'"\`]*)?['"\`]`),
        /* 标识符形态 */
        reIdent: new RegExp(`(^|[^\\w$-])${esc}([^\\w$-]|$)`),
    };
}
function findIn(map, relPath) {
    const { reString, reIdent } = matchers(relPath);
    for (const [other, src] of map) {
        if (other === relPath) continue;
        if (reString.test(src) || reIdent.test(src)) return other;
    }
    return null;
}

/* 纯转发兼容层：整个文件的实质代码只有 `export ... from './x.js'`。
 * 这类文件的归宿是「被删掉、调用方直连真实模块」，不是「等接线」——
 * 把它们混进 TESTONLY 会让人以为还有 42 个能力没接，实际是 2 个迁移尾巴。
 * 判据：去掉注释与空行后 ≤2 行，且每行都以 export/import 开头并含 from。 */
function isForwardOnly(relPath) {
    const src = text.get(relPath) || '';
    const code = src.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
    if (code.length === 0 || code.length > 2) return false;
    return code.every(l => /^(export|import)\b/.test(l) && /\bfrom\s+['"]/.test(l));
}

/* 白名单：确有用途但不由引用关系体现（每条写明理由） */
const ALLOWLIST = new Map([
    ['index.js', '宿主入口，由 SillyTavern manifest 加载'],
    ['config/diff-review-pipeline.js', '被 .agents 文档与人工评审流程使用，非运行时依赖'],
]);

const dead = [];
const testOnly = [];
const forwardOnly = [];
for (const f of files) {
    const r = rel(f);
    if (ENTRY.has(r) || ALLOWLIST.has(r)) continue;
    if (findIn(text, r)) continue;              // 生产侧有人引用
    if (isForwardOnly(r)) { forwardOnly.push(r); continue; }   // 转发层：待删除/直连
    const t = findIn(testText, r);              // 生产侧零引用，看测试
    if (t) testOnly.push(`${r}   ← 仅 ${t}`);
    else dead.push(r);
}

console.log('='.repeat(78));
console.log('[AUDIT] 孤儿模块扫描（生产侧引用缺口）');
console.log(`仓库根：${ROOT}   参与判定文件数：${files.length}   测试文件数：${testFiles.length}`);
console.log('='.repeat(78));

if (dead.length === 0) {
    console.log('\n✅ [DEAD] 无：不存在「连测试都没引用」的死文件。');
} else {
    console.log(`\n❌ [DEAD] ${dead.length} 个死文件（生产与测试都零引用，应删除或接线）：`);
    for (const o of dead) console.log('  - ' + o);
}
if (testOnly.length === 0) {
    console.log('\n✅ [TESTONLY] 无：不存在「只有测试引用、生产零消费」的模块。');
} else {
    console.log(`\n⚠️  [TESTONLY] ${testOnly.length} 个模块只被测试引用（CI 常绿但能力为零，应接线）：`);
    for (const o of testOnly) console.log('  - ' + o);
}
if (forwardOnly.length === 0) {
    console.log('\n✅ [FORWARD] 无：不存在纯转发的兼容残留。');
} else {
    console.log(`\n🧹 [FORWARD] ${forwardOnly.length} 个纯转发兼容层（不是能力缺口，应删除并让调用方直连真模块）：`);
    for (const o of forwardOnly) console.log('  - ' + o);
}
console.log(`\n汇总：DEAD=${dead.length}  TESTONLY=${testOnly.length}  FORWARD=${forwardOnly.length}`);
process.exit(STRICT && dead.length > 0 ? 1 : 0);