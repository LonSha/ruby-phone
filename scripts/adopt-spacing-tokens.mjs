#!/usr/bin/env node
/* ============================================================
 * scripts/adopt-spacing-tokens.mjs — 把已存在的 4px 间距网格真正用起来
 * ------------------------------------------------------------
 * 【为什么】`phone/design/lonsha-tokens.css` 里 `--lt-sp-0..16` 是标准 4px 网格
 *   （sp-1=4 … sp-16=64，12 档），但实测全仓 `var(--lt-sp-*` 引用次数 **0** ——
 *   网格建好了没人用，间距全是手写 px。判据抓不到这件事：
 *   手写 16px 与 var(--lt-sp-4) 计算值相同，没有任何一条规则「写错了」。
 *
 * 【做法】只做**取值等价**的字面量替换：某条间距属性的值必须完全由 px 字面量组成、
 *   每个字面量恰好落在 4px 网格上，才替换。带 auto / % / calc() / var() / 负值 /
 *   小数的整条跳过。⇒ 计算值逐字不变，视觉零风险（可证明，不是「应该没事」）。
 *
 * 【等价性证明】替换后把 token 按网格还原成 px，必须与原文逐字相等；有一条对不上就中止不写盘。
 *
 * 【在 4px 网格外的值不硬塞】实测 phone-components-v3.css 的 98 个间距 px 里，
 *   只有 42 个（43%）落在网格上，其余是 14/10/6/18/2/1/3 —— 真实节奏是 **2px 基准**，
 *   4px 网格表达不了。这部分**不动**：把 6px 塞进 8px 的档里就是视觉改动，
 *   需要设计决策（补 2px 半步档），不是脚本能自作主张的。
 *
 * 【已收编面不许回退】`--check`：目标文件里再出现「可收编的间距字面量」即 exit 1。
 *
 * 用法：
 *   node scripts/adopt-spacing-tokens.mjs            # 迁移并打印证据
 *   node scripts/adopt-spacing-tokens.mjs --check    # 只校验，不写盘
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* 已收编面：只碰组件层（rp.components）。legacy-phone.css 是生成产物，绝不碰。 */
const TARGETS = [
    'phone/design/phone-components-v3.css',
    'phone/design/app-skins-common-v3.3.css',
];

/* 4px 网格：与 tokens 里的 --lt-sp-* 逐档对应（改这里必须同步 tokens） */
const GRID = new Map([
    [4, '1'], [8, '2'], [12, '3'], [16, '4'], [20, '5'], [24, '6'],
    [32, '8'], [40, '10'], [48, '12'], [56, '14'], [64, '16'],
]);

