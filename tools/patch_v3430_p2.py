#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3430_p2.py — 第二发：产品一处真缺陷 + 判据面一批自身错（累积式）

【产品真缺陷（判据首跑抓到）】
  ⑥ `clearBrief()` 走的是 `_clearToDefaults()`（那是**换会话**用的整页清），
     于是「清空题面与台账」这个按钮把**歌词原文也一起清了**：
     用户贴好的那段歌词、以及策略设置，在按钮字面里压根没提。表现同样是
     「不报错、不崩溃、只错结果」：清完题面，歌词页变空，用户以为自己没贴过。
     修法：clearBrief 只清「题面 + 台账 + 草稿 + 焦点」，歌词与策略原样留着。

【判据面自身错（本版新套件首跑暴露，逐条）】
  · A10 把「立绘号」当选项格：它其实**从镜头体里认出来**（挂图就是 ok，没挂才是 none）
    —— 判据写成 none 等于要求产品认错；
  · DAMAGE 里 6 条锚点照记忆手写，与真源码不同形（q11 少方括号、q13/q14/q15/q21/q23
    是想象的写法）⇒ 负控制「破坏没发生」却报成「判据没响」；
  · q4 的替换体自带原串（`out += line.slice(at, spans[i].end);` 里含锚点本身）
    ⇒ J2 的「替换后不许残留原串」当场转红；
  · I25 的判据只查「键里有没有空格」—— 中文话本来就没空格，**永远判不出来**
    （这正是本仓反复记的那条：「判据自己把自己码死」）。改成 ASCII 标识符形；
  · I20/I21 的判据太松：面色相只要表在场、卡片判定只要 `parentNode` 在场就绿，
    于是「塔平」与「退回直点元素」两种破坏都观测不到。改成真看**表的四档取值**
    与**卡片判定是否走 climb**。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = '\n'
CUR = {}
COUNT = [0]


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(rel, old, new, tag):
    if rel not in CUR:
        CUR[rel] = rd(rel)
    n = CUR[rel].count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d：%r' % (tag, n, old[:80])
    CUR[rel] = CUR[rel].replace(old, new, 1)
    COUNT[0] += 1
    print('  %-40s %s' % (tag, rel))


A = 'apps/pvdesk/pvdesk-app.js'
T = 'tests/system-v3430.test.mjs'

print('== 第二发清单 ==')

# ⑥ 产品：clearBrief 只清题面与台账（歌词 / 策略 / 动作台账不动）
once(A,
     """    clearBrief() {
        this._clearToDefaults();
        this._recompute();""",
     """    /** 清题面与台账。
     *  ★ **不走** `_clearToDefaults()`：那是换会话用的整页清，会把歌词原文与策略
     *    一起带走 —— 而按钮字面里只说了「题面与台账」。用户贴的那段歌词不该被
     *    一个没提它的按钮清掉（源把三者挤在一处，清一次任务列表全没）。 */
    clearBrief() {
        this._face = FACE_EMPTY;
        this._malformed = false;
        this._brief = '';
        this._title = '';
        this._duration = PV_DURATION_DEFAULT;
        this._style = '';
        this._lens = '';
        this._mood = '';
        this._shelf = [];
        this._draft = '';
        this._focus = '';
        this._recompute();""",
     'app.clearBrief.narrow')

# A10：立绘号是「从镜头体里认出来的」，不是选项格
once(T,
     """    const none = DAT.promptForShot(shot, {});
    assert.equal(none.filled.style, 'absent');
    assert.equal(none.filled.lens, 'absent');
    assert.equal(none.filled.figs, 'none');""",
     """    const none = DAT.promptForShot(shot, {});
    assert.equal(none.filled.style, 'absent');
    assert.equal(none.filled.lens, 'absent');
    assert.equal(none.filled.mood, 'absent');
    /* ★ 立绘号是**从这一镜的正文里认出来的**（不是选项格）：这一镜挂了图1 就是 ok，
     *   一镜没挂才是 none —— 两形不同（源把两件事并进「未指定」一句话里）。 */
    assert.equal(none.filled.figs, 'ok');
    const bare = DAT.promptForShot({ n: 2, a: 3, b: 6, sec: 3, body: '没有图号的一镜' }, {});
    assert.equal(bare.filled.figs, 'none');""",
     'test.A10.figs')

