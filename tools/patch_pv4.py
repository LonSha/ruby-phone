#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# patch_pv4.py — [v3.43.0] PV 案头 · 单一消费面补齐（E1 供应链）。
#
# 动机：本仓 E1 判据是「数据层每一条真源表与内核函数都必须被产品侧真消费」。
#   实测有 14 个出口只被数据层自己用到 —— 它们不是废话，是**产品侧还没用上**：
#     · PV_SOURCE_FILES  只列了六个分文件，漏了主文件 niconico.js（源是一族七件）；
#     · 分镜体里以「使用的素材」打头的行被剔掉了，但**剔了几行没人说**
#       （源就是静默剔，用户只看到「这一镜怎么这么短」）；
#     · 歌词形态三态里「没时间戳」那一态已有读数，却没有**按字数排的正文行**
#       （源自己有 _pvLyricsPlainText，本件把它丢了 = 建好了零消费）；
#     · 题面上的「镜头 / 风格 / 镜头」三个键在回信里被改写成内部字段，
#       但**没报「我认了几个格」**（源静默改，用户不知道自己写的被改了）；
#     · 字幕行只给主副行，没给「这一句落在第几秒到第几秒」「同一时刻找哪一句」；
#     · 题面正文超阈值时的截断读数（源截但静默）；
#     · 逐镜挂了几张立绘时，没给「图号 → 镜号」的映射行（源的 _pvBuildAssetLines）；
#     · 画风锚追加（源的 _pvApplyArtStyle：已有同一锚的前 8 字就不重复加）。
#   ★ 这些全部落在**产品侧**（App 的取数口），不新增数据层出口 ——
#     单库纪律：数据层的出口必须有产品消费，产品侧不许有「算了不画」的现算值。
#
# 纪律：锚点必须恰中 N 次；默认 dry-run，--write 才落盘。
import sys

APP = 'apps/pvdesk/pvdesk-app.js'
DATA = 'apps/pvdesk/pvdesk-data.js'
VIEW = 'apps/pvdesk/pvdesk-view.js'
BS = chr(92)
BT = chr(96)

