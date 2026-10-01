#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_v3430_src.py — 本轮修复（产品源码；**累积式**：同一文件的多处编辑按序串起来）

★ 本脚本的形态教训（第一跑踩到）：每一处编辑各自从**原始内容**出发算、最后按文件
  写盘 ⇒ 同一文件的多处编辑互相覆盖，只剩最后一处生效（app.js 27 处只活了 1 处）。
  修法：`once()` 一律在**上一次编辑的结果**上做替换（CUR 里存当前正文）。

本轮判据首跑（tests/system-v3430.test.mjs）抓到**本件自己的真缺陷五族**：

  ① App 两处 `strOf` 未定义（那是数据层的私有函数，App 侧只有 toStr）
     —— 走到就是 ReferenceError；
  ② **动作后投影陈旧（一族）**：动作口改的是内存字段，而 `_parsed / _lyrics /
     _hold / _readings` 只在 probe() 里算一次 ⇒「收下了却什么都没变」。
     修法：拆出 `_recompute()`（只算投影、不重读 storage），动作口改完紧跟一次；
  ③ 台账那条键**声明了却从没被用过**（题面与台账挤在 BRIEF_KEY 一条键里）
     ⇒「清题面只清题面与台账」在落盘层没有边界。修法：拆两条键；
  ④ saveToShelf 抢跑：上限检查写在「存」之后 ⇒ 越界时用户拿到**已经少了素材**的那一份；
  ⑤ 数据层两处：超硬限不报 over_limit；带标签的歌词里混进的无标签行**不报**
     （`dropped.noTime` 恒空 ⇒「这首歌本来没时间戳」与「刚才那段被截断了」同形）。
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
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d：%r' % (tag, n, old[:70])
    CUR[rel] = CUR[rel].replace(old, new, 1)
    COUNT[0] += 1
    print('  %-40s %s' % (tag, rel))


D = 'apps/pvdesk/pvdesk-data.js'
A = 'apps/pvdesk/pvdesk-app.js'
V = 'apps/pvdesk/pvdesk-view.js'

print('== 修复清单 ==')

# ① 数据层：超硬限要报 over_limit
once(D,
     """    return { ok: true, why: '', shots, rejected, emptyBodies, bodyCut, saw: '',
             truncated: overLimit, chars, keptChars: overLimit ? limitChars : chars,
             overShots: overLimit && shots.length >= limitShots };""",
     """    /* ★ 超硬限要**报出来**：源把整段照喂、截了不说。本件截段照解，但 why 落
     *   over_limit 且 truncated / keptChars 都在 —— 视图据此画出「后面多少字没进来」。 */
    return { ok: true, why: overLimit ? PV_PARSE_WHYS[3] : '',
             shots, rejected, emptyBodies, bodyCut, saw: '',
             truncated: overLimit, chars, keptChars: overLimit ? limitChars : chars,
             overShots: overLimit && shots.length >= limitShots };""",
     'data.parseShots.over_limit')

# ② 数据层：没时间标签的行分两形（untimed 的正文 vs 坏行）
once(D,
     """    const raw = str.split(CHAR_NL);
    const entries = [];
    let anyStamp = false;
    const plain = [];
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split(CHAR_CR).join('');
        if (line.length > PV_LRC_LINE_MAX) {
            dropped.noTime.push({ line: i + 1, saw: line.slice(0, 24), why: 'too_long' });
            continue;
        }
        if (isMetaLine(line)) { dropped.meta += 1; continue; }
        const spans = readTimes(line);
        if (spans.length === 0) {
            const body = stripTags(line, []);
            if (body) plain.push(body);
            else if (line.trim()) dropped.noTime.push({ line: i + 1, saw: line.trim().slice(0, 24), why: 'no_stamp' });
            continue;
        }""",
     """    const raw = str.split(CHAR_NL);
    const entries = [];
    let anyStamp = false;
    const plain = [];
    const loose = [];
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split(CHAR_CR).join('');
        if (line.length > PV_LRC_LINE_MAX) {
            dropped.noTime.push({ line: i + 1, saw: line.slice(0, 24), why: 'too_long' });
            continue;
        }
        if (isMetaLine(line)) { dropped.meta += 1; continue; }
        const spans = readTimes(line);
        if (spans.length === 0) {
            /* ★ 没时间标签的行先收着 —— 它是**哪一种**要等全篇看完才知道：
             *   · 通篇一行标签都没有 ⇒ 这是 untimed 模式的正文（按字数排）；
             *   · 别处有标签、就这几行没有 ⇒ 这是**坏行**，逐条报 no_stamp。
             *   源对两种情形一律 continue，于是「这首歌本来就没时间戳」与
             *   「刚才那段被截断了」在用户眼里同形。 */
            const body = stripTags(line, []);
            if (body) loose.push({ line: i + 1, text: body });
            continue;
        }""",
     'data.parseLrcText.loose')

