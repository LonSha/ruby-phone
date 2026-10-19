# -*- coding: utf-8 -*-
"""v4.29.0 · R4-X7 收口补丁 C：五类已确认红灯收口（全部**先于**抬版执行）。

【本补丁治的五类红（逐条真跑复算，不是推演）】
  ① tests/system-v3750 H1/H2 —— 边界文档头部仍停在 v4.27.0 复校，而
     tools/bump-drill-core.mjs 的 boundaryAnchor(v) 以 manifest.version=4.28.0
     推出 (v2.82.0 起；v4.28.0 复校)：旧锚 0 命中 + 新锚 0 命中 ⇒ 既不满足
     nOld 恰为 1、也不满足「nOld 为 0 且 nNew 至少 1」⇒ 落进 problems。v4.28.0
     那一版只刷了文档正文的复校行，**没刷头部**。
  ② tests/system-v297 / v298 的 D0（副本树自身全绿）—— 白名单暂存树缺 J19/J20/J21
     的读数来源（三面真源 + 三个产品侧消费点），未破坏的副本树在 J19/J20/J21 上读到
     「缺出口 / 消费点 0」⇒ D0 自证失败 ⇒ 整组负控制变假绿。本仓自 J18 之后连续三轮
     漏补（J19 v4.26 / J20 v4.27 / J21 v4.28 都没跟），本轮一并补上。
  ③ tests/system-v328 C1 —— 文档「当版实测数字」停在 833 / 472 / 830，真跑 835 / 474 / 834
     （由 tools/refresh_doc_readings.py 现场写回）。
  ④ 三份取证基线陈旧 —— long_chat（scan.files 454 / criteria L5 散文 files=454）、
     branch_play 与 schedule_conflict（readings.files_scanned 453），真跑 462 / 461 / 461。
  ⑤ tests/system-v255 / v256 的 C3 —— 条目提取条件把「条目必须含句号」当成了结构假设；
     自 v4.26.0 起公告条目全为「【…】」无句号形态，该过滤把 12 条全滤成 0 条，
     assert.ok(items.length 大于 0) 当场转红 —— 而内容其实逐字同源（假红）。

【纪律】每条锚点 once() 断言恰中 1 次；只改该改的，历史留档与冻结面一字不碰。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

DOC = 'docs/runtime-verification-boundary.md'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实测 %d' % (tag, n)
    return s.replace(old, new, 1)


OLD_HEAD = '# ruby-phone 运行时验证边界（v2.82.0 起；**v4.27.0 复校**）'
NEW_HEAD = '# ruby-phone 运行时验证边界（v2.82.0 起；**v4.28.0 复校**）'

STAGE_TAIL = "    'config/perspective-card-contract.js'," + NL + "];"
STAGE_NEW = ("    'config/perspective-card-contract.js'," + NL
             + "    /* [v4.29.0] 补 J19/J20/J21 三面的读数来源（真源 + 产品侧消费点）：" + NL
             + "     *   J19 证词面（perspective-contrast）/ J20 因果线索面（causal-board）/" + NL
             + "     *   J21 支线结局面（branch-canon）。白名单暂存型套件每随门禁长一条判据，" + NL
             + "     *   就必须同步补上该判据的读数来源 —— 否则未破坏的副本树会在这三条上读到" + NL
             + "     *   「缺出口 / 消费点 0」而红（D0 自证失败 ⇒ 整组负控制变假绿）。" + NL
             + "     *   本仓自 J18 之后连续三轮漏补（J19 v4.26 / J20 v4.27 / J21 v4.28 都没跟），" + NL
             + "     *   本轮由 v297/v298 的 D0 一并抓到。 */" + NL
             + "    'config/perspective-contrast-contract.js'," + NL
             + "    'config/causal-board-contract.js'," + NL
             + "    'config/branch-canon-contract.js'," + NL
             + "    'apps/chars/chars-perspective.js'," + NL
             + "    'apps/plotline/plotline-board.js'," + NL
             + "    'apps/archive/archive-canon.js'," + NL
             + "];")

OLD_FILTER = "l.startsWith('\"') && l.includes('\u3002')"
NEW_FILTER = "l.startsWith('\"')"

NOTE = ('v4.29.0 收口：枚举面随本轮落盘的新件（config/group-vote-contract.js 真源 + '
        'apps/wechat/group-vote.js 接线件 + tests/system-v4290.test.mjs 判据套件）再变，'
        '「扫到的文件数」这类读数必然跟着涨。这是「输入面变了、读数跟着变」的显式动作，'
        '不是转写漂移；站点数 / 消费点 / 上游面等**形态读数一格未动**。')


def main():
    print('--- v4.29.0 收口补丁 C ---')

    doc = rd(DOC)
    doc = once(doc, OLD_HEAD, NEW_HEAD, 'doc-head')
    print('  ① 边界文档头部已换为 v4.28.0 复校')

    for rel in ('tests/system-v297.test.mjs', 'tests/system-v298.test.mjs'):
        s = rd(rel)
        s = once(s, STAGE_TAIL, STAGE_NEW, 'stage-files:' + rel)
        if WRITE:
            wr(rel, s)
        print('  ② %s STAGE_FILES 补 J19/J20/J21 六件' % rel)

    for rel in ('tests/system-v255.test.mjs', 'tests/system-v256.test.mjs'):
        s = rd(rel)
        s = once(s, OLD_FILTER, NEW_FILTER, 'c3-filter:' + rel)
        if WRITE:
            wr(rel, s)
        print('  ⑤ %s C3 条目提取条件去掉句号假设' % rel)

    lc = json.loads(rd('tests/audit/long_chat_baseline.json'))
    assert lc['scan']['files'] == 454, lc['scan']
    lc['scan']['files'] = 462
    l5 = [c for c in lc['criteria'] if c['id'] == 'L5'][0]
    assert 'files=454' in l5['got_text'], l5['got_text']
    l5['got_text'] = l5['got_text'].replace('files=454', 'files=462')
    lc.setdefault('rebuilds', {})['v4.29.0'] = {
        'what': 'R4-X7 群聊投票与协商式活动安排：枚举面重绑 + 判据散文 L5 随 scan 同源',
        'why': NOTE,
        'readings': {'scan.files': 462},
        'unchanged': ['readings', 'scan.full_materialize', 'scan.bounded_slice',
                      'scan.indexed_loop', 'scan.length_read', 'verdict'],
        'not_done': ['小时级长会话的上下文截断行为需要真宿主，本层不可测。'],
    }
    lc['refreshed_at'] = 'v4.29.0'
    if WRITE:
        wr('tests/audit/long_chat_baseline.json', json.dumps(lc, ensure_ascii=False, indent=1) + NL)
    print('  ④ long_chat：scan.files 454 变 462 / L5 散文同源 / refreshed_at v4.29.0')

    bp = json.loads(rd('tests/audit/branch_play_baseline.json'))
    assert bp['readings']['files_scanned'] == 453, bp['readings']['files_scanned']
    bp['readings']['files_scanned'] = 461
    bp.setdefault('rebuilds', {})['v4.29.0'] = {
        'what': 'R4-X7 群聊投票与协商式活动安排：枚举面重绑（回滚覆盖面与上游面一格未动）',
        'why': NOTE,
        'readings': {'files_scanned': 461},
        'unchanged': ['rollback_points', 'rollback_files', 'rollback_entry_defs',
                      'upstream_global_read_sites', 'namespace_store_sites',
                      'checkpoint_face_hits', 'preview_face_hits', 'branch_face_hits'],
        'not_done': ['运行时是否真出现「两个 App 争同一日程槽」需要真宿主时间推进，本层不可测。'],
    }
    bp['refreshed_at'] = 'v4.29.0'
    if WRITE:
        wr('tests/audit/branch_play_baseline.json', json.dumps(bp, ensure_ascii=False, indent=1) + NL)
    print('  ④ branch_play：files_scanned 453 变 461 / refreshed_at v4.29.0')

    sc = json.loads(rd('tests/audit/schedule_conflict_baseline.json'))
    assert sc['readings']['files_scanned'] == 453, sc['readings']['files_scanned']
    sc['readings']['files_scanned'] = 461
    sc.setdefault('rebuilds', {})['v4.29.0'] = {
        'what': 'R4-X7 群聊投票与协商式活动安排：枚举面重绑（消费点 23 点 / 6 文件一格未动）',
        'why': NOTE,
        'readings': {'files_scanned': 461},
        'unchanged': ['consume_points', 'consume_files', 'local_engine_hits'],
        'not_done': ['探针只扫已知消费点文件的**静态命中**；新 App 的私有运行态不计入。'],
    }
    sc['refreshed_at'] = 'v4.29.0'
    if WRITE:
        wr('tests/audit/schedule_conflict_baseline.json', json.dumps(sc, ensure_ascii=False, indent=1) + NL)
    print('  ④ schedule_conflict：files_scanned 453 变 461 / refreshed_at v4.29.0')

    if not WRITE:
        print('--- DRY RUN（加 --write 生效）---')
        return 0
    wr(DOC, doc)
    print('--- WRITTEN ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())
