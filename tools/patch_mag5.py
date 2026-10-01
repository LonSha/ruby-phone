#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_mag5.py — [v3.36.0] 第二轮：修判据侧 8 处（产品侧已由 patch_mag4 修完 3 处）。

  J1 B2 口径错：空正文 `split('\\n')` 得 `['']` ⇒ 产一个 `gap` 块（源也这样产
     `magazine-qa-gap`）。判据写成「空正文不产块」不符实现。改成「只有 gap、无实质块」。
  J2 C5 判据把**动态拼接的片段**当成类名。修法：抓 `class="..."` 前先把拼接段抹掉。
  J3 D4 判据过宽：`SillyTavern` 在 `_ctxNames()` 里是**本仓既有的安全取法**
     （`typeof` 判断 + try/catch，pixiv / lofter 同款），不是「碰宿主对象」。
     判据改成禁 `AppState` / `Utils.saveData` / `pushMessage` / `chat.history`。
  J4 I1 加一条**能暴露差异**的判据：「给定期号必须被尊重」（vol:9 留 9；破坏成
     `index + 1` 后变 1）。原来的两条断言在 index=0 时与破坏行为等价（装饰断言）。
  J5 I2 加 nextVol 判据（判据面此前没盖住 `nextVol`）。
  J6 I6 破坏换成**可观测的等价形态**：白名单与解析器**脱节**（表里 `question` 写成
     `question_typo`）⇒ 产出块不在白名单内。判据改成「每个产出块都必须在白名单内」。
  J7 I7 破坏改成**去掉 export**（内部仍可用 ⇒ 不崩 ReferenceError，判据按
     `Array.isArray` 如实报）。
  J8 I9 锚点失配：App 写的是 `nextVol(this.articles)`。
  J9 I10 判据窗口过大：取到**函数体结束**（原来 400 字里含 render() 的 probe()）。
  J10 I11 判据数错了：只查「含 `[MAGAZINE_TIME_UNITS[`」，破坏一行后其余四行仍在。
     改成**数出现次数 ≥ 5**。