once(D,
     """    if (!anyStamp) {
        return { mode: 'untimed', timed: false, cues: [], dropped, lines: raw.length, plain };
    }
    entries.sort(function (x, y) { return x.t - y.t; });""",
     """    if (!anyStamp) {
        for (let i = 0; i < loose.length; i++) plain.push(loose[i].text);
        return { mode: 'untimed', timed: false, cues: [], dropped, lines: raw.length, plain };
    }
    /* 有标签的行在场 ⇒ 那几行没标签的就是坏行（逐条报，不静默丢）。 */
    for (let i = 0; i < loose.length; i++) {
        dropped.noTime.push({ line: loose[i].line, saw: loose[i].text.slice(0, 24), why: 'no_stamp' });
    }
    entries.sort(function (x, y) { return x.t - y.t; });""",
     'data.parseLrcText.noStamp')

# ③ App：strOf → toStr
once(A, 'filled: strOf(anchored.filled) };', 'filled: toStr(anchored.filled) };', 'app.strOf.1')
once(A, 'why: strOf(r.why), index: r.index,', 'why: toStr(r.why), index: r.index,', 'app.strOf.2')

# ④ App：投影四格拆出来
once(A,
     '        this._face = FACE_ABSENT;',
     """        this._face = FACE_ABSENT;
        this._malformed = false;""",
     'app.ctor.malformed')

once(A,
     """    probe() {
        const st = this._loadBrief();
        this._face = st.face;
        this._loadLyrics();
        this._loadPolicy();
        const briefChars = charCount(this._brief);""",
     """    probe() {
        const st = this._loadBrief();
        this._face = st.face;
        this._malformed = (st.face === FACE_MALFORMED);
        this._loadLyrics();
        this._loadPolicy();
        this._loadShelf();
        this._recompute();
        return {
            face: this._face, faceText: FACE_TEXT[this._face], shots: this._parsed.shots.length,
            rejected: this._parsed.rejected.length, emptyBodies: this._parsed.emptyBodies.length,
            cues: this._lyrics.cues.length, hold: this._hold.ok
        };
    }
    /** 重算四格投影（**不重读 storage**）。
     *  ★ 必须单独成口：动作口（收题面 / 收歌词 / 清空 / 各 set*）改的是**内存字段**，
     *    投影得跟着变。只在 probe 里算一次的话，动作之后视图读到的还是**上一轮**的
     *    投影 —— 表现是「收下了却什么都没变」，不报错、不崩溃、只错结果。 */
    _recompute() {
        const briefChars = charCount(this._brief);""",
     'app.probe.split')

once(A,
     '        const malformed = (st.face === FACE_MALFORMED) || overChars;',
     '        const malformed = (this._malformed === true) || overChars;',
     'app.recompute.malformed')

once(A,
     """        this._now = Date.now();
        return {
            face: this._face, faceText: FACE_TEXT[this._face], shots: this._parsed.shots.length,
            rejected: this._parsed.rejected.length, emptyBodies: this._parsed.emptyBodies.length,
            cues: this._lyrics.cues.length, hold: this._hold.ok
        };
    }""",
     """        this._now = Date.now();
    }""",
     'app.recompute.tail')

