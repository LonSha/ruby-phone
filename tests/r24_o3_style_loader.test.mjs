// tests/r24_o3_style_loader.test.mjs — R24-O3 判据：样式懒加载与启动预算
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    STYLE_DEFAULTS, planStyleShards, createStyleLoader, budgetReport, styleLoaderSelfCheck
} from '../config/style-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('基线总字节登记（717587）', STYLE_DEFAULTS.totalBytes === 717587);
ok('关键片名单登记', STYLE_DEFAULTS.criticalParts.length >= 3);

const apps = [{ id: 'wechat', weight: 40 }, { id: 'album', weight: 10 }, { id: 'weather', weight: 1 }];
const plan = planStyleShards({ apps });
ok('拆片总数不变（片 + 关键片 ≤ 总量）', Object.keys(plan.shards).reduce((s, k) => s + plan.shards[k], 0) + plan.criticalBytes <= plan.totalBytes);
ok('关键片单列', plan.criticalBytes === STYLE_DEFAULTS.criticalBytes);
ok('体重分配合理', plan.shards.wechat > plan.shards.album && plan.shards.album > plan.shards.weather);
ok('取整余量可复算', plan.roundingSlack >= 0 && plan.roundingSlack < apps.length);

const loader = createStyleLoader({ shards: plan.shards, criticalBytes: plan.criticalBytes, totalBytes: plan.totalBytes });
ok('首屏只有关键片', loader.isLoaded('__critical__') && !loader.isLoaded('wechat'));
ok('离屏 App 未加载 CSS（负控制）', Object.keys(plan.shards).every((id) => !loader.isLoaded(id)));
const open = loader.load('wechat');
ok('打开 App 才注入', open.ok && open.injected[0] === 'wechat.css');
ok('再次打开走缓存', loader.load('wechat').cached === true);
ok('注入字节 < 整包', loader.stats().injectedBytes < loader.stats().totalBytes);
ok('省下的字节可复算', loader.stats().avoidedBytes === loader.stats().totalBytes - loader.stats().injectedBytes);

const rep = budgetReport(
    { coldInteractiveMs: 900, firstScreenBytes: 717587, firstAppOpenMs: 120 },
    { coldInteractiveMs: 780, firstScreenBytes: 48000, firstAppOpenMs: 135 }
);
ok('三读数都在', rep.rows.length === 3);
ok('差值可复算', rep.rows.every((r) => r.delta === r.after - r.before));
ok('写清变快的部分', rep.improved.join(',') === 'coldInteractiveMs,firstScreenBytes');
ok('写清没变的部分（首帧 App 打开）', rep.unchanged.join(',') === 'firstAppOpenMs' && rep.headline.indexOf('未变') !== -1);
ok('自检绿', styleLoaderSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/style-loader.js'"));
ok('接线：桥表真登记 _r24O3', indexSrc.includes("'_r24O3'") || indexSrc.includes('["_r24O3"') || indexSrc.includes("['_r24O3'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);