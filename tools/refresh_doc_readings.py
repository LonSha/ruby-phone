#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refresh_doc_readings.py — R-O9「计划、版本、门禁与基线自动同源」的取数臂。

问题（R-O9 原文）：「`PLAN.md`、`TODO.md`、`ITERATION_LOG.md` 与真实 HEAD 之间
仍存在历史快照混杂……台账表**没有判据看守**，每次抬版靠人肉复算。」

本工具治的就是「人肉复算」这四个字：它**现场跑**两道门（syntax / import-resolve），
把 stdout 里的真读数解析出来，写回 `docs/runtime-verification-boundary.md` 的
「五、当版实测数字」两行，并同步当版复校标记。

为什么必须现场跑而不是「从某个常量读」：
  文档里那两行声称的是「实测」。读数一旦来自常量/缓存，就再也分不清
  「实测」与「抄的旧数」—— 而本仓当前的两例红（C1 / E2）正是这么来的：
  文档停在 663 / 654，真跑是 678 / 655，两侧都在绿，谁也没响。

**只写两行 + 复校标记 + 一段来由**，其余一个字不碰：
  边界文档的正文是历史台账（追加式，不删），自动器只允许写它明确拥有的那几格。
  越权改写正文会把「历史留痕」变成「自动器随口说的话」。

用法：
  python3 tools/refresh_doc_readings.py            # 干跑：只打印将要改成什么
  python3 tools/refresh_doc_readings.py --write    # 真写
  python3 tools/refresh_doc_readings.py --why "..." --write
退出码：0 = 一致（无需改动或已写入）；1 = 干跑下发现漂移（CI 可据此转红）；2 = 取数失败。
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = 'docs/runtime-verification-boundary.md'
NL = chr(10)
WRITE = '--write' in sys.argv


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def run_gate(script):
    """跑一道门，返回 stdout。非 0 退出即取数失败（不许带着半个读数往下走）。"""
    p = subprocess.run(['node', os.path.join('scripts', script)], cwd=ROOT,
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        print('[refresh-doc] 门 %s 退出码 %d，取数失败' % (script, p.returncode))
        sys.exit(2)
    return p.stdout


def flag(name, default=None):
    pre = '--' + name + '='
    for a in sys.argv:
        if a.startswith(pre):
            return a[len(pre):]
    return default


def main():
    # ── 版本面：三源同源校验（不同源就不许写文档，否则写进去的版本号是假的）
    pkg = json.loads(rd('package.json'))
    man = json.loads(rd('manifest.json'))
    ul = json.loads(rd('update-log.json'))
    v_pkg, v_man, v_latest = pkg['version'], man['version'], ul['latest']
    if not (v_pkg == v_man == v_latest):
        print('[refresh-doc] 版本三源不同源：package=%s manifest=%s update-log=%s' % (v_pkg, v_man, v_latest))
        return 2
    ver = v_pkg

    # ── 真跑两道门，取真读数
    syn_out = run_gate('syntax-check.mjs')
    imp_out = run_gate('import-resolve-check.mjs')
    m_syn = re.search(r'语法门通过：(\d+) 个文件', syn_out)
    m_imp = re.search(r'扫描 (\d+) 个文件 · 静态相对导入 (\d+) 条', imp_out)
    if not m_syn:
        print('[refresh-doc] 语法门未报出文件数（口径可能被静默改动）')
        return 2
    if not m_imp:
        print('[refresh-doc] 导入门未报出扫描面与条数（口径可能被静默改动）')
        return 2
    live = {
        'syntax_files': int(m_syn.group(1)),
        'import_files': int(m_imp.group(1)),
        'import_specs': int(m_imp.group(2)),
    }

    doc = rd(DOC)
    m_doc_syn = re.search(r'- 语法 (\d+) 文件', doc)
    m_doc_imp = re.search(r'- 导入 (\d+) 文件 (\d+) 条', doc)
    if not m_doc_syn or not m_doc_imp:
        print('[refresh-doc] 文档缺「当版实测数字」两行（判据的取数面已被破坏）')
        return 2
    on_disk = {
        'syntax_files': int(m_doc_syn.group(1)),
        'import_files': int(m_doc_imp.group(1)),
        'import_specs': int(m_doc_imp.group(2)),
    }

    drift = {k: (on_disk[k], live[k]) for k in live if on_disk[k] != live[k]}
    recert = ('v' + ver + ' 复校') in doc
    print('[refresh-doc] ver=%s' % ver)
    print('[refresh-doc] live  syntax=%d import=%d/%d'
          % (live['syntax_files'], live['import_files'], live['import_specs']))
    print('[refresh-doc] disk  syntax=%d import=%d/%d'
          % (on_disk['syntax_files'], on_disk['import_files'], on_disk['import_specs']))
    for k in sorted(drift):
        a, b = drift[k]
        print('[refresh-doc]   漂移 %s: %d -> %d' % (k, a, b))
    print('[refresh-doc] 当版复校标记（v%s 复校）：%s' % (ver, '在场' if recert else '**缺席**'))

    if not drift and recert:
        print('[refresh-doc] 已一致，无需改动')
        return 0

    if not WRITE:
        print('[refresh-doc] 干跑：以上为将要写入的内容（加 --write 生效）')
        return 1

    # ── 写：只动两行数字 + 复校标记（+ 可选一段来由）
    new_doc = re.sub(r'- 语法 \d+ 文件', '- 语法 %d 文件' % live['syntax_files'], doc, count=1)
    new_doc = re.sub(r'- 导入 \d+ 文件 \d+ 条',
                     '- 导入 %d 文件 %d 条' % (live['import_files'], live['import_specs']),
                     new_doc, count=1)
    why = flag('why', '')
    if why:
        note = ('（**v%s 复校**：%s。★ 本两行由 `tools/refresh_doc_readings.py` 现场跑两道门后写入，'
                '不手抄；该工具干跑模式在发现漂移时返回 1，可直接挂进 CI。）' % (ver, why))
        lines = new_doc.split(NL)
        for i, l in enumerate(lines):
            if l.startswith('- 导入 ') and ' 条' in l:
                lines.insert(i + 1, note)
                break
        new_doc = NL.join(lines)
    if not recert:
        # 标题行里的复校标记（既有形态：**v3.72.0 复校**）
        new_doc = re.sub(r'（\*\*v[\d.]+ 复校\*\*）', '（**v%s 复校**）' % ver, new_doc, count=1)
    wr(DOC, new_doc)
    print('[refresh-doc] 已写入：syntax=%d import=%d/%d recert=%s'
          % (live['syntax_files'], live['import_files'], live['import_specs'], ver))
    return 0


if __name__ == '__main__':
    sys.exit(main())