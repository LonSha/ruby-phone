#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pv5.py — [v3.43.0] PV 案头 · 单一消费面补齐（E1 供应链 + 视图照画）。

动机（本仓 E1：「数据层每一条真源表与内核函数都必须被产品侧真消费」）：
  实测六个出口是「建好了没人用」——
    · parseShotsReply 是纯别名（产品侧直接吃 parseShots）⇒ 直接删掉，不留空壳；
    · briefOf         题面正文的截断读数（源截但不说）；
    · lyricsPlainText 无时间戳那一态要按字数排的正文行（源自己有这一函数）；
    · applyStyleAnchor 画风锚追加（源 _pvApplyArtStyle：已有同一锚前 8 字就不重复加）；
    · findCueAt       按秒找当前这一句（源 _pvFindCueAt：区间左闭右开）；
    · figMapRows      图号 → 镜号映射行（源 _pvBuildAssetLines）。
  这五条不是废话，是**产品侧还没接上**：全部在 App 侧接成取数口，并在视图里
  真画出来（只接不画等于用户看不到，仍算没交付）。

纪律：锚点必须恰中 N 次；默认 dry-run，--write 才落盘。"""
import sys

APP = 'apps/pvdesk/pvdesk-app.js'
DATA = 'apps/pvdesk/pvdesk-data.js'
VIEW = 'apps/pvdesk/pvdesk-view.js'
BS = chr(92)
BT = chr(96)

PATCHES = [
    # ---------- ① 删掉纯别名出口（产品侧吃的是 parseShots） ----------
    (DATA, 1, """
