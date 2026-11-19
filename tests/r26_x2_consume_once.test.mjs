/**
 * tests/r26_x2_consume_once.test.mjs — R26-X2 反向输入「读完即消费」判据
 *
 * 【咬点】config/sharing-boundary.js 的 markRecipientRead 只记「谁看过」，不消费；
 * 全仓没有任何一次性语义 ⇒ 交给某人的东西可以被无限次再交出去。
 * myworld 的做法是相反的：pullViewer 交付的同一拍就 close_poll() / set_sponsor(status='used')。
 *
 * 验收口径：
 *   A1 模式闭集：preview 不消费 / deliver 消费 / 未知拒载（不许默认走任一边）
 *   A2 预览只读：不落 consumedAt、不动记录，但必须预告投递后会是什么态
 *   A3 投递一次性：首次成功并带戳，第二次必须 already-consumed
 *   A4 二次不覆盖：首次的 consumedAt / consumedBy 不得被后写者篡改
 *   A5 copy-on-write：新记录是新对象、源逐字段不动；对拍能括出「就地改」与「没写戳」
 *   A6 过期不是消费、撤回不投递、空记录不慌
 *   A7 接线：index.js 真消费（挂载 + 自检登记）
 *
 * 负控制（真打坏再验红）：
 *   N1 去掉 already-consumed 分支 ⇒ 同一条被反复取走
 *   N2 把 preview 标成 consume: true ⇒ 看一眼就没了
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    CONSUME_STATES, CONSUME_MODES, consumeModeOf, consumeStateOf,
    previewOnce, deliverOnce, verifyConsumeOnce, consumeOnceText, consumeOnceSelfCheck
} from '../config/consume-once.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'consume-once.js');
const INDEX = path.join(root, 'index.js');
const fresh = () => ({ id: 'sub_1', text: '一段投稿', expiresAt: 1999999999999 });
let seq = 0;
const tmpFiles = [];
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_x2_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    tmpFiles.push(tmp);
    return await import(pathToFileURL(tmp).href);
}
test.after(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) { /* 已删 */ } } });

test('A1 模式闭集：预览不消费 / 投递消费 / 未知拒载', () => {
    assert.deepEqual(CONSUME_MODES, ['preview', 'deliver']);
    assert.equal(consumeModeOf('preview').consume, false);
    assert.equal(consumeModeOf('deliver').consume, true);
    assert.equal(consumeModeOf('whatever'), null, '未知模式必须拒载');
    assert.equal(consumeModeOf(''), null);
    assert.equal(consumeModeOf(undefined), null);
    assert.ok(CONSUME_STATES.includes('fresh'));
    assert.ok(CONSUME_STATES.includes('delivered'));
});

test('A2 预览只读：不落戳、不动记录，但必须预告投递落点', () => {
    const r = fresh();
    const pv = previewOnce(r, { now: 1000 });
    assert.equal(pv.changed, false);
    assert.equal(pv.record, r, '预览必须原样返回，不造新对象');
    assert.equal(pv.record.consumedAt, undefined, '预览不许落 consumedAt');
    assert.equal(pv.wouldBe, 'delivered', '预览必须预告：真投递就会消费');
    assert.equal(consumeStateOf(r, 1000), 'fresh', '预览后源必须还是 fresh');
});

test('A3 投递一次性：首次成功带戳，第二次 already-consumed', () => {
    const r = fresh();
    const d1 = deliverOnce(r, { now: 2000, reader: 'a' });
    assert.equal(d1.state, 'delivered');
    assert.equal(d1.changed, true);
    assert.equal(d1.record.consumedAt, 2000);
    assert.equal(d1.record.consumedBy, 'a');
    assert.equal(d1.record.consumeState, 'used');
    const d2 = deliverOnce(d1.record, { now: 3000, reader: 'b' });
    assert.equal(d2.changed, false, '第二次不许再写');
    assert.equal(d2.state, 'delivered');
    assert.equal(d2.reason, 'already-consumed');
    assert.equal(consumeOnceText(d2).includes('已被取走'), true);
});

test('A4 二次不覆盖：首次消费人不被后写者篡改', () => {
    const r = fresh();
    const d1 = deliverOnce(r, { now: 2000, reader: 'a' });
    const d2 = deliverOnce(d1.record, { now: 3000, reader: 'b' });
    assert.equal(d2.record.consumedAt, 2000, '首次消费时间被覆盖了');
    assert.equal(d2.record.consumedBy, 'a', '首次消费人被改成后来了的人');
    assert.equal(d2.record === d1.record, true, '二次投递不该造新对象');
});

