#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3410.py — v3.41.0 六处接线（需求沙盘 needsim）。
#
# 为什么要有这个脚本：新增一个 App 要动的地方分布在五个文件里，
#   registry 门的 R1（双向覆盖）是**零豁免硬判据**：漏任一处全链必红。
#   手工改六处必然漏，故做成幂等脚本：锚点恰中 1 次才动手，已在场即跳过。
#
# 六处：
#   ① config/apps.js             —— APPS 数组加条目（桌面图标 + 色 + 徽标）
#   ② index.js                   —— phone:openApp 懒加载分支 + 重绑表（换会话重取）
#   ③ config/storage.js          —— CHAT_DATA_PATTERNS 加一条宽前缀 /^needsim_/
#   ④ scripts/keys-audit.mjs     —— KEY_REGISTRY 登记四条键（scope: chat）
#   ⑤ tests/system-v255.test.mjs —— A5 表加 needsimApp: 'needsim'
#
# 用法：python3 tools/wire_v3410.py            # dry-run
#       python3 tools/wire_v3410.py --write    # 落盘
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


print('== v3.41.0 六处接线 ==')

# ---------- ① config/apps.js ----------
APPS_ANCHOR = (
    "        id: 'kettle',\n"
    "        name: '对话水壶',\n"
    "        icon: '\u2615',\n"
    "        color: '#9a6b3f',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
APPS_NEW = (
    "        id: 'kettle',\n"
    "        name: '对话水壶',\n"
    "        icon: '\u2615',\n"
    "        color: '#9a6b3f',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "    {\n"
    "        // [v3.41.0] 需求沙盘：把模型给的那份数据收拾好（缝合自 SullyOS·小鼠机\n"
    "        //   xiaoshuji.html 的「模拟人生需求面板」一族，实测 44 个函数 / 981 处命中）。\n"
    "        //   取六块治理面：六项需求逐项可读性 / 心情四档与缺项 / 六个行动的效果台账 /\n"
    "        //   台词池与小事件池四态 / 游标绕回轮次 / 今日愿望四态 / 记忆淘汰与时间读数 /\n"
    "        //   回信归一与五因分类。\n"
    "        //   ★ 立场差：源是「替模型说话的那个」（自己从浏览器本地存储直读模型地址 /\n"
    "        //   密钥 / 模型名、自己拼五段式 system prompt、自己发请求、自己从回复里抠 JSON、\n"
    "        //   把面板挂进宿主消息上下文），本件是「把模型给的那份数据收拾好」。\n"
    "        //   四块不缝：① **不自己调模型**（源 refreshSims 从本地存储直读三密钥走 fetch）；\n"
    "        //   ② **不落宿主会话记忆**（源 saveGeneratedSimsContent 往宿主消息流里塞）；\n"
    "        //   ③ **不碰宿主角色表**（源 selectSimsCharacter 直读 roles / currentChatRole）；\n"
    "        //   ④ **不收外链、不落数据库**（源背景走 IndexedDB、头像走外链 URL）。\n"
    "        //   四条偏离：① **记忆满了不许整本清空**（源 simsMemories = [] 一次清光且不报）；\n"
    "        //   ② **需求读不出来不许当成 5**（源 clampSimsNeedValue 回落 5 还照画进度条）；\n"
    "        //   ③ **心情缺项不许落最差档**（源 updateMood 六项不齐即「非常不开心」）；\n"
    "        //   ④ **愿望过期不许与「今天没有」同形**（源只判存在不判日子）。\n"
    "        //   写盘四条键走 ^needsim_ 前缀随会话隔离。\n"
    "        id: 'needsim',\n"
    "        name: '需求沙盘',\n"
    "        icon: '\U0001f4ca',\n"
    "        color: '#4f8f6a',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
patch('config/apps.js', [('APPS 条目', APPS_ANCHOR, APPS_NEW)])

# ---------- ② index.js 懒加载分支 ----------
IDX_BRANCH_OLD = "                } else if (appId === 'kettle') {\n"
IDX_BRANCH_NEW = (
    "                } else if (appId === 'needsim') {\n"
    "                    // [v3.41.0] 需求沙盘：把模型给的那份数据收拾好（缝合自 SullyOS·小鼠机\n"
    "                    //   xiaoshuji.html 的「模拟人生需求面板」一族，44 个函数 / 981 处命中）。\n"
    "                    //   取六块治理面：六项需求逐项可读性 / 心情四档与缺项 / 六个行动的\n"
    "                    //   效果台账 / 池子四态与游标轮次 / 愿望四态 / 记忆淘汰与回信五因。\n"
    "                    //   四块不缝：不自己调模型（源 refreshSims 直读三密钥走 fetch）；\n"
    "                    //   不落宿主会话记忆（源往宿主消息流里塞）；不碰宿主角色表（源直读\n"
    "                    //   roles）；不收外链也不落数据库（背景走 IndexedDB / 头像走外链）。\n"
    "                    //   四条偏离：记忆满了不许整本清空（源一次清光还不报）；需求读不出来\n"
    "                    //   不许当成 5（源回落 5 还照画进度条）；心情缺项不许落最差档；\n"
    "                    //   愿望过期不许与「今天没有」同形。\n"
    "                    //   写盘四条键走 ^needsim_ 前缀随会话隔离。\n"
    "                    bootTiming.instrumentImport(import('./apps/needsim/needsim-app.js'), './apps/needsim/needsim-app.js')\n"
    "                        .then(module => {\n"
    "                            if (!window.VirtualPhone.needsimApp) {\n"
    "                                window.VirtualPhone.needsimApp = new module.NeedsimApp(phoneShell, storage);\n"
    "                            }\n"
    "                            window.VirtualPhone.needsimApp.render();\n"
    "                        })\n"
    "                        .catch(err => {\n"
    "                            console.error('\u274c 加载需求沙盘App失败:', err);\n"
    "                            phoneShell?.showNotification('错误', '需求沙盘App加载失败', '\u274c');\n"
    "                        });\n"
    "                } else if (appId === 'kettle') {\n"
)
REBIND_OLD = (
    "    'kettleApp'       // [v3.40.0] 对话水壶：有表单字段、产出的要求文本草稿与单条详情态，\n"
    "                      //             且记录 / 策略 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须全量重取（源把记录挂在宿主键下，切角色原样留着）\n"
    "];\n"
)
REBIND_NEW = (
    "    'kettleApp',      // [v3.40.0] 对话水壶：有表单字段、产出的要求文本草稿与单条详情态，\n"
    "                      //             且记录 / 策略 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须全量重取（源把记录挂在宿主键下，切角色原样留着）\n"
    "    'needsimApp'      // [v3.41.0] 需求沙盘：有表单字段（愿望标题与说明）与台账保留数，\n"
    "                      //             且六项需求 / 台词池 / 记忆流 / 台账全是「这个角色的账」——\n"
    "                      //             换会话必须四格全量重取（源把两本账放在无角色维度的键下，\n"
    "                      //             切角色后旧需求值与旧台词池原样留着，串味且不报）\n"
    "];\n"
)
patch('index.js', [
    ('懒加载分支', IDX_BRANCH_OLD, IDX_BRANCH_NEW),
    ('重绑表', REBIND_OLD, REBIND_NEW),
])

# ---------- ③ config/storage.js ----------
ST_OLD = "            /^kettle_/,\n"
ST_NEW = (
    "            // [v3.41.0] 需求沙盘（needsim_needs / needsim_pool / needsim_journal /\n"
    "            //   needsim_ledger）：一条前缀覆盖四键，四条键都无元字符，\n"
    "            //   按仓内口径「无需宽匹配登记」。\n"
    "            //   六项需求值、台词池与小事件池（含游标）、记忆流与今日愿望、台账与策略。\n"
    "            //   随会话隔离：源把这些放在**没有角色维度的**键下（换角色后旧需求值与\n"
    "            //   旧台词池原样留着），源没有这一步。\n"
    "            /^needsim_/,\n"
    "            /^kettle_/,\n"
)
patch('config/storage.js', [('会话键前缀', ST_OLD, ST_NEW)])

# ---------- ④ scripts/keys-audit.mjs ----------
KEYS_OLD = "  { key: 'kettle_ledger', scope: 'chat', note: '[v3.40.0] 对话水壶台账（每次收拾回信的回执：选项四态 / 场景三态 / 破折号体检）' },\n"
KEYS_NEW = (
    "  { key: 'kettle_ledger', scope: 'chat', note: '[v3.40.0] 对话水壶台账（每次收拾回信的回执：选项四态 / 场景三态 / 破折号体检）' },\n"
    "  { key: 'needsim_needs', scope: 'chat', note: '[v3.41.0] 需求沙盘六项需求（逐项可按读性：读得出来 / 读不出来）' },\n"
    "  { key: 'needsim_pool', scope: 'chat', note: '[v3.41.0] 需求沙盘台词池与小事件池 + 游标（四态：齐 / 缺 / 没有 / 写了认不出来）' },\n"
    "  { key: 'needsim_journal', scope: 'chat', note: '[v3.41.0] 需求沙盘记忆流 + 今日愿望（同键两件事，四态分开判）' },\n"
    "  { key: 'needsim_ledger', scope: 'chat', note: '[v3.41.0] 需求沙盘台账（每次点行动 / 点事件 / 重定愿望的回执：动了几项 / 跳了几项 / 顶掉几条 / 绕回第几轮）' },\n"
)
patch('scripts/keys-audit.mjs', [('四条键登记', KEYS_OLD, KEYS_NEW)])

# ---------- ⑤ tests/system-v255.test.mjs ----------
V255_OLD = (
    "    kettleApp: 'kettle'        // [v3.40.0] 对话水壶：换会话丢表单字段与要求文本草稿与详情态，记录 / 策略 / 台账全量重取\n"
    "  };\n"
)
V255_NEW = (
    "    kettleApp: 'kettle',        // [v3.40.0] 对话水壶：换会话丢表单字段与要求文本草稿与详情态，记录 / 策略 / 台账全量重取\n"
    "    needsimApp: 'needsim'       // [v3.41.0] 需求沙盘：换会话丢愿望表单字段与台账保留数草稿，需求 / 池子 / 记忆与愿望 / 台账四格全量重取\n"
    "  };\n"
)
patch('tests/system-v255.test.mjs', [('A5 表', V255_OLD, V255_NEW)])

print('== 完 ==')
