#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.31.0 接线：约会大作战 App 五处注册 + 会话键前缀 + 键账本 + phone.css 段 + v255 dirMap。

纪律：每个锚点必须**恰中 1 次**（不中即退出，绝不半套落地）；
先算 draft、逐条断言、最后才落盘。
"""
import io
import os
import sys

R = '/home/user/ruby-phone'
WRITE = '--write' in sys.argv


def rd(rel):
    with io.open(os.path.join(R, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with io.open(os.path.join(R, rel), 'w', encoding='utf-8') as f:
        f.write(text)


def sub_once(src, old, new, label):
    assert src.count(old) == 1, '%s 锚点必须恰中 1 次，实得 %d' % (label, src.count(old))
    return src.replace(old, new)


# ══════════════ ① config/apps.js ══════════════
apps = rd('config/apps.js')
APPS_ANCHOR = """    {
        // [v3.28.0] 自定义组件：登记 / 对账 / 产描述 / 导出设计稿（缝合自 EPhone·xINOVO custom-widgets + uwu widget_market）。"""
assert apps.count(APPS_ANCHOR) == 1, 'apps.js 的自定义组件条目锚点必须恰中 1 次'
DATE_ENTRY = """    {
        // [v3.31.0] 约会大作战：场景册 / 出资四路 / 计划到收场 / 结算卡 / 欠账台账 五块
        //   （缝合自 EPhone·xintuk date 三片，120530 字节 / 3195 行 / 51 个函数）。
        //   两块不取：① 立绘库（源靠 x/y/size 滑块把图叠在背景上 —— 那是一套完整的编辑器，
        //   与「约会」不是一件事，本仓也没有立绘权威）；② BGM 面板（源读 window.state.musicState.playlist，
        //   那是「一起听」的曲库 —— 本仓有第二个权威；音量写 projectStorage 是全局键，会跨会话串味）。
        //   四处不缝：① **不碰钱包**（源四处 updateUserBalanceAndLogTransaction /
        //   updateCharacterPhoneBankBalance 直改用户余额与角色银行卡；本仓用户钱包的仲裁源是
        //   **微信零钱**）—— 本件只算「谁出多少」与「够不够」，出账入账交给那个权威；
        //   ② **不直连模型**（源三处自己拼 systemPrompt 直发，连 Gemini 分支都自己走）—— 走宿主生成侧；
        //   ③ **不写 Dexie、不碰 db.chats / chat.history**（源整份 chat 落库、往 history 塞 isHidden
        //   系统消息驱动模型、结束时塞 pat_message）—— 零数据库铁律 + 不替宿主写楼层；
        //   ④ **一张图都不存、一条外链都不收**（源把生图 URL 含 data: 写进场景与立绘、背景靠外链）——
        //   只登记宿主给的路径与用户自填提示词。
        //   四条偏离：金额一律**整数金币**且 `我出的 + Ta 出的 === 花费` 是不变量（源用 cost / 2 浮点
        //   算 AA、toFixed(2) 显示、四路各写一份扣款）；不做实时定时器与逐句动画（源 4 处 setTimeout）；
        //   历史只留最近 40 场并如实计数（源无上界增长）；「没走到结束」不许当成一场完整的约会
        //   （源只在 isDateOver && completion >= 100 时结算，否则状态静静挂内存里、重开全丢）。
        //   会话键走 ^date_ 前缀，随会话隔离。
        id: 'date',
        name: '约会大作战',
        icon: '💖',
        color: '#f43f5e',
        badge: 0,
        data: {}
    },
"""
apps_new = sub_once(apps, APPS_ANCHOR, DATE_ENTRY + APPS_ANCHOR, 'apps.js 插入点')

# ══════════════ ② config/storage.js ══════════════
storage = rd('config/storage.js')
ST_ANCHOR = """            // [v3.28.0] 自定义组件（widget_settings / widget_templates / widget_instances / widget_draft）："""
assert storage.count(ST_ANCHOR) == 1, 'storage.js 插入点锚点必须恰中 1 次'
ST_NEW = """            // [v3.31.0] 约会大作战（date_settings / date_scenes / date_store）：
            //   与 ^shop_ 同族的单条前缀覆盖三键（无元字符、无需宽匹配登记）。
            //   场景册、场次与欠账都是「这段关系的账」，随会话隔离：
            //   换角色后那是另一个角色的另一本约会账。
            /^date_/,
"""
storage_new = sub_once(storage, ST_ANCHOR, ST_NEW + ST_ANCHOR, 'storage.js 插入点')

# ══════════════ ③ index.js：懒加载分支 + REBIND 键 ══════════════
idx = rd('index.js')
LAZY_ANCHOR = """                } else if (appId === 'widget') {"""
assert idx.count(LAZY_ANCHOR) == 1, 'index.js widget 懒加载分支锚点必须恰中 1 次'
LAZY_NEW = """                } else if (appId === 'date') {
                    // [v3.31.0] 约会大作战：场景册 → 出资四路 → 计划到收场 → 结算卡 → 欠账台账
                    //   （缝合自 EPhone·xintuk date）。
                    //   源「立绘库（滑块调 x/y/size）、BGM 面板（读一起听的曲库、音量写全局键）」两块不缝；
                    //   「直改用户钱包与角色银行卡、直连模型、落 Dexie 并往 chat.history 塞消息、
                    //   外链素材」四处不缝。出账归本仓钱包那个权威（微信零钱），本件只算与只判。
                    //   不做实时定时器（源 4 处 setTimeout），改按需现算。会话键走 ^date_ 前缀。
                    bootTiming.instrumentImport(import('./apps/date/date-app.js'), './apps/date/date-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.dateApp) {
                                window.VirtualPhone.dateApp = new module.DateApp(phoneShell, storage);
                            }
                            window.VirtualPhone.dateApp.render();
                        })
                        .catch(err => {
                            console.error('❌ 加载约会大作战App失败:', err);
                            phoneShell?.showNotification('错误', '约会大作战App加载失败', '❌');
                        });
"""
idx_new = sub_once(idx, LAZY_ANCHOR, LAZY_NEW + LAZY_ANCHOR, 'index.js 懒加载插入点')

REBIND_ANCHOR = """    'loverApp'        // [v3.30.0] 恋爱空间：有未提交草稿（足迹行文本 / 情书 / 两处回答框）、回复目标与展开面
                      //             （_replyTo / _face / _focusDiary / _cursor 皆为视图态），换会话必须丢草稿重取，必须进表
];"""
assert idx_new.count(REBIND_ANCHOR) == 1, 'REBIND 表尾锚点必须恰中 1 次'
REBIND_NEW = """    'loverApp',       // [v3.30.0] 恋爱空间：有未提交草稿（足迹行文本 / 情书 / 两处回答框）、回复目标与展开面
                      //             （_replyTo / _face / _focusDiary / _cursor 皆为视图态），换会话必须丢草稿重取，必须进表
    'dateApp'         // [v3.31.0] 约会大作战：有未提交草稿（场景三格 / JSON 批量 / 剧情与日志文本）、
                      //             选中场次与展开面（_current / _editScene / _showShare / _face 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
];"""
idx_new = sub_once(idx_new, REBIND_ANCHOR, REBIND_NEW, 'REBIND 表尾')

# ══════════════ ④ scripts/keys-audit.mjs ══════════════
keys = rd('scripts/keys-audit.mjs')
KEYS_ANCHOR = """  { key: 'lover_questions', scope: 'chat', note: '[v3.30.0] 提问与回答（三态不许塌成两态；已答过的再答一律拒收）' },"""
assert keys.count(KEYS_ANCHOR) == 1, 'keys 账本 lover_questions 锚点必须恰中 1 次'
KEYS_NEW = KEYS_ANCHOR + """
  { key: 'date_settings', scope: 'chat', note: '[v3.31.0] 约会大作战设置（注入开关 / 注入条数 / 默认出资方式 / 允不允许找 Ta 本人借）' },
  { key: 'date_scenes', scope: 'chat', note: '[v3.31.0] 约会场景册（名字 / 整数金币花费 / 图地址 / 提示词；坏条目如实计数）' },
  { key: 'date_store', scope: 'chat', note: '[v3.31.0] 约会场次与欠账（出资分配不变量「我出的 + Ta 出的 = 花费」；不碰任何余额）' },"""
keys_new = sub_once(keys, KEYS_ANCHOR, KEYS_NEW, 'keys 账本插入点')

# ══════════════ ⑤ phone.css 追加段 ══════════════
phone = rd('phone.css')
css_src = rd('apps/date/date.css')
assert css_src.startswith('/* [v3.31.0] 约会大作战 App（.dat-*） */'), '样式源段头不符'
body = css_src.split('\n', 1)[1]
if '/* ---------- [v3.31.0] 约会大作战 App（.dat-*） ---------- */' in phone:
    assert False, 'phone.css 里已有本段（重复追加会破坏逐字同源判据）'
phone_new = phone.rstrip('\n') + '\n\n/* ---------- [v3.31.0] 约会大作战 App（.dat-*） ---------- */\n' + body

# ══════════════ ⑥ tests/system-v255.test.mjs 的 dirMap ══════════════
v255 = rd('tests/system-v255.test.mjs')
V255_ANCHOR = """    loverApp: 'loverspace'     // [v3.30.0] 恋爱空间：换会话丢草稿（足迹 / 情书 / 回答）与视图态（_replyTo / _focusDiary）并全量重取
  };"""
assert v255.count(V255_ANCHOR) == 1, 'v255 dirMap 表尾锚点必须恰中 1 次'
V255_NEW = """    loverApp: 'loverspace',    // [v3.30.0] 恋爱空间：换会话丢草稿（足迹 / 情书 / 回答）与视图态（_replyTo / _focusDiary）并全量重取
    dateApp: 'date'            // [v3.31.0] 约会大作战：换会话丢草稿（场景三格 / 剧情与日志）与视图态（_current / _editScene）并全量重取
  };"""
v255_new = sub_once(v255, V255_ANCHOR, V255_NEW, 'v255 dirMap 表尾')

# ══════════════ 摘要 / 落盘 ══════════════
print('== 摘要 ==')
print('apps.js  +%d 字节（新条目）' % (len(apps_new) - len(apps)))
print('storage.js +%d 字节（^date_ 前缀）' % (len(storage_new) - len(storage)))
print('index.js +%d 字节（懒加载分支 + REBIND 键）' % (len(idx_new) - len(idx)))
print('keys-audit +%d 字节（3 条新键）' % (len(keys_new) - len(keys)))
print('phone.css +%d 字节（本版段）' % (len(phone_new) - len(phone)))
print('v255 +%d 字节（dirMap 一条）' % (len(v255_new) - len(v255)))

if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)

wr('config/apps.js', apps_new)
wr('config/storage.js', storage_new)
wr('index.js', idx_new)
wr('scripts/keys-audit.mjs', keys_new)
wr('phone.css', phone_new)
wr('tests/system-v255.test.mjs', v255_new)
print('== 已落盘 ==')