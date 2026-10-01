// tests/system-v3340.test.mjs — 老福特（LOFTER）[v3.34.0]
//
//   本版接的是素材缝合路线图 **第 2 层第五件：老福特**。源侧是 Perigee 的 `js/lofter.js`
//   （4445 行 / 267370 字节 / 552 个 class 命中），一个挂在全局 `AppState.data.lofterData` 上、
//   **共用微博粉丝池与 CP 设定**的中文同人圈平台仿真。
//
//   ★ 起手五块取 / 四处不缝 / 三条偏离（逐条写在 lofter-data.js 文件头，此处只留判据面）：
//     取：① 短文批量 ② 长篇合集 + 前文滑窗 ③ 评论楼中楼 ④ 关注 / 订阅 / 我的四格
//         ⑤ 阅读面（首页 / 分月 / tag / 搜索）；设置面取「文风库」这一块机制。
//     不缝：① 源自己读 `weiboData.apiOverride.apiKey` 直发 POST —— 本件零网络调用；
//           ② 源落 Dexie 并经 `Utils.saveData` 整块回写、把卡片 push 进 `chat.history`
//              —— 本件零数据库、不替宿主写楼层；
//           ③ 源要 `weiboData.fanFriends` 当作者池 —— 本件自带原创池，零跨 App 读；
//           ④ 源存生图 URL 与外链封面 —— 本件只登记「有没有图 / 几张」。
//     偏离：统计数收成唯一实现（序关系恒成立）/ 滑窗提成纯函数 / 上溯带访问集防自指。
//
//   ★ 本版起手抓到**七处真缺陷**（都不是自述，其中三处由门禁当场报红）：
//     ① **`normalizeArticle` 丢 `comments`**（本段最贵）：`probe()` 每次读盘都过它，
//        而返回对象里没有 `comments` 键 ⇒ **每次重取所有评论静默消失**；更坏的是它
//        **自洽地错** —— `stats.comments` 是个数还在，视图显示「3 条评论」点进去 0 条
//        （A6 钉住；数据能跑、不报错、不崩界面，只错数据）；
//     ② **设置回写丢文风库**：`normalizeLofterSettings` 的返回对象里没有 `writingStyles`
//        键 ⇒ 用户自己加的与内置 11 款一起被静默抹掉（A3 钉住）；
//     ③ **`isActiveLofterType` 判别力为零**：6 位原池**全是活跃类型**，函数永真 ——
//        负向假绿三形里的第二形（A2 钉住）；
//     ④ **App 层四处**：`statsOf` 字段口径不统一 / `counts()` 死方法（两分支返回同一常量
//        且零调用点）/ `void LOFTER_REASONS;` 式**假消费**（拿「名字出现」糊弄零消费门禁）
//        / `promptChapterText` 只**间**接触三个数据层函数（直接消费为零）—— 由 E 区钉住；
//     ⑤ **导入层级错**：`'../../../config/num-gate.js'`（`apps/lofter/` 与 `apps/date/`
//        同层，应为两层）—— 由 D1 的解析式核对钉住；
//     ⑥ **`phone.css` 粘连**：`cat` 追加时源文件尾行不含换行符 ⇒ 老福特段头被**粘在**
//        上一段末尾那一行尾（语法上仍合法，样式却挂错选择器）—— 由 D5 钉住；
//     ⑦ **J7 手写键**：视图 `TYPE_LABEL` 手写了一套标识符形键（`[fan_writer, oc_creator]`），
//        没取真源常量的值 —— **桥契约门当场报红**（本仓 T 区专门钉这一形态）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 内核：类型清单与真源表闭合 / 内置款与设置面闭合 / 文风库**坏值不许回默认** /
//       评论数组必须过规范器仍在 / 编号坏值即 null（不许兜成 1）/ 三态与「0 条」不许塌 /
//       统计序关系恒成立 / 裁剪与上界**如实计数** / 楼中楼深度上限 + 自指不死循环；
//     B 解析：`---LOF---` 分块 / `TAG: [N9]` 越界块**如实丢弃** / 评论行不被吃进正文 /
//       `HAS_IMAGES` 与画手联动 / tag 上界；
//     C 接线：三条键随会话隔离 / 六处接线落点到位 / 生命周期级联 / **视图调用面闭合**
//       （视图调了 App 上不存在的方法＝静默断裂）/ 属性走 setter 不当方法调；
//     D 通道：不碰模型 / 不落数据库 / 不替宿主写楼层 / 不收外链与图源 / 一处粘连不许回来；
//     E 活性：本版修掉的功能级失效必须有真调用点；两处假消费形态不许回来；
//     F 视图面闭合：视图调用的 App 方法在 App 上全都在（可选链吞不掉）；
//     G 样式：`.lof-` 前缀独占、样式投递有落点（phone.css 段头规范且独立成行）；
//     H 键归属：三条会话键登记 scope=chat / 宽匹配族在场 / 三条键真被产品消费；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向 / 破坏表锚点在场（恰 1 次）且替换保真 / 替换后仍是合法 JS；
//     K 单一真源：类型人话表**不手写键**（桥契约门 J7 的形态在这里也有判据）；
//     L 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据函数一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/lofter/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），否则相对 import
//   会解析错位置、首跑即假红；App 侧的编排断言只做**结构面**（不加载副本）。
//
//   批次纪律：本批（第 2 层中件）全部收干前**只跑单套件**（`node --test`）；
//   本件收干后补跑全链（上两版的教训留档：单套件全绿 ≠ 全链绿）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/lofter/lofter-data.js';
import { LofterApp } from '../apps/lofter/lofter-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LF_DATA = 'apps/lofter/lofter-data.js';
const LF_APP = 'apps/lofter/lofter-app.js';
const LF_VIEW = 'apps/lofter/lofter-view.js';
const LF_CSS = 'apps/lofter/lofter.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释（字符状态机，与 v3300 / v3310 / v3320 / v3330 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头与源码注释逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`Dexie`、`chat.history`、外链域名…）是
 *    **说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）：被审代码里一旦出现**裸的引号或反引号**，
 *    剥器会把正则正文当成字符串/模板串的起头。故 J1 用**尾随哨兵**逐文件实测「剥器能复位」。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}
