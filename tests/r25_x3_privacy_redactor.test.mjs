/**
 * r25_x3_privacy_redactor.test.mjs — R25-X3 敏感信息遮蔽
 *
 * 【咬点】
 *   1. 遮蔽后**原值不可反查**（不是 138****8000 这种保留首尾的遮法）；
 *   2. **宁可不遮，也不误伤**：年份、13 位时间戳、不带 ¥ 的数字不许动；
 *   3. 幂等（遮过的再遮不变）与确定性（同输入同输出）；
 *   4. 规则可编辑（names / rules 白名单），且计数可核；
 *   5. 装配点自检：真接在截图出口上，不是只躺在 config 里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    REDACT_RULE_IDS,
    NAME_TOKEN,
    redact,
    redactReceipt
} from '../config/privacy-redactor.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('X3-1 手机号：遮成 ‹电话›，且原号搜不回来', () => {
    const r = redact('我的号是 13800138000，随时打');
    assert.equal(r.text, '我的号是 ‹电话›，随时打');
    assert.equal(r.total, 1);
    assert.equal(r.hits[0].rule, 'phone');
    assert.ok(!r.text.includes('13800138000'));
    assert.ok(!r.text.includes('8000'), '不许保留尾号（保留即可搜）');
});

test('X3-2 金额：带 ¥/￥ 才遮，逗号与小数一起吃掉', () => {
    const a = redact('转了 ¥1,234.50 过去');
    assert.equal(a.text, '转了 ‹金额› 过去');
    const b = redact('￥88 红包');
    assert.equal(b.text, '‹金额› 红包');
    /* 负控制：不带货币符号的数字不是「金额」，不许遮（否则金额读数会被遮成一片） */
    const c = redact('共 1,234.50 元');
    assert.equal(c.total, 0);
    assert.equal(c.text, '共 1,234.50 元');
});

test('X3-3 证件号：18 位（末位 X）遮成 ‹证件›，不与手机号规则打架', () => {
    const r = redact('身份证 11010519491231002X 已上传');
    assert.equal(r.text, '身份证 ‹证件› 已上传');
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].rule, 'idcard');
});

test('X3-4 邮箱：整串遮蔽', () => {
    const r = redact('写到 someone.here+tag@example.com');
    assert.equal(r.text, '写到 ‹邮箱›');
    assert.ok(!r.text.includes('example.com'));
});

test('X3-5 联系人名单（规则可编辑）：命中即整串遮，名单外的人不误伤', () => {
    const r = redact('张三和李四吃饭，王五没来', { names: ['张三', '李四'] });
    assert.equal(r.text, NAME_TOKEN + '和' + NAME_TOKEN + '吃饭，王五没来');
    assert.equal(r.total, 2);
    /* 另一面（刻意的取舍，写在模块注释里）：名单内名字的子串命中会多遮一个字，
     *  宁可多遮也不要漏真名。这里把它当作**已知代价**钉住，而不是假装没有。 */
    const sub = redact('张三丰没来', { names: ['张三'] });
    assert.equal(sub.text, NAME_TOKEN + '丰没来');
    /* 最长优先：名单里同时有长短名时，长的先遮，短的不会把长的咬掉一半。 */
    const longest = redact('张三丰没来', { names: ['张三', '张三丰'] });
    assert.equal(longest.text, NAME_TOKEN + '没来');
    assert.equal(longest.total, 1);
});

test('X3-6 负控制：年份 / 13 位时间戳 / 普通 11 位非手机号前缀都不许误伤', () => {
    assert.equal(redact('2026-11-18 的记录').total, 0, '日期不许遮');
    assert.equal(redact('ts=1700000000000').total, 0, '13 位时间戳不许遮');
    assert.equal(redact('订单号 12000000000').total, 0, '12 开头不是手机号段');
});

test('X3-7 幂等：遮过的文本再遮一遍逐字节不变', () => {
    const once = redact('打 13800138000 转 ¥1,234.50 给 11010519491231002X');
    const twice = redact(once.text);
    assert.equal(twice.text, once.text);
    assert.equal(twice.total, 0);
});

test('X3-8 确定性：同输入两次结果逐字节相同', () => {
    const src = 'a 13912345678 b ¥9.9 c x@y.com';
    assert.equal(redact(src).text, redact(src).text);
});

test('X3-9 任意形状输入都不崩（null / 数字 / 对象）', () => {
    for (const v of [null, undefined, 123, {}, []]) {
        const r = redact(v);
        assert.equal(r.text, '');
        assert.equal(r.total, 0);
    }
    assert.ok(redact('13800138000').total > 0);
    assert.equal(redact('干净的一句话').total, 0);
});

test('X3-10 规则白名单：只勾 phone 时金额原样保留', () => {
    const r = redact('13800138000 转 ¥100', { rules: ['phone'] });
    assert.equal(r.text, '‹电话› 转 ¥100');
    assert.deepEqual(r.rules, ['phone']);
    assert.deepEqual(REDACT_RULE_IDS.slice().sort(), ['amount', 'email', 'idcard', 'phone']);
});

test('X3-11 多行逐个遮蔽：长度不变、总数可核、回执点名类别', () => {
    const lines = ['a 13800138000', 'b 干净', '¥5'].map((x) => redact(x));
    assert.equal(lines.length, 3);
    assert.equal(lines.reduce((a, r) => a + r.total, 0), 2);
    assert.equal(lines[1].text, 'b 干净');
    const receipt = redactReceipt(redact('13800138000 与 ¥5'));
    assert.ok(receipt.includes('电话 1 处'));
    assert.ok(receipt.includes('金额 1 处'));
    assert.ok(redactReceipt(redact('干净')).includes('没有命中'));
});

test('X3-12 装配点自检：截图出口真的先脱敏再出图', () => {
    const snap = fs.readFileSync(path.join(root, 'apps/wechat/chat-snapshot.js'), 'utf8');
    assert.ok(snap.includes("from '../../config/privacy-redactor.js'"), '截图引擎必须 import 脱敏内核');
    assert.ok(snap.includes('createTreeWalker'), '必须在克隆树上遍历文本节点');
    assert.ok(snap.includes('redact('), '必须真的调用脱敏');
    /* 顺序：脱敏必须在 html2canvas 之前（否则先出图再遮，等于没遮）。 */
    const iRedact = snap.indexOf('redact(');
    const iShot = snap.lastIndexOf('html2canvas(');
    assert.ok(iRedact > 0 && iShot > 0 && iRedact < iShot, '脱敏必须发生在出图之前');
    assert.ok(snap.includes('_redactReport'), '截图后要给用户脱敏回执');
});