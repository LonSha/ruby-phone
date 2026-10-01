#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3430_p3.py — 第三发：产品一处字符纪律 + 判据面一批「破坏不可观测」（累积式）

【产品（判据 J6 抓到）】
  ⑦ `pvdesk-app.js` 的注释里带了**反引号**（模板字符串禁用是本件的字符纪律：
     被审代码要能被剥注释器当字符状态机处理）。第二发写注释时顺手用了
     `` `_clearToDefaults()` `` 的排印，落盘即红。改成直角引号。

【判据面：四条负控制「破坏不可观测」（本仓反复记的假绿形态）】
  实测证据（/tmp/neg_probe.mjs 逐条跑真破坏副本）：
  · I13 q13：锚点在 `_readRaw` 的 `_storageUsable()` gate 上 —— 而 hostileStorage
    **有** get/set，gate 判的是「这两个口在不在」，于是 gate.ok 恒 true，
    那道分支根本走不到 ⇒ 锚在场、替换成功、破坏没发生。改挂 `catch` 的 read_threw。
  · I16 q16：锚点挂在末尾失败分支上，而 `ingestReply('')` 在**开头**就 return 了
    ⇒ 那行走不到。实测 before=2 after=2（题面没被清）。改挂空输入分支，
    并补 `_recompute()` 让内存态真的跟着变。
  · I19 q19：只把 `probe()` 关掉时，`_clearToDefaults()` 仍把内存态清干净，
    判据看的正是内存态 ⇒ 观测不到。实测 shots=2 只在**整页清与重取一起拿掉**时出现
    （真破坏形态）。
  · I23：`viewClimbProblems` 的顺序判据拿的是**整文件首次出现**——页面按钮自带
    data-act 字面量，把判定顺序调换后整文件首次出现不变（实测破坏后 iAct=29974
    仍小于 iCard=30399）⇒ 判据照样绿。改成在**点击处理段内**比
    `getAttribute('data-act')` 与 `getAttribute('data-rm')` 的先后。
  · q4：替换体自带原串（J2 的「替换后不许残留」当场红）。改成把标签正文加回去。

【判据面自身错（第二批）】
  · C1：断言前只写了 brief/shelf 两条键，却断言四条键都在 ⇒ 判据自己把自己码死。
    补 lyrics 与 policy 的写入。
  · E2：同一行断言写了两遍（735 / 758），且形状是 `const FACE_OK\\s*=`——
    真源码就是 `const FACE_OK = PV_FACES[0];`，**必然匹配** ⇒ 真源码上必红。
    改成查「等号后紧跟引号」（手写引号形）。
  · F3：用了未定义的 `AMP`（ReferenceError）。在常量区补 `String.fromCharCode(38)`。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = '\n'
Q = "'"
CUR = {}
COUNT = [0]


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(rel, old, new, tag):
    if rel not in CUR:
        CUR[rel] = rd(rel)
    n = CUR[rel].count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d：%r' % (tag, n, old[:90])
    CUR[rel] = CUR[rel].replace(old, new, 1)
    COUNT[0] += 1
    print('  %-34s %s' % (tag, rel))


A = 'apps/pvdesk/pvdesk-app.js'
T = 'tests/system-v3430.test.mjs'

print('== 第三发清单 ==')

# ⑦ 产品：注释里的反引号（字符纪律：被审代码不许模板字符串 / 反引号）
once(A,
     '     *  \u2605 **\u4e0d\u8d70** `_clearToDefaults()`\uff1a\u90a3\u662f\u6362\u4f1a\u8bdd\u7528\u7684\u6574\u9875\u6e05\uff0c\u4f1a\u628a\u6b4c\u8bcd\u539f\u6587\u4e0e\u7b56\u7565',
     '     *  \u2605 **\u4e0d\u8d70** \u300c_clearToDefaults()\u300d\uff1a\u90a3\u662f\u6362\u4f1a\u8bdd\u7528\u7684\u6574\u9875\u6e05\uff0c\u4f1a\u628a\u6b4c\u8bcd\u539f\u6587\u4e0e\u7b56\u7565',
     'app.doc.debacktick')

