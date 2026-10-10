#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 注册面补丁：三处注册 + 三键登记。

 ① config/apps.js  —— APPS 条目（id: accessdesk 名「无障碍操作台」）
 ② config/app-lazy-routes.js —— 懒加载路由行（key accessdeskApp / cls AccessdeskApp）
 ③ config/app-consumption-matrix.js —— 消费矩阵一行（F6_lifecycle true，其余 false）
 ④ phone.css —— 把 accessdesk.css 同步投递（机制 A，registry 门按类前缀族判定）
 ⑤ scripts/keys-audit.mjs —— 三个新键登记（K1 的准入：新增键必须回答归属）
"""
import io
import sys

ROOT = '/home/user/ruby-phone'


def read(p):
    return io.open(ROOT + '/' + p, encoding='utf-8').read()


def write(p, s):
    io.open(ROOT + '/' + p, 'w', encoding='utf-8').write(s)


def patch(name, path, anchor, replacement, expect=1):
    src = read(path)
    n = src.count(anchor)
    if n != expect:
        print('FAIL [%s] 锚点命中 %d 次（要求 %d 次）' % (name, n, expect))
        sys.exit(1)
    write(path, src.replace(anchor, replacement, 1))
    print('  ok %s  (%s)' % (name, path))


# ---------- ① config/apps.js ----------
APPS_ANCHOR = """        id: 'caphealth',
        name: '能力体检',
        icon: '🩺',
        color: '#4a6a5a',
        badge: 0,
        data: {},
    },
];"""
APPS_NEW = APPS_ANCHOR[:-3] + """    {
        // [v3.93.0 · 拓展计划 R-X9] 无障碍操作台：功能规模已很大，键盘 / 触摸可达性、
        //   字体放大后的遮挡、状态只靠颜色、320px 窄屏排版此前没有统一出口。
        //   三档操作层（标准 / 增强 / 大字号）+ 三件个性化（主题 / 紧凑 / 低动画指向既有真源）；
        //   四态标记（空 / 未知 / 失败 / 成功）各带文字与符号，颜色只是附加。
        id: 'accessdesk',
        name: '无障碍操作台',
        icon: '🦾',
        color: '#5a6a8a',
        badge: 0,
        data: {},
    },
];"""
patch('apps.js', 'config/apps.js', APPS_ANCHOR, APPS_NEW)

# ---------- ② 懒加载路由 ----------
ROUTE_ANCHOR = '    { id: "caphealth", module: "./apps/caphealth/caphealth-app.js", key: "caphealthApp", cls: "CaphealthApp", errTitle: "能力体检App" },'
ROUTE_NEW = ROUTE_ANCHOR + '\n    { id: "accessdesk", module: "./apps/accessdesk/accessdesk-app.js", key: "accessdeskApp", cls: "AccessdeskApp", errTitle: "无障碍操作台App" },'
patch('app-lazy-routes.js', 'config/app-lazy-routes.js', ROUTE_ANCHOR, ROUTE_NEW)

# ---------- ③ 消费矩阵 ----------
MATRIX_ANCHOR = '    Object.freeze({ appId: "caphealth", name: "能力体检", dir: "caphealth", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),'
MATRIX_NEW = MATRIX_ANCHOR + '\n    Object.freeze({ appId: "accessdesk", name: "无障碍操作台", dir: "accessdesk", faces: Object.freeze({ F1_inject: false, F2_search: false, F3_notify: false, F4_wechatLink: false, F5_upstreamRead: false, F6_lifecycle: true }) }),'
patch('app-consumption-matrix.js', 'config/app-consumption-matrix.js', MATRIX_ANCHOR, MATRIX_NEW)

# ---------- ④ phone.css 投递 ----------
css_src = read('apps/accessdesk/accessdesk.css')
phone = read('phone.css')
BANNER = '\n/* ══════════════ [v3.93.0] 无障碍操作台（accessdesk） ══════════════ */\n'
if '无障碍操作台（accessdesk）' in phone:
    print('  skip phone.css（已投递过，幂等）')
else:
    write('phone.css', phone + BANNER + css_src)
    print('  ok phone.css 投递（%d -> %d 字节）' % (len(phone), len(phone) + len(BANNER) + len(css_src)))

# ---------- ⑤ 三个新键登记（K1 准入） ----------
KEYS_ANCHOR = "  { key: '__migration_ledger', scope: 'global', note: '存储层迁移留痕账本（version+keys）' },"
KEYS_NEW = """  /* [v3.93.0 · R-X9] 无障碍操作层三键。**全部命中 /^sys_/ ⇒ 会话隔离**：
   *   口径与 sys_motion_level / sys_shell_scale 一致 —— 「这台手机怎么显示」随会话走，
   *   这也是计划验收「设置重开后保留，且按会话正确隔离」的落点。
   *   刻意不新开「低动画」与「字体缩放」键：前者就是 sys_motion_level、后者就是
   *   phone-font-scale（同一件事两个存储位必然漂移）。 */
  { key: 'sys_access_level', scope: 'chat', note: '操作层档位（standard / enhanced / large，随会话隔离）' },
  { key: 'sys_access_compact', scope: 'chat', note: '紧凑列表开关（随会话隔离）' },
  { key: 'sys_access_theme', scope: 'chat', note: '主题档（auto / light / dark，随会话隔离）' },
""" + KEYS_ANCHOR
patch('keys 三键登记', 'scripts/keys-audit.mjs', KEYS_ANCHOR, KEYS_NEW)

print('done')