"""
import io
import sys

T = 'tests/system-v3360.test.mjs'
E = []

# ── J1 B2 ──
E.append((
    "test('B2 「没认出来」与「正文是空的」**不许同形**（源十套里九套直接输出空 div）', () => {\n"
    "    const empty = DAT.parseArticleBody('chart', '');\n"
    "    assert.equal(empty.blocks.length, 0, '空正文不产块');\n"
    "    assert.equal(empty.unknown, 0, '**空正文不算「没认出来」** —— 两个 0 的意义完全不同');",
    "test('B2 「没认出来」与「正文是空的」**不许同形**（源十套里九套直接输出空 div）', () => {\n"
    "    const empty = DAT.parseArticleBody('chart', '');\n"
    "    /* ★ 口径：空正文按行 split 得 `['']` ⇒ 产一个 `gap` 块（源也这样产一个\n"
    "     *   `magazine-qa-gap`）—— 判据守的是「**没有实质块**」，不是「一个块都没有」。 */\n"
    "    assert.ok(empty.blocks.every((b) => b.kind === 'gap'),\n"
    "        '空正文不许产实质块（只允许空行占位）：' + JSON.stringify(empty.blocks));\n"
    "    assert.equal(empty.unknown, 0, '**空正文不算「没认出来」** —— 两个 0 的意义完全不同');",
    'J1 B2 空正文口径'))

# ── J2 C5 ──
E.append((
    "    const cls = new Set();\n"
    "    const re = /class=\"([^\"]+)\"/g;\n"
    "    let m;\n"
    "    while ((m = re.exec(view)) !== null) {\n"
    "        for (const c of m[1].split(/\\s+/)) {\n"
    "            /* 动态拼接的类名（含 + 的片段）在字符串里是前缀形，逐段取；过滤空与状态类。 */\n"
    "            if (c && !c.includes('+') && !c.startsWith('$')) cls.add(c);\n"
    "        }\n"
    "    }",
    "    const cls = new Set();\n"
    "    /* ★ 先抹掉**拼接段**：`class=\"mgz-face mgz-face-' + meta.tone + '\"` 这种写法里，\n"
    "     *   正则会把 `mgz-face-'` / `meta.tone` 之类**片段**当成类名（假红）。\n"
    "     *   拼接段一律以 `' + ` 起、以 ` + '` 止 —— 整段抹成空格再抓。 */\n"
    "    const flat = view.replace(/'\\s*\\+[\\s\\S]*?\\+\\s*'/g, ' ');\n"
    "    const re = /class=\"([^\"]+)\"/g;\n"
    "    let m;\n"
    "    while ((m = re.exec(flat)) !== null) {\n"
    "        for (const c of m[1].split(/\\s+/)) {\n"
    "            if (c && !c.includes('+') && !c.startsWith('$')) cls.add(c);\n"
    "        }\n"
    "    }",
    'J2 C5 抹拼接段'))

# ── J3 D4 ──
E.append((
    "test('D4 不写宿主楼层、不发请求：App 只有 storage.get/set 两个出口', () => {\n"
    "    const code = stripComments(read(MG_APP));\n"
    "    assert.equal(code.includes('pushMessage'), false, '不许替宿主写楼层');\n"
    "    assert.equal(code.includes('SillyTavern.'), false, '不许调宿主 API（读名字走 _ctxNames 的安全取法）');\n"
    "});",
    "test('D4 不写宿主楼层、不整块回写：App 只有 storage.get/set 两个出口', () => {\n"
    "    const code = stripComments(read(MG_APP));\n"
    "    for (const bad of ['pushMessage', 'AppState', 'Utils.saveData', 'chat.history', 'saveChat']) {\n"
    "        assert.equal(code.includes(bad), false, '不许出现：' + bad);\n"
    "    }\n"
    "    /* ★ `SillyTavern.getContext` 在 `_ctxNames()` 里是**本仓既有的安全取法**\n"
    "     *   （`typeof` 判断 + try/catch，pixiv / lofter / date 同款）：只读宿主称呼、\n"
    "     *   拿不到就用中性词。判据不许把它当「碰宿主对象」—— 判据过宽就是判据写歪。 */\n"
    "    assert.ok(code.includes('_ctxNames'), '宿主称呼必须走那一个安全取法');\n"
    "    assert.equal(/c\\s*=\\s*w\\.SillyTavern\\.getContext\\(\\)/.test(code), false,\n"
    "        '不许绕过 typeof 判断直接取宿主对象');\n"
    "});",
    'J3 D4 判据收窄到真禁项'))

# ── J4/J5/I1/I2 判据 + 破坏 ──
E.append((
    "    /* ② 缺省期号必须是「下标 + 1」而不是「下标本身」（0 是坏期号） */\n"
    "    const na = mod.normalizeArticle({ title: 'x' }, 0);\n"
    "    if (na.vol !== 1) bad.push('default-vol-wrong');\n"
    "    /* ③ 给定期号不许被篡改（1.9 取整成 1、-5 夹到 1） */\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: 1.9 }, 0).vol !== 1) bad.push('given-vol-coerced');\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: -5 }, 0).vol !== 1) bad.push('given-vol-clamped');",
    "    /* ② 缺省期号必须是「下标 + 1」而不是「下标本身」（0 是坏期号） */\n"
    "    const na = mod.normalizeArticle({ title: 'x' }, 0);\n"
    "    if (na.vol !== 1) bad.push('default-vol-wrong');\n"
    "    /* ③ 给定期号不许被篡改（1.9 取整成 1、-5 夹到 1） */\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: 1.9 }, 0).vol !== 1) bad.push('given-vol-coerced');\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: -5 }, 0).vol !== 1) bad.push('given-vol-clamped');\n"
    "    /* ③b **给定期号必须被尊重** —— 这一条才是「期号是事实不是位置」的正判据：\n"
    "     *    上面两条在 `index = 0` 时与「位置反查」的坏实现**行为等价**（装饰断言）。 */\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: 9 }, 0).vol !== 9) bad.push('given-vol-ignored');\n"
    "    if (mod.normalizeArticle({ title: 'x', vol: 9 }, 3).vol !== 9) bad.push('given-vol-ignored');\n"
    "    /* ③c **期号必须取「现有最大 + 1」**（不是「长度 + 1」—— 删过中间篇就会撞号）。 */\n"
    "    if (mod.nextVol([{ vol: 1 }, { vol: 3 }]) !== 4) bad.push('next-vol-wrong');\n"
    "    if (mod.nextVol([{ vol: 1 }, { vol: 2 }]) !== 3) bad.push('next-vol-wrong');\n"
    "    if (mod.nextVol([]) !== 1) bad.push('next-vol-wrong');",
    'J4/J5 加两条真判据'))

E.append((
    "    ['I1 破坏「期号是事实不是位置」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['default-vol-wrong', 'given-vol-coerced', 'given-vol-clamped']],\n"
    "    ['I2 破坏「缺省期号走下标 + 1」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, []],",
    "    ['I1 破坏「期号是事实不是位置」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['given-vol-ignored']],\n"
    "    ['I2 破坏「期号取最大 + 1」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['next-vol-wrong']],",
    'J4/J5 NEG 期望集同步'))

# ── J6 I6 ──
E.append((
    "    /* ⑥ 块 kind 白名单校验被摘掉（产出没人认识的块也静默通过） */\n"
    "    d6: [MG_DATA,\n"
    "        '    for (const b of blocks) {\\n        if (!MAGAZINE_BLOCK_KINDS.includes(b.kind)) stray++;',\n"
    "        '    for (const b of blocks) {\\n        if (false) stray++;'],",
    "    /* ⑥ 白名单与解析器**脱节**（表里把 question 写错名 ⇒ 产出块不在白名单内）。\n"
    "     *   ★ 为什么不破坏「校验那一行」：产品从不产白名单外的块 ⇒ 摘掉校验与不摘掉\n"
    "     *     **行为完全相同**（不可观测的破坏 = 装饰破坏）。要让判据有判别力，\n"
    "     *     必须破坏**表本身**（真源），判据才看得见。 */\n"
    "    d6: [MG_DATA,\n"
    "        \"    'question',   // Q&A 里的提问行（源按 ―― / —— 行首分流）\",\n"
    "        \"    'question_typo',   // Q&A 里的提问行（源按 ―― / —— 行首分流）\"],",
    'J6 I6 破坏换成表脱节'))

E.append((
    "    /* ⑥ 块 kind 白名单必须真在校验 */\n"
    "    const ok = mod.parseArticleBody('seiyuu', '―― 问\\n甲：答');\n"
    "    if (ok.stray !== 0) bad.push('stray-nonzero-on-clean-input');",
    "    /* ⑥ 产出的每个块都必须在白名单内（表脱节 ⇒ 立刻暴露） */\n"
    "    const ok = mod.parseArticleBody('seiyuu', '―― 问\\n甲：答');\n"
    "    if (ok.stray !== 0) bad.push('stray-nonzero-on-clean-input');\n"
    "    if (ok.blocks.some((b) => !mod.MAGAZINE_BLOCK_KINDS.includes(b.kind))) bad.push('block-outside-whitelist');\n"
    "    const chartB = mod.parseArticleBody('chart', '◆ A → B：关系\\n※ 按');\n"
    "    if (chartB.blocks.some((b) => !mod.MAGAZINE_BLOCK_KINDS.includes(b.kind))) bad.push('block-outside-whitelist');",
    'J6 判据加白名单成员检查'))

# ── J7 I7 ──
E.append((
    "    /* ⑦ 时间单位表被摘掉（视图的人话表键面失去真源） */\n"
    "    d7: [MG_DATA,\n"
    "        'export const MAGAZINE_TIME_UNITS = [',\n"
    "        'const MAGAZINE_TIME_UNITS_UNUSED = ['],",
    "    /* ⑦ 时间单位表**去掉 export**（内部仍可用 ⇒ 不崩 ReferenceError；对外消失）。\n"
    "     *   ★ 首版破坏写成「改名」，于是 `timeAgoFace` 里未定义 ⇒ 判据崩在\n"
    "     *     ReferenceError 上 —— 报红的原因不是判据响、是模块坏了（假红）。 */\n"
    "    d7: [MG_DATA,\n"
    "        'export const MAGAZINE_TIME_UNITS = [',\n"
    "        'const MAGAZINE_TIME_UNITS = ['],",
    'J7 I7 破坏改成去 export'))

# ── J8 I9 ──
E.append((
    "    /* ⑨ App：登记时不再算期号（走缺省 ⇒ 撞号） */\n"
    "    a2: [MG_APP,\n"
    "        '        const vol = nextVol(arr);',\n"
    "        '        const vol = arr.length + 1;'],",
    "    /* ⑨ App：登记时不再算期号（走缺省 ⇒ 撞号） */\n"
    "    a2: [MG_APP,\n"
    "        '        const vol = nextVol(this.articles);',\n"
    "        '        const vol = this.articles.length + 1;'],",
    'J8 I9 锚点同步'))
E.append((
    "const appVolProblems = (src) => {\n"
    "    const bad = [];\n"
    "    if (!src.includes('nextVol(arr)')) bad.push('next-vol-not-used');\n"
    "    return bad;\n"
    "};",
    "const appVolProblems = (src) => {\n"
    "    const bad = [];\n"
    "    if (!src.includes('nextVol(this.articles)')) bad.push('next-vol-not-used');\n"
    "    return bad;\n"
    "};",
    'J8 appVolProblems 同步'))

# ── J9 I10 ──
E.append((
    "const appChatProblems = (src) => {\n"
    "    const bad = [];\n"
    "    const i = src.indexOf('    onChatChanged() {');\n"
    "    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }\n"
    "    const body = src.slice(i, i + 400);\n"
    "    if (!/this\\.probe\\(\\)/.test(body)) bad.push('chat-change-no-refetch');\n"
    "    return bad;\n"
    "};",
    "const appChatProblems = (src) => {\n"
    "    const bad = [];\n"
    "    const i = src.indexOf('    onChatChanged() {');\n"
    "    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }\n"
    "    /* ★ 窗口必须取到**函数体结束**（下一个顶格 `    }`）：首版取固定 400 字，\n"
    "     *   窗口里落进了紧随其后的 `render()` 的 `this.probe()` ⇒ 破坏后照样为真\n"
    "     *   （判据面没盖住破坏面）。 */\n"
    "    const rest = src.slice(i + 24);\n"
    "    const endRel = rest.indexOf('\\n    }\\n');\n"
    "    const body = endRel < 0 ? rest : rest.slice(0, endRel);\n"
    "    if (!/this\\.probe\\(\\)/.test(body)) bad.push('chat-change-no-refetch');\n"
    "    return bad;\n"
    "};",
    'J9 appChatProblems 窗口收到函数体结束'))

# ── J10 I11 ──
E.append((
    "const viewDeadProblems = (src) => {\n"
    "    const bad = [];\n"
    "    if (!src.includes('[MAGAZINE_TIME_UNITS[')) bad.push('time-keys-handwritten');\n"
    "    if (/findIndex\\(/.test(src)) bad.push('vol-by-position-back');\n"
    "    return bad;\n"
    "};",
    "const viewDeadProblems = (src) => {\n"
    "    const bad = [];\n"
    "    /* ★ 必须**数次数**：AGO_TEXT 有五个人话键 ⇒ 计算键必须出现 ≥ 5 次。\n"
    "     *   首版只查「文件里含」，破坏掉一行后其余四行仍在 ⇒ 照样为真（判据数错）。 */\n"
    "    const hits = src.split('[MAGAZINE_TIME_UNITS[').length - 1;\n"
    "    if (hits < 5) bad.push('time-keys-handwritten');\n"
    "    if (/findIndex\\(/.test(src)) bad.push('vol-by-position-back');\n"
    "    return bad;\n"
    "};",
    'J10 viewDeadProblems 数次数'))


def main(write):
    text = io.open(T, encoding='utf-8').read()
    bad = 0
    for old, new, label in E:
        n = text.count(old)
        if n != 1:
            print('FAIL %s: 锚点命中 %d 次（应为 1）' % (label, n))
            bad += 1
            continue
        text = text.replace(old, new, 1)
        print('OK   %s' % label)
    if bad:
        print('失配 %d 处' % bad)
        sys.exit(1)
    if write:
        io.open(T, 'w', encoding='utf-8').write(text)
        print('已落盘')
    else:
        print('（dry-run，未落盘）')


main('--write' in sys.argv)