/** 内存假存储：`key -> 字符串`。视图/App 只经 `storage.get/set`，与真件同形。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 `/^lofter_/` 前缀拼 chatId 实现）。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
    };
}
/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 类型清单与真源表闭合：活跃 4 + 非活跃 2，人话表键与清单逐一对齐', () => {
    assert.deepEqual(DAT.LOFTER_ACTIVE_TYPES, ['fan_writer', 'fan_artist', 'cp_fan', 'info_station'],
        '活跃 4 类必须与源 LOFTER_ACTIVE_TYPES 同序');
    assert.deepEqual(DAT.LOFTER_IDLE_TYPES, ['oc_creator', 'reviewer'],
        '非活跃 2 类必须显式登记（源是静默过滤，本仓不许静默）');
    const all = DAT.LOFTER_ACTIVE_TYPES.concat(DAT.LOFTER_IDLE_TYPES);
    assert.deepEqual(Object.keys(DAT.LOFTER_TYPE_LABELS), all,
        '人话表的键必须**现取**两份清单（顺序也一致）—— 手写键就是桥契约门 J7 立据的那个形态');
    for (const t of all) {
        assert.equal(typeof DAT.LOFTER_TYPE_LABELS[t], 'string', '每一型都要有人话：' + t);
        assert.ok(DAT.LOFTER_TYPE_LABELS[t].length > 0, '人话不许是空串：' + t);
    }
    /* 判别力：活跃判据必须对两族给出**不同**答案（原池全活跃 ⇒ 函数永真）。 */
    for (const t of DAT.LOFTER_ACTIVE_TYPES) assert.equal(DAT.isActiveLofterType(t), true, t + ' 应为活跃');
    for (const t of DAT.LOFTER_IDLE_TYPES) assert.equal(DAT.isActiveLofterType(t), false, t + ' 应为非活跃');
    assert.equal(DAT.isActiveLofterType(''), false, '空串不许算活跃');
    assert.equal(DAT.isActiveLofterType(undefined), false, '缺值不许算活跃');
});
test('A2 作者池 8 位：活跃 6 / 非活跃 2，且两位非活跃**真在池里**', () => {
    const pool = DAT.LOFTER_BUILT_IN_AUTHORS;
    assert.equal(pool.length, 8, '内置池必须 8 位（6 活跃 + 2 非活跃）');
    const active = pool.filter((a) => DAT.isActiveLofterType(a.type));
    const idle = pool.filter((a) => !DAT.isActiveLofterType(a.type));
    assert.equal(active.length, 6, '活跃必须是 6 位');
    assert.equal(idle.length, 2, '非活跃必须是 2 位（判别力来自这里：不摆出来函数就是永真）');
    for (const a of idle) assert.ok(DAT.LOFTER_IDLE_TYPES.indexOf(a.type) >= 0, a.name + ' 的类型必须在非活跃清单里');
    /* id 不许重（重了 Map 会静默吃掉一位）。 */
    const ids = pool.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, '作者 id 不许重');
    /* 挑取器只出活跃（源「只推这 4 类」的口径）。 */
    const picked = DAT.pickDiverseAuthors(pool, 8, null, () => 0);
    assert.equal(picked.length, 6, '挑取器必被活跃数封顶（8 要不满池）');
    for (const a of picked) assert.equal(DAT.isActiveLofterType(a.type), true, '挑出来的必须都是活跃');
});
test('A3 文风库：11 款内置 + 收口函数；**坏值不许回默认**、用户款会被保住', () => {
    assert.equal(DAT.LOFTER_WRITING_STYLES.length, 11, '内置必须 11 款');
    const ids = DAT.LOFTER_WRITING_STYLES.map((s) => s.id);
    assert.equal(new Set(ids).size, 11, '内置 id 不许重');
    assert.equal(DAT.defaultLofterSettings().writingStyles.length, 11, '默认设置必须带上 11 款');
    /* ★ 收口函数的核心：坏值 ⇒ 补内置（不是回默认把用户的抹掉）。 */
    assert.equal(DAT.normalizeWritingStyles(null).length, 11, 'null 必须补出完整 11 款');
    assert.equal(DAT.normalizeWritingStyles('nonsense').length, 11, '坏类型必须补出完整 11 款');
    assert.equal(DAT.normalizeWritingStyles([]).length, 11, '空数组必须补出完整 11 款');
    const mixed = DAT.normalizeWritingStyles([{ id: 'my_own', name: '我自己的', rules: '慢一点' }]);
    assert.equal(mixed.length, 12, '用户款必须与内置并存（12 = 11 + 1）');
    const mine = mixed.find((s) => s.id === 'my_own');
    assert.ok(mine, '用户自己的文风必须被保住');
    assert.equal(mine.builtIn, false, '用户款不许被标成内置');
    assert.equal(mine.enabled, true, '缺 enabled 键 = 启用（与源 `!== false` 同口径）');
    assert.equal(DAT.normalizeWritingStyles([{ id: 'x', name: 'y', enabled: false }]).find((s) => s.id === 'x').enabled,
        false, '显式 false 才是停用');
    assert.equal(DAT.normalizeWritingStyles([{ id: '', name: '没 id' }, { name: '没 id 2' }]).length, 11,
        '没 id / 没名字的条目必须被丢掉（不是补成 11 + 2）');
    /* 设置规范化必须**收口**文风库（原版返回对象里根本没这个键 ⇒ 回写一次就整块丢掉）。 */
    const st = DAT.normalizeLofterSettings({ writingStyles: [{ id: 'u1', name: '用户款', rules: 'r' }] });
    assert.ok(Object.prototype.hasOwnProperty.call(st, 'writingStyles'), '设置规范化必须带 writingStyles 键');
    assert.equal(st.writingStyles.length, 12, '经过设置规范化后用户款仍须在（12 款）');
    assert.equal(DAT.normalizeLofterSettings({ writingStyles: 'nonsense' }).writingStyles.length, 11,
        '坏值 ⇒ 11 款内置（不许塌成 0）');
    assert.equal(DAT.normalizeLofterSettings({}).writingStyles.length, 11, '缺键 ⇒ 11 款内置');
});
test('A4 设置规范化：坏值回默认，但**数字字段不许 `|| 默认`**', () => {
    const d = DAT.defaultLofterSettings();
    assert.equal(d.defaultViewMode, 'grid');
    assert.equal(d.chapterLength, 'medium');
    assert.equal(DAT.normalizeLofterSettings({ defaultViewMode: 'nope' }).defaultViewMode, 'grid', '坏列表面回默认');
    assert.equal(DAT.normalizeLofterSettings({ defaultViewMode: 'list' }).defaultViewMode, 'list', '合法值必须留住');
    assert.equal(DAT.normalizeLofterSettings({ chapterLength: 'nope' }).chapterLength, 'medium', '坏篇幅回 medium');
    assert.equal(DAT.normalizeLofterSettings({ chapterLength: 'long' }).chapterLength, 'long', '合法篇幅必须留住');
    assert.equal(DAT.normalizeLofterSettings({ autoGenCount: 99 }).autoGenCount, 5, '每轮条数必须夹到 5');
    assert.equal(DAT.normalizeLofterSettings({ autoGenCount: 0 }).autoGenCount, 1, '0 必须夹到 1（不是当坏值）');
    assert.equal(DAT.normalizeLofterSettings({ autoGenCount: '' }).autoGenCount, d.autoGenCount,
        '空串是坏值 ⇒ 回默认（`Number("") === 0` 那族塌陷就在这里）');
    assert.equal(DAT.normalizeLofterSettings({ autoGenCount: null }).autoGenCount, d.autoGenCount, 'null ⇒ 回默认');
    assert.equal(DAT.normalizeLofterSettings({ autoGenCount: '3' }).autoGenCount, 3, '数字串必须如实出数');
    assert.equal(DAT.normalizeLofterSettings({ showInvalidArticles: false }).showInvalidArticles, false,
        '显式 false 必须留住');
});
test('A5 篇幅与章节定位：坏值回 medium（不许塌成 short）；定位四态由调用方显式给', () => {
    assert.equal(DAT.chapterLengthSpec('nope').id, 'medium', '坏篇幅键 ⇒ medium');
    assert.equal(DAT.chapterLengthSpec('').id, 'medium', '空串 ⇒ medium');
    assert.equal(DAT.chapterLengthSpec('short').min, 800);
    assert.equal(DAT.chapterLengthSpec('long').min, 2800);
    assert.equal(DAT.LOFTER_CHAPTER_LENGTHS.medium.min, 1500);
    const col = { status: 'ongoing' };
    assert.equal(DAT.chapterPositionFace(col, 1, false).kind, 'opening', '第 1 章 = opening');
    assert.equal(DAT.chapterPositionFace(col, 2, false).kind, 'ongoing', '第 2 章 = ongoing');
    assert.equal(DAT.chapterPositionFace(col, 2, true).kind, 'ending', '显式结尾优先');
    const fin = { status: 'finished' };
    const f = DAT.chapterPositionFace(fin, 3, false);
    assert.equal(f.kind, 'extra', '已完结合集的后续章 = 番外');
    assert.equal(f.alreadyFinished, true, '必须如实回报「已标完结」');
    assert.equal(DAT.chapterPositionFace(col, null, false).num, 1, '坏章号读数回落成 1（显示用），但 kind 是 opening');
});
test('A6 文章规范化：编号坏值即 null（不许兜成 1）；**评论数组必须被保住**', () => {
    const a = DAT.normalizeArticle({ kind: 'x', chapterNum: 0 });
    assert.equal(a.chapterNum, 0, '0 是合法章号（源会把第 0 章与第 1 章显示成同一个号），不许被兜成 1');
    assert.equal(DAT.normalizeArticle({ chapterNum: 'nope' }).chapterNum, null, '坏章号必须是 null（不是 1）');
    assert.equal(DAT.normalizeArticle({ chapterNum: null }).chapterNum, null, 'null 保持 null');
    assert.equal(DAT.normalizeArticle({}).chapterNum, null, '缺键 = null（「没这章」与「第 1 章」不许同形）');
    assert.equal(DAT.normalizeArticle({ chapterNum: '4' }).chapterNum, 4, '数字串如实出数');
    /* ★ 本版最贵那处：规范器必须原样带出 comments（`probe()` 每次读盘都过它）。 */
    const src = {
        id: 'a1', title: 't', content: 'c',
        comments: [
            { id: 'k1', author: '甲', content: '第一条', likes: '3', isOpReply: 'yes' },
            { author: '乙', content: '第二条', replyToCommentId: 'k1' },
        ],
    };
    const got = DAT.normalizeArticle(src).comments;
    assert.equal(got.length, 2, '评论数组必须过规范器仍在（丢了就是「3 条评论点进去 0 条」）');
    assert.equal(got[0].likes, 3, 'likes 必须走 numOrNull 出数');
    assert.equal(got[0].isOpReply, false, 'isOpReply 只认显式 true（字符串 "yes" 不算）');
    assert.equal(got[1].id, 'c2', '缺 id 的评论必须按序号补 id');
    assert.equal(got[1].replyToCommentId, 'k1', '回复目标必须留住');
    assert.equal(DAT.normalizeArticle({ comments: 'nope' }).comments.length, 0, '坏类型 ⇒ 空数组');
    assert.equal(DAT.normalizeArticle({}).comments.length, 0, '缺键 ⇒ 空数组');
    const many = DAT.normalizeArticle({ comments: new Array(60).fill(0).map((_x, i) => ({ id: 'c' + i, content: 'x' })) }).comments;
    assert.equal(many.length, DAT.LOFTER_LIMITS.maxCommentsPerArticle, '评论必须按上限截断（40）');
    /* 图：只登记两个数，不收任何地址。 */
    const img = DAT.normalizeArticle({ hasImages: 'true', imageCount: 99 });
    assert.equal(img.hasImages, false, 'hasImages 只认显式 true');
    assert.equal(img.imageCount, DAT.LOFTER_LIMITS.maxImageCount, '张数必须夹到 9');
});
test('A7 统计唯一实现：同一 (heat, cold) 必得同一读数，且「心 ≥ 收藏 ≥ 评论」恒成立', () => {
    const a = DAT.deriveStats(12800, 30);
    const b = DAT.deriveStats(12800, 30);
    assert.deepEqual(a, b, '同一入参必须同一读数（源三处各掷一次随机）');
    assert.notDeepEqual(DAT.deriveStats(12800, 30), DAT.deriveStats(12800, 80), '冷门系数必须真影响读数');
    for (const heat of [0, 1, 1000, 9700, 31500, 1e6]) {
        for (const cold of [0, 30, 60, 100]) {
            const s = DAT.deriveStats(heat, cold);
            assert.ok(s.hearts >= s.favorites && s.favorites >= s.comments,
                '序关系破了 heat=' + heat + ' cold=' + cold + ' ' + JSON.stringify(s));
            assert.ok(s.hearts >= 0 && s.favorites >= 0 && s.comments >= 0, '三个读数都不许是负数');
        }
    }
    assert.deepEqual(DAT.deriveStats('nope', 'nope'), DAT.deriveStats(0, 30), '坏值回同一基准（不是 NaN）');
});
test('A8 三态读数：「缺键」与「空」不许塌成一态；「0 条评论」与「还没读出来」也不许同形', () => {
    assert.equal(DAT.readLofterFace(null), DAT.LOFTER_REASONS.key_absent, 'null ⇒ 缺键');
    assert.equal(DAT.readLofterFace(undefined), DAT.LOFTER_REASONS.key_absent, 'undefined ⇒ 缺键');
    assert.equal(DAT.readLofterFace('   '), DAT.LOFTER_REASONS.empty, '空白串 ⇒ 空');
    assert.equal(DAT.readLofterFace([]), DAT.LOFTER_REASONS.empty, '空数组 ⇒ 空');
    assert.equal(DAT.readLofterFace({}), DAT.LOFTER_REASONS.empty, '空对象 ⇒ 空');
    assert.equal(DAT.readLofterFace([1]), DAT.LOFTER_REASONS.ok, '有货 ⇒ ok');
    assert.equal(DAT.readLofterFace({ a: 1 }), DAT.LOFTER_REASONS.ok, '有键 ⇒ ok');
    assert.notEqual(DAT.LOFTER_REASONS.key_absent, DAT.LOFTER_REASONS.empty, '缺键与空必须是两个值');
    const unread = DAT.commentCountFace(null);
    assert.equal(unread.count, null, '未读必须是 null（不是 0）');
    assert.equal(unread.face, DAT.LOFTER_REASONS.key_absent);
    const zero = DAT.commentCountFace([]);
    assert.equal(zero.count, 0, '真 0 条必须是 0');
    assert.equal(zero.face, DAT.LOFTER_REASONS.empty, '0 条与未读的面必须不同');
    assert.equal(DAT.commentCountFace([1, 2]).count, 2, '有评论必须出条数');
});
test('A9 裁剪与上界：一律**如实计数**，不静默吞；订阅 tag 超限丢最早的', () => {
    assert.deepEqual(DAT.pruneList([1, 2, 3], 5), { kept: [1, 2, 3], expired: 0, total: 3 }, '没超限不许动');
    const p = DAT.pruneList([1, 2, 3, 4, 5], 2);
    assert.equal(p.kept.length, 2, '按上界裁剪');
    assert.equal(p.expired, 3, '裁掉的必须**如实回报**（静默吞条数就是本仓记过的形态）');
    assert.equal(p.total, 5, '入口总数也要回报');
    assert.equal(DAT.pruneList(null, 3).kept.length, 0, '坏输入 ⇒ 空，不抛');
    assert.equal(DAT.pruneList([1, 2], 0).expired, 2, '上界 0 也要如实报');
    const tag = DAT.addSubscribedTag([], '雨');
    assert.equal(tag.added, true);
    assert.equal(tag.dropped, 0);
    assert.equal(DAT.addSubscribedTag(tag.list, '雨').added, false, '重复订阅不进（也不算 dropped）');
    const full = new Array(DAT.LOFTER_LIMITS.maxSubscribedTags).fill(0).map((_x, i) => 't' + i);
    const over = DAT.addSubscribedTag(full, 'new');
    assert.equal(over.list.length, DAT.LOFTER_LIMITS.maxSubscribedTags, '超限必须被夹回上界');
    assert.equal(over.dropped, 1, '丢了几个必须如实报');
    assert.equal(over.list[over.list.length - 1], 'new', '新订阅必须留在尾部');
    assert.equal(over.list[0], 't1', '丢的是**最早**那条（源里这数是无界增长）');
    assert.equal(DAT.addSubscribedTag([], '  ').added, false, '空白 tag 不许进');
});
test('A10 楼中楼：深度有上限；上溯带访问集（数据自指不许死循环）', () => {
    const cyc = [{ id: 'a', replyToCommentId: 'b' }, { id: 'b', replyToCommentId: 'a' }];
    const t0 = Date.now();
    const top = DAT.topAncestorId(cyc, 'a');
    assert.ok(Date.now() - t0 < 2000, '自指数据必须**瞬时**停下（源 _topAncestorId 无此保护）');
    assert.ok(top === 'a' || top === 'b', '自指时必须返回环上的某点（不是 undefined）');
    const chain = [
        { id: 'c1', content: '一' },
        { id: 'c2', content: '二', replyToCommentId: 'c1' },
        { id: 'c3', content: '三', replyToCommentId: 'c2' },
        { id: 'c4', content: '四', replyToCommentId: 'c3' },
    ];
    assert.equal(DAT.topAncestorId(chain, 'c4'), 'c1', '四级回复必须上溯到最顶层');
    assert.equal(DAT.topAncestorId(chain, 'c1'), 'c1', '顶层自己就是顶层');
    assert.equal(DAT.topAncestorId(chain, '不存在'), '不存在', '找不到的 id 原样返回（不许编一个）');
    const roots = DAT.buildCommentTree(chain);
    assert.equal(roots.length, 1, '一棵树只有一个根');
    assert.equal(roots[0].id, 'c1');
    const rows = DAT.flattenComments(roots);
    assert.equal(rows[0].depth, 1, '根是第一层');
    assert.equal(Math.max.apply(null, rows.map((n) => n.depth)), DAT.LOFTER_LIMITS.maxCommentDepth,
        '深度必须被上限夹住（多出来的层挂回上层）');
    /* 孤儿（父不在场）必须挂到根，不许丢。 */
    const orph = DAT.flattenComments(DAT.buildCommentTree([{ id: 'x', replyToCommentId: '没有这个人' }]));
    assert.equal(orph.length, 1, '孤儿评论必须仍渲染出来');
    assert.equal(orph[0].depth, 1, '孤儿按根算');
});
test('A11 滑窗与续章：最近 N 章全文 / 更早摘要（计数显式回报）；章号不许被 0 带偏', () => {
    const chapters = new Array(8).fill(0).map((_x, i) => ({
        id: 'ch' + (i + 1), chapterNum: i + 1, title: '第' + (i + 1) + '章', content: '正文'.repeat(30),
    }));
    const ctx = DAT.prevChapterContext(chapters, 8, DAT.LOFTER_FULL_TEXT_WINDOW);
    assert.equal(ctx.blocks.length, 7, '写给第 8 章时要带上前面 7 章');
    assert.equal(ctx.fullCount, DAT.LOFTER_FULL_TEXT_WINDOW, '最近 N 章给全文');
    assert.equal(ctx.digestCount, 7 - DAT.LOFTER_FULL_TEXT_WINDOW, '更早的给摘要');
    assert.equal(ctx.blocks[ctx.blocks.length - 1].mode, 'full', '最靠近的是全文');
    assert.equal(ctx.blocks[0].mode, 'digest', '最远的是摘要');
    assert.equal(DAT.prevChapterContext(chapters, 1, 5).blocks.length, 0, '第 1 章没有前文');
    const art = [{ collectionId: 'c', chapterNum: 0 }, { collectionId: 'c', chapterNum: 2 }];
    assert.equal(DAT.nextChapterNum(art, 'c'), 3, '下一章 = 现有最大章号 + 1（chapterNum=0 不许带偏）');
    assert.equal(DAT.nextChapterNum([], 'c'), 1, '空合集从 1 起');
    assert.equal(DAT.nextChapterNum(art, ''), 1, '没有合集 ⇒ 1');
    assert.equal(DAT.nextChapterNum(art, '别的合集'), 1, '别的合集篇章不算进来');
});
test('A12 阅读面：可见性过滤、tag / 分月 / 搜索，命中数有上界', () => {
    const arts = [
        { id: 'a', title: '雨里的店', content: '下雨的夜里', tags: ['宿命'], createdAt: 1700000000000 },
        { id: 'b', title: '无关', content: '草莓两盒', tags: ['日常'], createdAt: 1600000000000 },
        { id: 'c', title: '空的', content: '', tags: [], createdAt: 1500000000000 },
    ];
    assert.equal(DAT.visibleArticles(arts, { showInvalidArticles: true }).length, 3, '开着就得全显形');
    assert.equal(DAT.visibleArticles(arts, { showInvalidArticles: false }).length, 2, '关掉要滤掉没正文的');
    assert.deepEqual(DAT.visibleArticles(arts, {}).map((x) => x.id), ['a', 'b', 'c'], '按时间倒序');
    assert.equal(DAT.articlesOfTag(arts, '#宿命').length, 1, 'tag 带不带 # 都要认');
    assert.equal(DAT.articlesOfTag(arts, '').length, 0, '空 tag 不返回全部（那是错读数）');
    const months = DAT.groupByMonth(arts);
    assert.ok(months.length >= 1, '分月必须有组');
    assert.equal(months[0].month >= months[months.length - 1].month, true, '月份组必须倒序');
    const hits = DAT.searchArticles(arts, '雨');
    assert.equal(hits.length, 1, '标题 / 正文命中都要算');
    assert.ok(hits[0].snippet.includes('雨'), '命中片段必须带上下文');
    assert.equal(DAT.searchArticles(arts, '  ').length, 0, '空查询不返回全部');
    assert.equal(DAT.searchArticles(arts, '雨', 1).length, 1, '上界必须生效');
});
test('A13 互动四态各自独立（不许合并成一个 boolean）；足迹有上界且最近在前', () => {
    const store = { myLikedArticleIds: ['a'], myFavoritedArticleIds: [], myReadLaterArticleIds: ['a'] };
    const f = DAT.myArticleFlags(store, 'a');
    assert.equal(f.liked, true);
    assert.equal(f.favorited, false, '只有点过心 ≠ 收进收藏（合并了就读错）');
    assert.equal(f.readLater, true);
    assert.equal(f.footprint, false, '没翻过就是 false');
    assert.equal(DAT.myArticleFlags({}, 'a').liked, false, '空账 ⇒ 全 false');
    const t = DAT.toggleInList(['a', 'b'], 'a');
    assert.deepEqual(t, ['b'], '已存在 ⇒ 去掉');
    assert.deepEqual(DAT.toggleInList(['a'], 'b'), ['a', 'b'], '不存在 ⇒ 追加');
    assert.deepEqual(DAT.toggleInList(null, 'b'), ['b'], '坏输入当空账');
    const rec = DAT.recordFootprint(['b', 'c'], 'a');
    assert.equal(rec.list[0], 'a', '最近翻的必须在最前');
    assert.equal(rec.dropped, 0);
    assert.equal(DAT.recordFootprint(rec.list, 'a').list.length, rec.list.length, '重复翻不膨胀');
    const capped = DAT.recordFootprint(new Array(60).fill(0).map((_x, i) => 'x' + i), 'new');
    assert.equal(capped.list.length, 60, '足迹上界 60');
    assert.equal(capped.dropped, 1, '丢掉几个必须如实报');
});
test('A14 文风解析：坏 id / 全禁用 / 空字典三态各有正确出口', () => {
    const list = DAT.normalizeWritingStyles(null);
    const byId = DAT.resolveWritingStyle(list, 'lof_style_knife', () => 0);
    assert.equal(byId.id, 'lof_style_knife', '指定 id 必须取到那一款');
    assert.equal(DAT.resolveWritingStyle(list, 'random', () => 0).id, list[0].id, 'random 走 rng（可注入）');
    assert.equal(DAT.resolveWritingStyle(list, '不存在', () => 0).id, list[0].id, '坏 id ⇒ 现取一款（不是 null）');
    const allOff = list.map((s) => Object.assign({}, s, { enabled: false }));
    assert.equal(DAT.resolveWritingStyle(allOff, 'x', () => 0), null, '全禁用 ⇒ null（调用方据此不注入）');
    assert.equal(DAT.resolveWritingStyle([], 'x', () => 0), null, '空字典 ⇒ null');
    const off = list.map((s) => (s.id === 'lof_style_knife' ? Object.assign({}, s, { enabled: false }) : s));
    assert.notEqual(DAT.resolveWritingStyle(off, 'lof_style_knife', () => 0).id, 'lof_style_knife',
        '停用的款不许被指定取到');
});
/* ══════════════════════ B — 解析面 ══════════════════════ */
test('B1 批量解析：---LOF--- 分块 / 越界编号块如实丢弃 / 评论行不吃进正文', () => {
    const pool = DAT.LOFTER_BUILT_IN_AUTHORS.filter((a) => DAT.isActiveLofterType(a.type));
    assert.equal(pool.length, 6, '编号按**活跃池**下标 + 1（视图给用户的提示词就是这份编号）');
    const raw = [
        'some preamble',
        '---LOF---',
        'TAG: [N1]',
        'TITLE: 雨里的店',
        'TAGS: #宿命 #错过',
        'CONTENT: 雨下了一整夜。',
        'COMMENT_1: 路人甲|我看哭了',
        '---LOF---',
        'TAG: [N9]',
        'TITLE: 不存在的作者',
        'CONTENT: 这一块该被丢掉。',
        '---LOF---',
        'TAG: [N2]',
        'CONTENT: 草莓两盒。',
    ].join('\n');
    const parsed = DAT.parseLofterBatch(raw, pool);
    assert.equal(parsed.length, 2, '越界编号（N9）必须被丢 —— 但要**如实回报**（App 层 parsed 计数）');
    assert.equal(parsed[0].author.id, pool[0].id, 'N1 = 池里第 1 位');
    assert.equal(parsed[1].author.id, pool[1].id, 'N2 = 池里第 2 位');
    assert.equal(parsed[0].comments.length, 1, 'COMMENT_n 行必须被解析成评论');
    assert.equal(parsed[0].comments[0].author, '路人甲', '昵称 | 内容 两段必须切开');
    assert.equal(parsed[0].comments[0].content, '我看哭了');
    assert.equal(parsed[0].content.includes('COMMENT'), false, '评论行不许被吃进正文');
    assert.deepEqual(parsed[0].tags, ['宿命', '错过'], '# 必须被剥掉');
    assert.equal(DAT.parseLofterBatch('', pool).length, 0, '空文本 ⇒ 空');
    assert.equal(DAT.parseLofterBatch('没有分隔线的正文', pool).length, 0, '没有块 ⇒ 空（不是把全文当一块）');
    assert.equal(DAT.parseLofterBatch('---LOF---\nTAG: [N1]\nCONTENT: 短', pool).length, 0,
        '正文太短（< 5 字）⇒ 丢弃');
});
test('B2 画手自动带图；张数走上界；tag 数走上界', () => {
    const pool = DAT.LOFTER_BUILT_IN_AUTHORS;
    const artist = pool.find((a) => a.type === 'fan_artist');
    const writer = pool.find((a) => a.type === 'fan_writer');
    const block = ['TAG: [N1]', 'TAGS: #a #b #c #d #e #f #g #h', 'CONTENT: 画了一张图，标题两个字。',
        'HAS_IMAGES: true', 'IMAGE_COUNT: 99'].join('\n');
    const p1 = DAT.parseLofterBatch(block, [artist])[0];
    assert.equal(p1.hasImages, true);
    assert.equal(p1.imageCount, DAT.LOFTER_LIMITS.maxImageCount, '张数必须夹到 9');
    assert.equal(p1.tags.length, DAT.LOFTER_LIMITS.maxTagsPerArticle, 'tag 数必须夹到 6（源 slice(0,6)）');
    const noFlag = DAT.parseLofterBatch(['TAG: [N1]', 'CONTENT: 画了一张图，标题两个字。'].join('\n'), [artist])[0];
    assert.equal(noFlag.hasImages, true, '画手即使没写 HAS_IMAGES 也带图（源的联动）');
    assert.equal(noFlag.imageCount, 1, '没写张数时画手默认 1 张');
    const w = DAT.parseLofterBatch(['TAG: [N1]', 'CONTENT: 写了很长很长的一段正文内容。'].join('\n'), [writer])[0];
    assert.equal(w.hasImages, false, '非画手没写就不带图');
    assert.equal(w.imageCount, 0);
});
/* ══════════════════════ C — App 面 ══════════════════════ */
/* ★ 夹具的口径：带 `COMMENT_n` 的块一律放**最后一块** —— 新文章在最前（`articlesAll()[0]`），
 *   评论判据要拿到的正是它。写成第一块会让判据去量一篇**没有评论**的文章（假红）。 */
