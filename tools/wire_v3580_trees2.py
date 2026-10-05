#!/usr/bin/env python3
"""wire_v3580_trees2.py — [v3.58.0 · 计划 O4/O5] 给 v290/v293 的副本树补会话栅栏依赖。

【治的是什么】O4 给 `apps/calendar/calendar-app.js` 补上了**会话世代栅栏**（换会话后
在飞的日程生成不许把上一段会话的回信写进新会话），它引入了：

    import { captureSessionToken, guardSessionWrite } from '../../config/session-gate.js';

v290 / v293 的负控制要在**副本树**上重跑同款真判据，树清单是当时列的：
    config/life-events.js / config/storage.js / config/tag-filter.js / ...
少了 session-gate.js，`import` 当场
    ERR_MODULE_NOT_FOUND: .../config/session-gate.js imported from .../calendar-app.js
—— 判据不是转红，是**压根没跑起来**（负控制反而失去证明力）。
又 session-gate.js 自己 `import { numOrNull } from './num-gate.js'`，故取数门也要一并在树里。

【改法】在「带 storage/tag-filter 的那份树清单」里补两件：
    'config/session-gate.js' / 'config/num-gate.js'
· v290 只有第二份清单（带 calendar-app）需要补 —— 锚点取它独有的两行上下文，恰好 1 处。
· v293 两份清单都带 calendar-app —— 两处都补。

【用法】
    python3 tools/wire_v3580_trees2.py            # dry-run
    python3 tools/wire_v3580_trees2.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATCHES = [
    # v290：4 空格缩进；锚点取「storage 之后紧跟 tag-filter」，该组合只在带 calendar-app 的树里
    ('tests/system-v290.test.mjs',
     "    'config/storage.js': read('config/storage.js'),\n    'config/tag-filter.js'",
     "    'config/storage.js': read('config/storage.js'),\n"
     "    /* [v3.58.0 · 计划 O4] calendar-app 的会话栅栏依赖这两件（少一件即 ERR_MODULE_NOT_FOUND）。 */\n"
     "    'config/session-gate.js': read('config/session-gate.js'),\n"
     "    'config/num-gate.js': read('config/num-gate.js'),\n"
     "    'config/tag-filter.js'",
     'all'),
    # v293：2 空格缩进；两份清单都带 calendar-app，两处都补
    ('tests/system-v293.test.mjs',
     "    'config/storage.js': read('config/storage.js'),\n    'config/tag-filter.js'",
     "    'config/storage.js': read('config/storage.js'),\n"
     "    /* [v3.58.0 · 计划 O4] calendar-app 的会话栅栏依赖这两件（少一件即 ERR_MODULE_NOT_FOUND）。 */\n"
     "    'config/session-gate.js': read('config/session-gate.js'),\n"
     "    'config/num-gate.js': read('config/num-gate.js'),\n"
     "    'config/tag-filter.js'",
     'all'),
]


def main():
    write = '--write' in sys.argv
    bad = []
    for rel, old, new, _mode in PATCHES:
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        n = src.count(old)
        if n < 1:
            bad.append('%-32s 锚点命中 %d 次（应 ≥1）' % (rel, n))
            continue
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(src.replace(old, new))
            print('WRITE %-32s 补 %d 处' % (rel, n))
        else:
            print('DRY   %-32s 可补 %d 处' % (rel, n))
    for msg in bad:
        print('BAD   ' + msg)
    print('--- %s' % ('已落盘' if write else '可落盘（未写入，加 --write 落盘）'))
    if bad:
        sys.exit(1)


if __name__ == '__main__':
    main()