#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x4k.py — [v4.28.0 · R4-X4 补丁 K] 滞后台账三格的 upstreamCommit 跟随复核

R4-X4 补上游 branchCanon 行后，本仓冻读取由 30feb80 前进到 598d72d（R9/R11 提示
「上游已前进，该条须复核是否仍成立」）。逐条复核结论：三条分歧**仍成立**
（relationHistory / causalChain / perspectiveCard 在新表里依旧写 none@0），
故把三格的 upstreamCommit 更新为当次冻读取的来源提交。

为什么必须更新：`upstreamCommit` 这一格答的是「上游一提交这条还成不成立」——
留着旧提交号，下一次复核的人无从判断这条是否已经过期。更新它 = 把「已复核」
这件事落成读数，而不是留一句口头结论。
"""
import io
import sys

LAG = '/home/user/ruby-phone/tests/audit/upstream_face_lag.json'
WRITE = '--write' in sys.argv
NEW_COMMIT = '598d72d'

OLD = ['"upstreamCommit": "30feb80"', '"upstreamCommit": "afb6071"', '"upstreamCommit": "0f2f7fd"']


def main():
    s = io.open(LAG, encoding='utf-8').read()
    if '"upstreamCommit": "' + NEW_COMMIT + '"' in s and all(o not in s for o in OLD):
        print('· 三格已全部更新，跳过')
        return 0
    total = 0
    for o in OLD:
        n = s.count(o)
        print('  锚点 ' + o + ' 命中 ' + str(n) + ' 次')
        if n != 1:
            print('!! 锚点失配，abort（文件未改）')
            return 1
        total += 1
    for o in OLD:
        s = s.replace(o, '"upstreamCommit": "' + NEW_COMMIT + '"', 1)
    if not WRITE:
        print('--- DRY RUN（补 --write 才落盘） ---')
        return 0
    io.open(LAG, 'w', encoding='utf-8').write(s)
    print('--- WRITTEN K（滞后台账 ' + str(total) + ' 格） ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())