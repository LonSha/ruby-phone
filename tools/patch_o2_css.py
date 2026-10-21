#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 v4.44.0 R5-O2 的「群投票凭据条」样式落进 calendar.css 与 phone.css 运行时投递面。

双侧投递的理由与 R5-X3 同族：calendar.css 是 link 加载面，phone.css 是运行时投递面；
两处都要有，否则「样式在某些入口下不见了」这种最难查的形态会复现。
锚点取 `/* ---------- [v4.41.0 · R5-X8] 周期与单次例外 ----------`（恰中 1 次）。
"""
import io

ROOT = '/home/user/ruby-phone/'
SRC = 'apps/calendar/calendar.css'
BUNDLE = 'phone.css'
ANCHOR = '/* ---------- [v4.41.0 · R5-X8] 周期与单次例外 ----------'
MARK = '/* ---------- [v4.44.0 · R5-O2] 群投票凭据条（待落笔的转交） ----------'

BLOCK = MARK + """
/* 为什么这条要长得跟普通表单行不一样：它承载的是「**还没成事项**」这个状态。
 * 转交进来了 ≠ 已经约好了；样式上必须让用户一眼看出「这还差我补一步」。 */
#phone-panel-content .phone-screen .yzp-calendar-vote-handoff,
.yzp-calendar-vote-handoff {
    margin: 0 0 10px;
    padding: 9px 11px;
    border-radius: 10px;
    border: 1px dashed rgba(107, 154, 189, 0.55);
    background: rgba(107, 154, 189, 0.10);
}
#phone-panel-content .phone-screen .yzp-calendar-vote-handoff-head,
.yzp-calendar-vote-handoff-head {
    font-size: 11px;
    letter-spacing: 0.04em;
    color: #6b9abd;
    font-weight: 600;
}
#phone-panel-content .phone-screen .yzp-calendar-vote-handoff-body,
.yzp-calendar-vote-handoff-body {
    margin-top: 3px;
    font-size: 13px;
    color: var(--yzp-cal-text, #171b1f);
    line-height: 1.6;
    word-break: break-word;
}
#phone-panel-content .phone-screen .yzp-calendar-vote-handoff-foot,
.yzp-calendar-vote-handoff-foot {
    margin-top: 4px;
    font-size: 11px;
    color: #8a8aa0;
    line-height: 1.5;
}
"""


def rd(rel):
    with io.open(ROOT + rel, encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(ROOT + rel, 'w', encoding='utf-8') as f:
        f.write(s)


# ① calendar.css：尾部追加（无锚点风险）
src = rd(SRC)
if MARK in src:
    print('SKIP: calendar.css 已有该块')
else:
    if not src.endswith('\n'):
        src += '\n'
    wr(SRC, src + BLOCK)
    print('OK: calendar.css 已追加 %d 字节' % len(BLOCK))

# ② phone.css：锚点前插入
bundle = rd(BUNDLE)
if MARK in bundle:
    print('SKIP: phone.css 已有该块')
else:
    n = bundle.count(ANCHOR)
    assert n == 1, '锚点必须恰中 1 次，实测 %d' % n
    wr(BUNDLE, bundle.replace(ANCHOR, BLOCK + '\n' + ANCHOR, 1))
    print('OK: phone.css 已插入 %d 字节' % len(BLOCK))

for cls in ['.yzp-calendar-vote-handoff', '.yzp-calendar-vote-handoff-head',
            '.yzp-calendar-vote-handoff-body', '.yzp-calendar-vote-handoff-foot']:
    print(cls, 'src=%s bundle=%s' % (cls in rd(SRC), cls in rd(BUNDLE)))
