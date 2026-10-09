# -*- coding: utf-8 -*-
"""侦察 A1–A7 的接缝现状（只读、紧凑输出）。"""
import io
import os
import re
import subprocess

R = '/home/user/ruby-phone'


def sh(c):
    return subprocess.run(c, shell=True, cwd=R, capture_output=True, text=True).stdout


def rd(p):
    with io.open(os.path.join(R, p), encoding='utf-8') as f:
        return f.read()


o = []
o.append('=== A1: worldbook-manager 出口 ===')
s = rd('config/worldbook-manager.js')
o.append('bytes=%d lines=%d' % (len(s), s.count('\n') + 1))
o.append(' | '.join(re.findall(r'export (?:async )?function (\w+)', s)))
o.append('write-ish: ' + ' '.join(sorted(set(re.findall(r'\b(saveWorldInfo|updateWorldInfoList|upsertEntry|createWorldInfoEntry|deleteWorldInfoEntry|loadWorldInfo)\b', s)))))
o.append('=== A2/A4: memory 目录 ===')
o.append(sh('ls apps/memory')[:400])
o.append('=== A4: _matchByKeywords ===')
o.append(sh("grep -rn '_matchByKeywords\\|matchByKeywords' apps config | head -10")[:600])
o.append('=== A5: injection-contract ===')
s2 = rd('config/injection-contract.js')
o.append('bytes=%d' % len(s2))
o.append(' | '.join([a or b for a, b in re.findall(r'export (?:async )?function (\w+)|export const (\w+)', s2)]))
o.append('budget tok: ' + ' '.join(sorted(set(re.findall(r'\b(\w*[Bb]udget\w*)\b', s2)))[:20]))
o.append('=== A7: callAI / generateRaw ===')
o.append(sh("grep -rn 'callAI\\|generateRaw' config/api-manager.js | head -12")[:700])
o.append('=== A6: portable 范式 ===')
o.append(sh('ls config | tr "\\n" " "')[:700])
o.append('=== B 类: ruby_stitch 现场 ===')
o.append(sh('ls /home/ruby_stitch | tr "\\n" " "')[:400])
o.append(sh('ls /home/ruby_stitch/tools 2>/dev/null | tail -20 | tr "\\n" " "')[:400])
print('\n'.join(o)[:5000])
