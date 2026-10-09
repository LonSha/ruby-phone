# -*- coding: utf-8 -*-
"""v3.80.0 修正 R4：
  ① 【真缺陷】apps/memory/memory-data.js — 吸块动作被放在「正文清洗后为空即 return」**之后**：
     整楼只有记忆块的回复（正文确实为空）会在吸块之前早退 ⇒ 块永远进不了桶。
     修法：吸块提到空正文门之前。
  ② 【判据夹具错】v3800 B2 的跨句夹具其实**没有** 4 字以上连续重合段（老槐树=3 字），
     改用实测有 6 字重合的一对。
  ③ 【判据夹具错】v3800 D2 用 '字'.repeat(3000) 造长文本 —— 窗口去重后只剩 1 个窗，
     根本不会截断。改用互不相同的字符序列。
  ④ R3-9（C1 键面对比）——R3 在 R3-8 处误判锚点后中止，这条补上。
"""
import io, os, sys

R = '/home/user/ruby-phone'
os.chdir(R)

PLAN = [
    # ① 真缺陷：吸块时序
    ('apps/memory/memory-data.js',
     "        let block = null;\n"
     "        try { block = parseMemoryBlock(String(text || '')); } catch (_e) { block = null; }\n"
     "        this.pendingMemoryBlock = (block && block.present) ? block : null;\n"
     "\n"
     "        let content = String(text || '');\n"
     "        // [芋圆] 采集前清洗: 剔除 horae 等插件注入的状态块/HTML/成对块/裸K=V行, 避免把系统状态当记忆采进去\n"
     "        try { content = cleanFloorForSummary(content); } catch (e) { /* 清洗失败保留原文 */ }\n"
     "        content = content.replace(/\\s+/g, ' ').trim();\n"
     "        if (!content) return null;\n"
     "\n"
     "        if (block && block.present && !block.empty && block.items.length) {\n"
     "            try { this._absorbMemoryBlock(block, role, meta); } catch (_e) { /* 解析出的块坏了不阻断采集 */ }\n"
     "        }\n",
     "        let block = null;\n"
     "        try { block = parseMemoryBlock(String(text || '')); } catch (_e) { block = null; }\n"
     "        this.pendingMemoryBlock = (block && block.present) ? block : null;\n"
     "\n"
     "        let content = String(text || '');\n"
     "        // [芋圆] 采集前清洗: 剔除 horae 等插件注入的状态块/HTML/成对块/裸K=V行, 避免把系统状态当记忆采进去\n"
     "        try { content = cleanFloorForSummary(content); } catch (e) { /* 清洗失败保留原文 */ }\n"
     "        content = content.replace(/\\s+/g, ' ').trim();\n"
     "\n"
     "        /* 吸块必须在「正文为空」那道门**之前**：整楼只有记忆块的回复，清洗后正文确实为空 ——\n"
     "         *   若先过门再吸块，这种回复会早退，块永远进不了桶\n"
     "         *   （实测量到：只写块的那一楼 record 返回 null，pendingMemoryBlock 有读数而桶是空的）。 */\n"
     "        if (block && block.present && !block.empty && block.items.length) {\n"
     "            try { this._absorbMemoryBlock(block, role, meta); } catch (_e) { /* 解析出的块坏了不阻断采集 */ }\n"
     "        }\n"
     "        if (!content) return null;\n",
     'R4-1 吸块时序（真缺陷）'),

    # ② B2 夹具
    ('tests/system-v3800.test.mjs',
     "function jOverlapCrossPhrase(m) {\n"
     "    const r = m.overlapScore('城西的老槐树', '她记得老槐树下避雨的那一夜');\n"
     "    if (!(r.score > 0)) return { ok: false, why: '跨句共享的字窗被读成零相关' };\n"
     "    if (!r.phrases.length) return { ok: false, why: '没有识别出连续长重合段（长窗面失效）' };\n"
     "    /* 长窗面直接对 phraseHits 断言：整体分是加权和，拿它当长窗的证据会被别的窗掩护。 */\n"
     "    if (!m.phraseHits('在老槐树下避雨', '她记得在老槐树下避雨的那一夜').length) {\n"
     "        return { ok: false, why: '连续 4 字以上的重合段没被识别（长窗面失效）' };\n"
     "    }\n"
     "    return { ok: true, why: '' };\n"
     "}\n",
     "function jOverlapCrossPhrase(m) {\n"
     "    /* 夹具刻意用「共享 6 字连续段」的一对（'在老槐树下避雨'）：\n"
     "     *  初版夹具写成 ('城西的老槐树', '她记得老槐树下避雨的那一夜') —— 两者最长只共 3 字\n"
     "     *  （'老槐树'），长窗面本来就该没命中。判据夹具错会把好代码逼着改坏。 */\n"
     "    const r = m.overlapScore('在老槐树下避雨', '她记得在老槐树下避雨的那一夜');\n"
     "    if (!(r.score > 0)) return { ok: false, why: '跨句共享的字窗被读成零相关' };\n"
     "    if (!r.phrases.length) return { ok: false, why: '没有识别出连续长重合段（长窗面失效）' };\n"
     "    if (m.phraseHits('在老槐树下避雨', '她记得在老槐树下避雨的那一夜').length !== 1) {\n"
     "        return { ok: false, why: '连续 4 字以上的重合段没被识别（长窗面失效）' };\n"
     "    }\n"
     "    return { ok: true, why: '' };\n"
     "}\n",
     'R4-2 B2 夹具'),

    # ③ D2 夹具
    ('tests/system-v3800.test.mjs',
     "function jOverlapBounded(m) {\n"
     "    const r = m.windowsOf('字'.repeat(3000));\n",
     "function jOverlapBounded(m) {\n"
     "    /* 文本必须**互不相同**：重复字会被窗口去重收成一个窗，那样永远触不到上界\n"
     "     *  （初版夹具用 '字'.repeat(3000)，实测 wins=1 —— 判据自己把自己测成了假绿）。 */\n"
     "    let long = '';\n"
     "    for (let i = 0; i < 3000; i += 1) long += String.fromCharCode(0x4e00 + i);\n"
     "    const r = m.windowsOf(long);\n",
     'R4-3 D2 夹具'),

    # ④ R3-9 补上
    ('tests/system-v3800.test.mjs',
     "    assert.deepEqual(Object.keys(empty).sort(), Object.keys(r).sort(), '读出面结构必须恒定');\n",
     "    /* 只比**键面**：priorityPlan 是「空形 null / 有读数对象」的两态，值不同不是结构漂移。\n"
     "     *  键面恒定这条仍然成立（消费方不必判 undefined）。 */\n"
     "    const ks = (o) => Object.keys(o).sort();\n"
     "    assert.deepEqual(ks(empty), ks(r), '读出面键面必须恒定');\n"
     "    assert.equal(empty.priorityPlan, null, '空形的计划面必须是 null 而不是缺席');\n",
     'R4-4 C1 键面对比'),
]


def main():
    for rel, anchor, new, label in PLAN:
        src = io.open(rel, encoding='utf-8').read()
        n = src.count(anchor)
        if n != 1:
            print('ABORT [%s] %s: 锚点命中 %d 次（要求 1）' % (rel, label, n))
            return 1
        io.open(rel, 'w', encoding='utf-8').write(src.replace(anchor, new, 1))
        print('ok [%s] %s' % (rel, label))
    print('--- R4 applied ---')
    return 0


sys.exit(main())