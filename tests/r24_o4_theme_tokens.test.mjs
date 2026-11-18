// tests/r24_o4_theme_tokens.test.mjs — R24-O4 判据：主题令牌接线
// 硬门槛：默认深色与基线逐项相等；亮色下每个真实 App 主色对比度 ≥4.5:1；导出导入往返字节等价。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SEMANTIC_TOKENS, APPEARANCE_TOKENS, DARK_BASELINE, MIN_CONTRAST,
    contrastRatio, createTheme, exportTheme, importTheme, themeTokensSelfCheck
} from '../config/theme-tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const appsSrc = fs.readFileSync(path.join(root, 'config/apps.js'), 'utf8');
const colors = {};
[...appsSrc.matchAll(/id:\s*'([a-z0-9_-]+)'[^}]*?color:\s*'(#[0-9a-fA-F]{6})'/g)].forEach((m) => { colors[m[1]] = m[2]; });
ok('从 apps.js 取到真实主色', Object.keys(colors).length >= 20);

const dark = createTheme({ mode: 'dark', appColors: colors });
const light = createTheme({ mode: 'light', appColors: colors });
ok('深色令牌 = 冻结基线（逐项）', SEMANTIC_TOKENS.concat(APPEARANCE_TOKENS).every((k) => dark.token(k) === DARK_BASELINE[k]));
ok('默认深色 surface 未变', dark.token('surface') === '#0f1115');
ok('全部 App 主色可派生（无非法值）', dark.invalid.length === 0);
ok('每 App 四档齐（base/hover/pressed/muted/onAccent）', Object.keys(dark.palette).every((k) => {
    const p = dark.palette[k];
    return p.base && p.hover && p.pressed && p.muted && p.onAccent;
}));
ok('亮色对比度全部 ≥4.5（可计算，不目测）', light.checkContrast().ok === true);
ok('对比度最低值确实 ≥ 阈值', Object.keys(light.palette).every((k) => light.palette[k].contrast >= MIN_CONTRAST));
ok('WCAG 计算正确（白/黑 = 21）', contrastRatio('#ffffff', '#000000') === 21);
ok('非法色返回 null 对比度', contrastRatio('nope', '#000000') === null);

const custom = createTheme({ mode: 'dark', overrides: { accent: '#ff0055' } });
ok('自定义令牌只改自己', custom.token('accent') === '#ff0055' && custom.token('surface') === DARK_BASELINE.surface);
ok('未知令牌被拒（安全导入）', createTheme({ mode: 'dark', overrides: { onload: 'x' } }).rejected[0] === 'unknown-token:onload');

const text = exportTheme(dark);
const back = importTheme(text);
ok('导出可导入', back.ok === true);
ok('往返令牌等价', back.ok && JSON.stringify(back.theme.toJSON().tokens) === JSON.stringify(dark.toJSON().tokens));
ok('导出字节稳定', exportTheme(dark) === text);
ok('坏包拒收', importTheme('{"schema":"other"}').ok === false && importTheme('nope').ok === false);
ok('自检绿', themeTokensSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/theme-tokens.js'"));
ok('接线：桥表真登记 _r24O4', indexSrc.includes("'_r24O4'") || indexSrc.includes('["_r24O4"') || indexSrc.includes("['_r24O4'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);