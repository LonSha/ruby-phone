// tests/r24_o1_phone_store.test.mjs — R24-O1 判据：持久层 v3（每 App 声明 / 配额 / 越权写拦截）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_FACES, createAppStore, phoneStoreSelfCheck } from '../config/phone-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const mem = {};
const storage = {
    get: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    set: (k, v) => { mem[k] = String(v); },
    keys: () => Object.keys(mem)
};
const store = createAppStore({ storage, quotaBytes: 1200 });

ok('六态登记齐', ['current', 'migrated', 'fresh', 'corrupt', 'undeclared', 'future'].every((f) => typeof STORE_FACES[f] === 'string'));
ok('未声明 App 读 = undeclared', store.read('ghost').face === 'undeclared');
ok('未声明 App 写被拒', store.write('ghost', { a: 1 }).reason === 'no-declaration');
ok('v2 缺 migrate 拒收', store.declare('bad', { version: 2 }).ok === false);

store.declare('wechat', {
    version: 2,
    defaults: { msgs: 0 },
    migrate: (from, to, d) => Object.assign({}, d, { draft: '' })
});
store.declare('album', { version: 1, defaults: { photos: [] } });

const fresh = store.read('wechat');
ok('无旧键 = fresh（不是 migrated）', fresh.face === 'fresh' && fresh.data.msgs === 0);
ok('fresh 不写盘（懒初始化）', mem['phone.app.wechat'] === undefined);

ok('正常写成功', store.write('wechat', { msgs: 2 }).ok === true);
ok('写入后可读 = current', store.read('wechat').face === 'current' && store.read('wechat').data.msgs === 2);

mem['phone.app.wechat'] = '{"__v":1,"data":{"msgs":7}}';
const mig = store.read('wechat');
ok('旧版 = migrated', mig.face === 'migrated');
ok('迁移逐跳可查', mig.steps[0] === '1->2');
ok('迁移不丢旧字段', mig.data.msgs === 7 && mig.data.draft === '');

const raw = '{"__v":2,"data":{';
mem['phone.app.wechat'] = raw;
const corrupt = store.read('wechat');
ok('坏 JSON = corrupt', corrupt.face === 'corrupt' && corrupt.reason === 'bad-json');
ok('corrupt 时原值留在盘上', mem['phone.app.wechat'] === raw);
ok('corrupt 时写被拒', store.write('wechat', { msgs: 1 }).reason === 'corrupt');
ok('负控制：被拒的写没改盘', mem['phone.app.wechat'] === raw);

mem['phone.app.wechat'] = '{"__v":9,"data":{"msgs":1}}';
ok('盘上版本更高 = future', store.read('wechat').face === 'future');
ok('future 时拒绝降级写', store.write('wechat', { msgs: 2 }).reason === 'newer-version');

mem['phone.app.wechat'] = '{"__v":2,"data":{"msgs":2,"draft":""}}';
const over = store.write('album', { photos: ['x'.repeat(2000)] });
ok('超配额被拒', over.ok === false && over.reason === 'over-quota');
ok('配额读数可复算', over.limit === 1200 && over.wouldBe > 1200 && over.appBytes > 1200);
const q = store.quota();
ok('配额带人话提示', typeof q.note === 'string' && q.note.length > 0);
ok('配额 face 三态之一', ['ok', 'near', 'over'].indexOf(q.face) !== -1);

mem['phone.app.orphan'] = '{"__v":1,"data":{}}';
const orph = store.orphanKeys();
ok('孤儿键被登记', orph.count === 1 && orph.appIds[0] === 'orphan');
ok('孤儿键不自动删', orph.autoDeleted === 0 && mem['phone.app.orphan'] !== undefined);

ok('自检绿', phoneStoreSelfCheck().ok === true);
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/phone-store.js'"));
ok('接线：桥表真登记 _r24O1', indexSrc.includes("'_r24O1'") || indexSrc.includes('["_r24O1"') || indexSrc.includes("['_r24O1'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
