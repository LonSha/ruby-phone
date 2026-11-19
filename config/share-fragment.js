/**
 * config/share-fragment.js — 分享凭证走 URL fragment [R26-X4]
 *
 * 缝自 myworld（common.js 里分享链接一律写 location.hash）与 Lumière snapshot 的分享面：
 * 凭证只进 hash。理由是硬的：
 *   - fragment 不随请求发给服务端，不进 access log；
 *   - 跨站跳转时 Referer 只到 path，不含 fragment；
 *   - 不会被 CDN / 反向代理当成公共对象缓存。
 * 而 query 三样全中。分享出去的是一段回忆，不是一条日志。
 *
 * 【本仓的真洞（实测）】
 *   grep 'location.hash' --include=*.js config/ index.js = 0 命中。
 *   config/sharing-boundary.js 里的 buildShareDraft 已经在，但没有任何
 *   「把草案变成一条可发出去的链接」的层。谁要分享只能自己拼 URL，
 *   而人肉拼 URL 的默认动作就是把 id 塞进 query。这就是洞。
 *
 * 【纪律】
 *   ① 凭证只走 fragment；base 上原有的 query 一律不带（droppedQuery 点名，不静默吞）。
 *   ② 只按白名单取键，draft 里其余键不纳入但必须报出来（droppedKeys）——
 *      静默丢弃会让人以为「分享出去的是全部」，实际不是。
 *   ③ snippet 若长得像密钥（sk- / ghp_ / bearer / PEM），整包拒载，不许编码。
 *   ④ 解析端只认自己的版本号与白名单；多出来的键算夹带（smuggled），拒收。
 *   ⑤ 解析完一律给出 clearedHash —— 读完即清，别把凭证留在浏览器历史里（与 X2 同一条纪律）。
 */
import { isSensitiveKey } from './secret-redaction.js';
import { numOrNull } from './num-gate.js';