# ⑤ App：台账拆成第二条键
once(A,
     """        this._shelf = Array.isArray(obj.shelf) ? obj.shelf : [];
        this._ledger = Array.isArray(obj.ledger) ? obj.ledger : [];
        if (!this._brief && this._shelf.length === 0) return { face: FACE_EMPTY, why: '' };
        return { face: FACE_OK, why: '' };
    }""",
     """        if (!this._brief) return { face: FACE_EMPTY, why: '' };
        return { face: FACE_OK, why: '' };
    }
    /** 台账与动作记录（与题面**分两条键**：题面是「眼下这一份」，台账是
     *  「写过的每一份」—— 源把两者与成片任务挤在一处，清一次任务列表会把题面一起清掉）。
     *  ★ 读不出来时清空内存里的台账：不许把「取不出来」读成「还留着上一份」。 */
    _loadShelf() {
        const r = this._readRaw(SHELF_KEY);
        if (!r.ok || r.why === 'absent') { this._shelf = []; this._ledger = []; this._dropped = 0; return; }
        let obj = null;
        try {
            obj = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value;
        } catch (e) {
            this._shelf = []; this._ledger = []; this._dropped = 0; return;
        }
        this._shelf = (obj && Array.isArray(obj.shelf)) ? obj.shelf : [];
        this._ledger = (obj && Array.isArray(obj.ledger)) ? obj.ledger : [];
        const dp = numOrNull(obj && obj.dropped);
        this._dropped = (dp !== null && dp >= 0) ? dp : 0;
    }""",
     'app.loadShelf')

once(A,
     """    _persistBrief() {
        return this._writeJSON(BRIEF_KEY, {
            brief: this._brief, title: this._title, duration: this._duration,
            style: this._style, lens: this._lens, mood: this._mood,
            shelf: this._shelf, ledger: this._ledger
        });
    }""",
     """    _persistBrief() {
        return this._writeJSON(BRIEF_KEY, {
            brief: this._brief, title: this._title, duration: this._duration,
            style: this._style, lens: this._lens, mood: this._mood
        });
    }
    /** 台账那条键的落盘（每记一笔动作回执就落一次，台账不随会话退出丢掉）。 */
    _persistShelf() {
        return this._writeJSON(SHELF_KEY, {
            shelf: this._shelf, ledger: this._ledger, dropped: this._dropped
        });
    }""",
     'app.persistShelf')

once(A,
     """        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); this._dropped += 1; }
    }""",
     """        while (this._ledger.length > PV_LEDGER_MAX) { this._ledger.shift(); this._dropped += 1; }
        this._persistShelf();
    }""",
     'app.receipt.persist')

once(A,
     """    _clearToDefaults() {
        this._brief = '';""",
     """    _clearToDefaults() {
        this._face = FACE_EMPTY;
        this._malformed = false;
        this._brief = '';""",
     'app.clearToDefaults.face')

# ⑥ App：动作口改完内存字段必须重算
once(A,
     """            if (briefRep.mood) this._mood = briefRep.mood;
            const wrote = this._persistBrief();""",
     """            if (briefRep.mood) this._mood = briefRep.mood;
            this._face = FACE_OK;
            this._malformed = false;
            this._recompute();
            const wrote = this._persistBrief();""",
     'app.ingest.brief.recompute')

once(A,
     """        if (shotsRep.ok) {
            this._brief = raw;
            const wrote = this._persistBrief();""",
     """        if (shotsRep.ok) {
            this._brief = raw;
            this._face = FACE_OK;
            this._malformed = false;
            this._recompute();
            const wrote = this._persistBrief();""",
     'app.ingest.shots.recompute')

once(A,
     '        const lyr = parseLrcText(this._lyricsRaw, { duration: this._duration, maxChars: this._maxChars, offset: 0 });',
     """        this._recompute();
        const lyr = parseLrcText(this._lyricsRaw, { duration: this._duration, maxChars: this._maxChars, offset: 0 });""",
     'app.ingestLyrics.recompute')

for anchor, tag in [
    ("        this._style = p.filled === 'ok' ? key : '';", 'app.setStyle.recompute'),
    ("        this._lens = p ? key : '';", 'app.setLens.recompute'),
    ("        this._mood = found ? key : '';", 'app.setMood.recompute'),
    ('        this._duration = n;', 'app.setDuration.recompute'),
    ('        this._maxChars = v;', 'app.setMaxChars.recompute'),
    ('        this._lang = key;', 'app.setLang.recompute'),
    ('        this._wide = on === true;', 'app.setWide.recompute'),
]:
    once(A, anchor, anchor + NL + '        this._recompute();', tag)

