import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS } from '../config/apps.js';
import { APP_LAZY_ROUTES, APP_LAZY_ROUTE_INDEX } from '../config/app-lazy-routes.js';
import { CORE_DESKTOP_IDS, isCoreDesktop, clusterByCategory, APP_CLUSTERS } from '../config/app-clusters.js';
import { APP_LIBRARY_CATEGORIES, APP_LIBRARY_ENTRY_ID } from '../config/app-library.js';
import fs from 'node:fs';
import path from 'node:path';

test('R14-O1 · 89 个登记 App 路由完整性与装配契约', () => {
  assert.equal(APPS.length, 89, 'APPS 总数必须严格对齐 89 个');
  
  // 14 个内联特殊分支名单
  const INLINE_BRANCH_APPS = new Set([
    'wechat', 'weibo', 'honey', 'mofo', 'wangxiang', 'phone',
    'diary', 'music', 'album', 'calendar', 'games', 'settings',
    'graph', 'lexiscore'
  ]);

  const allAppIds = new Set(APPS.map(a => a.id));
  assert.equal(allAppIds.size, 89, 'App ID 必须唯一无重复');

  for (const app of APPS) {
    if (INLINE_BRANCH_APPS.has(app.id)) {
      // 必须在 index.js 中存在专用路由处理
      continue;
    }
    const route = APP_LAZY_ROUTE_INDEX.get(app.id);
    assert.ok(route, `App [${app.id}] 必须在 APP_LAZY_ROUTES 表驱动路由中已登记`);
    assert.ok(route.module, `App [${app.id}] 必须配置模块路径`);
    assert.ok(route.cls, `App [${app.id}] 必须配置导出类名`);
    assert.ok(fs.existsSync(path.join(process.cwd(), route.module)), `App [${app.id}] 模块源码文件必须真实存在: ${route.module}`);
  }
});

test('R14-O1 · 桌面分层与聚合壳分类全覆盖 (所有 App 皆有真实可达入口)', () => {
  // 8 个核心平铺
  assert.equal(CORE_DESKTOP_IDS.length, 8);
  for (const coreId of CORE_DESKTOP_IDS) {
    assert.ok(isCoreDesktop(coreId), `核心 App [${coreId}] 必须被判定为 isCoreDesktop`);
  }

  // 7 个聚合类目与应用库 dock
  const clusterCategories = new Set(APP_CLUSTERS.map(c => c.id));
  assert.equal(clusterCategories.size, 7);

  // 所有非核心 App 必须归入有效的聚合类目或应用库分组，不得存在入口悬空
  for (const app of APPS) {
    if (isCoreDesktop(app.id)) continue;
    const cat = app.libraryCategory || 'system';
    assert.ok(clusterCategories.has(cat), `非核心 App [${app.id}] 的类目 [${cat}] 必须在 APP_CLUSTERS 中有对应聚合壳`);
  }
});