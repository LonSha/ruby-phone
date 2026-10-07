#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""recount_v3650.py — 重算 v3.65.0 体量基线（零手抄，全现场取）。"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


def sh(c):
    return subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()


js = []
for r, ds, fs in os.walk('.'):
    ds[:] = [d for d in ds if d not in ('.git', 'node_modules')]
    for f in fs:
        if f.endswith('.js'):
            js.append(os.path.join(r, f))
lines = 0
for p in js:
    with open(p, encoding='utf-8', errors='ignore') as fh:
        lines += sum(1 for _ in fh)
apps_js = [f for r, _, fs in os.walk('apps') for f in fs if f.endswith('.js')]
apps_dirs = [d for d in os.listdir('apps') if os.path.isdir(os.path.join('apps', d))]
config_js = [f for f in os.listdir('config') if f.endswith('.js')]
suites = [f for f in os.listdir('tests') if f.endswith('.test.mjs')]

out = {
    'js_total': len(js),
    'js_lines': lines,
    'apps_dirs': len(apps_dirs),
    'apps_js': len(apps_js),
    'config_js': len(config_js),
    'tests_suites': len(suites),
    'index_bytes': os.path.getsize('index.js'),
    'index_lines': sum(1 for _ in open('index.js', encoding='utf-8')),
    'ap_id': sh("grep -c \"^    { id: '\" config/apps.js"),
    'matrix_len': sh("node -e \"import('./config/app-consumption-matrix.js').then(m=>console.log(m.MATRIX.length))\""),
    'lazy_rows': sh("grep -c \"^    '\" config/app-lazy-routes.js"),
}
print(json.dumps(out, ensure_ascii=False, indent=1))
