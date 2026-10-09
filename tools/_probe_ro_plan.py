# -*- coding: utf-8 -*-
"""侦察：R-O 计划各切片的落地现状（只读，输出压到最小）。"""
import io
import json
import os
import subprocess

R = '/home/user/ruby-phone'


def sh(c):
    return subprocess.run(c, shell=True, cwd=R, capture_output=True, text=True).stdout


def rd(p):
    with io.open(os.path.join(R, p), encoding='utf-8') as f:
        return f.read()


out = []
out.append('--- package scripts ---')
pkg = json.loads(rd('package.json'))
out.append(' '.join(pkg['scripts'].keys()))
out.append('--- browser files ---')
out.append(sh('ls tests/browser | tr "\\n" " "'))
out.append(sh('ls tests/browser/scenarios | wc -l'))
out.append('--- gate.mjs head 40 ---')
out.append('\n'.join(rd('tests/browser/gate.mjs').split('\n')[:40]))
out.append('--- pkg browser script ---')
for k in pkg['scripts']:
    if 'browser' in k or 'host' in k or 'scen' in k:
        out.append(k + ' = ' + pkg['scripts'][k][:200])
out.append('--- chromium availability ---')
out.append(sh('which chromium chromium-browser google-chrome 2>/dev/null; ls ~/.cache/ms-playwright 2>/dev/null | head'))
print('\n'.join(out)[:4000])
