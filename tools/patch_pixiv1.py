# -*- coding: utf-8 -*-
"""[v3.35.0] 第一批：修 `sanitizeBody` 的实体字面量被传输链解码的问题。

现场：`create_file` 落盘时把源码里的 `"` 解码成了真字符 `"`，
于是「文本位置的引号转义」这一格**静默失效**（转义函数不再转义引号，
且没有任何报错）。同类风险适用于 `&amp;` / `&lt;` / `&gt;`。

修法：不再把实体字面量直接写进源码，改为 `ent(name)` 拼装
（`String.fromCharCode(38) + name + ';'`）—— 源码里不出现实体字面量，
传输链没有可解码的东西；语义与读数一格不变。
"""
import io
import sys

PATH = 'apps/pixiv/pixiv-data.js'
EDITS = []


def edit(old, new, label):
    EDITS.append((old, new, label))


OLD_HEAD = """export function sanitizeBody(html) {
    const src = String(html || '');
    const out = [];
    let droppedTags = 0;
    let droppedAttrs = 0;
    let i = 0;
    while (i < src.length) {
        const ch = src.charAt(i);
        if (ch !== '<') {
            // 普通文本：转义四个危险字符
            if (ch === '&') out.push('&amp;');
            else if (ch === '>') out.push('&gt;');
            else if (ch === '"') out.push('"');
            else out.push(ch);
            i += 1;
            continue;
        }"""

NEW_HEAD = """/** 实体**拼装**：源码里不写实体字面量 —— 编辑器 / 传输链会把 `"` 这类
 *  字面量解码成真字符，于是「转义引号」这一格会**静默失效**（不报错、只不转义）。
 *  用 `String.fromCharCode(38)` 拼出 `&` 再拼名字，链路上没有可解码的东西。 */
const AMP = String.fromCharCode(38);
function ent(name) { return AMP + name + ';'; }
/** 文本位置需要转义的四个字符（`<` 走标签分支，这里一并列出以便复用）。 */
const TEXT_ESCAPES = { '&': ent('amp'), '>': ent('gt'), '<': ent('lt'), '"': ent('quot') };

export function sanitizeBody(html) {
    const src = String(html || '');
    const out = [];
    let droppedTags = 0;
    let droppedAttrs = 0;
    let i = 0;
    while (i < src.length) {
        const ch = src.charAt(i);
        if (ch !== '<') {
            // 普通文本：转义危险字符（表驱动，不写字面量）
            out.push(TEXT_ESCAPES[ch] || ch);
            i += 1;
            continue;
        }"""

edit(OLD_HEAD, NEW_HEAD, 'head')
edit("        if (close < 0) { out.push('&lt;'); i += 1; continue; }",
     "        if (close < 0) { out.push(ent('lt')); i += 1; continue; }", 'unclosed')
edit("        if (!m) { out.push('&lt;'); i += 1; continue; }",
     "        if (!m) { out.push(ent('lt')); i += 1; continue; }", 'badname')
edit("            out.push('&lt;' + escapeAttrText(inner) + '&gt;');",
     "            out.push(ent('lt') + escapeAttrText(inner) + ent('gt'));", 'dropped')
edit("""function escapeAttrText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}""",
     """function escapeAttrText(s) {
    return String(s || '').split('&').join(ent('amp')).split('<').join(ent('lt')).split('>').join(ent('gt'));
}""", 'attrtext')

text = io.open(PATH, encoding='utf-8').read()
for old, new, label in EDITS:
    n = text.count(old)
    if n != 1:
        print('FAIL %s: 锚点命中 %d 次' % (label, n))
        sys.exit(1)
    text = text.replace(old, new)
io.open(PATH, 'w', encoding='utf-8').write(text)
print('全部完成')
