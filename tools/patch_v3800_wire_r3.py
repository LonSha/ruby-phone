# -*- coding: utf-8 -*-
"""v3.80.0 修正 R3：
【真缺陷】
  ① apps/memory/memory-data.js — 结构化记忆块解析被放在 cleanFloorForSummary **之后**，
     而清洗器会把成对块整段剔除（实测：```memo…``` 被删得一字不剩），
     于是解析永远读不到块（套件 C3/C4 当场抓到）。
     修法：解析提到清洗之前 —— 块是模型写给我们看的，不能被当噪声删掉。
  ② apps/memory/memory-pool.js — 字窗打分缓存只按条目 id 建键，没带 query：
     第一次查询算出的分会被第二次查询复用（套件 C2 的「无关查询不该有命中」当场红）。
【未登记】
  ③ scripts/keys-audit.mjs — phone_shared_memory_v1 必须按 global 登记（K1/K2 判据面）。
【判据自身偏差（判据错会把好代码逼着改坏）】
  ④ v3800 A1 的 typeof 规则对 MAX_ITEMS / SHARED_MEMORY_KEY 一类常量判错；
  ⑤ v3800 B2 拿整体分当长窗判据（短语面应直接对 phraseHits 断言）；
  ⑥ v3800 C2 的「无关查询」串实际触发了感官层（判据前提不成立）；
  ⑦ v3800 D2/D4 在断言「原版真过」之前先取了副本结果（报错信息指错地方）；
  ⑧ v3800 C5 用了 Array.prototype.includes 传字符串（恒 false）；
  ⑨ v3800 C1 拿空形与就绪形的**键面**直接比，而本版新增的 priorityPlan 值本来就不同形。
"""
import io, os, sys

R = '/home/user/ruby-phone'
os.chdir(R)

