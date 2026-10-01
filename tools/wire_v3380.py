#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wire_v3380.py — [v3.38.0] 召回治理台 六处接线（本仓新增 App 的固定落点）。
① config/apps.js          —— 加召回治理台条目（soundkit 之后、widget 之前）
② config/storage.js       —— 加 ^recall_ 会话键前缀
③ index.js                —— 懒加载分支 + 重绑表槽位名 recallApp
④ scripts/keys-audit.mjs  —— 三条会话键登记
⑤ tests/system-v255.test.mjs —— 懒加载 dirMap 登记
⑥ phone.css               —— 贴本版样式段（段头独立成行）
纪律：每处锚点命中次数必须恰好 1，否则拒写（不猜、不模糊匹配）。
含反斜线的 JS 片段一律用 raw 三引号 包（否则 Python 会把反斜线 u 当自己的转义）；
App 图标用**原生 emoji**（与文件里其余 App 一致 —— 上一版写成 JS 转义，
结果在页面里当字面量显示了）。
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


# ──────────────── ① config/apps.js ────────────────
A_OLD = """    {
        // [v3.28.0] 自定义组件"""
A_NEW = r"""    {
        // [v3.38.0] 召回治理台：管理取回的路，不自己取回（缝合自 SullyOS 记忆宫殿
        //   memory-palace-CwLWWYyz.js 845367 字符的多路召回管线）。
        //   源的「记忆宫殿」不是展示面（时间轴 / 节日 / 一起听这些词在源里 0~8 次命中），
        //   实为一整套**召回治理内核**：四路来源（稀疏 BM25 / 本地向量 / 远程向量 / 重排）
        //   + 房间三轴权重（相似 / 新近 / 重要）+ 高水位线 + 降级链 + Trace 注入。
        //   取五块：① 路状态判序（没配 / 已关 / 陈旧 / 降级 / 失败 / 可用）② 房间三轴权重表
        //   ③ BM25 三档与认不出落 naive 的口径 ④ 高水位线（失败批次不推进）⑤ 注入裁决与逐路贡献。
        //   四块不缝：① **不自己调 embedding**（源 47 处 apiKey / 56 处 fetch 自己算向量；本件
        //   零网络，只治理已到手的候选 —— 候选由本仓 apps/memory 的 BM25 与 LonSha 桥供给，
        //   缝进来就是第二个模型出口，与 apps/settings 争权威）；② **不碰宿主对象**（源把召回结果
        //   注入宿主请求；本件只产回执与裁决）；③ **不读别的 App 的表**（源直读 spark_char_handles
        //   与角色卡字段）；④ **不收外链、不落数据库**（源走 IndexedDB 迁版 + 远程向量库上传；
        //   本件零数据库零上传，落 PhoneStorage 三条会话键）。
        //   三条偏离：① **路状态六态互不同形**（源把「没配 / 被关掉 / 索引陈旧 / 降级中 / 上次失败」
        //   在读数面塔成同一个「不可用」，于是用户永远分不出该去配、该去开、还是该重建索引）；
        //   ② **融合必须报贡献**（源融合后只给结果列表，没有任何一处能回答「这条路贡献了几条」；
        //   本件走确定性 RRF 并逐路报进来 / 并入 / 重复 / 跳过）；③ **空召回不许注入**
        //   （源无条件注入；本件分四种跳过因，且「真的没有」与「四路全坏」**不许同形**
        //   —— 前者用户不用管，后者用户得去修路径）。
        //   写盘三条键走 ^recall_ 前缀随会话隔离。
        id: 'recall',
        name: '召回治理台',
        icon: '🏛️',
        color: '#2f6fd0',
        badge: 0,
        data: {}
    },
    {
        // [v3.28.0] 自定义组件"""
patch('config/apps.js', A_OLD, A_NEW, 'config/apps.js 条目')

# ──────────────── ② config/storage.js ────────────────
B_OLD = """            /^soundkit_/,"""
B_NEW = """            /^soundkit_/,
            // [v3.38.0] 召回治理台（recall_settings / recall_policy / recall_ledger）：
            //   一条前缀覆盖三键，三条键都无元字符，按仓内口径「无需宽匹配登记」。
            //   四路配置、策略（房间 / 注入开关 / 门槛 / topN / 水位线）、台账各自独立。
            //   随会话隔离：源把配置挂在角色卡与全局对象上，切角色时**原样留着**（串味）。源没有这一步。
            /^recall_/,"""
patch('config/storage.js', B_OLD, B_NEW, 'config/storage.js 前缀')

