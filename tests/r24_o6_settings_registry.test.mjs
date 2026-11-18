// tests/r24_o6_settings_registry.test.mjs — R24-O6 判据：设置中心登记制（六组 / 唯一默认值 / 改动面 / 过滤沿用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SETTING_GROUPS, SETTING_FIELDS, SETTING_ENTRIES, validateSetting, createSettingsRegistry
} from '../config/settings-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('六个分组登记', Object.keys(SETTING_GROUPS).length === 6);
ok('五字段登记', SETTING_FIELDS.join(',') === 'id,group,label,default,effect');

const reg = createSettingsRegistry(SETTING_ENTRIES);
ok('内置登记项全部合格（零拒收）', reg.rejected.length === 0);
ok('登记项数与常量一致', reg.size() === SETTING_ENTRIES.length);
ok('六组每组至少两项', reg.grouped().length === 6 && reg.grouped().every((g) => g.items.length >= 2));
ok('分组顺序按登记序', reg.grouped()[0].group === 'general' && reg.grouped()[5].group === 'data');

const d = reg.defaults();
ok('默认值逐项给出', Object.keys(d).length === reg.size());
ok('默认值是唯一真值', d['appearance.theme'] === 'dark');
ok('每项 effect 都是人话（≥4 字）', reg.all().every((e) => String(e.effect).trim().length >= 4));

// 三层拒绝
ok('撞 id 拒收', createSettingsRegistry([
    { id: 'general.lockScreen', group: 'general', label: 'A', default: 1, effect: '说明说明' },
    { id: 'general.lockScreen', group: 'general', label: 'B', default: 2, effect: '说明说明' }
]).rejected[0].bad.indexOf('duplicate-id:general.lockScreen') !== -1);
ok('未知分组拒收', createSettingsRegistry([{ id: 'x.y', group: 'nope', label: 'A', default: 1, effect: '说明说明' }]).rejected[0].bad.indexOf('unknown-group:nope') !== -1);
ok('敷衍 effect 拒收', createSettingsRegistry([{ id: 'x.y', group: 'general', label: 'A', default: 1, effect: '开关' }]).rejected[0].bad[0].indexOf('vague-effect') === 0);
ok('缺字段拒收', validateSetting({ id: 'x.y', group: 'general', label: 'A' }, null).bad.indexOf('missing-field:default') !== -1);

// 过滤沿用 R22-O2 的 filterSettings（一处实现两处用）
ok('空查询全显', reg.search('').face === 'all');
ok('中文关键词命中', reg.search('免打扰').face === 'results' && reg.search('免打扰').matched >= 1);
ok('按 id 命中', reg.search('privacy.archiveExport').face === 'results');
ok('无命中如实 noMatch', reg.search('绝无此项').face === 'noMatch');
ok('过滤形状带 effect（说明跟着项一起走）', reg.toSections()[0].items.every((it) => typeof it.effect === 'string' && it.effect.length > 3));

// 改动面
ok('只报真改过的项', reg.changed({ 'appearance.theme': 'light', 'data.keepDraft': true }).length === 1);
ok('缺项不算改', reg.changed({}).length === 0);
ok('没改说人话', reg.summary({}).text === '都是默认值');
const sum = reg.summary({ 'appearance.theme': 'light' });
ok('摘要带项名与效果', sum.text.includes('主题') && sum.text.includes('对比度'));
ok('摘要给得出改前改后', sum.changed[0].from === 'dark' && sum.changed[0].to === 'light');

const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', idx.includes("from './config/settings-registry.js'"));
ok('接线：桥表真登记 _r24O6', idx.includes("'_r24O6'"));

console.log('R24-O6 设置中心登记制：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
