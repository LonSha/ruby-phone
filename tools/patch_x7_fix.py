#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_x7_fix.py - [v4.47.0 / R5-X7] 收尾修补（幂等；每处锚点必须恰中 1 次）。

修三处（都是门禁 / 判据抓的，不是人眼看的）：
 1) creationdesk-app.js 的 hyLanes() 里就地写了一遍弱口径
    Number.isFinite(Number(base)) —— 本仓自 v3.12.0 起把数值取值收成
    唯一实现（config/num-gate.js 的 numOrNull）并配常驻门禁
    scripts/weak-coercion-audit.mjs。实测：本版落地后该门从 1 处（存量
    goal-tree）涨到 2 处，正是本版新件写的那一处。修法 = 引门，不是再写一遍。
 2) 视图 _hypo 段拿文案子串去猜「采纳按钮画不画」（indexOf('同基线')）：
    文案一改按钮就静默消失，且不报错。改为读 App 出口的态。
 3) 视图绑定时伸手读 App 实例私有态 self.app._hy：改为读 App 出口 hyKindOf()。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
APP = 'apps/creationdesk/creationdesk-app.js'
VIEW = 'apps/creationdesk/creationdesk-view.js'


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] anchor must hit exactly 1, got %d' % (tag, n)
    return s.replace(old, new, 1)


app = rd(APP)
view = rd(VIEW)

# 1) 数值取值门：引全仓唯一实现
if 'num-gate.js' not in app:
    app = once(app,
               "} from '../../config/hypo-trial-contract.js';",
               "} from '../../config/hypo-trial-contract.js';" + NL +
               "/* [v4.47.0 / R5-X7] 数值取值门走全仓唯一实现（config/num-gate.js）。" + NL +
               " *   为什么必须引门而不是就地再写一遍：Number.isFinite(Number(v)) 会把" + NL +
               " *   '' / [] / false 读成 0，与「上游没给」塌成同一个读数，而两者处置相反" + NL +
               " *   （留空 => 等用户补基线；0 => 那是一个真时点）。本仓自 v3.12.0 起有常驻" + NL +
               " *   门禁 scripts/weak-coercion-audit.mjs 守这条，本版新件首版正是被它抓住的。" + NL +
               " */" + NL +
               "import { numOrNull } from '../../config/num-gate.js';",
               'app-import-numgate')

WEAK = ("            const bl = (base === '' || !Number.isFinite(Number(base)))" + NL +
        "                ? { at: null, label: '', given: false }" + NL +
        "                : { at: Number(base), label: '', given: true };")
STRONG = ("            /* 留空 => 没给基线（等用户补）；给了非数 => 也没给。两者都不许塌成 0。 */" + NL +
          "            const at = numOrNull(base);" + NL +
          "            const bl = (at === null)" + NL +
          "                ? { at: null, label: '', given: false }" + NL +
          "                : { at: at, label: '', given: true };")
app = once(app, WEAK, STRONG, 'app-hylanes-baseline')

PAYLOAD_OLD = "            baseline: (String(this._hy.baseline || '').trim() === '' ? null : Number(this._hy.baseline)),"
PAYLOAD_NEW = "            baseline: numOrNull(this._hy.baseline),"
app = once(app, PAYLOAD_OLD, PAYLOAD_NEW, 'app-hyact-baseline')

# 2)+3) 两个新出口：采纳按钮的判据 + 一栏当前种类
ANCHOR_OUTLET = "    /** 这一栏有没有写过的文本（回填用；**与「试写跑过了」不是一回事**）。 */"
OUTLETS = ("    /** 采纳按钮画不画（界面不许拿文案子串猜：判据是契约件的可比性态 + 选中栏）。" + NL +
           "     *   用文案子串判的后果不是报错，是文案一改按钮就静默消失。 */" + NL +
           "    hyAdoptReady() {" + NL +
           "        return this.hyComparableState() === HY_COMPARABLE.SAME && !!this._hy.picked;" + NL +
           "    }" + NL +
           "    /** 一栏当前的假设种类（界面「再点一次即取消」读它；不读实例私有态）。 */" + NL +
           "    hyKindOf(lane) {" + NL +
           "        const id = HY_LANES.indexOf(String(lane || '')) >= 0 ? String(lane) : '';" + NL +
           "        return id ? String((this._hy[id] || {}).kind || '') : '';" + NL +
           "    }" + NL +
           ANCHOR_OUTLET)
app = once(app, ANCHOR_OUTLET, OUTLETS, 'app-outlets')

VM_OLD = "            hyPicked: String(this._hy.picked || ''),"
VM_NEW = ("            hyPicked: String(this._hy.picked || '')," + NL +
          "            /* 界面「采纳按钮画不画」与「一栏现在是什么种类」的真源（视图不猜文案、不读私有态）。 */" + NL +
          "            hyComparable: this.hyComparableState()," + NL +
          "            hyAdoptReady: this.hyAdoptReady(),")
app = once(app, VM_OLD, VM_NEW, 'app-vm-outlets')

# 视图：把两处「猜」改成读出口
VIEW_CMP_OLD = ("        const cmpOk = (vm.hyCompareLabel || '').indexOf('同基线') >= 0;" + NL +
                "        if (vm.hyPicked && cmpOk) {")
VIEW_CMP_NEW = ("        /* 采纳按钮画不画读 App 出口的态：拿文案子串（indexOf('同基线')）去猜的后果" + NL +
                "         *   是文案一改按钮就静默消失，而且不报错 —— 本仓最贵的形态。 */" + NL +
                "        if (vm.hyAdoptReady === true) {")
view = once(view, VIEW_CMP_OLD, VIEW_CMP_NEW, 'view-adopt-ready')

VIEW_KIND_OLD = "                const cur = self.app._hy && self.app._hy[lane] ? self.app._hy[lane].kind : '';"
VIEW_KIND_NEW = "                const cur = self.app.hyKindOf(lane);"
view = once(view, VIEW_KIND_OLD, VIEW_KIND_NEW, 'view-kind-outlet')

if not WRITE:
    print('--- DRY RUN (pass --write to apply) ---')
else:
    wr(APP, app)
    wr(VIEW, view)
    print('--- WRITTEN ---')

app2 = rd(APP)
view2 = rd(VIEW)
print('num-gate imported     :', 'num-gate.js' in app2)
print('weak coercion left    :', 'Number.isFinite(Number(base))' in app2)
print('hyAdoptReady outlet   :', 'hyAdoptReady()' in app2)
print('view uses outlet      :', 'vm.hyAdoptReady === true' in view2)
print('view substring guess  :', "indexOf('\u540c\u57fa\u7ebf')" in view2)
print('view reads _hy        :', 'self.app._hy' in view2)