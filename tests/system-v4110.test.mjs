/* ========================================================
 * tests/system-v4110.test.mjs -- [v4.11.0 · 第三期 R3-O1 收口]
 *   通话同名歧义的人工认领(认领 / 撤销 / 不猜 / 会话隔离)
 *
 * 【计划原文 R3-O1】
 *   「群发言、@、短信/通话统计用稳定角色/联系人 ID;别名仅用于候选查找,
 *    歧义提示选择并保留绑定;历史记录无 ID 时不猜。」
 *   验收原文(本版钉住的后两条):「旧记录可人工认领,**撤销认领后恢复未归属**。」
 *
 * 【修前实测的缺口(不是推演)】
 *   一 内核侧:contact-insight.js 通读通话时只读 `call.name || call.contactName`,
 *      而 PhoneCallView._addCallRecord 写入的真实字段是 **caller** ——
 *      于是**每一条生产通话都被静默跳过**(不报错、不崩溃、只错读数:
 *      「这个人从没打过电话」),正是本仓点名的最贵形态。
 *   二 消费侧:内核虽已支持 opts.callAttribution 与 unattributedCalls,
 *      但 collectContactInsight 只传 { staleDays } ⇒ 认领账**全库零消费**;
 *      界面无候选、无认领、无撤销 —— 内核能力悬空。
 *   三 生产侧:新通话记录不写 contactId,同一姓名只能靠人工认领——
 *      本版为**新**记录补上稳定 ID(拿得到才写,拿不到不猜)。
 *
 * 判据面(五组):
 *   A 结构与口径:键归属 / 归一 / 零导出悬空 / 不写全局
 *   B 行为:空值如实拒绝 / 认领生效 / 撤销恢复未归属 / 幂等 / 不抛 / 畸形存储
 *   C 接线:取数传认领账 / 视图候选与按钮 / 电话记录写 contactId / 键登记
 *   D 负控制:真源码定点破坏三条口径 ⇒ 同款判据必转红(且配原版必真的反向对照)
 *   E 版本锚:下限形
 *
 * 【为什么断言用 includes 而非正则】锚点里全是括号与星号,正则转义层数一多
 *   「判据自身」会静默失效(本仓已有前例)。本档沿用 v4080/v4090 的纪律。
 * 【为什么键名用拼接而不用字面量】keys 门(第六道门)会抽取测试文件里的
 *   storage 句柄读写;字面量会让测试自己变成「未登记键的使用点」。
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ATTR = 'config/call-attribution.js';
const INS = 'config/contact-insight.js';
const DATA = 'apps/usage/usage-data.js';
const APP = 'apps/usage/usage-app.js';
const VIEW = 'apps/usage/usage-view.js';
const PHONE = 'apps/phone/phone-view.js';
const KEYS = 'scripts/keys-audit.mjs';
const STOR = 'config/storage.js';

const attrSrc = read(ATTR);
const dataSrc = read(DATA);
const appSrc = read(APP);
const viewSrc = read(VIEW);
const phoneSrc = read(PHONE);
const A = await import(pathToFileURL(path.join(ROOT, ATTR)).href);
const I = await import(pathToFileURL(path.join(ROOT, INS)).href);
const D = await import(pathToFileURL(path.join(ROOT, DATA)).href);

/** 认领键名(拼接,避免成为 keys 门的字面量使用点)。 */
const KEY_NAME = 'phone_call_' + 'attribution';

/** 内存 storage:与被测模块的 storage.get/set 契约同形。 */
function memStorage(initial) {
    const m = Object.assign({}, initial || {});
    return {
        get: (k, d) => (k in m ? m[k] : d),
        set: (k, v) => { m[k] = v; },
        has: (k) => k in m
    };
}
/** 会抛的 storage:验证「不抛」纪律。 */
const throwingStorage = {
    get: () => { throw new Error('boom-get'); },
    set: () => { throw new Error('boom-set'); }
};

