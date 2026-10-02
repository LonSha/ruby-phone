#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3480.py - v3.48.0 子宫画板六处接线（复核脚本）
# 六处接线已于本件落码阶段落地；本脚本对每一处**重算即断言**（幂等只读，
# 不落盘），供抬版收干时复核，并防止「接了但接错」或「重复接」。
import os
import sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NL = chr(10)

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()

CHECKS = []
def check(tag, cond, extra=''):
    CHECKS.append((tag, bool(cond), extra))

# ① config/apps.js：注册项齐备
apps = rd('config/apps.js')
check('apps: id uterus 恰 1', apps.count("id: 'uterus'") == 1)
check('apps: 名「子宫画板」', apps.count('子宫画板') == 2, str(apps.count('子宫画板')))
check('apps: 注册块在数组尾', apps.find("id: 'uterus'") < apps.find(NL + '];' + NL + '// 手机配置'))
check('apps: 不缝清单成行', '四块不缝' in apps and '不读宿主界面元素取主题色' in apps)
check('apps: 与号走拼装（无裸与号实体）', '&#' not in apps)

# ② config/storage.js：一条宽前缀
stor = rd('config/storage.js')
check('storage: /^uterus_/ 恰 1', stor.count('/^uterus_/,') == 1)
check('storage: 紧跟前缀族', '/^diagdesk_/,' + NL + '            // [v3.48.0]' in stor)
check('storage: 两条键名成行', 'uterus_subject' in stor and 'uterus_ledger' in stor)

# ③ scripts/keys-audit.mjs：两条登记（scope chat）
keys = rd('scripts/keys-audit.mjs')
check('keys: uterus_subject 登记', "{ key: 'uterus_subject', scope: 'chat'," in keys)
check('keys: uterus_ledger 登记', "{ key: 'uterus_ledger', scope: 'chat'," in keys)
check('keys: 无重复登记', keys.count("'uterus_subject'") == 1 and keys.count("'uterus_ledger'") == 1)

# ④ index.js：懒加载分支 + 挂载 + 表单字段表
idx = rd('index.js')
check('index: 分支恰 1', idx.count("appId === 'uterus'") == 1)
check('index: 导入路径', "import('./apps/uterus/uterus-app.js')" in idx)
check('index: 挂载恰 1', idx.count('window.VirtualPhone.uterusApp = new module.UterusApp') == 1)
check('index: 表单字段表有 uterusApp', idx.count("'uterusApp',") == 1)
check('index: 分支不写回状态', '不写回角色状态' in idx)

# ⑤ phone.css：本版段与 uterus.css 逐字同源
css = rd('phone.css')
seg = rd('apps/uterus/uterus.css')
check('phone.css: 本版段标题', '/* ══════════════ [v3.48.0] 子宫画板（uterus） ══════════════ */' in css)
check('phone.css: 段内逐字同源', seg.rstrip(NL) in css, str(len(seg)))
check('uterus.css: 选择器均挂 .ud-root', seg.count('.ud-root') >= 1 and 'ud-' in seg)

# ⑥ tests/system-v255.test.mjs：dirMap 补一项
v255 = rd('tests/system-v255.test.mjs')
check('v255: uterusApp 登记恰 1', v255.count('uterusApp') == 1)
check('v255: 上一条 diagdeskApp 行有逗号', "diagdeskApp: 'diagdesk'," in v255)
check('v255: 末行无尾逗号且在表内', "uterusApp: 'uterus'" in v255 and v255.find('uterusApp') < v255.find('const fileOverride'))
check('v255: 无裸引号致语法错', v255.count(chr(0xFFFD)) == 0)

bad = [c for c in CHECKS if not c[1]]
for tag, ok, extra in CHECKS:
    print(('OK  ' if ok else 'FAIL') + '  ' + tag + (('  [' + extra + ']') if extra else ''))
print('---')
print('接线复核：%d 项 / 通过 %d / 失败 %d' % (len(CHECKS), len(CHECKS) - len(bad), len(bad)))
if bad:
    sys.exit(1)
