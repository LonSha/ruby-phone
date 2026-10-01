#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe3350.py — 取 v3.35.0 判据要用的**真值**（门槛一律现场实测，不凭记忆写）。"""
import json
import re
import subprocess
import sys

ROOT = '/home/user/ruby-phone'
DATA = ROOT + '/apps/pixiv/pixiv-data.js'
APP = ROOT + '/apps/pixiv/pixiv-app.js'
VIEW = ROOT + '/apps/pixiv/pixiv-view.js'


def rd(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def strip(src):
    """与测试同款剥注释器（字符状态机，不解析正则字面量）。"""
    out = []
    i = 0
    n = len(src)
    state = 'code'
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ''
        if state == 'code':
            if c == '/' and d == '/':
                state = 'line'; i += 2; continue
            if c == '/' and d == '*':
                state = 'block'; i += 2; continue
            if c in ("'", '"', '`'):
                state = c; out.append(c); i += 1; continue
            out.append(c); i += 1; continue
        if state == 'line':
            if c == '\n':
                state = 'code'; out.append(c)
            i += 1; continue
        if state == 'block':
            if c == '*' and d == '/':
                state = 'code'; i += 2; continue
            i += 1; continue
        if c == '\\':
            out.append(c + d); i += 2; continue
        out.append(c); i += 1
        if c == state:
            state = 'code'
    return ''.join(out)


data_src = strip(rd(DATA))
app_src = strip(rd(APP))
view_src = strip(rd(VIEW))

print('=== 1. 生产文件体积 ===')
for rel in ['apps/pixiv/pixiv-data.js', 'apps/pixiv/pixiv-app.js', 'apps/pixiv/pixiv-view.js', 'apps/pixiv/pixiv.css']:
    src = rd(ROOT + '/' + rel)
    print('%-32s %5d 行 / %6d 字节' % (rel, src.count('\n') + 1, len(src.encode('utf-8'))))

print('\n=== 2. 视图调用面与 App 方法集合差 ===')
calls = set(re.findall(r'app\.([a-zA-Z_][a-zA-Z0-9_]*)\(', view_src))
methods = set(re.findall(r'^    ([a-zA-Z_][a-zA-Z0-9_]*)\(', app_src, re.M))
missing = sorted(calls - methods)
print('视图调用 %d 个 / App 方法 %d 个 / 差集 %d 个' % (len(calls), len(methods), len(missing)))
print('差集：', missing if missing else '（空 = 调用面闭合）')

print('\n=== 3. 禁词活性面（剥注释后逐文件计数）===')
BAN = ['fetch(', 'XMLHttpRequest', 'callChatAPI', 'imageApiConfig', 'NovelAI', 'OpenRouter',
       'IllustGallery', 'AppState', 'saveData', 'IndexedDB', 'twitterData', 'forumData',
       'broadcast', 'melonbooksData', '<img>', 'localStorage', 'DOMParser', 'Dexie', 'chat.history']
for w in BAN:
    row = [data_src.count(w), app_src.count(w), view_src.count(w)]
    flag = 'OK' if sum(row) == 0 else '★需复核'
    print('%-18s data=%d app=%d view=%d  %s' % (w, row[0], row[1], row[2], flag))

print('\n=== 4. 活性面真值计数（判据门槛取这里）===')
KEY = ['PIXIV_TYPE_LABELS', 'PIXIV_IDLE_TYPES', 'PIXIV_ACTIVE_TYPES', 'PIXIV_LIMITS',
       'PIXIV_REASONS', 'PIXIV_WRITING_STYLES', 'contentFace', 'builtInStyleIds', 'statsOf',
       'heartsFace', 'commentCountFace', 'prevChapterContext', 'parseCommentsBlock',
       'ingestCommentsText', 'recommendFace', 'PIXIV_COMMENT_DELIM']
for k in KEY:
    print('%-24s data=%d app=%d view=%d' % (k, data_src.count(k), app_src.count(k), view_src.count(k)))

print('\n=== 5. 接线落点计数 ===')
for rel, pats in [
    ('config/apps.js', ["id: 'pixiv'"]),
    ('config/storage.js', ['^\\s*/\\^pixiv_/']),
    ('index.js', ['pixivApp', "appId === 'pixiv'", 'apps/pixiv/pixiv-app.js']),
    ('scripts/keys-audit.mjs', ['pixiv_settings', 'pixiv_content', 'pixiv_store']),
    ('tests/system-v255.test.mjs', ["pixivApp: 'pixiv'"]),
    ('phone.css', ['Pixiv App', '.pxv-root']),
]:
    src = rd(ROOT + '/' + rel)
    parts = []
    for p in pats:
        parts.append('%s=%d' % (p.replace('^\\s*/\\^', '').replace('/', ''), len(re.findall(p, src, re.M))))
    print('%-30s %s' % (rel, ' '.join(parts)))

print('\n=== 6. 视图 this._q 装配 id 与 _bindEvents 是否一一对上（假面检测）===')
ids_built = set(re.findall(r"id=\\?[\"']?(pxv-[a-z0-9-]+)", view_src))
ids_built |= set(re.findall(r"id=\\\\?\"(pxv-[a-z0-9-]+)", view_src))
bound = set(re.findall(r"_q\('#(pxv-[a-z0-9-]+)'\)", view_src))
print('装配 id %d 个 / 绑定 id %d 个 / 有绑定无装配：%s' % (len(ids_built), len(bound), sorted(bound - ids_built) or '（无）'))
print('有装配无绑定（纯展示，允许）：%d 个' % len(ids_built - bound))
sys.exit(0)