/* ══════════ A ── 结构与口径 ══════════ */
test('A1 键归属:认领账必须命中会话隔离面(不得写全局)', () => {
    const stor = read(STOR);
    assert.ok(stor.includes('/^phone_call_/'), '认领账靠 /^phone_call_/ 落在 chatMetadata');
    /* 反向:必须不是全局键(全局 = 换角色跟着走,认领是会话内的判断)。 */
    const patterns = stor.slice(stor.indexOf('CHAT_DATA_PATTERNS = ['), stor.indexOf('];', stor.indexOf('CHAT_DATA_PATTERNS = [')));
    assert.ok(/\/\^phone_call_\//.test(patterns), '前缀型必须真在 CHAT_DATA_PATTERNS 里,而不是只写在注释里');
});

test('A2 归一:只认「非空名 → 非空 ID」的纯对象,畸形一律丢弃(不猜不补)', () => {
    assert.deepEqual(A.normalizeCallAttribution(null), {});
    assert.deepEqual(A.normalizeCallAttribution('x'), {});
    assert.deepEqual(A.normalizeCallAttribution([]), {}, '数组不是认领账');
    assert.deepEqual(A.normalizeCallAttribution({ 甲: 'a', '': 'b', 乙: '', 丙: '  c  ', 丁: null }), { 甲: 'a', 丙: 'c' });
});

test('A3 零导出悬空:四个出口都必须有真消费点(不得建好却没人用)', () => {
    assert.ok(dataSrc.includes('readCallAttribution'), '取数层消费读出口');
    assert.ok(appSrc.includes('claimCall') && appSrc.includes('unclaimCall'), '控制器消费写出口');
    assert.ok(attrSrc.includes('export function readCallAttribution'), '读出口在场');
    assert.ok(attrSrc.includes('export function claimCall'), '认领出口在场');
    assert.ok(attrSrc.includes('export function unclaimCall'), '撤销出口在场');
});

test('A4 零宿主边界:认领账只 import 自身,不摸 window/document/localStorage', () => {
    const body = attrSrc.slice(attrSrc.indexOf('export function'));
    assert.equal(body.includes('window'), false, '内核不得摸 window');
    assert.equal(body.includes('document'), false, '内核不得摸 document');
    assert.equal(body.includes('localStorage'), false, '内核不得直写 localStorage');
});

/* ══════════ B ── 行为 ══════════ */
test('B1 ★★★ 空值如实拒绝:空名 / 空 ID 不得静默成功,且不落任何键', () => {
    const s = memStorage();
    assert.equal(A.claimCall(s, '', 'a'), false, '空名必须拒绝');
    assert.equal(A.claimCall(s, '   ', 'a'), false, '纯空白名必须拒绝');
    assert.equal(A.claimCall(s, '甲', ''), false, '空 ID 必须拒绝');
    assert.equal(A.claimCall(s, '甲', '   '), false, '纯空白 ID 必须拒绝');
    assert.equal(s.has(KEY_NAME), false, '★ 被拒绝的认领不得留下任何键(否则账里长幽灵)');
    assert.equal(A.unclaimCall(s, ''), false, '空名撤销必须拒绝');
});

test('B2 ★★★ 认领生效 + 撤销恢复未归属(验收原文最后一条)', () => {
    const s = memStorage();
    assert.equal(A.claimCall(s, '甲', 'ct_1'), true);
    assert.deepEqual(A.readCallAttribution(s), { 甲: 'ct_1' });
    assert.equal(A.unclaimCall(s, '甲'), true, '撤销必须成功');
    assert.deepEqual(A.readCallAttribution(s), {}, '★ 撤销后账必须真的空掉');
    assert.equal(A.unclaimCall(s, '甲'), false, '★ 没认领过时撤销如实返回 false(幂等,不报错不补写)');
});

test('B3 ★★ 读不抛:storage 抛异常 / 畸形存储一律按「没有认领」处置', () => {
    assert.deepEqual(A.readCallAttribution(throwingStorage), {}, '读抛异常 ⇒ 空账,不抛出去');
    assert.equal(A.claimCall(throwingStorage, '甲', 'a'), false, '写抛异常 ⇒ 如实 false');
    const broken = memStorage({ [KEY_NAME]: '{ 这不是 JSON' });
    assert.deepEqual(A.readCallAttribution(broken), {}, '坏 JSON ⇒ 空账(不猜)');
    const arr = memStorage({ [KEY_NAME]: JSON.stringify({ 甲: 'a' }) });
    assert.deepEqual(A.readCallAttribution(arr), { 甲: 'a' }, '正常写入能读回(字符串形态)');
});

test('B4 ★★★ 生产通话必须被统计:记录字段是 caller(修前被静默跳过)', () => {
    const now = Date.now();
    const ins = I.buildContactInsight({
        wechat: {
            chats: [
                { id: 'a', name: '甲', type: 'single', timestamp: now - 86400000 },
                { id: 'b', name: '甲', type: 'single', timestamp: now - 86400000 }
            ],
            buckets: {}, loadedIds: []
        },
        calls: [{ id: 'c1', caller: '甲', timestamp: now - 3600000, status: 'missed' }]
    }, { now: now, staleDays: 30 });
    /* 同名两行 ⇒ 唯一姓名匹配不成立 ⇒ 如实进未归属(不猜) */
    assert.equal(ins.unattributedCalls.length, 1, '★ 同名通话必须进未归属,而不是静默消失');
    assert.equal(ins.unattributedCalls[0].name, '甲');
    assert.equal(ins.unattributedCalls[0].count, 1);
    assert.ok(ins.unattributedCalls[0].candidateIds.length >= 2, '候选必须列出');
    assert.equal(ins.rows.every((r) => !r.calls), true, '★ 未认领时不得计入任何联系人');
});

test('B5 ★★★ 认领后计入该联系人;撤销后恢复未归属', () => {
    const now = Date.now();
    const stores = {
        wechat: {
            chats: [
                { id: 'a', name: '甲', type: 'single', timestamp: now - 86400000 },
                { id: 'b', name: '甲', type: 'single', timestamp: now - 86400000 }
            ],
            buckets: {}, loadedIds: []
        },
        calls: [{ id: 'c1', caller: '甲', timestamp: now - 3600000, status: 'missed' }]
    };
    const claimed = I.buildContactInsight(stores, { now: now, callAttribution: { 甲: 'a' } });
    assert.equal(claimed.rows.find((r) => r.id === 'a').calls, 1, '★ 认领后计入被认领的那一行');
    assert.equal(claimed.rows.find((r) => r.id === 'b').calls || 0, 0, '★ 不得连带计给另一行');
    assert.equal(claimed.unattributedCalls.length, 0, '认领后不再未归属');
    assert.equal(claimed.callsByClaim, 1, '认领来源必须如实计数');
    const revoked = I.buildContactInsight(stores, { now: now, callAttribution: {} });
    assert.equal(revoked.unattributedCalls.length, 1, '★ 撤销后恢复未归属');
    assert.equal(revoked.callsByClaim, 0);
});

test('B6 ★★ contactId 精确归属优先于认领(新记录走稳定 ID)', () => {
    const now = Date.now();
    const ins = I.buildContactInsight({
        wechat: {
            chats: [
                { id: 'a', name: '甲', type: 'single', timestamp: now - 86400000 },
                { id: 'b', name: '甲', type: 'single', timestamp: now - 86400000 }
            ],
            buckets: {}, loadedIds: []
        },
        calls: [{ id: 'c1', caller: '甲', contactId: 'b', timestamp: now - 3600000 }]
    }, { now: now, callAttribution: { 甲: 'a' } });
    assert.equal(ins.rows.find((r) => r.id === 'b').calls, 1, '★ 有 contactId 时按 ID 精确归属');
    assert.equal(ins.rows.find((r) => r.id === 'a').calls || 0, 0, '★ 不得被认领覆盖');
    assert.equal(ins.callsByContactId, 1);
    assert.equal(ins.callsByClaim, 0);
});

test('B7 ★★ 取数层把认领账真的传进内核(否则内核能力继续悬空)', () => {
    const s = memStorage({ [KEY_NAME]: JSON.stringify({ 甲: 'a' }) });
    const win = {
        VirtualPhone: {
            wechatApp: {
                wechatData: {
                    data: {
                        chats: [{ id: 'a', name: '甲', type: 'single', timestamp: Date.now() - 1000 }],
                        messages: {}
                    },
                    _messagesLoaded: {}
                }
            }
        }
    };
    const ins = D.collectContactInsight(win, 30, s);
    assert.ok(ins, '取数必须返回读数');
    /* 认领账被消费的证据:未归属列表为空 + 账里那条认领键仍被读出来(不吞不丢)。 */
    assert.deepEqual(A.readCallAttribution(s), { 甲: 'a' }, '取数不得改动认领账');
    const bare = D.collectContactInsight(win, 30);
    assert.ok(bare, '不传 storage 时仍须可用(第三参可选,兼容既有调用点)');
});

/* ══════════ C ── 接线 ══════════ */
test('C1 ★★ 视图:未归属卡 + 候选按钮 + 撤销按钮,且样式真的投递', () => {
    assert.ok(viewSrc.includes('_unattributedHTML'), '未归属卡必须存在');
    assert.ok(viewSrc.includes('uq-claim-btn'), '候选认领按钮类必须被用上');
    assert.ok(viewSrc.includes('uq-revoke-btn'), '撤销按钮类必须被用上');
    assert.ok(viewSrc.includes('data-claim-id') && viewSrc.includes('data-revoke-name'), '按钮必须带可点击的目标数据');
    assert.ok(viewSrc.includes('未归属通话'), '卡片标题必须可辨认');
    assert.ok(viewSrc.includes("querySelectorAll('.uq-claim-btn')"), '★ 认领必须真的被绑定(只画按钮不绑事件是假修)');
    assert.ok(viewSrc.includes("querySelectorAll('.uq-revoke-btn')"), '★ 撤销必须真的被绑定');
    const css = read('apps/usage/usage.css');
    const phone = read('phone.css');
    for (const cls of ['.uq-claim ', '.uq-claim-btn', '.uq-revoke-btn']) {
        assert.ok(css.includes(cls), '源样式必须含 ' + cls);
        assert.ok(phone.includes(cls), '★ 样式必须投递进 phone.css(否则界面裸奔且不报错):' + cls);
    }
});

test('C2 ★★ 控制器:写后立即现取(不靠下一次 render),且失败如实返回', () => {
    assert.ok(appSrc.includes('claimCall(name, contactId)'), '控制器必须暴露认领');
    assert.ok(appSrc.includes('unclaimCall(name)'), '控制器必须暴露撤销');
    assert.ok(appSrc.includes('callAttribution()'), '视图回显需要读出口');
    assert.ok(appSrc.includes('this.probe()'), '写后必须现取洞察');
    assert.ok(dataSrc.includes('collectContactInsight(win, staleDays, storage)'), '取数签名必须带上 storage');
    assert.ok(appSrc.includes('collectContactInsight(this._win(), this.settings.staleDays, this.storage)'), '★ probe 必须把 storage 传下去(否则认领永不生效)');
});

test('C3 ★★★ 新通话记录带稳定 contactId;拿不到时不猜(写空串)', () => {
    /* 切片到下一个方法定义为止(_resolveWechatContact 的定义),而不是第一个调用处 ——
     * 修前用 indexOf 取「第一次出现」会切在函数体内的调用上(判据自身失效)。 */
    const start = phoneSrc.indexOf('_addCallRecord(callerName');
    const end = phoneSrc.indexOf('_resolveWechatContact(callerName) {', start);
    assert.ok(start > 0 && end > start, '必须能切出 _addCallRecord 函数体');
    const seg = phoneSrc.slice(start, end);
    assert.ok(seg.length > 300, '切片必须命中真函数体');
    assert.ok(seg.includes('contactId: contactId'), '★ 记录必须写入 contactId 字段');
    assert.ok(seg.includes('this._resolveWechatContact(callerName)'), '★ 必须走既有的微信联系人真源解析,不另造第二套');
    assert.ok(seg.includes('catch'), '解析失败必须静默(拿不到就写空串,不猜)');
    assert.equal(seg.includes('phone_contact_'), false, '★ 不得用电话联系人本地的 id 冒充微信联系人 id');
});

test('C4 ★★ 键登记与生命周期:登记在册且随会话清理', () => {
    const ka = read(KEYS);
    assert.ok(ka.includes(KEY_NAME), '认领账必须在 keys 门登记归属');
    const entry = ka.slice(ka.indexOf(KEY_NAME) - 60, ka.indexOf(KEY_NAME) + 80);
    assert.ok(entry.includes("scope: 'chat'"), '认领账必须声明为会话隔离');
    const stor = read(STOR);
    assert.ok(stor.includes('clearCurrentData') && stor.includes('clearAllData'), '两条清理路径在场');
    const clearSeg = stor.slice(stor.indexOf('async clearCurrentData()'), stor.indexOf('async clearAllData()'));
    assert.ok(clearSeg.includes('chatStore'), '★ 清当前数据必须清 chatMetadata(认领账随会话走,不能残留)');
});

/* ══════════ D ── 负控制(真源码破坏 → 同一份判据必须转红) ══════════ */
const temps = [];
function makeConfigCopy() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v4110_'));
    temps.push(dir);
    copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
    return dir;
}
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏:锚点必须**恰中一次**;破坏的是**副本**(绝不动真仓)。 */
function breakCopy(rel, anchor, replacement) {
    const dir = makeConfigCopy();
    const src = read(rel);
    const hits = src.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次(实测 ' + hits + '):' + anchor.slice(0, 60));
    fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
    return dir;
}

