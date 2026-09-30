#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v3.29.0 接线：桃宝 App 四处注册 + 会话键前缀 + 键账本 + phone.css 段。

纪律：每个锚点必须**恰中 1 次**（不中即退出，绝不半套落地）；
先算 draft、逐条断言、最后才落盘。
"""
import io
import json
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
TAOBAO_ENTRY = """    {
        // [v3.29.0] 桃宝：商品目录 → 购物车 → 下单 → **物流时间线推演**（缝合自 EPhone·xintuk taobao 四片）。
        //   源是四合一超级模块（抓娃娃机 + 购物 + 外卖 + 物流），本件取三块。五处不缝：
        //   商品与评价靠模型生成 / 实时物流定时器 / Dexie / 直改用户钱包与角色银行卡 / 外链素材。
        //   物流改**惰性补推**：状态由时间推演决定（源挂 setTimeout 且要回查页面是否 active）。
        //   娃娃机战利品只登记面值不入账（本仓用户钱包的仲裁源是微信零钱）。
        //   会话键走 ^taobao_ 前缀，随会话隔离。
        id: 'taobao',
        name: '桃宝',
        icon: '🛍️',
        color: '#f97316',
        badge: 0,
        data: {}
    },
"""
apps_new = sub_once(apps, APPS_ANCHOR, TAOBAO_ENTRY + APPS_ANCHOR, 'apps.js 插入点')

# ══════════════ ② config/storage.js ══════════════
storage = rd('config/storage.js')
ST_ANCHOR = """            // [v3.28.0] 自定义组件（widget_settings / widget_templates / widget_instances / widget_draft）："""
assert storage.count(ST_ANCHOR) == 1, 'storage.js 插入点锚点必须恰中 1 次'
ST_NEW = """            // [v3.29.0] 桃宝（taobao_settings / taobao_products / taobao_cart / taobao_orders / taobao_grabs）：
            //   与 ^shop_ 同族的单条前缀覆盖五键（无元字符、无需宽匹配登记）。
            //   目录、车、订单与抓取记录随会话隔离：换角色后那是另一个角色的另一个店。
            /^taobao_/,
"""
storage_new = sub_once(storage, ST_ANCHOR, ST_NEW + ST_ANCHOR, 'storage.js 插入点')

# ══════════════ ③ index.js：懒加载分支 + REBIND 键 ══════════════
idx = rd('index.js')
LAZY_ANCHOR = """                } else if (appId === 'widget') {"""
assert idx.count(LAZY_ANCHOR) == 1, 'index.js widget 懒加载分支锚点必须恰中 1 次'
LAZY_NEW = """                } else if (appId === 'taobao') {
                    // [v3.29.0] 桃宝：商品目录 → 购物车 → 下单 → 物流时间线推演（缝合自 EPhone·xintuk taobao）。
                    //   源「商品与评价靠模型生成、物流挂实时 setTimeout、落 Dexie、直改用户钱包、
                    //   12 条外链素材」五块都不缝。物流改**惰性补推**（状态由时间推演，与页面在不在无关）。
                    //   娃娃机战利品只登记面值不入账。会话键走 ^taobao_ 前缀，随会话隔离。
                    bootTiming.instrumentImport(import('./apps/taobao/taobao-app.js'), './apps/taobao/taobao-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.taobaoApp) {
                                window.VirtualPhone.taobaoApp = new module.TaobaoApp(phoneShell, storage);
                            }
                            window.VirtualPhone.taobaoApp.render();
                        })
                        .catch(err => {
                            console.error('❌ 加载桃宝App失败:', err);
                            phoneShell?.showNotification('错误', '桃宝App加载失败', '❌');
                        });
"""
idx_new = sub_once(idx, LAZY_ANCHOR, LAZY_NEW + LAZY_ANCHOR, 'index.js 懒加载插入点')

REBIND_ANCHOR = """    'widgetApp'       // [v3.28.0] 自定义组件：有未保存草稿（widget_draft）与选中态，换会话必须丢草稿重取，必须进表
];"""
assert idx_new.count(REBIND_ANCHOR) == 1, 'REBIND 表尾锚点必须恰中 1 次'
REBIND_NEW = """    'widgetApp',      // [v3.28.0] 自定义组件：有未保存草稿（widget_draft）与选中态，换会话必须丢草稿重取，必须进表
    'taobaoApp'       // [v3.29.0] 桃宝：有展开的物流面板（_openLogi，视图态），换会话必须收起重取，必须进表
];"""
idx_new = sub_once(idx_new, REBIND_ANCHOR, REBIND_NEW, 'REBIND 表尾')

# ══════════════ ④ scripts/keys-audit.mjs ══════════════
keys = rd('scripts/keys-audit.mjs')
KEYS_ANCHOR = """  { key: 'shop_orders', scope: 'chat', note: '[v3.27.0] 商城订单（金额以分存 + 下单时的商品快照）' },"""
assert keys.count(KEYS_ANCHOR) == 1, 'keys 账本 shop_orders 锚点必须恰中 1 次'
KEYS_NEW = KEYS_ANCHOR + """
  { key: 'taobao_settings', scope: 'chat', note: '[v3.29.0] 桃宝设置（注入开关 / 注入条数 / 物流时间倍率 / 抓取上限）' },
  { key: 'taobao_products', scope: 'chat', note: '[v3.29.0] 桃宝商品目录（价格一律以分为整数存；可空=未定价）' },
  { key: 'taobao_cart', scope: 'chat', note: '[v3.29.0] 桃宝购物车（条目 + 数量二元组；不在目录的条目仍留车上并显形）' },
  { key: 'taobao_orders', scope: 'chat', note: '[v3.29.0] 桃宝订单（商品快照 + 物流三元组 + 推演出的四段状态）' },
  { key: 'taobao_grabs', scope: 'chat', note: '[v3.29.0] 娃娃机抓取记录（只登记面值，不入任何账）' },"""
keys_new = sub_once(keys, KEYS_ANCHOR, KEYS_NEW, 'keys 账本插入点')

# ══════════════ ⑤ phone.css 追加段 ══════════════
phone = rd('phone.css')
css_src = rd('apps/taobao/taobao.css')
assert css_src.startswith('/* [v3.29.0] 桃宝 App（.tbo-*） */'), '样式源段头不符'
body = css_src.split('\n', 1)[1]
if '/* ---------- [v3.29.0] 桃宝 App（.tbo-*） ---------- */' in phone:
    assert False, 'phone.css 里已有本段（重复追加会破坏逐字同源判据）'
phone_new = phone.rstrip('\n') + '\n\n/* ---------- [v3.29.0] 桃宝 App（.tbo-*） ---------- */\n' + body

# ══════════════ 摘要 / 落盘 ══════════════
print('== 摘要 ==')
print('apps.js  +%d 字节（新条目）' % (len(apps_new) - len(apps)))
print('storage.js +%d 字节（^taobao_ 前缀）' % (len(storage_new) - len(storage)))
print('index.js +%d 字节（懒加载分支 + REBIND 键）' % (len(idx_new) - len(idx)))
print('keys-audit +%d 字节（5 条新键）' % (len(keys_new) - len(keys)))
print('phone.css +%d 字节（本版段）' % (len(phone_new) - len(phone)))

if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)

wr('config/apps.js', apps_new)
wr('config/storage.js', storage_new)
wr('index.js', idx_new)
wr('scripts/keys-audit.mjs', keys_new)
wr('phone.css', phone_new)
print('== 已落盘 ==')