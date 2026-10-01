#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""doc3420.py — v3.42.0 抬版连带面：边界文档复校（记录 + 幂等校验）。
本版复校做了三件事（已完成，本脚本**只校验不再改写**，重复跑安全）：
  ① 标题行改为「# ruby-phone 运行时验证边界（v2.82.0 起；**v3.42.0 复校**）」；
  ② 实测规模行与两行契约行用**现场读数**刷新（零手抄）：
     语法门 559 文件 · 导入 329 文件 515 条（另 120 条动态 import 不计入判据）；
  ③ 追加 v3.42.0 复校段（定位纠正 / 四块不缝逐条 / 本版自抓真缺陷 / 判据侧自身错 / R-O3 三条）。
用法：python3 tools/doc3420.py            # 校验（幂等）
"""
import io
import json
import re
import subprocess
ROOT = '/home/user/ruby-phone'
DOC = ROOT + '/docs/runtime-verification-boundary.md'
VER = '3.42.0'
with io.open(DOC, encoding='utf-8') as f:
    doc = f.read()
checks = []
checks.append(('标题行带本版复校标记', 'v%s 复校' % VER in doc))
checks.append(('含「未验证」标注（该文档存在的理由）', '未验证' in doc))
checks.append(('含「一句话版本」节（用户可读入口）', '一句话版本' in doc))
checks.append(('含同源标志语（user 侧条目共用同一句）', '看起来没坏但显示不对' in doc))
checks.append(('含 v%s 复校段' % VER, ('v%s 复校' % VER) in doc))
checks.append(('写明本版新增的可观测面', '可回源' in doc or '工作树态' in doc))
# 现场读数（零手抄：真跑两道门）
syn = subprocess.run(['node', 'scripts/syntax-check.mjs'], cwd=ROOT, capture_output=True, text=True)
imp = subprocess.run(['node', 'scripts/import-resolve-check.mjs'], cwd=ROOT, capture_output=True, text=True)
assert syn.returncode == 0 and imp.returncode == 0, '两道读数门必须跑通'
n_syn = re.search(r'语法门通过：(\d+) 个文件', syn.stdout).group(1)
m_imp = re.search(r'扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条', imp.stdout)
n_files, n_specs = m_imp.group(1), m_imp.group(2)
checks.append(('语法读数与文档一致（%s 文件）' % n_syn, ('语法 %s 文件' % n_syn) in doc))
checks.append(('导入读数与文档一致（%s 文件 %s 条）' % (n_files, n_specs),
               ('导入 %s 文件 %s 条' % (n_files, n_specs)) in doc))
checks.append(('契约-语法行在场', ('- 语法 %s 文件' % n_syn) in doc))
checks.append(('契约-导入行在场', ('- 导入 %s 文件 %s 条' % (n_files, n_specs)) in doc))
man = json.loads(io.open(ROOT + '/manifest.json', encoding='utf-8').read())
checks.append(('文档复校版本 = 当版（%s）' % man['version'],
               ('v%s 复校' % man['version']) in doc))
ok = True
for name, val in checks:
    print('  %s %s' % ('✓' if val else '✗', name))
    ok = ok and val
print('现场读数：语法 %s 文件 · 导入 %s 文件 %s 条' % (n_syn, n_files, n_specs))
print('✓ 边界文档复校面完整' if ok else '✗ 有缺项')