/** fragment 前缀。只认这一种。 */
export const SHARE_FRAGMENT_PREFIX = '#share=';
/** 载荷版本。改结构必须抬版本，老链接必须解不开而不是解错。 */
export const SHARE_FRAGMENT_VERSION = 1;
/** 载荷白名单闭集。往里加键必须同步抬版本。 */
export const SHARE_FRAGMENT_KEYS = Object.freeze([
    'v', 'id', 'snippet', 'scope', 'recipients', 'expiresAt', 'createdAt'
]);
/** snippet 上限：链接要能贴进聊天框，不是搬运整段对话。 */
export const SHARE_SNIPPET_MAX = 1200;
/** 载荷上限：超过就不是分享链接了（被人塞了东西）。 */
export const SHARE_PAYLOAD_MAX = 4096;
/** 「这段文本本身像凭证」。 */
export const SHARE_SECRET_SHAPE = /(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|bearer\s+[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function b64UrlEncode(text) {
    const bytes = new TextEncoder().encode(String(text));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(token) {
    const t = String(token == null ? '' : token);
    if (!t || !/^[A-Za-z0-9_-]+$/.test(t)) throw new Error('not-base64url');
    const b = t.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4));
    const bin = atob(b + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 从分享草案里抽「最小可复原集」。
 * 三件事必须同时成立才 ok：有 id、snippet 不像密钥、snippet 不超长。
 */
export function buildShareCredential(draft) {
    const out = { state: 'refuse', credential: null, reason: '', droppedKeys: [], droppedSecrets: [] };
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        out.reason = 'invalid-draft';
        return out;
    }
    const id = str(draft.id);
    if (!id) {
        out.reason = 'missing-id';
        return out;
    }
    const snippet = str(draft.snippet);
    if (SHARE_SECRET_SHAPE.test(snippet)) {
        out.reason = 'snippet-looks-like-secret';
        return out;
    }
    if (snippet.length > SHARE_SNIPPET_MAX) {
        out.reason = 'snippet-too-long';
        return out;
    }
    const droppedKeys = Object.keys(draft).filter(k => !SHARE_FRAGMENT_KEYS.includes(k));
    out.droppedKeys = droppedKeys;
    out.droppedSecrets = droppedKeys.filter(k => isSensitiveKey(k) || /sensitive/i.test(k));
    const recipients = Array.isArray(draft.recipients) ? draft.recipients.map(str).filter(Boolean) : [];
    out.credential = {
        v: SHARE_FRAGMENT_VERSION,
        id: id,
        snippet: snippet,
        scope: str(draft.scope) || 'private_one_to_one',
        recipients: recipients,
        expiresAt: numOrNull(draft.expiresAt),
        createdAt: numOrNull(draft.createdAt)
    };
    out.state = 'ok';
    return out;
}

/** 草案 -> fragment 片段。拒载时 fragment 一定是空串，绝不给半成品。 */
export function encodeShareFragment(draft) {
    const built = buildShareCredential(draft);
    const out = {
        state: 'refuse', fragment: '', reason: built.reason,
        droppedKeys: built.droppedKeys.slice(), droppedSecrets: built.droppedSecrets.slice()
    };
    if (built.state !== 'ok') return out;
    let json = '';
    try {
        json = JSON.stringify(built.credential);
    } catch (e) {
        out.reason = 'unserializable';
        return out;
    }
    const payload = b64UrlEncode(json);
    if (payload.length > SHARE_PAYLOAD_MAX) {
        out.reason = 'payload-too-long';
        return out;
    }
    out.state = 'ok';
    out.fragment = SHARE_FRAGMENT_PREFIX + payload;
    out.reason = '';
    return out;
}

/**
 * 草案 + 站点基址 -> 完整分享链接。
 * base 上原有的 query 一律不带，逐条报在 droppedQuery 里。
 * 理由：只要留着 query，调用方迟早会把 id 塞进去，纪律就破了 —— 那还不如一开始就不给口子。
 */
export function buildShareUrl(baseUrl, draft) {
    const enc = encodeShareFragment(draft);
    const out = {
        state: 'refuse', url: '', reason: enc.reason, fragment: enc.fragment,
        droppedQuery: [], droppedKeys: enc.droppedKeys.slice(), droppedSecrets: enc.droppedSecrets.slice()
    };
    if (enc.state !== 'ok') return out;
    let base = str(baseUrl);
    if (!base) {
        out.reason = 'missing-base-url';
        return out;
    }
    const hashAt = base.indexOf('#');
    if (hashAt >= 0) base = base.slice(0, hashAt);
    const qAt = base.indexOf('?');
    if (qAt >= 0) {
        const q = base.slice(qAt + 1);
        out.droppedQuery = q ? q.split('&').filter(Boolean) : [];
        base = base.slice(0, qAt);
    }
    out.state = 'ok';
    out.url = base + enc.fragment;
    out.reason = '';
    return out;
}

/**
 * 解析收到的 hash。三态：ok / absent / bad。
 * clearedHash 是「读完即清」的落点：ok 与 bad 都给 '#'，absent 不干涉原值。
 */
export function parseShareFragment(hash) {
    const out = { state: 'absent', credential: null, reason: '', clearedHash: '#', smuggled: [] };
    const raw = str(hash);
    if (!raw) {
        out.reason = 'no-hash';
        out.clearedHash = raw;
        return out;
    }
    const h = raw.charAt(0) === '#' ? raw : ('#' + raw);
    if (!h.startsWith(SHARE_FRAGMENT_PREFIX)) {
        out.reason = h.startsWith('#') ? 'other-fragment' : 'not-fragment';
        out.clearedHash = h;
        return out;
    }
    const payload = h.slice(SHARE_FRAGMENT_PREFIX.length);
    if (!payload) {
        out.state = 'bad';
        out.reason = 'empty-payload';
        return out;
    }
    if (payload.length > SHARE_PAYLOAD_MAX) {
        out.state = 'bad';
        out.reason = 'payload-too-long';
        return out;
    }
    let cred = null;
    try {
        cred = JSON.parse(b64UrlDecode(payload));
    } catch (e) {
        out.state = 'bad';
        out.reason = 'decode-failed';
        return out;
    }
    if (!cred || typeof cred !== 'object' || Array.isArray(cred)) {
        out.state = 'bad';
        out.reason = 'not-an-object';
        return out;
    }
    if (cred.v !== SHARE_FRAGMENT_VERSION) {
        out.state = 'bad';
        out.reason = 'version-mismatch';
        return out;
    }
    const smuggled = Object.keys(cred).filter(k => !SHARE_FRAGMENT_KEYS.includes(k));
    if (smuggled.length) {
        out.state = 'bad';
        out.reason = 'smuggled-keys';
        out.smuggled = smuggled;
        return out;
    }
    if (!str(cred.id)) {
        out.state = 'bad';
        out.reason = 'missing-id';
        return out;
    }
    if (SHARE_SECRET_SHAPE.test(str(cred.snippet))) {
        out.state = 'bad';
        out.reason = 'snippet-looks-like-secret';
        return out;
    }
    out.state = 'ok';
    out.credential = cred;
    out.reason = '';
    return out;
}

/** 一行读数。 */
export function shareFragmentText(enc, parsed) {
    if (enc) {
        if (enc.state !== 'ok') return '分享链接：**拒载** —— ' + (enc.reason || 'unknown');
        const kept = Array.isArray(enc.droppedKeys) && enc.droppedKeys.length
            ? ('，未纳入 ' + enc.droppedKeys.join('/')) : '';
        const q = Array.isArray(enc.droppedQuery) && enc.droppedQuery.length
            ? ('，剥掉 query ' + enc.droppedQuery.length + ' 项') : '';
        return '分享链接：fragment 载荷 ' + enc.fragment.length + ' 字符' + kept + q;
    }
    if (parsed) {
        if (parsed.state === 'ok') return '收到分享：ok（读完即清 -> ' + parsed.clearedHash + '）';
        if (parsed.state === 'absent') return '收到分享：没有凭证片段（' + (parsed.reason || 'absent') + '）';
        return '收到分享：**不可用** —— ' + (parsed.reason || 'bad');
    }
    return '分享链接：没有结果（没量过）';
}

/** 自检：只验纯逻辑，不碰 DOM。 */
export function shareFragmentSelfCheck() {
    const bad = [];
    const draft = {
        id: 'share_1', snippet: '昨晚那句话还留着', scope: 'shared_group',
        recipients: ['a', 'b'], reshareable: true, expiresAt: 1999999999999,
        sensitiveTokens: ['旧手机号'], revoked: false, createdAt: 1700000000000,
        readLogs: []
    };
    const enc = encodeShareFragment(draft);
    if (enc.state !== 'ok') bad.push('正常草案应可编码：' + enc.reason);
    if (!enc.fragment.startsWith(SHARE_FRAGMENT_PREFIX)) bad.push('片段必须以 #share= 开头');
    if (enc.fragment.indexOf('?') >= 0) bad.push('片段里出现了 query 分隔符');
    if (!enc.droppedKeys.includes('sensitiveTokens')) bad.push('未纳入的键必须点名');
    if (!enc.droppedKeys.includes('readLogs')) bad.push('readLogs 也不该进载荷');

    const url = buildShareUrl('https://x.test/p?share=share_1&ref=t', draft);
    if (url.state !== 'ok') bad.push('应能拼出链接：' + url.reason);
    if (url.url.indexOf('?') >= 0) bad.push('链接里不许留 query（凭证会进日志）');
    if (!url.droppedQuery.length) bad.push('剥掉的 query 必须点名');

    const parsed = parseShareFragment(url.fragment);
    if (parsed.state !== 'ok') bad.push('自己编的片段应能解开：' + parsed.reason);
    if (parsed.credential && parsed.credential.id !== 'share_1') bad.push('往返后 id 不一致');
    if (parsed.credential && parsed.credential.snippet !== draft.snippet) bad.push('往返后 snippet 不一致');
    if (parsed.credential && 'sensitiveTokens' in parsed.credential) bad.push('夹带进了非白名单键');
    if (parsed.clearedHash !== '#') bad.push('解析完必须给清空后的 hash');

    const leaky = encodeShareFragment({ id: 's2', snippet: 'key=sk-abcdefgh12345678' });
    if (leaky.state !== 'refuse' || leaky.reason !== 'snippet-looks-like-secret') bad.push('snippet 像密钥必须拒载');
    if (leaky.fragment) bad.push('拒载时不许给半成品片段');
    if (encodeShareFragment({ snippet: 'no id' }).reason !== 'missing-id') bad.push('缺 id 必须拒载');

    const forged = '#' + 'share=' + b64UrlEncode(JSON.stringify({ v: 1, id: 'x', snippet: 'hi', apiKey: 'sk-1' }));
    const f = parseShareFragment(forged);
    if (f.state !== 'bad' || f.reason !== 'smuggled-keys') bad.push('夹带键必须拒收');
    if (f.clearedHash !== '#') bad.push('拒收也要清 hash（别把赃物留在历史里）');
    const oldV = parseShareFragment('#' + 'share=' + b64UrlEncode(JSON.stringify({ v: 99, id: 'x' })));
    if (oldV.reason !== 'version-mismatch') bad.push('版本不符必须拒收');
    const junk = parseShareFragment('#share=%%%');
    if (junk.state !== 'bad' || junk.reason !== 'decode-failed') bad.push('垃圾载荷必须判 bad');
    const other = parseShareFragment('#settings');
    if (other.state !== 'absent' || other.reason !== 'other-fragment') bad.push('别的 fragment 必须判 absent');
    if (parseShareFragment('').state !== 'absent') bad.push('空 hash 必须判 absent');

    return { ok: bad.length === 0, bad: bad };
}

export default {
    SHARE_FRAGMENT_PREFIX, SHARE_FRAGMENT_VERSION, SHARE_FRAGMENT_KEYS,
    SHARE_SNIPPET_MAX, SHARE_PAYLOAD_MAX,
    buildShareCredential, encodeShareFragment, buildShareUrl, parseShareFragment,
    shareFragmentText, shareFragmentSelfCheck
};
