// tests/r24_x4_phone_archive.test.mjs — R24-X4 判据：整机可携（人类可读档案 + 三模式导入 + 往返一致）
import fs from 'fs';
import path from 'path';
import {
    IMPORT_MODES, MANIFEST_SCHEMA, exportArchive, parseArchive, previewImport, applyImport, diffStates
} from '../config/phone-archive.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
let pass = 0; const bad = [];
function ok(name, cond) { if (cond) { pass += 1; } else { bad.push(name); } }

const state = {
    apps: {
        wechat: [
            { id: 'm1', at: 1, from: '阿明', text: '在吗' },
            { id: 'm2', at: 2, from: '我', text: '在' }
        ],
        album: [{ id: 'p1', at: 3, from: '我', text: '照片1' }]
    }
};
const archive = exportArchive(state, { exportedAt: '2026-11-18' });

// —— 人类可读：目录结构 + 英文标识字段 + 不许夹带内部键 ——
ok('清单 schema 登记', archive.manifest.schema === MANIFEST_SCHEMA);
ok('路径形如 phone/<app>/data.json', !!archive.files['phone/wechat/data.json']);
ok('清单报 App 数', archive.manifest.appCount === 2);
ok('逐 App 计数', archive.manifest.apps.wechat.count === 2);
ok('字段名是英文标识', Object.keys(archive.files['phone/wechat/data.json'][0]).sort().join(',') === 'at,from,id,text');
ok('档案不带内部键', JSON.stringify(archive).indexOf('__v') === -1);
ok('导出可被 JSON 文本编辑器读', JSON.parse(JSON.stringify(archive)).files['phone/album/data.json'][0].text === '照片1');

// —— 往返一致：导出 → 清空 → 导入，逐字段对拍 ——
const back = applyImport(archive, { apps: {} }, 'replace');
ok('replace 导入成功', back.ok === true);
ok('往返逐字段一致', diffStates(state, back.state).same === true);
ok('清空后导入确实没有本地独有', !back.state.apps.wechat.some((r) => r.id === 'm9'));

// —— 预览先算账，不写 ——
const local = { apps: { wechat: [{ id: 'm1', at: 0, from: '阿明', text: '本地旧值' }, { id: 'm3', at: 3, from: '我', text: '本地独有' }] } };
const snapshotBefore = JSON.stringify(local);
const prev = previewImport(archive, local);
ok('预览 ok', prev.ok === true);
ok('预览：wechat 新增 1（m2）', prev.perApp.wechat.added === 1);
ok('预览：wechat 覆盖 1（m1）', prev.perApp.wechat.overwritten === 1);
ok('预览：replace 会丢 1（本地独有）', prev.perApp.wechat.droppedOnReplace === 1);
ok('预览：album 整 App 新增 1', prev.perApp.album.added === 1);
ok('预览不改入参', JSON.stringify(local) === snapshotBefore);

// —— 三模式必须产生三种不同结果 ——
const r1 = applyImport(archive, local, 'replace').state;
const r2 = applyImport(archive, local, 'merge').state;
const r3 = applyImport(archive, local, 'fill').state;
ok('replace 丢弃本地独有', !r1.apps.wechat.some((r) => r.id === 'm3'));
ok('merge 保留本地独有', r2.apps.wechat.some((r) => r.id === 'm3'));
ok('merge 同 id 取新（档案 at 更大）', r2.apps.wechat.find((r) => r.id === 'm1').text === '在吗');
ok('fill 不覆盖本地已有', r3.apps.wechat.find((r) => r.id === 'm1').text === '本地旧值');
ok('fill 仍补空（m2 进来）', r3.apps.wechat.some((r) => r.id === 'm2'));
ok('merge 与 fill 不同形', JSON.stringify(r2) !== JSON.stringify(r3));
ok('replace 与 merge 不同形', JSON.stringify(r1) !== JSON.stringify(r2));
ok('导入不改入参', JSON.stringify(local) === snapshotBefore);

// —— 负控制：坏档案必须拒，且拒的理由具体 ——
ok('缺清单应拒', parseArchive({ files: {} }).bad.indexOf('no-manifest') !== -1);
ok('坏 schema 应拒', parseArchive({ files: {}, manifest: { schema: 'x' } }).bad.indexOf('bad-schema') !== -1);
ok('坏路径应拒', parseArchive({ files: { 'other/a.json': [] }, manifest: { schema: MANIFEST_SCHEMA } }).bad[0].indexOf('bad-path:') === 0);
ok('未知模式应拒', applyImport(archive, local, 'nope').bad[0] === 'unknown-mode');
ok('坏档案不许写盘', applyImport({ files: {} }, local, 'replace').ok === false);

// —— 接线 ——
const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('import 真进 index.js', /from '\.\/config\/phone-archive\.js'/.test(idx));
ok('桥表真登记 _r24X4', /'\_r24X4'\s*,\s*phoneArchiveSelfCheck/.test(idx));
ok('三模式登记齐', Object.keys(IMPORT_MODES).length === 3);

console.log('R24-X4 整机可携：' + pass + ' 通过，' + bad.length + ' 失败');
if (bad.length) { console.log('失败项：' + bad.join(' / ')); }
process.exit(bad.length > 0 ? 1 : 0);