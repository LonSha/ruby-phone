# -*- coding: utf-8 -*-
"""侦察接缝代码：worldbook 读链路 / memory-pool 关键词匹配 / injection budget。"""
import io
import os
import subprocess

R = '/home/user/ruby-phone'


def sh(c):
    return subprocess.run(c, shell=True, cwd=R, capture_output=True, text=True).stdout


o = []
o.append('=== worldbook-manager: loadWorldInfo 语境 ===')
o.append(sh("grep -n 'loadWorldInfo\\|context\\|world_names\\|getContext\\|export ' config/worldbook-manager.js | head -40"))
o.append('=== worldbook-manager: 头部 60 行 ===')
o.append(sh('sed -n "1,60p" config/worldbook-manager.js'))
print('\n'.join(o)[:6000])