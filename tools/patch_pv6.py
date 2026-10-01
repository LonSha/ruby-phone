#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pv6.py — [v3.43.0] PV 案头 · 探针抓到的四处真缺陷（本版自己抓的）。

动机（全部由 /tmp/probe_pv.mjs 实测抓到，不是推测）：
  P1  **每镜正文尾部混入下一镜的表头**：切割位置写成「下一表头结束 - 表头字数」，
      那是右括号前的两个字符，不在表头起点上。实测镜头 1 的正文尾部是
      「…风吹起校服下摆 + 换行 + 镜头2（4-10」——分镜表上每镜都多出一截别人的表头。
  P2  **LRC 时间标签根本没被剥掉**：stripTags 用「标签结束位置」当切割终点，
      于是 slice(end, end) 恒为空串、而 slice(0, end) 把标签本身加了回去。
      实测正文是「[00:01.00]第一行」，主副行被切成「[00:01」与「.00]第一行」。
  P3  **时间戳行被算成「没正文」**：因为 P2，正文行首带着标签，
      `[00:02.00]` 这类空行也带着标签 ⇒ 坏行计数恒为 0（源那条「标签后没字」永远报不出来）。
  P4  时间码补零口径：本仓另一件（曲库案头）的时间码是 `00:00` 两位形，
      本件原本出 `0:00` —— 字幕时间码在字幕表里必然错位。

纪律：锚点必须恰中 N 次；默认 dry-run，--write 才落盘。"""
import sys

DATA = 'apps/pvdesk/pvdesk-data.js'
BS = chr(92)
BT = chr(96)

PATCHES = [
    # ---------- P1a：表头记录起点 ----------
    (DATA, 1,
     """    return { n: parseInt(num, 10), a: parseInt(a, 10), b: parseInt(b, 10), end: at + (i - at) };""",
     """    return { n: parseInt(num, 10), a: parseInt(a, 10), b: parseInt(b, 10),
             start: at, end: at + (i - at) };"""),

    # ---------- P1b：切割位置改用表头起点（原式落在右括号前两个字符上） ----------
    (DATA, 1,
     """        const segEnd = (k + 1 < heads.length) ? heads[k + 1].end - PV_SHOT_MARK.length : work.length;""",
     """        /* ★ 切到**下一镜表头的起点**：原式（下一表头结束 - 表头字数）落在右括号前两个
         *   字符上，于是每镜正文尾部都多出一截下一镜的表头（实测抓到）。 */
        const segEnd = (k + 1 < heads.length) ? heads[k + 1].start : work.length;"""),

    # ---------- P2a：readTimes 记录标签起点 ----------
    (DATA, 1,
     """        out.push({ t: sec, end: j + 1 });""",
     """        out.push({ t: sec, start: i, end: j + 1 });"""),

    # ---------- P2b：stripTags 用起点当切割终点（原式 slice(end, end) 恒空） ----------
    (DATA, 1,
     """function stripTags(line, spans) {
    if (spans.length === 0) return line;
    let out = '';
    let cursor = 0;
    for (let i = 0; i < spans.length; i++) {
        const at = spans[i].end;
        if (at > cursor) out += line.slice(cursor, at);
        cursor = spans[i].end;
        while (cursor < line.length && line[cursor] === ']') cursor++;
    }
    out += line.slice(cursor);
    return out.trim();
}""",
     """function stripTags(line, spans) {
    if (spans.length === 0) return clean(line);
    /* ★ 切的是**标签区间 [start, end)**：原式拿「结束位置」当终点，
     *   于是 slice(end, end) 恒为空串、slice(0, end) 又把标签本身加了回去 ——
     *   实测正文是「[00:01.00]第一行」（标签没剥掉，本版自己抓到）。 */
    let out = '';
    let cursor = 0;
    for (let i = 0; i < spans.length; i++) {
        const at = spans[i].start;
        if (at > cursor) out += line.slice(cursor, at);
        cursor = spans[i].end;
    }
    out += line.slice(cursor);
    return clean(out);
}"""),

    # ---------- P4：时间码补零（与曲库案头同口径） ----------
    (DATA, 1,
     """    return { text: mm + ':' + ssText, ok: true };""",
     """    return { text: (mm < 10 ? ('0' + mm) : String(mm)) + ':' + ssText, ok: true };"""),

    # ---------- P5：回信归一报「认了几个格」（先前声明了却没赋值） ----------
    (DATA, 1,
     """    out.brief = clean(out.brief);
    if (chars(out.brief) === 0) out.why = PV_PARSE_WHYS[0];
    return out;""",
     """    out.brief = clean(out.brief);
    out.sawKeys = saw;
    if (chars(out.brief) === 0) out.why = PV_PARSE_WHYS[0];
    return out;"""),
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