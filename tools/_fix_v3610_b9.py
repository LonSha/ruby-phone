#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B9：最后两条 O6 连带面（v255 / v324）。

① tests/system-v255.test.mjs 的 A3「每个重绑 key 都能映射到真实单例构造点」：
   它在 `idx`（index.js 原文）上找 `VirtualPhone.<key> = new module.<Cls>(`。
   v3.61.0 的 O6 把这 67 处构造点搬进 config/app-lazy-routes.js（key / cls 两个字段），
   于是 A3 对 61 个 key 全数落空（报「表内有 key 全仓无对应构造点」）。
   修法：判据面换成**判据面 ∪ 表字段对**（表里 key 与 cls 成对，就是该构造点在表中的形态）。
   口径不变（仍是「每个 key 必须真有构造点」），只是把「构造点在哪」扩到表。

② tests/audit/lifecycle_declarative_probe.cjs 的三处读 `index.js`：
   槽位反查（slotsOf / SLOTS_RE）与散点扫描都要看到**表驱动的构造点**，
   否则「类 77 / 槽位 22 / App 槽位 14」低于下限、探针 exit 2 ⇒ v324 顶层断言失败。
   修法：探针里 IDX 一律取判据面（复用 tests/_lazy_routes.mjs，Node 24 支持 ESM require，
   探针是 .cjs 故走 require —— 实测 require('./tests/_lazy_routes.mjs') 可解析）。
   ★ 探针的 `--root` 支持保留（v324 的负控制要用合成副本）；
     副本目录里没有表文件属常态，此时回落真仓表（判据面的表那一半始终来自真源）。
"""
import ast
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
BACKUP = Path('/tmp/rp_v3610b9_backup')
BACKUP.mkdir(parents=True, exist_ok=True)
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b9] ast 自证通过')

fails = []

# ── ① v255 A3 ─────────────────────────────────────────────────────
p = ROOT / 'tests/system-v255.test.mjs'
src = p.read_text(encoding='utf-8')
OLD = """test('A3 每个 key 都能映射到真实单例构造点（防拼写错误静默 no-op）', () => {
  const miss = KEYS.filter((k) => !new RegExp('VirtualPhone\\\\.' + k + '\\\\s*=\\\\s*new\\\\s+module\\\\.').test(idx));
  assert.deepEqual(miss, [], '表内有 key 全仓无对应 `window.VirtualPhone.X = new module.Y(...)`：' + miss.join(','));
});"""
NEW = """test('A3 每个 key 都能映射到真实单例构造点（防拼写错误静默 no-op）', () => {
  /* [v3.61.0 · O6] 构造点面扩为「index.js 内联 ∪ 表字段对」：
   *   67 个懒加载 App 的 `window.VirtualPhone.X = new module.Y(` 已随表驱动搬进
   *   config/app-lazy-routes.js，那里 `key: "X"` 与 `cls: "Y"` 成对 —— 它就是该构造点
   *   在表中的形态（装配器 `new module[lazyRoute.cls](…)` 挂的正是 `[lazyRoute.key]`）。
   *   判断仍是「每个 key 必须真有构造点」，只是把「构造点在哪」扩到表；
   *   表缺席或行数不足即 fail-closed 抛（不静默放过）。 */
  const { parseLazyRoutes, LAZY_ROUTE_TABLE_REL } = require('./_lazy_routes.mjs');
  const rows = parseLazyRoutes(read(LAZY_ROUTE_TABLE_REL));
  assert.ok(rows.length >= 60, '表解析异常：只有 ' + rows.length + ' 行 —— 拒判');
  const miss = KEYS.filter((k) => {
    if (new RegExp('VirtualPhone\\\\.' + k + '\\\\s*=\\\\s*new\\\\s+module\\\\.').test(idx)) return false;
    return !rows.some((r) => r.key === k);
  });
  assert.deepEqual(miss, [], '表内有 key 全仓无对应构造点（`window.VirtualPhone.X = new module.Y(...)` 或表内 key/cls 成对）：' + miss.join(','));
});"""
n = src.count(OLD)
if n != 1:
    fails.append('①v255 A3 锚点命中 %d 次' % n)
else:
    src = src.replace(OLD, NEW)
    if '_lazy_routes.mjs' not in src.split('\n')[0]:
        # 顶层用 createRequire 接 ESM 共享模块（该件是 ESM 测试文件）
        lines = src.split('\n')
        last = max(i for i, l in enumerate(lines[:40]) if l.startswith('import '))
        lines.insert(last + 1, "import { createRequire } from 'node:module';")
        lines.insert(last + 2, "const require = createRequire(import.meta.url);")
        src = '\n'.join(lines)
    shutil.copy2(p, BACKUP / p.name)
    p.write_text(src, encoding='utf-8')
    print('[b9] ① v255 A3 构造点面扩到表')

# ── ② 探针 IDX 取判据面 ───────────────────────────────────────────
p = ROOT / 'tests/audit/lifecycle_declarative_probe.cjs'
src = p.read_text(encoding='utf-8')
m = re.search(r'^const IDX = .*$', src, re.M)
if not m:
    fails.append('②探针找不到 IDX 定义')
else:
    old_line = m.group(0)
    new_block = """/* [v3.61.0 · O6] 判据面：index.js 内联构造点 ∪ 懒加载路由表渲染回的同形构造点。
 *   67 处 `window.VirtualPhone.X = new module.Y(` 已搬进 config/app-lazy-routes.js，
 *   只读 index.js 会让槽位反查与散点扫描一起塌（实测「类 77 / 槽位 22 / App 槽位 14」
 *   低于下限 ⇒ 探针 exit 2 ⇒ v324 顶层断言失败）。扫描面跟着代码走，口径一字未改。
 *   探针是 .cjs：Node 24 支持 require ESM，故直接 require 共享单源。
 *   副本 root 里没有表文件属常态 ⇒ 回落真仓的表（表那一半始终取真源）。 */
const _lazyRoutes = require(path.join(__dirname, '..', '_lazy_routes.mjs'));
const _lazyTableFor = (dir) => {
  try { return fs.readFileSync(path.join(dir, 'config', 'app-lazy-routes.js'), 'utf8'); }
  catch (_e) { return _lazyRoutes.readRepoTable(); }
};
const IDX = _lazyRoutes.routeSurface(fs.readFileSync(idxPath, 'utf8'), _lazyTableFor(ROOT));"""
    src = src.replace(old_line, new_block)
    # 若有读 ROOT/index.js 的其它落点（如 LINES），一并让它们基于同一份面
    shutil.copy2(p, BACKUP / p.name)
    p.write_text(src, encoding='utf-8')
    print('[b9] ② 探针 IDX 改取判据面')
    print('    原行：%s' % old_line[:100])

if fails:
    sys.exit('[b9] 失败：' + ' | '.join(fails))
print('[b9] 完成')