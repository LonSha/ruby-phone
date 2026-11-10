import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const method = JSON.parse(fs.readFileSync('scripts/dead-method-baseline.json', 'utf8'));
const bind = JSON.parse(fs.readFileSync('scripts/bind-dead-baseline.json', 'utf8'));

test('dead surface baseline has explicit, non-empty triage evidence', () => {
    /* [交棒改写：条目数不是不变量] 原三条是等值锚（334 / 7 / 327）。本版接线 18 引擎、
     *   又用工厂函数替换直接 new，死方法账本的条目数随之从 334 涨到 391 —— 那是**正当维护
     *   造成的水位变化**，不是契约破坏。等值锚会让每一轮真实接线都翻红，逼人改测试。
     *   改为：防塌陷下限 + 两档必须覆盖全表（真正的不变量是「分类是穷尽且互斥的」）。 */
    assert.ok(method.entries.length >= 300,
        `死方法账本条数塌陷（${method.entries.length} < 300）：账本被清空等于判据失效`);
    const inst = method.entries.filter((e) => e.classInstantiated === true).length;
    const notInst = method.entries.filter((e) => e.classInstantiated === false).length;
    assert.ok(inst + notInst === method.entries.length,
        `classInstantiated 两档必须覆盖全表（true=${inst} + false=${notInst} ≠ ${method.entries.length}）`);
    assert.ok(notInst > 0, '未实例化档不得为空（否则等于宣布全部接线完成）');
    /* [交棒改写：条目数不是不变量] 原文把本账本条数钉成等值锚，于是「真的补上接线、
     *   把复活项从账本里清掉」这一正确处理会让判据翻红 —— 判据把一个会随正当维护
     *   变化的水位当成了契约。这与仓内既定口径相悖（条目数是叙事/水位体量，不是不变量）。
     *   改为**防塌陷下限**：不许变成空账本，也不许一轮就掉到底（掉超过一条要显式说明）。
     *   真正要守的不变量仍在下面：每条必须带 evidence，name-clash 必须带 refs。 */
    assert.ok(bind.entries.length >= 57,
        `绑定级账本条数塌陷（${bind.entries.length} < 57）：空账本等于没判过，整批消失等于覆盖被抹掉`);
    for (const entry of bind.entries) {
        assert.ok(entry.evidence, `${entry.file}:${entry.name} lacks evidence`);
        if (entry.evidence === 'name-clash') assert.ok(Array.isArray(entry.refs) && entry.refs.length > 0, `${entry.file}:${entry.name} lacks clash refs`);
    }
});

test('dead surface policy does not treat test-only calls as product consumption', () => {
    assert.match(method.rule, /只判增量/);
    assert.match(bind.rule, /新增项必须显式登记理由/);
});