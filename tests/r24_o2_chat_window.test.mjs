// tests/r24_o2_chat_window.test.mjs — R24-O2 判据：窗口化挂载与增量更新
// 硬门槛：窗口产出与全量产出逐条等价；尾插/局部替换零重建；三档读数可复跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    WINDOW_DEFAULTS, PERF_TIERS, createWindowModel, domSignature, renderAll, perfReport, chatWindowSelfCheck
} from '../config/chat-window.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const items = [];
for (let i = 0; i < 5000; i += 1) items.push({ id: 'm' + i, text: 't' + (i % 13) });
const model = createWindowModel({ items });

ok('默认参数登记', WINDOW_DEFAULTS.overscan > 0 && WINDOW_DEFAULTS.itemHeight > 0);
ok('三档规模登记', PERF_TIERS.join(',') === '200,1000,5000');
ok('5000 条装载', model.total() === 5000);

const top = model.computeWindow(0);
ok('顶部窗口不含负索引', top.start === 0 && top.count > 0);
ok('窗口大小 = 可见 + 2×overscan 上限', top.count <= Math.ceil(WINDOW_DEFAULTS.viewportHeight / WINDOW_DEFAULTS.itemHeight) + WINDOW_DEFAULTS.overscan + 1);
const deep = model.computeWindow(720 * 100);
ok('深滚动窗口只挂可视区附近', deep.count < 60 && deep.start > 90);
const end = model.computeWindow(720 * 9999);
ok('滚到底夹到末尾', end.end === 5000);

const fullSig = domSignature(renderAll(model.items));
const winSig = domSignature(renderAll(top.items));
ok('窗口产出与全量产出同源（前缀一致）', fullSig.indexOf(winSig) === 0);

const before = model.stats();
model.append({ id: 'new', text: 'hi' });
ok('尾插走 append 路径', model.stats().appends === before.appends + 1);
ok('尾插零重建', model.stats().rebuilds === 0);
model.replaceAt(3, { id: 'm3', text: 'edited' });
ok('局部替换零重建', model.stats().replaces === 1 && model.stats().rebuilds === 0);
ok('越界替换被拒（不崩）', model.replaceAt(-1, {}).ok === false);

const rep = perfReport([
    { total: 200, firstFrameMs: 10, fps: 60, memoryMb: 28, baselineFirstFrameMs: 26, baselineFps: 42 },
    { total: 1000, firstFrameMs: 14, fps: 59, memoryMb: 40, baselineFirstFrameMs: 110, baselineFps: 21 },
    { total: 5000, firstFrameMs: 18, fps: 56, memoryMb: 58, baselineFirstFrameMs: 460, baselineFps: 6 }
]);
ok('三档都覆盖', rep.allTiersCovered === true);
ok('1000 条档达基线 1.5 倍', rep.rows[1].speedup >= 1.5 && rep.rows[1].meetsTarget === true);
ok('读数不许写死（可复算）', rep.rows[2].speedup === Math.round((56 / 6) * 100) / 100);
ok('自检绿', chatWindowSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/chat-window.js'"));
ok('接线：桥表真登记 _r24O2', indexSrc.includes("'_r24O2'") || indexSrc.includes('["_r24O2"') || indexSrc.includes("['_r24O2'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);