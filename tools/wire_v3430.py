#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3430.py — v3.43.0 六处接线（PV 案头 pvdesk）。
#
# 为什么要有这个脚本：新增一个 App 要动的地方分布在六个文件里，
#   registry 门的 R1（双向覆盖）是**零豁免硬判据**：漏任一处全链必红。
#   手工改六处必然漏，故做成幂等脚本：锚点恰中 1 次才动手，已在场即跳过。
#
# 六处：
#   ① config/apps.js             —— APPS 数组加条目（桌面图标 + 色 + 徽标）
#   ② index.js                   —— phone:openApp 懒加载分支 + 重绑表（换会话重取）
#   ③ config/storage.js          —— CHAT_DATA_PATTERNS 加一条宽前缀 /^pvdesk_/
#   ④ scripts/keys-audit.mjs     —— KEY_REGISTRY 登记四条键（scope: chat）
#   ⑤ tests/system-v255.test.mjs —— A5 表加 pvdeskApp: 'pvdesk'
#   ⑥ phone.css                  —— 段回灌（另由 tools/sync_css_v3430.py 逐字灌）
#
# 用法：python3 tools/wire_v3430.py            # dry-run
#       python3 tools/wire_v3430.py --write    # 落盘
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


print('== v3.43.0 六处接线 ==')

