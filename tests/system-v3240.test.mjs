// tests/system-v3240.test.mjs — L0 静态素材的**真消费点**与唯一取数口 [v3.24.0]
//
//   本版接的是素材缝合路线图（INVENTORY_V2.md）的第 0 层：四类纯静态素材已落盘
//   `assets/frames`（26 套画框）/ `assets/share-icons`（25 个平台图标）/
//   `assets/textures`（3 张纸纹）/ `assets/sounds/ambience`（5 条环境音）。
//   落盘本身**不是集成** —— 本仓最贵的形态是「建好了却没人用」：素材躺在磁盘上，
//   不报错、不崩溃、只是没有任何界面看得见它。
//
//   故本套件守三件事（每件都对应一条具体的、会静默失效的形态）：
//     ① **清册 ↔ 磁盘一致**（A 段）：`config/l0-assets.js` 声明的每个 key 必须在
//        `assets/` 下真有文件，且 URL 尾段形态正确 —— 拼错一条路径，界面上只是「图破了」，
//        而读数上看起来「有引用」；
//     ② **白名单是准入闸不是放行条**（A3）：不在册的 key 必须返回**空串**，
//        不得拼出一条指不到的路径（本仓 E10 / R2b / R3b 同族纪律）；
//     ③ **四类素材各有真消费点**（B 段）：纸纹 → 阅读器 paper 主题；画框 → 日记封面；
//        环境音 → 音乐场景环境音；图标 → 相册分享面板。这四处都在**产品文件**里
//        （测试不算消费），任何一处被摘掉，本段即红。
//
//   负控制纪律（本仓统一口径）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。故判据函数一律不解析副本的 `import.meta.url`
//   （副本在 /tmp 下，解析出来的路径必然不存在 ⇒ 那会造出与破坏无关的假红）：
//   「cl清单 ↔ 磁盘」这件事一律以**仓根**为基准现拼路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { L0_ASSETS, galleryFrameUrl, shareIconUrl } from '../config/l0-assets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC_REL = 'config/l0-assets.js';
const SRC = path.join(ROOT, SRC_REL);
const SRC_TXT = fs.readFileSync(SRC, 'utf8');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 四类素材的落点与下限（下限刻意低于真实值：它挡的是「清册塌成空表」，
 *   不是「有人删了一套画框」——后者是产品决定，不该由本套件代判）。 */
const CLASSES = [
    { name: 'frames', dir: 'frames', ext: '.webp', floor: 20 },
    { name: 'icons', dir: 'share-icons', ext: '.webp', floor: 20 },
    { name: 'textures', dir: 'textures', ext: '.png', floor: 3 },
    { name: 'ambience', dir: 'sounds/ambience', ext: '.mp3', floor: 3 }
];

/* ── 判据本体（纯函数，可对真模块或破坏副本跑） ── */

/** ① 形状：每类都是 `{ key, label, url }[]`，且 key 在本类内唯一。 */
function shapeProblems(assets) {
    const bad = [];
    for (const c of CLASSES) {
        const list = assets?.[c.name];
        if (!Array.isArray(list) || list.length === 0) {
            bad.push(c.name + ':not-array');
            continue;
        }
        if (list.length < c.floor) bad.push(c.name + ':below-floor:' + list.length);
        const seen = new Set();
        for (const item of list) {
            if (!item || typeof item.key !== 'string' || !item.key) { bad.push(c.name + ':no-key'); continue; }
            if (typeof item.label !== 'string' || !item.label) bad.push(c.name + ':no-label:' + item.key);
            if (typeof item.url !== 'string' || !item.url) bad.push(c.name + ':no-url:' + item.key);
            if (seen.has(item.key)) bad.push(c.name + ':dup-key:' + item.key);
            seen.add(item.key);
        }
    }
    return bad;
}

/** ② 清册 ↔ 磁盘：每个 key 真有一份文件，且 URL 尾段是 `<dir>/<key><ext>`。 */
function missingOnDisk(assets) {
    const miss = [];
    for (const c of CLASSES) {
        const list = assets?.[c.name] || [];
        for (const item of list) {
            if (!item || typeof item.key !== 'string' || !item.key) { miss.push(c.name + ':bad-item'); continue; }
            const abs = path.join(ROOT, 'assets', c.dir, item.key + c.ext);
            if (!fs.existsSync(abs)) miss.push(c.name + '/' + item.key + ':file-missing');
            const tail = c.dir + '/' + item.key + c.ext;
            if (typeof item.url !== 'string' || !item.url.endsWith(tail)) {
                miss.push(c.name + '/' + item.key + ':url-form');
            }
        }
    }
    return miss;
}