# H1：占位行会 TypeError（App 上没有 cuesText）
once(T,
     "    assert.equal(app.cuesText(), undefined === app.cuesText() ? undefined : app.cuesText(), '占位不判');",
     "    assert.equal(app.lyricsModeOf(), 'empty', '换会话必须丢掉旧歌词');",
     'test.H1.placeholder')

# E2：四态色的真源键面（表本体逐档）+ 文案表键取真源值
once(T,
     """    const vcode = codeOf(PD_VIEW);
    assert.ok(vcode.indexOf('FACE_TONE[PV_FACES[') > 0, '面色相必须按真源键挂');
    const tones = [];
    for (const m of vcode.matchAll(/FACE_TONE\\[PV_FACES\\[(\\d)\\]\\]/g)) tones.push(m[1]);
    assert.equal(tones.length, 4, '四态必须逐档挂色');
    const vals = [];
    for (const m of vcode.matchAll(/\\[PV_FACES\\[(\\d)\\]\\]: '([a-z]+)'/g)) vals.push(m[2]);
    assert.ok(new Set(vals).size >= 3, '四态色不许塔成一种');
    /* 文案表键必须取真源值（J7 形态）。 */
    for (const t of ['PARSE_WHY_TEXT', 'HOLD_WHY_TEXT']) {
        const at = code.indexOf('const ' + t);
        assert.ok(at > 0, t + ' 必须在场');
        assert.ok(code.slice(at, at + 400).includes('_WHYS['), t + ' 的键必须取真源常量值');
    }""",
     """    /* 四态色相表：**四档逐档挂真源键**，且四档不许塔成一种色（塔平就是同形）。 */
    const vcode = codeOf(PD_VIEW);
    const toneAt = vcode.indexOf('const FACE_TONE');
    assert.ok(toneAt > 0, '面色相表必须在场');
    const toneBlock = vcode.slice(toneAt, vcode.indexOf('});', toneAt));
    const slots = [];
    for (const m of toneBlock.matchAll(/\\[PV_FACES\\[(\\d)\\]\\]/g)) slots.push(m[1]);
    assert.equal(slots.length, 4, '四态必须逐档挂色（键面取真源，不许写标识符形）');
    const vals = [];
    for (const m of toneBlock.matchAll(/: '([a-z-]+)'/g)) vals.push(m[1]);
    assert.equal(vals.length, 4, '四档必须各给一个色名');
    assert.ok(new Set(vals).size >= 3, '四态色不许塔成一种');
    /* 文案表键必须取真源值（J7 形态）：手写一套靠碰巧拼写一致对齐，真源增删一态就静默走兜底。 */
    for (const t of ['FACE_TEXT', 'PARSE_WHY_TEXT', 'HOLD_WHY_TEXT']) {
        const at = code.indexOf('const ' + t);
        assert.ok(at > 0, t + ' 必须在场');
        const blk = code.slice(at, code.indexOf('});', at));
        assert.ok(blk.includes('FACE') === false || blk.includes('_FACES[') || blk.includes('_WHYS['),
            t + ' 的键必须取真源常量值');
        assert.ok(blk.includes('_FACES[') || blk.includes('_WHYS['), t + ' 的键必须取真源常量值');
    }
    /* 面常量必须从真源数组**按下标取**，不许手写标识符形。 */
    assert.equal(new RegExp('const FACE_OK' + BS + 's*=' ).test(code), false, '面常量不许手写标识符形');""",
     'test.E2.tone')

# F3：实体字面量的判据要查**源码里的实体写法**（与号后紧跟实体名）
once(T,
     """    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('String.fromCharCode'), '转义必须走拼装形');
    for (const ent of ['&amp;', '"', '&lt;', '&gt;', '&#39;']) {
        assert.equal(code.indexOf(ent) >= 0, false, '不许写实体字面量：' + ent);
    }
    assert.ok(code.includes("'amp;'") && code.includes("'quot;'"), '拼装形的收尾必须写死在替换里');""",
     """    const code = codeOf(PD_VIEW);
    assert.ok(code.includes('String.fromCharCode'), '转义必须走拼装形');
    /* ★ 查的是**源码里的实体写法**：与号后面紧跟实体名 / `#`。
     *   原来那条把裸双引号也列进禁令 —— 可视图本来就要产 `type="checkbox"`，
     *   于是判据自己把自己码死（真源码上必红）。 */
    assert.equal(new RegExp(AMP + '[a-zA-Z#]').test(code), false, '不许写实体字面量（与号后紧跟实体名）');
    assert.ok(code.includes('amp;') && code.includes('quot;'), '拼装形的收尾必须写死在替换里');""",
     'test.F3.entities')