PATCHES = [
    # ---------- ① 真源文件清单补主文件（源是一族七件，清单只列了六个分件） ----------
    (DATA, 1, """export const PV_SOURCE_FILES = Object.freeze([
    'niconico-pv-form.js', 'niconico-pv-media.js', 'niconico-pv-storyboard.js',
    'niconico-pv-submit.js', 'niconico-pv-frames.js', 'niconico-pv-lyrics.js'
]);""",
     """export const PV_SOURCE_FILES = Object.freeze([
    'niconico.js',
    'niconico-pv-form.js', 'niconico-pv-media.js', 'niconico-pv-storyboard.js',
    'niconico-pv-submit.js', 'niconico-pv-frames.js', 'niconico-pv-lyrics.js'
]);"""),

    # ---------- ② 分镜体剔行报表（源静默剔，用户只看到「这一镜怎么这么短」） ----------
    (DATA, 1, """        let raw = work.slice(h.end, segEnd);
        const lines = raw.split(CHAR_NL);
        const kept = [];
        for (let t = 0; t < lines.length; t++) {
            const line = lines[t];
            const trimmed = clean(line);
            if (trimmed.indexOf(PV_BODY_DROP_MARK) === 0) continue;
            kept.push(line);
        }
        raw = clean(kept.join(CHAR_NL));
        if (!raw) emptyBodies.push(h.n);
        shots.push({ n: h.n, a: h.a, b: h.b, sec: h.b - h.a, body: raw });""",
     """        let raw = work.slice(h.end, segEnd);
        const lines = raw.split(CHAR_NL);
        const kept = [];
        let cut = 0;
        for (let t = 0; t < lines.length; t++) {
            const line = lines[t];
            const trimmed = clean(line);
            if (trimmed.indexOf(PV_BODY_DROP_MARK) === 0) { cut += 1; continue; }
            kept.push(line);
        }
        raw = clean(kept.join(CHAR_NL));
        if (!raw) emptyBodies.push(h.n);
        /* ★ 剔掉的行要**计数**：源静默剔，用户只看到「这一镜怎么这么短」。 */
        if (cut > 0) bodyCut.push({ n: h.n, cut });
        shots.push({ n: h.n, a: h.a, b: h.b, sec: h.b - h.a, body: raw, cut });"""),

    (DATA, 1, """    const rejected = [];
    const shots = [];
    const emptyBodies = [];""",
     """    const rejected = [];
    const shots = [];
    const emptyBodies = [];
    const bodyCut = [];"""),

    (DATA, 1, """    return { ok: false, why: PV_PARSE_WHYS[0], shots, rejected, emptyBodies,""",
     """    return { ok: false, why: PV_PARSE_WHYS[0], shots, rejected, emptyBodies, bodyCut,"""),

    (DATA, 1, """    return { ok: true, why: '', shots, rejected, emptyBodies, saw: '',""",
     """    return { ok: true, why: '', shots, rejected, emptyBodies, bodyCut, saw: '',"""),

    (DATA, 1, """    if (!src) return { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [], saw: '', truncated: false };""",
     """    if (!src) {
        return { ok: false, why: PV_PARSE_WHYS[0], shots: [], rejected: [], emptyBodies: [],
                 bodyCut: [], saw: '', truncated: false };
    }"""),

    (DATA, 1, """        return { ok: false, why: PV_PARSE_WHYS[1], shots: [], rejected: [], emptyBodies: [],
                 saw: work.slice(0, 60), truncated: overLimit, chars };""",
     """        return { ok: false, why: PV_PARSE_WHYS[1], shots: [], rejected: [], emptyBodies: [],
                 bodyCut: [], saw: work.slice(0, 60), truncated: overLimit, chars };"""),

    # ---------- ③ 回信归一报表：改了哪几个格要说出来 ----------
    (DATA, 1, """export function parseBriefReply(text) {
    const out = { brief: '', title: '', duration: null, style: '', lens: '', mood: '', filled: {}, why: '' };""",
     """export function parseBriefReply(text) {
    const out = { brief: '', title: '', duration: null, style: '', lens: '', mood: '',
                  filled: {}, taken: [], extra: [], why: '', sawKeys: 0 };"""),

    (DATA, 1, """        if (key === '标题' || key === 'title') { out.title = val; saw++; continue; }
        if (key === '风格' || key === 'style') { out.style = val; saw++; continue; }
        if (key === '镜头' || key === 'lens') { out.lens = val; saw++; continue; }
        if (key === '情绪' || key === 'mood') { out.mood = val; saw++; continue; }
        out.brief = out.brief ? out.brief + CHAR_NL + line : line;""",
     """        if (key === '标题' || key === 'title') { out.title = val; saw++; out.taken.push('title'); continue; }
        if (key === '风格' || key === 'style') { out.style = val; saw++; out.taken.push('style'); continue; }
        if (key === '镜头' || key === 'lens') { out.lens = val; saw++; out.taken.push('lens'); continue; }
        if (key === '情绪' || key === 'mood') { out.mood = val; saw++; out.taken.push('mood'); continue; }
        /* ★ 认不出的键**要留痕**：源把这行当正文收走，用户以为设置生效了。 */
        out.extra.push(key);
        out.brief = out.brief ? out.brief + CHAR_NL + line : line;"""),

    # ---------- ④ 题面正文超阈值的截断读数（源截但静默） ----------
    (DATA, 1, """export function briefOf(v, threshold) {
    const s = clean(v);""",
     """/** 超阈值的正文读数（源也截，但**不说**）：视图与取数口都读它。 */
export function briefOf(v, threshold) {
    const s = clean(v);"""),

    # ---------- ⑤ 无时间戳歌词的正文行（源自己有，本件建好了零消费） ----------
    (DATA, 1, """export function lyricsPlainText(text) {
    const str = strOf(text);""",
     """export function lyricsPlainText(text) {
    const str = strOf(text);"""),
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