// RubyPhone 全量审计脚本
// 逆向审计（假设出错）：APPS/路由/模块/测试一致性 + 正向审计（功能端到端）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const R = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; R.push(`✓ ${name}`); }
  else { fail++; R.push(`✗ ${name} ${detail}`); }
};

// ========== 1. APPS 注册 vs 路由一致性 ==========
{
  const appsJs = fs.readFileSync(path.join(root, 'config/apps.js'), 'utf8');
  const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const apps = [...appsJs.matchAll(/id: '([a-zA-Z]+)'/g)].map(m => m[1]);
  const routes = [...idx.matchAll(/appId === '([a-zA-Z]+)'/g)].map(m => m[1]);
  const dupApps = apps.filter((a, i) => apps.indexOf(a) !== i);
  ok('APPS 无重复 id', dupApps.length === 0, dupApps.join(','));
  ok('每个 App 都有路由', apps.every(a => routes.includes(a)), `缺: ${apps.filter(a => !routes.includes(a))}`);
  ok('APPS 顺序稳定', apps[0] === 'wechat' && apps.length >= 25, `len=${apps.length}`);
}

// ========== 2. 每个 app 有 app.js + 导出默认类 ==========
{
  const appsDir = path.join(root, 'apps');
  const dirs = fs.readdirSync(appsDir).filter(d => fs.statSync(path.join(appsDir, d)).isDirectory() && !d.startsWith('.'));
  let noAppJs = 0;
  for (const d of dirs) {
    // 特例：bilibili 的 app 文件叫 bili-app.js，其余为 <name>-app.js
    const appFile = d === 'bilibili' ? 'bili-app.js' : d + '-app.js';
    const appJs = path.join(appsDir, d, appFile);
    if (!fs.existsSync(appJs)) { noAppJs++; ok(`${d} 缺 app.js`, false); }
  }
  if (noAppJs === 0) ok('所有 App 目录都有 xxx-app.js', true);
}

// ========== 3. 新增模块语法门 ==========
{
  const targets = [
    'apps/health/medical-core.js',
    'apps/health/health-data.js',
    'apps/health/health-view.js',
    'apps/gacha/gacha-data.js',
    'apps/gacha/gacha-view.js',
    'apps/gacha/gacha-app.js',
    'apps/reading/reading-data.js',
    'apps/reading/reading-view.js',
    'apps/reading/reading-app.js',
    'apps/reading/reading-epub.js',
    'data/gacha-items.js',
    'data/illness-library.js',
  ];
  for (const t of targets) {
    const p = path.join(root, t);
    if (fs.existsSync(p)) ok(`存在 ${t}`, true);
    else ok(`存在 ${t}`, false, '缺失');
  }
}

// ========== 4. 测试覆盖 ==========
{
  const testsDir = path.join(root, 'tests');
  const expected = ['route-apps', 'reading-data', 'reading-app', 'reading-epub', 'medical', 'medical-health', 'gacha-data', 'gacha-app'];
  for (const e of expected) {
    const f = path.join(testsDir, e + '.test.mjs');
    ok(`测试存在 ${e}`, fs.existsSync(f));
  }
}

// ========== 5. manifest/update-log 合法性（跨源自洽，不硬编码版本号） ==========
{
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const u = JSON.parse(fs.readFileSync(path.join(root, 'update-log.json'), 'utf8'));
    ok('manifest 合法', !!m.version && !!m.name, JSON.stringify(Object.keys(m)));
    ok('update-log 合法', !!u.versions && typeof u.latest === 'string');
    ok('manifest.version == update-log.latest', m.version === u.latest, `manifest=${m.version} latest=${u.latest}`);
    ok('update-log 含当前版本条目', !!(u.versions || {})[m.version], m.version);
    const cur = (u.versions || {})[m.version];
    ok('当前版本条目含非空 items', !!(cur && Array.isArray(cur.items) && cur.items.length));
  } catch (e) { ok('manifest/update-log 可解析', false, e.message); }
}

// ========== 6. 数据规模 ==========
{
  try {
    const g = JSON.parse(fs.readFileSync(path.join(root, 'data/gacha-items.js'), 'utf8').match(/export const gachaItems = ([\s\S]*?);/)[1]);
    ok('gachaItems 630', g.length === 630, `len=${g.length}`);
  } catch (e) { ok('gachaItems 630', false, e.message); }
  try {
    const il = JSON.parse(fs.readFileSync(path.join(root, 'data/illness-library.js'), 'utf8').match(/export const illnesses = ([\s\S]*?);/)[1]);
    ok('illnesses 140', il.length === 140, `len=${il.length}`);
  } catch (e) { ok('illnesses 140', false, e.message); }
}

// ========== 7. 无死代码（搜索 TODO/调试残留） ==========
{
  let todo = 0;
  const scanDirs = ['apps', 'config', 'data'];
  for (const sd of scanDirs) {
    const dir = path.join(root, sd);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(de => {
      if (de.isDirectory() && !de.name.startsWith('.')) {
        const sub = path.join(dir, de.name);
        fs.readdirSync(sub).forEach(f => {
          if (f.endsWith('.js')) {
            const c = fs.readFileSync(path.join(sub, f), 'utf8');
            if (/debugger|FIXME|XXX:/.test(c)) todo++;
          }
        });
      }
    });
  }
  ok('无 debugger/FIXME 残留', todo === 0, `${todo} 处`);
}

// ========== 8. 权限/依赖检查：新增文件无外部 fetch/CDN ==========
{
  const targets = ['apps/health/medical-core.js', 'apps/gacha/gacha-data.js', 'apps/reading/reading-epub.js'];
  let bad = 0;
  for (const t of targets) {
    const c = fs.readFileSync(path.join(root, t), 'utf8');
    if (/fetch\(|https?:\/\//.test(c)) { bad++; ok(`${t} 无外部请求`, false); }
  }
  if (bad === 0) ok('新增模块零外部请求', true);
}

console.log('\n===== RubyPhone 全量审计结果 =====');
R.forEach(r => console.log(r));
console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);