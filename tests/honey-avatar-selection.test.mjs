import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// [v2.28.0] honey-view.js 自本版起引入运行时内核依赖（实例级资源域）。
//   本测试经 data: URL 加载源码以隔离执行，而 data: URL 无 base 无法解析相对 specifier，
//   故在装入前把相对 import 重写成与源码解析结果一致的绝对 file:// URL（等价加载，不改语义）。
//   ★ [v3.12.0] 源码新增第二条相对 import（`config/num-gate.js` —— 全仓取数唯一实现）。
//   漏重写会让本文件在 import 期直接抛 ERR_UNSUPPORTED_RESOLVE_REQUEST（整文件失败），
//   tests/system-v228.test.mjs 的 data: URL 回归护栏就是钉这个形态的（它如期报红，故此处补齐）。
const source = fs
    .readFileSync(new URL('../apps/honey/honey-view.js', import.meta.url), 'utf8')
    .replace(
        '../../config/runtime-lifecycle.js',
        new URL('../config/runtime-lifecycle.js', import.meta.url).href
    )
    .replace(
        '../../config/num-gate.js',
        new URL('../config/num-gate.js', import.meta.url).href
    );
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { HoneyView } = await import(moduleUrl);

const createView = () => {
    const view = Object.create(HoneyView.prototype);
    view._avatarManifest = {
        hostMale: ['host-m1.png', 'host-m2.png'],
        hostFemale: ['host-f1.png', 'host-f2.png'],
        male: ['m1.png', 'm2.png', 'm3.png', 'm4.png'],
        female: ['f1.png', 'f2.png', 'f3.png', 'f4.png'],
        audience: ['legacy-f1.png', 'legacy-f2.png', 'legacy-f3.png'],
        all: ['all-1.png']
    };
    return view;
};

test('male account sees female hosts and male audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(false, { gender: 'male' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'male-user-room', host: 'host', viewers: '12k' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'female',
        preferredAudienceGender: 'male'
    });
    assert.match(avatars.hostAvatarUrl, /^host-f/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^m\d/.test(url)), true);
});

test('female account sees male hosts and female audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(false, { gender: 'female' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'female-user-room', host: 'host', viewers: '8k' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'male',
        preferredAudienceGender: 'female'
    });
    assert.match(avatars.hostAvatarUrl, /^host-m/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^f\d/.test(url)), true);
});

test('user live uses opposite-gender audience avatars', () => {
    const view = createView();
    const preferences = view._resolveLiveAvatarGenderPreferences(true, { gender: 'male' });
    const avatars = view._buildLiveAvatarSet({ _topicKey: 'topic_user_live', host: 'me', viewers: '25' }, preferences);

    assert.deepEqual(preferences, {
        preferredHostGender: 'male',
        preferredAudienceGender: 'female'
    });
    assert.match(avatars.hostAvatarUrl, /^host-m/);
    assert.equal(avatars.audienceAvatarUrls.every(url => /^f\d/.test(url)), true);
});

test('avatar manifest supports dedicated female host pools', () => {
    const view = Object.create(HoneyView.prototype);
    view._getHoneyAssetUrl = path => `/apps/honey/${path}`;
    const manifest = view._normalizeAvatarManifest({
        hostFemale: ['host-f.png'],
        host_female: ['host-fallback.png']
    });

    assert.deepEqual(manifest.hostFemale, [
        '/apps/honey/avatars/host-f.png',
        '/apps/honey/avatars/host-fallback.png'
    ]);
});
