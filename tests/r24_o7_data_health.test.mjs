// tests/r24_o7_data_health.test.mjs — R24-O7 判据：数据体检与自愈面
// 硬门槛：五类脏数据各报各的（互不误报）；默认只读；修前算账；报告不含内部路径。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    HEALTH_KINDS, inspect, planFix, applyFix, reportText, dataHealthSelfCheck
} from '../config/data-health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('五类体检项登记', Object.keys(HEALTH_KINDS).length === 5);
const clean = inspect({ declaredApps: ['wechat', 'album'], keys: ['wechat', 'album'] });
ok('干净数据 = clean', clean.clean === true && clean.face === 'clean');
ok('干净时不报任何项', clean.items.length === 0);

const orphan = inspect({ declaredApps: ['wechat'], keys: ['wechat', 'ghost', 'ghost2'] });
ok('孤儿键只报该类', orphan.kinds.join(',') === 'orphan-key' && orphan.items[0].count === 2);
ok('孤儿键带人话 + 影响 + 动作', !!(orphan.items[0].human && orphan.items[0].impact && orphan.items[0].action));

const over = inspect({ declaredApps: ['a'], keys: ['a'], appSizes: { a: 5000 }, quotaBytes: 1024 });
ok('超配额只报该类', over.kinds.join(',') === 'over-quota');
ok('超配额是 error 级', over.items[0].severity === 'error');

const broken = inspect({ declaredApps: ['a'], keys: ['a'], parseErrors: { a: 'Unexpected end' } });
ok('坏 JSON 只报该类', broken.kinds.join(',') === 'bad-json');
ok('坏 JSON 动作是保留（不覆盖）', broken.items[0].action === 'keep');

const dangling = inspect({
    declaredApps: ['a'], keys: ['a'], targetIds: ['c1'],
    references: [
        { from: 'msg1', targetKind: 'contact', targetId: 'c1' },
        { from: 'msg2', targetKind: 'contact', targetId: 'c9' }
    ]
});
ok('悬空引用只报该类', dangling.kinds.join(',') === 'dangling-ref' && dangling.items[0].count === 1);

const dup = inspect({
    declaredApps: ['a'], keys: ['a'],
    records: [
        { subject: 'A', predicate: '说', object: '会回来', bucket: 'd1' },
        { subject: 'A', predicate: '说', object: '会回来', bucket: 'd1' },
        { subject: 'B', predicate: '说', object: '会回来', bucket: 'd1' }
    ]
});
ok('重复记录只报该类', dup.kinds.join(',') === 'duplicate-record' && dup.items[0].count === 1);

const plan = planFix(dup);
ok('修前算账（改多少 / 留多少）', plan.willChange === 1 && plan.willKeep === 0);
ok('修前必须要求确认', plan.requiresConfirmation === true);
ok('默认只读（零变更）', applyFix(dup, {}).changed === 0 && applyFix(dup, {}).dryRun === true);
ok('未确认不许写（负控制）', applyFix(dup, { dryRun: false }).reason === 'needs-confirmation');
ok('确认后按算账数量变更', applyFix(dup, { dryRun: false, confirmed: true }).changed === 1);

const text = reportText(orphan);
ok('体检结果可导出为一页文本', text.split('\n').length >= 5);
ok('文本含人话结论', text.indexOf('孤儿键') !== -1);
ok('文本不含内部对象路径', !/\[object |undefined|\.data\./.test(text));
ok('自检绿', dataHealthSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/data-health.js'"));
ok('接线：桥表真登记 _r24O7', indexSrc.includes("'_r24O7'") || indexSrc.includes('["_r24O7"') || indexSrc.includes("['_r24O7'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);