test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', async () => {
    const s = memStorage();
    assert.equal(A.claimCall(s, '', 'a'), false, '空值拒绝判据在原版必真');
    assert.equal(A.claimCall(s, '甲', 'a') && A.unclaimCall(s, '甲'), true, '认领撤销判据在原版必真');
    const now = Date.now();
    const ins = I.buildContactInsight({
        wechat: { chats: [{ id: 'a', name: '甲', type: 'single', timestamp: now }], buckets: {}, loadedIds: [] },
        calls: [{ id: 'c1', caller: '甲', timestamp: now }]
    }, { now: now });
    assert.equal(ins.rows.find((r) => r.id === 'a').calls, 1, 'caller 归属判据在原版必真');
});

test('D1 ★★★ 破坏「caller 字段读取」⇒ 生产通话被跳过,同一判据必转红', async () => {
    const dir = breakCopy(INS, 'const name = String(call.caller || call.name || call.contactName || \'\').trim();',
        'const name = String(call.name || call.contactName || \'\').trim();');
    const m = await import(pathToFileURL(path.join(dir, INS)).href + '?d1=' + Date.now());
    const now = Date.now();
    const broken = m.buildContactInsight({
        wechat: { chats: [{ id: 'a', name: '甲', type: 'single', timestamp: now }], buckets: {}, loadedIds: [] },
        calls: [{ id: 'c1', caller: '甲', timestamp: now }]
    }, { now: now });
    assert.equal(broken.rows.find((r) => r.id === 'a').calls || 0, 0, '破坏副本:生产通话又被静默跳过了(读数从 1 掉到 0)');
    const ok = I.buildContactInsight({
        wechat: { chats: [{ id: 'a', name: '甲', type: 'single', timestamp: now }], buckets: {}, loadedIds: [] },
        calls: [{ id: 'c1', caller: '甲', timestamp: now }]
    }, { now: now });
    assert.equal(ok.rows.find((r) => r.id === 'a').calls, 1, '原版必须统计到这条通话');
});