# 视图判据：面色相真看四档取值；卡片判定真看是否走 climb
once(T,
     """const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.indexOf('FACE_TONE[PV_FACES[') < 0) bad.push('face-tone-not-by-source');
    const tones = [];
    for (const m of code.matchAll(/FACE_TONE\\[PV_FACES\\[(\\d)\\]\\]/g)) tones.push(m[1]);
    if (tones.length !== 4) bad.push('face-tone-slots');
    return bad;
};""",
     """const viewFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    const at = code.indexOf('const FACE_TONE');
    if (at < 0) { bad.push('face-tone-missing'); return bad; }
    const block = code.slice(at, code.indexOf('});', at));
    /* ① 四档必须逐档挂真源键（写标识符形 = 真源增删一态就静默走兜底）。 */
    const slots = [];
    for (const m of block.matchAll(/\\[PV_FACES\\[(\\d)\\]\\]/g)) slots.push(m[1]);
    if (slots.length !== 4) bad.push('face-tone-slots');
    /* ② 表里**指着别人**（`FACE_TONE[PV_FACES[0]]`）= 四态塔平。 */
    if (block.indexOf('FACE_TONE[') >= 0) bad.push('face-tone-not-by-source');
    /* ③ 四档取值不许塌成一种色。 */
    const vals = [];
    for (const m of block.matchAll(/: '([a-z-]+)'/g)) vals.push(m[1]);
    if (new Set(vals).size < 3) bad.push('face-tone-collapsed');
    return bad;
};""",
     'test.viewFaceProblems')

once(T,
     """const viewClimbProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.indexOf('parentNode') < 0) bad.push('card-climb-lost');
    const iAct = code.indexOf("'data-act'");
    const iCard = code.indexOf("'data-open'");
    if (!(iAct > 0 && iCard > 0 && iAct < iCard)) bad.push('card-climb-order-lost');
    return bad;
};""",
     """const viewClimbProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (code.indexOf('parentNode') < 0) bad.push('card-climb-lost');
    const iAct = code.indexOf("'data-act'");
    const iCard = code.indexOf("'data-open'");
    if (iCard < 0) bad.push('card-mark-lost');
    /* ★ 卡片判定必须**走 climb**：只要求「文件里有 parentNode」太松 ——
     *   把卡片判定退回直点元素时 climb 仍在（动作按钮还在用），判据照样绿。 */
    if (iCard > 0) {
        const near = code.slice(Math.max(0, iCard - 70), iCard + 40);
        if (near.indexOf('climb(') < 0) bad.push('card-climb-lost');
    }
    if (!(iAct > 0 && iCard > 0 && iAct < iCard)) bad.push('card-climb-order-lost');
    return bad;
};""",
     'test.viewClimbProblems')

# 失败因的判据：手写中文话永远判不出来（中文没空格）⇒ 改查 ASCII 标识符形
once(T,
     """const dataKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    for (const t of ['PV_PARSE_WHYS', 'PV_HOLD_WHYS']) {
        const at = code.indexOf('export const ' + t + ' = Object.freeze([');
        if (at < 0) { bad.push(t + '-missing'); continue; }
        const seg = code.slice(at, at + 200);
        for (const v of seg.matchAll(/'([a-z_]+)'/g)) {
            if (v[1].indexOf(' ') >= 0) bad.push('why-not-key');
        }
    }
    return bad;
};""",
     """const dataKeyProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    for (const t of ['PV_PARSE_WHYS', 'PV_HOLD_WHYS']) {
        const at = code.indexOf('export const ' + t + ' = Object.freeze([');
        if (at < 0) { bad.push(t + '-missing'); continue; }
        const seg = code.slice(at, at + 200);
        const vals = [];
        for (const v of seg.matchAll(/'([^']*)'/g)) vals.push(v[1]);
        if (vals.length < 4) bad.push(t + '-short');
        for (const v of vals) {
            /* ★ 失败因必须是**键**（ASCII 标识符形），不许是给用户看的中文话：
             *   原来查「有没有空格」——中文话本来就没空格，破坏后照样绿
             *   （判据自己把自己码死，本仓反复踩的那一条）。 */
            if (!/^[a-z][a-z0-9_]*$/.test(v)) bad.push('why-not-key');
        }
        if (new Set(vals).size !== vals.length) bad.push(t + '-collapsed');
    }
    return bad;
};""",
     'test.dataKeyProblems')

