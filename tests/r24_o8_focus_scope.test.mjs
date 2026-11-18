// tests/r24_o8_focus_scope.test.mjs — R24-O8 判据：键盘与焦点
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FOCUS_LAYERS, FOCUS_KEYS, createFocusScope, runKeys, focusStyleFor, focusScopeSelfCheck
} from '../config/focus-scope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('三层模型', FOCUS_LAYERS.join(',') === 'home,app,overlay');
ok('快捷键登记含 Esc/Enter/Tab', ['Tab', 'Enter', 'Escape'].every((k) => FOCUS_KEYS.indexOf(k) !== -1));

const home = createFocusScope({ layer: 'home', items: ['wechat', 'album', 'settings'] });
ok('焦点从第一项开始', home.active() === 'wechat');
ok('方向键移动', home.handle('ArrowDown').active === 'album' && home.handle('ArrowUp').active === 'wechat');
ok('边界循环（负控制：不越层）', home.tab(true) === 'settings' && home.tab(false) === 'wechat');
ok('Enter 激活当前项', home.handle('Enter').type === 'activate');
ok('setActive 只认层内项', home.setActive('album').ok === true && home.setActive('nope').ok === false);

const overlay = createFocusScope({ layer: 'overlay', items: ['confirm', 'cancel'], initial: 0 });
overlay.openOverlay('settings');
for (let i = 0; i < 5; i += 1) overlay.tab(false);
ok('弹窗 Tab 不出界（焦点陷阱）', overlay.active() === 'cancel' || overlay.active() === 'confirm');
ok('陷阱状态可见', overlay.stats().trap === true);
const res = overlay.handle('Escape');
ok('Esc 关闭', res.type === 'close');
ok('关闭后焦点回到触发元素', overlay.active() === 'settings' || res.restoreTo === 'settings');
ok('关闭后陷阱解除', overlay.stats().trap === false);

const seq = runKeys(['Tab', 'Enter', 'Tab', 'Escape'], { layer: 'overlay', items: ['send', 'attach'], initial: 0 });
ok('按键序列可复跑（逐步有读数）', seq.results.length === 4 && seq.keys.join('>') === 'Tab>Enter>Tab>Escape');
ok('序列末步为关闭', seq.results[3].type === 'close');

ok('焦点样式走主题令牌', focusStyleFor({ focusRing: '#8ab4ff' }).css.indexOf('#8ab4ff') !== -1);
ok('负控制：禁止 outline:none', /outline:\s*none/.test(focusStyleFor({ focusRing: '#8ab4ff' }).css) === false);
ok('无令牌时不给假样式', focusStyleFor({}).ok === false);
ok('自检绿', focusScopeSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/focus-scope.js'"));
ok('接线：桥表真登记 _r24O8', indexSrc.includes("'_r24O8'") || indexSrc.includes('["_r24O8"') || indexSrc.includes("['_r24O8'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);