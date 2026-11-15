/* ========================================================
 * system-v4155.test.mjs — v4.154.0 · R21-X4 照片 EXIF 与剧情时间校准
 * 判据面：验收旅程（10 张无 EXIF → 全进「时间不详」）/ 判定闭集 / 纯读硬证据 /
 *         单一实现纪律 / 产品侧真接线 / 自检同源 / 版本锚。
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    groupAlbumImagesByStoryDay,
    albumPhotoTimeSummary,
    storyStampOfAlbumPhoto,
    isUndatedPhoto,
    albumStoryGroupSelfCheck,
    UNDATED_DAY_KEY,
    UNDATED_GROUP_LABEL,
    ALBUM_STORY_FACES
} from '../config/album-story-face.js';
import { alignOne, photoTimeLabel, PHOTO_TIME_VERDICTS } from '../config/photo-time-align.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- A 组：验收旅程（计划原文的三句话逐句判） ---------- */

test('v4155 A1. 验收旅程：10 张无 EXIF → 全进「时间不详」，没有一张被塞进某一天', () => {
    const tenNoExif = Array.from({ length: 10 }, (_, i) => ({
        id: `photo-${i}`,
        createdAt: 1731600000000 + i
    }));
    const groups = groupAlbumImagesByStoryDay(tenNoExif);
    assert.equal(groups.length, 1, '10 张全进同一个组');
    assert.equal(groups[0].key, UNDATED_DAY_KEY);
    assert.equal(groups[0].undated, true);
    assert.equal(groups[0].label, UNDATED_GROUP_LABEL);
    assert.equal(groups[0].images.length, 10, '10 张全在组里（照常可见，不丢弃）');
    assert.equal(
        groups[0].images.some(image => image.dayKey),
        false,
        '没有任何一张被塞进具体日期'
    );
});

test('v4155 A2. 判定只认剧情轨：createdAt（墙钟）绝不救场', () => {
    const image = { id: 'x', storyAt: '', createdAt: 1731600000000 };
    assert.equal(isUndatedPhoto(image), true, 'storyAt 空（读不到剧情钟时写入的形态）⇒ 时间不详');
    assert.equal(storyStampOfAlbumPhoto(image).ms, null);
    assert.equal(storyStampOfAlbumPhoto(image).dateKey, '');
    const withStory = { id: 'y', storyAt: 1731600000000, createdAt: 1 };
    assert.equal(isUndatedPhoto(withStory), false, '有剧情轨 ⇒ 不详');
    assert.equal(storyStampOfAlbumPhoto(withStory).dateKey.length, 10, 'YYYY-MM-DD 键');
    assert.equal(isUndatedPhoto({ id: 'z' }), true, '历史条目没有 storyAt ⇒ 时间不详');
    assert.equal(isUndatedPhoto({ id: 'w', storyAt: 0 }), true, '0 不是可用时刻，不是「纪元零点拍的」');
});

test('v4155 A3. 剧情日期分组：按本地年月日切组，组 label 不冒充「今天」', () => {
    const day = (n) => {
        const date = new Date(0);
        date.setFullYear(2026, 10, n);   // 2026-11-n
        date.setHours(15, 30, 0, 0);
        return { id: `d${n}`, storyAt: date.getTime() };
    };
    const groups = groupAlbumImagesByStoryDay([day(3), day(3), day(4), { id: 'u', createdAt: 1 }]);
    assert.equal(groups.length, 3, '两天 + 一个时间不详组');
    assert.deepEqual(groups.map(group => group.label), ['2026-11-03', '2026-11-04', UNDATED_GROUP_LABEL]);
    assert.equal(groups[0].images.length, 2);
    assert.ok(!groups[0].label.includes('今天'), '组头不写「（今天）」');
    assert.ok(!groups[1].label.includes('今天'));
});