# ──────────────── ③ index.js 懒加载分支 ────────────────
C_OLD = """                } else if (appId === 'widget') {"""
C_NEW = r"""                } else if (appId === 'recall') {
                    // [v3.38.0] 召回治理台：管理取回的路，不自己取回（缝合自 SullyOS 记忆宫殿
                    //   memory-palace-CwLWWYyz.js 845367 字符的多路召回管线）。
                    //   取五块：路状态判序 / 房间三轴权重表 / BM25 三档与认不出的兜底 / 高水位线 /
                    //   注入裁决与逐路贡献。
                    //   四块不缝：不自己调 embedding（源 47 处 apiKey、56 处 fetch；本件零网络，
                    //   只治理已到手的候选）；不碰宿主对象；不读别的 App 的表；不收外链也不落数据库。
                    //   三条偏离：路状态六态互不同形（源塌成「不可用」）；融合逐路报贡献（源只给结果列表）；
                    //   空召回不许注入且「真的没有」与「四路全坏」不同形（源无条件注入）。
                    //   写盘三条键走 ^recall_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/recall/recall-app.js'), './apps/recall/recall-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.recallApp) {
                                window.VirtualPhone.recallApp = new module.RecallApp(phoneShell, storage);
                            }
                            window.VirtualPhone.recallApp.render();
                        })
                        .catch(err => {
                            console.error('\u274c 加载召回治理台App失败:', err);
                            phoneShell?.showNotification('错误', '召回治理台App加载失败', '\u274c');
                        });
                } else if (appId === 'widget') {"""
patch('index.js', C_OLD, C_NEW, 'index.js 懒加载分支')

# ──────────────── ③ index.js 重绑表 ────────────────
D_OLD = """    'soundkitApp'     // [v3.37.0] 白盒音效盒：有未提交的配方草稿（音符表 / 名字 / 音量）、
                      //             分享码草稿与 CSS 探针（_draft / _cssProbe 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
];"""
D_NEW = """    'soundkitApp',    // [v3.37.0] 白盒音效盒：有未提交的配方草稿（音符表 / 名字 / 音量）、
                      //             分享码草稿与 CSS 探针（_draft / _cssProbe 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
    'recallApp'       // [v3.38.0] 召回治理台：有候选快照草稿、标签页与详情态，
                      //             且四路配置 / 策略 / 台账全是「这段关系的账」——
                      //             换会话必须全量重取，必须进表
];"""
patch('index.js', D_OLD, D_NEW, 'index.js 重绑表')

# ──────────────── ④ scripts/keys-audit.mjs ────────────────
E_OLD = """  { key: 'soundkit_ledger', scope: 'chat', note: '[v3.37.0] 音效盒台账（试听过哪些槽 / 导出过哪些配方，与配方数分开报）' },"""
E_NEW = """  { key: 'soundkit_ledger', scope: 'chat', note: '[v3.37.0] 音效盒台账（试听过哪些槽 / 导出过哪些配方，与配方数分开报）' },
  { key: 'recall_settings', scope: 'chat', note: '[v3.38.0] 召回治理台四路配置（configured / enabled / modelChanged / degraded / lastError 五个原始位 + BM25 原值）' },
  { key: 'recall_policy', scope: 'chat', note: '[v3.38.0] 召回治理台策略（当前房间 / 注入开关 / 最低分 / 取前几条 / 高水位线）' },
  { key: 'recall_ledger', scope: 'chat', note: '[v3.38.0] 召回治理台台账（四路候选快照 + 每次召回的回执；真的没有与四路全坏分开报）' },"""
patch('scripts/keys-audit.mjs', E_OLD, E_NEW, 'keys-audit 三键')

# ──────────────── ⑤ tests/system-v255.test.mjs ────────────────
F_OLD = """    soundkitApp: 'soundkit'    // [v3.37.0] 音效盒：换会话丢配方草稿（音符表 / 名字 / 音量）、分享码与 CSS 探针并全量重取"""
F_NEW = """    soundkitApp: 'soundkit',   // [v3.37.0] 音效盒：换会话丢配方草稿（音符表 / 名字 / 音量）、分享码与 CSS 探针并全量重取
    recallApp: 'recall'        // [v3.38.0] 召回治理台：换会话丢候选快照草稿与标签页详情态，四路配置 / 策略 / 台账全量重取"""
patch('tests/system-v255.test.mjs', F_OLD, F_NEW, 'v255 dirMap')

# ──────────────── ⑥ phone.css ────────────────
G_OLD = """/* ══════════════ [v3.37.0] 白盒音效盒（soundkit） ══════════════ */"""
G_NEW = """/* ══════════════ [v3.38.0] 召回治理台（recall） ══════════════ */
__RECALL_CSS__
/* ══════════════ [v3.37.0] 白盒音效盒（soundkit） ══════════════ */"""
SEG = rd('apps/recall/recall.css').strip()
assert SEG.startswith('/* ===='), 'recall.css 必须以块注释段头起头'
assert '.rcl-root' in SEG
patch('phone.css', G_OLD, G_NEW.replace('__RECALL_CSS__', SEG), 'phone.css 样式段')

# ──────────────── 落盘 ────────────────
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
