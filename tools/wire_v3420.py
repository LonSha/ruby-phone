#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3420.py — v3.42.0 六处接线（曲库案头 musicdesk）。
#
# 为什么要有这个脚本：新增一个 App 要动的地方分布在五个文件里，
#   registry 门的 R1（双向覆盖）是**零豁免硬判据**：漏任一处全链必红。
#   手工改六处必然漏，故做成幂等脚本：锚点恰中 1 次才动手，已在场即跳过。
#
# 六处：
#   ① config/apps.js             —— APPS 数组加条目（桌面图标 + 色 + 徽标）
#   ② index.js                   —— phone:openApp 懒加载分支 + 重绑表（换会话重取）
#   ③ config/storage.js          —— CHAT_DATA_PATTERNS 加一条宽前缀 /^musicdesk_/
#   ④ scripts/keys-audit.mjs     —— KEY_REGISTRY 登记四条键（scope: chat）
#   ⑤ tests/system-v255.test.mjs —— A5 表加 musicdeskApp: 'musicdesk'
#
# 用法：python3 tools/wire_v3420.py            # dry-run
#       python3 tools/wire_v3420.py --write    # 落盘
import os
import sys

ROOT = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv[1:]


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def patch(rel, pairs):
    """pairs: [(tag, old, new)]；new 已在场 = 幂等跳过；否则 old 必须恰中 1 次。"""
    s = rd(rel)
    todo = []
    for tag, old, new in pairs:
        if new and new in s:
            print('  [%s] 已在场，跳过' % tag)
            continue
        n = s.count(old)
        assert n == 1, '  [%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
        s = s.replace(old, new, 1)
        todo.append(tag)
    if todo:
        print('  %s：%s' % (rel, '、'.join(todo)))
        if WRITE:
            wr(rel, s)
    return todo


print('== v3.42.0 六处接线 ==')

