// tests/r24_x6_i18n.test.mjs — R24-X6 判据：中英双语最小闭环
// 硬门槛：两包键集合完全相等；缺键给 ⟪key⟫ 且只 warn 一次；切语言即时生效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, createI18n, keyDiff, i18nSelfCheck } from '../config/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const zh = JSON.parse(fs.readFileSync(path.join(root, 'i18n/zh-CN.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en-US.json'), 'utf8'));
const appsSrc = fs.readFileSync(path.join(root, 'config/apps.js'), 'utf8');

const diff = keyDiff(zh, en);
ok('两包键集合完全相等（zh 侧无缺）', diff.missingInA.length === 0);
ok('两包键集合完全相等（en 侧无缺）', diff.missingInB.length === 0);
ok('两包都非空', Object.keys(zh).length > 20 && Object.keys(en).length === Object.keys(zh).length);
ok('英文包无中文残留（可扫）', !/[\u4e00-\u9fff]/.test(Object.values(en).join('|')));

const nameKeys = Object.keys(zh).filter((k) => /^app\.[^.]+\.name$/.test(k));
ok('App 名走同一出口（键齐）', nameKeys.length >= 10);
ok('每个 App 名键都有对应真实 App', nameKeys.every((k) => appsSrc.includes("id: '" + k.split('.')[1] + "'")));

const warns = [];
const t = createI18n({ packs: { 'zh-CN': zh, 'en-US': en }, warn: (m) => warns.push(m) });
ok('中文取词', t.t('app.wechat.name') === '微信');
ok('App 名走 t()', t.appName('album') === '相册');
t.setLanguage('en-US');
ok('切英文即时生效', t.t('app.wechat.name') === 'WeChat' && t.appName('album') === 'Album');
ok('空态文案也走 t()', t.appEmptyText('album') === 'No photos yet');
ok('缺键 = ⟪key⟫（不是空串）', t.t('app.nothing.name') === '⟪app.nothing.name⟫');
t.t('app.nothing.name');
ok('同一缺键只 warn 一次', warns.filter((w) => w.includes('app.nothing.name')).length === 1);
ok('缺键不静默（确有 warn）', warns.length === 1);
t.setLanguage('zh-CN');
ok('切回中文即时生效', t.t('app.wechat.name') === '微信');
ok('三态语言登记', Object.keys(LANGUAGES).length === 3 && typeof LANGUAGES.auto === 'string');
ok('auto 跟随宿主', createI18n({ packs: { 'zh-CN': zh, 'en-US': en }, language: 'auto', hostLocale: 'en-US' }).resolveLanguage() === 'en-US');
ok('自检绿', i18nSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/i18n.js'"));
ok('接线：桥表真登记 _r24X6', indexSrc.includes("'_r24X6'") || indexSrc.includes('["_r24X6"') || indexSrc.includes("['_r24X6'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);