# C1：断言四条键之前，把四条键都真写一遍
once(T,
     '    app.ingestReply(shotScript());' + NL + '    app.saveToShelf({});' + NL + '    const before = app.shotRows().length;',
     '    app.ingestReply(shotScript());' + NL + '    app.saveToShelf({});' + NL
     + '    /* \u2605 \u56db\u6761\u952e\u90fd\u8981**\u771f\u88ab\u5199\u8fc7**\u624d\u80fd\u65ad\u8a00\u300c\u56db\u6761\u90fd\u5728\u518c\u300d\u2014\u2014'
     + ' \u53ea\u5199\u4e24\u6761\u5374\u65ad\u56db\u6761\uff0c\u5224\u636e\u81ea\u5df1\u628a\u81ea\u5df1\u7801\u6b7b\u3002 */' + NL
     + '    app.ingestLyrics(lrcText());' + NL + '    app.setMaxChars(20);' + NL
     + '    const before = app.shotRows().length;',
     'test.C1.write-all-keys')

# E2：删掉两条「必然匹配真源码」的假断言，改成查等号后紧跟引号
once(T,
     "    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' ).test(code), false, '\u9762\u5e38\u91cf\u4e0d\u8bb8\u624b\u5199\u6807\u8bc6\u7b26\u5f62');" + NL
     + '    /* \u56db\u6001\u8272\u76f8\u8868\uff1a**\u56db\u6863\u9010\u6863\u6302\u771f\u6e90\u952e**\uff0c\u4e14\u56db\u6863\u4e0d\u8bb8\u5854\u6210\u4e00\u79cd\u8272\uff08\u5854\u5e73\u5c31\u662f\u540c\u5f62\uff09\u3002 */',
     "    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' + BS + 's*' + Q).test(code), false," + NL
     + "        '\u9762\u5e38\u91cf\u4e0d\u8bb8\u624b\u5199\u5f15\u53f7\u5f62\uff08\u5fc5\u987b\u4ece\u771f\u6e90\u6570\u7ec4\u6309\u4e0b\u6807\u53d6\uff0c\u672c\u4ed3 J7 \u5f62\u6001\uff09');" + NL
     + '    /* \u56db\u6001\u8272\u76f8\u8868\uff1a**\u56db\u6863\u9010\u6863\u6302\u771f\u6e90\u952e**\uff0c\u4e14\u56db\u6863\u4e0d\u8bb8\u5854\u6210\u4e00\u79cd\u8272\uff08\u5854\u5e73\u5c31\u662f\u540c\u5f62\uff09\u3002 */',
     'test.E2.dup-fake-assert')

once(T,
     '    /* \u9762\u5e38\u91cf\u5fc5\u987b\u4ece\u771f\u6e90\u6570\u7ec4**\u6309\u4e0b\u6807\u53d6**\uff0c\u4e0d\u8bb8\u624b\u5199\u6807\u8bc6\u7b26\u5f62\u3002 */' + NL
     + "    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' ).test(code), false, '\u9762\u5e38\u91cf\u4e0d\u8bb8\u624b\u5199\u6807\u8bc6\u7b26\u5f62');",
     '    /* \u9762\u5e38\u91cf\u5fc5\u987b\u4ece\u771f\u6e90\u6570\u7ec4**\u6309\u4e0b\u6807\u53d6**\uff0c\u4e0d\u8bb8\u624b\u5199\u5f15\u53f7\u5f62\u3002 */' + NL
     + "    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' + BS + 's*' + Q).test(code), false, '\u9762\u5e38\u91cf\u4e0d\u8bb8\u624b\u5199\u5f15\u53f7\u5f62');",
     'test.E2.tail-assert')

# F3：补 AMP 常量（原来直接用了个没定义的名字）
once(T,
     'const BS = String.fromCharCode(92);',
     'const BS = String.fromCharCode(92);' + NL + 'const AMP = String.fromCharCode(38);',
     'test.consts.AMP')

# ---- DAMAGE 锚点重挂（q4 / q13 / q16 / q19 / q23）----
once(T,
     "        '        if (at > cursor) out += line.slice(cursor, at);'," + NL
     + "        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        out += line.slice(at);'],",
     "        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        cursor = spans[i].end;'," + NL
     + "        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        out += line.slice(at, spans[i].end);'],",
     'DAMAGE.q4.anchor')

