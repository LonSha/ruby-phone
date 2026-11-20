#!/usr/bin/env node
/* ============================================================
   gen-legacy-layer.mjs — 把根 phone.css 包进 @layer rp.legacy
   ------------------------------------------------------------
   为什么需要这一步：
     rp-entry.css 用 @layer 声明了层序（reset < tokens < legacy < base < components <
     apps < themes < user）。旧 phone.css 是「未分层」的，未分层规则天然压过任何 @layer，
     皮肤（rp.components / rp.apps）永远赢不了它。所以把旧样式**搬进 rp.legacy**，
     顺序问题交给层序解决，而不是靠加特异性或 !important 打架。

   两个必要的改写：
     1. `!important` 全部去掉：层内声明不需要靠它抢优先级，留着反而会盖住皮肤。
     2. 相对 url(...) 加 `../` 前缀：文件从仓库根搬到 phone/design/ 下，引用图片的
        相对路径要跟着上一级，否则图标 / 壁纸全部 404。

   为什么文件名是 legacy-phone.css（而不是 phone-legacy.css）：
     全仓「App 样式前缀唯一」那组判据（system-v3260 C6 / v3280 E4 / F4 / H4 …）把
     「前缀只出现在本 App 目录与 phone.css」当作不撞车的定义 —— 一张全局表有第二份落点
     不算撞（同一个词两个主人，里面另有各 App 自己的前缀）。本产物逐字就是根 phone.css
     的分层副本，所以沿用那个既有口径把名字落在 *phone.css 上，而不是去动判据把豁免放宽：
     放宽会让「多挂了别人的前缀」也假绿，那正是它要拦的东西。

   用法：node scripts/gen-legacy-layer.mjs [--check]
     不带参数：写 phone/design/legacy-phone.css
     --check：只比对，漂移则退出码 1（可接 CI / npm run check）
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const SRC = path.join(ROOT, 'phone.css');
const OUT = path.join(ROOT, 'phone', 'design', 'legacy-phone.css');

const raw = fs.readFileSync(SRC, 'utf8');

/* 1) !important：层内不需要 */
const noBang = raw.replace(/\s*!\s*important/gi, '');

/* 2) 相对 url：上移一级（跳过 data: / http(s): / 绝对路径 / 纯锚点 / var()） */
const fixed = noBang.replace(/url\((\s*)(['"]?)([^'")]+)\2(\s*)\)/g, (m, sp, q, p, sp2) => {
    if (/^(data:|https?:|\/|#|var\()/i.test(p)) return m;
    return `url(${sp}${q}../${p}${q}${sp2})`;
});

const header = `/* 自动生成，请勿手改 —— 源：phone.css
   生成器：scripts/gen-legacy-layer.mjs
   层：rp.legacy（旧样式整体下沉；已去 !important，相对 url 已上移一级）
   手工调整请改 phone.css 后重跑生成器。 */
@layer rp.legacy {
`;

const out = header + fixed.replace(/\n?$/, '\n') + '}\n';

if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== out) {
        console.error('[gen-legacy-layer] phone/design/legacy-phone.css 与源不一致：重跑 node scripts/gen-legacy-layer.mjs');
        process.exit(1);
    }
    console.log('[gen-legacy-layer] 一致');
} else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, out);
    console.log('[gen-legacy-layer] 写入 phone/design/legacy-phone.css %d KB（源 %d 行）',
        Math.round(out.length / 1024), raw.split('\n').length);
}