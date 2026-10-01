#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""recon_pv.py — 源「Perigee OS · ニコニコ 音乐PV工房」开块（只读源，产物落 /sdcard）。

产物:
  /sdcard/Download/nuo_sources/nuo3/live/blk_pv.txt   全族函数骨架（注释头 + 常量 + 方法体）
  /sdcard/Download/nuo_sources/nuo3/live/blk_pv.json  方法清单（名 / 文件 / 行 / 体行数）

用法: python3 recon_pv.py [--src DIR] [--out DIR]
"""
import json
import os
import re
import sys

SRC_DEFAULT = '/sdcard/Download/nuo_sources/nuo3/src_perigee/js'
OUT_DEFAULT = '/sdcard/Download/nuo_sources/nuo3/live'
FILES = ['niconico.js', 'niconico-pv-form.js', 'niconico-pv-media.js',
         'niconico-pv-storyboard.js', 'niconico-pv-submit.js', 'niconico-pv-frames.js',
         'niconico-pv-lyrics.js']

METHOD_RE = re.compile(r'^    ([a-zA-Z_$][\w$]*)\s*\(')
CONST_RE = re.compile(r'^    ([A-Z_][A-Z0-9_]*)\s*:')


def balanced(lines, start, cap=400):
    """从 start 行按「花括号 + 方括号」净计取到配平那一行为止。"""
    body = []
    depth = 0
    for line in lines[start:start + cap]:
        body.append(line)
        depth += line.count('{') - line.count('}')
        depth += line.count('[') - line.count(']')
        if depth <= 0 and len(body) > 1:
            break
    return body


def extract(src_dir):
    chunks = []
    methods = []
    for fn in FILES:
        path = os.path.join(src_dir, fn)
        text = open(path, encoding='utf-8').read()
        lines = text.split('\n')
        head = []
        for line in lines[:24]:
            head.append(line)
            if line.strip() and not line.strip().startswith('//'):
                break
        bucket = {'file': fn, 'lines': len(lines), 'chars': len(text),
                  'header': head, 'constants': [], 'methods': []}
        chunks.append(bucket)
        i = 0
        while i < len(lines):
            m = METHOD_RE.match(lines[i])
            c = CONST_RE.match(lines[i])
            if m:
                body = balanced(lines, i)
                bucket['methods'].append({'name': m.group(1), 'line': i + 1, 'body': body})
                methods.append({'file': fn, 'name': m.group(1), 'line': i + 1,
                                'body_lines': len(body)})
                i += len(body)
                continue
            if c:
                body = balanced(lines, i, cap=200)
                bucket['constants'].append({'name': c.group(1), 'line': i + 1, 'body': body})
                i += len(body)
                continue
            i += 1
    return chunks, methods


def render(chunks):
    out = []
    total_m = sum(len(c['methods']) for c in chunks)
    out.append('=' * 78)
    out.append('源：Perigee OS · ニコニコ 音乐PV工房（js/niconico*.js）')
    out.append('文件 %d / 方法 %d' % (len(chunks), total_m))
    out.append('=' * 78)
    for c in chunks:
        out.append('')
        out.append('#' * 78)
        out.append('# [%s]  %d 行 / %d 字符 / 方法 %d / 常量 %d'
                   % (c['file'], c['lines'], c['chars'], len(c['methods']), len(c['constants'])))
        out.append('#' * 78)
        out.append('  ── 头部注释 ──')
        for line in c['header']:
            out.append('  ' + line)
        if c['constants']:
            out.append('  ── 常量表 ──')
            for k in c['constants']:
                out.append('  ── %s (:%d) ──' % (k['name'], k['line']))
                for line in k['body']:
                    out.append('  ' + line)
        out.append('  ── 方法 ──')
        for m in c['methods']:
            out.append('  ~~~ %s (:%d, %d 行) ~~~' % (m['name'], m['line'], len(m['body'])))
            for line in m['body']:
                out.append('  ' + line)
    return '\n'.join(out)


if __name__ == '__main__':
    src = SRC_DEFAULT
    outd = OUT_DEFAULT
    if '--src' in sys.argv:
        src = sys.argv[sys.argv.index('--src') + 1]
    if '--out' in sys.argv:
        outd = sys.argv[sys.argv.index('--out') + 1]
    chunks, methods = extract(src)
    os.makedirs(outd, exist_ok=True)
    text = render(chunks)
    with open(os.path.join(outd, 'blk_pv.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    with open(os.path.join(outd, 'blk_pv.json'), 'w', encoding='utf-8') as f:
        json.dump({'files': [{k: c[k] for k in ('file', 'lines', 'chars')} for c in chunks],
                   'methods': methods}, f, ensure_ascii=False, indent=1)
    print('blk_pv.txt %d 字符' % len(text))
    print('方法合计 %d' % len(methods))
    for c in chunks:
        print('  %-28s 行 %5d 方法 %3d 常量 %2d'
              % (c['file'], c['lines'], len(c['methods']), len(c['constants'])))