once(T,
     "    q13: [PD_APP," + NL
     + "        '        const gate = this._storageUsable();' + NL + \"        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };\"," + NL
     + "        '        const gate = this._storageUsable();' + NL + \"        if (!gate.ok) return { ok: true, why: 'absent', value: undefined };\"],",
     "    /* \u2605 \u951a\u70b9\u5fc5\u987b\u843d\u5728**\u771f\u4f1a\u88ab\u8d70\u5230\u7684**\u90a3\u4e00\u884c\uff1a\u90a3\u9053 `_storageUsable()` gate" + NL
     + "     *   \u5728 hostileStorage \u4e0b\u6839\u672c\u4e0d\u8fdb\uff08\u5b83 get/set \u90fd\u5728\uff0cgate \u5224\u7684\u662f\u300c\u8fd9\u4e24\u4e2a\u53e3\u5728\u4e0d\u5728\u300d\uff09\u3002 */" + NL
     + "    q13: [PD_APP," + NL
     + "        \"        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }\"," + NL
     + "        \"        catch (e) { return { ok: true, why: 'absent', value: undefined }; }\"],",
     'DAMAGE.q13.anchor')

once(T,
     "    q16: [PD_APP," + NL
     + "        \"        const why = shotsRep.why || briefRep.why || PV_PARSE_WHYS[0];\"," + NL
     + "        '        this._brief = \\'\\';' + NL + \"        const why = shotsRep.why || briefRep.why || PV_PARSE_WHYS[0];\"],",
     "    /* \u2605 \u951a\u70b9\u843d\u5728**\u7a7a\u8f93\u5165\u90a3\u6761\u5206\u652f**\uff1a\u539f\u6765\u6302\u5728\u672b\u5c3e\u5931\u8d25\u5206\u652f\u4e0a\uff0c" + NL
     + "     *   \u800c ingestReply('') \u5728\u5f00\u5934\u5c31 return \u4e86\uff0c\u672b\u5c3e\u90a3\u884c\u8d70\u4e0d\u5230\uff08\u7834\u574f\u4e0d\u53ef\u89c2\u6d4b\uff09\u3002 */" + NL
     + "    q16: [PD_APP," + NL
     + "        \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });\"," + NL
     + "        '            this._brief = ' + Q + Q + ';' + NL + '            this._recompute();' + NL" + NL
     + "        + \"            this._receipt('ingest', false, PV_PARSE_WHYS[0], { chars: 0, shots: 0 });\"],",
     'DAMAGE.q16.anchor')

once(T,
     "    q19: [PD_APP," + NL
     + "        '        this._clearToDefaults();' + NL + \"        this._tab = 'brief';\" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;' + NL + '        this.probe();'," + NL
     + "        '        this._clearToDefaults();' + NL + \"        this._tab = 'brief';\" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;' + NL + '        if (false) this.probe();'],",
     "    /* \u2605 \u7834\u574f\u5fc5\u987b\u628a**\u6574\u9875\u6e05**\u4e0e**\u91cd\u53d6**\u4e00\u8d77\u62ff\u6389\uff1a\u53ea\u5173\u6389 probe" + NL
     + "     *   \u65f6 `_clearToDefaults()` \u4ecd\u4f1a\u628a\u5185\u5b58\u6001\u6e05\u5e72\u51c0\uff0c\u800c\u5224\u636e\u770b\u7684\u6b63\u662f\u5185\u5b58\u6001\u3002 */" + NL
     + "    q19: [PD_APP," + NL
     + "        '    onChatChanged() {' + NL + '        this._clearToDefaults();' + NL + \"        this._tab = 'brief';\" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;' + NL + '        this.probe();'," + NL
     + "        '    onChatChanged() {' + NL + \"        this._tab = 'brief';\" + NL + '        this._focus = ' + Q + Q + ';' + NL + '        this._now = 0;'],",
     'DAMAGE.q19.anchor')