# ---------- ① config/apps.js ----------
APPS_ANCHOR = (
    "        id: 'needsim',\n"
    "        name: '需求沙盘',\n"
    "        icon: '📊',\n"
    "        color: '#4f8f6a',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
)
APPS_NEW = APPS_ANCHOR + (
    "    {\n"
    "        // [v3.42.0] 曲库案头：把对话端拿回来的那份曲目收拾好（缝合自两个源）\n"
    "        //   ① 小鼠机 nuo_sources/nuo3/xiaoshuji.html 的 netease 一族\n"
    "        //      （实测 71 个函数，块文件 nuo_sources/nuo3/live/blk_netease.txt）；\n"
    "        //   ② EPhone·xintuk src_xintuk/runtime/scripts/main-app/ 的\n"
    "        //      「第三方音乐聚合 + 扫码账号桥」一族（65 片 / 908 个函数）。\n"
    "        //   取四块治理面：曲目归一与去重（逐条报）/ 封面四态（零外链）/\n"
    "        //   歌词归一（坏行不静默丢）/ 播放模式与队列游标（坏值拒而不夹）\n"
    "        //   + 来源读数（冷却与偏好不同形）+ 回执归一（六因）。\n"
    "        //   ★ 立场差：两个源都是「取数的那个人」（自己持多家聚合 API 与 NCM 节点、\n"
    "        //   自己发请求、自己 new Audio() 真放一遍验链接、自己从本地存储\n"
    "        //   直读账号 uid 与 cookie），本件是「案头」：只收拾用户从对话端\n"
    "        //   拿回来的那份曲目数据。\n"
    "        //   四块不缝：① **不发请求**（源 neteaseApiFetch / fetchJson 直连多家 API）；\n"
    "        //   ② **不读账号与 cookie**（源 currentAccountStorageKey 直读 uid 与 cookie）；\n"
    "        //   ③ **不碰 audio 元件**（源 validateAudio 真放 9 秒且失败无读数）；\n"
    "        //   ④ **不收外链、不落数据库**（源封面走外链托底图）。\n"
    "        //   四条偏离：① 去重不许静默（源塞进 alternatives 不报）；\n"
    "        //   ② 封面不许换托底图（源 PLACEHOLDER_COVER 是外链）；\n"
    "        //   ③ 歌词坏行不许静默丢（源 exec 不中即 continue）；\n"
    "        //   ④ 队列超限不许静默截（源到 limit 就 break）。\n"
    "        //   写盘四条键走 ^musicdesk_ 前缀随会话隔离。\n"
    "        id: 'musicdesk',\n"
    "        name: '曲库案头',\n"
    "        icon: '🎵',\n"
    "        color: '#8a6f3f',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
patch('config/apps.js', [('APPS 条目', APPS_ANCHOR, APPS_NEW)])

# ---------- ② index.js 懒加载分支 + 重绑表 ----------
IDX_BRANCH_OLD = "                } else if (appId === 'needsim') {\n"
IDX_BRANCH_NEW = (
    "                } else if (appId === 'musicdesk') {\n"
    "                    // [v3.42.0] 曲库案头：缝合自小鼠机 netease 一族（71 个函数）\n"
    "                    //   与 EPhone·xintuk 第三方音乐聚合一族（65 片 / 908 个函数）。\n"
    "                    //   取四块治理面：曲目归一与去重（逐条报）/ 封面四态（零外链）/\n"
    "                    //   歌词归一（坏行不静默丢）/ 播放模式与队列游标（坏值拒而不夹）\n"
    "                    //   + 来源读数 + 回执归一。\n"
    "                    //   四块不缝：不发请求（源直连多家聚合 API 与 NCM 节点）；\n"
    "                    //   不读账号与 cookie（源直读 uid 与 cookie 拼进播放链）；\n"
    "                    //   不碰 audio 元件（源 new Audio() 真放一遍再判）；\n"
    "                    //   不收外链也不落数据库（源封面走外链托底图）。\n"
    "                    //   四条偏离：去重不许静默；封面不许换托底图；\n"
    "                    //   歌词坏行不许静默丢；队列超限不许静默截。\n"
    "                    //   写盘四条键走 ^musicdesk_ 前缀随会话隔离。\n"
    "                    bootTiming.instrumentImport(import('./apps/musicdesk/musicdesk-app.js'), './apps/musicdesk/musicdesk-app.js')\n"
    "                        .then(module => {\n"
    "                            if (!window.VirtualPhone.musicdeskApp) {\n"
    "                                window.VirtualPhone.musicdeskApp = new module.MusicdeskApp(phoneShell, storage);\n"
    "                            }\n"
    "                            window.VirtualPhone.musicdeskApp.render();\n"
    "                        })\n"
    "                        .catch(err => {\n"
    "                            console.error('❌ 加载曲库案头App失败:', err);\n"
    "                            phoneShell?.showNotification('错误', '曲库案头App加载失败', '❌');\n"
    "                        });\n"
    "                } else if (appId === 'needsim') {\n"
)
REBIND_OLD = (
    "    'needsimApp'      // [v3.41.0] 需求沙盘：有表单字段（愿望标题与说明）与台账保留数，\n"
    "                      //             且六项需求 / 台词池 / 记忆流 / 台账全是「这个角色的账」——\n"
    "                      //             换会话必须四格全量重取（源把两本账放在无角色维度的键下，\n"
    "                      //             切角色后旧需求值与旧台词池原样留着，串味且不报）\n"
    "];\n"
)
REBIND_NEW = (
    "    'needsimApp',     // [v3.41.0] 需求沙盘：有表单字段（愿望标题与说明）与台账保留数，\n"
    "                      //             且六项需求 / 台词池 / 记忆流 / 台账全是「这个角色的账」——\n"
    "                      //             换会话必须四格全量重取（源把两本账放在无角色维度的键下，\n"
    "                      //             切角色后旧需求值与旧台词池原样留着，串味且不报）\n"
    "    'musicdeskApp'    // [v3.42.0] 曲库案头：有表单字段（贴回的回信与要求文本草稿）与队列上限 / 台账保留数，\n"
    "                      //             且曲库 / 歌词 / 来源读数 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须四格全量重取（源把曲库、歌词与来源健康全放在无角色维度的键下，\n"
    "                      //             切角色后旧曲库与旧游标原样留着，串味且不报）\n"
    "];\n"
)
patch('index.js', [
    ('懒加载分支', IDX_BRANCH_OLD, IDX_BRANCH_NEW),
    ('重绑表', REBIND_OLD, REBIND_NEW),
])

# ---------- ③ config/storage.js ----------
ST_OLD = "            /^needsim_/,\n"
ST_NEW = (
    "            // [v3.42.0] 曲库案头（musicdesk_lib / musicdesk_lyrics / musicdesk_ledger /\n"
    "            //   musicdesk_policy）：一条前缀覆盖四键，四条键都无元字符，\n"
    "            //   按仓内口径「无需宽匹配登记」。\n"
    "            //   曲库（归一后的曲目表 + 来源表 + 游标 + 播放模式）/ 歌词原文 / 台账 / 策略。\n"
    "            //   随会话隔离：源把曲库与歌词与来源健康放在**没有角色维度的**键下（换角色后\n"
    "            //   旧曲库与旧游标原样留着），源没有这一步。\n"
    "            /^musicdesk_/,\n"
    "            /^needsim_/,\n"
)
patch('config/storage.js', [('会话键前缀', ST_OLD, ST_NEW)])

# ---------- ④ scripts/keys-audit.mjs ----------
KEYS_OLD = "  { key: 'needsim_ledger', scope: 'chat', note: '[v3.41.0] 需求沙盘台账（每次点行动 / 点事件 / 重定愿望的回执：动了几项 / 跳了几项 / 顶掉几条 / 绕回第几轮）' },\n"
KEYS_NEW = KEYS_OLD + (
    "  { key: 'musicdesk_lib', scope: 'chat', note: '[v3.42.0] 曲库案头曲库（归一后的曲目表 + 来源表 + 队列游标 + 播放模式）' },\n"
    "  { key: 'musicdesk_lyrics', scope: 'chat', note: '[v3.42.0] 曲库案头歌词原文（坏行按没时间标签 / 标签后没字两类报）' },\n"
    "  { key: 'musicdesk_ledger', scope: 'chat', note: '[v3.42.0] 曲库案头台账（每次收拾回信 / 换模式 / 跳曲 / 定位的回执：给进来几条 / 合并几条 / 截几条 / 认不出的那串字）' },\n"
    "  { key: 'musicdesk_policy', scope: 'chat', note: '[v3.42.0] 曲库案头策略（队列上限与台账保留数）' },\n"
)
patch('scripts/keys-audit.mjs', [('四条键登记', KEYS_OLD, KEYS_NEW)])

# ---------- ⑤ tests/system-v255.test.mjs ----------
V255_OLD = (
    "    needsimApp: 'needsim'       // [v3.41.0] 需求沙盘：换会话丢愿望表单字段与台账保留数草稿，需求 / 池子 / 记忆与愿望 / 台账四格全量重取\n"
    "  };\n"
)
V255_NEW = (
    "    needsimApp: 'needsim',      // [v3.41.0] 需求沙盘：换会话丢愿望表单字段与台账保留数草稿，需求 / 池子 / 记忆与愿望 / 台账四格全量重取\n"
    "    musicdeskApp: 'musicdesk'   // [v3.42.0] 曲库案头：换会话丢贴回的回信与要求文本草稿与队列上限 / 台账保留数，曲库 / 歌词 / 来源读数 / 台账四格全量重取\n"
    "  };\n"
)
patch('tests/system-v255.test.mjs', [('A5 表', V255_OLD, V255_NEW)])

print('== 完 ==')
