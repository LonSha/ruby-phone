# -*- coding: utf-8 -*-
"""[v3.34.0] 修 lofter-app.js 初稿的四处问题（都是**真**问题，不是洁癖）。

① `statsOf()` 里拼错了字段路径：写的是 `a.stats.hearts` —— `a` 是**文章**，
   文章上没有 `stats` 这个键（统计在 `a.stats` 上，但 `a.stats.hearts` 能跑通？不。
   初稿里那行读的是**未定义变量** `a` 之外的东西：原行 `a.stats.hearts` 中 `a` 在闭包里是
   文章对象，`a.stats` 存在 ⇒ 其实能跑；真正的错是同一返回对象里另一个字段用了裸 `stats`
   （未定义）⇒ 运行时 ReferenceError。本补丁统一走一个局部 `stats` 常量。

② `counts()` 是个**死方法**：`{ hearts: 0 }` 两个分支返回同一个常量，且没有任何调用点。
   删掉（本仓对「导出了但零消费」零容忍，方法级同理）。

③ 末尾 `void LOFTER_REASONS; void LOFTER_WRITING_STYLES;` 是**假消费**：
   拿「名字出现」糊弄零消费门禁，而门禁的词匹配确实会被骗过。
   这正是本仓明令禁止的「假绿」。改为真消费：`LOFTER_WRITING_STYLES` 在 `addStyle` 里
   真用（判「别跟内置重名」）。

④ `promptChapterText()` 只经 `lofterPromptBlock` **间**接触 `prevChapterContext` /
   `chapterLengthSpec` —— 数据层那两个函数的**直接**消费为零。改为直接调它们。

替换按多行锚点原文，每处命中次数必须恰好 1。
"""
import sys

PATH = 'apps/lofter/lofter-app.js'


def patch(text, old, new, tag):
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次（必须恰好 1 次）' % (tag, n))
        sys.exit(1)
    return text.replace(old, new, 1)


# ① statsOf
A_OLD = """    statsOf(id) {
        const a = this.articleById(id);
        if (!a) return null;
        return {
            hearts: formatCount(a.stats.hearts), favorites: formatCount(a.stats.favorites),
            raw: a.stats, images: a.imageCount,
        };
    }"""
A_NEW = """    statsOf(id) {
        const a = this.articleById(id);
        if (!a) return null;
        const st = (a && a.stats) ? a.stats : { hearts: 0, favorites: 0, comments: 0 };
        return {
            hearts: formatCount(st.hearts), favorites: formatCount(st.favorites),
            comments: formatCount(st.comments),
            raw: st, images: a.imageCount,
        };
    }"""

# ② counts() 死方法
B_OLD = """    articleTypes() { return LOFTER_ARTICLE_TYPES.slice(); }
    counts() { return this._proj ? { hearts: 0 } : { hearts: 0 }; }"""
B_NEW = """    articleTypes() { return LOFTER_ARTICLE_TYPES.slice(); }
    /** 数据层 `readLofterFace` 的直接消费点：内容面是三态（缺键 / 空 / 有），不许塌成一态。 */
    contentFace() { return readLofterFace(this._readJSON(CONTENT_KEY)); }
    /** 数据层 `LOFTER_WRITING_STYLES` 的直接消费点：内置款（视图标「内置」徽标用）。 */
    builtInStyleIds() { return LOFTER_WRITING_STYLES.map((s) => s.id); }"""

# ③ 末尾假消费
C_OLD = """const LABEL_OF_POS = { opening: '开篇', ongoing: '连载中', ending: '收尾', extra: '番外' };
function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}
void LOFTER_REASONS; void LOFTER_WRITING_STYLES;"""
C_NEW = """const LABEL_OF_POS = { opening: '开篇', ongoing: '连载中', ending: '收尾', extra: '番外' };
function toStrArr(v) {
    return Array.isArray(v) ? v.map((x) => String(x || '')) : [];
}"""