/** ③ 白名单：不在册的 key（含空串）必须返回空串，不得拼出一条指不到的路径。 */
function unknownKeyLeaks(api) {
    const leaks = [];
    if (api.galleryFrameUrl('__not_a_frame__') !== '') leaks.push('frame-unknown');
    if (api.galleryFrameUrl('') !== '') leaks.push('frame-empty');
    if (api.galleryFrameUrl('Baroque') !== '') leaks.push('frame-case');
    if (api.shareIconUrl('__not_an_icon__') !== '') leaks.push('icon-unknown');
    if (api.shareIconUrl('') !== '') leaks.push('icon-empty');
    return leaks;
}

/* ══════════ A ── 取数口：形状 / 磁盘一致 / 白名单 ══════════ */
test('A1 四类形状同构（key/label/url 齐备且 key 唯一，清册未塌成空表）', () => {
    const bad = shapeProblems(L0_ASSETS);
    assert.deepEqual(bad, [], '取数口形状必须齐备，实测问题：' + bad.join(' , '));
    for (const c of CLASSES) {
        assert.equal(L0_ASSETS[c.name].length >= c.floor, true,
            c.name + ' 条数必须 ≥ ' + c.floor + '，实测 ' + L0_ASSETS[c.name].length);
    }
});

test('A2 清册 ↔ 磁盘一致（每个 key 真有文件，URL 尾段形态正确）', () => {
    const miss = missingOnDisk(L0_ASSETS);
    assert.deepEqual(miss, [], '清册里的 key 必须在 assets/ 下有对应文件，实测问题：' + miss.join(' , '));
    /* 反向自证：磁盘上的真实文件数不得多于清册（多于 = 有素材落了盘但没人取得到）。 */
    for (const c of CLASSES) {
        const dirAbs = path.join(ROOT, 'assets', c.dir);
        const files = fs.readdirSync(dirAbs).filter((n) => n.endsWith(c.ext));
        /* 画框每套两张（主图 + `-m` 缩略），故 frames 的磁盘数 = 清册 × 2 */
        const expect = c.name === 'frames' ? L0_ASSETS.frames.length * 2 : L0_ASSETS[c.name].length;
        assert.equal(files.length, expect,
            c.name + ' 磁盘文件数必须等于清册推得数（' + expect + '），实测 ' + files.length);
    }
});

test('A3 白名单是准入闸：不在册的 key 一律返回空串（不拼指不到的路径）', () => {
    const leaks = unknownKeyLeaks({ galleryFrameUrl, shareIconUrl });
    assert.deepEqual(leaks, [], '白名单外的 key 必须返回空串，实测泄漏：' + leaks.join(' , '));
    /* 对照：在册的 key 必须真给出 URL（否则白名单成了「一律放空」的假闸）。 */
    assert.ok(galleryFrameUrl('baroque').endsWith('frames/baroque.webp'), '在册画框 key 必须给出真 URL');
    assert.ok(shareIconUrl('weibo').endsWith('share-icons/weibo.webp'), '在册图标 key 必须给出真 URL');
});

/* ══════════ B ── 四类素材各自的真消费点（都在产品文件里） ══════════ */
test('B1 纸纹 → 阅读器 paper 主题（bgImage 面 + 主题清单单一真源）', () => {
    const src = read('apps/reading/reading-view.js');
    assert.ok(src.includes("from '../../config/l0-assets.js'"), '阅读器必须从取数口取素材');
    assert.ok(src.includes('PAPER_THEME_TEXTURE'), 'paper 主题必须绑到 L0 纸纹');
    assert.ok(src.includes("'parchment', 'paper', 'night', 'ink'"), '主题清单必须含 paper（单一真源）');
    assert.ok(src.includes('bgImage'), '主题表必须带 bgImage 面');
    /* 不得自己拼 assets 路径（路径只在取数口一处拼） */
    assert.equal(src.includes("'../../assets/"), false, '阅读器不得自持 assets 路径');
});

test('B2 画框 → 日记封面（数据层白名单校验 + 视图层选择器）', () => {
    const data = read('apps/diary/diary-data.js');
    const view = read('apps/diary/diary-view.js');
    assert.ok(data.includes('galleryFrameUrl'), '日记数据层必须用取数口的白名单校验');
    assert.ok(data.includes('global_diary_cover_frame'), '封面画框必须落到已登记的键上');
    assert.ok(view.includes('diary-cover-frame'), '封面必须渲染画框层');
    assert.ok(view.includes('data-diary-frame'), '设置页必须给出画框选择器');
    assert.ok(view.includes('L0_ASSETS.frames.map'), '选择器必须由取数口清单生成（不手抄一份）');
});

