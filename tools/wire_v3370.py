#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wire_v3370.py — [v3.37.0] 白盒音效盒 六处接线（本仓新增 App 的固定落点）。

① config/apps.js          —— 加白盒音效盒条目（magazine 之后、widget 之前）
② config/storage.js       —— 加 ^soundkit_ 会话键前缀
③ index.js                —— 懒加载分支 + 重绑表槽位名 soundkitApp
④ scripts/keys-audit.mjs  —— 三条会话键登记
⑤ tests/system-v255.test.mjs —— 懒加载 dirMap 登记（**顺手修**上一版把 pixiv 注释
                              挤到 magazine 行尾的粘连：两行注释粘成一行后，
                              这一行读起来像「Pixiv 的说明属于 magazine」，是下一次
                              改动时的误改来源）
⑥ phone.css               —— 贴本版样式段（段头独立成行）

纪律：每处锚点命中次数必须恰好 1，否则拒写（不猜、不模糊匹配）。
默认 dry-run，`--write` 才落盘。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(text, old, new, tag):
    n = text.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return text.replace(old, new, 1)


DRAFT = {}


def patch(rel, old, new, tag):
    cur = DRAFT.get(rel, rd(rel))
    DRAFT[rel] = once(cur, old, new, tag)
    print('OK  %s' % tag)


# ────────────────────────── ① config/apps.js ──────────────────────────
A_OLD = """    {
        // [v3.28.0] 自定义组件"""
A_NEW = """    {
        // [v3.37.0] 白盒音效盒：音效是数据，不是音频文件（缝合自 SullyOS 的
        //   WhiteboxSoundEditor 37105 字节 + ttsRouter / voicePlayback / SARSpeechSwitch 三件套）。
        //   源的「白盒」二字指的就是这件事：六条内置音效**不是 mp3**，而是可读可改的合成配方
        //   （每条是若干 oscillator 音符：频率 / 起点 / 时长 / 波形 / 增益），播放时由 WebAudio
        //   现合成。取五块：① 合成配方真源表 ② 播放器机制（8ms 淡入 + 指数淡出）③ 分享码
        //   ④ 语音三件套的**机制**（自动播放受限的人话化 / 原台词与污染台词二态）⑤ CSS 绑定注释编解码。
        //   四块不缝：① **不自己调 TTS 商**（源 ttsRouter 直连 fishaudio / elevenlabs / minimax，
        //   自己拼请求、按语言选模型、粤语还做模型前置校验）—— 本件一个网络调用都没有，
        //   合成只走本机 WebAudio，本仓语音出口的唯一仲裁者是 apps/settings 的语音设置面，本件不与它争；
        //   ② **不碰宿主对象**（源把提示音写回宿主、把绑定注释写进宿主白框）—— 零宿主读零宿主写；
        //   ③ **不读别的 App 的表**（源直接读全局音频元素与角色卡的 voiceProfile 字段）—— 自带配方表；
        //   ④ **不收外链、不产二进制**（源允许 https 直链与 ≤200KB 音频上传转 data URL）——
        //   只收配方，零 URL、零 base64 载荷、零上传，「音效」在本件里永远是**可审计的数字**。
        //   三条偏离：四态互不同形（源把「没绑 / 绑空 / 绑了不存在的 key」塌成一句「点了没响」）；
        //   配方提成可登记可导出且过校验门、坏音符**如实计数**（源把坏值拖到播放期才抛，
        //   而播放期抛异常在宿主里常被吞掉）；音量收成一次取值门（源每处调用点各写一遍
        //   Math.min(1, Math.max(0, ...))，而 Number('') 与 Number(null) 都是 0 ⇒
        //   「没给」被读成「静音」）。
        //   写盘三条键走 ^soundkit_ 前缀随会话隔离。
        id: 'soundkit',
        name: '音效盒',
        icon: '\\U0001f50a',
        color: '#35d6b0',
        badge: 0,
        data: {}
    },
    {
        // [v3.28.0] 自定义组件"""
patch('config/apps.js', A_OLD, A_NEW, 'config/apps.js 条目')

# ────────────────────────── ② config/storage.js ──────────────────────────
B_OLD = """            /^magazine_/,"""
B_NEW = """            /^magazine_/,
            // [v3.37.0] 白盒音效盒（soundkit_settings / soundkit_recipes / soundkit_ledger）：
            //   一条前缀覆盖三键，三条键都无元字符，按仓内口径「无需宽匹配登记」。
            //   绑定表（四个去处各绑了什么 + 试听音量）、自定义配方、台账各自独立。
            //   随会话隔离：源把提示音写回宿主对象，切角色时**原样留着**（串味）。源没有这一步。
            /^soundkit_/,"""
patch('config/storage.js', B_OLD, B_NEW, 'config/storage.js 前缀')