const batchText = (n) => [
    '---LOF---', 'TAG: [N1]', 'TITLE: 第一篇', 'TAGS: #宿命', 'CONTENT: 雨下了一整夜，伞骨断了三根。',
    '---LOF---', 'TAG: [N2]', 'TITLE: 第二篇', 'TAGS: #日常', 'CONTENT: 草莓两盒，一盒放冰箱一盒门口。',
].join('\n') + (n > 2
    ? '\n---LOF---\nTAG: [N3]\nTITLE: 第三篇\nCONTENT: 第三篇的正文也得够长才行。\n'
        + 'COMMENT_1: 路人甲|我看哭了\nCOMMENT_2: 路人乙|刀味很足'
    : '');
test('C1 三条键随会话隔离：切会话回空态、切回来账还在（双向断言）', () => {
    const st = sessionStorage();
    const app = new LofterApp(null, st);
    app.probe();
    assert.equal(app.faceReason(), DAT.LOFTER_REASONS.empty, '空态面必须是 empty（不是 key_absent）');
    assert.equal(app.authorsAll().length, 8, '内置池必须在场（空态也有 8 位）');
    assert.equal(app.articlesAll().length, 0, '空态没有稿子');
    const r = app.ingestBatch(batchText(2));
    assert.equal(r.ok, true);
    assert.equal(r.added, 2, '两篇都必须收下');
    app.openArticle(app.articlesAll()[0].id);
    app.toggleLike(app.articlesAll()[0].id);
    app.setTab('follow');
    /* 切到另一个会话：一切归零。 */
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.faceReason(), DAT.LOFTER_REASONS.empty, '换会话必须回空态（三条键都随会话隔离）');
    assert.equal(app.articlesAll().length, 0, '换会话后不许还看得见上一位角色的稿子');
    assert.equal(app.stored().myLikedArticleIds.length, 0, '互动账也随会话隔离');
    assert.equal(app.tab(), 'home', '换会话必须把页签收回首页');
    assert.equal(app.currentId(), '', '换会话必须清掉当前文章');
    /* 切回来：账还在（这条是双向的 —— 只测「切走空了」会把「键根本没落盘」判绿）。 */
    st.switchTo('c1');
    app.onChatChanged();
    assert.equal(app.articlesAll().length, 2, '切回原会话必须原样读回');
    assert.equal(app.stored().myLikedArticleIds.length, 1, '互动账必须原样读回');
});
test('C2 编号/篇幅/上界：坏值不兜底、裁剪如实回报、越界块如实计数', () => {
    const st = memStorage();
    const app = new LofterApp(null, st);
    app.probe();
    const r = app.ingestBatch(['---LOF---', 'TAG: [N1]', 'CONTENT: 收下的正文够长了。',
        '---LOF---', 'TAG: [N9]', 'CONTENT: 越界块应当被丢。'].join('\n'));
    assert.equal(r.ok, true);
    assert.equal(r.parsed, 1, '越界块不进 parsed（**如实计数**，不是静默丢）');
    assert.equal(r.added, 1);
    assert.equal(app.ingestBatch('没有分隔线').ok, false, '一块都没有 ⇒ 明确失败（不是 ok:true added:0）');
    /* 章号：坏值不许兜成 1（第 0 章那族）。 */
    const col = app.createCollection({ name: '雾港来信' });
    assert.equal(col.ok, true);
    const c1 = app.ingestChapter(col.id, '第一章的正文，写得长一点好过门。');
    const c2 = app.ingestChapter(col.id, '第二章的正文，也写得长一点。');
    assert.equal(c1.chapterNum, 1, '第一章 = 1');
    assert.equal(c2.chapterNum, 2, '第二章 = 2（源会把 0 与 1 显示成同一个号）');
    assert.equal(c1.position, 'opening');
    assert.equal(c2.position, 'ongoing');
    assert.equal(app.ingestChapter(col.id, '短').ok, false, '正文太短 ⇒ 拒绝');
    assert.equal(app.ingestChapter('不存在的合集', '第一章的正文，写得长一点好过门。').ok, false, '没有合集 ⇒ 拒绝');
    assert.equal(app.createCollection({ name: '  ' }).ok, false, '没名字的合集 ⇒ 拒绝');
    /* 评论：过 maxCommentsPerArticle 时如实回报 expired。 */
    const id = app.articlesAll()[0].id;
    let last = null;
    for (let i = 0; i < DAT.LOFTER_LIMITS.maxCommentsPerArticle + 5; i++) last = app.addComment(id, '第 ' + i + ' 条评论');
    assert.equal(last.count, DAT.LOFTER_LIMITS.maxCommentsPerArticle, '评论必须被夹在上界');
    assert.ok(last.expired > 0, '裁掉的条数必须如实回报');
    assert.equal(app.commentsOf(id).length, DAT.LOFTER_LIMITS.maxCommentsPerArticle, '上界必须真生效');
    assert.equal(app.addComment(id, '   ').ok, false, '空评论 ⇒ 拒绝');
    assert.equal(app.addComment('不存在的文章', 'x').ok, false, '找不到文章 ⇒ 拒绝');
});
test('C3 评论重取不丢：App 层「发评论 → 重取 → 评论还在」（本版最贵那处缺陷的正面判据）', () => {
    const st = memStorage();
    const app = new LofterApp(null, st);
    app.probe();
    app.ingestBatch(batchText(3));
    const id = app.articlesAll()[0].id;
    assert.equal(app.commentsOf(id).length, 2,
        '宿主给的两条评论必须收下（组装侧不喂给规范器就会在这里归零）');
    app.addComment(id, '我来说一句');
    const before = app.commentsOf(id).length;
    assert.equal(before, 3);
    /* ★ 每一处动作内部都会 `probe()`（就是「每次读盘」）—— 评论不许在这一步消失。 */
    app.addComment(id, '再来一条');
    assert.equal(app.commentsOf(id).length, 4, '第二次动作后评论必须还在（原版会在 probe 里静默全灭）');
    app.toggleLike(id);
    assert.equal(app.commentsOf(id).length, 4, '点个心之后评论也必须还在');
    const fresh = new LofterApp(null, st);
    fresh.probe();
    assert.equal(fresh.commentsOf(id).length, 4, '新实例从盘上读回来的评论条数必须一致（落盘也保住了）');
    const cf = fresh.commentCountOf(id);
    assert.equal(cf.count, 4, '「评论数」与「评论数组」必须是同一件事（原版自洽地错）');
    assert.equal(cf.face, DAT.LOFTER_REASONS.ok, '有条目 ⇒ ok');
    /* 楼中楼：回复一层必须挂上父节点。 */
    const parent = fresh.commentsOf(id)[0].id;
    const r = fresh.addComment(id, '回第一条', parent);
    assert.equal(r.rehomed, false, '浅层回复不许被改挂');
    const rows = fresh.commentRows(id);
    assert.equal(rows.find((n) => n.content === '回第一条').depth, 2, '回复必须落在第二层');
    /* ★ 夹具必须**先把楼层坐满**：此刻最多只有两层（两条根 + 它们的回复），
     *   直接挑 `depth === 3` 会挑到空数组 —— 判据在测一个不存在的场景（一度如此）。
     *   回复现处于第二层的「我来说一句」，第三层才真出现。 */
    /* ★ 第二层是「回第一条」（不传 replyToId 的评论会落成根，depth 1）——
     *   夹具拿根节点当第二层会让第三层永远坐不满（一度如此）。 */
    const mid = fresh.commentRows(id).find((n) => n.content === '回第一条');
    assert.ok(mid && mid.depth === 2, '前置：夹具必须先把第二层坐实');
    const deeper = fresh.addComment(id, '再深一层', mid.id);
    assert.equal(deeper.rehomed, false, '第二层回复不许被改挂');
    /* 最深一层再回复：自动改挂到顶层（源会越挂越深）。
     * ★ 目标必须挑**真在 maxCommentDepth 那一层**的节点：拿浅层（比如第一层）去回复
     *   不会触发改挂 —— 判据会在测一个不存在的场景。 */
    const deepest = fresh.commentRows(id).filter((n) => n.depth === DAT.LOFTER_LIMITS.maxCommentDepth);
    assert.ok(deepest.length > 0, '夹具必须真造出最深一层的评论（否则这条判据测不到东西）');
    const deepReply = fresh.addComment(id, '再回一层', deepest[0].id);
    assert.equal(deepReply.rehomed, true, '到最深一层时必须改挂到该线程顶层（源无此保护）');
    assert.ok(Math.max.apply(null, fresh.commentRows(id).map((n) => n.depth)) <= DAT.LOFTER_LIMITS.maxCommentDepth,
        '改挂之后深度不许超上限');
});
test('C4 文风库增删改：内置不许删、重名不许进、关掉后随机抽不到', () => {
    const app = new LofterApp(null, memStorage());
    app.probe();
    assert.equal(app.styleList().length, 11, '默认 11 款');
    const add = app.addStyle('我自己的', '写得慢一点。');
    assert.equal(add.ok, true);
    assert.equal(app.styleList().length, 12, '用户款必须进库');
    assert.equal(app.addStyle('刀子暴击', 'x').ok, false, '与内置重名 ⇒ 拒绝（内置池必须真被消费）');
    assert.equal(app.addStyle('', 'x').ok, false, '没名字 ⇒ 拒绝');
    assert.equal(app.addStyle('有名字', '  ').ok, false, '没规则 ⇒ 拒绝（模型不知道怎么写）');
    assert.equal(app.removeStyle('lof_style_knife').ok, false, '内置不许删（能关不能删）');
    assert.equal(app.removeStyle(add.id).ok, true, '用户款可以删');
    assert.equal(app.styleList().length, 11, '删完回 11');
    const off = app.toggleStyle('lof_style_knife');
    assert.equal(off.ok, true);
    assert.equal(off.enabled, false);
    assert.equal(off.enabledCount, 10, '停用一款后启用数是 10');
    const picked = app.pickStyle('lof_style_knife', () => 0);
    assert.notEqual(picked.id, 'lof_style_knife', '停用的款不许被指定取到');
    assert.equal(app.builtInStyleIds().length, 11, '内置 id 面必须可读（视图标「内置」徽标用）');
});
test('C5 读数与投影：现取不持副本；空入/杂入/缺键三态各有出口', () => {
    const app = new LofterApp(null, memStorage());
    app.probe();
    const p0 = app.projection();
    assert.ok(p0, '投影必须在（视图唯一数据入口）');
    assert.equal(p0.emptyAuthors, false, '内置池在场 ⇒ 不是空池');
    assert.equal(p0.dropped, 0);
    assert.equal(p0.totalArticles, 0);
    assert.equal(app.contentFace() === DAT.LOFTER_REASONS.key_absent || app.contentFace() === DAT.LOFTER_REASONS.empty,
        true, '没内容时内容面必须是「缺键」或「空」（不许是 ok）');
    assert.equal(app.statsOf('不存在'), null, '找不到的读数必须是 null（不是一串 0）');
    app.ingestBatch(batchText(3));
    const id = app.articlesAll()[0].id;
    const s = app.statsOf(id);
    assert.ok(s && typeof s.heart === 'undefined', '读数结构不许带错名字的字段');
    for (const k of ['hearts', 'favorites', 'comments']) {
        assert.equal(typeof s[k], 'string', '读数面 ' + k + ' 必须是显示串（formatCount 出口）');
        assert.equal(s[k], DAT.formatCount(s.raw[k]), k + ' 显示串必须是 formatCount 出口（不是自比）');
    }
    assert.equal(typeof s.images, 'number');
    const proj = app.projection();
    assert.equal(proj.articles.length, 3, '投影必须现算（不持跨轮副本）');
    assert.equal(proj.store.myLikedArticleIds.length, 0, '空账');
    assert.equal(app.summaryLine().length > 0, true, '摘要行必须有字（视图标题用）');
    assert.equal(typeof app.faceOf('home'), 'string');
    assert.equal(app.setTab('nope'), 'home', '坏页签必须收回首页');
});
/* ══════════════════════ D — 通道与纪律面 ══════════════════════ */
test('D1 数据层只许一条 import 且**层级对**；不许碰存储 / DOM / 定时器 / 网络', () => {
    const code = stripComments(read(LF_DATA));
    const imports = code.match(/^import[^\n]*\n/gm) || [];
    assert.equal(imports.length, 1, '数据层只许一条 import（零依赖叶子优先）');
    assert.ok(imports[0].includes("'../../config/num-gate.js'"),
        '导入必须是**两层**（apps/lofter/ 与 apps/date/ 同层；写三层就是起手那处真缺陷）');
    assert.equal(imports[0].includes('../../../'), false, '不许再出现三层级写法');
    /* 目录式交叉核对：从 LF_DATA 出发走两级必须真能落到 config/num-gate.js。 */
    const target = path.resolve(ROOT, path.dirname(LF_DATA), '../../config/num-gate.js');
    assert.equal(fs.existsSync(target), true, '两层解析必须真落到 config/num-gate.js');
    for (const banned of ['document.', 'window.', 'localStorage', 'indexedDB',
        'setTimeout', 'setInterval', 'fetch(', 'XMLHttpRequest']) {
        assert.equal(code.includes(banned), false, LF_DATA + ' 的代码里不得出现：' + banned);
    }
    assert.equal(code.includes('Number.isFinite(Number('), false, '不得就地再写一份弱口径取数');
});
test('D2 App 层不许直连模型 / 不许落数据库 / 不许替宿主写楼层', () => {
    const code = stripComments(read(LF_APP));
    for (const banned of ['fetch(', 'XMLHttpRequest', 'apiKey', 'endpoint', '/v1/chat',
        'Dexie', 'indexedDB', 'apiOverride', 'callAI', 'apiManager']) {
        assert.equal(code.includes(banned), false, LF_APP + ' 不得出现：' + banned
            + '（源自己读 apiOverride.apiKey 直发 POST —— 本件零网络调用）');
    }
    for (const banned of ['chat.history', 'chatHistory', 'history.push', 'saveData']) {
        assert.equal(code.includes(banned), false, LF_APP + ' 不得替宿主写楼层：' + banned);
    }
    /* 不共用别的 App 的池：零跨 App 读。 */
    for (const banned of ['weiboData', 'fanFriends', "../weibo/", "../tieba/"]) {
        assert.equal(code.includes(banned), false, LF_APP + ' 不得读兄弟 App 的池：' + banned);
    }
    /* ★ 导入面是**块**（`import {` 起首、`} from '...'` 收尾）：按块裁出来数。
     *   按「单行含 import」数会**少算** —— 多行导入块的正文行不含 `import` 字样。 */
    const importBlocks = code.match(/^import[\s\S]*?from '[^']+';/gm) || [];
    assert.equal(importBlocks.length, 3, 'App 层只许三条 import（数据层 / 数值门 / 视图）');
    assert.ok(importBlocks[0].includes("from './lofter-data.js'"), '第一条必须是本件数据层');
    assert.ok(importBlocks[1].includes("from '../../config/num-gate.js'"), '第二条必须是两层级的数值门');
    assert.ok(importBlocks[2].includes("from './lofter-view.js'"), '第三条必须是本件视图');
});
test('D3 视图层不许碰存储 / 不许收外链与图源 / 不许自己拼请求', () => {
    const code = stripComments(read(LF_VIEW));
    for (const banned of ['localStorage', 'indexedDB', 'PhoneStorage', 'fetch(', 'apiKey']) {
        assert.equal(code.includes(banned), false, LF_VIEW + ' 不得出现：' + banned);
    }
    for (const rel of [LF_DATA, LF_VIEW, LF_APP, LF_CSS]) {
        for (const banned of ['http://', 'https://', 'cdn.', '.png', '.jpg', '.webp', 'img src']) {
            assert.equal(read(rel).includes(banned), false, rel + ' 不得收外链 / 图源：' + banned);
        }
    }
    /* 「可有图」只是标签 + 一个数，不是地址。 */
    const imgNote = read(LF_VIEW).match(/lof-imgs-note[^\n]*/);
    assert.ok(imgNote, '图的存在必须走说明性标签（不是 img 标签）');
});
test('D4 一处不缝的形态不许回潮：源那五个词只许出现在**注释**里', () => {
    /* 剥掉注释后，五个源侧形态词不许出现在代码里（注释是说明不是消费）。 */
    for (const rel of [LF_DATA, LF_APP, LF_VIEW]) {
        const code = stripComments(read(rel));
        for (const banned of ['Dexie', 'chat.history', 'apiOverride', 'fanFriends', 'saveData']) {
            assert.equal(code.includes(banned), false, rel + ' 剥注释后不得出现：' + banned);
        }
    }
    /* 反向自证：这些词确实在注释里出现过（否则说明本判据只是「词本来就没有」）。 */
    assert.ok(read(LF_DATA).includes('Dexie') || read(LF_APP).includes('Dexie'),
        '文件头必须写明「源落 Dexie、本仓不落」这条取舍');
});
test('D5 phone.css 的老福特段必须**独立成行**（cat 追加粘连不许回来）', () => {
    const css = read('phone.css');
    const idx = css.indexOf('/* ---------- [v3.34.0] 老福特 App（.lof-*） ---------- */');
    assert.ok(idx > 0, 'phone.css 必须有老福特段头');
    assert.equal(css[idx - 1], '\n', '段头必须独立成行（起手是上一段末行行尾粘连，语法合法但样式挂错选择器）');
    const seg = css.slice(idx);
    assert.equal(seg.split('.lof-root').length - 1, 1, '老福特样式段必须恰好一份（重复贴就是两份规则互相顶）');
    assert.ok(seg.includes('.lof-tabs'), '段里必须有本件的样式（不是空段头）');
    assert.equal(css.split('/* ---------- [v3.34.0] 老福特').length - 1, 1, '段头不许重复');
    /* 独立文件与拼接段必须同源（改一处忘另一处＝两套样式）。 */
    const own = read(LF_CSS).split('\n').map((s) => s.trim()).filter((s) => s.startsWith('.'));
    for (const rule of own.slice(0, 12)) {
        const sel = rule.split(' ')[0].replace('{', '');
        assert.ok(seg.includes(sel), 'app 内样式必须出现在 phone.css 段里：' + sel);
    }
});
/* ══════════════════════ E — 接线面 ══════════════════════ */
test('E1 六处接线落点齐备且计数正确', () => {
    const apps = read(APPS);
    assert.equal(apps.split("id: 'lofter'").length - 1, 1, 'config/apps.js 必须恰有一条老福特条目');
    assert.ok(apps.includes("name: '老福特'"), '条目名字必须是老福特');
    const storage = read(STORAGE);
    assert.equal(storage.split('/^lofter_/,').length - 1, 1, '存储前缀 /^lofter_/ 必须恰好一条');
    const idx = read(INDEX);
    assert.equal(idx.split("appId === 'lofter'").length - 1, 1, 'index.js 必须有懒加载分支');
    assert.ok(idx.includes("import('./apps/lofter/lofter-app.js')"), '分支必须真导入本件 App');
    assert.ok(idx.includes('window.VirtualPhone.lofterApp = new module.LofterApp('), '分支必须挂到 lofterApp');
    assert.equal(idx.split("'lofterApp'").length - 1, 1, '重绑表必须恰有 lofterApp 槽位一次');
    const keys = read(KEYS);
    for (const k of ['lofter_settings', 'lofter_content', 'lofter_store']) {
        assert.equal(keys.split("key: '" + k + "'").length - 1, 1, '键 ' + k + ' 必须恰登记一次');
    }
    assert.equal(read(V255).split("lofterApp: 'lofter'").length - 1, 1, 'dirMap 必须恰一条 lofterApp');
});
test('E2 生命周期：换会话全量重取、视图级联刷新、页签收回首页', () => {
    const app = read(LF_APP);
    const seg = app.slice(app.indexOf('    onChatChanged()'));
    for (const v of ["this._current = ''", "this._tab = 'home'", 'this._loadSettings()',
        'this.probe()', 'this._view.refresh()']) {
        assert.ok(seg.includes(v), 'onChatChanged 必须做：' + v);
    }
    const view = read(LF_VIEW);
    assert.ok(view.includes('refresh()'), '视图必须提供 refresh（换会话后由 App 调）');
    assert.ok(view.includes('this._bindEvents()'), '重绘后必须重绑事件（不重绑＝点了没反应）');
});
/* ══════════════════════ F — 视图调用面 ══════════════════════ */
test('F1 视图调用的 App 方法在 App 上全都在（可选链吞不掉「方法不存在」）', () => {
    const appSrc = read(LF_APP);
    const methods = new Set();
    const sigRe = /^[ \t]+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm;
    for (const m of appSrc.matchAll(sigRe)) methods.add(m[1]);
    const viewCode = stripComments(read(LF_VIEW));
    const called = new Set();
    for (const m of viewCode.matchAll(/\bapp\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) called.add(m[1]);
    assert.ok(called.size >= 40, '视图调用面异常小（' + called.size + '）—— 判据自己失效了');
    const missing = [];
    for (const n of called) if (!methods.has(n) && n !== 'settings') missing.push(n);
    assert.deepEqual(missing, [], '视图调了 App 上不存在的东西：' + missing.join(' , '));
    assert.ok(methods.size >= 60, 'App 方法面异常小（' + methods.size + '）');
    /* 三个「摆给用户复制」的生成格必须在（本件与源的形态差异所在）。 */
    for (const fn of ['promptShortText', 'promptChapterText', 'promptCommentText']) {
        assert.ok(methods.has(fn), 'App 必须实现生成格：' + fn);
        assert.ok(called.has(fn), '视图必须真调生成格：' + fn);
    }
});
test('F2 三个生成格都是**可复制文本**：不含任何请求痕迹，且真走数据层', () => {
    const app = read(LF_APP);
    for (const sig of ['promptShortText(', 'promptChapterText(', 'promptCommentText(']) {
        const at = app.indexOf('    ' + sig);
        assert.ok(at > 0, '生成格必须在场：' + sig);
        const seg = app.slice(at, at + 2200);
        assert.equal(/\bfetch\s*\(/.test(seg), false, sig + ' 不许自己发请求');
        assert.equal(seg.includes('callAI'), false, sig + ' 不许自己调模型');
    }
    /* 起手那处：`promptChapterText` 只**间**接触三个数据层函数 ⇒ 直接消费为零。 */
    const at = app.indexOf('    promptChapterText(');
    const seg = app.slice(at, app.indexOf('    promptCommentText('));
    for (const fn of ['chapterLengthSpec(', 'chapterPositionFace(', 'prevChapterContext(']) {
        assert.ok(seg.includes(fn), 'promptChapterText 必须**直接**调 ' + fn + '（经包装器调用＝直接消费为零）');
    }
});
/* ══════════════════════ G — 活性面 ══════════════════════ */
const countHits = (rel, needle) => stripComments(read(rel)).split(needle).length - 1;
test('G1 本版修掉的功能级失效必须有真调用点（导出了不等于用上了）', () => {
    const checks = [
        /* 数据层是**声明/定义处**（各自 1~2 次），消费在视图与 App。
         * ★ 门槛一律取**实测真值**，不取「希望它有几次」——写高即假红。 */
        [LF_DATA, 'LOFTER_TYPE_LABELS', 1],
        [LF_VIEW, 'LOFTER_TYPE_LABELS', 3],
        [LF_VIEW, 'LOFTER_IDLE_TYPES', 2],
        [LF_DATA, 'LOFTER_IDLE_TYPES', 2],
        [LF_APP, 'normalizeWritingStyles', 2],
        [LF_APP, 'readLofterFace', 1],
        [LF_APP, 'LOFTER_WRITING_STYLES', 3],
        /* 起手四处 App 修正：statsOf 走局部常量 / 删死方法 / 删假消费 / 直接消费 */
        [LF_APP, 'contentFace()', 1],
        [LF_VIEW, 'contentFace', 1],
        [LF_VIEW, 'builtInStyleIds', 1],
        [LF_VIEW, 'statsOf', 1],
    ];
    const bad = [];
    for (const [rel, need, atLeast] of checks) {
        const hits = countHits(rel, need);
        if (hits < atLeast) bad.push('dead:' + need + '@' + rel + '=' + hits + '<' + atLeast);
    }
    assert.deepEqual(bad, [], '活性面不达标：' + bad.join(' , '));
});
test('G2 两处**假消费**形态不许回来（拿「名字出现」糊弄零消费门禁）', () => {
    const view = stripComments(read(LF_VIEW));
    assert.equal(view.includes('void '), false, '视图里不许有 void 假消费（真消费必须是调用式）');
    assert.equal(/void\s+[A-Z_]+\s*;/.test(stripComments(read(LF_APP))), false,
        'App 里不许再出现 `void SOME_EXPORT;` 式假消费');
    assert.equal(stripComments(read(LF_APP)).includes('counts()'), false,
        '起手那个死方法 counts()（两分支返回同一常量、零调用点）不许回来');
    assert.equal(stripComments(read(LF_VIEW)).includes('const builtIn = app.builtInStyleIds(); void builtIn;'), false,
        '视图起手那处 `void builtIn;` 不许回来');
});
/* ══════════════════════ H — 键归属 ══════════════════════ */
test('H1 三条会话键登记 scope=chat、宽匹配族在场、且**真被产品消费**', () => {
    const keys = read(KEYS);
    const storage = read(STORAGE);
    for (const k of ['lofter_settings', 'lofter_content', 'lofter_store']) {
        assert.ok(new RegExp("\\{ key: '" + k + "', scope: 'chat'").test(keys),
            '键 ' + k + ' 必须声明会话隔离（漏配＝换会话串味，不报错）');
    }
    assert.ok(storage.includes('/^lofter_/'), '宽匹配族必须在（三键自动接住）');
    const app = read(LF_APP);
    for (const k of ['lofter_settings', 'lofter_content', 'lofter_store']) {
        assert.ok(app.includes("'" + k + "'"), LF_APP + ' 必须真用这条键：' + k);
    }
    /* 三条键不许互换（互换了照样跑，只是三类状态混在一处）。 */
    assert.ok(app.indexOf("const SETTINGS_KEY = 'lofter_settings'") > 0);
    assert.ok(app.indexOf("const CONTENT_KEY = 'lofter_content'") > 0);
    assert.ok(app.indexOf("const STORE_KEY = 'lofter_store'") > 0);
    /* 数据层不许自己碰键（键只在 App 层）。 */
    assert.equal(read(LF_DATA).includes('lofter_settings'), false, LF_DATA + ' 不许自己引用存储键');
});
/* ══════════════════════ K — 单一真源（桥契约门 J7 形态） ══════════════════════ */
test('K1 归因 / 文案表不许手写标识符形键：视图里必须零手写表', () => {
    const view = stripComments(read(LF_VIEW));
    /* 视图不许再出现 `TYPE_LABEL`（真源名是 LOFTER_TYPE_LABELS）。 */
    assert.equal(view.replace(/LOFTER_TYPE_LABELS/g, '').includes('TYPE_LABEL'), false,
        '视图里不许残留手写的 TYPE_LABEL 表（桥契约门 J7 抓的就是这一形态）');
    /* 视图不许手写非活跃类型（真源必须走 LOFTER_IDLE_TYPES）。 */
    assert.equal(view.includes("'oc_creator'"), false, '视图不许手写非活跃类型');
    assert.equal(view.includes("'reviewer'"), false, '视图不许手写非活跃类型');
    /* 反向自证：真源常量的值必须真被视图消费（否则上面的「不许出现」只是空气）。 */
    assert.ok(view.includes('LOFTER_TYPE_LABELS['), '视图必须**取值**真源表');
    assert.ok(view.includes('LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES)'), '下拉清单必须由两份真源拼出');
    /* 判据自身的判别力自证：手写键在被审面里必须能被认出（跑一遍真件源码的等价破坏）。 */
    const damaged = read(LF_VIEW).replace('LOFTER_TYPE_LABELS[', 'TYPE_LABEL[');
    assert.equal(damaged.includes('TYPE_LABEL['), true, '破坏必须真的发生');
    assert.equal(stripComments(damaged).replace(/LOFTER_TYPE_LABELS/g, '').includes('TYPE_LABEL'), true,
        '本判据必须能抓到「引用点退回手写表」这一形态');
});
/* ══════════════════════ I — 负控制 ══════════════════════ */
/** 破坏表：锚点一律取**代码行**，一律字面 split/join（不用 String.replace，避免 `$&` 被解释）。 */
const DAMAGE = {
    /* ① 规范器不再带出评论数组（本版最贵那处缺陷原样回潮） */
    d1: [LF_DATA, '        comments,\n        stats: {', '        stats: {'],
    /* ② 章号坏值兜成 1（源那族「第 0 章与第 1 章同号」） */
    d2: [LF_DATA, 'chapterNum: a.chapterNum === undefined || a.chapterNum === null ? null : numOrNull(a.chapterNum),',
        'chapterNum: numOrNull(a.chapterNum) || 1,'],
    /* ③ 人话表的键退回**手写**（桥契约门 J7 的形态；表还在，键却是另一份清单） */
    d3: [LF_DATA, '    const types = LOFTER_ACTIVE_TYPES.concat(LOFTER_IDLE_TYPES);',
        "    const types = ['fan_writer', 'fan_artist', 'cp_fan', 'info_station', 'oc_creator', 'x_fake'];"],
    /* ④ 「0 条评论」与「还没读出来」塌成一态 */
    d4: [LF_DATA, '    if (rawComments === undefined || rawComments === null) return { count: null, face: LOFTER_REASONS.key_absent };',
        '    if (rawComments === undefined || rawComments === null) return { count: 0, face: LOFTER_REASONS.empty };'],
    /* ⑤ 统计序关系失守（收藏可以大过心） */
    d5: [LF_DATA, '    const favorites = Math.max(0, Math.floor(hearts * 0.375));',
        '    const favorites = Math.max(0, Math.floor(hearts * 3.75) + 100);'],
    /* ⑥ 越界编号块静默收下（池里没有第 9 号也照收） */
    d6: [LF_DATA, '        if (!author) continue;', '        if (!author) { out.push({ author: { id: \'\', name: \'\' }, type: \'short\', title: null, summary: null, tags: [], content: \'越界块\', hasImages: false, imageCount: 0, comments: [] }); continue; }'],
    /* ⑦ 滑窗不再区分全文与摘要（全部给全文） */
    d7: [LF_DATA, '        if (i >= fromIdx) {', '        if (true) {'],
    /* ⑧ 楼中楼深度不再有上限（且访问集失效 —— 自指数据会越走越深） */
    /* ★ 替换串必须让**破坏后的源码仍是合法 JS**（`else` 后面直接接 `walk(...)` 会语法错，
     *   转红就只证明「文件坏了」而不是「行为变了」）——J2 当场抓过这一条。 */
    d8: [LF_DATA, '            if (depth < LOFTER_LIMITS.maxCommentDepth) walk(n.children, depth + 1);',
        '            if (true) walk(n.children, depth + 1);'],
    /* ⑨ App：续章不再直调滑窗（退回只**间**接触 ⇒ 直接消费为零） */
    a1: [LF_APP, 'const ctx = prevChapterContext(chapters, num, LOFTER_FULL_TEXT_WINDOW);',
        'const ctx = { fullCount: 0, digestCount: 0, blocks: [] };'],
    /* ⑩ App：收下批次时**不再如实回报裁剪**（`expired` 字段整块消失）
     *  ★ 破坏面必须与判据面**在同一行**：`expired: pr.expired` 这个子串在 App 里另有一处
     *    （createCollection 的返回），只改数值判据看不见 ⇒ 假绿。故这里改成删字段。 */
    a2: [LF_APP, 'expired: pr.expired, firstId:', 'firstId:'],
};
/** App 侧的**结构面**判据（不加载副本 —— 编排层 import 视图/宿主，副本树里跑不起来）。 */
const appPromptProblems = (src) => {
    const bad = [];
    const at = src.indexOf('    promptChapterText(');
    const seg = src.slice(at, src.indexOf('    promptCommentText('));
    for (const fn of ['chapterLengthSpec(', 'chapterPositionFace(', 'prevChapterContext(']) {
        if (!seg.includes(fn)) bad.push('prompt-not-direct:' + fn.slice(0, -1));
    }
    return bad;
};
const appCountProblems = (src) => {
    const bad = [];
    /* 「收下批次」这条入口必须**如实回报裁剪条数**：判据按返回语句裁段再看字段在不在
     * （不引用破坏串 —— 判据纯度：负控制层里的锚点字面量只准声明一次）。 */
    const m = src.match(/return \{ ok: true, parsed:[\s\S]{0,220}?\};/);
    if (!m) bad.push('ingest-return-missing');
    else if (!m[0].includes('expired')) bad.push('ingest-expired-not-reported');
    if (src.includes('void LOFTER_REASONS')) bad.push('fake-consume-void');
    if (src.includes('    counts()')) bad.push('dead-method-counts');
    return bad;
};
const dataProblems = (mod) => {
    const bad = [];
    /* ① 评论必须过规范器仍在 */
    const a = mod.normalizeArticle({ id: 'x', stats: { comments: 3 }, comments: [{ id: 'c1', content: 'a' }, { id: 'c2', content: 'b' }] });
    if (!Array.isArray(a.comments) || a.comments.length !== 2) bad.push('comments-dropped');
    /* ② 章号坏值即 null */
    if (mod.normalizeArticle({ chapterNum: 'nope' }).chapterNum !== null) bad.push('chapter-num-coerced');
    if (mod.normalizeArticle({ chapterNum: 0 }).chapterNum !== 0) bad.push('chapter-zero-coerced');
    /* ③ 人话表键必须与两份清单一致 */
    const want = mod.LOFTER_ACTIVE_TYPES.concat(mod.LOFTER_IDLE_TYPES);
    const got = Object.keys(mod.LOFTER_TYPE_LABELS);
    if (got.length !== want.length || got.some((k, i) => k !== want[i])) bad.push('labels-keys-handwritten');
    /* ④ 三态不许塌 */
    const un = mod.commentCountFace(null);
    if (un.count !== null) bad.push('unread-comment-not-null');
    if (un.face === mod.commentCountFace([]).face) bad.push('unread-collides-with-zero');
    /* ⑤ 序关系恒成立 */
    for (const heat of [0, 12000, 999999]) {
        const s = mod.deriveStats(heat, 30);
        if (!(s.hearts >= s.favorites && s.favorites >= s.comments)) bad.push('stats-order-broken');
    }
    /* ⑥ 越界块必须被丢 */
    const pool = mod.LOFTER_BUILT_IN_AUTHORS.filter((x) => mod.isActiveLofterType(x.type));
    const parsed = mod.parseLofterBatch('---LOF---\nTAG: [N9]\nCONTENT: 这个块该被丢掉才对。', pool);
    if (parsed.length !== 0) bad.push('out-of-range-tag-kept');
    /* ⑦ 滑窗必须区分全文与摘要：给 8 章要 5 全文 2 摘要，且**摘要真的被截短**。
     *  ★ 为什么不能只看 fullCount/digestCount：那两数在 `normalizeArticle` 丢掉
     *    `chapterNum` 时会**一起**归零（关联红）—— 判据就会对与本条无关的破坏也转红，
     *    假红比漏报更伤（本仓记过的账）。故判据落在**模式与内容长度**上。 */
    const chs = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + i, chapterNum: i + 1, title: 't', content: 'x'.repeat(400) }));
    const ctx = mod.prevChapterContext(chs, 8, mod.LOFTER_FULL_TEXT_WINDOW);
    if (ctx.fullCount !== mod.LOFTER_FULL_TEXT_WINDOW || ctx.digestCount !== 2) bad.push('window-mode-collapsed');
    for (const b of ctx.blocks) {
        const len = String(b.text || '').length;
        if (b.mode === 'digest' && len > 260) bad.push('digest-not-truncated');
        if (b.mode === 'full' && len < 400) bad.push('full-truncated');
    }
    /* ⑧ 楼中楼深度必须被上限夹住 */
    const chain = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + (i + 1), content: 'x', replyToCommentId: i ? 'c' + i : null }));
    const rows = mod.flattenComments(mod.buildCommentTree(chain));
    if (Math.max.apply(null, rows.map((n) => n.depth)) > mod.LOFTER_LIMITS.maxCommentDepth) bad.push('comment-depth-unbounded');
    return bad;
};
function chr96() { return String.fromCharCode(96); }
/** num-gate 的等价桩（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';
/** 造一份破坏副本并**落盘**（只写文件，不加载）。副本按**真目录结构**建。 */
function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3340_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    return { target, src: damaged };
}
async function loadDamagedCopy(rel, from, to) {
    const { target, src } = writeDamagedCopy(rel, from, to);
    return { mod: await import(pathToFileURL(target).href), src };
}
const NEG = [
    ['I1 破坏「规范器带出评论」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['comments-dropped']],
    ['I2 破坏「章号坏值即 null」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['chapter-num-coerced']],
    ['I3 破坏「人话表键取真源」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['labels-keys-handwritten']],
    ['I4 破坏「未读与 0 条分成两态」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['unread-comment-not-null', 'unread-collides-with-zero']],
    ['I5 破坏「统计序关系」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['stats-order-broken']],
    ['I6 破坏「越界块丢弃」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['out-of-range-tag-kept']],
    ['I7 破坏「滑窗区分全文与摘要」⇒ 内核判据必须转红', 'd7', 'data', dataProblems, ['window-mode-collapsed']],
    ['I8 破坏「楼中楼深度上限」⇒ 内核判据必须转红', 'd8', 'data', dataProblems, ['comment-depth-unbounded']],
    ['I9 破坏「续章直调滑窗」⇒ 结构面判据必须转红', 'a1', 'app', appPromptProblems, ['prompt-not-direct']],
    ['I10 破坏「裁剪如实回报」⇒ 结构面判据必须转红', 'a2', 'app', appCountProblems, ['ingest-expired-not-reported']],
];
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        if (kind === 'app') {
            const { src } = writeDamagedCopy(rel, from, to);
            const bad = judge(src);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            /* 对照：真源码必须干净（否则「转红」可能只是因为判据本来就红 —— 假绿三形之一）。 */
            assert.deepEqual(judge(read(rel)), [], '对照：真源码必须干净');
        } else {
            const { mod } = await loadDamagedCopy(rel, from, to);
            const bad = judge(mod);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(DAT), [], '对照：真模块必须干净');
        }
    });
}
/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const q = chr96();
    assert.equal(stripComments('a /* 注释里的 Dexie */ b').includes('Dexie'), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 Dexie\nb').includes('Dexie'), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 Dexie';").includes('Dexie'), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 Dexie' + q + ';').includes('Dexie'), true, '模板串里的必须留住');
    assert.equal(stripComments('a = "带 \\" 转义的 Dexie";').includes('Dexie'), true, '转义串不许被误断');
    for (const rel of [LF_DATA, LF_APP, LF_VIEW]) {
        const sentinel = stripComments(read(rel) + '\n/* RP_TAIL_3340 */\n');
        assert.equal(sentinel.includes('RP_TAIL_3340'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});
test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, key + ' 的锚点必须恰中 1 次（实测 ' + hits + '）');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        assert.ok(damaged.includes(to) || to === '', key + ' 替换后必须出现新串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3340k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [LF_DATA, LF_APP, LF_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split('\n')[0]);
    }
});
/* ══════════════════════ L — 版本锚 ══════════════════════ */
test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read('index.js');
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 34),
        '本套件成立于 RubyPhone 3.34.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.34.0 老福特），不是「当版」——
     *   本仓已有四处「守别人的版」的口径错（v3270 / v3280 / v3290 / v3300）。 */
    const SELF = '3.34.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['老福特', '楼中楼', '文风', '滑窗', '真源']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'),
        '本版条目必须如实登记批次纪律（只跑单套件）');
});
/* ══ 追加段锚：V3340_SECTION_4 ══ */