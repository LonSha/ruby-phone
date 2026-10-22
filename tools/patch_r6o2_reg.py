#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R6-O2 四处注册 + 样式双侧（幂等）。
范式逐条沿用 v4.48.0 的接线（affairs）：
  config/apps.js（APPS）· config/app-lazy-routes.js（表行）· config/tab-source.js（single 行）
  · index.js（ST_PHONE_REBIND_APP_KEYS）· scripts/keys-audit.mjs（KEY_REGISTRY）
  · config/app-consumption-matrix.js（六面行）· config/storage.js（会话前缀族）
  · phone.css（运行时投递面）
每个锚点断言恰中 1 次，失配即整件退出（不静默半改）。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv
NL = chr(10)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


def already(s, probe, tag):
    if probe in s:
        print('  [%s] 已存在，跳过' % tag)
        return True
    return False


def main():
    changed = []

    # ① config/apps.js —— APPS 里加一项（紧跟 affairs 那一段之后）
    p = 'config/apps.js'
    s = rd(p)
    if not already(s, "id: 'comms'", 'apps.js'):
        anchor = "        id: 'affairs',"
        i = s.index(anchor)
        # 找访项结尾：下一个 "    }," 之前
        seg_end = s.index(NL + '    },', i)
        block = s[i:seg_end]
        assert '事务台' in block, block[:200]
        new_block = NL + '    {' + NL + NL.join([
            "        id: 'comms',",
            "        name: '会话台',",
            "        icon: '💬',",
            "        color: '#5c8f9e',",
            "        badge: null,",
            "        data: null,",
        ])
        s = s[:seg_end] + new_block + s[seg_end:]
        s = once(s, new_block + NL + '    },', new_block + NL + '    },', 'apps-close')
        changed.append(p)
    if WRITE:
        wr(p, s)

    print('--- apps.js 预览 ---')
    i = s.index("id: 'comms'")
    print(s[i - 60:i + 320])

    # ② config/app-lazy-routes.js —— 表行
    p = 'config/app-lazy-routes.js'
    s = rd(p)
    if not already(s, '"comms"', 'lazy-routes'):
        anchor = '    { id: "affairs", module: "./apps/affairs/affairs-app.js", key: "affairsApp", cls: "AffairsApp", errTitle: "事务台App" },'
        row = '    { id: "comms", module: "./apps/comms/comms-app.js", key: "commsApp", cls: "CommsApp", errTitle: "会话台App" },'
        s = once(s, anchor, anchor + NL + row, 'lazy-row')
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ③ config/tab-source.js —— single 形态行
    p = 'config/tab-source.js'
    s = rd(p)
    if not already(s, 'comms: Object.freeze', 'tab-source'):
        i = s.index('    affairs: Object.freeze({')
        tail = NL + '    })' + NL + '});'
        j = s.index(tail, i) + len(NL + '    })')
        block = s[i:j]
        assert "shape: 'single'" in block, block
        new_block = block + ',' + NL + NL.join([
            '    comms: Object.freeze({',
            "        tabs: Object.freeze(['board']),",
            "        file: 'apps/comms/comms-app.js', shape: 'single',",
            "        note: '[v4.49.0 · R6-O2] 会话台：单页读数（一段交流的接触点四类含漏接/注意面三态含未读未回/漏接续谈），视图无 tab 分支。',",
            '    })',
        ])
        s = s[:i] + new_block + s[j:]
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ④ index.js —— REBIND 表
    p = 'index.js'
    s = rd(p)
    if not already(s, "'commsApp'", 'rebind'):
        anchor = "    'affairsApp',"
        assert s.count(anchor) == 1, s.count(anchor)
        # 插到 affairsApp 那段注释结束后的第一行
        i = s.index(anchor)
        # 找到该条目注释块之后的下一条目起点："    '"
        j = s.index(NL + "    '", i + len(anchor))
        row = (NL + "    'commsApp',   // [v4.49.0 · 第六期 R6-O2] 会话台：上一次动作归因（_lastAction）与页签是**实例态** ——"
               + NL + "                      //             换会话必须丢（否则旧会话的「刚标记过已回」会贴到新会话的会话台上）；"
               + NL + "                      //             交流本体在 comm_threads_v1 那一格（前缀 ^comm），随会话隔离。")
        s = s[:j] + row + s[j:]
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ⑤ scripts/keys-audit.mjs —— KEY_REGISTRY
    p = 'scripts/keys-audit.mjs'
    s = rd(p)
    if not already(s, "'comm_threads_v1'", 'keys-audit'):
        anchor = "  { key: 'affairs_v1',"
        i = s.index(anchor)
        j = s.index(NL + '  }', i) + len(NL + '  },')
        row = (NL + "  { key: 'comm_threads_v1', scope: 'chat', note: '[v4.49.0 · R6-O2] 一段交流（接触点四类含漏接/注意面三态含未读未回/漏接续谈读数；上限 40 段 80 点，gapHours 超窗一律开新段不硬续）' },")
        s = s[:j] + row + s[j:]
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ⑥ config/app-consumption-matrix.js —— 六面行
    p = 'config/app-consumption-matrix.js'
    s = rd(p)
    if not already(s, 'appId: "comms"', 'matrix'):
        anchor = '    Object.freeze({ appId: "affairs",'
        i = s.index(anchor)
        j = s.index('}),', i) + len('}),')
        row = (NL + '    Object.freeze({ appId: "comms", name: "会话台", dir: "comms", faces: Object.freeze('
               + '{ F1_inject: true, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),')
        s = s[:j] + row + s[j:]
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ⑦ config/storage.js —— 会话前缀族（^comm）
    p = 'config/storage.js'
    s = rd(p)
    if not already(s, 'comm_threads_v1', 'storage-prefix'):
        anchor = '            /^aff/,'
        note = (NL + '            /* [v4.49.0 · R6-O2] 连续通信(comm_threads_v1):键无元字符,按仓内口径「无需宽匹配登记」。'
                + NL + '             *   它装的是「这个角色这段对话里跟谁的交流到哪一步」——接触点引用/未读未回/漏接续谈。'
                + NL + '             *   不隔离就会把上一个角色的未读未回贴回新会话(与 aff_ 同族静默错串)。 */'
                + NL + '            /^comm/,')
        s = once(s, anchor, anchor + note, 'storage-prefix')
        changed.append(p)
    if WRITE:
        wr(p, s)

    # ⑧ phone.css —— 样式双侧（幂等追加源面原文）
    p = 'phone.css'
    s = rd(p)
    css = rd('apps/comms/comms.css')
    if '.cm-root {' in s:
        print('  [css] phone.css 已含 .cm-root，跳过')
    else:
        s = s + NL + NL + '/* ==== [v4.49.0 · R6-O2] 会话台（apps/comms/comms.css 同名段）==== */' + NL + css
        changed.append(p)
    if WRITE:
        wr(p, s)

    print('--- changed: %s ---' % ', '.join(changed) if changed else '--- no change ---')
    if not WRITE:
        print('DRY RUN（--write 落盘）')
    return 0


if __name__ == '__main__':
    sys.exit(main())