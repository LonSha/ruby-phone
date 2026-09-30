#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清理基线里的**中间态**：删掉 rebuilds['v3.23.2'] 与 corrections 里那条
【v3.23.2 · B2 迁移…】（同一件事被记了两遍 —— 因为刷新脚本先以 v3.23.2 跑过一次）。
保留 v3.23.3 那一条（终态）。幂等。
"""
import io
import json
import os
import shutil
import sys

P = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 'tests/audit/memory_growth_baseline.json')
BAK = os.path.join(os.environ.get('RPWORK', '/sdcard/rpwork'),
                   'bak3233_baseline_preclean.json')
STALE = 'v3.23.2'


def die(m):
    print('✗ ' + m)
    sys.exit(1)


def main():
    d = json.load(io.open(P, encoding='utf-8'))
    if d['measured_at'] != 'v3.23.3':
        die('measured_at 不是 v3.23.3，实测 %s —— 先刷新再清理' % d['measured_at'])
    if 'v3.23.3' not in d['rebuilds']:
        die('rebuilds 缺 v3.23.3 键')
    if STALE not in d['rebuilds']:
        print('· rebuilds 里已无 %s（幂等跳过）' % STALE)
        return
    if d['rebuilds'][STALE].get('why') != d['rebuilds']['v3.23.3'].get('why'):
        die('中间态与终态的 why 不同 —— 不是同一次迁移，不能删')

    if not os.path.exists(BAK):
        shutil.copyfile(P, BAK)
        print('· 备份 → ' + BAK)

    del d['rebuilds'][STALE]
    before = len(d['corrections'])
    d['corrections'] = [c for c in d['corrections']
                        if not c.startswith(u'【' + STALE + u' · B2 迁移（unmeasurable 4 → 3）】')]
    if len(d['corrections']) not in (before - 1, before):
        die('corrections 删多了（%d → %d）' % (before, len(d['corrections'])))
    if not any(c.startswith(u'【v3.23.3 · B2 迁移（unmeasurable 4 → 3）】') for c in d['corrections']):
        die('终态 corrections 那条不在场')

    if STALE in d['rebuilds']:
        die('清理失败：遗留键仍在')
    if any(c.startswith(u'【' + STALE + u' · B2 迁移') for c in d['corrections']):
        die('清理失败：corrections 中间态仍在')
    if len(d['unmeasurable']) != 3 or len(d['approx_measurable']) != 1:
        die('清理破坏了迁移读数')

    io.open(P, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    print('✓ 中间态已清理：rebuilds=%s · corrections %d → %d'
          % (','.join(d['rebuilds'].keys()), before, len(d['corrections'])))


if __name__ == '__main__':
    main()