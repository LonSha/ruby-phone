#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pv3.py — [v3.43.0] PV 案头 · 视图取数口补全与两处口径订正。

动机（每一处都是「不报错、只错数据」）：
  W1  视图读了 parseInfo / previewOf / lyricsInfo / durationOf / lensOf /
      styleOf / moodOf 七个口，落盘层**一个都没定义** ⇒ 一打开就 undefined。
      这七个口必须在 App 侧现算（视图不持第二份读数）。
  W2  时长下拉的项是真源的 { n, label }，而视图按 it.key 取值 ⇒ 每一项的
      value 全是字符串 undefined：选哪个时长都落进 out_of_range。
      （源同一形状的坑：值取错字段不会报错，只会「选什么都没反应」。）
  W3  probe 把 castRows()（台词行数）当成「登场角色数」喂给收工检查与读数面
      ⇒ PV_CAST_MAX 这条上限量的是台词而不是角色，永远判不出超员。
  W4  视图 import 里 PV_CAST_MAX / PV_EXCERPT_THRESHOLD / PV_DURATION_MIN /
      PV_DURATION_MAX 一个都没用到（数据层的出口由落盘层与判据面消费）。

纪律：每条锚点必须**恰中 N 次**；默认 dry-run，--write 才落盘。"""
import sys

APP = 'apps/pvdesk/pvdesk-app.js'
VIEW = 'apps/pvdesk/pvdesk-view.js'
BS = chr(92)
BT = chr(96)

PATCHES = [
    # ---------- W1：补七个视图取数口 ----------
    (APP, 1, """    /* ---------- 各表（视图直接读，不另算） ---------- */
    catalogs() {""",
     """    /* ---------- 视图小口（读现算值，视图不重算） ---------- */
    durationOf() {
        return this._duration;
    }
    lensOf() {
        return this._lens;
    }
    styleOf() {
        return this._style;
    }
    moodOf() {
        return this._mood;
    }
    /** 这一份题面「认出来没有」：视图照画，不自己再判一遍。 */
    parseInfo() {
        return {
            ok: this._parsed.ok === true,
            why: this._parsed.ok ? '' : toStr(this._parsed.why),
            saw: toStr(this._parsed.saw),
            shots: this._parsed.shots.length,
            chars: charCount(this._brief),
            keptChars: (typeof this._parsed.keptChars === 'number')
                ? this._parsed.keptChars : charCount(this._brief),
            truncated: this._parsed.truncated === true,
            rejected: this._parsed.rejected || [],
            emptyBodies: this._parsed.emptyBodies || []
        };
    }
    /** 题面预览：超阈值就截断，**截断要说出来**（源也截，但静默）。 */
    previewOf() {
        return excerptOf(this._brief, PV_EXCERPT_THRESHOLD);
    }
    /** 歌词读数：三态之外还要**逐项报坏行**（源静默丢）。 */
    lyricsInfo() {
        const d = this._lyrics.dropped || { noTime: [] };
        return {
            mode: this._lyrics.mode,
            lines: (typeof this._lyrics.lines === 'number') ? this._lyrics.lines : null,
            cues: this._lyrics.cues.length,
            noTime: Array.isArray(d.noTime) ? d.noTime.length : null,
            noText: (typeof d.noText === 'number') ? d.noText : null,
            meta: (typeof d.meta === 'number') ? d.meta : null
        };
    }

    /* ---------- 各表（视图直接读，不另算） ---------- */
    catalogs() {"""),

    # ---------- W1b：导入截断阈值 ----------
    (APP, 1, """    PV_DURATION_MIN, PV_DURATION_MAX, PV_DURATION_DEFAULT, PV_LEDGER_MAX,""",
     """    PV_DURATION_MIN, PV_DURATION_MAX, PV_DURATION_DEFAULT, PV_LEDGER_MAX,
    PV_EXCERPT_THRESHOLD,"""),

    # ---------- W3a：probe 里角色数改取立绘号 ----------
    (APP, 1, """        const castN = allFigNums(this._parsed.shots);
        const css = this.castRows();""",
     """        /* ★ 这一份的「登场角色」= 镜头里挂到的立绘号（不是台词行数：
         *   源把两件事混在一处数，于是角色上限永远判不出超员）。 */
        const figs = allFigNums(this._parsed.shots);"""),

    (APP, 1, """            text: this._brief,
            cast: css,
            refs: this.refRows(),""",
     """            text: this._brief,
            cast: figs,
            refs: this.refRows(),"""),

    (APP, 1, """                brief: this._brief,
                shots: this._parsed.shots,
                cast: css,""",
     """                brief: this._brief,
                shots: this._parsed.shots,
                cast: figs,"""),

    # ---------- W2：下拉取值先认 key，再认真源的 n ----------
    (VIEW, 1, """        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            parts.push('<option value="' + this._esc(it.key) + '"' + (cur === it.key ? ' selected' : '')
                + '>' + this._esc(it.label) + '</option>');
        }""",
     """        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            /* ★ 取值字段先认 key，再认真源的 n：时长档给的是 { n, label }。
             *   取错字段不会报错，只会「选什么都没反应」（项值全是 undefined）。 */
            const v = (it.key === undefined) ? String(it.n) : it.key;
            parts.push('<option value="' + this._esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '')
                + '>' + this._esc(it.label) + '</option>');
        }"""),

    # ---------- W4：视图 import 去掉四张它不用的出口 ----------
    (VIEW, 1, """import {
    PV_FACES, PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_EXCERPT_THRESHOLD,
    PV_CAST_MAX, PV_REFS_MAX, PV_REFS_MAX_WIDE, PV_DURATION_MIN, PV_DURATION_MAX
} from './pvdesk-data.js';""",
     """import {
    PV_FACES, PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_REFS_MAX, PV_REFS_MAX_WIDE
} from './pvdesk-data.js';"""),
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
            bad.append('W%d %s 锚点 %d 次（要 %d）' % (idx, path, got, want))
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