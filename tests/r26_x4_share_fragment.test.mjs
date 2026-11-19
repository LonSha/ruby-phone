/**
 * tests/r26_x4_share_fragment.test.mjs — R26-X4 分享凭证走 URL fragment 判据
 *
 * 【咬点】grep 'location.hash' --include=*.js config/ index.js = 0 命中。
 * 分享草案（sharing-boundary.buildShareDraft）已经在，但没有「草案 -> 可发出的链接」这一层，
 * 而人肉拼 URL 的默认动作就是把 id 塞进 query；query 会进 access log / Referer / CDN 缓存。
 *
 * 验收口径：
 *   A1 只产出 #share= 前缀；载荷是纯 base64url，不含 ? 与 =（不会裂成 query）
 *   A2 白名单取键：非白名单键不纳入，但必须逐条点名（droppedKeys），不许静默丢弃
 *   A3 base 上的 query 一律剥掉并点名（droppedQuery）；拼出的链接里不得有 ?
 *   A4 往返：encode -> parse 后 id/snippet/scope/recipients/expiresAt/createdAt 全部一致
 *   A5 snippet 长得像密钥就整包拒载，且拒载时 fragment 必须为空（不许给半成品）
 *   A6 解析端拒夹带 / 拒旧版本 / 拒垃圾；任何落点都必须给 clearedHash = '#'（读完即清）
 *   A7 接线：index.js 真消费（不是只被测试引用）
 *
 * 负控制（真打坏再验红）：
 *   N1 去掉 query 剥离 ⇒ 链接带 query（凭证进日志）
 *   N2 去掉夹带检查 ⇒ 伪造载荷被接受
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    SHARE_FRAGMENT_PREFIX, SHARE_FRAGMENT_VERSION, SHARE_FRAGMENT_KEYS, SHARE_SNIPPET_MAX, SHARE_PAYLOAD_MAX,
    buildShareCredential, encodeShareFragment, buildShareUrl, parseShareFragment, shareFragmentText, shareFragmentSelfCheck
} from '../config/share-fragment.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'config', 'share-fragment.js');
const INDEX = path.join(root, 'index.js');
const draft = () => ({
    id: 'share_1', snippet: '昨晚那句话还留着', scope: 'shared_group',
    recipients: ['a', 'b'], reshareable: true, expiresAt: 1999999999999,
    sensitiveTokens: ['旧手机号'], revoked: false, createdAt: 1700000000000, readLogs: []
});
let seq = 0;
const tmpFiles = [];
async function loadBroken(mutate) {
    const src = fs.readFileSync(SRC, 'utf8');
    const out = mutate(src);
    assert.notEqual(out, src, '负控制没改到源码：mutator 失配（判据会假绿）');
    seq += 1;
    const tmp = path.join(root, 'config', '.tmp_x4_broken_' + seq + '.mjs');
    fs.writeFileSync(tmp, out, 'utf8');
    tmpFiles.push(tmp);
    return await import(pathToFileURL(tmp).href);
}
test.after(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) { /* 已删 */ } } });

test('A1 只产出 #share= 载荷：纯 base64url，不含 ? 与 =', () => {
    const enc = encodeShareFragment(draft());
    assert.equal(enc.state, 'ok', enc.reason);
    assert.ok(enc.fragment.startsWith(SHARE_FRAGMENT_PREFIX), '前缀必须是 ' + SHARE_FRAGMENT_PREFIX);
    const payload = enc.fragment.slice(SHARE_FRAGMENT_PREFIX.length);
    assert.match(payload, /^[A-Za-z0-9_-]+$/, '载荷必须是 base64url');
    assert.equal(enc.fragment.indexOf('?'), -1, 'fragment 里不许出现 query 分隔符');
    assert.ok(payload.length <= SHARE_PAYLOAD_MAX, '载荷超限');
    assert.deepEqual(enc.droppedSecrets, ['sensitiveTokens'], '只有敏感词袋被丢，且必须点名');
});

test('A2 白名单取键：非白名单键不纳入但逐条点名', () => {
    const built = buildShareCredential(draft());
    assert.equal(built.state, 'ok', built.reason);
    for (const k of ['sensitiveTokens', 'readLogs', 'reshareable', 'revoked']) {
        assert.ok(built.droppedKeys.includes(k), '未纳入的键必须点名：' + k);
        assert.equal(k in built.credential, false, '非白名单键不得进载荷：' + k);
    }
    assert.ok(built.droppedSecrets.includes('sensitiveTokens'), '敏感键要单独列入 droppedSecrets');
    for (const k of Object.keys(built.credential)) {
        assert.ok(SHARE_FRAGMENT_KEYS.includes(k), '载荷里出现了白名单外的键：' + k);
    }
    assert.equal(built.credential.v, SHARE_FRAGMENT_VERSION);
});

test('A3 base 上的 query 一律剥掉并点名', () => {
    const url = buildShareUrl('https://x.test/p?share=share_1&ref=t', draft());
    assert.equal(url.state, 'ok', url.reason);
    assert.equal(url.url.indexOf('?'), -1, '链接里不许留 query（凭证会进日志与 Referer）');
    assert.deepEqual(url.droppedQuery, ['share=share_1', 'ref=t'], '剥掉的 query 必须逐条点名');
    assert.ok(url.url.startsWith('https://x.test/p'), 'path 必须保留');
    assert.ok(url.url.endsWith(url.fragment), '链接必须由 fragment 收尾');
    assert.equal(buildShareUrl('', draft()).reason, 'missing-base-url');
});