test('B3 环境音 → 音乐场景环境音（惰性创建 + 不新增 storage 键）', () => {
    const ambience = read('apps/music/music-ambience.js');
    const view = read('apps/music/music-view.js');
    assert.ok(ambience.includes('L0_ASSETS.ambience'), '环境音清单必须来自取数口');
    assert.ok(ambience.includes('setAmbience('), '必须提供切换环境音的出口');
    assert.ok(view.includes('music-ambience-chips'), '设置页必须给出环境音选择器');
    /* 键复用：不得为环境音新开 storage 键（新键要登记，动作类状态不值得） */
    assert.equal(/ambienceKey[\s\S]{0,40}storage\.set\(/.test(ambience), false, '环境音不得新开 storage 键');
    assert.ok(ambience.includes("KEY = 'ruby_phone_lyrics_settings'"), '环境音必须复用已登记的设置键');
});

test('B4 平台图标 → 相册分享面板（图标全走取数口）', () => {
    const view = read('apps/album/album-view.js');
    assert.ok(view.includes('shareIconUrl'), '分享面板必须用取数口的图标 URL');
    assert.ok(view.includes('L0_ASSETS.icons.map'), '图标列表必须由取数口清单生成');
    assert.ok(view.includes('album-share-sheet'), '必须真有分享面板 DOM');
    assert.equal(view.includes("'../../assets/"), false, '相册不得自持 assets 路径');
});

/* ══════════ C ── 键归属（新键必须在门禁账本里） ══════════ */
test('C1 本版新增的 storage 键必须在 keys 门账本里登记且声明 scope', () => {
    const keysAudit = read('scripts/keys-audit.mjs');
    const data = read('apps/diary/diary-data.js');
    /* 从产品代码里取键名（不手抄），再要求账本里有它 */
    const hits = [...data.matchAll(/'(global_diary_cover_frame)'/g)].map((m) => m[1]);
    assert.ok(hits.length >= 2, '键名必须真的在产品代码里出现（读 + 写），实测 ' + hits.length);
    const key = hits[0];
    const reg = new RegExp("\\{ key: '" + key + "', scope: '(chat|global|legacy)'");
    assert.ok(reg.test(keysAudit), '新键 ' + key + ' 必须在 KEY_REGISTRY 登记并声明 scope');
});

/* ══════════ D ── 负控制（真源码破坏 → 加载副本 → 同款真判据必须转红） ══════════ */
function loadDamagedCopy(splitFrom, splitTo) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_l0assets_'));
    const target = path.join(dir, 'l0-assets.js');
    const hits = SRC_TXT.split(splitFrom).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + splitFrom.slice(0, 60));
    const damaged = SRC_TXT.split(splitFrom).join(splitTo);
    assert.notEqual(damaged, SRC_TXT, '破坏必须真的发生');
    fs.writeFileSync(target, damaged);
    return import(pathToFileURL(target).href);
}

test('D1 破坏清册（把某套画框的 key 改成磁盘上不存在的名字）⇒ A2 同款判据必须转红', async () => {
    const mod = await loadDamagedCopy("{ key: 'baroque', label: '巴洛克' }", "{ key: 'baroque_zzz', label: '巴洛克' }");
    const miss = missingOnDisk(mod.L0_ASSETS);
    assert.ok(miss.some((m) => m.startsWith('frames/baroque_zzz')),
        '破坏后同款判据必须报出「清册里有、磁盘上没有」，实测：' + miss.join(' , '));
    /* 对照：真清册上同款判据仍为真（否则判据是死的） */
    assert.deepEqual(missingOnDisk(L0_ASSETS), [], '对照：真清册必须无缺失');
});

test('D2 摘掉白名单校验 ⇒ A3 同款判据必须转红（负控制两向都真）', async () => {
    const mod = await loadDamagedCopy(
        "return FRAME_KEYS.includes(key) ? assetUrl('frames/' + key + '.webp') : '';",
        "return assetUrl('frames/' + key + '.webp');"
    );
    const leaks = unknownKeyLeaks({ galleryFrameUrl: mod.galleryFrameUrl, shareIconUrl: mod.shareIconUrl });
    assert.ok(leaks.includes('frame-unknown') || leaks.includes('frame-empty'),
        '摘掉白名单后未知 key 必然泄漏出一条 URL，实测：' + leaks.join(' , '));
    /* 对照：真实现的同款判据仍无泄漏 */
    assert.deepEqual(unknownKeyLeaks({ galleryFrameUrl, shareIconUrl }), [], '对照：真实现必须无泄漏');
});

/* ══════════ E ── 版本锚 ══════════ */
test('E1 版本锚（下限形）+ 三源同源', () => {
    const manV = JSON.parse(read('manifest.json')).version;
    const pkgV = JSON.parse(read('package.json')).version;
    const src = read('index.js');
    const parts = manV.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 24),
        '本套件成立于 RubyPhone 3.24.0 及以后，当前 ' + manV);
    assert.equal(pkgV, manV, 'package.json 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + manV + "';"), '入口版本常量必须与 manifest 同版');
});
