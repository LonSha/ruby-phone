#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv15.py — 冒烟补 Z 项：把首轮测试自红暴露的三处产品缺陷钉进硬门禁。

首轮 `tests/system-v3350.test.mjs` 跑出 15 红，其中 5 处是**产品真缺陷**、
6 处是判据口径错。产品侧由 patch_pixiv11 / 12 修掉，但**冒烟没盖住它们**——
按本版纪律（冒烟纳入硬门禁），修掉的缺陷必须同时进冒烟，否则回潮无人知。

Z 项四条：
  Z1 章号下界是 0（0 是合法章号，不许抬成 1）
  Z2 互指环的评论不许从树上消失（各自当根并计数）
  Z3 自建草稿不许被可见集吞掉（建完就看得见）
  Z4 日语模式的要求文本必须真含纯度规则（数据算了没人读 = 规则不存在）
"""
import sys

P = 'tools/smoke3350.mjs'

IMP_OLD = """import {
    PIXIV_LIMITS, PIXIV_BUILT_IN_AUTHORS, PIXIV_WRITING_STYLES, PIXIV_REASONS,
    parseCommentsBlock,
} from '../apps/pixiv/pixiv-data.js';"""

IMP_NEW = """import {
    PIXIV_LIMITS, PIXIV_BUILT_IN_AUTHORS, PIXIV_WRITING_STYLES, PIXIV_REASONS,
    PIXIV_PURITY_RULE, parseCommentsBlock,
} from '../apps/pixiv/pixiv-data.js';
import * as DAT from '../apps/pixiv/pixiv-data.js';"""

OLD = """console.log(bad === 0 ? '\\nSMOKE-3350 ALL GREEN' : ('\\nSMOKE-3350 FAILED: ' + bad));"""

NEW = """/* Z 首轮测试自红暴露的三处产品缺陷（修掉后必须留在硬门禁里） */
must(DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num === 0, 'Z 章号 0 是合法的（不许抬成 1）',
    DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num);
must(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num === 0, 'Z 负数抬到下界 0',
    DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num);
const cycTree = DAT.buildCommentTree([
    { id: 'a', content: '1', replyToCommentId: 'b' },
    { id: 'b', content: '2', replyToCommentId: 'a' },
], 3);
must(cycTree.roots.length >= 1, 'Z 互指环不许从树上消失（各自当根）', cycTree.roots.length);
must(cycTree.cycleRoots >= 1, 'Z 环内节点必须如实计数', cycTree.cycleRoots);
const draftApp = new PixivApp(null, memStorage());
draftApp.probe();
const draft = draftApp.createNovel({ title: '草稿篇', tagLine: '純愛' });
must(draftApp.novelsAll().length === 1, 'Z 自建草稿建完就看得见（不许被可见集吞掉）',
    draftApp.novelsAll().length);
must(draftApp.novelsAll()[0].id === draft.id, 'Z 看得见的正是刚建的那篇',
    draftApp.novelsAll()[0].id);
const jpText = draftApp.copyPrompt('chapter', {
    novel: draftApp.novelById(draft.id), chapterNum: 1, language: 'jp-cn',
});
must(jpText.text.indexOf(PIXIV_PURITY_RULE.slice(0, 24)) >= 0,
    'Z 日语要求文本必须真含纯度规则（算了没人读 = 规则不存在）', jpText.text.slice(0, 60));

console.log(bad === 0 ? '\\nSMOKE-3350 ALL GREEN' : ('\\nSMOKE-3350 FAILED: ' + bad));"""

s = open(P, encoding='utf-8').read()
n = s.count(OLD)
if n != 1:
    print('FAIL Z 锚点命中 %d 次' % n)
    sys.exit(1)
m = s.count(IMP_OLD)
if m != 1:
    print('FAIL import 锚点命中 %d 次' % m)
    sys.exit(1)
s = s.replace(IMP_OLD, IMP_NEW).replace(OLD, NEW)
open(P, 'w', encoding='utf-8').write(s)
print('OK 冒烟 import 补 PIXIV_PURITY_RULE + DAT 命名空间')
print('OK 冒烟补 Z 项 4 条')
print('OK patch_pixiv15 全部落地')