test('A4 往返一致，且夹带不进载荷', () => {
    const d = draft();
    const enc = encodeShareFragment(d);
    const parsed = parseShareFragment(enc.fragment);
    assert.equal(parsed.state, 'ok', parsed.reason);
    assert.equal(parsed.credential.id, d.id);
    assert.equal(parsed.credential.snippet, d.snippet);
    assert.equal(parsed.credential.scope, d.scope);
    assert.deepEqual(parsed.credential.recipients, d.recipients);
    assert.equal(parsed.credential.expiresAt, d.expiresAt);
    assert.equal(parsed.credential.createdAt, d.createdAt);
    assert.equal('sensitiveTokens' in parsed.credential, false, '夹带进了敏感键');
    assert.equal(parsed.smuggled.length, 0);
    assert.equal(shareFragmentText(enc, null).includes('拒载'), false);
    assert.ok(shareFragmentText(null, parsed).includes('读完即清'));
});

test('A5 snippet 像密钥就整包拒载，不许给半成品', () => {
    const cases = [
        'key=sk-abcdefgh12345678',
        'ghp_ABCDEFGHIJKLMNOP',
        'Authorization: bearer abcdefghijklmn',
        '-----BEGIN RSA PRIVATE KEY-----'
    ];
    for (const snippet of cases) {
        const enc = encodeShareFragment({ id: 's1', snippet });
        assert.equal(enc.state, 'refuse', '密钥形状必须拒载：' + snippet);
        assert.equal(enc.reason, 'snippet-looks-like-secret');
        assert.equal(enc.fragment, '', '拒载时不许给半成品片段');
    }
    assert.equal(encodeShareFragment({ snippet: 'no id' }).reason, 'missing-id');
    const tooLong = encodeShareFragment({ id: 's2', snippet: 'x'.repeat(SHARE_SNIPPET_MAX + 1) });
    assert.equal(tooLong.reason, 'snippet-too-long');
    assert.equal(encodeShareFragment(null).reason, 'invalid-draft');
    assert.equal(encodeShareFragment([1, 2]).reason, 'invalid-draft');
});

test('A6 解析端：拒夹带/拒旧版本/拒垃圾，且一律清 hash', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
    const smug = parseShareFragment('#share=' + b64({ v: 1, id: 'x', snippet: 'hi', apiKey: 'sk-1' }));
    assert.equal(smug.state, 'bad');
    assert.equal(smug.reason, 'smuggled-keys');
    assert.deepEqual(smug.smuggled, ['apiKey']);
    assert.equal(smug.clearedHash, '#');

    const oldV = parseShareFragment('#share=' + b64({ v: 99, id: 'x' }));
    assert.equal(oldV.reason, 'version-mismatch', '老链接必须解不开乱对新结构');
    assert.equal(parseShareFragment('#share=%%%').reason, 'decode-failed');
    assert.equal(parseShareFragment('#share=').reason, 'empty-payload');
    assert.equal(parseShareFragment('#share=' + 'a'.repeat(SHARE_PAYLOAD_MAX + 4)).reason, 'payload-too-long');

    const other = parseShareFragment('#settings');
    assert.equal(other.state, 'absent');
    assert.equal(other.reason, 'other-fragment');
    assert.equal(parseShareFragment('').state, 'absent');
    for (const v of ['#share=%%%', '#share=' + b64({ v: 1, id: 'x', apiKey: 'k' })]) {
        assert.equal(parseShareFragment(v).clearedHash, '#', '自己认领的载荷都要清掉：' + v);
    }
    assert.equal(parseShareFragment('#settings').clearedHash, '#settings', '别人的 fragment 不越权清理');
    assert.equal(shareFragmentSelfCheck().ok, true, JSON.stringify(shareFragmentSelfCheck().bad));
});

test('A7 接线：index.js 真消费（挂载 + 自检登记）', () => {
    const src = fs.readFileSync(INDEX, 'utf8');
    assert.ok(src.includes("from './config/share-fragment.js'"), 'index.js 必须 import 本模块');
    assert.ok(src.includes('window.VirtualPhone.shareFragment = {'), '必须挂载到 VirtualPhone');
    assert.ok(src.includes("['_r26X4', shareFragmentSelfCheck]"), '自检必须登记进 _bridgeChecks');
    assert.ok(src.includes('url: buildShareUrl'), '挂载面必须真消费 buildShareUrl');
    assert.ok(src.includes('parse: parseShareFragment'), '挂载面必须真消费 parseShareFragment');
});

test('N1 负控制：去掉 query 剥离 ⇒ 链接带 query', async () => {
    const m = await loadBroken((s) => s.replace('if (qAt >= 0) {', 'if (false && qAt >= 0) {'));
    const url = m.buildShareUrl('https://x.test/p?share=share_1', draft());
    assert.notEqual(url.url.indexOf('?'), -1, '打坏后本该带 query（若仍无 ? 说明负控制没生效）');
    assert.equal(m.shareFragmentSelfCheck().ok, false, '打坏后自检必须自己发现');
});

test('N2 负控制：去掉夹带检查 ⇒ 伪造载荷被接受', async () => {
    const m = await loadBroken((s) => s.replace('if (smuggled.length) {', 'if (false && smuggled.length) {'));
    const forged = '#share=' + Buffer.from(JSON.stringify({ v: 1, id: 'x', snippet: 'hi', apiKey: 'k' }), 'utf8').toString('base64url');
    const r = m.parseShareFragment(forged);
    assert.equal(r.state, 'ok', '打坏后伪造载荷本该被接受（若仍 bad 说明负控制没生效）');
    assert.equal(m.shareFragmentSelfCheck().ok, false, '打坏后自检必须自己发现');
});