# ── DAMAGE 锚点按真源码逐字重写 ──
once(T,
     """    q4: [PD_DATA,
        '        if (at > cursor) out += line.slice(cursor, at);',
        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        out += line.slice(at, spans[i].end);'],""",
     """    q4: [PD_DATA,
        '        if (at > cursor) out += line.slice(cursor, at);',
        '        if (at > cursor) out += line.slice(cursor, at);' + NL + '        out += line.slice(at);'],""",
     'test.q4')

once(T,
     """    q11: [PD_DATA,
        'export const PV_FACES = Object.freeze(' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'malformed' + Q + ', ' + Q + 'absent' + Q + ');',
        'export const PV_FACES = Object.freeze(' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'absent' + Q + ');'],""",
     """    q11: [PD_DATA,
        'export const PV_FACES = Object.freeze([' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'malformed' + Q + ', ' + Q + 'absent' + Q + ']);',
        'export const PV_FACES = Object.freeze([' + Q + 'ok' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'empty' + Q + ', ' + Q + 'absent' + Q + ']);'],""",
     'test.q11')

once(T,
     """    q13: [PD_APP,
        "        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };",
        "        if (!gate.ok) return { ok: true, why: 'absent', value: undefined };"],""",
     """    q13: [PD_APP,
        '        const gate = this._storageUsable();' + NL + "        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };",
        '        const gate = this._storageUsable();' + NL + "        if (!gate.ok) return { ok: true, why: 'absent', value: undefined };"],""",
     'test.q13')

once(T,
     """    q14: [PD_APP,
        "        if (!obj || typeof obj !== 'object') return { face: FACE_MALFORMED, why: 'shape' };",
        "        if (!obj || typeof obj !== 'object') return { face: FACE_EMPTY, why: 'shape' };"],""",
     """    q14: [PD_APP,
        "            return { face: FACE_MALFORMED, why: 'json' };",
        "            return { face: FACE_EMPTY, why: 'json' };"],""",
     'test.q14')

once(T,
     """    q15: [PD_APP,
        "        const cell = r[t.key] || null;" + NL + '        out.push({' + NL + '            key: t.key, label: t.label,' + NL + '            value: cell ? cell.value : null,',
        "        const cell = r[t.key] || null;" + NL + '        out.push({' + NL + '            key: t.key, label: t.label,' + NL + '            value: cell ? cell.value : 0,'],""",
     """    q15: [PD_APP,
        '                value: cell ? cell.value : null,',
        '                value: cell ? cell.value : 0,'],""",
     'test.q15')

once(T,
     """    q20: [PD_VIEW,
        "    [PV_FACES[2]]: 'err',",
        '    [PV_FACES[2]]: FACE_TONE[PV_FACES[0]],'],""",
     """    q20: [PD_VIEW,
        "    [PV_FACES[2]]: 'err',",
        "    [PV_FACES[2]]: FACE_TONE[PV_FACES[0]],"],""",
     'test.q20')

once(T,
     """    q21: [PD_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);",
        "            const cardEl = (t.getAttribute('data-open') !== null) ? t : null;"],""",
     """    q21: [PD_VIEW,
        "            const cardEl = climb(t, (n) => n.getAttribute('data-open') !== null);",
        "            const cardEl = (t.getAttribute('data-open') !== null) ? t : null;"],""",
     'test.q21')

once(T,
     """    q23: [PD_VIEW,
        "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }' + NL + "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);",
        "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);" + NL + '            void 0;' + NL + "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }'],""",
     """    q23: [PD_VIEW,
        "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (actEl) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }' + NL + "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);",
        "            const rmEl = climb(t, (n) => n.getAttribute('data-rm') !== null);" + NL + "            const actEl = climb(t, (n) => n.getAttribute('data-act'));" + NL + '            if (cardOrderSwap) { this._act(actEl.getAttribute(' + Q + 'data-act' + Q + ')); return; }'],""",
     'test.q23')

print('== 共 %d 处 ==' % COUNT[0])
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
for rel, text in CUR.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)
    print('  写 %s' % rel)
print('已落盘 %d 个文件。' % len(CUR))