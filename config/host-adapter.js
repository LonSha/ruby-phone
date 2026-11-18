/**
 * config/host-adapter.js — R24-X5 离线演示：不依赖宿主也能跑起来（v4.158.0）
 *
 * 【治的欠债】整台手机的所有读写都直接摸宿主 API（`localStorage` / 宿主事件 / 聊天记录），
 *   于是「离线打开看看」「换宿主跑跑」结构上不可能 —— 一处缺失整机白屏，也没法复现。
 *
 * 【三个口】只收三件事：`storage`（get/set/keys/remove）、`eventBus`（on/off/emit）、
 *   `chat`（send/sent）。**少一个就明说缺哪个**（`missing-port:chat`），不许静默降级成空实现
 *   （那会让「离线能跑」变成「离线静悄悄丢数据」）。
 *
 * 【内存实现】`createMemoryHost()` 提供与真宿主同形的三件套；`?offline=1` 时用它替换宿主。
 *   演示种子固定（8 联系人 / 30 消息 / 20 图），可复跑、可对拍，不随机。
 */
export const HOST_PORTS = Object.freeze(['storage', 'eventBus', 'chat']);

export const PORT_METHODS = Object.freeze({
    storage: ['get', 'set', 'keys', 'remove'],
    eventBus: ['on', 'off', 'emit'],
    chat: ['send', 'sent']
});

export const DEMO_SEED = Object.freeze({
    contacts: 8,
    messages: 30,
    photos: 20
});

function missingOf(port, impl) {
    const need = PORT_METHODS[port];
    if (!impl || typeof impl !== 'object') return 'missing-port:' + port;
    for (let i = 0; i < need.length; i += 1) {
        if (typeof impl[need[i]] !== 'function') return 'bad-port:' + port + '.' + need[i];
    }
    return null;
}

/**
 * 校验并返回适配器。缺哪个口就报哪个口，不补空实现。
 * @param {{storage?:object,eventBus?:object,chat?:object}} host
 */
export function createHostAdapter(host) {
    const h = host && typeof host === 'object' ? host : {};
    const bad = [];
    HOST_PORTS.forEach(function (p) {
        const m = missingOf(p, h[p]);
        if (m) bad.push(m);
    });
    if (bad.length) return { ok: false, bad, host: null };
    return {
        ok: true,
        bad: [],        // 三件套原样透传：适配层不加语义、不改行为
        host: { storage: h.storage, eventBus: h.eventBus, chat: h.chat },
        offline: h.offline === true
    };
}

/** 内存实现：与真宿主同形，供离线 / 测试使用。 */
export function createMemoryHost(options) {
    const o = options && typeof options === 'object' ? options : {};
    const store = new Map();
    const handlers = new Map();
    const sent = [];
    let reads = 0;
    let writes = 0;
    let emits = 0;

    const storage = {
        get: function (key) { reads += 1; return store.has(String(key)) ? store.get(String(key)) : null; },
        set: function (key, value) { writes += 1; store.set(String(key), value); },
        keys: function () { return Array.from(store.keys()); },
        remove: function (key) { store.delete(String(key)); }
    };
    const eventBus = {
        on: function (name, fn) {
            const k = String(name);
            if (!handlers.has(k)) handlers.set(k, []);
            handlers.get(k).push(fn);
            return function () { eventBus.off(k, fn); };
        },
        off: function (name, fn) {
            const k = String(name);
            handlers.set(k, (handlers.get(k) || []).filter(function (f) { return f !== fn; }));
        },
        emit: function (name, payload) {
            emits += 1;
            (handlers.get(String(name)) || []).forEach(function (f) { f(payload); });
        }
    };
    const chat = {
        send: function (who, text) { sent.push({ who: String(who), text: String(text) }); return sent.length; },
        sent: function () { return sent.slice(); }
    };

    return {
        storage, eventBus, chat,
        offline: true,
        demo: o.demo === true,
        stats: function () { return { keys: store.size, reads, writes, emits, sent: sent.length, subscriptions: handlers.size }; }
    };
}