# ────────────────────────── ③ index.js 懒加载分支 ──────────────────────────
C_OLD = """                } else if (appId === 'widget') {"""
C_NEW = """                } else if (appId === 'soundkit') {
                    // [v3.37.0] 白盒音效盒：音效是数据（缝合自 SullyOS WhiteboxSoundEditor 37105 字节
                    //   + ttsRouter / voicePlayback / SARSpeechSwitch 三件套）。
                    //   取五块：合成配方真源表 / 播放器机制（8ms 淡入 + 指数淡出）/ 分享码 /
                    //   语音三件套的机制（自动播放受限的人话化 + 原台词与污染台词二态）/ CSS 绑定注释编解码。
                    //   四块不缝：不自己调 TTS 商（源直连三家，本件零网络调用，合成只走本机 WebAudio）；
                    //   不碰宿主对象；不读别的 App 的表；不收外链也不产二进制（只收配方）。
                    //   三条偏离：四态互不同形（源塌成「点了没响」）；坏音符如实计数（源拖到播放期才抛）；
                    //   音量一次取值（源每处各写一遍，Number('') 与 Number(null) 都是 0 ⇒ 「没给」读成「静音」）。
                    //   写盘三条键走 ^soundkit_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/soundkit/soundkit-app.js'), './apps/soundkit/soundkit-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.soundkitApp) {
                                window.VirtualPhone.soundkitApp = new module.SoundkitApp(phoneShell, storage);
                            }
                            window.VirtualPhone.soundkitApp.render();
                        })
                        .catch(err => {
                            console.error('\\u274c 加载音效盒App失败:', err);
                            phoneShell?.showNotification('错误', '音效盒App加载失败', '\\u274c');
                        });
                } else if (appId === 'widget') {"""
patch('index.js', C_OLD, C_NEW, 'index.js 懒加载分支')

# ────────────────────────── ③ index.js 重绑表 ──────────────────────────
D_OLD = """    'magazineApp'     // [v3.36.0] 杂志：有未提交的稿件草稿（取材页的选人与贴回文本）与视图态，
                      //             换会话必须丢草稿重取，必须进表
];"""
D_NEW = """    'magazineApp',    // [v3.36.0] 杂志：有未提交的稿件草稿（取材页的选人与贴回文本）与视图态，
                      //             换会话必须丢草稿重取，必须进表
    'soundkitApp'     // [v3.37.0] 白盒音效盒：有未提交的配方草稿（音符表 / 名字 / 音量）、
                      //             分享码草稿与 CSS 探针（_draft / _cssProbe 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
];"""
patch('index.js', D_OLD, D_NEW, 'index.js 重绑表')

# ────────────────────────── ④ scripts/keys-audit.mjs ──────────────────────────
E_OLD = """  { key: 'magazine_ledger', scope: 'chat', note: '[v3.36.0] 杂志台账（分享过哪些 / 导出过哪些，与稿件数分开报）' },"""
E_NEW = """  { key: 'magazine_ledger', scope: 'chat', note: '[v3.36.0] 杂志台账（分享过哪些 / 导出过哪些，与稿件数分开报）' },
  { key: 'soundkit_settings', scope: 'chat', note: '[v3.37.0] 音效盒设置（四个去处各绑了什么 + 试听总音量）' },
  { key: 'soundkit_recipes', scope: 'chat', note: '[v3.37.0] 音效盒配方（自定义合成配方；音效本身就是数据，超上限如实计数后裁剪）' },
  { key: 'soundkit_ledger', scope: 'chat', note: '[v3.37.0] 音效盒台账（试听过哪些槽 / 导出过哪些配方，与配方数分开报）' },"""
patch('scripts/keys-audit.mjs', E_OLD, E_NEW, 'keys-audit 三键')

# ────────────────────────── ⑤ tests/system-v255.test.mjs ──────────────────────────
F_OLD = """    pixivApp: 'pixiv',
    magazineApp: 'magazine'    // [v3.36.0] 杂志：换会话丢稿件与译文与台账（视图态一并重置）并全量重取          // [v3.35.0] Pixiv：换会话丢草稿（作品三格 / 续章正文 / 评论 / 插画登记 / 文风与作者）与视图态并全量重取
  };"""
F_NEW = """    pixivApp: 'pixiv',         // [v3.35.0] Pixiv：换会话丢草稿（作品三格 / 续章正文 / 评论 / 插画登记 / 文风与作者）与视图态并全量重取
    magazineApp: 'magazine',   // [v3.36.0] 杂志：换会话丢稿件与译文与台账（视图态一并重置）并全量重取
    soundkitApp: 'soundkit'    // [v3.37.0] 音效盒：换会话丢配方草稿（音符表 / 名字 / 音量）、分享码与 CSS 探针并全量重取
  };"""
patch('tests/system-v255.test.mjs', F_OLD, F_NEW, 'v255 dirMap（并修复粘连注释）')

# ────────────────────────── ⑥ phone.css ──────────────────────────
G_OLD = """/* ══════════════ [v3.36.0] 杂志（magazine） ══════════════ */"""
G_NEW = """/* ══════════════ [v3.37.0] 白盒音效盒（soundkit） ══════════════ */
__SOUNDKIT_CSS__
/* ══════════════ [v3.36.0] 杂志（magazine） ══════════════ */"""
SEG = rd('apps/soundkit/soundkit.css').strip()
assert SEG.startswith('/* ===='), 'soundkit.css 必须以块注释段头起头'
assert '.snd-root' in SEG
patch('phone.css', G_OLD, G_NEW.replace('__SOUNDKIT_CSS__', SEG), 'phone.css 样式段')

# ────────────────────────── 落盘 ──────────────────────────
if not WRITE:
    print('\n（dry-run，未落盘；加 --write 才写）')
    for rel, txt in DRAFT.items():
        print('  %-34s %d 字节' % (rel, len(txt.encode('utf-8'))))
    sys.exit(0)

for rel, txt in DRAFT.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(txt)
    print('WROTE %s' % rel)
print('\n六处接线完成。')
