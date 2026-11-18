/**
 * r25_o9_error_readable.test.mjs — R25-O9 错误可读化
 *
 * 【咬点】
 *   1. 每一族都必须有「人话 + 建议」；给不出归类就如实 unknown，**不许硬编原因**；
 *   2. 族与族之间不许塌（超时 ≠ 离线 ≠ 权限）；
 *   3. 诊断包必须**可复算**（同输入逐字节相同）、**不含正文与链接**；
 *   4. actions 可以缺席，但 advice 不许缺席（不假装有一键修复）；
 *   5. 装配点自检：用户真能看到人话（index.js 的失败通路 / 诊断页卡片），不是只躺在 config 里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ERROR_FAMILIES,
    ERROR_FAMILY_IDS,
    MAX_PACK_MESSAGE,
    classifyError,
    errorLine,
    diagnosticPackText
} from '../config/error-readable.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);

test('O9-1 每一族都有人话与建议（闭集遍历，非空）', () => {
    assert.ok(ERROR_FAMILY_IDS.length >= 7);
    for (const id of ERROR_FAMILY_IDS) {
        const f = ERROR_FAMILIES[id];
        assert.ok(f && typeof f === 'object', id + ' 缺表项');
        assert.ok(typeof f.human === 'string' && f.human.length >= 4, id + ' 缺人话');
        assert.ok(typeof f.advice === 'string' && f.advice.length >= 6, id + ' 缺建议');
        assert.ok(Array.isArray(f.actions), id + ' actions 必须是数组（可以为空）');
    }
});

test('O9-2 没信号的错误 ⇒ unknown，且人话如实说「没有归类」', () => {
    const info = classifyError(new Error('某种没人见过的失败'));
    assert.equal(info.family, 'unknown');
    assert.ok(info.human.includes('没有归类'));
    assert.ok(info.advice.length > 0, 'unknown 也必须给能做的事');
    assert.equal(info.code, 'err:unknown');
});

test('O9-3 kind=load-failed ⇒ module-load（有确证信号才归族）', () => {
    const info = classifyError(new Error('Unexpected token <'), { kind: 'load-failed', module: '微信' });
    assert.equal(info.family, 'module-load');
    assert.equal(info.module, '微信');
    assert.ok(errorLine(info).includes('微信'));
    assert.ok(errorLine(info).includes('文件没能加载'));
});

test('O9-4 存储满 ⇒ storage-quota（按错误名与文案两条信号都认）', () => {
    const a = classifyError({ name: 'QuotaExceededError', message: 'x' });
    const b = classifyError(new Error('Storage quota exceeded for key chat_1'));
    assert.equal(a.family, 'storage-quota');
    assert.equal(b.family, 'storage-quota');
});

test('O9-5 超时 / 离线 / 权限三族分得开（不许塌成一族）', () => {
    const t = classifyError(new Error('request timed out after 30000ms'));
    const o = classifyError(new Error('failed to fetch'));
    const p = classifyError(new Error('not allowed to write clipboard'));
    assert.equal(t.family, 'network-timeout');
    assert.equal(o.family, 'network-offline');
    assert.equal(p.family, 'not-allowed');
    assert.equal(new Set([t.family, o.family, p.family]).size, 3);
});

test('O9-6 TypeError 读不到属性 ⇒ missing-dom；kind=render-threw ⇒ render-crash', () => {
    const dom = classifyError(new TypeError("Cannot read properties of null (reading 'render')"));
    assert.equal(dom.family, 'missing-dom');
    const crash = classifyError(new Error('boom'), { kind: 'render-threw' });
    assert.equal(crash.family, 'render-crash');
    assert.notEqual(dom.human, crash.human, '两族人话必须不同（否则用户分不清要不要回桌面）');
});

test('O9-7 任意形状的错误都不崩（字符串 / null / 普通对象）', () => {
    assert.equal(classifyError('炸了').name, 'NonError');
    assert.equal(classifyError(null).message, '');
    assert.equal(classifyError({ code: 1 }).message, '');
    assert.doesNotThrow(() => errorLine(null));
    assert.equal(errorLine(null), '出错：无归因');
});

test('O9-8 诊断包可复算：同输入两次逐字节相同（不含随机/时间戳）', () => {
    const info = Object.assign(classifyError(new Error('boom'), { kind: 'load-failed', module: '设置' }), {
        version: '4.999.0', at: 1700000000000, recent: ['openApp 设置', 'render 失败']
    });
    const a = diagnosticPackText(info);
    const b = diagnosticPackText(info);
    assert.equal(a, b);
    assert.ok(a.includes('4.999.0'));
    assert.ok(a.includes('设置'));
    assert.ok(a.includes('1700000000000'));
});

test('O9-9 诊断包不含聊天正文：200 字消息只留前 80 字摘要', () => {
    const secret = '这是聊天正文'.repeat(34);   // 远超 80 字
    const info = Object.assign(classifyError(new Error(secret)), { at: 1 });
    const pack = diagnosticPackText(info);
    assert.ok(!pack.includes(secret), '完整正文不许进包');
    const line = pack.split(NL).find((x) => x.startsWith('消息摘要：')) || '';
    const body = line.replace('消息摘要：', '');
    assert.ok(body.length <= MAX_PACK_MESSAGE + 1, '摘要长度必须受限');
});

test('O9-10 诊断包抹掉链接与超长 token', () => {
    const info = Object.assign(
        classifyError(new Error('see https://example.com/a/b?token=abcdef and ' + 'A'.repeat(60))),
        { at: 1, recent: ['open https://example.com/x'] }
    );
    const pack = diagnosticPackText(info);
    assert.ok(!pack.includes('https://'), '链接不许进包');
    assert.ok(!pack.includes('A'.repeat(60)), '超长 token 不许进包');
    assert.ok(pack.includes('最近动作：'));
});

test('O9-11 actions 可缺席，但 advice 不许缺席；缺席时如实为空数组', () => {
    const info = classifyError(new TypeError("Cannot read properties of undefined (reading 'x')"));
    assert.deepEqual(info.actions, []);
    assert.ok(info.advice.length > 0);
    /* 反过来：有动作的族必须给可执行的 id（不是纯文案）。 */
    const load = classifyError(new Error('x'), { kind: 'load-failed' });
    assert.ok(load.actions.length > 0);
    for (const a of load.actions) assert.ok(typeof a.id === 'string' && a.id.length > 0);
});

test('O9-12 装配点自检：用户真的能看到人话（index.js + 诊断页）', () => {
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    assert.ok(idx.indexOf("from './config/error-readable.js'") >= 0, '宿主必须 import 可读化内核');
    assert.ok(idx.includes('classifyError'), '失败通路必须归因');
    assert.ok(idx.includes('errorLine'), '用户侧必须显示人话而不是控制台原文');
    assert.ok(idx.includes('_lastError'), '最近一次人话要留在宿主上供诊断页读');

    const view = fs.readFileSync(path.join(root, 'apps/diagnose/diagnose-view.js'), 'utf8');
    assert.ok(view.includes('_errorReadableHtml'), '诊断页要有错误可读卡片');
    assert.ok(view.includes('this._errorReadableHtml(pkg)'), '卡片必须在渲染主流程里被调用');
});