# ---------- ① config/apps.js ----------
APPS_ANCHOR = (
    "        id: 'musicdesk',\n"
    "        name: '曲库案头',\n"
    "        icon: '🎵',\n"
    "        color: '#8a6f3f',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
APPS_NEW = APPS_ANCHOR.replace('];\n', '') + (
    "    {\n"
    "        // [v3.43.0] PV 案头：把分镜脚本与歌词收拾成一份可复制的要求文本\n"
    "        //   源：Perigee OS 的「ニコニコ 音乐PV工房」一族\n"
    "        //   （niconico.js 1467 行 + pv-form / pv-frames / pv-lyrics / pv-media /\n"
    "        //   pv-storyboard / pv-submit 六件，合计 4450 行 / 126 方法；\n"
    "        //   块文件 nuo_sources/nuo3/live/blk_pv.txt 136942 字符）。\n"
    "        //   取四块治理面：分镜脚本解析（区间反了逐条报 / 空体逐条报 / 超硬限报截断）/\n"
    "        //   逐镜要求文本组装（画风锚 + 机型 + 情绪 + 立绘号 + 一帧约束，逐格报填写态）/\n"
    "        //   歌词时间轴与字幕版式（三态不压平 / 坏行逐项列 / 主副行切法与出处）/ \n"
    "        //   三项上限余量（四项读数 / 上限，取不出来画横线不许画 0）。\n"
    "        //   ★ 立场差：源是「工房并且是出片的那个人」（自己起 WebAudio 合成与三段试听、\n"
    "        //   自己切参考音频并编码 WAV、自己把分镜图逐镜喂给生图入口、自己调视频生成任务\n"
    "        //   队列出片、落 IndexedDB 与 GitHub 备份、满篇 document.getElementById 直读\n"
    "        //   宿主界面元素），本件是「案头」：只把分镜与歌词收拾好并产一份可复制的要求文本。\n"
    "        //   四块不缝：① **零音频元件**（源 createGain / createOscillator 自起试听）；\n"
    "        //   ② **零网络**（源直连生图与视频生成入口）；③ **零出图零成片**\n"
    "        //   （源 dispatchGenerate 逐镜出图、任务队列出片、落 IndexedDB 与 GitHub 备份）；\n"
    "        //   ④ **零宿主界面读**（源满篇 document.getElementById 直读宿主元素）。\n"
    "        //   四条偏离：① 镜头区间反了不许静默跳过；② 镜头体为空不许静默收下；\n"
    "        //   ③ 歌词坏行不许静默丢；④ 上限不许只丢一句「已裁剪」（画余量与拒绝原因）。\n"
    "        //   写盘四条键走 ^pvdesk_ 前缀随会话隔离。\n"
    "        id: 'pvdesk',\n"
    "        name: 'PV 案头',\n"
    "        icon: '🎬',\n"
    "        color: '#3f6f8a',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
    "];\n"
)
patch('config/apps.js', [('APPS 条目', APPS_ANCHOR, APPS_NEW)])

# ---------- ② index.js 懒加载分支 + 重绑表 ----------
IDX_BRANCH_OLD = "                } else if (appId === 'musicdesk') {\n"
IDX_BRANCH_NEW = (
    "                } else if (appId === 'pvdesk') {\n"
    "                    // [v3.43.0] PV 案头：缝合自 Perigee OS「ニコニコ 音乐PV工房」一族\n"
    "                    //   （七件 / 4450 行 / 126 方法）。\n"
    "                    //   取四块治理面：分镜脚本解析（区间反了逐条报 / 空体逐条报 /\n"
    "                    //   超硬限报截断）/ 逐镜要求文本组装（逐格报填写态）/\n"
    "                    //   歌词时间轴与字幕版式（三态不压平 / 坏行逐项列）/ 三项上限余量。\n"
    "                    //   四块不缝：零音频元件（源自起 WebAudio 合成与试听）；零网络\n"
    "                    //   （源直连生图与视频生成入口）；零出图零成片（源逐镜出图、\n"
    "                    //   任务队列出片、落 IndexedDB 与 GitHub 备份）；零宿主界面读\n"
    "                    //   （源满篇 document.getElementById 直读宿主元素）。\n"
    "                    //   四条偏离：镜头区间反了不许静默跳过；镜头体为空不许静默收下；\n"
    "                    //   歌词坏行不许静默丢；上限不许只丢一句「已裁剪」。\n"
    "                    //   写盘四条键走 ^pvdesk_ 前缀随会话隔离。\n"
    "                    bootTiming.instrumentImport(import('./apps/pvdesk/pvdesk-app.js'), './apps/pvdesk/pvdesk-app.js')\n"
    "                        .then(module => {\n"
    "                            if (!window.VirtualPhone.pvdeskApp) {\n"
    "                                window.VirtualPhone.pvdeskApp = new module.PvdeskApp(phoneShell, storage);\n"
    "                            }\n"
    "                            window.VirtualPhone.pvdeskApp.render();\n"
    "                        })\n"
    "                        .catch(err => {\n"
    "                            console.error('❌ 加载PV案头App失败:', err);\n"
    "                            phoneShell?.showNotification('错误', 'PV案头App加载失败', '❌');\n"
    "                        });\n"
    "                } else if (appId === 'musicdesk') {\n"
)
REBIND_OLD = (
    "    'musicdeskApp'    // [v3.42.0] 曲库案头：有表单字段（贴回的回信与要求文本草稿）与队列上限 / 台账保留数，\n"
    "                      //             且曲库 / 歌词 / 来源读数 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须四格全量重取（源把曲库、歌词与来源健康全放在无角色维度的键下，\n"
    "                      //             切角色后旧曲库与旧游标原样留着，串味且不报）\n"
    "];\n"
)
REBIND_NEW = (
    "    'musicdeskApp',   // [v3.42.0] 曲库案头：有表单字段（贴回的回信与要求文本草稿）与队列上限 / 台账保留数，\n"
    "                      //             且曲库 / 歌词 / 来源读数 / 台账全是「这段关系的账」——\n"
    "                      //             换会话必须四格全量重取（源把曲库、歌词与来源健康全放在无角色维度的键下，\n"
    "                      //             切角色后旧曲库与旧游标原样留着，串味且不报）\n"
    "    'pvdeskApp'       // [v3.43.0] PV 案头：有表单字段（贴回的分镜脚本 / 歌词原文 / 要求文本草稿）\n"
    "                      //             与时长 / 主行上限 / 宽素材开关，且题面 / 台账 / 歌词 / 策略\n"
    "                      //             全是「这段关系的账」—— 换会话必须四格全量重取\n"
    "                      //             （源把题面、歌词、任务列表与设置全放在**没有角色维度**的键下，\n"
    "                      //             换角色后旧题面与旧台账原样留着，串味且不报）\n"
    "];\n"
)
patch('index.js', [
    ('懒加载分支', IDX_BRANCH_OLD, IDX_BRANCH_NEW),
    ('重绑表', REBIND_OLD, REBIND_NEW),
])

# ---------- ③ config/storage.js ----------
ST_OLD = "            /^musicdesk_/,\n"
ST_NEW = (
    "            // [v3.43.0] PV 案头（pvdesk_brief / pvdesk_shelf / pvdesk_lyrics /\n"
    "            //   pvdesk_policy）：一条前缀覆盖四键，四条键都无元字符，\n"
    "            //   按仓内口径「无需宽匹配登记」。\n"
    "            //   题面（分镜脚本原文 + 标题 / 时长 / 风格 / 机型 / 情绪）/ 作品台账 /\n"
    "            //   歌词原文 / 策略（字幕主行字数 / 语言 / 宽素材开关）。\n"
    "            //   随会话隔离：源把题面、歌词、任务列表与设置全放在**没有角色维度的**键下\n"
    "            //   （换角色后旧题面与旧台账原样留着），源没有这一步。\n"
    "            /^pvdesk_/,\n"
    "            /^musicdesk_/,\n"
)
patch('config/storage.js', [('会话键前缀', ST_OLD, ST_NEW)])

# ---------- ④ scripts/keys-audit.mjs ----------
KEYS_OLD = "  { key: 'musicdesk_policy', scope: 'chat', note: '[v3.42.0] 曲库案头策略（队列上限与台账保留数）' },\n"
KEYS_NEW = KEYS_OLD + (
    "  { key: 'pvdesk_brief', scope: 'chat', note: '[v3.43.0] PV 案头题面（分镜脚本原文 + 标题 / 时长 / 风格 / 机型 / 情绪）' },\n"
    "  { key: 'pvdesk_shelf', scope: 'chat', note: '[v3.43.0] PV 案头作品台账（每次「配好一份要求文本」的存档：标题 / 镜数 / 字数 / 形态）' },\n"
    "  { key: 'pvdesk_lyrics', scope: 'chat', note: '[v3.43.0] PV 案头歌词原文（坏行按没时间标签 / 标签后没字 / 元标签行三类报）' },\n"
    "  { key: 'pvdesk_policy', scope: 'chat', note: '[v3.43.0] PV 案头策略（字幕主行最大字数 / 语速口径语言 / 宽素材上限开关）' },\n"
)
patch('scripts/keys-audit.mjs', [('四条键登记', KEYS_OLD, KEYS_NEW)])

# ---------- ⑤ tests/system-v255.test.mjs ----------
V255_OLD = (
    "    musicdeskApp: 'musicdesk'   // [v3.42.0] 曲库案头：换会话丢贴回的回信与要求文本草稿与队列上限 / 台账保留数，曲库 / 歌词 / 来源读数 / 台账四格全量重取\n"
    "  };\n"
)
V255_NEW = (
    "    musicdeskApp: 'musicdesk',  // [v3.42.0] 曲库案头：换会话丢贴回的回信与要求文本草稿与队列上限 / 台账保留数，曲库 / 歌词 / 来源读数 / 台账四格全量重取\n"
    "    pvdeskApp: 'pvdesk'         // [v3.43.0] PV 案头：换会话丢贴回的分镜脚本 / 歌词与要求文本草稿与时长 / 主行上限 / 宽素材开关，题面 / 台账 / 歌词 / 策略四格全量重取\n"
    "  };\n"
)
patch('tests/system-v255.test.mjs', [('A5 表', V255_OLD, V255_NEW)])

print('== 完 ==')