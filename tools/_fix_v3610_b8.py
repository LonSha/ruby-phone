#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ruby-phone v3.61.0 收口 · 批次 B8：lazy 闸作用域真缺陷 + 三份探针基线 + 文档读数。

① scripts/dead-export-check.mjs 的 lazy-route 闸**没有作用域限制**（真缺陷）：
      if (!FIXTURE_MODE && LAZY_CLS_SET.size < 60) { …exit 2 }
   它对**任何 --root** 都生效 —— 而负控制用的是「合成小仓 + 不开夹具 + --root 指向
   合成仓」通道（tests/system-v268.test.mjs 的 v268-N1 注释明写「不开夹具 ⇒ E10 启用」）。
   在那些 root 里根本不存在 config/app-lazy-routes.js，于是闸当场 exit 2 并霸占了
   整个错误面 ⇒ N1 等到的不是「白名单条目存活自证失败」而是「lazy-route 表解析异常」，
   断言直接失配（实测复现：临时目录里只放 `export const onlyNamed = 1;`，rc=2 且只报
   lazy-route 一条）。
   口径修正：该闸只在**真仓**（未传 --root）上成立 —— 表是本仓的产线文件，合成仓没有它
   不是「结构漂移」。夹具通道的独立下限（MIN_EXPORTS=1）与「产物面」判定照旧。

② 三份探针基线各差 1：本版新增 tests/_lazy_routes.mjs（O6 判据面共享单源）。
   · schedule_conflict_baseline.json：files_scanned 370 → 371
   · branch_play_baseline.json：files_scanned 370 → 371
   · long_chat_baseline.json：scan.files 371 → 372，并同步 L5 判据散文（否则
     assertLongChatCriteria 的「散文必须与现场复算一致」当场转红）。
   三个探针的扫描面都是 apps/** + config/** + 该模块自身（SELF 计入 +1），
   故新增件即 +1 —— 与各基线文件历代记录的「新增件即增量」口径同规。

③ docs/runtime-verification-boundary.md 的机器可读契约行「语法 637 文件」→
   **638 文件**（v328 C1 会跑真门禁比对；不改即红）。同一处的 v3.61.0 复校说明
   补上这一个增量的来由。

锚点纪律：每处恰中预期次数，失配即退出且不写盘。
"""
import ast
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/home/user/ruby-phone')
BACKUP = Path('/tmp/rp_v3610b8_backup')
BACKUP.mkdir(parents=True, exist_ok=True)
ast.parse(Path(__file__).read_text(encoding='utf-8'))
print('[b8] ast 自证通过')

fails = []

# ── ① lazy 闸作用域 ────────────────────────────────────────────────
p = ROOT / 'scripts/dead-export-check.mjs'
src = p.read_text(encoding='utf-8')
OLD = "if (!FIXTURE_MODE && LAZY_CLS_SET.size < 60) {"
NEW = """/* ★ 作用域：只对**真仓**成立（未传 --root 时 REAL_REPO=true）。
 *   为什么必须有这一层：负控制走的是「合成小仓 + 不开夹具 + --root 指向合成仓」
 *   通道（v268-N1 注释明写「不开夹具 ⇒ E10 启用」），那些 root 里没有产线的
 *   config/app-lazy-routes.js —— 那是**合成仓的常态**，不是本仓的结构漂移。
 *   少了这层，闸会在合成仓上抢先 exit 2、霸占整个错误面，让 E10 的存活自证读不到
 *   （实测：临时目录放一个 `export const onlyNamed = 1;` ⇒ rc=2 且只报 lazy-route）。 */