# ⑦ App：存台账先核上限
once(A,
     """        const text = toStr(o.text) || this._draft;
        const shots = this._parsed.shots.length;
        if (shots === 0) {
            this._shelf.push({
                at: Date.now(), title: this._title, kind: 'brief_without_cut',
                shots: 0, chars: charCount(this._brief), text: ''
            });
            const wrote0 = this._persistBrief();
            this._receipt('shelf', true, 'brief_without_cut', { shots: 0 });
            return Object.assign(this._savedOk(wrote0), { ok: true, kind: 'brief_without_cut', shots: 0 });
        }
        this._shelf.push({
            at: Date.now(), title: this._title, kind: 'cut',
            shots, chars: text ? text.length : 0, text
        });
        const wrote = this._persistBrief();
        this._receipt('shelf', true, '', { shots, chars: text ? text.length : 0 });
        return Object.assign(this._savedOk(wrote), { ok: true, kind: 'cut', shots, chars: text ? text.length : 0 });""",
     """        const text = toStr(o.text) || this._draft;
        const shots = this._parsed.shots.length;
        /* ★ 参考素材超了上限一律**拒存**：源在这一步静默截掉多余的参考图，
         *   用户拿到的永远是「少了素材的那一份」而看不出来。 */
        const refLimit = refsLimitOf('paint', this._wide);
        const refs = this.refRows();
        if (refs.length > refLimit) {
            this._receipt('shelf', false, PV_HOLD_WHYS[4], { refs: refs.length, limit: refLimit });
            return Object.assign(this._savedOk(false), {
                ok: false, why: PV_HOLD_WHYS[4], kind: '', refs: refs.length, limit: refLimit
            });
        }
        const kind = shots > 0 ? 'cut' : 'brief_without_cut';
        this._shelf.push({
            at: Date.now(), title: this._title, kind,
            shots, chars: text ? text.length : 0, text: shots > 0 ? text : ''
        });
        const wrote = this._persistShelf();
        this._receipt('shelf', true, shots > 0 ? '' : kind, { shots, chars: text ? text.length : 0 });
        return Object.assign(this._savedOk(wrote), {
            ok: true, kind, shots, chars: text ? text.length : 0
        });""",
     'app.saveToShelf.gate')

once(A,
     """        this._shelf.splice(i, 1);
        const wrote = this._persistBrief();""",
     """        this._shelf.splice(i, 1);
        const wrote = this._persistShelf();""",
     'app.removeFromShelf.persist')

once(A,
     """    clearLedger() {
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistBrief();""",
     """    clearLedger() {
        this._ledger = [];
        this._dropped = 0;
        const wrote = this._persistShelf();""",
     'app.clearLedger.persist')

once(A,
     """    clearBrief() {
        this._clearToDefaults();
        const wrote = this._persistBrief();
        this._receipt('clear', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }""",
     """    clearBrief() {
        this._clearToDefaults();
        this._recompute();
        const wrote = this._persistBrief();
        this._persistShelf();
        this._receipt('clear', true, '', {});
        return Object.assign(this._savedOk(wrote), { ok: true });
    }""",
     'app.clearBrief.recompute')

# ⑧ 视图：四态色调真挂到根上
once(V,
     """        this._root = document.createElement('div');
        this._root.className = 'pvd-root';""",
     """        this._root = document.createElement('div');
        /* ★ 四态色调挂在根上（面色相表在这里**真被用上**，不是摆设）。 */
        this._root.className = 'pvd-root ' + this._tone(this.app.faceOf());""",
     'view.render.tone')

once(V,
     """    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();""",
     """    refresh() {
        if (!this._root) return;
        this._root.className = 'pvd-root ' + this._tone(this.app.faceOf());
        this._root.innerHTML = this._buildHTML();""",
     'view.refresh.tone')

print('== 共 %d 处 ==' % COUNT[0])
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
for rel, text in CUR.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)
    print('  写 %s' % rel)
print('已落盘 %d 个文件。' % len(CUR))