/** 分镜回信：直接吃 parseShots 的那一套形态。 */
export function parseShotsReply(text, opts) {
    const r = parseShots(text, opts);
    return r;
}
""", ""),

    # ---------- ② 落盘层：五个出口接成取数口 ----------
    (APP, 1, """    /* ---------- 各表（视图直接读，不另算） ---------- */
    catalogs() {""",
     """    /* ---------- 源里有、本件先前只在数据层建好的那几面（产品侧接上） ---------- */
    /** 分镜体里被剔掉的行：源静默剔，用户只看到「这一镜怎么这么短」。 */
    bodyCutRows() {
        const rows = this._parsed.bodyCut || [];
        const out = [];
        for (let i = 0; i < rows.length; i++) out.push({ index: i, n: rows[i].n, cut: rows[i].cut });
        return out;
    }
    /** 题面正文的截断读数（源截但不说）。 */
    briefMeta() {
        return briefOf(this._brief, PV_EXCERPT_THRESHOLD);
    }
    /** 按字数排的歌词正文行（没时间戳时只能读它）。 */
    plainRows() {
        const lines = lyricsPlainText(this._lyricsRaw);
        const out = [];
        for (let i = 0; i < lines.length; i++) out.push({ index: i, text: lines[i] });
        return out;
    }
    /** 这一镜另出一份「追加画风锚」的文本：已有同一锚就不重复加（源口径）。 */
    scriptOf(n) {
        const shots = this.shotRows();
        const src = this._parsed.shots;
        for (let i = 0; i < shots.length && i < src.length; i++) {
            if (String(shots[i].n) === String(n)) {
                const p = promptForShot(src[i], {
                    styleKey: this._style, lensKey: this._lens, moodKey: this._mood
                });
                const anchored = applyStyleAnchor(p.text, this._style);
                return { ok: true, key: String(n), text: anchored.text,
                         applied: anchored.applied === true, filled: strOf(anchored.filled) };
            }
        }
        return { ok: false, key: String(n), text: '', applied: false, filled: '' };
    }
    /** 图号 → 镜号映射行（源的 _pvBuildAssetLines）。frames = 取前几镜做参考帧。 */
    figMapRowsOf(frames) {
        const rows = this.shotRows();
        const n = numOrNull(frames);
        const use = (n !== null && n > 0) ? Math.min(n, rows.length) : 0;
        const nums = [];
        for (let i = 0; i < use; i++) nums.push(rows[i].n);
        return { lines: figMapRows(allFigNums(this._parsed.shots).length, nums), frames: use };
    }
    /** 按秒找当前这一句（区间左闭右开）。 */
    cueAt(sec) {
        const n = numOrNull(sec);
        if (n === null) return { ok: false, why: 'no_time', clock: '', text: '', index: -1 };
        const r = findCueAt(this._lyrics.cues, n);
        return {
            ok: r.found === true, why: strOf(r.why), index: r.index,
            clock: r.found ? formatClock(r.cue.t).text : '',
            text: r.found ? r.cue.text : ''
        };
    }
    /** 一句台词的字形构成（中日英三类）：源不做混合分类，只看长度。 */
    vocabOf(text) {
        const c = textClassOf(text);
        return { cls: c.cls, kana: c.kana, hans: c.hans, latin: c.latin };
    }
    /** 眼下这一份的六格读数（视图照画；取不出来是 null **不是 0**）。 */
    readerRows() {
        const rd = this.readings();
        const out = [];
        for (let i = 0; i < rd.cards.length; i++) {
            out.push({ key: rd.cards[i].key, text: rd.cards[i].text, dash: rd.cards[i].dash === true });
        }
        return out;
    }

    /* ---------- 各表（视图直接读，不另算） ---------- */
    catalogs() {"""),

    # ---------- ③ 落盘层 import 补一个名字（其余名字先前已 import） ----------
    (APP, 1, """    refsLimitOf, holdCheck, parseBriefReply, readingsOf, blankCover
} from './pvdesk-data.js';""",
     """    refsLimitOf, holdCheck, parseBriefReply, readingsOf, blankCover, lyricsPlainText
} from './pvdesk-data.js';"""),

    # ---------- ④ 视图 import 补七项（坏行 / 字幕 / 上限口径） ----------
    (VIEW, 1, """import {
    PV_FACES, PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_REFS_MAX, PV_REFS_MAX_WIDE
} from './pvdesk-data.js';""",
     """import {
    PV_FACES, PV_SHOT_MAX, PV_HARD_LIMIT_CHARS, PV_REFS_MAX, PV_REFS_MAX_WIDE,
    PV_CAST_MAX, PV_CAPTION_MIN, PV_LRC_LINE_MAX, PV_META_TAGS, PV_FIG_MARKS,
    PV_DURATION_MIN, PV_DURATION_MAX
} from './pvdesk-data.js';"""),

    # ---------- ⑤ 视图 · 题面面板：时长档口径 + 截断读数 ----------
    (VIEW, 1, """        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('镜头', info.shots, PV_SHOT_MAX));
        parts.push(this._chip('正文', info.chars, PV_HARD_LIMIT_CHARS));
        parts.push('</div>');
        if (!info.ok) {""",
     """        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('镜头', info.shots, PV_SHOT_MAX));
        parts.push(this._chip('正文', info.chars, PV_HARD_LIMIT_CHARS));
        parts.push('</div>');
        parts.push('<div class="pvd-sub">时长档 ' + String(PV_DURATION_MIN) + ' 到 '
            + String(PV_DURATION_MAX) + ' 秒（默认 ' + String(app.durationOf()) + ' 秒）'
            + ' · 预览阈值 ' + String(meta.limit) + ' 字'
            + (meta.truncated ? ('（正文超了，这里只显示前 ' + String(meta.keptChars) + ' 字）') : '') + '</div>');
        if (!info.ok) {"""),

    (VIEW, 1, """        const info = app.parseInfo();
        const pv = app.previewOf();""",
     """        const info = app.parseInfo();
        const pv = app.previewOf();
        const meta = app.briefMeta();"""),

    # ---------- ⑥ 视图 · 镜头面板：剔行报表 + 图号映射 ----------
    (VIEW, 1, """            parts.push('</tbody></table>');
        }
        parts.push('</div>');
        return parts.join('');
    }
    /** 逐格填写态：哪一格「没给」、哪一格「给了但认不出」（源都写「未指定」）。 */""",
     """            parts.push('</tbody></table>');
        }
        const cuts = app.bodyCutRows();
        parts.push('<div class="pvd-sub">以「使用的素材」打头的行被剔掉了 '
            + this._count(cuts.length ? cuts.length : 0) + ' 镜：'
            + '源静默剔，用户只看到「这一镜怎么这么短」</div>');
        if (cuts.length > 0) {
            parts.push('<ul class="pvd-list">');
            for (let i = 0; i < cuts.length; i++) {
                parts.push('<li>镜头 ' + this._esc(cuts[i].n) + ' · 剔掉 ' + String(cuts[i].cut) + ' 行</li>');
            }
            parts.push('</ul>');
        }
        const map = app.figMapRowsOf(0);
        parts.push('<div class="pvd-sub">图号 → 镜号映射（源把它写成「连号就写区间」这一形；'
            + '把「只取前几镜做参考帧」填成正数就会生成映射行）</div>');
        if (map.lines.length === 0) {
            parts.push('<div class="pvd-empty">还没取参考帧。</div>');
        }
        parts.push('<div class="pvd-warn">立绘号「' + this._esc(PV_FIG_MARKS[0] + '」与「' + PV_FIG_MARKS[1])
            + '」都认（源口径：图 与 図 一个都不漏）</div>');
        parts.push('</div>');
        return parts.join('');
    }
    /** 逐格填写态：哪一格「没给」、哪一格「给了但认不出」（源都写「未指定」）。 */"""),

    # ---------- ⑦ 视图 · 对白面板：角色上限 + 字形列 ----------
    (VIEW, 1, """            + this._esc(langs.map((l) => (l.label + ' ' + String(l.pace))).join('；')) + '。</p>');
        if (rows.length === 0) {""",
     """            + this._esc(langs.map((l) => (l.label + ' ' + String(l.pace))).join('；')) + '。</p>');
        parts.push('<div class="pvd-reads">');
        parts.push(this._chip('登场角色', app.refRows().length, PV_CAST_MAX));
        parts.push(this._chip('台词行', rows.length, 0));
        parts.push('</div>');
        if (rows.length === 0) {"""),

    (VIEW, 1, """            parts.push('<table class="pvd-table"><thead><tr><th>镜头</th><th>这一镜几秒</th><th>台词</th>'
                + '<th>字数</th><th>这一镜放得下</th><th>结论</th></tr></thead><tbody>');""",
     """            parts.push('<table class="pvd-table"><thead><tr><th>镜头</th><th>这一镜几秒</th><th>台词</th>'
                + '<th>字数</th><th>字形</th><th>这一镜放得下</th><th>结论</th></tr></thead><tbody>');"""),

    (VIEW, 1, """                    + String(r.saw) + '</td><td>' + this._count(r.limit) + '</td><td>'
                    + (r.ok ? '塞得进' : this._esc(app.holdWhyTextOf(r.why))) + '</td></tr>');""",
     """                    + String(r.saw) + '</td><td>' + this._esc(app.vocabOf(r.text).cls) + '</td><td>'
                    + this._count(r.limit) + '</td><td>'
                    + (r.ok ? '塞得进' : this._esc(app.holdWhyTextOf(r.why))) + '</td></tr>');"""),

    # ---------- ⑧ 视图 · 歌词面板：字幕口径 + 按字数排的正文 + 按秒找句 ----------
    (VIEW, 1, """        parts.push(this._chip('元标签行', info.meta, 0));
        parts.push('</div>');""",
     """        parts.push(this._chip('元标签行', info.meta, 0));
        parts.push('</div>');
        parts.push('<div class="pvd-sub">字幕口径：一句最短停 ' + String(PV_CAPTION_MIN)
            + ' 秒 · 单行最长 ' + String(PV_LRC_LINE_MAX) + ' 字（超了按坏行报，不当成歌词收下）'
            + ' · 元标签认这 ' + String(PV_META_TAGS.length) + ' 个：'
            + this._esc(PV_META_TAGS.join('/')) + '</div>');
        parts.push('<div class="pvd-row"><span>这一刻是哪句</span>'
            + '<input class="pvd-num" type="number" min="0" step="1" data-k="cuesec" value="0">'
            + '<span class="pvd-sub">' + this._esc(cue.text ? (cue.clock + ' ' + cue.text)
                : ('这一秒没词（' + cue.why + '）')) + '</span></div>');
        const plain = app.plainRows();
        parts.push('<div class="pvd-sub">按字数排的正文行 ' + this._count(plain.length)
            + ' 行（没时间戳时只能读它；源自己有这一函数，不说就等于用户看不到）</div>');
        if (plain.length > 0) {
            parts.push('<ul class="pvd-list">');
            for (let i = 0; i < plain.length && i < 12; i++) {
                parts.push('<li>' + this._esc(plain[i].text) + '</li>');
            }
            parts.push('</ul>');
        }"""),

    (VIEW, 1, """        const plan = app.captionPlan();
        const pol = app.policyOf();""",
     """        const plan = app.captionPlan();
        const pol = app.policyOf();
        const cue = app.cueAt(0);"""),

    # ---------- ⑨ 视图 · 台账面板：本份六格读数 ----------
    (VIEW, 1, """        parts.push('<ul class="pvd-list">');
        for (let i = 0; i < files.length; i++) {
            parts.push('<li>' + this._esc(files[i]) + '</li>');
        }
        parts.push('</ul>');
        parts.push('</div>');
        return parts.join('');""",
     """        parts.push('<ul class="pvd-list">');
        for (let i = 0; i < files.length; i++) {
            parts.push('<li>' + this._esc(files[i]) + '</li>');
        }
        parts.push('</ul>');
        const reads = app.readerRows();
        parts.push('<div class="pvd-sub">眼下这一份的六格读数（取不出来画横线 —— '
            + '「真的 0」与「读不出来」不同形）</div>');
        parts.push('<table class="pvd-table"><thead><tr><th>格</th><th>读数</th></tr></thead><tbody>');
        for (let i = 0; i < reads.length; i++) {
            parts.push('<tr><td>' + this._esc(reads[i].key) + '</td><td'
                + (reads[i].dash ? ' class="pvd-cell-text"' : '') + '>'
                + this._esc(reads[i].dash ? DASH : reads[i].text) + '</td></tr>');
        }
        parts.push('</tbody></table>');
        parts.push('</div>');
        return parts.join('');"""),

    # ---------- ⑩ 视图 · 事件：按秒找句 + 只取前几镜的映射预览 ----------
    (VIEW, 1, """            if (pick === 'lang') {""",
     """            if (k0 === 'cuesec') {
                const r = this.app.cueAt(t.value);
                this._flash = r.ok ? ('第 ' + String(t.value) + ' 秒是「' + r.text + '」（' + r.clock + '）')
                    : ('第 ' + String(t.value) + ' 秒没词（' + r.why + '）');
                this.refresh();
                return;
            }
            if (k0 === 'figmap') {
                const r = this.app.figMapRowsOf(t.value);
                this._flash = r.frames > 0 ? ('映射行已生成 ' + r.lines.length + ' 条（取前 ' + r.frames + ' 镜）')
                    : '取 0 镜，不生成映射行';
                this.refresh();
                return;
            }
            if (pick === 'lang') {"""),

    (VIEW, 1, """            const pick = t.getAttribute('data-pick');
            if (pick === 'lens') {""",
     """            const pick = t.getAttribute('data-pick');
            const k0 = t.getAttribute('data-k');
            if (pick === 'lens') {"""),

    # ---------- ⑪ 视图 · 成文面板补一个映射预览输入 ----------
    (VIEW, 1, """        parts.push('<div class="pvd-row"><span>只取前几镜做参考帧</span>'
            + '<input class="pvd-num" type="number" min="0" max="' + String(PV_SHOT_MAX)
            + '" step="1" data-k="frames" value="0"></div>');""",
     """        parts.push('<div class="pvd-row"><span>只取前几镜做参考帧</span>'
            + '<input class="pvd-num" type="number" min="0" max="' + String(PV_SHOT_MAX)
            + '" step="1" data-k="frames" value="0"></div>');
        parts.push('<div class="pvd-row"><span>映射行预览</span>'
            + '<input class="pvd-num" type="number" min="0" max="' + String(PV_SHOT_MAX)
            + '" step="1" data-k="figmap" value="0"></div>');"""),
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