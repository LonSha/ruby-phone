// tests/system-v3350.test.mjs — Pixiv [v3.35.0]
//
//   本版接的是素材缝合路线图 **第 2 层第六件：Pixiv**。源侧是 Perigee 的
//   `js/pixiv-illust.js`（1411 行 / 80350 字节）+ `js/pixiv-novel.js`（3888 行 / 213700 字节）
//   + `js/pixiv-comments.js`（563 行 / 30713 字节），三片共 **5862 行 / 324763 字节** ——
//   一个挂在宿主全局 `AppState.data.pixivData` 上（65 处命中）、以 `Utils.saveData`
//   整块回写（38 处命中）的**日文同人平台（真 pixiv）仿真**：
//   ① 插画面（AI 生图 → IndexedDB Blob → 画廊）② 小说面（AI 生成连载 → 阅读器 → 心数）
//   ③ 评论区（章节级楼中楼）④ 个人面（收藏 / 追更 / 浏览 / 我的）⑤ 设置面（文风库 / 语言模式）
//   ⑥ 翻译折叠面（日语正文 + `<details class="tl">` 中文译文）。
//
//   ★ 取五块 / 四块不缝 / 三条偏离（逐条写在 pixiv-data.js 文件头，此处只留判据面）：
//     取：① 作品面 ② 阅读器与逐章点心 ③ 续章滑窗 ④ 评论楼中楼 ⑤ 我的四格 + 插画登记；
//         设置面取「文风库 + 语言模式 + 日文纯度规则」。① 的插画面**换形态**：
//         源是「自己调生图 API 拿 Blob 落库」，本件是**登记面**（只记提示词 / 尺寸 / 张数 / 谁画的）。
//     不缝：① 源自己读 `imageApiConfig.provider` 挑 NovelAI / OpenAI 兼容 / OpenRouter
//             三条生图链路 + 两条正文链路，共 **19 处网络调用** —— 本件零网络调用；
//           ② 源落 IndexedDB（`IllustGallery`）并经 `Utils.saveData` 整块回写、
//             把卡片往宿主消息数组 push —— 本件零数据库、不替宿主写楼层；
//           ③ 源要 `twitterData.fanFriends` 当作者池 / `broadcast.plotProgress` 当题材源 /
//             `forumData.threads` 当分享出口 / `melonbooksData` 当出版面 —— 本件自带原创池（9 位），零跨 App 读；
//           ④ 源存生图 URL 与外链封面、把 Blob 转 base64 data URL 塞帖 ——
//             本件一张图都不存、一条外链都不收（视图不渲染 `<img>`）。
//     偏离：心数收成唯一确定性实现（`hearts` 恒等于逐章最高）/ 评论树深度有上限且上溯带访问集 /
//          译文折叠块走白名单不耦合转义器。
//
//   ★ 本版抓到**四处真缺陷**（都不是自述；其中三处由自跑冒烟/探针当场量出）：
//     ① **坏 storage 被静默读成「空」**：`probe()` 经吞异常的 `_readJSON` 取数 ⇒
//        异常永远到不了自己的 catch ⇒ `storageOk` 恒真 ⇒ storage 读不出来时报
//        「还没有作品」（`empty`）而不是「读不到」（`storage_absent`），并照旧现算一份
//        空投影让视图渲染整套空壳。**「取不出来」与「本来就是空的」不是一回事**（A9 钉住）；
//     ② **`recommendAuthors` 把数据层的返回对象当数组给视图**：数据层返回
//        `{picked, considered, matched}` 三个读数，App 原样吐出、视图 `for (const a of rec)`
//        迭代 ⇒ 点开「我的」面直接 `TypeError`（G3 钉住）；
//     ③ **评论回填是死代码**：`ingestComments` 导出了、有实现、**零入口可达** ——
//        功能级失效（G5 钉住），本版补上「解析块 → App → 视图按钮」整条通道；
//     ④ **坏章号补号即错配**：`normalizeChapter({num:'nope'}, 4)` 静默返回 `num: 5`
//        （与文件纪律区自述「坏值即 null」矛盾）⇒ `initNovelPopularity` 按位置取原始章
//        `novel.chapters[c.num - 1]` 错配到**别人的心数**（已给的心数被丢掉），
//        且补号可能与既有章**撞号**（目录两格同号、按号查找只找得到第一条 ⇒ 点一格进另一条）
//        （A10 / A11 钉住）。
//     另修两处**假面**：视图 `#pxv-cmt-again`「让宿主重读这一話」绑的是废语句
//     `this._open = this._open;`（按了只重绘）；`PIXIV_COMMENT_DELIM` 导出后
//     App 层漏导入（走到该分支即 `ReferenceError` —— `node --check` 全绿也抓不到，G6 钉住）。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 内核：类型清单与真源表闭合 / 内置池与设置面闭合 / 文风库坏值不许回默认 /
//       章号坏值即 null（不许补号、不许撞号、条数如实）/ 心数三面永远自洽 /
//       三态与「0 条」不许塌 / 楼中楼深度上限 + 自指不死循环 / 认源五态分开；
//     B 解析：`---COMMENT---` 分块 / 空块**如实计数** / `REPLY` 序号挂本次列表 /
//       译文白名单放过、非法标签逐条挡下并计数 / 段落切分先净化；
//     C 接线：三条键随会话隔离 / 六处接线落点到位 / 重绑表在册 / 视图调用面闭合；
//     D 通道：不碰模型 / 不落数据库 / 不碰宿主对象 / 不跨 App 读 / 不收外链与图（一条都没有）；
//     E 活性：本版修掉的功能级失效必须有真调用点；两处假面禁止语不许回来；
//     F 视图面闭合：视图调用的 App 方法在 App 上全都在（差集必须为空）；
//     G 视图契约：选取面给数组而非对象 / 回填整条通道可达 / 漏导入不许回潮；
//     H 键归属：三条会话键登记 scope=chat / 宽匹配族在场 / 三条键真被产品消费；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向 / 破坏表锚点在场（恰 1 次）且替换保真 / 替换后仍是合法 JS；
//     K 单一真源：类型人话表**不手写键**；分隔符只留一个真源；
//     L 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据函数一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/pixiv/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），否则相对 import
//   会解析错位置、首跑即假红；App 侧的编排断言只做**结构面**（不加载副本）。
//   ★ 判据纯度：负控制层里的锚点字面量**只准声明一次**（在 DAMAGE 表里），
//     判据函数不得引用破坏串（否则破坏一改，判据跟着变 ⇒ 假绿三形之三）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/pixiv/pixiv-data.js';
import { PixivApp } from '../apps/pixiv/pixiv-app.js';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PX_DATA = 'apps/pixiv/pixiv-data.js';
const PX_APP = 'apps/pixiv/pixiv-app.js';
const PX_VIEW = 'apps/pixiv/pixiv-view.js';
const PX_CSS = 'apps/pixiv/pixiv.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
/** 剥注释（字符状态机，与 v3300 / v3310 / v3320 / v3330 / v3340 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头与源码注释逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`NovelAI`、`AppState`、`forumData`…）是
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
        set: (k, v) => { box.set(k, v); return true; },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 `/^pixiv_/` 前缀拼 chatId 实现）。
 *  ★ 与 v3340 的差别：那份的桥接前缀是 `lofter_`，本件必须换成 `pixiv_` ——
 *    直接抄会把「换会话后读到别人数据」这条判据测成空气（假绿三形之一）。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
        _box: box,
    };
}
/** 造一件**完整可读**的作品（建作品 → 收两章），返回 `{ app, nid }`。 */
function fixtureNovel(seed) {
    const st = memStorage(seed || {});
    const app = new PixivApp(null, st);
    app.probe();
    const r = app.createNovel({ title: '雪の日の電車', synopsis: '冬の海へ向かう話', tagLine: '純愛 日常' });
    app.ingestChapter(r.id, '窓の外は雪だった。' + 'あ'.repeat(400), { title: '第 1 話 雪' });
    app.ingestChapter(r.id, '春が来た。' + 'い'.repeat(600), { title: '第 2 話 春' });
    return { app, nid: r.id, st };
}
/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 类型清单与真源表闭合：活跃 1 + 非活跃 3，人话表键与清单逐一对齐', () => {
    assert.deepEqual(DAT.PIXIV_ACTIVE_TYPES, ['doujin_writer'],
        '活跃 1 类必须与源口径同序（源只认 doujin_writer）');
    assert.deepEqual(DAT.PIXIV_IDLE_TYPES, ['official', 'marketing', 'info_station'],
        '非活跃 3 类必须显式登记（源是静默过滤，本仓不许静默）');
    const all = DAT.PIXIV_ACTIVE_TYPES.concat(DAT.PIXIV_IDLE_TYPES);
    assert.deepEqual(Object.keys(DAT.PIXIV_TYPE_LABELS), all,
        '人话表的键必须**现取**两份清单（顺序也一致）—— 手写键就是桥契约门 J7 立据的那个形态');
    for (const t of all) {
        assert.equal(typeof DAT.PIXIV_TYPE_LABELS[t], 'string', '每一型都要有人话：' + t);
    }
});
test('A2 判别力：isActivePixivType 对两类都要有判别力（源是全判真的那一族）', () => {
    assert.equal(DAT.isActivePixivType('doujin_writer'), true);
    for (const t of DAT.PIXIV_IDLE_TYPES) {
        assert.equal(DAT.isActivePixivType(t), false, '非活跃类必须判假：' + t);
    }
    assert.equal(DAT.isActivePixivType(''), false);
    assert.equal(DAT.isActivePixivType(null), false);
    /* 判别力自证：内置池里**必须同时**存在活跃与非活跃两类，
     * 否则「全判真」与「全判假」两种坏实现都能蒙过上面的断言。 */
    const kinds = new Set(DAT.PIXIV_BUILT_IN_AUTHORS.map((a) => DAT.isActivePixivType(a.type)));
    assert.equal(kinds.size, 2, '内置池必须两类都在（否则判别力判据是空气）');
});
test('A3 内置池 9 位：8 位写手 + 1 位公式号，字段齐备、id 唯一', () => {
    assert.equal(DAT.PIXIV_BUILT_IN_AUTHORS.length, 9, '内置 9 位（源要宿主推特池，本件自带）');
    const active = DAT.PIXIV_BUILT_IN_AUTHORS.filter((a) => a.type === 'doujin_writer');
    assert.equal(active.length, 8, '写手 8 位');
    assert.equal(DAT.PIXIV_BUILT_IN_AUTHORS.filter((a) => a.type === 'official').length, 1, '公式号 1 位');
    const ids = DAT.PIXIV_BUILT_IN_AUTHORS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'id 不许重复');
    for (const a of DAT.PIXIV_BUILT_IN_AUTHORS) {
        assert.ok(a.name && a.bio, '每位都要有名字与简介：' + a.id);
        assert.equal(a.builtIn, true, '内置必须打标（写盘时不许把它当自建存）');
        assert.ok(Array.isArray(a.contentTags), '创作 tag 必须是数组：' + a.id);
    }
    /* 每位活跃写手的 writingStyle 必须能在文风库里落到一款（否则「作者→文风」这条线是断的）。 */
    const styleIds = DAT.PIXIV_WRITING_STYLES.map((s) => s.id);
    for (const a of active) {
        assert.ok(styleIds.indexOf(a.writingStyle) >= 0, '写手的文风必须在库里：' + a.id + ' → ' + a.writingStyle);
    }
});
test('A4 文风库 5 款：id / name / rules 齐备，rules 是**真喂进 prompt 的指令**', () => {
    assert.equal(DAT.PIXIV_WRITING_STYLES.length, 5, '文风库 5 款（源 getDefaultWritingStyles 同数）');
    for (const s of DAT.PIXIV_WRITING_STYLES) {
        assert.ok(s.id && s.name && s.rules, '每款都要 id / name / rules：' + s.id);
        assert.equal(s.enabled, true, '内置默认全开：' + s.id);
        assert.ok(s.rules.length >= 20, '文风指令必须写足（源是几十字的口径）：' + s.id);
    }
    /* 规范化后不许掉款、不许掉 rules —— 设置面回写丢文风库是老福特那版的实伤，这里一并钉住。 */
    const norm = DAT.normalizeWritingStyles(DAT.PIXIV_WRITING_STYLES);
    assert.equal(norm.length, 5, '规范化不许掉款');
    assert.deepEqual(norm.map((s) => s.id), DAT.PIXIV_WRITING_STYLES.map((s) => s.id), '顺序与 id 都要保真');
    for (let i = 0; i < norm.length; i++) {
        assert.equal(norm[i].rules, DAT.PIXIV_WRITING_STYLES[i].rules, 'rules 不许被截断：' + norm[i].id);
    }
});
test('A5 设置规范化：语言走白名单、条数夹紧、文风库坏值不许回默认（回默认=用户改的被吞）', () => {
    const d = DAT.defaultPixivSettings();
    assert.equal(d.language, 'jp-cn', '默认语言');
    assert.equal(d.writingStyles.length, 5, '默认带全 5 款');
    assert.equal(DAT.normalizePixivSettings({ language: 'nope' }).language, 'jp-cn', '坏语言回默认');
    assert.equal(DAT.normalizePixivSettings({ language: 'jp-only' }).language, 'jp-only', '合法语言必须留住');
    assert.equal(DAT.normalizePixivSettings({ fontSize: 99 }).fontSize, 24, '字号夹上界');
    assert.equal(DAT.normalizePixivSettings({ fontSize: 1 }).fontSize, 12, '字号夹下界');
    assert.equal(DAT.normalizePixivSettings({ fontSize: 'x' }).fontSize, 16, '坏字号取默认（不塌成 0）');
    assert.equal(DAT.normalizePixivSettings({ maxInjectLines: 999 }).maxInjectLines, DAT.PIXIV_LIMITS.maxInjectLines);
    /* ★ 「用户自己改过的文风库」必须原样留住：给一份**非默认**的库，规范化后仍是那一份。 */
    const mine = [{ id: 'my_style', name: '我的文风', rules: '短句，留白，少形容词', enabled: true }];
    const got = DAT.normalizePixivSettings({ writingStyles: mine }).writingStyles;
    assert.equal(got.length, 1, '自建库不许被内置 5 款顶替');
    assert.equal(got[0].id, 'my_style');
    /* 空库才回默认（那是「没给」不是「给空了」的合理兜底）。 */
    assert.equal(DAT.normalizePixivSettings({ writingStyles: [] }).writingStyles.length, 5, '空库回默认');
});
test('A6 文风解析四模式：explicit / missing / none_enabled / random 各归各', () => {
    const styles = DAT.PIXIV_WRITING_STYLES;
    const ex = DAT.resolveWritingStyle(styles, 'pixiv_style_knife');
    assert.equal(ex.mode, 'explicit', '点名的必须给它');
    assert.equal(ex.style.id, 'pixiv_style_knife');
    assert.equal(DAT.resolveWritingStyle(styles, 'nope').mode, 'missing', '点名点名不到 = missing（不是随机）');
    assert.equal(DAT.resolveWritingStyle(styles.map((s) => Object.assign({}, s, { enabled: false })), '').mode,
        'none_enabled', '一款都没开 = none_enabled（不是 missing）');
    const onlyOne = styles.map((s) => Object.assign({}, s, { enabled: false }));
    onlyOne[2].enabled = true;
    const rd = DAT.resolveWritingStyle(onlyOne, '');
    assert.equal(rd.mode, 'random');
    assert.equal(rd.style.id, onlyOne[2].id, '随机只在**开着**的款里抽');
    /* 四模式必须两两不同 —— 否则「分开报」只是四个名字同一个读数。 */
    const modes = new Set([ex.mode, 'missing', 'none_enabled', rd.mode]);
    assert.equal(modes.size, 4, '四模式不许塌');
});
test('A7 章号：坏值即 null、0 是合法章号（不许把 0 当第 1 章）', () => {
    /* ★ 这是本版**真缺陷④**的第一半：原实现 `numOrNull(...) === null ? (index + 1) : ...`
     *   把坏号静默补成位置号，与文件纪律区自述「坏值即 null」矛盾。 */
    assert.equal(DAT.normalizeChapter({ num: 'nope', content: 'x' }, 4).num, null,
        '坏号必须是 null —— 补成位置号会与相邻章撞号、还会让下游按位置取别人数据');
    assert.equal(DAT.normalizeChapter({ content: 'x' }, 4).num, null, '「没给」也是 null');
    assert.equal(DAT.normalizeChapter({ num: 0, content: 'x' }, 0).num, 0,
        '0 是合法章号（源 `chIdx + 1` 那族把 0 与 1 塌成一个数，本仓不许）');
    assert.equal(DAT.normalizeChapter({ num: '3', content: 'x' }, 0).num, 3, '数字串要认');
    assert.equal(DAT.normalizeChapter({ num: -5, content: 'x' }, 0).num, 0, '负数抬到下界 0（0 是合法章号，不许抬成 1）');
    /* 坏号章**不许被丢掉**：条数要如实。 */
    const n = DAT.normalizeNovel({ id: 'n', chapters: [{ num: 1, content: 'a' }, { num: 'bad', content: 'b' }] });
    assert.equal(n.chapters.length, 2, '坏号章条数如实（滤掉=静默丢数据）');
    assert.deepEqual(n.chapters.map((c) => c.num), [1, null], '好号保真、坏号 null');
});
test('A8 心数三面永远自洽：缓存 === 逐章最高；显式给过的心数（含 0）保住', () => {
    /* ★ 这是**真缺陷④**的第二半：原实现按 `c.num - 1` 取原始章 ⇒ 坏号/补号时错配，
     *   已给的心数被丢掉、改算派生值。 */
    const n = DAT.normalizeNovel({
        id: 'n1', hearts: 999999,
        chapters: [{ num: 1, hearts: 10 }, { num: 2, hearts: 20 }],
    });
    assert.equal(n.hearts, 20, '缓存必须等于逐章最高，不许留「比逐章大的存量值」');
    const h = DAT.heartsFace(n);
    assert.equal(h.consistent, true, '三面必须自洽');
    assert.equal(h.cached, h.maxChapter);
    /* 显式给过的心数必须保住 —— 判据落**每一章**而不是只落合计。 */
    const p = DAT.initNovelPopularity({
        id: 'n2',
        chapters: [{ num: 1, content: 'a'.repeat(30), hearts: 0 }, { num: 'bad', content: 'b'.repeat(30), hearts: 77 }],
    });
    assert.equal(p.chapters[0].hearts, 0, '显式 0 是**合法读数**，不许被当成「没给过」而覆盖');
    assert.equal(p.chapters[1].hearts, 77, '坏号章的显式心数也要保住（按下标配对）');
    assert.equal(p.chapters[1].num, null, '坏号仍是 null');
    /* 幂等：连跑两次读数一致。 */
    const p2 = DAT.initNovelPopularity(p);
    assert.deepEqual(p2.chapters.map((c) => c.hearts), p.chapters.map((c) => c.hearts), '初始化必须幂等');
    assert.equal(p2.hearts, p.hearts, '缓存读数幂等');
});
test('A9 认源五态：storage 读不出来 ≠ 本来就是空的（这是本版真缺陷①）', () => {
    assert.equal(DAT.readPixivFace(null), DAT.PIXIV_REASONS.storage_absent, 'null → 读不出来');
    assert.equal(DAT.readPixivFace(undefined), DAT.PIXIV_REASONS.storage_absent);
    assert.equal(DAT.readPixivFace('x'), DAT.PIXIV_REASONS.storage_absent, '非对象也是读不出来');
    assert.equal(DAT.readPixivFace({}), DAT.PIXIV_REASONS.storage_absent, '三键全缺 = 没这条键');
    assert.equal(DAT.readPixivFace({ novels: [], illustrations: [] }), DAT.PIXIV_REASONS.empty, '键在、是空 = 空');
    assert.equal(DAT.readPixivFace({ novels: [{ id: 'a' }] }), DAT.PIXIV_REASONS.ok, '有作品 = ok');
    assert.equal(DAT.readPixivFace({ illustrations: [{ id: 'a' }] }), DAT.PIXIV_REASONS.ok, '只有插画登记也算 ok');
    /* 三态必须两两不同（否则「分开报」是三个名字一个读数）。 */
    assert.equal(new Set([DAT.PIXIV_REASONS.storage_absent, DAT.PIXIV_REASONS.empty, DAT.PIXIV_REASONS.ok]).size, 3);
    /* App 侧真调：坏 storage 必须报 storage_absent 且**投影为 null**（不许现算一份空壳）。 */
    const throwStore = { get: () => { throw new Error('boom'); }, set: () => { throw new Error('boom'); } };
    const app = new PixivApp(null, throwStore);
    app.probe();
    assert.equal(app.faceReason(), DAT.PIXIV_REASONS.storage_absent, '坏 storage 不许被读成「空」');
    assert.equal(app.projection(), null, '读不出来时不许现算投影（视图会渲染整套空壳）');
    assert.equal(app.summaryLine(), '读不到 Pixiv 数据', '读数行也要说实话');
});
test('A10 可用的空 storage：face=empty 但**照旧给一份空投影**（视图要能渲染空壳）', () => {
    const app = new PixivApp(null, memStorage());
    app.probe();
    assert.equal(app.faceReason(), DAT.PIXIV_REASONS.empty, '可用但没数据 = empty');
    const p = app.projection();
    assert.ok(p && Array.isArray(p.novels) && p.novels.length === 0, '空投影必须给出（不是 null）');
    assert.equal(app.readings().totalNovels, 0);
    assert.equal(app.authorsAll().length, 9, '内置池照旧在（冷启动也有 9 位）');
    assert.equal(app.authorsActive().length, 8, '活跃 8 位');
    assert.equal(app.readings().inactiveAuthors, 1, '非活跃 1 位如实计数');
});
test('A11 条数如实：坏号章计入总条数、另报可数章（不许自相矛盾）', () => {
    const st = memStorage();
    const app = new PixivApp(null, st);
    app.probe();
    const r = app.createNovel({ title: '坏号篇', tagLine: '测试' });
    app.ingestChapter(r.id, '正常一話。' + 'あ'.repeat(120));
    /* 往盘上塞一条坏号章（模拟外源数据），重建实例读回。 */
    const box = JSON.parse(st.get('pixiv_content'));
    const nov = box.novels.filter((x) => x.id === r.id)[0];
    nov.chapters.push({ num: 'nope', content: '坏号的一話。', hearts: 77 });
    st.set('pixiv_content', JSON.stringify(box));
    const app2 = new PixivApp(null, st);
    app2.probe();
    const chs = app2.chaptersOf(r.id);
    assert.equal(chs.length, 2, '坏号章不许被静默丢掉');
    assert.equal(chs.filter((c) => c.num === null).length, 1, '坏号即 null');
    const nums = chs.map((c) => c.num).filter((x) => x !== null);
    assert.equal(new Set(nums).size, nums.length, '不许有同号章（补号撞号是旧形态）');
    const stat = app2.statsOf(r.id);
    assert.equal(stat.chapters, 2, '统计的章数如实（含坏号章）');
    assert.equal(stat.countableChapters, 1, '可数章分开报');
    assert.equal(app2.chapterAt(r.id, 1) !== null, true, '好章仍按号查得到');
});
test('A12 心数确定性：同一输入必得同一读数，逐章不恒同、首章不恒最大', () => {
    assert.equal(DAT.deriveHeatBase(5000, 12345), DAT.deriveHeatBase(5000, 12345), '同一输入同一读数');
    assert.equal(DAT.deriveHeatBase(999999999, 98), 30000, '上界 30000');
    assert.ok(DAT.deriveHeatBase(0, 3) === 0, '0 粉丝 = 0 基数');
    const c1 = DAT.deriveChapterHearts(1000, 1);
    const c2 = DAT.deriveChapterHearts(1000, 2);
    const c3 = DAT.deriveChapterHearts(1000, 3);
    assert.ok(c1 !== c2 && c2 !== c3, '逐章心数不许同值（源是乘随机，本件按章号散开）');
    assert.equal(DAT.deriveChapterHearts(1000, 1), c1, '逐章读数确定');
    assert.ok(Math.min(c1, c2, c3) >= 3, '下限 3');
    assert.equal(DAT.coldOfNovelId('n1'), DAT.coldOfNovelId('n1'), '冷门系数确定');
    const cold = DAT.coldOfNovelId('n1');
    assert.ok(cold >= 2000 && cold <= 20000, '冷门系数落在 2000〜20000：' + cold);
});
test('A13 评论三态：failed 不许被读成 not_read；「0 条」与「还没读」不许同形', () => {
    const notRead = DAT.commentCountFace({});
    const failed = DAT.commentCountFace({ commentsAttempted: true, commentsFailed: true });
    const readZero = DAT.commentCountFace({ commentsLoaded: true, commentsList: [] });
    const readTwo = DAT.commentCountFace({ commentsLoaded: true, commentsList: [{ id: 'a' }, { id: 'b' }] });
    assert.equal(notRead.face, 'not_read');
    assert.equal(failed.face, 'failed', '「试了没成」不是「还没试」——首版把它排在 not_read 之后被静默吞掉');
    assert.equal(readZero.face, 'read', '读出来了是 0 条 = read（条数另报）');
    assert.equal(readTwo.face, 'read');
    assert.equal(readTwo.count, 2);
    assert.equal(readZero.count, 0);
    assert.equal(new Set([notRead.face, failed.face, readZero.face]).size, 3, '三态不许塌');
});
test('A14 楼中楼：深度有上限、自指即停不死循环、孤儿如实报', () => {
    const chain = new Array(8).fill(0).map((_x, i) => ({
        id: 'c' + (i + 1), content: 'x', replyToCommentId: i ? 'c' + i : null,
    }));
    const tree = DAT.buildCommentTree(chain, 3);
    const rows = DAT.flattenComments(tree.roots[0] || {});
    const deepest = rows.length ? Math.max.apply(null, rows.map((r) => r.depth)) : 1;
    assert.ok(deepest <= 3, '深度不许超过上限（实测 ' + deepest + '）');
    assert.ok(tree.truncated > 0, '超深的必须**如实计数**，不许静默挂上去');
    /* 自指：A 回 B、B 回 A —— 必须停下，不许死循环（源靠 guard < 50 停，但不报告）。 */
    const cyc = [{ id: 'a', content: '1', replyToCommentId: 'b' }, { id: 'b', content: '2', replyToCommentId: 'a' }];
    const t2 = DAT.buildCommentTree(cyc, 3);
    assert.ok(t2.roots.length >= 1, '自指数据必须能建出树（不许卡死/抛错）');
    assert.equal(DAT.topAncestorId(cyc, 'a', 32), DAT.topAncestorId(cyc, 'a', 32), '上溯必须确定');
    /* 孤儿：父指针指向不存在的评论 —— 如实计数，不许静默当根了事。 */
    const orph = DAT.buildCommentTree([{ id: 'x', content: '1', replyToCommentId: 'ghost' }], 3);
    assert.equal(orph.orphans, 1, '悬空父指针必须计数');
});
/* ══════════════════════ B — 解析面 ══════════════════════ */
test('B1 评论分隔块：`---COMMENT---` 分块、空块如实计数、REPLY 序号挂本次列表', () => {
    const delim = DAT.PIXIV_COMMENT_DELIM;
    assert.equal(typeof delim, 'string');
    assert.ok(delim.length > 3, '分隔符必须是个真串（不许空）');
    const parsed = DAT.parseCommentsBlock(
        delim + '\nAUTHOR: 読者A\nいい話でした\n'
        + delim + '\nREPLY: 1\n泣いた\n'
        + delim + '\nAUTHOR: 空\n',
    );
    assert.equal(parsed.items.length, 2, '两块有正文的必须收下');
    assert.equal(parsed.skipped, 1, '没有正文的块必须**如实计数**（不许静默丢）');
    assert.equal(parsed.blocks, 3, '块数如实');
    assert.equal(parsed.items[0].author, '読者A');
    assert.equal(parsed.items[1].replyToCommentId, parsed.items[0].id, 'REPLY:1 是**本次第 1 条**的 id');
    /* 越界序号不许造出悬空父指针。 */
    const outRange = DAT.parseCommentsBlock(delim + '\nREPLY: 9\n那边\n');
    assert.equal(outRange.items[0].replyToCommentId, null, '指到不存在的条目一律落根');
    /* 无名块给个中性名（不许空串 —— 视图会渲染成空白行）。 */
    const anon = DAT.parseCommentsBlock(delim + '\n没有作者的正文\n');
    assert.ok(anon.items[0].author && anon.items[0].author.length > 0, '无名块必须有中性署名');
    /* 空输入的三个读数都必须是 0（不是 undefined）。 */
    const empty = DAT.parseCommentsBlock('');
    assert.deepEqual([empty.items.length, empty.skipped, empty.blocks], [0, 0, 0]);
    const alsoEmpty = DAT.parseCommentsBlock('   ');
    assert.equal(alsoEmpty.items.length, 0, '纯空白不许造出条目');
});
test('B2 译文白名单：放过 details/summary/span/br，其余逐条挡下**并计数**', () => {
    const ok = DAT.sanitizeBody('<details class="tl"><summary>訳</summary>中文</details>');
    assert.equal(ok.droppedTags, 0, '白名单标签不许被挡');
    assert.ok(ok.html.indexOf('<details class="tl">') >= 0, '白名单标签要原样留下');
    const bad = DAT.sanitizeBody('<script>alert(1)</script>');
    assert.equal(bad.droppedTags, 2, '非白名单**逐标签**计数（开闭各一次）');
    assert.equal(bad.html.indexOf('<script'), -1, '挡下的标签必须以文本形出现');
    /* 属性值不合规：只认折钩子 `class="tl"`。 */
    const attr = DAT.sanitizeBody('<details class="evil">x</details>');
    assert.equal(attr.droppedAttrs, 1, '非法属性值必须计数（源靠 [^&] 匹配，转义器一换就失守）');
    assert.equal(attr.droppedTags, 0, '标签本身合规就不算标签被挡');
    /* 文本里的危险字符必须转义（用拼装形判定，避免判据自己依赖实体字面量）。 */
    const amp = String.fromCharCode(38);
    const esc = DAT.sanitizeBody('a < b & c');
    assert.ok(esc.html.indexOf(amp + 'lt;') >= 0, '`<` 必须转义');
    assert.ok(esc.html.indexOf(amp + 'amp;') >= 0, '`&` 必须转义');
});
test('B3 段落渲染先净化：正文里夹的标签不许漏进段落', () => {
    const paras = DAT.toDisplayParagraphs('一\n\n二\n<script>x</script>');
    assert.equal(paras.length, 3, '空行切段 + 尾段保留');
    assert.equal(paras[2].droppedTags, 2, '夹在正文里的标签必须在**渲染前**就被挡下');
    assert.ok(paras[2].html.indexOf('<script') === -1, '段落 HTML 里不许有可执行标签');
});
/* ══════════════════════ C — 接线面 ══════════════════════ */
test('C1 三条会话键随会话隔离：换会话后读不到上一段的账', () => {
    const st = sessionStorage();
    const a1 = new PixivApp(null, st);
    a1.probe();
    a1.createNovel({ title: '第一段关系里的作品', tagLine: '純愛' });
    assert.equal(a1.novelsAll().length, 1, '第一段关系里确实有 1 篇');
    st.switchTo('c2');
    const a2 = new PixivApp(null, st);
    a2.probe();
    assert.equal(a2.novelsAll().length, 0, '换会话后不许读到别人的作品（键没随会话隔离就是这个症状）');
    assert.equal(a2.faceReason(), DAT.PIXIV_REASONS.empty, '换会话后是「空」不是「读不到」');
    st.switchTo('c1');
    const a3 = new PixivApp(null, st);
    a3.probe();
    assert.equal(a3.novelsAll().length, 1, '换回来必须还在');
});
test('C2 六处接线落点到位（apps / storage / index / keys-audit / v255 / phone.css）', () => {
    const apps = read(APPS);
    assert.ok(apps.includes("id: 'pixiv'"), 'config/apps.js 必须有 Pixiv 条目');
    const storage = read(STORAGE);
    assert.ok(/\/\^pixiv_\//.test(storage), 'config/storage.js 必须有 /^pixiv_/ 前缀（三条键共用）');
    const index = read(INDEX);
    assert.ok(index.includes("'pixivApp'"), 'index.js 重绑表必须有 pixivApp');
    assert.ok(index.includes("appId === 'pixiv'"), 'index.js 必须有 pixiv 懒加载分支');
    assert.ok(index.includes('apps/pixiv/pixiv-app.js'), '懒加载必须指向真路径');
    const keys = read(KEYS);
    for (const k of ['pixiv_settings', 'pixiv_content', 'pixiv_store']) {
        assert.ok(keys.includes(k), 'keys-audit 必须登记 ' + k);
    }
    assert.ok(read(V255).includes("pixivApp: 'pixiv'"), 'v255 目录映射必须有 pixivApp → pixiv');
    const css = read('phone.css');
    assert.ok(css.includes('Pixiv App（.pxv-*）'), 'phone.css 必须有 Pixiv 段头');
    assert.ok(css.includes('.pxv-root'), '段内必须有真规则（段头孤零零不算投递）');
});
test('C3 重绑表与目录映射的逗号落点规范：逗号紧跟字面量、不许独立成行', () => {
    /* ★ 这是本版 patch 脚本两次回滚的教训：插入数组项时把逗号落在注释块之后，
     *   语法合法（注释被丢掉）但让同表其余写法与它不一致，后续按行解析必踩。
     *   判据落**结构**而不是落某个锚点串：逐行找「只含一个逗号」的行。 */
    const lonely = (rel) => {
        const bad = [];
        const lines = read(rel).split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (/^\s*,\s*$/.test(lines[i])) bad.push(rel + ':' + (i + 1));
        }
        return bad;
    };
    assert.deepEqual(lonely(INDEX), [], 'index.js 不许有「独立成行的逗号」');
    assert.deepEqual(lonely(V255), [], 'v255 不许有「独立成行的逗号」');
});
test('C4 视图调用面闭合：视图调的 App 方法在 App 上全都在', () => {
    const view = stripComments(read(PX_VIEW));
    const app = stripComments(read(PX_APP));
    const calls = new Set();
    const re = /app\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g;
    let m = re.exec(view);
    while (m) { calls.add(m[1]); m = re.exec(view); }
    assert.ok(calls.size >= 50, '本件视图调用面应具规模（实测 ' + calls.size + ' 个），少于 50 说明判据没读到东西');
    const missing = [...calls].filter((k) => !new RegExp('^    ' + k + '\\(', 'm').test(app));
    assert.deepEqual(missing, [], '视图调了 App 上不存在的方法 = 静默断裂：' + missing.join(' / '));
});
test('C5 样式：`.pxv-` 前缀独占、不写 `<img>` 规则（一张图都不存）', () => {
    const css = read(PX_CSS);
    assert.ok(css.length > 2000, '样式文件必须真有内容');
    /* ★ 必须**剥注释**后再抓类名：文件头注释里写了 `pixiv-illust.js` / `pixiv.css`
     *   这类文件名，未剥注释就会把 `.js` / `.css` 当成类名（判据自己红）。 */
    const classes = stripComments(css).match(/\.[a-zA-Z][a-zA-Z0-9_-]*/g) || [];
    /* ★ `.is-*` 是本仓既有**状态类**写法（`is-on` / `is-idle` / `is-off` / `is-bad`），
     *   不是别家前缀 —— 首版只放行 `.pxv-`，把四个状态类判成外来的（判据自己红）。 */
    const alien = [...new Set(classes)].filter((c) => c.indexOf('.pxv-') !== 0 && c.indexOf('.is-') !== 0);
    assert.deepEqual(alien, [], '本文件只许出现 .pxv-* 前缀：' + alien.join(' / '));
    assert.equal(css.includes('<img'), false, '不存图就不该有 img 规则');
    assert.ok(css.includes('.pxv-root'), '必须有根选择器');
});
/* ══════════════════════ D — 通道面（四块不缝） ══════════════════════ */
test('D1 四块不缝：不碰模型 / 不落数据库 / 不碰宿主对象 / 不收外链与图', () => {
    const files = [PX_DATA, PX_APP, PX_VIEW];
    const stripped = files.map((rel) => stripComments(read(rel))).join('\n');
    const BAN = [
        ['fetch(', '网络调用'],
        ['XMLHttpRequest', '网络调用'],
        ['callChatAPI', '宿主生成通道'],
        ['imageApiConfig', '生图链路配置（源靠它挑链路）'],
        ['NovelAI', '生图链路名'],
        ['OpenRouter', '生图链路名'],
        ['IllustGallery', '源落 IndexedDB 的库名'],
        ['IndexedDB', '数据库'],
        ['AppState', '宿主全局对象'],
        ['saveData', '宿主整块回写通道'],
        ['Dexie', '数据库'],
        ['chat.history', '宿主消息数组'],
        ['twitterData', '跨 App 读（作者池）'],
        ['forumData', '跨 App 读（分享出口）'],
        ['broadcast', '跨 App 读（题材源）'],
        ['melonbooksData', '跨 App 读（出版面）'],
        ['localStorage', '绕过 PhoneStorage 落全局'],
        ['DOMParser', '宿主 DOM 解析器'],
    ];
    for (const [needle, why] of BAN) {
        assert.equal(stripped.includes(needle), false,
            '本件不许出现「' + needle + '」（' + why + '）—— 注释里说明它不算消费，代码里出现才算');
    }
});
test('D2 一张图都不存、一条外链都不收：插画登记只有「提示词 / 尺寸 / 张数 / 谁画的」', () => {
    const item = DAT.normalizeIllust({
        id: 'i1', prompt: '雪夜の電車', negativePrompt: 'bad', size: '1024x1024', count: 2,
        isFavorite: false, drawnBy: '雪村いつき',
        /* 恶意塞进来的地址类字段**不许被带出**（源正是存这些的）。 */
        url: 'https://example.com/a.png', imageUrl: 'x', dataUrl: 'data:image/png;base64,AAAA', provider: 'novelai',
    });
    const keys = Object.keys(item).sort().join(',');
    assert.equal(keys, 'count,createdAt,drawnBy,id,isFavorite,negativePrompt,prompt,size', '字段面必须恰好是登记面：' + keys);
    for (const k of ['url', 'imageUrl', 'dataUrl', 'provider']) {
        assert.equal(k in item, false, '不许带出地址 / 链路字段：' + k);
    }
    assert.equal(item.count, 2, '张数要点数');
    assert.equal(DAT.normalizeIllust({ count: 99 }).count, 9, '张数夹上界');
    assert.equal(DAT.normalizeIllust({ count: 'x' }).count, 0, '坏张数不塌成别的东西');
    /* 视图侧：不许出现 `img` 标签（用拼装规避字符面误伤）。 */
    const view = stripComments(read(PX_VIEW));
    assert.equal(view.includes('<' + 'img'), false, '视图不许渲染图片标签');
    assert.equal(view.includes('background-image'), false, '视图不许靠 CSS 拉图');
});
/* ══════════════════════ E — 活性面 ══════════════════════ */
test('E1 本版修掉的功能级失效必须有真调用点（导出≠可用）', () => {
    const app = stripComments(read(PX_APP));
    const view = stripComments(read(PX_VIEW));
    /* 评论回填这条通道：三个环节都必须有真消费点。 */
    assert.ok(app.includes('parseCommentsBlock('), 'App 必须真调解析器');
    assert.ok(app.includes('ingestCommentsText('), 'App 必须提供回填入口');
    assert.ok(view.includes('ingestCommentsText('), '视图必须真调回填入口（否则仍是死代码）');
    assert.ok(view.includes('pxv-cmt-ingest'), '视图必须有对应的按钮装配');
    /* 修复①的认源函数：三个消费点缺一不可。 */
    assert.ok(app.includes('_readRaw('), 'probe 必须走不吞异常的读法');
    assert.ok(app.includes('storageOk'), '认源结果必须参与 face 判定');
    /* 修复②的拆包：App 必须真调数据层并取 `.picked`。 */
    assert.ok(app.includes('pickDiverseAuthors('), 'App 必须真调选取面');
    /* ★ 不许用 `[^)]*`：调用里第一个 `)` 是 `authorsActive()` 的，正则当场断掉，
     *   真源码反而判成「没拆包」。改成「同一个调用点窗口里必须出现 `.picked`」。 */
    assert.ok(/pickDiverseAuthors\([\s\S]{0,160}?\)\.picked/.test(app), '必须显式拆包 `.picked`（否则视图拿到对象）');
    /* 修复④的三处：坏号即 null / 按下标配对 / 可数章。 */
    assert.ok(read(PX_DATA).includes('rawArr[pos]'), '原始章必须**按下标**取');
    assert.ok(read(PX_APP).includes('countableChapters'), '可数章必须作为独立读数');
});
test('E2 两处假面禁止语不许回来（按了没用的按钮 / 导出后漏导入）', () => {
    const view = stripComments(read(PX_VIEW));
    assert.equal(view.includes('pxv-cmt-again'), false,
        '「让宿主重读这一話」是假面：它绑的是废语句，按了只重绘 —— 本件已删，不许回来');
    assert.equal(view.includes('this._open = this._open'), false, '废语句不许回来');
    const app = stripComments(read(PX_APP));
    /* ★ 真缺陷：`PIXIV_COMMENT_DELIM` 在数据层导出了，App 层漏导入 ⇒ 走到分支即 ReferenceError；
     *   `node --check` 全绿也抓不到（JS 的漏导入不在加载期暴露）。这里按**消费点**钉住。 */
    if (app.includes('PIXIV_COMMENT_DELIM')) {
        assert.ok(/^\s*PIXIV_COMMENT_DELIM,\s*$/m.test(app),
            'App 一旦用这个常量，import 清单里就必须真有它（漏导入 = 走到分支才炸）');
    }
});
/* ══════════════════════ F — 视图契约面 ══════════════════════ */
test('F1 选取面：给视图的必须是**数组**，三个读数另开一条通道', () => {
    const { app } = fixtureNovel();
    const rec = app.recommendAuthors(3, '', 7);
    assert.ok(Array.isArray(rec), '视图 `for (const a of rec)` 迭代的对象必须是数组');
    assert.equal(rec.length, 3, '要 3 位给 3 位');
    const face = app.recommendFace(3, '', 7);
    assert.ok(Array.isArray(face.picked), '三读数里的 picked 也是数组');
    assert.equal(typeof face.considered, 'number', '参与数必须是个读数');
    assert.equal(typeof face.matched, 'number', 'tag 命中数必须是个读数');
    assert.equal(face.picked.length, rec.length, '两条通道必须给同一批（否则视图与判据看的是两份）');
    /* 视图侧不许调那条「给三读数」的通道（否则等于把手写的对象又迭代一遍）。 */
    const view = stripComments(read(PX_VIEW));
    assert.ok(view.includes('app.recommendAuthors('), '视图消费的是数组那条');
    assert.equal(view.includes('app.recommendFace('), false, '视图不许调三读数那条（它是判据/展示用的）');
    assert.equal(view.includes('for (const a of rec)') || view.includes('rec.length'), true, '视图确实按数组用');
});
test('F2 回填通道端到端：解析 → 登记 → 落盘，且空文本**被拒**而不是静默成功', () => {
    const { app, nid } = fixtureNovel();
    const delim = DAT.PIXIV_COMMENT_DELIM;
    const r = app.ingestCommentsText(nid, 1, delim + '\nAUTHOR: 路人\n面白かった\n' + delim + '\nAUTHOR: 空\n');
    assert.equal(r.ok, true, '有正文的块必须收下');
    assert.equal(r.added, 1, '收下 1 条');
    assert.equal(r.skipped, 1, '没正文的块如实回报（不许当成功吞掉）');
    assert.equal(app.commentCountOf(nid, 1).count, 1, '登记结果必须真进账');
    const bad = app.ingestCommentsText(nid, 1, '   ');
    assert.equal(bad.ok, false, '空文本必须被拒（静默成功是最坏的一种）');
    assert.ok(bad.error && bad.error.length > 0, '拒绝要给得出理由');
    const noChap = app.ingestCommentsText(nid, 99, delim + '\n内容\n');
    assert.equal(noChap.ok, false, '章不存在必须被拒');
});
/* ══════════════════════ G — 键归属面 ══════════════════════ */
test('G1 三条键登记 scope=chat，且被产品真实消费（键名与 App 常量必须一致）', () => {
    const keys = read(KEYS);
    for (const k of ['pixiv_settings', 'pixiv_content', 'pixiv_store']) {
        const m = keys.match(new RegExp("\\{\\s*key:\\s*'" + k + "',\\s*scope:\\s*'([a-z]+)'"));
        assert.ok(m, k + ' 必须在 keys-audit 里登记');
        assert.equal(m[1], 'chat', k + ' 的 scope 必须是 chat（这三条都是「这段关系的账」）');
    }
    /* 键名必须与 App 里的常量**同源**：App 写死另外三个名字也照样过上面那条判据。 */
    const app = stripComments(read(PX_APP));
    for (const k of ['pixiv_settings', 'pixiv_content', 'pixiv_store']) {
        assert.ok(app.includes("'" + k + "'"), 'App 必须真消费 ' + k);
    }
    /* 宽匹配族：一条前缀覆盖三键（storage.js 里必须真在）。 */
    assert.ok(/\/\^pixiv_\//.test(read(STORAGE)), '宽匹配族必须在场');
});
/* ══════════════════════ H — 单一真源面 ══════════════════════ */
test('H1 单一真源：人话表不手写键、分隔符只留一个真源', () => {
    const data = stripComments(read(PX_DATA));
    assert.ok(data.includes('PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES)'), '人话表的键必须由两份清单现取');
    /* 视图若也出现「分隔符字面量」，说明有两个真源（用户按 A 写、解析器按 B 切）。 */
    const view = stripComments(read(PX_VIEW));
    assert.ok(view.includes('PIXIV_COMMENT_DELIM'), '视图必须取常量');
    assert.equal(view.includes("'---COMMENT---'"), false, '视图不许再写一份分隔符字面量');
    /* 数据层自己只该声明一次（`export const ... = '...'`）。 */
    const lit = (data.match(/---COMMENT---/g) || []).length;
    assert.equal(lit, 1, '分隔符字面量在数据层只准出现 1 次（实测 ' + lit + '）');
});
/* ══════════════════════ H2 — 提示串真源 ══════════════════════ */
test('H2 生成要求文本：四模式都有，且都是**可复制文本**（本件不发请求）', () => {
    const { app, nid } = fixtureNovel();
    const n = app.novelById(nid);
    for (const mode of ['chapter', 'comment', 'illust', 'sns']) {
        const r = app.copyPrompt(mode, { novel: n, chapterNum: 3, prompt: '海', count: 1 });
        assert.equal(typeof r.ok, 'boolean', mode + ' 必须给 ok 读数');
        if (r.ok) {
            assert.ok(typeof r.text === 'string' && r.text.length > 10, mode + ' 要有可复制正文');
            assert.ok(r.text.length <= DAT.PIXIV_LIMITS.maxPromptChars + 2000, mode + ' 不许无限长');
        }
    }
    /* 日文模式的**纯度规则**必须真进文本（源 2026 补的硬规则，本件保留为常量）。 */
    const jp = app.copyPrompt('chapter', { novel: n, chapterNum: 3, language: 'jp-cn' });
    assert.ok(jp.ok && jp.text.includes(DAT.PIXIV_PURITY_RULE.slice(0, 24)),
        '日文模式的文本里必须含纯度规则（否则中文指令会被搬进日语正文）');
});
/* ══════════════════════ I — 负控制 ══════════════════════ */
/** 破坏表：锚点一律取**代码行**，一律字面 split/join（不用 String.replace，避免 `$&` 被解释）。 */
const DAMAGE = {
    /* ① 坏号又补回位置号（真缺陷④第一半回潮） */
    d1: [PX_DATA,
        '        num: numOrNull(c.num) === null ? null : Math.max(0, Math.trunc(numOrNull(c.num))),',
        '        num: numOrNull(c.num) === null ? (index + 1) : Math.max(1, Math.trunc(numOrNull(c.num))),'],
    /* ② 缓存心数退回「有章就以逐章为准」的旧形态（坏号章把读数拉成 0） */
    d2: [PX_DATA,
        '        hearts: chapters.some((c) => c.num !== null) ? maxCh',
        '        hearts: chapters.length ? maxCh'],
    /* ③ 人话表的键退回**手写**（桥契约门 J7 的形态） */
    d3: [PX_DATA,
        '    const types = PIXIV_ACTIVE_TYPES.concat(PIXIV_IDLE_TYPES);',
        "    const types = ['doujin_writer', 'official', 'marketing', 'x_fake'];"],
    /* ④ 失败态被读成「还没读」（三态塌成两态） */
    d4: [PX_DATA,
        '    const face = ch.commentsFailed ? F.failed\n' +
        '        : ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read',
        '    const face = ((!ch.commentsLoaded && !ch.commentsAttempted && !list.length) ? F.not_read'],
    /* ⑤ 楼中楼深度不再有上限 */
    d5: [PX_DATA,
        '        } else if (pid && byId.has(pid) && d <= lim) {',
        '        } else if (pid && byId.has(pid) && true) {'],
    /* ⑥ 原始章又按**号**取（坏号/补号即错配） */
    d6: [PX_DATA,
        '        const rawCh = rawArr[pos] || null;',
        '        const rawCh = rawArr[(c.num === null ? pos + 1 : c.num) - 1] || null;'],
    /* ⑦ App：认源又走吞异常的读法（坏 storage 被读成「空」） */
    a1: [PX_APP,
        '        const rc = this._readRaw(CONTENT_KEY);',
        '        const rc = { ok: true, raw: this._readJSON(CONTENT_KEY) };'],
    /* ⑧ App：选取面不再拆包（视图拿到对象 ⇒ 迭代即 TypeError） */
    a2: [PX_APP,
        '        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed).picked;',
        '        return pickDiverseAuthors(this.authorsActive(), count, preferTag, seed);'],
    /* ⑨ App：统计的章数不再区分可数（自相矛盾） */
    a3: [PX_APP,
        '            countableChapters: n.chapters.filter((c) => c.num !== null).length,',
        '            countableChapters: n.chapters.length,'],
    /* ⑩ 视图：假面按钮回来 */
    v1: [PX_VIEW,
        '        const rec = app.recommendAuthors(3, \'\', 7);',
        '        const rec = app.recommendFace(3, \'\', 7);'],
};
/** 数据层判据（加载破坏副本后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 坏号不许补号，且 0 是合法章号 */
    if (mod.normalizeChapter({ num: 'nope', content: 'x' }, 4).num !== null) bad.push('bad-num-filled');
    if (mod.normalizeChapter({ num: 0, content: 'x' }, 0).num !== 0) bad.push('zero-num-coerced');
    /* ② 坏号章不许被丢 */
    const nv = mod.normalizeNovel({ id: 'n', chapters: [{ num: 1, content: 'a' }, { num: 'bad', content: 'b' }] });
    if (nv.chapters.length !== 2) bad.push('bad-num-chapter-dropped');
    /* ③ 缓存心数不许被坏号章拉成 0 */
    const onlyBad = mod.normalizeNovel({ id: 'n', hearts: 500, chapters: [{ num: 'bad', content: 'a' }] });
    if (onlyBad.hearts === 0 && 500 > 0) bad.push('cache-hearts-zeroed-by-bad-num');
    /* ④ 原始章必须**按下标**配对：场景要让**章号 ≠ 下标**，否则按号取与按下标取等价、
     *   破坏行为不变（等于装饰断言）。这里第 0 章号是 5、下标是 0 —— 按号取会拿到
     *   `rawArr[4]`（不存在）⇒ 已给的心数被丢掉、改算派生值。 */
    const offset = mod.initNovelPopularity({
        id: 'n_offset',
        chapters: [{ num: 5, content: 'a'.repeat(30), hearts: 0 },
            { num: 'bad', content: 'b'.repeat(30), hearts: 77 }],
    });
    if (offset.chapters[0].hearts !== 0) bad.push('raw-chapter-by-number');
    if (offset.chapters[1].hearts !== 77) bad.push('raw-chapter-by-number');
    /* ④ 人话表键必须与两份清单一致 */
    const want = mod.PIXIV_ACTIVE_TYPES.concat(mod.PIXIV_IDLE_TYPES);
    const got = Object.keys(mod.PIXIV_TYPE_LABELS);
    if (got.length !== want.length || got.some((k, i) => k !== want[i])) bad.push('labels-keys-handwritten');
    /* ⑤ 三态不许塌：failed 与 not_read 必须不同 */
    const nrt = mod.commentCountFace({});
    const fl = mod.commentCountFace({ commentsAttempted: true, commentsFailed: true });
    /* ★ 判据是「**failed 必须报 failed**」而不是「两个名字不同形」：
     *   删掉 failed 分支后 fl 会退化成 `partial`，与 not_read 不同形 ⇒ 旧式反而放行。 */
    if (fl.face !== mod.PIXIV_COMMENT_FACES.failed) bad.push('failed-collides-with-not-read');
    if (nrt.face === fl.face) bad.push('failed-collides-with-not-read');
    if (mod.commentCountFace({ commentsLoaded: true, commentsList: [] }).count !== 0) bad.push('read-zero-count-not-zero');
    /* ⑥ 楼中楼深度必须被上限夹住 */
    const chain = new Array(8).fill(0).map((_x, i) => ({ id: 'c' + (i + 1), content: 'x', replyToCommentId: i ? 'c' + i : null }));
    const rows = mod.flattenComments(mod.buildCommentTree(chain, 3).roots[0] || {});
    if (rows.length && Math.max.apply(null, rows.map((r) => r.depth)) > 3) bad.push('comment-depth-unbounded');
    /* ⑦ 认源三态不许塌 */
    if (mod.readPixivFace({ novels: [], illustrations: [] }) !== mod.PIXIV_REASONS.empty) bad.push('face-empty-broken');
    if (mod.readPixivFace(null) !== mod.PIXIV_REASONS.storage_absent) bad.push('face-absent-broken');
    return bad;
};
/** App 侧的**结构面**判据（不加载副本 —— 编排层 import 视图/宿主，副本树里跑不起来）。 */
const appReadProblems = (src) => {
    const bad = [];
    /* ★ 判据必须落到**被破坏的那一处**（`probe()` 里的认源调用）。
     *   首版只查全文件含 `_readRaw(` —— 定义处与别处都在，破坏 probe 那一处照样为真，
     *   等于判据面没盖住破坏面（负控制纪律②）。 */
    const i = src.indexOf('    probe() {');
    const body = i < 0 ? '' : src.slice(i, i + 2400);
    if (!body.includes('this._readRaw(CONTENT_KEY)')) bad.push('read-raw-not-used');
    if (!/storageOk\s*=/.test(body)) bad.push('storage-ok-not-computed');
    return bad;
};
const appPickProblems = (src) => {
    const bad = [];
    /* ★ 同 E1：`[^)]*` 会卡在 `authorsActive()` 的括号上（真源码判成没拆包）。 */
    if (!/pickDiverseAuthors\([\s\S]{0,160}?\)\.picked/.test(src)) bad.push('pick-not-unwrapped');
    return bad;
};
const appCountProblems = (src) => {
    const bad = [];
    if (!src.includes('countableChapters')) bad.push('countable-chapters-missing');
    if (!/countableChapters:\s*n\.chapters\.filter\(/.test(src)) bad.push('countable-chapters-not-filtered');
    return bad;
};
const viewDeadProblems = (src) => {
    const bad = [];
    if (src.includes('pxv-cmt-again')) bad.push('fake-button-back');
    if (src.includes('this._open = this._open')) bad.push('void-statement-back');
    if (!src.includes('app.recommendAuthors(')) bad.push('array-channel-unused');
    if (src.includes('app.recommendFace(')) bad.push('readings-channel-leaked-into-view');
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3350_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    return { target, src: damaged };
}
async function loadDamagedCopy(rel, from, to) {
    const { target, src } = writeDamagedCopy(rel, from, to);
    return { mod: await import(pathToFileURL(target).href), src };
}
const NEG = [
    ['I1 破坏「坏号即 null」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['bad-num-filled']],
    ['I2 破坏「坏号章不许把缓存心数拉成 0」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['cache-hearts-zeroed-by-bad-num']],
    ['I3 破坏「人话表键取真源」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['labels-keys-handwritten']],
    ['I4 破坏「失败态与未读态分开」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['failed-collides-with-not-read']],
    ['I5 破坏「楼中楼深度上限」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['comment-depth-unbounded']],
    ['I6 破坏「原始章按下标配对」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['raw-chapter-by-number']],
    ['I7 破坏「认源走不吞异常的读法」⇒ 结构面判据必须转红', 'a1', 'app', appReadProblems, ['read-raw-not-used']],
    ['I8 破坏「选取面拆包给数组」⇒ 结构面判据必须转红', 'a2', 'app', appPickProblems, ['pick-not-unwrapped']],
    ['I9 破坏「可数章与总条数分开」⇒ 结构面判据必须转红', 'a3', 'app', appCountProblems, ['countable-chapters-not-filtered']],
    ['I10 破坏「视图消费数组那条通道」⇒ 视图判据必须转红', 'v1', 'view', viewDeadProblems, ['array-channel-unused']],
];
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        if (kind === 'data') {
            const { mod } = await loadDamagedCopy(rel, from, to);
            const bad = judge(mod);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            /* 对照：真模块必须干净（否则「转红」可能只是因为判据本来就红 —— 假绿三形之一）。 */
            assert.deepEqual(judge(DAT), [], '对照：真模块必须干净');
        } else {
            const { src } = writeDamagedCopy(rel, from, to);
            const bad = judge(src);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(read(rel)), [], '对照：真源码必须干净');
        }
    });
}
/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const q = chr96();
    assert.equal(stripComments('a /* 注释里的 NovelAI */ b').includes('NovelAI'), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 NovelAI\nb').includes('NovelAI'), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 NovelAI';").includes('NovelAI'), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 NovelAI' + q + ';').includes('NovelAI'), true, '模板串里的必须留住');
    assert.equal(stripComments('a = "带 \\" 转义的 NovelAI";').includes('NovelAI'), true, '转义串不许被误断');
    for (const rel of [PX_DATA, PX_APP, PX_VIEW]) {
        const sentinel = stripComments(read(rel) + '\n/* RP_TAIL_3350 */\n');
        assert.equal(sentinel.includes('RP_TAIL_3350'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3350k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [PX_DATA, PX_APP, PX_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J4 冒烟硬断言门禁在场（把「打印读数」升成「必须全绿」）', () => {
    /* ★ 本版教训：冒烟脚本自己 exit 非零但没人把它当门禁 —— 漏导入那条真缺陷
     *   （`PIXIV_COMMENT_DELIM`）就是这样漏进来的。故本版落一层硬断言外壳。 */
    const shell = read('tools/smoke_assert3350.mjs');
    assert.ok(shell.includes('SMOKE-3350 ALL GREEN'), '外壳必须逐字比对冒烟末行');
    assert.ok(shell.includes('crossCount'), '外壳必须禁止 ✗');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/smoke_assert3350.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 0, '硬断言外壳必须真跑得过：' + (r.stdout || '').slice(-400));
    assert.ok((r.stdout || '').includes('SMOKE-ASSERT-3350 ALL GREEN'), '外壳末行必须是 ALL GREEN');
});
/* ══════════════════════ L — 版本锚 ══════════════════════ */
test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 35),
        '本套件成立于 RubyPhone 3.35.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.35.0 Pixiv），不是「当版」——
     *   本仓已有四处「守别人的版」的口径错（v3270 / v3280 / v3290 / v3300）。 */
    const SELF = '3.35.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['Pixiv', '楼中楼', '心数', '文风', '坏号']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
    /* 本版按批次纪律**不跑全链**：条目里必须如实登记这一点（不许写一份不存在的全链读数）。 */
    assert.ok(joined.includes('单套件') || joined.includes('不跑全链'),
        '本版条目必须如实登记批次纪律（只跑单套件）');
});
/* ══ 追加段锚：V3350_SECTION_1 ══ */