/** 离线入口：`?offline=1`（也认 `offline=true` / `#offline`）。 */
export function parseBootFlags(search) {
    const s = String(search === null || search === undefined ? '' : search);
    const q = s.replace(/^[?#]/, '');
    const parts = q.split('&');
    const flags = { offline: false };
    parts.forEach(function (kv) {
        if (!kv) return;
        const i = kv.indexOf('=');
        const k = (i === -1 ? kv : kv.slice(0, i)).trim();
        const v = i === -1 ? '' : kv.slice(i + 1).trim();
        if (k === 'offline') flags.offline = (v === '' || v === '1' || v === 'true');
    });
    return flags;
}

/** 演示种子：固定、可复跑（不是随机造数据，否则每次演示都不一样）。 */
export function buildDemoSeed() {
    const names = ['阿明', '小鹿', '老周', '林姐', '阿凯', '雪球', '大鹏', '阿柚'];
    const contacts = names.map(function (n, i) { return { id: 'c' + (i + 1), name: n }; });
    const lines = ['在吗', '刚忙完', '晚饭吃了吗', '明天见', '这个有点意思', '我先睡了'];
    const messages = [];
    for (let i = 0; i < DEMO_SEED.messages; i += 1) {
        const c = contacts[i % contacts.length];
        messages.push({
            id: 'm' + (i + 1),
            who: c.id,
            from: i % 2 === 0 ? c.name : '我',
            text: lines[i % lines.length],
            at: 1763000000000 + i * 60000
        });
    }
    const photos = [];
    for (let i = 0; i < DEMO_SEED.photos; i += 1) {
        photos.push({ id: 'p' + (i + 1), at: 1763000000000 + i * 3600000, caption: '照片 ' + (i + 1) });
    }
    return { contacts, messages, photos };
}

/** 把种子灌进内存宿主，形成一台「能跑起来」的离线手机。 */
export function createOfflineSession(options) {
    const o = options && typeof options === 'object' ? options : {};
    const host = createMemoryHost({ demo: true });
    const seed = o.seed && typeof o.seed === 'object' ? o.seed : buildDemoSeed();
    host.storage.set('phone.contacts', seed.contacts);
    host.storage.set('phone.messages', seed.messages);
    host.storage.set('phone.photos', seed.photos);
    const checked = createHostAdapter(host);
    return {
        ok: checked.ok,
        host: checked.host,
        mem: host,
        seed,
        entry: '?offline=1',
        counts: { contacts: seed.contacts.length, messages: seed.messages.length, photos: seed.photos.length }
    };
}

export function hostAdapterSelfCheck() {
    const bad = [];

    // 缺口必须点名（不是静默补空实现）
    if (createHostAdapter({}).bad.length !== 3) bad.push('三个口都缺时应报三条');
    const noChat = createHostAdapter({ storage: createMemoryHost().storage, eventBus: createMemoryHost().eventBus });
    if (noChat.ok || noChat.bad[0] !== 'missing-port:chat') bad.push('缺 chat 应点名 chat');

    const mem = createMemoryHost();
    const okHost = createHostAdapter(mem);
    if (!okHost.ok) bad.push('三件套齐应通过');
    if (okHost.offline !== true) bad.push('内存宿主应标 offline');

    // 透传语义：适配层不许改读写行为
    okHost.host.storage.set('phone.offline.probe', { a: 1 });
    if (okHost.host.storage.get('phone.offline.probe').a !== 1) bad.push('storage 应原样透传');
    okHost.host.storage.remove('phone.offline.probe');
    if (okHost.host.storage.get('phone.offline.probe') !== null) bad.push('remove 后应读回 null');

    let got = 0;
    const off = mem.eventBus.on('phone:openApp', function () { got += 1; });
    mem.eventBus.emit('phone:openApp', { id: 'wechat' });
    if (got !== 1) bad.push('事件应送达');
    off();
    mem.eventBus.emit('phone:openApp', { id: 'wechat' });
    if (got !== 1) bad.push('退订后不该再收');

    mem.chat.send('c1', '在吗');
    if (mem.chat.sent().length !== 1 || mem.chat.sent()[0].text !== '在吗') bad.push('chat.send 应可对拍');

    // 入口标记
    if (parseBootFlags('?offline=1').offline !== true) bad.push('?offline=1 应识别');
    if (parseBootFlags('?foo=1').offline !== false) bad.push('无标记不许当离线');

    // 种子固定且数量对得上
    const seed = buildDemoSeed();
    if (seed.contacts.length !== DEMO_SEED.contacts) bad.push('种子联系人应为 8');
    if (seed.messages.length !== DEMO_SEED.messages) bad.push('种子消息应为 30');
    if (seed.photos.length !== DEMO_SEED.photos) bad.push('种子照片应为 20');
    if (JSON.stringify(buildDemoSeed()) !== JSON.stringify(seed)) bad.push('种子必须可复跑');

    const session = createOfflineSession();
    if (!session.ok) bad.push('离线会话应可用');
    if (session.counts.messages !== 30) bad.push('离线会话应灌满 30 条消息');
    if (session.mem.storage.get('phone.messages').length !== 30) bad.push('消息应真落进离线 storage');

    return { ok: bad.length === 0, bad, sample: 'ports=3 offline=' + session.entry + ' messages=' + session.counts.messages };
}

export default {
    HOST_PORTS,
    PORT_METHODS,
    DEMO_SEED,
    createHostAdapter,
    createMemoryHost,
    parseBootFlags,
    buildDemoSeed,
    createOfflineSession,
    hostAdapterSelfCheck
};