#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag1.py — [v3.36.0] 杂志六处接线。

六处落点（照 pixiv / lofter 范式，逐处断言锚点恰中 1 次）：
  ① config/apps.js     —— 加 App 注册条目（id/name/icon/color/badge/data）；
  ② config/storage.js  —— 加会话键前缀 `/^magazine_/`（一条宽前缀覆盖三键）+ 四行配套注释；
  ③ index.js           —— 重绑表 `'magazineApp'` + 懒加载分支（`appId === 'magazine'`）；
  ④ scripts/keys-audit.mjs —— 登记三条会话键（scope 全为 chat）；
  ⑤ tests/system-v255.test.mjs —— 加目录映射（换会话丢什么）；
  ⑥ phone.css          —— 追加样式段（段头**独立成行** —— 本仓踩过粘连坑）。
先落盘脚本再执行；执行后逐处 node --check。
"""
import io
import sys

EDITS = []

# ─────────── ① config/apps.js ───────────
APPS_ANCHOR = "        id: 'pixiv',\n        name: 'Pixiv',\n        icon: '🎨',\n        color: '#818cf8',\n        badge: 0,\n        data: {}\n    },\n"
APPS_NEW = APPS_ANCHOR + """    {
        // [v3.36.0] 杂志：动画杂志（缝合自 Perigee js/magazine.js 1971 行 / 118212 字节 + magazine.css 20050 字节）。
        //   源是一个挂在全局 AppState.data.magazineData 上（切角色串味）、以 Utils.saveData 整块回写
        //   （13 处命中）、与放送局 / 论坛 / TTS 三处联动的日文动画杂志仿真：十种稿件类型
        //   （声优访谈 / 制作组访谈 / 圆桌座谈 / 人气投票 / 角色企划 / 制作专栏 / 读者来函 /
        //   角色对谈 / 关系图 / 月度总结）、十套正文解析器、四套导出、译文折叠块。
        //   四处不缝（都写清后果）：
        //     ① 源有 8 处 Utils.callChatAPI 直连模型、自己拼 systemPrompt 自己解析 TITLE: 行
        //        —— 本件一条请求都不发，只产「可复制的要求文本」，结果由用户贴回来登记；
        //     ② 源把整块状态经 Utils.saveData 回写、往宿主事件总线抛 emitEvent、读
        //        broadcast.officialNpcs —— 本件零宿主写入零宿主读，三条会话键各走 PhoneStorage；
        //     ③ 源要别的 App 的池（放送局的官方 NPC 当受访者 / 论坛的世界观当题材 /
        //        ttsConfig 当音频出口）—— 本件自带 10 位原创受访者池，零跨 App 读；
        //     ④ 源 exportImage() 从 jsdelivr CDN 动态插 <script> 拉 html2canvas、把离屏 DOM
        //        画成 PNG data URL —— 本件一条外链都不收、一张图都不产，导出只有 TXT 与可打印结构。
        //   三条偏离：期号收成登记时写下的序号（源用 findIndex+1 反查，删中间一篇后
        //   后面所有篇期号集体前移，旧导出与新读数对不上）；正文解析收成唯一实现
        //   （源十套解析器各写一遍、同一行在不同类型下归类不同且没人能回答「这行算被认出来了吗」）；
        //   译文按段落数组存（源把整段转义后塞 innerHTML，译文里的标签全变可见字符）。
        //   写盘三条键走 ^magazine_ 前缀随会话隔离。
        id: 'magazine',
        name: '杂志',
        icon: '📖',
        color: '#8b6914',
        badge: 0,
        data: {}
    },
"""
EDITS.append(('config/apps.js', APPS_ANCHOR, APPS_NEW, 'apps.js 注册条目'))

# ─────────── ② config/storage.js ───────────
STOR_ANCHOR = "            /^pixiv_/,\n"
STOR_NEW = STOR_ANCHOR + """            // [v3.36.0] 杂志（magazine_settings / magazine_content / magazine_ledger）：
            //   一条前缀覆盖三键，三条键都无元字符，按仓内口径「无需宽匹配登记」。
            //   设置（杂志名 / 正文语言 / 默认类型）、内容（稿件 + 译文 + 自建受访者）、
            //   台账（分享过哪些 / 导出过哪些）各自独立。
            //   随会话隔离：源把这些全挂在内存的 AppState.data.magazineData 上，切角色即串味。
            /^magazine_/,
"""
EDITS.append(('config/storage.js', STOR_ANCHOR, STOR_NEW, 'storage.js 会话键前缀'))

# ─────────── ③ index.js ───────────
IDX_REBIND_ANCHOR = "    'pixivApp'        // [v3.35.0] Pixiv：有未提交草稿"
i = None
IDX_LAZY_ANCHOR = """                        .catch(err => {
                            console.error('❌ 加载PixivApp失败:', err);
                            phoneShell?.showNotification('错误', 'PixivApp加载失败', '❌');
                        });