const PROP_RE = /([;{]\s*)((?:padding|margin)(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g;
const GRID_LIST = [...GRID.keys()].sort((a, b) => a - b);

/** 注释等长替换成空格：索引不变，正则不会命中注释里的样例 */
function maskComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function tokenFor(px) {
    const unit = GRID.get(px);
    return unit ? 'var(--lt-sp-' + unit + ')' : null;
}

/** 整值可等价替换时返回 token 串，否则 null */
function convertValue(value) {
    const raw = value.trim();
    if (!raw) return null;
    if (/[()%]/.test(raw)) return null;
    if (/(^|[\s,])-/.test(raw)) return null;
    if (/\b(auto|inherit|initial|unset|revert|none)\b/i.test(raw)) return null;
    const parts = raw.split(/\s+/);
    if (parts.length > 4) return null;
    const out = [];
    for (const p of parts) {
        /* 多值里裸写的 0 等价于 --lt-sp-0；单值 margin:0 / padding:0 保持字面量更好读 */
        if (p === '0' && parts.length > 1) {
            out.push('var(--lt-sp-0)');
            continue;
        }
        const m = /^(\d+)px$/.exec(p);
        if (!m) return null;
        const t = tokenFor(Number(m[1]));
        if (!t) return null;
        out.push(t);
    }
    return out.join(' ');
}

function resolveBack(value) {
    return value.replace(/var\(--lt-sp-0\)/g, '0').replace(/var\(--lt-sp-(\d+)\)/g, (_a, unit) => {
        for (const [px, u] of GRID) if (u === unit) return px + 'px';
        return '__UNRESOLVED__';
    });
}

function analyse(src) {
    const masked = maskComments(src);
    const out = [];
    let m;
    PROP_RE.lastIndex = 0;
    while ((m = PROP_RE.exec(masked)) !== null) {
        const [all, pre, prop, value] = m;
        const valueStart = m.index + pre.length + (all.length - pre.length - value.length);
        out.push({ prop, value, pre, valueStart, valueEnd: valueStart + value.length });
    }
    return out;
}

function transform(src) {
    const decls = analyse(src);
    const proofs = [];
    const skipped = [];
    const edits = [];
    for (const d of decls) {
        const conv = convertValue(d.value);
        if (!conv) {
            const nums = d.value.trim().split(/\s+/).filter((p) => /^\d+px$/.test(p));
            if (nums.length) skipped.push(d.prop + ': ' + d.value.trim());
            continue;
        }
        const back = resolveBack(conv).replace(/\s+/g, ' ');
        const before = d.value.trim().replace(/\s+/g, ' ');
        proofs.push({ prop: d.prop, before, after: conv, back, ok: before === back });
        edits.push({ start: d.valueStart, end: d.valueEnd, with: conv });
    }
    /* 从后往前替换，索引不失效 */
    let text = src;
    for (const e of edits.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, e.start) + e.with + text.slice(e.end);
    }
    return { text, converted: edits.length, proofs, skipped, decls: decls.length };
}

function gridHistogram(src) {
    const decls = analyse(src);
    const hist = new Map();
    let total = 0;
    let onGrid = 0;
    for (const d of decls) {
        for (const p of d.value.trim().split(/\s+/)) {
            const m = /^(\d+)px$/.exec(p);
            if (!m) continue;
            total += 1;
            const n = Number(m[1]);
            if (GRID.has(n)) onGrid += 1;
            hist.set(n, (hist.get(n) || 0) + 1);
        }
    }
    const top = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([n, c]) => n + 'px×' + c).join(' ');
    return { total, onGrid, top };
}

function main() {
    const checkOnly = process.argv.includes('--check');
    let totalConverted = 0;
    let badProof = 0;

    for (const rel of TARGETS) {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
            console.error('[spacing] 找不到 ' + rel + ' —— 结构漂移');
            process.exit(2);
        }
        const before = fs.readFileSync(abs, 'utf8');
        const hist = gridHistogram(before);
        const r = transform(before);
        const failed = r.proofs.filter((p) => !p.ok);
        badProof += failed.length;

        console.log('[spacing] ' + rel);
        console.log('    间距声明 ' + r.decls + ' 条 / px 值 ' + hist.total
            + ' 个，其中在 4px 网格上 ' + hist.onGrid + ' 个'
            + '（分布：' + (hist.top || '无') + '）');
        console.log('    可等价替换 ' + r.converted + ' 处 / 网格外跳过 ' + r.skipped.length + ' 处');

        if (failed.length) {
            console.error('  ✗ 等价性证明失败（还原后与原文不一致，拒绝写盘）：');
            for (const f of failed.slice(0, 5)) {
                console.error('    ' + f.prop + ' 原文=' + f.before + ' 还原=' + f.back);
            }
            process.exit(2);
        }
        if (checkOnly) {
            if (r.converted > 0) {
                console.error('  ✗ 已收编面回退：仍有 ' + r.converted + ' 处可收编的间距字面量');
            }
        } else if (r.converted > 0) {
            fs.writeFileSync(abs, r.text, 'utf8');
        }
        totalConverted += r.converted;
    }

    console.log('[spacing] ' + (checkOnly ? '校验' : '迁移')
        + '：可替换合计 ' + totalConverted + ' 处；等价性证明 '
        + (badProof === 0 ? '全部通过（还原后逐字等于原文）' : badProof + ' 条失败'));
    if (checkOnly) process.exit(totalConverted === 0 && badProof === 0 ? 0 : 1);
    process.exit(badProof === 0 ? 0 : 2);
}

main();