test('A5 copy-on-write 与对拍双向', () => {
    const r = fresh();
    const d = deliverOnce(r, { now: 2000, reader: 'a' });
    assert.notEqual(d.record, r, '必须返回新对象');
    assert.equal(r.consumedAt, undefined, '源记录被就地写了');
    assert.deepEqual(Object.keys(r).sort(), ['expiresAt', 'id', 'text'], '源记录的键被加了');
    const v = verifyConsumeOnce(r, d);
    assert.equal(v.ok, true, JSON.stringify(v.bad));

    const inPlace = { changed: true, state: 'delivered', reason: 'delivered-once', record: r };
    assert.equal(verifyConsumeOnce(r, inPlace).ok, false, '对拍必须能拓出「就地改」');
    const noStamp = { changed: true, state: 'delivered', reason: 'delivered-once', record: { id: 'sub_1' } };
    assert.equal(verifyConsumeOnce(r, noStamp).ok, false, '对拍必须能拓出「没写戳却声称写了」');
    const sneaky = { changed: false, state: 'fresh', reason: 'x', record: { id: 'sub_1', consumedAt: 9 } };
    assert.equal(verifyConsumeOnce(r, sneaky).ok, false, '对拍必须能拓出「没消费却改了戳」');
});

test('A6 过期不是消费、撤回不投递、空记录不慌', () => {
    const exp = deliverOnce({ id: 's2', expiresAt: 500 }, { now: 1000 });
    assert.equal(exp.state, 'expired');
    assert.equal(exp.changed, false, '过期不许落消费戳（否则读数会以为东西交出去了）');
    assert.equal(exp.reason, 'record-expired');
    assert.equal(verifyConsumeOnce({ id: 's2', expiresAt: 500 }, exp).ok, true);
    const rev = deliverOnce({ id: 's3', revoked: true }, { now: 1000 });
    assert.equal(rev.state, 'revoked');
    assert.equal(rev.changed, false);
    assert.equal(deliverOnce(null).state, 'invalid');
    assert.equal(deliverOnce([1]).state, 'invalid');
    assert.equal(consumeStateOf({ id: 'x' }, 1000), 'fresh');
    assert.equal(consumeStateOf(null), 'invalid');
    assert.equal(consumeOnceSelfCheck().ok, true, JSON.stringify(consumeOnceSelfCheck().bad));
    assert.ok(consumeOnceText(previewOnce(fresh())).includes('预览'));
    assert.ok(consumeOnceText(null).includes('没量过'));
});

test('A7 接线：index.js 真消费（挂载 + 自检登记）', () => {
    const src = fs.readFileSync(INDEX, 'utf8');
    assert.ok(src.includes("from './config/consume-once.js'"), 'index.js 必须 import 本模块');
    assert.ok(src.includes('window.VirtualPhone.consumeOnce = {'), '必须挂载到 VirtualPhone');
    assert.ok(src.includes("['_r26X2', consumeOnceSelfCheck]"), '自检必须登记进 _bridgeChecks');
    assert.ok(src.includes('deliver: deliverOnce'), '挂载面必须真消费 deliverOnce');
    assert.ok(src.includes('verify: verifyConsumeOnce'), '挂载面必须真消费 verifyConsumeOnce');
});

test('N1 负控制：去掉 already-consumed 分支 ⇒ 同一条被反复取走', async () => {
    const m = await loadBroken((s) => s.replace('if (already) {', 'if (false && already) {'));
    const r = { id: 'sub_1', expiresAt: 1999999999999 };
    const d1 = m.deliverOnce(r, { now: 2000, reader: 'a' });
    const d2 = m.deliverOnce(d1.record, { now: 3000, reader: 'b' });
    assert.equal(d2.changed, true, '打坏后本该能二次取走（若仍 false 说明负控制没生效）');
    assert.equal(d2.record.consumedBy, 'b', '打坏后消费人会被后写者覆盖');
    assert.equal(m.consumeOnceSelfCheck().ok, false, '打坏后自检必须自己发现');
});

test('N2 负控制：把 preview 标成消费 ⇒ 看一眼就没了', async () => {
    const m = await loadBroken((s) => s.replace('consume: false', 'consume: true'));
    assert.equal(m.consumeModeOf('preview').consume, true, '打坏后 preview 本当消费（若仍 false 说明负控制没生效）');
    assert.equal(m.consumeOnceSelfCheck().ok, false, '打坏后自检必须自己发现');
});
