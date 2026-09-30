# -*- coding: utf-8 -*-
"""nuo_extract.py — 把 xintuk 分片载荷（JS 字符串字面量）解成真源码文本。

用法：
  python3 nuo_extract.py <分片目录或文件...> --out <输出路径>

原理：分片是 `(globalThis.__tukSourceBundles["x.js"] ??= []).push("<转义源码>");`
  ⇒ 取出 push( 后的字符串字面量，按 JS 字符串转义规则解码（json.loads 覆盖 \\n \\r \\t \\" \\\\ \\uXXXX）。
"""
import io
import json
import os
import re
import sys


def decode_file(path):
    raw = io.open(path, encoding='utf-8', errors='replace').read()
    out = []
    for m in re.finditer(r'\.push\(("(?:[^"\\]|\\.)*")\)', raw, re.S):
        lit = m.group(1)
        try:
            out.append(json.loads(lit))
        except Exception as e:      # 兜底：按最少的手工替换
            t = lit[1:-1].replace('\\r\\n', '\n').replace('\\n', '\n').replace('\\"', '"')
            out.append('/* decode-fallback: %s */\n' % e + t)
    return '\n'.join(out)


def main():
    args = [a for a in sys.argv[1:]]
    out = None
    if '--out' in args:
        i = args.index('--out')
        out = args[i + 1]
        args = args[:i] + args[i + 2:]
    chunks = []
    for a in args:
        if os.path.isdir(a):
            for name in sorted(os.listdir(a)):
                if name.endswith('.js'):
                    chunks.append(decode_file(os.path.join(a, name)))
        else:
            chunks.append(decode_file(a))
    text = '\n'.join(chunks)
    if out:
        io.open(out, 'w', encoding='utf-8').write(text)
        print('wrote %s (%d chars)' % (out, len(text)))
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()