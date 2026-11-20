#!/usr/bin/env node
/* ============================================================
 * tools/design-debt-check.mjs — 设计债门禁（两个仓库通用，零依赖）v2
 * v2 变更：
 *   · inline 不再统计 `.style.setProperty('--xxx', …)`：写自定义属性是 token 管线（动态取色、滑杆进度、FLIP 坐标），
 *     不是绕过设计系统的内联样式；写普通属性（.style.color = / setProperty('color', …)）照旧计入。
 *   · 新增第 5 项 blur：backdrop-filter 声明数（-webkit- 前缀副本不重复计）。毛玻璃很贵，v2 只允许走 --lt-mat-* / --rp-mat-* 材质 token，
 *     数量同样只降不升。旧基线文件里没有 blur 时该项只报告、不参与 --ci 比较（不会让老基线突然失败）。
 * ------------------------------------------------------------
 * 统计四项指标，只允许下降、不允许上升：
 *   colors     写死的颜色字面量（#hex / rgb() / rgba() / hsl() / hsla()）
 *              —— token 定义文件（*tokens*.css、themes/*.css）与 `--x: …` 自定义属性声明行不计入
 *   important  !important 次数
 *   inline     内联样式：HTML/模板里的 style="…"、JS 里的 .style.xxx = / .style.cssText / setProperty
 *   tinyFont   小于 11px 的 font-size（含 JS 字符串里的 font-size:9px）
 *
 * 用法：
 *   node tools/design-debt-check.mjs                     # 扫描当前仓库，打印报告
 *   node tools/design-debt-check.mjs css apps phone      # 只扫描指定目录 / 文件
 *   node tools/design-debt-check.mjs --json              # 机器可读输出
 *   node tools/design-debt-check.mjs --top=20            # 列出债务最多的 20 个文件
 *   node tools/design-debt-check.mjs --update-baseline   # 写入 .design-debt-baseline.json
 *   node tools/design-debt-check.mjs --ci                # 与基线比较，任一指标上升则退出码 1
 * 建议在 package.json 里加："check:design": "node tools/design-debt-check.mjs --ci"
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (k) => args.includes(`--${k}`);
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const targets = args.filter(a => !a.startsWith('--'));
const ROOT = process.cwd();
const BASELINE = path.join(ROOT, opt('baseline', '.design-debt-baseline.json'));

const EXT = new Set(['.css', '.js', '.mjs', '.html', '.htm']);
const SKIP_DIR = new Set(['.versions', 'node_modules', '.git', 'dist', 'build', 'coverage', 'tests', 'test', '__tests__', '.agents', 'docs', 'tools', 'scripts']);
const isTokenFile = (rel) => /(^|\/)(?:[\w-]*tokens?[\w-]*\.css|themes\/[\w-]+\.css)$/i.test(rel);

const RE = {
    hex: /(?<![\w&$-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
    fn: /\b(?:rgba?|hsla?)\(\s*[\d.]+%?[\s,]+[\d.]+%?[\s,]+[\d.]+%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)/g,
    important: /!\s*important\b/gi,
    inlineAttr: /\sstyle\s*=\s*["'`]/g,
    inlineJs: /\.style\.(?:cssText\s*=|setProperty\s*\(\s*(?!['"`]--)|[a-zA-Z]+\s*=(?!=))/g,
    blur: /(?<![-\w])backdrop-filter\s*:/gi,
    tinyFont: /font-size\s*:\s*(\d+(?:\.\d+)?)px/gi,
};

function stripComments(text, ext) {
    // 只去掉块注释和行首 // 注释；足够应对统计用途
    let t = text.replace(/\/\*[\s\S]*?\*\//g, '');
    if (ext !== '.css') t = t.replace(/^\s*\/\/.*$/gm, '');
    return t;
}

export function measure(text, ext, rel = '') {
    const t = stripComments(text, ext);
    const count = (re) => (t.match(re) || []).length;
    const tokenFile = isTokenFile(rel);
    let colors = 0;
    if (!tokenFile) {
        // 自定义属性的声明行（--x: #fff）本身就是 token 定义，不算写死
        const t2 = t.replace(/^\s*--[\w-]+\s*:[^;]*;?/gm, '');
        // HTML 实体 &#123; 由负向后顾排除；#phone-panel 这类 id 选择器含非十六进制字母，不会命中
        colors = (t2.match(RE.hex) || []).length + (t2.match(RE.fn) || []).length;
    }
    let tinyFont = 0;
    for (const m of t.matchAll(RE.tinyFont)) if (parseFloat(m[1]) < 11) tinyFont++;
    const inline = ext === '.css' ? 0 : count(RE.inlineAttr) + count(RE.inlineJs);
    // blur：-webkit-backdrop-filter 被负向后顾排除；token 定义行（--x: blur(…)）不含 "backdrop-filter:"，天然不计
    return { colors, important: count(RE.important), inline, tinyFont, blur: count(RE.blur) };
}

function walk(p, out) {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
        if (SKIP_DIR.has(path.basename(p)) && p !== ROOT) return;
        for (const f of fs.readdirSync(p)) walk(path.join(p, f), out);
    } else if (EXT.has(path.extname(p).toLowerCase()) && !/\.min\.(js|css)$/.test(p) && !/\.legacy\.css$/.test(p)) {
        out.push(p);
    }
}

export const METRICS = ['colors', 'important', 'inline', 'tinyFont', 'blur'];

export function scan(paths) {
    const files = [];
    (paths.length ? paths : [ROOT]).forEach(p => walk(path.resolve(ROOT, p), files));
    const perFile = {};
    const total = { colors: 0, important: 0, inline: 0, tinyFont: 0, blur: 0, files: 0 };
    for (const f of files) {
        const rel = path.relative(ROOT, f).split(path.sep).join('/');
        const m = measure(fs.readFileSync(f, 'utf8'), path.extname(f).toLowerCase(), rel);
        if (m.colors + m.important + m.inline + m.tinyFont + m.blur === 0) continue;
        perFile[rel] = m;
        total.files++;
        for (const k of METRICS) total[k] += m[k];
    }
    return { total, perFile };
}

// #cli-start
if (process.argv[1] && /design-debt-check\.mjs$/.test(process.argv[1])) {
    const { total, perFile } = scan(targets);
    const LABEL = { colors: '写死颜色', important: '!important', inline: '内联样式', tinyFont: '<11px 字号', blur: '毛玻璃' };

    if (flag('json')) {
        console.log(JSON.stringify({ total, perFile }, null, 2));
    } else {
        const top = +opt('top', 10);
        const score = (m) => m.colors + m.important * 2 + m.inline + m.tinyFont * 3 + m.blur;
        const rows = Object.entries(perFile).sort((a, b) => score(b[1]) - score(a[1])).slice(0, top);
        console.log('\n设计债报告  ' + new Date().toISOString().slice(0, 10));
        console.log('──────────────────────────────────────────────');
        for (const k of Object.keys(LABEL)) console.log(`  ${LABEL[k].padEnd(10)} ${String(total[k]).padStart(7)}`);
        console.log(`  涉及文件    ${String(total.files).padStart(7)}`);
        console.log(`\n债务最多的 ${rows.length} 个文件（颜色 / !important / 内联 / 小字号 / 毛玻璃）：`);
        for (const [f, m] of rows) console.log(`  ${String(m.colors).padStart(5)} ${String(m.important).padStart(5)} ${String(m.inline).padStart(5)} ${String(m.tinyFont).padStart(4)} ${String(m.blur).padStart(4)}  ${f}`);
    }

    if (flag('update-baseline')) {
        fs.writeFileSync(BASELINE, JSON.stringify({ updatedAt: new Date().toISOString(), total }, null, 2) + '\n');
        console.log(`\n[OK] 基线已写入 ${path.relative(ROOT, BASELINE)}`);
    }

    if (flag('ci')) {
        if (!fs.existsSync(BASELINE)) { console.error(`\n[FAIL] 找不到基线 ${path.relative(ROOT, BASELINE)}，先运行 --update-baseline`); process.exit(1); }
        const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).total;
        const compared = Object.keys(LABEL).filter(k => typeof base[k] === 'number');   // 旧基线没有的指标只报告
        const worse = compared.filter(k => total[k] > base[k]);
        const better = compared.filter(k => total[k] < base[k]);
        for (const k of Object.keys(LABEL)) {
            if (!compared.includes(k)) { console.log(`  ${LABEL[k].padEnd(10)} 基线   (无) -> 现在 ${String(total[k]).padStart(6)}  （下次 --update-baseline 后纳入棘轮）`); continue; }
            const d = total[k] - base[k];
            console.log(`  ${LABEL[k].padEnd(10)} 基线 ${String(base[k]).padStart(6)} -> 现在 ${String(total[k]).padStart(6)}  ${d > 0 ? '+' + d : d < 0 ? String(d) : '='}`);
        }
        if (worse.length) { console.error(`\n[FAIL] 设计债上升：${worse.map(k => LABEL[k]).join('、')}。请改用 token / 工具类，或说明原因后更新基线。`); process.exit(1); }
        if (better.length) console.log('\n[OK] 设计债下降，记得运行 --update-baseline 把新基线提交上去（棘轮只降不升）。');
        else console.log('\n[OK] 未上升。');
    }
}
// #cli-end