once(T,
     "    q23: [PD_VIEW," + NL
     + "        \"            const actEl = climb(t, (n) => n.getAttribute('data-act'));\" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }' + NL + \"            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);\"," + NL
     + "        \"            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);\" + NL + \"            const actEl = climb(t, (n) => n.getAttribute('data-act'));\" + NL + '            if (cardOrderSwap) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }'],",
     "    /* \u2605 \u987a\u5e8f\u7834\u574f\u53ea\u9700\u628a\u4e24\u6bb5\u5bf9\u8c03\uff08\u539f\u66ff\u6362\u4f53\u5e26\u4e86\u4e2a\u6682\u65f6\u53d8\u91cf\uff0c" + NL
     + "     *   \u90a3\u4e0d\u662f\u771f\u7f16\u8f91\uff09\u3002\u5224\u636e\u5728**\u70b9\u51fb\u5904\u7406\u6bb5\u5185**\u6bd4\u5148\u540e\u624d\u80fd\u89c2\u6d4b\u3002 */" + NL
     + "    q23: [PD_VIEW," + NL
     + "        \"            const actEl = climb(t, (n) => n.getAttribute('data-act'));\" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }' + NL + \"            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);\"," + NL
     + "        \"            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);\" + NL + \"            const actEl = climb(t, (n) => n.getAttribute('data-act'));\" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }'],",
     'DAMAGE.q23.anchor')

# viewClimbProblems：顺序判据落到点击处理段内
once(T,
     "const viewClimbProblems = (src) => {" + NL
     + "    const bad = [];" + NL
     + "    const code = stripComments(src);" + NL
     + "    if (code.indexOf('parentNode') < 0) bad.push('card-climb-lost');" + NL
     + "    const iAct = code.indexOf(\"'data-act'\");" + NL
     + "    const iCard = code.indexOf(\"'data-open'\");" + NL
     + "    if (iCard < 0) bad.push('card-mark-lost');",
     "const viewClimbProblems = (src) => {" + NL
     + "    const bad = [];" + NL
     + "    const code = stripComments(src);" + NL
     + "    if (code.indexOf('parentNode') < 0) bad.push('card-climb-lost');" + NL
     + "    /* \u2605 \u987a\u5e8f\u5224\u636e\u5fc5\u987b\u843d\u5728**\u70b9\u51fb\u5904\u7406\u6bb5\u5185**\uff1a\u62ff\u6574\u6587\u4ef6\u7684\u9996\u6b21\u51fa\u73b0\u592a\u677e \u2014\u2014" + NL
     + "     *   \u9875\u9762\u91cc\u7684\u6309\u94ae\u81ea\u5e26 data-act \u5b57\u9762\u91cf\uff0c\u628a\u5224\u5b9a\u987a\u5e8f\u8c03\u6362\u540e\u6574\u6587\u4ef6\u9996\u6b21\u51fa\u73b0\u4e0d\u53d8\u3002 */" + NL
     + "    const hAt = code.indexOf(\"addEventListener('click'\");" + NL
     + "    if (hAt < 0) { bad.push('click-handler-missing'); return bad; }" + NL
     + "    const seg = code.slice(hAt);" + NL
     + "    const iAct = seg.indexOf(\"getAttribute('data-act')\");" + NL
     + "    const iRm = seg.indexOf(\"getAttribute('data-rm')\");" + NL
     + "    const iCard = seg.indexOf(\"getAttribute('data-open')\");" + NL
     + "    if (iCard < 0) bad.push('card-mark-lost');",
     'test.viewClimb.segment')

once(T,
     "    if (!(iAct > 0 && iCard > 0 && iAct < iCard)) bad.push('card-climb-order-lost');" + NL
     + "    return bad;" + NL
     + "};",
     "    if (!(iAct > 0 && iRm > 0 && iAct < iRm)) bad.push('card-climb-order-lost');" + NL
     + "    if (!(iAct > 0 && iCard > 0 && iAct < iCard)) bad.push('card-climb-order-lost');" + NL
     + "    return bad;" + NL
     + "};",
     'test.viewClimb.order')

print('== 共 %d 处 ==' % COUNT[0])
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)

for rel, body in CUR.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(body)
    print('  写 %s' % rel)
print('已落盘 %d 个文件。' % len(CUR))