/* ============================================================
 * config/l0-assets.js — L0 静态素材的**唯一取数口** [v3.24.0]
 * ------------------------------------------------------------
 * 【这批素材从哪来】
 *   来自素材盘点（INVENTORY_V2.md）的第 0 层：糯叽机 4.992 的
 *   `assets/public/` 下四类纯静态资源，已落盘 `assets/`：
 *     · `assets/frames/`          26 套古典画框（每套 `<key>.webp` + `<key>-m.webp` 缩略）
 *     · `assets/share-icons/`     25 个平台图标（`<key>.webp`）
 *     · `assets/textures/`         3 张纸纹（`<key>.png`）
 *     · `assets/sounds/ambience/`  5 条环境音（`<key>.mp3`）
 *
 * 【为什么要有这份文件】
 *   本仓纪律：**素材落盘 ≠ 集成完成，必须有真消费点**。
 *   把「路径怎么拼」收成一个口子，是为了让「哪些素材真被用到」在磁盘上可查
 *   —— 散在四处各写一个 `new URL('../../assets/...')` 的写法，
 *   下一次有人想知道「这条环境音还有没有人放」就只能全仓 grep 猜。
 *
 * 【纪律】
 *   1. **零依赖叶子模块**：不 import 任何东西，谁都可引用而不引入循环；
 *   2. **只暴露 key，不暴露任意路径**：两个 URL 解析函数都对 key 做白名单校验，
 *      不在清单里的 key 一律返回空串（**不拼一条指不到的路径**）——
 *      拼错路径的素材在界面上表现为「图破了」，而在读数上表现为「看起来有引用」。
 *      消费方把 **key**（不是 URL）落进 storage：素材哪天被删，读回时白名单
 *      校验会把它判成空串 ⇒ 界面回到无素材态，而不会指向一个 404。
 *   3. **不做 IO、不碰 DOM**：本模块只回答「这条素材的 URL 是什么」。
 *   4. 四类形状**同构**为 `{ key, label, url }`（`frames` / `icons` 原先只有 key 数组，
 *      v3.24.0 起与另两类同构 —— 消费方的选择列表需要**可读标签**，
 *      让每类各自记一份中文名表是本仓治过的「同一口径抄 N 份」）。
 *   5. 素材体积：画框 1.6MB / 图标 108KB / 纸纹 76KB / 环境音 1.2MB。
 *      环境音是**最长的一条**（每条约 240KB），故它按 key 惰性取、不预载。
 * ============================================================ */

/* ---------- 画框（26 套） ---------- */
const FRAME_DEFS = Object.freeze([
    { key: 'baroque', label: '巴洛克' },
    { key: 'bead', label: '珠饰' },
    { key: 'cherub', label: '小天使' },
    { key: 'eagle', label: '雄鹰' },
    { key: 'filigree', label: '金丝' },
    { key: 'grand', label: '华贵' },
    { key: 'heart', label: '心形' },
    { key: 'lace', label: '蕾丝' },
    { key: 'land', label: '风景' },
    { key: 'land2', label: '风景·其二' },
    { key: 'lattice', label: '格栅' },
    { key: 'lion', label: '狮纹' },
    { key: 'octagon', label: '八角' },
    { key: 'oval', label: '椭圆' },
    { key: 'oval2', label: '椭圆·其二' },
    { key: 'plain', label: '素框' },
    { key: 'putti', label: '童像' },
    { key: 'rococo', label: '洛可可' },
    { key: 'round', label: '圆框' },
    { key: 'round2', label: '圆框·其二' },
    { key: 'shell', label: '贝壳' },
    { key: 'sq2', label: '方框·其二' },
    { key: 'sq3', label: '方框·其三' },
    { key: 'square', label: '方框' },
    { key: 'swag', label: '垂花' },
    { key: 'wreath', label: '花环' }
]);

/* ---------- 平台图标（25 个） ---------- */
const ICON_DEFS = Object.freeze([
    { key: 'ao3', label: 'AO3' },
    { key: 'applemusic', label: 'Apple Music' },
    { key: 'bilibili', label: '哔哩哔哩' },
    { key: 'douban', label: '豆瓣' },
    { key: 'douyin', label: '抖音' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'jd', label: '京东' },
    { key: 'kuaishou', label: '快手' },
    { key: 'lofter', label: 'LOFTER' },
    { key: 'netease', label: '网易云音乐' },
    { key: 'pdd', label: '拼多多' },
    { key: 'pixiv', label: 'Pixiv' },
    { key: 'qqmusic', label: 'QQ 音乐' },
    { key: 'spotify', label: 'Spotify' },
    { key: 'steam', label: 'Steam' },
    { key: 'taobao', label: '淘宝' },
    { key: 'threads', label: 'Threads' },
    { key: 'tieba', label: '百度贴吧' },
    { key: 'tiktok', label: 'TikTok' },
    { key: 'wechat', label: '微信' },
    { key: 'weibo', label: '微博' },
    { key: 'x', label: 'X' },
    { key: 'xhs', label: '小红书' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'zhihu', label: '知乎' }
]);

/* ---------- 纸纹（3 张）· 环境音（5 条） ---------- */
const PAPER_DEFS = Object.freeze([
    { key: 'cream-paper', label: '宣纸' },
    { key: 'fabric-of-squares', label: '方格布' },
    { key: 'pinstripe', label: '细条纹' }
]);

const AMBIENCE_DEFS = Object.freeze([
    { key: 'birds', label: '清晨鸟鸣' },
    { key: 'cafe', label: '咖啡馆' },
    { key: 'market', label: '市集' },
    { key: 'night', label: '夜' },
    { key: 'ocean', label: '海浪' }
]);

const assetUrl = (rel) => new URL('../assets/' + rel, import.meta.url).href;

function withUrl(defs, dir, ext) {
    return Object.freeze(defs.map((d) => Object.freeze({
        key: d.key,
        label: d.label,
        url: assetUrl(dir + d.key + ext)
    })));
}

const FRAMES = withUrl(FRAME_DEFS, 'frames/', '.webp');
const ICONS = withUrl(ICON_DEFS, 'share-icons/', '.webp');
const FRAME_KEYS = Object.freeze(FRAME_DEFS.map((d) => d.key));
const ICON_KEYS = Object.freeze(ICON_DEFS.map((d) => d.key));

/**
 * L0 素材清单（唯一真源）。
 * 四类形状**同构**：`{ key, label, url }[]`（画框 / 平台图标 / 纸纹 / 环境音）。
 * 消费方一律从这里取，不自己拼路径、不自己另记一份中文名。
 */
export const L0_ASSETS = Object.freeze({
    frames: FRAMES,
    icons: ICONS,
    textures: withUrl(PAPER_DEFS, 'textures/', '.png'),
    ambience: withUrl(AMBIENCE_DEFS, 'sounds/ambience/', '.mp3')
});

/**
 * 按 key 取画框 URL（主图，非 `-m` 缩略）。
 * @param {string} key
 * @returns {string} 白名单外的 key 返回空串（不拼指不到的路径）
 */
export function galleryFrameUrl(key) {
    return FRAME_KEYS.includes(key) ? assetUrl('frames/' + key + '.webp') : '';
}

/**
 * 按 key 取平台图标 URL。
 * @param {string} key
 * @returns {string} 白名单外的 key 返回空串
 */
export function shareIconUrl(key) {
    return ICON_KEYS.includes(key) ? assetUrl('share-icons/' + key + '.webp') : '';
}