"""
IDX_LAZY_NEW = IDX_LAZY_ANCHOR + """} else if (appId === 'magazine') {
                    // [v3.36.0] 杂志：动画杂志（缝合自 Perigee magazine.js 1971 行 / 118212 字节）。
                    //   取六块：十种稿件类型 / 列表与阅读面 / 十套正文解析（提成唯一实现） /
                    //   四套导出（TXT 与可打印结构，不产二进制）/ 译文折叠块 / 分享文本。
                    //   四处不缝：不直连任何模型（源 8 处 callChatAPI）—— 改摆可复制的要求文本，
                    //   结果由用户贴回来登记；不碰宿主对象（源 13 处 saveData + 8 处 emitEvent）；
                    //   不共用别的 App 的池（源要放送局 NPC / 论坛世界观 / ttsConfig，本件自带 10 位）；
                    //   不动态加载外部脚本、不产二进制（源从 CDN 拉 html2canvas 画长图）。
                    //   三条偏离：期号是登记时写下的序号（源 findIndex+1 会随删除集体前移）；
                    //   正文解析收成唯一实现（源十套各写一遍且从不报告「没认出来」）；
                    //   译文按段落数组存（源整段转义后塞 innerHTML）。
                    //   写盘三条键走 ^magazine_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/magazine/magazine-app.js'), './apps/magazine/magazine-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.magazineApp) {
                                window.VirtualPhone.magazineApp = new module.MagazineApp(phoneShell, storage);
                            }
                            window.VirtualPhone.magazineApp.render();
                        })
                        .catch(err => {
                            console.error('❌ 加载MagazineApp失败:', err);
                            phoneShell?.showNotification('错误', 'MagazineApp加载失败', '❌');
                        });
"""
IDX_REBIND_NEW = IDX_REBIND_ANCHOR + """
                      //             选中面与展开项（_current / _tab / _promptFor 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
    'magazineApp'     // [v3.36.0] 杂志：有未提交的稿件草稿（取材页的选人与贴回文本）与视图态，
                      //             换会话必须丢草稿重取，必须进表"""
EDITS.append(('index.js', IDX_REBIND_ANCHOR, IDX_REBIND_NEW, 'index.js 重绑表'))
EDITS.append(('index.js', IDX_LAZY_ANCHOR, IDX_LAZY_NEW, 'index.js 懒加载分支'))

# ─────────── ④ scripts/keys-audit.mjs ───────────
KEYS_ANCHOR = "  { key: 'pixiv_store', scope: 'chat', note: '[v3.35.0] Pixiv互动（关注作者 / 订阅 tag / 收藏 / 追更 / 浏览记录各自独立）' },\n"
KEYS_NEW = KEYS_ANCHOR + """  { key: 'magazine_settings', scope: 'chat', note: '[v3.36.0] 杂志设置（杂志名 / 正文语言 / 默认稿件类型）' },
  { key: 'magazine_content', scope: 'chat', note: '[v3.36.0] 杂志内容（稿件 + 译文 + 自建受访者；超上限如实计数后裁剪）' },
  { key: 'magazine_ledger', scope: 'chat', note: '[v3.36.0] 杂志台账（分享过哪些 / 导出过哪些，与稿件数分开报）' },
"""
EDITS.append(('scripts/keys-audit.mjs', KEYS_ANCHOR, KEYS_NEW, 'keys-audit 三键登记'))

# ─────────── ⑤ tests/system-v255.test.mjs ───────────
V255_ANCHOR = "    pixivApp: 'pixiv'"
V255_NEW = V255_ANCHOR + """,
    magazineApp: 'magazine'    // [v3.36.0] 杂志：换会话丢稿件与译文与台账（视图态一并重置）并全量重取"""
EDITS.append(('tests/system-v255.test.mjs', V255_ANCHOR, V255_NEW, 'v255 目录映射'))

# ─────────── ⑥ phone.css ───────────
CSS = io.open('apps/magazine/magazine.css', encoding='utf-8').read()
CSS_SEG = '\n/* ══════════════ [v3.36.0] 杂志（magazine） ══════════════ */\n' + CSS
EDITS.append(('phone.css', None, CSS_SEG, 'phone.css 样式段（追加）'))


def main(write):
    bad = 0
    for path, old, new, label in EDITS:
        text = io.open(path, encoding='utf-8').read()
        if old is None:
            # 追加型：段头必须独立成行
            if not text.endswith('\n'):
                text += '\n'
            n = 1
        else:
            n = text.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
            bad += 1
            continue
        if write:
            if old is None:
                io.open(path, 'w', encoding='utf-8').write(text + new)
            else:
                io.open(path, 'w', encoding='utf-8').write(text.replace(old, new, 1))
            print('OK   %s' % label)
        else:
            print('DRY  %s（命中 1 次）' % label)
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    print('全部完成' if write else '（dry-run）')


main('--write' in sys.argv)