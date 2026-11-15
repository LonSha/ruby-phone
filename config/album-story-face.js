/* ========================================================
 * config/album-story-face.js
 * RubyPhone v4.154.0 · R21-X4 相册照片时间面（EXIF/剧情轨 →「时间不详」）唯一桥
 *
 * 【为什么要有这座桥】
 *   计划 R21-X4 的验收语：「相册按剧情日期分组；『📷 时间不详』单独一组且可见；
 *   导入 10 张无 EXIF 照片 → 10 张全进『时间不详』，没有一张被塞进『今天』。」
 *   本仓已有的事实：上传索引给每条影像写了**两条轨**——`storyAt`（剧情轨，
 *   写点读不到剧情钟时是空串 ⇒ 相册读成 null）与 `createdAt`（墙钟，恒有值）。
 *   「谁算时间不详」若散在视图里各写一遍，最便宜的写法就是 `|| createdAt`——
 *   那正是验收要拦的形态：把「不知道什么时候拍的」演成「今天拍的」。
 *
 * 【本桥只做三件事，全是纯读】
 *   ① 判定：照片**只认剧情轨**（`storyAt`，经 `storyTsOf` 同款口径）；读不到
 *      ⇒ 时间不详，**绝不回退 `createdAt`**、绝不拿墙钟或 `Date.now()` 猜。
 *   ② 分组：按剧情日期（本地年月日）切组；时间不详的进独立一组（键
 *      `UNDATED_DAY_KEY`），照常显示，不隐藏不丢弃。
 *   ③ 文案：只消费 `photo-time-align.js` 的 `alignOne` / `photoTimeLabel`
 *      单一出口——本桥不发明第二套判定词。
 *
 * 【与 EXIF 的关系如实说】
 *   相册索引里没有真正的 EXIF 块；索引里的 `storyAt` 就是这条影像自带的
 *   「拍摄时刻」，而它本来就在剧情钟坐标上。把形状直译成 `exif.timestamp`
 *   喂进同一台校准仪（`alignOne`），得到与 EXIF 面同一套判定闭集与文案；
 *   因为两枚读数同钟，`DRIFTED` 在本面**结构上不会出现**——这不是缺陷，
 *   是「同一只钟量两次」的必然读数。
 * ======================================================== */

import { numOrNull } from './num-gate.js';
import { alignAlbum, photoTimeLabel, PHOTO_TIME_VERDICTS } from './photo-time-align.js';

/** 内部：把相册影像翻译成 `photo-time-align` 校准仪认的照片形状（不导出，判定不外泄第二份）。
 *  注意：`alignOne` 只读**顶层** `photo.exif`，故 EXIF 形状必须平铺在本体上，不能包一层。 */
function translateAlbumPhoto(image) {
    const stamp = storyStampOfAlbumPhoto(image);
    return {
        id: typeof image?.id === 'string' ? image.id : '',
        dayKey: stamp.dateKey,
        photoMs: stamp.ms,
        exif: stamp.ms === null ? undefined : { timestamp: stamp.ms }
    };
}

/** 「时间不详」组的固定键（显示面按它识别，绝不与任何真实日期键相撞）。 */
export const UNDATED_DAY_KEY = 'undated';

/** 「时间不详」组的固定文案（含 📷 前缀，验收原文措辞）。 */
export const UNDATED_GROUP_LABEL = '📷 时间不详';

/** 剧情钟可用性二态：分组的「（今天）」后缀与预览读数都看它，不各自重判。 */
export const ALBUM_STORY_FACES = Object.freeze({
    CLOCK_OK: 'clock-ok',
    NO_CLOCK: 'no-clock'
});

function positiveMs(value) {
    const number = numOrNull(value);
    return number !== null && number > 0 ? number : null;
}

