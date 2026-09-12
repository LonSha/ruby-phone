/* tarot App 回归测试 */
import assert from 'node:assert';
import { MAJOR_ARCANA, buildFullDeck, SPREADS, drawCards, buildTarotInjection } from '../apps/tarot/tarot-data.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); } }

console.log('== 塔罗数据层 ==');
t('大阿卡那 22 张', () => {
    assert.strictEqual(MAJOR_ARCANA.length, 22);
});
t('全套 78 张 (22 大 + 56 小)', () => {
    const deck = buildFullDeck();
    assert.strictEqual(deck.length, 78);
    const major = deck.filter(c => c.major).length;
    assert.strictEqual(major, 22);
    assert.strictEqual(deck.length - major, 56);
    // key 唯一
    const keys = new Set(deck.map(c => c.key));
    assert.strictEqual(keys.size, 78, '牌 key 必须唯一');
});
t('5 种牌阵齐全', () => {
    assert.deepStrictEqual(Object.keys(SPREADS).sort(), ['cross', 'heart', 'pyramid', 'single', 'tri']);
});
t('抽牌: 数量 = 牌阵位数, 不重复', () => {
    const draw = drawCards('tri');
    assert.strictEqual(draw.cards.length, 3);
    const keys = draw.cards.map(c => c.key);
    assert.strictEqual(new Set(keys).size, 3, '一张牌阵不重复');
    assert.ok(draw.spread.name.includes('三张'));
});
t('抽牌: 凯尔特十字 10 张', () => {
    const draw = drawCards('cross');
    assert.strictEqual(draw.cards.length, 10);
});
t('抽牌: 可逆位有 up/down 且 reversed 布尔', () => {
    const draw = drawCards('single');
    const c = draw.cards[0];
    assert.strictEqual(typeof c.reversed, 'boolean');
    assert.ok(c.up && c.down, '正/逆关键词都存在');
    assert.ok(c.position.label.length > 0);
});
t('buildTarotInjection 生成含牌名与正逆位的协议', () => {
    const draw = drawCards('tri');
    const inj = buildTarotInjection(draw);
    assert.ok(inj.includes(draw.spread.name), '含牌阵名');
    assert.ok(inj.includes(draw.cards[0].name), '含牌名');
    assert.ok(/正位|逆位/.test(inj), '含正逆位标记');
    assert.ok(inj.includes('解读'), '含解读指引');
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);