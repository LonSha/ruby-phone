/**
 * tests/r26_x1a_export_redact.test.mjs — R26-X1a 导出脱敏判据
 *
 * 【咬点】config/secret-redaction.js 有整套脱敏器，但备份路径一根线也没接（实测 0 命中）。
 * X9 写着「跳大版本必须先备份（强制）」，等于把用户往「导出带 apiKey 的文件」推。
 *
 * 验收口径：
 *   A1 策略闭集：backup 保留 / share 脱敏 / 未知拒载（三路不许合并成一路）
 *   A2 share 不得留明文密钥，且不得误伤非敏感字段
 *   A3 backup 必须保留密钥（否则备份无法恢复）
 *   A4 脱敏只作用于副本：源对象逐字段不动
 *   A5 对拍双向：既有 maskedPaths，也能抓出 overMasked
 *   A6 接线：index 真消费（不是只被测试引用）
 *
 * 负控制（真打坏再验红）：
 *   N1 把 share 改成不脱敏 ⇒ 明文泄了
 *   N2 把未知策略默认成 share/backup ⇒ 拒载消失
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    EXPORT_POLICIES, exportPolicyOf, prepareExport, verifyExport, exportRedactText, exportRedactSelfCheck
} from '../config/export-redact.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'export-redact.js');
const SECRET = 'sk-abcdefgh12345678';
const sample = () => ({ cfg: { apiKey: SECRET, model: 'm1' }, notes: [{ token: 'tkn_1234567890', text: 'hi' }], n: 3 });
const deep = (v) => JSON.parse(JSON.stringify(v));

let seq = 0;
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_x1a_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    try {
        return await import(pathToFileURL(tmp).href);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 已删 */ }
    }
}

test('X1a-A1 策略闭集：backup / share / 未知拒载', () => {
    assert.deepEqual(EXPORT_POLICIES, ['backup', 'share']);
    assert.equal(exportPolicyOf('backup').redact, false);
    assert.equal(exportPolicyOf('share').redact, true);
    assert.equal(exportPolicyOf('SHARE').redact, true, '策略名要大小写归一');
    assert.equal(exportPolicyOf('whatever'), null);
    const un = prepareExport(sample(), 'whatever');
    assert.equal(un.state, 'refuse');
    assert.equal(un.reason, 'unknown-policy');
    assert.equal(un.value, null, '拒载不得返回可导出的数据');
    assert.equal(prepareExport(sample(), '').state, 'refuse');
    assert.equal(prepareExport(sample(), undefined).state, 'refuse');
});

test('X1a-A2 share：明文消失、非敏感不动', () => {
    const p = prepareExport(sample(), 'share');
    assert.equal(p.state, 'export');
    assert.equal(p.redacted, true);
    assert.ok(p.hits.length >= 2, 'apiKey 与 token 都应命中：' + JSON.stringify(p.hits));
    const s = JSON.stringify(p.value);
    assert.equal(s.indexOf(SECRET), -1, 'share 仍带明文 apiKey');
    assert.equal(s.indexOf('tkn_1234567890'), -1, 'share 仍带明文 token');
    assert.equal(p.value.cfg.model, 'm1');
    assert.equal(p.value.notes[0].text, 'hi');
    assert.equal(p.value.n, 3);
});

test('X1a-A3 backup：密钥必须保留（否则恢复不了）', () => {
    const p = prepareExport(sample(), 'backup');
    assert.equal(p.state, 'export');
    assert.equal(p.redacted, false);
    assert.deepEqual(p.hits, []);
    assert.ok(JSON.stringify(p.value).indexOf(SECRET) >= 0);
});

test('X1a-A4 脱敏只作用于副本：源逐字段不动', () => {
    const src = sample();
    const before = deep(src);
    const p = prepareExport(src, 'share');
    assert.deepEqual(src, before, '源对象被就地修改了');
    assert.equal(src.cfg.apiKey, SECRET);
    assert.ok(JSON.stringify(p.value).indexOf(SECRET) < 0);
    const chk = verifyExport(before, src, p.value);
    assert.equal(chk.ok, true, JSON.stringify(chk.bad));
    assert.ok(chk.maskedPaths.length >= 2);
    assert.deepEqual(chk.overMasked, []);
});

test('X1a-A5 对拍双向：能抓出脱敏过度，也能抓出源被改', () => {
    const src = sample();
    const before = deep(src);
    const over = deep(src);
    over.cfg.model = 'MASKED';
    const c1 = verifyExport(before, src, over);
    assert.equal(c1.ok, false);
    assert.ok(c1.overMasked.includes('cfg.model'), JSON.stringify(c1.overMasked));

    const mut = deep(src);
    mut.cfg.apiKey = 'changed';
    const c2 = verifyExport(before, mut, mut);
    assert.equal(c2.ok, false);
    assert.ok(c2.bad.some((x) => x.includes('源被就地修改')), JSON.stringify(c2.bad));
});

test('X1a-A6 接线在不在：index 真消费 + 自检绿 + 文案两路可读', () => {
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    assert.ok(idx.includes('export-redact.js'), 'index.js 必须 import 导出脱敏');
    assert.ok(idx.includes('prepareExport'), 'index.js 要真消费 prepareExport（不许只被测试引用）');
    assert.equal(exportRedactSelfCheck().ok, true, JSON.stringify(exportRedactSelfCheck().bad));
    const p = prepareExport(sample(), 'share');
    const t = exportRedactText(p, verifyExport(deep(sample()), sample(), p.value));
    assert.match(t, /share/);
    assert.match(t, /逐字一致/);
    assert.match(exportRedactText(null), /没量过/);
    assert.match(exportRedactText(prepareExport(sample(), 'x')), /拒载/);
});

test('X1a-N1 负控制：share 不脱敏 ⇒ 明文泄漏必暴露', async () => {
    const m = await loadBroken((s) => s.replace("    if (k === 'share') return { kind: 'share', redact: true", "    if (k === 'share') return { kind: 'share', redact: false"));
    const p = m.prepareExport(sample(), 'share');
    assert.equal(p.redacted, false, '打坏后不应脱敏');
    assert.ok(JSON.stringify(p.value).indexOf(SECRET) >= 0, '打坏后明文应当泄漏 —— 这正是要用 A2 盯住它的原因');
});

test('X1a-N2 负控制：未知策略默认成 backup ⇒ 拒载消失必暴露', async () => {
    const m = await loadBroken((s) => s.replace('    return null;\n}', "    return { kind: 'backup', redact: false, why: 'fallback' };\n}"));
    const p = m.prepareExport(sample(), 'whatever');
    assert.equal(p.state, 'export', '打坏后未知策略被静默当成 backup');
    assert.notEqual(p.state, 'refuse');
});
