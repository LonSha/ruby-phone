// tests/r24_x3_app_manifest.test.mjs — R24-X3 判据：第三方 App 的声明与装载
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MANIFEST_FIELDS, RESOURCE_NAMES, validateManifest, createAppRegistry, mountPathOf, appManifestSelfCheck
} from '../config/app-manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

ok('八个清单字段登记', MANIFEST_FIELDS.length === 8);
ok('权限面与 X2 同一份六类资源', RESOURCE_NAMES.join(',') === 'contacts,album,messages,wallet,location,calendar');

const registry = createAppRegistry({ builtins: [{ id: 'wechat', name: '微信', entry: 'apps/wechat/index.js' }] });
ok('内置按同一清单登记', registry.stats().builtins === 1);

ok('缺 entry 给具体原因', validateManifest({ id: 'wx1', name: 'X' }, []).bad.indexOf('missing-field:entry') !== -1);
ok('缺 name 给具体原因', validateManifest({ id: 'wx1', entry: 'a.js' }, []).bad.indexOf('missing-field:name') !== -1);
ok('非 js 入口拒收', validateManifest({ id: 'wx1', name: 'X', entry: 'a.txt' }, []).bad.indexOf('bad-entry') !== -1);
ok('权限越界拒收并指明', validateManifest({ id: 'wx1', name: 'X', entry: 'a.js', permissions: ['root'] }, []).bad.indexOf('permission-out-of-scope:root') !== -1);
ok('撞内置 id 拒收', validateManifest({ id: 'wechat', name: '微信', entry: 'a.js' }, ['wechat']).bad[0] === 'id-conflicts-builtin');
ok('坏颜色拒收', validateManifest({ id: 'wx1', name: 'X', entry: 'a.js', color: 'red' }, []).bad.indexOf('bad-color') !== -1);
ok('单字母 id 拒收（负控制）', validateManifest({ id: 'x', name: 'X', entry: 'a.js' }, []).bad.indexOf('bad-id') !== -1);

const weather = { id: 'weather', name: '天气', entry: 'apps/weather/index.js', styles: 'weather.css', permissions: ['location'] };
const inst = registry.install(weather);
ok('第三方可装（同一条路径）', inst.ok === true && mountPathOf(inst) === 'same-path');
ok('第三方不享受内置特权标记', registry.get('weather').builtin === false);
ok('权限按清单登记', registry.get('weather').permissions.join(',') === 'location');
ok('重复安装拒收', registry.install(weather).bad[0] === 'already-installed');
ok('内置 App 也在同一张清单里', registry.list().some((a) => a.id === 'wechat' && a.builtin));

ok('卸载必须先表态数据去留（负控制）', registry.uninstall('weather', {}).bad[0] === 'keep-data-not-specified');
const un = registry.uninstall('weather', { keepData: true });
ok('卸载撤图标撤样式', un.ok && un.iconRemoved && un.styleRemoved);
ok('数据保留由用户选', un.data === 'kept');
ok('卸载后无残留清单项', registry.get('weather') === null && registry.list().every((a) => a.id !== 'weather'));
ok('内置不走第三方卸载路径', registry.uninstall('wechat', { keepData: false }).bad[0] === 'builtin-cannot-uninstall');
ok('自检绿', appManifestSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/app-manifest.js'"));
ok('接线：桥表真登记 _r24X3', indexSrc.includes("'_r24X3'") || indexSrc.includes('["_r24X3"') || indexSrc.includes("['_r24X3'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);