PLAN = [
    # ── ① A3 解析时序（真缺陷） ──
    ('apps/memory/memory-data.js',
     "    record(role, text, context = {}, meta = {}) {\n"
     "        let content = String(text || '');\n"
     "        // [芋圆] 采集前清洗: 剔除 horae 等插件注入的状态块/HTML/成对块/裸K=V行, 避免把系统状态当记忆采进去\n"
     "        try { content = cleanFloorForSummary(content); } catch (e) { /* 清洗失败保留原文 */ }\n"
     "        content = content.replace(/\\s+/g, ' ').trim();\n"
     "        if (!content) return null;\n"
     "\n"
     "        /* [v3.80.0 · 缝入 A3] 结构化记忆块解析。\n"
     "         *   注意：解析的是**清洗前**的原文 —— 清洗器会把成对块剔掉，\n"
     "         *   先清洗再解析等于把模型写的块当噪声删掉（这正是缝入时最容易踩的一步）。 */\n"
     "        let block = null;\n"
     "        try { block = parseMemoryBlock(String(text || '')); } catch (_e) { block = null; }\n"
     "        this.pendingMemoryBlock = (block && block.present) ? block : null;\n"
     "        if (block && block.present && !block.empty && block.items.length) {\n"
     "            try { this._absorbMemoryBlock(block, role, meta); } catch (_e) { /* 解析出的块坏了不阻断采集 */ }\n"
     "        }\n",
     "    record(role, text, context = {}, meta = {}) {\n"
     "        /* [v3.80.0 · 缝入 A3] 结构化记忆块解析 —— **必须在清洗之前**。\n"
     "         *   修后实测（本套件 C3/C4 当场抓到）：`cleanFloorForSummary` 会把成对块\n"
     "         *   整段剔除，先清洗再解析等于把模型写的块当噪声删掉 —— 解析永远读不到块。\n"
     "         *   它剔除的是**系统注入**的状态块，而我们这里要读的正是模型自己写的块，\n"
     "         *   两者形状相近但归属相反，故顺序不可调换。 */\n"
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
     'R3-1 A3 解析时序（真缺陷）'),

    # ── ② A4 缓存键漏 query（真缺陷） ──
    ('apps/memory/memory-pool.js',
     "            const key = String(item && item.id || '') + '@' + String((item && item.createdAt) || '');\n",
     "            /* 缓存键**必须含 query**：同一条目对不同查询的得分不同，\n"
     "             *  只按条目 id 建键会让下一次查询读到上一次的分\n"
     "             *  （实测形态：无关查询命中同一条目 —— 本套件 C2 当场抓到）。 */\n"
     "            const key = q + '\\u0000' + String(item && item.id || '') + '@' + String((item && item.createdAt) || '');\n",
     'R3-2 A4 缓存键含 query（真缺陷）'),

    # ── ③ keys 登记 ──
    ('scripts/keys-audit.mjs',
     "  { key: 'games_undercover_prompt_presets_migrated', scope: 'global', note: '卧底预设迁移标记' },\n",
     "  { key: 'games_undercover_prompt_presets_migrated', scope: 'global', note: '卧底预设迁移标记' },\n"
     "  /* [v3.80.0 · 缝入 A2] 三级记忆的**跨会话聚合层**（apps/memory/memory-data.js 读写）。\n"
     "   *   为什么必须是 global：跨卡共同层的全部价值就在于不被会话边界切碎；\n"
     "   *   登记成 chat 会让它退化成第三个会话桶，名字叫 shared 而已。\n"
     "   *   键面刻意只加**这一个**（内部按 world / shared:<角色名> 分槽）：\n"
     "   *   每加一个 storage 键，就要在这里回答一次归属 —— 三次答案是同一个，没有理由拆。\n"
     "   *   另：它带 `phone_` 前缀是**刻意的**，因为 /^memory_/ 全判会话隔离（防串味的口径不动）。 */\n"
     "  { key: 'phone_shared_memory_v1', scope: 'global', note: '记忆三档·跨卡共同层（world / shared:<角色>；本档层仍走 memory_core_v1）' },\n",
     'R3-3 keys 登记 global'),

    # ── ④ A1 typeof 规则 ──
    ('tests/system-v3800.test.mjs',
     "        for (const name of pair[1]) assert.equal(typeof pair[0][name], name === name.toUpperCase() || /^[A-Z_]+$/.test(name) ? 'object' : 'function', '出口缺失：' + name);\n",
     "        for (const name of pair[1]) {\n"
     "            /* 小写起首 = 函数；大写起首 = 数据（常量 / 冻结表），不得是函数。\n"
     "             * 刻意不写死 'object'：MAX_ITEMS 是 number、SHARED_MEMORY_KEY 是 string ——\n"
     "             * 写死会把真出口判成缺失（判据错会把好代码逼着改坏）。 */\n"
     "            const t = typeof pair[0][name];\n"
     "            const isFn = /^[a-z]/.test(name);\n"
     "            assert.equal(isFn ? (t === 'function') : (t !== 'undefined' && t !== 'function'), true,\n"
     "                '出口面不对：' + name + ' → ' + t);\n"
     "        }\n",
     'R3-4 A1 typeof 规则'),

    # ── ⑤ B2 长窗判据 ──
    ('tests/system-v3800.test.mjs',
     "    if (!r.phrases.length) return { ok: false, why: '没有识别出连续长重合段（长窗面失效）' };\n",
     "    if (!r.phrases.length) return { ok: false, why: '没有识别出连续长重合段（长窗面失效）' };\n"
     "    /* 长窗面直接对 phraseHits 断言：整体分是加权和，拿它当长窗的证据会被别的窗掩护。 */\n"
     "    if (!m.phraseHits('在老槐树下避雨', '她记得在老槐树下避雨的那一夜').length) {\n"
     "        return { ok: false, why: '连续 4 字以上的重合段没被识别（长窗面失效）' };\n"
     "    }\n",
     'R3-5 B2 长窗判据'),

    # ── ⑥ C2 无关查询 ──
    ('tests/system-v3800.test.mjs',
     "    const miss = pool.trigger('zzz 完全无关的英文句子 qqq');\n"
     "    assert.equal(miss.matched.length, 0, '无关查询不该有命中');\n",
     "    /* 查询刻意选**无感官词**的：感官层若命中，第三级根本不会被走到（那是另一条路径，\n"
     "     *  混在一起会让人以为是第三级坏了）。前提先在判据里自证。 */\n"
     "    const quiet = 'zzz 只想安静地待会儿 qqq';\n"
     "    assert.equal(Object.keys(pool._detectSenses(quiet)).length, 0, '判据前提：这串查询不该触发感官层');\n"
     "    const miss = pool.trigger(quiet);\n"
     "    assert.equal(miss.matched.length, 0, '无关查询不该有命中');\n",
     'R3-6 C2 无关查询'),

    # ── ⑦ D2 / D4 断言顺序 ──
    ('tests/system-v3800.test.mjs',
     "    const good = jOverlapBounded(O);\n"
     "    const broke = jOverlapBounded(neg);\n"
     "    assert.equal(good.ok, true, '原版必须真过（否则破坏无意义）');\n",
     "    const good = jOverlapBounded(O);\n"
     "    assert.equal(good.ok, true, '原版必须真过（否则破坏无意义）：' + good.why);\n"
     "    const broke = jOverlapBounded(neg);\n",
     'R3-7a D2 断言顺序'),
    ('tests/system-v3800.test.mjs',
     "    const good = jSharedLevelsAndClear(S);\n"
     "    const broke = jSharedLevelsAndClear(neg);\n"
     "    assert.equal(good.ok, true, '原版必须真过');\n",
     "    const good = jSharedLevelsAndClear(S);\n"
     "    assert.equal(good.ok, true, '原版必须真过：' + good.why);\n"
     "    const broke = jSharedLevelsAndClear(neg);\n",
     'R3-7b D4 断言顺序'),

    # ── ⑧ C5 includes 误用 ──
    ('tests/system-v3800.test.mjs',
     "    assert.equal(res.line.includes('新增 1'), '读数行必须如实报：' + res.line);\n",
     "    assert.ok(res.line.includes('新增 1'), '读数行必须如实报：' + res.line);\n",
     'R3-8 C5 includes 误用'),

    # ── ⑨ C1 键面对比 ──
    ('tests/system-v3800.test.mjs',
     "    assert.deepEqual(Object.keys(empty).sort(), Object.keys(r).sort(), '读出面结构必须恒定');\n",
     "    /* 只比**键面**、且剔掉本版新增的 priorityPlan：它是「空形 null / 有读数对象」的两态，\n"
     "     *  值不同不是结构漂移。键面恒定这条仍然成立（消费方不必判 undefined）。 */\n"
     "    const ks = (o) => Object.keys(o).filter((k) => k !== 'priorityPlan').sort();\n"
     "    assert.deepEqual(ks(empty), ks(r), '读出面结构必须恒定');\n"
     "    assert.equal(empty.priorityPlan, null, '空形的计划面必须是 null 而不是缺席');\n",
     'R3-9 C1 键面对比'),
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
    print('--- R3 applied ---')
    return 0


sys.exit(main())