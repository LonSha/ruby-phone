import io

p = 'tests/system-v4460.test.mjs'
with io.open(p, 'r', encoding='utf-8') as f:
    s = f.read()

old_seg = """    /* 段头必须独立成行（本仓踩过粘连坑），且打包侧与源段逐字同源。 */
    const seg = (src) => {
        const i = src.indexOf('[v4.46.0 · R5-X6]');
        assert.ok(i >= 0, '缺本版段头');
        return src.slice(i).trim();
    };
    assert.equal(seg(bundleCssSrc), seg(appCssSrc), '★ phone.css 的本版段必须与 apps/memory/memory.css 逐字同源');"""

new_seg = """    /* 段头必须独立成行（本仓踩过粘连坑），且打包侧与源段逐字同源。
     * [v4.87.0 交棒] 提取到下一段注释（v4.48.0）前为止，防止 phone.css 追加后续段落导致 slice 尾部溢出 */
    const seg = (src) => {
        const i = src.indexOf('[v4.46.0 · R5-X6]');
        assert.ok(i >= 0, '缺本版段头');
        const rest = src.slice(i);
        const j = rest.indexOf('/* ===== [v4.');
        return (j < 0 ? rest : rest.slice(0, j)).trim();
    };
    assert.equal(seg(bundleCssSrc), seg(appCssSrc), '★ phone.css 的本版段必须与 apps/memory/memory.css 逐字同源');"""

assert old_seg in s, 'old_seg not found in v4460'
s = s.replace(old_seg, new_seg)

with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('v4460 E3 patched successfully!')