// tests/r24_x5_host_adapter.test.mjs — R24-X5 判据：离线演示（三个口 + 固定种子 + ?offline=1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    HOST_PORTS, PORT_METHODS, DEMO_SEED, createHostAdapter, createMemoryHost,
    parseBootFlags, buildDemoSeed, createOfflineSession
} from '../config/host-adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('三个口登记齐', HOST_PORTS.join(',') === 'storage,eventBus,chat');
ok('每个口的方法都列清楚', PORT_METHODS.storage.includes('remove') && PORT_METHODS.eventBus.includes('emit') && PORT_METHODS.chat.includes('sent'));

// 缺口必须点名，不许静默补空实现
const none = createHostAdapter({});
ok('三个口全缺应报三条', none.ok === false && none.bad.length === 3);
ok('缺 chat 点名 chat', createHostAdapter({ storage: createMemoryHost().storage, eventBus: createMemoryHost().eventBus }).bad[0] === 'missing-port:chat');
ok('口在但方法缺也要点名', createHostAdapter({ storage: { get() {} }, eventBus: createMemoryHost().eventBus, chat: createMemoryHost().chat }).bad[0] === 'bad-port:storage.set');

const mem = createMemoryHost();
const host = createHostAdapter(mem);
ok('三件套齐通过并标 offline', host.ok === true && host.offline === true);
host.host.storage.set('k', { a: 1 });
ok('storage 原样透传（不包一层）', host.host.storage.get('k').a === 1);
ok('keys 能列出真写进去的键', host.host.storage.keys().indexOf('k') !== -1);

let got = 0;
const off = mem.eventBus.on('phone:openApp', () => { got += 1; });
mem.eventBus.emit('phone:openApp', { id: 'wechat' });
ok('事件送达', got === 1);
off();
mem.eventBus.emit('phone:openApp', { id: 'wechat' });
ok('退订后不再收（负控制）', got === 1);

mem.chat.send('c1', '在吗');
ok('chat.send 可对拍', mem.chat.sent().length === 1 && mem.chat.sent()[0].text === '在吗');

ok('?offline=1 识别', parseBootFlags('?offline=1').offline === true);
ok('?offline=true 识别', parseBootFlags('?offline=true').offline === true);
ok('无标记不当离线', parseBootFlags('?foo=1').offline === false);
ok('空串不当离线', parseBootFlags('').offline === false);

const seed = buildDemoSeed();
ok('8 联系人', seed.contacts.length === DEMO_SEED.contacts);
ok('30 消息', seed.messages.length === DEMO_SEED.messages);
ok('20 图', seed.photos.length === DEMO_SEED.photos);
ok('种子可复跑（不许随机）', JSON.stringify(buildDemoSeed()) === JSON.stringify(seed));
ok('消息带剧情时刻', seed.messages.every((m) => typeof m.at === 'number' && m.at > 0));

const session = createOfflineSession();
ok('离线会话可用', session.ok === true);
ok('入口标记是 ?offline=1', session.entry === '?offline=1');
ok('消息真落进离线 storage', session.mem.storage.get('phone.messages').length === 30);
ok('联系人真落进离线 storage', session.mem.storage.get('phone.contacts').length === 8);

const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', idx.includes("from './config/host-adapter.js'"));
ok('接线：桥表真登记 _r24X5', idx.includes("'_r24X5'"));

console.log('R24-X5 离线演示：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