test('v4155 A4. 汇总面：dated / undated 如实计数，无钟时 face=NO_CLOCK 且 DRIFTED 结构上不出现', () => {
    const story = { ok: true, ms: 1000, reason: 'ok', source: 'chat' };
    const photos = [
        { id: 'a', storyAt: 1000 },
        { id: 'b', storyAt: 1000 },
        { id: 'c', createdAt: 999 },
        { id: 'd' }
    ];
    Object.freeze(photos);
    const summary = albumPhotoTimeSummary(photos, null, { story });
    assert.equal(summary.total, 4);
    assert.equal(summary.dated, 2);
    assert.equal(summary.undated, 2);
    assert.equal(summary.face, ALBUM_STORY_FACES.CLOCK_OK, '注入的 story 可读 ⇒ CLOCK_OK');
    assert.equal(summary.counts[PHOTO_TIME_VERDICTS.ALIGNED], 2, '同钟读数一致 ⇒ aligned');
    assert.equal(summary.counts[PHOTO_TIME_VERDICTS.NO_EXIF], 2);
    assert.equal(summary.counts[PHOTO_TIME_VERDICTS.DRIFTED], 0, '同一只钟量两次，不会有偏差');
    assert.equal(JSON.stringify(photos), JSON.stringify([
        { id: 'a', storyAt: 1000 },
        { id: 'b', storyAt: 1000 },
        { id: 'c', createdAt: 999 },
        { id: 'd' }
    ]), '冻结入参序列化逐字不变（纯读）');
    const noClock = albumPhotoTimeSummary(photos, null);
    assert.equal(noClock.face, ALBUM_STORY_FACES.NO_CLOCK, '无宿主 ⇒ NO_CLOCK，不回落墙钟');
    assert.equal(noClock.story.ms, null);
    assert.equal(noClock.rows.every(row => row.verdict === PHOTO_TIME_VERDICTS.NO_STORY_CLOCK
        || row.verdict === PHOTO_TIME_VERDICTS.NO_EXIF
        || row.verdict === PHOTO_TIME_VERDICTS.NO_EXIF_STAMP), true);
});

/* ---------- B 组：内核判定闭集（photo-time-align 直测，同源护栏） ---------- */

test('v4155 B1. 校准仪五态闭集与文案单出口（含 label 单一来源）', () => {
    const story = { ok: true, ms: 1000, reason: 'ok', source: 'chat' };
    assert.equal(alignOne({ exif: { timestamp: 1000 } }, story).verdict, PHOTO_TIME_VERDICTS.ALIGNED);
    const drifted = alignOne({ exif: { timestamp: 500 } }, story);
    assert.equal(drifted.verdict, PHOTO_TIME_VERDICTS.DRIFTED);
    assert.equal(drifted.direction, 'before');
    assert.ok(photoTimeLabel(drifted).includes('早于'));
    assert.equal(alignOne({}, story).verdict, PHOTO_TIME_VERDICTS.NO_EXIF);
    assert.ok(photoTimeLabel(alignOne({}, story)).startsWith('时间不详'), '无 EXIF ⇒ 「时间不详」起头');
    assert.equal(alignOne({ exif: {} }, story).verdict, PHOTO_TIME_VERDICTS.NO_EXIF_STAMP);
    assert.equal(alignOne({ exif: { timestamp: 2000 } }, null).verdict, PHOTO_TIME_VERDICTS.NO_STORY_CLOCK);
});

/* ---------- C 组：纯读与单一实现纪律 ---------- */

