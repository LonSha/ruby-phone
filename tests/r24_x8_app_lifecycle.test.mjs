// tests/r24_x8_app_lifecycle.test.mjs — R24-X8 判据：多任务与后台（状态保留 / 回收 / 恢复面）
import fs from 'fs';
import path from 'path';
import {
    LIFECYCLE_STATES, RETENTION_POLICIES, RESTORE_FACES, createLifecycleManager
} from '../config/app-lifecycle.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
let pass = 0; const fail = 0; const bad = [];
function ok(name, cond) { if (cond) { pass += 1; } else { bad.push(name); } }

// —— 四态 / 两策略 / 三恢复面都登记，且不许塌成一个 ——
ok('四态登记', Object.keys(LIFECYCLE_STATES).length === 4);
ok('两策略', Object.keys(RETENTION_POLICIES).length === 2);
ok('三恢复面', Object.keys(RESTORE_FACES).length === 3);
ok('background 策略明说保状态', String(RETENTION_POLICIES.background).length > 0);

// —— 有草稿：切走保状态，切回逐字段一致 ——
const m = createLifecycleManager({
    apps: [
        { id: 'wechat', policy: 'background', initial: { scrollTop: 420, cursor: 3, expanded: ['c1'], draft: { text: '打一半', cursor: 6 } } },
        { id: 'album', policy: 'suspendable', initial: { page: 'grid' } },
        { id: 'music', policy: 'suspendable', initial: { tab: 'now' } }
    ]
});
m.switchTo('wechat');
m.switchTo('album');
ok('有草稿退到 background', m.get('wechat').state === 'background');
const r1 = m.restore('wechat');
ok('background 恢复面=exact', r1.face === 'exact');
ok('scrollTop 保真', r1.snapshot.scrollTop === 420);
ok('cursor 保真', r1.snapshot.cursor === 3);
ok('展开集合保真', Array.isArray(r1.snapshot.expanded) && r1.snapshot.expanded[0] === 'c1');
ok('草稿文本保真', r1.snapshot.draft.text === '打一半');
ok('草稿光标保真', r1.snapshot.draft.cursor === 6);

// —— 无草稿：可挂起，恢复必须明说「已重置」，且不许回带旧状态 ——
m.switchTo('album');
m.switchTo('wechat');
ok('无草稿可挂起', m.get('album').state === 'suspended');
const r2 = m.restore('album');
ok('suspended 恢复面=reset', r2.face === 'reset');
ok('reset 必须带人话 notice', String(r2.notice || '').indexOf('已重置') !== -1);
ok('reset 不许回带旧快照', r2.snapshot === null);

// —— 回收：先挂起后后台；有未保存草稿一律跳过并登记 ——
m.switchTo('album');
m.saveDraft('album', { text: '', cursor: 0 });
m.switchTo('music');
const rec = m.recycleUnderPressure();
ok('只回收可回收的那一个', rec.recycled.length === 1 && rec.recycled[0].id === 'album');
ok('回收来源是 suspended（顺序铁律）', rec.recycled[0].from === 'suspended');
ok('被保护的 App 如实登记', rec.protected.indexOf('wechat') !== -1);
ok('保护项不被改态', m.get('wechat').state === 'background');
ok('前台 App 不在回收范围', m.get('music').state === 'foreground');
ok('回收后为 closed', m.get('album').state === 'closed');
ok('回收后快照清空', m.snapshotOf('album').snapshot === null);

// —— 负控制：空草稿不算「未保存」，否则保护面会误报 ——
const m2 = createLifecycleManager({ apps: [{ id: 'a', policy: 'suspendable' }, { id: 'b', policy: 'suspendable' }] });
m2.switchTo('a'); m2.saveDraft('a', { text: '', cursor: 0 }); m2.switchTo('b');
ok('空草稿不触发保护', m2.recycleUnderPressure().protected.indexOf('a') === -1);

// —— 未知 App 拒判 + 接线 ——
ok('未知 App 应拒', m.switchTo('nope').ok === false && m.restore('nope').ok === false);

const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('import 真进 index.js', /from '\.\/config\/app-lifecycle\.js'/.test(idx));
ok('桥表真登记 _r24X8', /'\_r24X8'\s*,\s*appLifecycleSelfCheck/.test(idx));

console.log('R24-X8 多任务与后台：' + pass + ' 通过，' + bad.length + ' 失败');
if (bad.length) { console.log('失败项：' + bad.join(' / ')); }
process.exit(bad.length > 0 ? 1 : 0);