/** 毫秒 → 本地年月日键（`YYYY-MM-DD`）。与 time-manager 的剧情历同用本地时区。 */
function dayKeyOfMs(ms) {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    const pad2 = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 相册照片的拍摄时刻**只认剧情轨** `storyAt`（与 `storyTsOf` 同口径：不回退任何墙钟字段）。 */
function storyStampOf(image) {
    return positiveMs(image?.storyAt);
}

/**
 * 单张照片的时间读数：`{ ms, dateKey }`。`ms === null` 即时间不详（`dateKey` 为空串）。
 * 这里的 `null` 与「照片是 1970 纪元零点拍的」**不同形**——`numOrNull` + `> 0` 兜住。
 */
export function storyStampOfAlbumPhoto(image) {
    const ms = storyStampOf(image);
    return { ms, dateKey: ms === null ? '' : dayKeyOfMs(ms) };
}

/** 这张照片算不算「时间不详」。判定只此一处，视图与数据层都走本函数。 */
export function isUndatedPhoto(image) {
    return storyStampOf(image) === null;
}

/**
 * 按剧情日期切组（纯函数，不改入参、不排序——入参顺序即组序与格序）。
 *
 * · 有剧情时刻 ⇒ 按本地年月日一组，键与 label 都是 `YYYY-MM-DD` ——
 *   **不写「（今天）」**：组头只能断言「照片落在剧情历的这一天」，
 *   当前剧情钟读数与它未必同日，写了就是冒充；
 * · 没有剧情时刻 ⇒ 全部进**同一个** `UNDATED_DAY_KEY` 组，照常可见；
 */
export function groupAlbumImagesByStoryDay(images) {
    const list = Array.isArray(images) ? images : [];
    const groups = [];
    const byKey = new Map();
    for (const image of list) {
        if (!image || typeof image !== 'object') continue;
        const ms = storyStampOf(image);
        const key = ms === null ? UNDATED_DAY_KEY : dayKeyOfMs(ms);
        if (!key) continue;
        let group = byKey.get(key);
        if (!group) {
            group = {
                key,
                dayKey: ms === null ? '' : key,
                storyMs: ms,
                undated: ms === null,
                label: ms === null ? UNDATED_GROUP_LABEL : key,
                images: []
            };
            byKey.set(key, group);
            groups.push(group);
        }
        group.images.push(image);
    }
    return groups;
}

/**
 * 整册时间面汇总（纯读）。`win` 缺省或剧情钟读不到 ⇒ `face: NO_CLOCK`，
 * 绝不回落墙钟；`counts` 与 `undated` 都是**如实计数**，不压平不猜测。
 */
export function albumPhotoTimeSummary(images, win, options = {}) {
    const list = Array.isArray(images) ? images : [];
    /* 聚合走 `alignAlbum` 唯一实现：本桥只做「相册影像 → 校准仪照片」的翻译，
     * 逐行判定、计数、worstDrift 全是校准仪的事，不在这里抄第二遍。 */
    const translated = list.map(translateAlbumPhoto);
    const report = alignAlbum(translated, win, options);
    let dated = 0;
    for (const row of report.rows) {
        if (row.verdict !== PHOTO_TIME_VERDICTS.NO_EXIF
            && row.verdict !== PHOTO_TIME_VERDICTS.NO_EXIF_STAMP) dated += 1;
    }
    return {
        total: report.total,
        dated,
        undated: report.total - dated,
        face: (report.story?.ok === true)
            ? ALBUM_STORY_FACES.CLOCK_OK
            : ALBUM_STORY_FACES.NO_CLOCK,
        story: report.story,
        counts: report.counts,
        worstDrift: report.worstDrift,
        rows: report.rows.map((row, index) => ({
            ...row,
            dayKey: translated[index]?.dayKey ?? ''
        }))
    };
}

/** 结构自检：分组形状、判定闭集、「createdAt 不救场」、纯读、文案单出口。 */
export function albumStoryGroupSelfCheck() {
    const story = { ok: true, ms: 1000, reason: 'ok', source: 'chat' };
    const dated = { id: 'a', storyAt: 1000, createdAt: 999 };
    const undated = { id: 'b', createdAt: 1000 };
    const photos = Object.freeze([dated, undated].map(p => Object.freeze({ ...p })));
    const before = JSON.stringify(photos);
    const groups = groupAlbumImagesByStoryDay(photos);
    const summaryNoWin = albumPhotoTimeSummary(photos, null);
    const ok = groups.length === 2
        && groups[0].undated === false
        && groups[0].images.length === 1
        && groups[1].key === UNDATED_DAY_KEY
        && groups[1].undated === true
        && groups[1].images.length === 1
        && summaryNoWin.undated === 1
        && summaryNoWin.dated === 1
        && summaryNoWin.face === ALBUM_STORY_FACES.NO_CLOCK
        && summaryNoWin.rows[0].verdict === PHOTO_TIME_VERDICTS.NO_STORY_CLOCK
        && summaryNoWin.rows[1].verdict === PHOTO_TIME_VERDICTS.NO_EXIF
        && photoTimeLabel(summaryNoWin.rows[1]).startsWith('时间不详')
        && JSON.stringify(photos) === before;
    return {
        ok,
        groups: groups.map(group => group.key),
        undatedCount: summaryNoWin.undated
    };
}