test('v4155 C1. 桥零写路径、冻结入参、label 只从 photoTimeLabel 出', () => {
    const src = read('config/album-story-face.js');
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/'[^'\n]*'/g, ' ')
        .replace(/"[^"\n]*"/g, ' ');
    assert.ok(!/Date\.now/.test(code), '桥里不许出现 Date.now（绝不拿墙钟猜）');
    assert.ok(!/(localStorage|sessionStorage)|\.set\(\s*['"]|JSON\.parse/.test(code), '桥零写/零读存储路径（Map.set 带非字面量键不算写存储）');
    assert.ok(/from '\.\/photo-time-align\.js'/.test(src), '桥必须消费校准仪（不复制第二套判定）');
    /* 自检不需要任何宿主注入就能跑通（「无钟态」本身是它要验的形态之一）。 */
    const check = albumStoryGroupSelfCheck();
    assert.equal(check.ok, true, '自检零依赖跑通');
});

test('v4155 C2. 数据层出口全是透传：判定不落第二份', () => {
    const src = read('apps/album/album-data.js');
    assert.ok(src.includes("from '../../config/album-story-face.js'"), 'AlbumData 必须消费桥');
    assert.ok(src.includes('groupImagesByStoryDay(images) {\n        return groupAlbumImagesByStoryDay(images)'), '分组透传');
    assert.ok(src.includes('return albumPhotoTimeSummary(images, win)'), '汇总透传');
    assert.ok(src.includes("return photoTimeLabel(alignOne("), '文案走单一出口');
    assert.ok(src.includes('isImageUndated(image) {\n        return isUndatedPhoto(image)'), '不详判定透传（视图消费它）');
});

test('v4155 C3. 视图只排版：时间角标 / 日子分组 / 预览时间行接在真接线上', () => {
    const view = read('apps/album/album-view.js');
    assert.ok(view.includes('isImageUndated(image)'), '角标判定走数据层出口');
    assert.ok(view.includes('renderStoryDaySections(shownImages)'), '来源组内部切日子');
    assert.ok(view.includes('album-tile-time is-undated'), '时间不详角标有独立形态');
    assert.ok(view.includes('album-preview-time'), '预览页有时间行');
    assert.ok(view.includes('photoTimeLabelOf(image, window)'), '预览文案走数据层出口');
    const css = read('apps/album/album.css');
    assert.ok(css.includes('.album-story-day-section.is-undated'), '不详组视觉不同形');
    assert.ok(css.includes('.album-tile-time.is-undated'), '角标不详形态');
});

test('v4155 C4. 装配点消费自检 + 版本参数已抬', () => {
    const app = read('apps/album/album-app.js');
    assert.ok(app.includes('photoTimeSelfCheck()'), '装配点跑桥自检');
    assert.ok(app.includes('v=1.4.3&r=20261115-album-story-day'), 'import 版本参数已升');
    assert.equal(read('config/photo-time-align.js').includes('photoTimeSelfCheck'), true);
    const check = albumStoryGroupSelfCheck();
    assert.equal(check.ok, true, '桥自检同源通过');
    assert.equal(check.undatedCount, 1, '自检里 createdAt 有值但无 storyAt ⇒ 只算 1 张不详');
});

test('v4155 C5. 版本锚：4.154.0 五源同源', () => {
    /* [v4.155.0 交棒改写·下限形] 精确钉 4.154.0 在抬版后必红；按 v4154 C2 惯例
     *   改写为下限形：五源仍必须互相同源，且不得低于本版发布时的 4.154.0。 */
    const pkg = JSON.parse(read('package.json'));
    const ver = pkg.version;
    const cmp = (a, b) => {
        const A = a.split('.').map(Number), B = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; }
        return 0;
    };
    assert.ok(cmp(ver, '4.154.0') >= 0, '版本低于本版下限：' + ver);
    const man = JSON.parse(read('manifest.json'));
    assert.equal(man.version, ver, 'manifest 与 package 同源');
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, ver, 'update-log.latest 同源');
    assert.ok(read('index.js').includes("ST_PHONE_VERSION = '" + ver + "'"), 'index 版本常量同源');
    assert.ok(read('update-log.json').includes('【版本升至 4.154.0（五源同源）】R21-X4'), '历史条目真源在场');
    assert.ok(read('ITERATION_LOG.md').includes('## 迭代 274 · v4.154.0 · R21-X4'));
});