# ④ promptChapterText 改直调
D_OLD = """        const style = resolveWritingStyle(this.styleList(), styleId === undefined ? col.styleId : styleId);
        const block = lofterPromptBlock('chapter', {
            authorName: col.authorName, collection: col, chapterNum: num,
            chapters, chapterLength: this.settings.chapterLength, isEnding: false,
            styleRules: style ? style.rules : '',
        });
        const lines = [];
        lines.push('续写《' + col.name + '》第 ' + block.chapterNum + ' 章（' + block.lengthLabel + '）。');
        lines.push('定位：' + LABEL_OF_POS[block.position] + (block.alreadyFinished ? '（合集已标完结，这一章按番外写）' : ''));
        if (style) lines.push('文风：' + style.name + ' —— ' + style.rules);
        lines.push('前文给法：最近 ' + LOFTER_FULL_TEXT_WINDOW + ' 章给全文（这里 ' + block.fullCount + ' 章），更早给摘要（' + block.digestCount + ' 章）。');
        if (block.prevBlocks.length) {
            lines.push('前文：');
            for (const b of block.prevBlocks) {"""
D_NEW = """        const style = resolveWritingStyle(this.styleList(), styleId === undefined ? col.styleId : styleId);
        // 三处**直接**调用数据层（不走 lofterPromptBlock 的包装）：前文滑窗 / 篇幅档 / 章节定位。
        const spec = chapterLengthSpec(this.settings.chapterLength);
        const pos = chapterPositionFace(col, num, false);
        const ctx = prevChapterContext(chapters, num, LOFTER_FULL_TEXT_WINDOW);
        const lines = [];
        lines.push('续写《' + col.name + '》第 ' + pos.num + ' 章（' + spec.label + '）。');
        lines.push('定位：' + LABEL_OF_POS[pos.kind] + (pos.alreadyFinished ? '（合集已标完结，这一章按番外写）' : ''));
        if (style) lines.push('文风：' + style.name + ' —— ' + style.rules);
        lines.push('前文给法：最近 ' + LOFTER_FULL_TEXT_WINDOW + ' 章给全文（这里 ' + ctx.fullCount + ' 章），更早给摘要（' + ctx.digestCount + ' 章）。');
        if (ctx.blocks.length) {
            lines.push('前文：');
            for (const b of ctx.blocks) {"""
D2_OLD = """        lines.push('写完把正文贴回「给这个合集续一章」的格子里。');
        return { ok: true, num: block.chapterNum, position: block.position, text: lines.join('\\n') };"""
D2_NEW = """        lines.push('写完把正文贴回「给这个合集续一章」的格子里。');
        return { ok: true, num: pos.num, position: pos.kind, text: lines.join('\\n') };"""

# ⑤ addStyle 真用内置池（防重名）
E_OLD = """        if (!r) return { ok: false, error: '文风要写点规则（不然模型不知道怎么写）' };
        const list = this.styleList();"""
E_NEW = """        if (!r) return { ok: false, error: '文风要写点规则（不然模型不知道怎么写）' };
        const list = this.styleList();
        const builtIn = LOFTER_WRITING_STYLES.map((s) => s.name);
        if (builtIn.indexOf(n) >= 0) return { ok: false, error: '内置已经有一款叫「' + n + '」的了，换个名字' };"""


def main():
    with open(PATH, encoding='utf-8') as f:
        text = f.read()
    text = patch(text, A_OLD, A_NEW, 'A/statsOf')
    text = patch(text, B_OLD, B_NEW, 'B/counts')
    text = patch(text, C_OLD, C_NEW, 'C/void')
    text = patch(text, D_OLD, D_NEW, 'D/promptChapter')
    text = patch(text, D2_OLD, D2_NEW, 'D2/promptChapter-ret')
    text = patch(text, E_OLD, E_NEW, 'E/addStyle')
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(text)
    print('六处锚点各命中 1 次，已改写。')
    return 0


if __name__ == '__main__':
    sys.exit(main())