if (REAL_REPO && !FIXTURE_MODE && LAZY_CLS_SET.size < 60) {"""
n = src.count(OLD)
if 'const REAL_REPO = rootIdx < 0;' in src:
    print('[b8] ① dead-export 闸已是真仓作用域，跳过（幂等）')
elif n != 1:
    fails.append('①lazy 闸锚点命中 %d 次' % n)
else:
    src = src.replace(OLD, NEW)
    # 定义 REAL_REPO（紧跟 root 解析之后）
    anchor = 'const listMode = args.includes(\'--list\');'
    if src.count(anchor) != 1:
        fails.append('①REAL_REPO 插入锚点命中 %d 次' % src.count(anchor))
    else:
        src = src.replace(anchor, ('// 真仓判定：未传 --root 即真仓（产线文件与产线基线只对真仓成立）\n'
                                   'const REAL_REPO = rootIdx < 0;\n' + anchor))
        shutil.copy2(p, BACKUP / 'dead-export-check.mjs')
        p.write_text(src, encoding='utf-8')
        print('[b8] ① dead-export lazy 闸加真仓作用域')

# ── ② 三份探针基线：用**探针现场读数**写回（零手抄，不猜增量）────────
import subprocess


def probe_root_value(probe_rel, getter):
    r = subprocess.run(['node', str(ROOT / probe_rel), '--json'],
                       cwd=str(ROOT), capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        fails.append('②探针 %s rc=%d：%s' % (probe_rel, r.returncode, (r.stderr or '')[:200]))
        return None
    return getter(json.loads(r.stdout))


# schedule / branch：探针**现场输出**里的 filesScanned（基线的 readings 是它的转写面）
for rel, probe, key in [
    ('tests/audit/schedule_conflict_baseline.json', 'tests/audit/schedule_conflict_probe.cjs', 'files_scanned'),
    ('tests/audit/branch_play_baseline.json', 'tests/audit/branch_play_probe.cjs', 'files_scanned'),
]:
    live = probe_root_value(probe, lambda d: d['filesScanned'])
    if live is None:
        continue
    fp = ROOT / rel
    doc = json.loads(fp.read_text(encoding='utf-8'))
    old_v = doc['readings'][key]
    if old_v == live:
        print('[b8] ② %s：%s 已是现场读数 %s，跳过' % (fp.name, key, live))
        continue
    doc['readings'][key] = live
    shutil.copy2(fp, BACKUP / fp.name)
    fp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('[b8] ② %s：%s %s → %s（现场读数）' % (fp.name, key, old_v, live))

# long_chat：scan 全项 + L5 散文同步
live_scan = probe_root_value('tests/audit/long_chat_probe.cjs', lambda d: d['scan'])
if live_scan is not None:
    fp = ROOT / 'tests/audit/long_chat_baseline.json'
    doc = json.loads(fp.read_text(encoding='utf-8'))
    old_scan = dict(doc['scan'])
    l5 = next((c for c in doc['criteria'] if c['id'] == 'L5'), None)
    if not l5:
        fails.append('②long_chat 基线缺 L5')
    else:
        doc['scan'] = live_scan
        txt = l5['got_text']
        pairs = [('files', live_scan['files']), ('全表物化', live_scan['full_materialize']),
                 ('slice(-n)', live_scan['bounded_slice']), ('下标直取', live_scan['indexed_loop']),
                 ('长度读', live_scan['length_read'])]
        for label, val in pairs:
            txt = re.sub(re.escape(label) + r'=\d+', '%s=%d' % (label, val), txt)
        l5['got_text'] = txt
        shutil.copy2(fp, BACKUP / fp.name)
        fp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print('[b8] ② long_chat_baseline.json：scan %s → %s；L5 散文已同步'
              % (old_scan, live_scan))

# ── ③ 文档机器可读契约行：以门禁**现场真读数**写回（零手抄 + 幂等）──────
fp = ROOT / 'docs/runtime-verification-boundary.md'
doc = fp.read_text(encoding='utf-8')
m = re.search(r'^- 语法 (\d+) 文件\s*$', doc, re.M)
live_m = subprocess.run(['node', str(ROOT / 'scripts/syntax-check.mjs')],
                        cwd=str(ROOT), capture_output=True, text=True, timeout=300)
live = re.search(r'语法门通过：(\d+) 个文件', live_m.stdout or '')
if not m:
    fails.append('③文档「语法 N 文件」行未命中')
elif not live:
    fails.append('③语法门未报出文件数（rc=%d）' % live_m.returncode)
elif int(m.group(1)) == int(live.group(1)):
    print('[b8] ③ 文档契约行已是现场读数 %s，跳过' % live.group(1))
else:
    before = m.group(1)
    doc = doc.replace(m.group(0), '- 语法 %s 文件' % live.group(1), 1)
    # v3.61.0 复校说明补这一个增量的来由（只做一次；已改写则旧句 0 命中）
    old_note = '语法面 625 -> **637**。'
    if doc.count(old_note) == 1:
        doc = doc.replace(old_note,
                          '语法面 625 -> **%s**（`tests/` 层面又新增一件：`tests/_lazy_routes.mjs`——O6 判据面共享单源，'
                          '把表行渲染回同形分支供 40 个套件复用）。' % live.group(1))
    shutil.copy2(fp, BACKUP / fp.name)
    fp.write_text(doc, encoding='utf-8')
    print('[b8] ③ 文档契约行 语法 %s → %s 文件（现场读数）' % (before, live.group(1)))

if fails:
    sys.exit('[b8] 失败：' + ' | '.join(fails))
print('[b8] 完成')