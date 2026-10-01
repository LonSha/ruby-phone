#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pv2.py — [v3.43.0] PV 案头 · 落盘层与数据层的六处对齐补丁。

动机（每一处都是一条「不报错、只错数据」）：
  P1/P2/P3  取数口写成了 storage.getChatData / setChatData —— 本仓 storage 的
            公共 API 是 get / set，且 scripts/keys-audit.mjs 的证据面**只认
            storage 句柄上的 get/set/remove**。走别的口 ⇒ 这四个键从未进入
            登记面，K1/K2/K3 全部失效（键该不该会话隔离没人回答）。
  P4        songRows() 是空壳、figRows() 与 refRows() 各算一遍 ——
            同一份投影两处算必定分歧（本仓吃过亏）。合并成 refRows 一处，
            并补上焦点键：卡片判定不许读直点元素（源满篇 target 直读）。
  P5        要求文本头把「没给画风」与「认不出这个画风」写成同一个「未指定」。
  P6        台账溢出静默 shift —— 用户只看到「台账怎么少了」。

纪律：每条锚点必须**恰中 N 次**，否则整个脚本退出（防重复执行改坏）。
默认 dry-run，--write 才落盘。"""
import sys
import re

APP = 'apps/pvdesk/pvdesk-app.js'
DATA = 'apps/pvdesk/pvdesk-data.js'
BS = chr(92)
BT = chr(96)

PATCHES = [
    # ---------- P1：_readRaw 改走 storage.get / set ----------
    (APP, 1, """    /** 读一格。三种回报：ok / absent（这一格压根没写过）/ malformed（写了但读不懂）。 */
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        try {
            const v = this.storage.getChatData(key);
            if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
            return { ok: true, why: 'present', value: v };
        } catch (e) {
            return { ok: false, why: 'read_threw', value: undefined };
        }
    }""",
     """    /** 读一格。三种回报：ok / absent（这一格压根没写过）/ malformed（写了但读不懂）。
     *  ★ 抛异常**不是**「没记过」：本仓最贵的形态是「读不出来 ⇒ 画成空」。
     *  ★ 只走 storage.get / storage.set —— keys-audit 的证据面只认 storage 句柄上的
     *    这三个口；走别的取数口会让这四个键从未进入登记面（K1/K2/K3 一并失效）。 */
    _readRaw(key) {
        const gate = this._storageUsable();
        if (!gate.ok) return { ok: false, why: gate.why, value: undefined };
        let v = null;
        try { v = this.storage.get(key, null); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }"""),

    # ---------- P2：可用性判定改看 get / set ----------
    (APP, 1,
     """        if (typeof this.storage.getChatData !== 'function') return { ok: false, why: 'no_api' };""",
     """        if (typeof this.storage.get !== 'function' || typeof this.storage.set !== 'function') {
            return { ok: false, why: 'no_api' };
        }"""),

    # ---------- P3：写格改走 storage.set ----------
    (APP, 1, """        if (typeof this.storage.setChatData !== 'function') return false;
        try {
            this.storage.setChatData(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }""",
     """        if (typeof this.storage.set !== 'function') return false;
        try {
            this.storage.set(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }"""),

    # ---------- P4a：删掉空壳 songRows ----------
    (APP, 1, """    /* ---------- 视图取数口 ---------- */
    songRows() {
        return [];
    }
""", """    /* ---------- 视图取数口 ---------- */
"""),

    # ---------- P4b：figRows 升级成唯一的参考素材投影 ----------
    (APP, 1, """    figRows() {
        const nums = allFigNums(this._parsed.shots);
        const rows = [];
        for (let i = 0; i < nums.length; i++) {
            let used = 0;
            for (let k = 0; k < this._parsed.shots.length; k++) {
                if (shotFigNums(this._parsed.shots[k].body).indexOf(nums[i]) >= 0) used += 1;
            }
            rows.push({ index: i, n: nums[i], shots: used });
        }
        return rows;
    }""",
     """    /** 参考素材行：源把「这一份要用几张参考图」缩成一句素材指代、超了才报，
     *  于是**没挂过的素材与挂过的素材同形**，且超限只报一句「已裁剪」。
     *  本件单列一栏：每项带图号、出现在哪几镜、当前上限、是否已超限。 */
    refRows() {
        const nums = allFigNums(this._parsed.shots);
        const limit = refsLimitOf('paint', this._wide);
        const rows = [];
        for (let i = 0; i < nums.length; i++) {
            const where = [];
            for (let k = 0; k < this._parsed.shots.length; k++) {
                if (shotFigNums(this._parsed.shots[k].body).indexOf(nums[i]) >= 0) {
                    where.push(this._parsed.shots[k].n);
                }
            }
            rows.push({
                index: i, key: '图' + nums[i], n: nums[i],
                shots: where.length, where: where.join('/'),
                limit, over: (i + 1) > limit
            });
        }
        return rows;
    }"""),

    # ---------- P4c：旧空壳 refRows 换成焦点口 ----------
    (APP, 1, """    refRows() {
        return [];
    }""",
     """    /* ---------- 焦点（详情条） ---------- */
    /** 焦点键：卡片判定不许读直点元素的文本（源满篇 target 直读）。
     *  点卡片里的正文文字时 target 是子元素，判定落空 ⇒ 用户点正文没反应。 */
    currentKey() {
        return String(this._focus);
    }
    openItem(key) {
        const k = String(key == null ? '' : key);
        const shots = this.shotRows();
        for (let i = 0; i < shots.length; i++) {
            if (String(shots[i].n) === k) { this._focus = k; return { ok: true, key: k, kind: 'shot' }; }
        }
        const refs = this.refRows();
        for (let i = 0; i < refs.length; i++) {
            if (String(refs[i].n) === k) { this._focus = k; return { ok: true, key: k, kind: 'ref' }; }
        }
        this._focus = '';
        return { ok: false, key: k, kind: '' };
    }
    closeItem() {
        this._focus = '';
        return { ok: true };
    }"""),

    # ---------- P5：要求文本头把「没给」与「认不出」分开 ----------
    (APP, 1, """        const head = [];
        head.push('标题：' + (this._title || '(无标题)'));
        head.push('时长：' + this._duration + '秒');
        head.push('机型：' + (perspectiveOf(this._lens) ? perspectiveOf(this._lens).label : '未指定'));
        head.push('画风：' + (stylePick(this._style).filled === 'ok'
            ? stylePick(this._style).key : ('未指定(' + stylePick(this._style).filled + ')')));
        head.push('情绪：' + (this._mood || '未指定'));""",
     """        const pick = stylePick(this._style);
        const lensRow = perspectiveOf(this._lens);
        const head = [];
        head.push('标题：' + (this._title || '(无标题)'));
        head.push('时长：' + this._duration + '秒');
        head.push('机型：' + (lensRow ? (lensRow.label + '·' + lensRow.lens) : '没给'));
        /* ★「没给」与「给了但认不出」不同形：源两处都写「未指定」。 */
        head.push('画风：' + (pick.filled === 'ok'
            ? (pick.label + '·' + pick.anchor)
            : (pick.filled === 'absent' ? '没给' : ('认不出「' + pick.saw + '」'))));
        head.push('情绪：' + (this._mood || '没给'));"""),

    # ---------- P5b：compose 回执带逐格填写态 ----------
    (APP, 1, """        return Object.assign(this._savedOk(wrote), {
            ok: shots.length > 0, text: wrapped.text, chars: wrapped.chars,
            blocks: wrapped.blocks, shots: shots.length, figs: figs.length,
            kind: 'compose'
        });""",
     """        return Object.assign(this._savedOk(wrote), {
            ok: shots.length > 0, text: wrapped.text, chars: wrapped.chars,
            blocks: wrapped.blocks, shots: shots.length, figs: figs.length,
            kind: 'compose',
            filled: {
                style: pick.filled,
                lens: lensRow ? 'ok' : (this._lens ? 'unknown' : 'absent'),
                mood: this._mood ? 'ok' : 'absent',
                shots: shots.length
            }
        });"""),

    # ---------- P6：台账溢出计数 ----------
    (APP, 1, """    _receipt(kind, ok, why, detail) {
        this._ledger.push({ at: Date.now(), kind, ok: ok === true, why: toStr(why), detail: detail || {} });
        while (this._ledger.length > 40) this._ledger.shift();
    }""",
     """    /** 记一笔。★ 挤掉旧记录要**计数报出来**：源静默 shift，
     *  用户只看到「台账怎么少了」，看不到「被挤掉了多少」。 */
    _receipt(kind, ok, why, detail) {
        this._ledger.push({ at: Date.now(), kind, ok: ok === true, why: toStr(why), detail: detail || {} });
        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); this._dropped += 1; }
    }
    ledgerInfo() {
        return { kept: this._ledger.length, dropped: this._dropped, max: PV_LEDGER_MAX };
    }"""),

    # ---------- P7：清台账要把计数一并归零 ----------
    (APP, 1, """    clearLedger() {
        this._ledger = [];
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: true });
    }""",
     """    clearLedger() {
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistBrief();
        return Object.assign(this._savedOk(wrote), { ok: true, dropped: 0 });
    }"""),

    # ---------- P8：构造期加焦点与挤掉计数 ----------
    (APP, 1, """        this._draft = '';
        this._now = 0;
        this._face = FACE_ABSENT;""",
     """        this._draft = '';
        this._focus = '';
        this._dropped = 0;
        this._now = 0;
        this._face = FACE_ABSENT;"""),

    (APP, 1, """        this._draft = '';
        this._parsed = { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [] };
        this._lyrics = { mode: 'empty', timed: false, cues: [], dropped: { noTime: [], noText: 0, meta: 0 } };
        this._hold = { rows: [], ok: false, fails: 0, figs: [], figures: 0 };
    }""",
     """        this._draft = '';
        this._focus = '';
        this._dropped = 0;
        this._parsed = { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [] };
        this._lyrics = { mode: 'empty', timed: false, cues: [], dropped: { noTime: [], noText: 0, meta: 0 } };
        this._hold = { rows: [], ok: false, fails: 0, figs: [], figures: 0 };
    }"""),

    # ---------- P9：导入 PV_LEDGER_MAX ----------
    (APP, 1,
     """    PV_DURATION_MIN, PV_DURATION_MAX, PV_DURATION_DEFAULT,""",
     """    PV_DURATION_MIN, PV_DURATION_MAX, PV_DURATION_DEFAULT, PV_LEDGER_MAX,"""),

    # ---------- P10：换会话焦点归零 ----------
    (APP, 1, """    onChatChanged() {
        this._clearToDefaults();
        this._tab = 'brief';
        this._now = 0;""",
     """    onChatChanged() {
        this._clearToDefaults();
        this._tab = 'brief';
        this._focus = '';
        this._now = 0;"""),

    # ---------- P11：数据层补台账上限常量 ----------
    (DATA, 1, """export const PV_LRC_LINE_MAX = 400;""",
     """export const PV_LRC_LINE_MAX = 400;
export const PV_LEDGER_MAX = 40;"""),
]


def apply(write):
    files = {}
    for path, _n, _old, _new in PATCHES:
        if path not in files:
            files[path] = open(path, encoding='utf-8').read()
    bad = []
    for idx, (path, want, old, new) in enumerate(PATCHES, 1):
        got = files[path].count(old)
        if got != want:
            bad.append('P%d %s 锚点 %d 次（要 %d）' % (idx, path, got, want))
            continue
        files[path] = files[path].replace(old, new)
    if bad:
        print('ABORT:')
        for b in bad:
            print('  ' + b)
        return 1
    for path in files:
        src = open(path, encoding='utf-8').read()
        out = files[path]
        print('%s  反斜杠 %d -> %d   反引号 %d -> %d   行 %d -> %d' % (
            path, src.count(BS), out.count(BS), src.count(BT), out.count(BT),
            src.count(chr(10)) + 1, out.count(chr(10)) + 1))
        if write:
            open(path, 'w', encoding='utf-8').write(out)
    print('WROTE' if write else 'DRY-RUN OK（未落盘）')
    return 0


if __name__ == '__main__':
    sys.exit(apply('--write' in sys.argv))
