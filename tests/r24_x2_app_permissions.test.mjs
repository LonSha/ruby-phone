// tests/r24_x2_app_permissions.test.mjs — R24-X2 判据：App 间资源权限面
// 纪律：denied 与「没有数据」不同形；撤销即时；台账不记内容；接线必须真进 index.js。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PERMISSION_RESOURCES, PERMISSION_FACES, createPermissionRegistry, appPermissionsSelfCheck
} from '../config/app-permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const reg = createPermissionRegistry({ trailLimit: 4 });
reg.declare('mall', ['wallet']);
reg.declare('wechat', ['contacts', 'messages']);

ok('六类资源登记齐', Object.keys(PERMISSION_RESOURCES).length === 6);
ok('四态齐全', ['granted', 'denied', 'revoked', 'invalid'].every((f) => typeof PERMISSION_FACES[f] === 'string'));
ok('已声明 granted', reg.face('wechat', 'contacts').face === 'granted');
ok('未声明 denied', reg.face('mall', 'contacts').face === 'denied');
ok('资源名不存在 invalid（不是 denied）', reg.face('wechat', 'bogus').face === 'invalid');

let calls = 0;
const got = reg.read('wechat', 'messages', () => { calls += 1; return [{ id: 1 }]; });
ok('granted 拿到数据', got.face === 'granted' && got.data.length === 1 && calls === 1);
const noPerm = reg.read('mall', 'contacts', () => { calls += 1; return ['leak']; });
ok('denied 形状', noPerm.face === 'denied');
ok('denied 的 data 为 null 而非空数组', noPerm.data === null && !Array.isArray(noPerm.data));
ok('负控制：被拒时 loader 未被调用', calls === 1);
const noData = reg.read('wechat', 'messages', () => null);
ok('有权限无数据 = granted/no-data', noData.face === 'granted' && noData.reason === 'no-data');
ok('有权限无数据与 denied 不同形', noData.face !== noPerm.face);

reg.revoke('wechat', 'contacts');
ok('撤销后 revoked', reg.face('wechat', 'contacts').face === 'revoked');
const before = calls;
reg.read('wechat', 'contacts', () => { calls += 1; return ['x']; });
ok('负控制：撤销后 loader 不许被调（即时生效）', calls === before);
ok('撤销只影响该项', reg.face('wechat', 'messages').face === 'granted');
ok('可恢复已声明项', reg.grant('wechat', 'contacts').face === 'granted');
ok('负控制：未声明项不许靠 grant 绕过', reg.grant('wechat', 'wallet').ok === false);

const reads = reg.trailCount();
ok('台账计数 = 读取次数', reads === 4);
ok('台账环形上限生效', reg.trailLog(99).length === 4);
ok('台账不记内容', JSON.stringify(reg.trailLog(99)).indexOf('leak') === -1);
ok('非法资源声明被拒收', reg.declare('x', ['bogus']).bad[0] === 'unknown-resource:bogus');
ok('自检绿', appPermissionsSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/app-permissions.js'"));
ok('接线：桥表真登记 _r24X2', indexSrc.includes("'_r24X2'") || indexSrc.includes('["_r24X2"') || indexSrc.includes("['_r24X2'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
