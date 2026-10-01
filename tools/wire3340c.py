# -*- coding: utf-8 -*-
"""[v3.34.0] 补接线 E（keys-audit 三条会话键）与 F（v255 dirMap）。"""
import sys

def patch(path, old, new, tag):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次' % (tag, n))
        sys.exit(1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK  %s' % tag)


E_OLD = "  { key: 'date_store', scope: 'chat', note: '[v3.31.0] 约会场次与欠账（出资分配不变量「我出的 + Ta 出的 = 花费」；不碰任何余额）' },"
E_NEW = ("  { key: 'date_store', scope: 'chat', note: '[v3.31.0] 约会场次与欠账（出资分配不变量「我出的 + Ta 出的 = 花费」；不碰任何余额）' },\n"
         "  { key: 'lofter_settings', scope: 'chat', note: '[v3.34.0] 老福特设置（列表面 / 每章篇幅 / 每轮条数 / 文风库）' },\n"
         "  { key: 'lofter_content', scope: 'chat', note: '[v3.34.0] 老福特内容（自建作者 + 稿子 + 合集；超上限如实计数后裁剪）' },\n"
         "  { key: 'lofter_store', scope: 'chat', note: '[v3.34.0] 老福特互动（关注 / 订阅 tag 与合集 / 我的四个列表各自独立）' },")
patch('scripts/keys-audit.mjs', E_OLD, E_NEW, 'keys-audit 三键')

F_OLD = "    dateApp: 'date'            // [v3.31.0] 约会大作战：换会话丢草稿（场景三格 / 剧情与日志）与视图态（_current / _editScene）并全量重取\n  };"
F_NEW = ("    dateApp: 'date',           // [v3.31.0] 约会大作战：换会话丢草稿（场景三格 / 剧情与日志）与视图态（_current / _editScene）并全量重取\n"
         "    lofterApp: 'lofter'        // [v3.34.0] 老福特：换会话丢草稿（短文批量 / 续章 / 评论 / 作者与文风格）与视图态并全量重取\n"
         "  };")
patch('tests/system-v255.test.mjs', F_OLD, F_NEW, 'v255 dirMap')

print('\nE/F 两处接线完成。')