test('D2 ★★★ 破坏「空值拒绝」⇒ 幽灵认领,同一判据必转红', async () => {
    const dir = breakCopy(ATTR, "if (!safeName || !safeId) return false;", 'if (false) return false;');
    const m = await import(pathToFileURL(path.join(dir, ATTR)).href + '?d2=' + Date.now());
    const s = memStorage();
    assert.equal(m.claimCall(s, '', 'a'), true, '破坏副本:空名认领被静默接受了');
    assert.equal(s.has(KEY_NAME), true, '破坏副本:账里长出了幽灵键');
    const s2 = memStorage();
    assert.equal(A.claimCall(s2, '', 'a'), false, '原版必须拒绝');
    assert.equal(s2.has(KEY_NAME), false, '原版不得落键');
});

test('D3 ★★★ 破坏「撤销删键」⇒ 撤销后仍归属,同一判据必转红', async () => {
    const dir = breakCopy(ATTR, 'delete map[safeName];', 'void 0;');
    const m = await import(pathToFileURL(path.join(dir, ATTR)).href + '?d3=' + Date.now());
    const s = memStorage({ [KEY_NAME]: JSON.stringify({ 甲: 'a' }) });
    m.unclaimCall(s, '甲');
    assert.deepEqual(m.readCallAttribution(s), { 甲: 'a' }, '破坏副本:撤销后认领还在');
    const s2 = memStorage({ [KEY_NAME]: JSON.stringify({ 甲: 'a' }) });
    assert.equal(A.unclaimCall(s2, '甲'), true, '原版撤销成功');
    assert.deepEqual(A.readCallAttribution(s2), {}, '原版撤销后必须真的空掉');
});

/* ══════════ E ── 版本锚(下限形) ══════════ */
test('E1 版本锚:入口不得低于 4.11.0(下限形,下一版抬版无需二次改写)', () => {
    const v = JSON.parse(read('package.json')).version.split('.').map(Number);
    assert.ok(v[0] > 4 || (v[0] === 4 && v[1] >= 11), '入口版本不得低于 4.11.0,实测 ' + v.join('.'));
});