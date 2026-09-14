import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, createUpdateChecker } from '../phone/update-checker.js';

// ============ compareSemver 纯函数 ============
test('compareSemver: 基本比较', () => {
    assert.equal(compareSemver('2.8.13', '2.8.12'), 1);
    assert.equal(compareSemver('2.8.12', '2.8.13'), -1);
    assert.equal(compareSemver('2.8.13', '2.8.13'), 0);
});
test('compareSemver: 带 v 前缀与缺段', () => {
    assert.equal(compareSemver('v2.9.0', '2.8.13'), 1);
    assert.equal(compareSemver('2.8', '2.8.0'), 0);
    assert.equal(compareSemver('3.0', '2.8.13'), 1);
});
test('compareSemver: 非数字段按 0 处理', () => {
    assert.equal(compareSemver('2.8.x', '2.8.0'), 0);
    assert.equal(compareSemver('', '0.0.0'), 0);
});

// ============ createUpdateChecker 工厂 ============
const DEPS = {
    ST_PHONE_VERSION: '2.8.13',
    ST_PHONE_CURRENT_UPDATE: { version: '2.8.13', date: '2026-09-14', items: ['拆解更新簇'] },
    ST_PHONE_UPDATE_MANIFEST_URLS: [],
    ST_PHONE_UPDATE_LOG_URLS: [],
    ST_PHONE_LOCAL_UPDATE_LOG_URL: './update-log.json',
};

test('createUpdateChecker: 暴露全部方法', () => {
    const uc = createUpdateChecker(DEPS);
    for (const m of ['setStorage','getKnownUpdateNotes','fetchLocalUpdateNotes','showPhoneUpdateModal',
        'showLocalUpdateAnnouncementIfNeeded','checkRemotePhoneUpdate','fetchRemoteUpdateNotes','schedulePhoneUpdateNotices']) {
        assert.equal(typeof uc[m], 'function', `缺方法 ${m}`);
    }
});

test('getKnownUpdateNotes: 当前版本返回内置说明', () => {
    const uc = createUpdateChecker(DEPS);
    const cur = uc.getKnownUpdateNotes('2.8.13');
    assert.deepEqual(cur, DEPS.ST_PHONE_CURRENT_UPDATE);
});
test('getKnownUpdateNotes: 未知版本返回空兜底', () => {
    const uc = createUpdateChecker(DEPS);
    const other = uc.getKnownUpdateNotes('9.9.9');
    assert.equal(other.version, '9.9.9');
    assert.deepEqual(other.items, []);
});
test('getKnownUpdateNotes: 缺省用当前版本', () => {
    const uc = createUpdateChecker(DEPS);
    assert.deepEqual(uc.getKnownUpdateNotes(), DEPS.ST_PHONE_CURRENT_UPDATE);
});

test('showLocalUpdateAnnouncementIfNeeded: storage 未注入时安全返回', async () => {
    const uc = createUpdateChecker(DEPS);
    // 不 setStorage，应短路返回 undefined（不抛错）
    const r = await uc.showLocalUpdateAnnouncementIfNeeded();
    assert.equal(r, undefined);
});
test('showLocalUpdateAnnouncementIfNeeded: 已见过当前版本则返回 false', async () => {
    const uc = createUpdateChecker(DEPS);
    uc.setStorage({ get: (k) => '2.8.13', set: async () => {} });
    const r = await uc.showLocalUpdateAnnouncementIfNeeded();
    assert.equal(r, false);
});
test('checkRemotePhoneUpdate: storage 未注入时安全返回', async () => {
    const uc = createUpdateChecker(DEPS);
    await assert.doesNotReject(() => uc.checkRemotePhoneUpdate());
});
test('checkRemotePhoneUpdate: 空 manifest URL 列表时不抛错', async () => {
    const uc = createUpdateChecker(DEPS);
    const store = {};
    uc.setStorage({ get: (k) => store[k] || '', set: async (k, v) => { store[k] = v; } });
    // 无 window.fetch 环境下 node 中 window 未定义会走 !window.fetch 分支
    await assert.doesNotReject(() => uc.checkRemotePhoneUpdate());
});