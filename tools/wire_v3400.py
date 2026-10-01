#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3400.py — v3.40.0 五处接线（对话水壶 kettle）。
#
# 为什么要有这个脚本：新增一个 App 要动的地方分布在五个文件里，
#   registry 门的 R1（双向覆盖）是**零豁免硬判据**：漏任一处全链必红。
#   手工改五处必然漏，故做成幂等脚本：锚点恰中 1 次才动手，已在场即跳过。
#
# 五处：
#   ① config/apps.js             —— APPS 数组加条目（桌面图标 + 色 + 徽标）
#   ② index.js                   —— phone:openApp 懒加载分支 + 重绑表（换会话重取）
#   ③ config/storage.js          —— CHAT_DATA_PATTERNS 加一条宽前缀 /^kettle_/
#   ④ scripts/keys-audit.mjs     —— KEY_REGISTRY 登记三条键（scope: chat）
#   ⑤ tests/system-v255.test.mjs —— A5 表加 kettleApp: 'kettle'
#
# 用法：python3 tools/wire_v3400.py            # dry-run
#       python3 tools/wire_v3400.py --write    # 落盘
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


print('== v3.40.0 五处接线 ==')

# ---------- ① config/apps.js ----------
APPS_ANCHOR = (
    "        id: 'widget',\n"
    "        name: '自定义组件',\n"
    "        icon: '\U0001f9f1',\n"
    "        color: '#8b5cf6',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
APPS_NEW = (
    "        id: 'widget',\n"
    "        name: '自定义组件',\n"
    "        icon: '\U0001f9f1',\n"
    "        color: '#8b5cf6',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "    {\n"
    "        // [v3.40.0] 对话水壶：把模型已经说过的话收拾好（缝合自 SullyOS·小鼠机\n"
    "        //   xiaoshuji.html 的 Tandan 探店一族，实测 32 个函数 / 754 处命中）。\n"
    "        //   取六块的**治理面**：轮次分档与时长话术 / 选项协议裁切与去重 / 场景标签 /\n"
    "        //   单字语气词登记 / 破折号体检 / 记录封包与读数。\n"
    "        //   ★ 立场差：源是「替模型说话的那个」，本件是「把模型已经说的话收拾好」。\n"
    "        //   四块不缝：① **不自己调模型**（源 fetchTandanDetailReply 从本地存储直读\n"
    "        //   apiUrl / apiKey / selectedModel 并自己走 SSE 流）；② **不往对话里写楼层**\n"
    "        //   （源 addTandanRecordToChat 直接调宿主 addMessage）；③ **不碰宿主角色表**\n"
    "        //   （源直读 roles / getUserPersona / currentChatRole）；④ **不收外链、不落数据库**\n"
    "        //   （源壁纸走 IndexedDB、头像走 URL）。\n"
    "        //   四条偏离：① **轮次算不出来不许与「说了很久」同形**（源 NaN 落「很久」、\n"
    "        //   0 落「短暂」，两处都反）；② **单字语气词一律不保留**，只做登记读数；\n"
    "        //   ③ **选项要裁**（不足三个与超过三个都不许当合，源 split 后照单全收）；\n"
    "        //   ④ **破折号是一种读数，不是风格禁令**。\n"
    "        //   写盘三条键走 ^kettle_ 前缀随会话隔离。\n"
    "        id: 'kettle',\n"
    "        name: '对话水壶',\n"
    "        icon: '\u2615',\n"
    "        color: '#9a6b3f',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
patch('config/apps.js', [('APPS 条目', APPS_ANCHOR, APPS_NEW)])

# ---------- ② index.js ----------
IDX_BRANCH_OLD = "                } else if (appId === 'widget') {\n"
IDX_BRANCH_NEW = (
    "                } else if (appId === 'kettle') {\n"
    "                    // [v3.40.0] 对话水壶：把模型已经说过的话收拾好（缝合自 SullyOS·小鼠机\n"
    "                    //   xiaoshuji.html 的 Tandan 探店一族，实测 32 个函数 / 754 处命中）。\n"
    "                    //   取六块治理面：轮次分档 / 选项协议 / 场景标签 / 单字语气词登记 /\n"
    "                    //   破折号体检 / 记录封包与读数。\n"
    "                    //   四块不缝：不自己调模型（源直读本地存储三密钥走 SSE 流）；不往对话里\n"
    "                    //   写楼层（源直接调宿主 addMessage）；不碰宿主角色表（源直读 roles）；\n"
    "                    //   不收外链也不落数据库。\n"
    "                    //   四条偏离：轮次算不出来不许与「说了很久」同形（源 NaN 落「很久」）；\n"
    "                    //   单字语气词一律不保留（只登记）；选项要裁（不足三个不许当合）；\n"
    "                    //   破折号是读数不是禁令。\n"
    "                    //   写盘三条键走 ^kettle_ 前缀随会话隔离。\n"
    "                    bootTiming.instrumentImport(import('./apps/kettle/kettle-app.js'), './apps/kettle/kettle-app.js')\n"
    "                        .then(module => {\n"
    "                            if (!window.VirtualPhone.kettleApp) {\n"
    "                                window.VirtualPhone.kettleApp = new module.KettleApp(phoneShell, storage);\n"
    "                            }\n"
    "                            window.VirtualPhone.kettleApp.render();\n"
    "                        })\n"
    "                        .catch(err => {\n"
    "                            console.error('\u274c 加载对话水壶App失败:', err);\n"
    "                            phoneShell?.showNotification('错误', '对话水壶App加载失败', '\u274c');\n"
    "                        });\n"
    "                } else if (appId === 'widget') {\n"
)
REBIND_OLD = (
    "    'sourcebookApp'   // [v3.39.0] 时光胶囊：有存信表单草稿、贴回的回信草稿与详情态，\n"
    "                      //             且封存的信 / 策略 / 台账全是「这段关系的信」——\n"
    "                      //             换会话必须全量重取（不清会串味），必须进表\n"
    "];\n"
)
REBIND_NEW = (
    "    'sourcebookApp',  // [v3.39.0] 时光胶囊：有存信表单草稿、贴回的回信草稿与详情态，\n"
    "                      //             且封存的信 / 策略 / 台账全是「这段关系的信」——\n"
    "                      //             换会话必须全量重取（不清会串味），必须进表\n"
    "    'kettleApp'       // [v3.40.0] 对话水壶：有表单字段、产出的要求文本草稿与单条详情态，\n"
    "                      //             且记录 / 策略 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须全量重取（源把记录挂在宿主键下，切角色原样留着）\n"
    "];\n"
)
patch('index.js', [
    ('懒加载分支', IDX_BRANCH_OLD, IDX_BRANCH_NEW),
    ('重绑表', REBIND_OLD, REBIND_NEW),
])

# ---------- ③ config/storage.js ----------
ST_OLD = "            /^widget_/,\n"
ST_NEW = (
    "            // [v3.40.0] 对话水壶（kettle_notes / kettle_policy / kettle_ledger）：\n"
    "            //   一条前缀覆盖三键，三条键都无元字符，按仓内口径「无需宽匹配登记」。\n"
    "            //   已封的记录、策略（台账保留数）、台账回执各自独立。\n"
    "            //   随会话隔离：源把探店记录写进宿主会话键下，切角色时**原样留着**（串味）。源没有这一步。\n"
    "            /^kettle_/,\n"
    "            /^widget_/,\n"
)
patch('config/storage.js', [('会话键前缀', ST_OLD, ST_NEW)])

# ---------- ④ scripts/keys-audit.mjs ----------
KEYS_OLD = "  { key: 'sourcebook_ledger', scope: 'chat', note: '[v3.39.0] 时光胶囊台账（回信回执 + 三段落兜底标记；超上限截最近）' },\n"
KEYS_NEW = (
    "  { key: 'sourcebook_ledger', scope: 'chat', note: '[v3.39.0] 时光胶囊台账（回信回执 + 三段落兜底标记；超上限截最近）' },\n"
    "  { key: 'kettle_notes', scope: 'chat', note: '[v3.40.0] 对话水壶记录（已封的探店记录 + 轮次三态 + 单字语气词登记）' },\n"
    "  { key: 'kettle_policy', scope: 'chat', note: '[v3.40.0] 对话水壶策略（台账保留数）' },\n"
    "  { key: 'kettle_ledger', scope: 'chat', note: '[v3.40.0] 对话水壶台账（每次收拾回信的回执：选项四态 / 场景三态 / 破折号体检）' },\n"
)
patch('scripts/keys-audit.mjs', [('三条键登记', KEYS_OLD, KEYS_NEW)])

# ---------- ⑤ tests/system-v255.test.mjs ----------
V255_OLD = (
    "    sourcebookApp: 'sourcebook' // [v3.39.0] 时光胶囊：换会话丢存信表单草稿与贴回的回信草稿，信 / 策略 / 台账全量重取\n"
    "  };\n"
)
V255_NEW = (
    "    sourcebookApp: 'sourcebook', // [v3.39.0] 时光胶囊：换会话丢存信表单草稿与贴回的回信草稿，信 / 策略 / 台账全量重取\n"
    "    kettleApp: 'kettle'        // [v3.40.0] 对话水壶：换会话丢表单字段与要求文本草稿与详情态，记录 / 策略 / 台账全量重取\n"
    "  };\n"
)
patch('tests/system-v255.test.mjs', [('A5 表', V255_OLD, V255_NEW)])

print('== 完 ==')
