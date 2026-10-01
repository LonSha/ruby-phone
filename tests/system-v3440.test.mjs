// tests/system-v3440.test.mjs — 同人商店 · 柜台 [v3.44.0]
//
// 本套件守四件事：
//  ① 价格引擎与行核的口径（价格三态不把「没数字」读成 0 / 商品行逐行拒收 /
//     热度三分量不塌成一个数 / 盲盒与普通周边不同形 / 重定价逐条报旧价新价幅度 /
//     上限余量不编 0 / 合计不可信不许照样结）；
//  ② 四块不缝真的没缝（零钱包 / 零网络 / 零出图零数据库 / 零宿主界面读）；
//  ③ 六处接线落点齐备（少一处就静默错数据 / 点了没反应）；
//  ④ 负控制能观测（每一条破坏都必须让对应判据转红，且真源码必须干净）。
//
// 判据纪律（本仓硬纪律，v3.31 / v3.35 ~ v3.43 各踩过一次）：
//  · 剥注释器是**字符状态机、不解析正则字面量** —— 被审代码里不许出现裸引号；
//  · 负控制的破坏必须**可观测**（破坏产品从不走到的分支 = 装饰性破坏）；
//  · 同族缺陷要**一次抓一族**（判据面的守卫按族布，不只盖已发生的那一处）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as DAT from '../apps/doujin/doujin-data.js';
import * as APP from '../apps/doujin/doujin-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DJ_DATA = 'apps/doujin/doujin-data.js';
const DJ_APP = 'apps/doujin/doujin-app.js';
const DJ_VIEW = 'apps/doujin/doujin-view.js';
const DJ_CSS = 'apps/doujin/doujin.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const PHONE_CSS = 'phone.css';
const NL = String.fromCharCode(10);
/** 单引号（破坏表里拼锚点用）：一律拼装形，不写裸引号。 */
const Q = String.fromCharCode(39);
/** 反斜杠（剥注释器里判转义用）：同样拼装形，免得文件里出现裸反斜杠。 */
const BS = String.fromCharCode(92);
const AMP = String.fromCharCode(38);
/** 双引号（造文本用）：拼装形。 */
const DQ = String.fromCharCode(34);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 剥注释（字符状态机，与 v3300…v3430 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头逐条写明了
 *    「源里有什么、本件为什么不能有」——那些词是**说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**：被审代码里一旦出现**裸的引号或反引号**，剥器会把
 *    正则正文当成字符串的起头。故本件的被审代码一律字串比对、不写正则字面量，
 *    并在 J 组用**尾随哨兵**逐文件实测「剥器能复位」。 */
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
            if (c === Q || c === DQ || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === NL) { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        /* 字符串态：本件被审代码不许有裸引号，故只需处理转义与收尾。 */
        if (c === BS) { out += c + (d || ''); i += 2; continue; }
        if (c === state) { state = 'code'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
    }
    return out;
}

/** 内存存储（单会话）。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); },
        _box: box,
    };
}

/** 换会话的存储（真件里由 `config/storage.js` 的 `/^doujin_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致 —— 抄别版的前缀会把「换会话后读到别人数据」这条判据测成空气。 */
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

/** 取不出来的存储（一取就抛）—— 守「取不出来不许读成空的」那一族。 */
function hostileStorage() {
    return { get: () => { throw new Error('boom'); }, set: () => {} };
}

/** 假宿主壳：只提供视图层要的 getContentContainer（不建 DOM 就不进 render）。 */
function shellStub() {
    return { getContentContainer: () => null, showNotification: () => {} };
}
const newApp = (storage) => new APP.DoujinApp(shellStub(), storage);

/** 一段商品 JSON（用数组 + join 拼，源码里不出现裸引号）。
 *  ★ 键值必须用**双引号**（DQ）：这里是真 JSON，要过 JSON.parse。
 *    Q 是**单引号**（破坏表的锚点里要用），拿它拼 JSON 会让 JSON.parse
 *    必然失败 —— 表现是「所有行都被判成 bad_json」，而用例断言写的是
 *    「两行合法」，于是整族 B 组一起红，且**看起来像产品缺陷**。 */
function shopJson() {
    return '[' + [
        '{' + DQ + 'title' + DQ + ': ' + DQ + '夏の終わり' + DQ + ', ' + DQ + 'type' + DQ + ': ' + DQ + 'novel' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '¥800' + DQ + '}',
        '{' + DQ + 'title' + DQ + ': ' + DQ + '海辺の記憶' + DQ + ', ' + DQ + 'type' + DQ + ': ' + DQ + 'manga' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '1,200' + DQ + '}',
        '{' + DQ + 'title' + DQ + ': ' + DQ + '面議の品' + DQ + ', ' + DQ + 'type' + DQ + ': ' + DQ + 'goods' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '面议' + DQ + '}',
        '{' + DQ + 'type' + DQ + ': ' + DQ + 'novel' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '500' + DQ + '}'
    ].join(', ') + ']';
}
/** 一段二手在售 JSON（含黄牛 / 赝品 / 盲盒单款）。 */
function listingJson() {
    return '[' + [
        '{' + DQ + 'title' + DQ + ': ' + DQ + '限定アクリル' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '¥3,200' + DQ + ', '
            + DQ + 'rarity' + DQ + ': ' + DQ + '限定' + DQ + ', ' + DQ + 'seller' + DQ + ': ' + DQ + 'scalper' + DQ + '}',
        '{' + DQ + 'title' + DQ + ': ' + DQ + '通常ブロマイド' + DQ + ', ' + DQ + 'price' + DQ + ': ' + DQ + '¥600' + DQ + ', '
            + DQ + 'rarity' + DQ + ': ' + DQ + '通常' + DQ + ', ' + DQ + 'seller' + DQ + ': ' + DQ + 'normal' + DQ + '}'
    ].join(', ') + ']';
}

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 价格解析三态：一个数字都没有不许读成 0（源把「¥500」与「面议」同得 0）', () => {
    const ok = DAT.priceOf('¥1,200');
    assert.equal(ok.ok, true);
    assert.equal(ok.value, 1200);
    const none = DAT.priceOf('面议');
    assert.equal(none.ok, false, '没数字必须不 ok');
    assert.equal(none.why, DAT.DJ_PRICE_WHYS[1]);
    assert.equal(none.value, null, '没数字不许给 0');
    const dash = DAT.priceOf('---');
    assert.equal(dash.value, null);
    const empty = DAT.priceOf('');
    assert.equal(empty.ok, false);
    assert.equal(empty.value, null);
    /* 超上限单列：不许与「没数字」同形。 */
    const over = DAT.priceOf(String(DAT.DJ_PRICE_MAX + 1));
    assert.equal(over.why, DAT.DJ_PRICE_WHYS[2], '超限必须是第三个因，不许并进 no_digits');
    assert.equal(over.value, null);
});

test('A2 价格三态是三个不同的键（塔平就是同形）', () => {
    const s = new Set(DAT.DJ_PRICE_WHYS);
    assert.equal(s.size, DAT.DJ_PRICE_WHYS.length, '三个因必须互不相同');
    assert.ok(DAT.DJ_PRICE_WHYS.indexOf('ok') >= 0);
});

test('A3 roundPrice 三档（源的四条规则之一：万以上按千、千以上按百、其余按十）', () => {
    assert.equal(DAT.roundPrice(12345), 12000);
    assert.equal(DAT.roundPrice(1234), 1200);
    assert.equal(DAT.roundPrice(123), 120);
    /* 取不出来一律 0 起点（源也这样），但**不给 null**。 */
    assert.equal(DAT.roundPrice(null), 0);
});

test('A4 rarityMult 认英文键也认源的中文键（旧台账里的中文键要读得回来）', () => {
    assert.equal(DAT.rarityMult('normal'), 1.0);
    assert.equal(DAT.rarityMult('限定'), 2.5, '源的中文键必须认得');
    assert.equal(DAT.rarityMult('特典'), 4.0);
    assert.equal(DAT.rarityMult('不认识的'), 1.0, '查不到就是 1.0（与源同）');
});

test('A5 角色热度三分量不塌成一个数（源只返回一个数，「为什么被炒到 4 倍」不可对）', () => {
    const h = DAT.characterHeat({ goodsOwn: 2, plotHits: [{ index: 0 }, { index: 3 }], plotCount: 6, infoHits: 1 });
    assert.equal(h.goodsOwn, 2);
    assert.equal(h.infoHits, 1);
    assert.ok(h.plotScore > 0, '剧情分量必须算出来');
    assert.ok(h.raw > 0);
    assert.ok(h.heat >= 0.7 && h.heat <= 4.0, '热度必须夹在 [0.7, 4.0]');
    assert.ok(typeof h.band === 'string' && h.band.length > 0, '热度档必须在场');
    /* 夹住了要留痕。 */
    const hi = DAT.characterHeat({ goodsOwn: 100, plotHits: [], plotCount: 0, infoHits: 100 });
    assert.equal(hi.heat, 4.0);
    assert.equal(hi.clamped, 'high', '被夹住必须留痕');
});

test('A6 盲盒与普通周边不同形（源两路都只返回一个数）', () => {
    const blind = DAT.avgPriceFor({
        price: 1000, rarity: '通常', blindBox: true, variantChar: '小春',
        variantHeat: { goodsOwn: 3, plotHits: [], plotCount: 0, infoHits: 0 }
    });
    assert.equal(blind.byVariant, true, '盲盒走单款那一路口径必须标出来');
    const normal = DAT.avgPriceFor({
        price: 1000, rarity: '通常', blindBox: false,
        charHeats: [{ goodsOwn: 1, plotHits: [], plotCount: 0, infoHits: 0 }]
    });
    assert.equal(normal.byVariant, false, '普通周边走系列最高热度那一路口径');
    assert.ok(blind.avg > 0 && normal.avg > 0);
});

test('A7 出品个体价：同一 roll 必得同一个价（源用 Math.random，判定不可判）', () => {
    const a = DAT.listingPrice(1000, 'scalper', 0.5);
    const b = DAT.listingPrice(1000, 'scalper', 0.5);
    assert.deepEqual(a, b, 'roll 提到参数位后必须可复现');
    const c = DAT.listingPrice(1000, 'scalper', 0.9);
    assert.ok(c.price > a.price, 'roll 大必须更贵');
    /* 三类卖家三种系数（源逐条照抄）。 */
    const fake = DAT.listingPrice(1000, 'counterfeit', 0.5);
    assert.ok(fake.price < a.price, '赝品必须比黄牛便宜');
    const urgent = DAT.listingPrice(1000, 'normal', 0.05);
    assert.equal(urgent.urgent, true, '急售 15% 那一支必须标出来');
    assert.ok(urgent.price < DAT.listingPrice(1000, 'normal', 0.5).price);
});

test('A8 售罄比例四步：没绑剧情节点与绑了不同形（源不留痕）', () => {
    const anchored = DAT.soldRatioOf({ afterIndex: 0, plotCount: 6, heatNorm: 0.5 });
    assert.equal(anchored.hasAnchor, true);
    assert.ok(anchored.ratio > 0);
    const noAnchor = DAT.soldRatioOf({ afterIndex: null, plotCount: 6, heatNorm: 0.5 });
    assert.equal(noAnchor.hasAnchor, false, '没绑节点必须标出来');
    assert.equal(noAnchor.ratio, 0);
    /* 上限 0.6（源逐条照抄）。 */
    const big = DAT.soldRatioOf({ afterIndex: 0, plotCount: 100, heatNorm: 1 });
    assert.ok(big.ratio <= 0.6);
});

test('A9 出品规划：基数 / 加成 / 概率逐条对齐，且概率另给「约每几件出一件」', () => {
    const p = DAT.variantPlan({ goods: { title: '限定アクリル', rarity: '限定', blindBox: false }, heat: 2.0, baseRoll: 0.5 });
    assert.equal(p.rarityBonus, 2, '限定加成 2（源逐条照抄）');
    assert.ok(p.count >= 1);
    assert.ok(p.scalperP > 0 && p.fakeP > 0);
    assert.ok(p.scalperEvery > 0, '1/p 读数必须在场');
    const bonus = DAT.variantPlan({ goods: { title: '特典', rarity: '特典', blindBox: false }, heat: 2.0, baseRoll: 0.5 });
    assert.equal(bonus.rarityBonus, 3, '特典加成 3');
    /* まとめ売り：盲盒 + 有单款 + 冷门（热度 ≤ 1.0）。 */
    const bundle = DAT.variantPlan({
        goods: { title: '盲盒', rarity: '通常', blindBox: true }, variantChar: '小春', heat: 1.0, baseRoll: 0.5
    });
    assert.equal(bundle.bundleChance, 0.5, '打包甩卖条件必须逐条对齐');
    const noBundle = DAT.variantPlan({
        goods: { title: '盲盒', rarity: '通常', blindBox: true }, variantChar: '小春', heat: 3.0, baseRoll: 0.5
    });
    assert.equal(noBundle.bundleChance, 0, '热门不打包');
});

test('A10 重定价读数：旧价 / 新价 / 幅度逐条报（源静默改价）', () => {
    const r = DAT.repriceOf(1000, 1200, 0.08);
    assert.equal(r.changed, true);
    assert.equal(r.delta, 200);
    assert.ok(Math.abs(r.ratio - 0.2) < 1e-9);
    const small = DAT.repriceOf(1000, 1050, 0.08);
    assert.equal(small.changed, false);
    assert.equal(small.why, 'below_threshold', '不到阈值必须说清是「不到阈值」而不是没动');
    const bad = DAT.repriceOf(null, 1200, 0.08);
    assert.equal(bad.changed, false);
    assert.equal(bad.why, 'unreadable', '旧价读不出来必须与「不到阈值」不同形');
});

test('A11 商品行逐行拒收（源是一条静默跳过，整个商品被丢掉）', () => {
    const c = DAT.classifyProducts([
        { title: '好的', price: '¥800' },
        { title: '', price: '¥800' },
        { title: '没价', price: '面议' },
        { title: '超长'.repeat(40), price: '¥800' }
    ]);
    assert.equal(c.rows.length, 1);
    assert.equal(c.rejected.length, 3);
    for (let i = 0; i < c.rejected.length; i++) {
        assert.ok(typeof c.rejected[i].index === 'number', '拒收行必须报是第几行');
        assert.ok(c.rejected[i].why, '拒收行必须报原因');
    }
    assert.equal(c.rejected[0].why, DAT.DJ_ROW_WHYS[1], '没标题');
    assert.equal(c.rejected[1].why, DAT.DJ_ROW_WHYS[2], '价格读不出来');
    assert.equal(c.rejected[2].why, DAT.DJ_ROW_WHYS[3], '超上限');
});

test('A12 行 id 按行号稳定派生（行号与 id 两套标号不许各说各话）', () => {
    const c = DAT.classifyProducts([{ title: '甲', price: '100' }, { title: '乙', price: '200' }]);
    assert.equal(c.rows[0].id, 'row0');
    assert.equal(c.rows[1].id, 'row1');
    const withId = DAT.classifyProducts([{ id: 'ext1', title: '甲', price: '100' }]);
    assert.equal(withId.rows[0].id, 'ext1', '有外部 id 时优先用外部 id');
});

test('A13 合计逐行回报：读不出来的行不许静默算进合计（源当 0 加进去）', () => {
    const c = DAT.cartTotal([
        { title: '甲', priceText: '¥800', qty: 2 },
        { title: '乙', priceText: '面议', qty: 1 }
    ]);
    assert.equal(c.ok, false, '有读不出的行时合计必须不可信');
    assert.equal(c.total, 1600, '只算得出来的那一行');
    assert.equal(c.bad.length, 1);
    assert.equal(c.bad[0].index, 1, '必须报是第几行');
    assert.equal(c.bad[0].why, DAT.DJ_PRICE_WHYS[1]);
    const good = DAT.cartTotal([{ title: '甲', priceText: '¥800', qty: 2 }]);
    assert.equal(good.ok, true);
    assert.equal(good.total, 1600);
});

test('A14 台账裁边要计数（源静默 shift）', () => {
    const t = DAT.ledgerTrim([1, 2, 3, 4, 5], 3);
    assert.equal(t.keep.length, 3);
    assert.equal(t.dropped, 2, '挤掉几条必须报');
    assert.deepEqual(t.keep, [3, 4, 5], '挤掉的是旧的');
    const none = DAT.ledgerTrim([1], 3);
    assert.equal(none.dropped, 0);
});

test('A15 上限余量：取不出来是 null，**不是 0**（空与坏不同形）', () => {
    const g = DAT.gaugesOf({ shelf: 0, ledger: null, cart: 3, titles: 5 });
    const byKey = {};
    for (let i = 0; i < g.length; i++) byKey[g[i].key] = g[i];
    assert.equal(byKey.shelf.value, 0, '真的 0 就是 0');
    assert.equal(byKey.ledger.value, null, '取不出来必须是 null');
    assert.equal(byKey.cart.value, 3);
    assert.equal(DAT.gaugeText(byKey.shelf), '0 / ' + String(byKey.shelf.max));
    assert.equal(DAT.gaugeText(byKey.ledger), '--', '取不出来画横线，不画 0');
    assert.equal(byKey.titles.over, false);
    const over = DAT.gaugesOf({ shelf: DAT.DJ_SHELF_MAX + 1, ledger: 0, cart: 0, titles: 0 });
    assert.equal(over[0].over, true, '超限必须标出来');
});

test('A16 在售四读数（源界面没有这一格，全靠翻列表数）', () => {
    const s = DAT.listingStats([
        { status: 'on_sale', sellerType: 'scalper', flaggedFake: true, bundleQty: 4 },
        /* ★ 售出词必须取真源表里的那一个：写别的词进去，统计会把它算作「在售」，
         *   而判据自己也就测不出「两套词各说各话」这一族。 */
        { status: 'sold_out', sellerType: 'normal' }
    ]);
    assert.equal(s.onSale, 1);
    assert.equal(s.sold, 1);
    assert.equal(s.fake, 1);
    assert.equal(s.scalper, 1);
    assert.equal(s.bundle, 1);
    assert.equal(s.total, 2);
    /* 真源词表唯一口径：改一个字就该塌。 */
    assert.equal(DAT.isSold('sold'), false, '统计侧不许另立一套词');
    assert.equal(DAT.isSold('sold_out'), true);
});

test('A17 真源表在场且取值互不相同（塔平就是同形）', () => {
    const keys = (arr) => arr.map((x) => x.key);
    for (const [name, arr] of [['商品型', DAT.DJ_PRODUCT_TYPES], ['即卖会型', DAT.DJ_EVENT_TYPES],
        ['档期', DAT.DJ_EVENT_PHASES], ['状态', DAT.DJ_STATUSES], ['品相', DAT.DJ_CONDITIONS],
        ['稀有度', DAT.DJ_RARITIES], ['卖家', DAT.DJ_SELLER_TYPES]]) {
        const ks = keys(arr);
        assert.equal(new Set(ks).size, ks.length, name + ' 的键必须互不相同');
    }
    /* 状态五色的颜色必须互不相同（同色就看不出差别）。 */
    const colors = DAT.DJ_STATUSES.map((s) => s.color);
    assert.equal(new Set(colors).size, colors.length, '五态五色不许同色');
    /* 品相以源日文原文当存储键 —— 不许被改成中文（改了旧台账读不回来）。 */
    assert.equal(DAT.DJ_CONDITIONS[0].key, '新品、未使用', '品相键必须逐字沿用源（存储契约）');
    /* 稀有度倍率逐条照抄。 */
    assert.deepEqual(DAT.DJ_RARITIES.map((r) => r.mult), [1.0, 2.5, 4.0]);
});

test('A18 源事实表：商品五型与「可新生成四型」分开（周边是旧数据）', () => {
    assert.equal(DAT.DJ_PRODUCT_TYPES.length, 5);
    assert.equal(DAT.DJ_GENERATABLE_TYPES.length, 4);
    assert.equal(DAT.DJ_GENERATABLE_TYPES.indexOf('goods'), -1, '周边不进新生成（源写明留给市场那一面）');
    assert.deepEqual(DAT.DJ_LEGACY_TYPES, ['goods']);
    assert.deepEqual(DAT.DJ_SOURCE_FILES, ['melonbooks.js', 'mercari.js']);
    assert.ok(DAT.DJ_SOURCE_NOTE.indexOf('メロンブックス') >= 0);
});

test('A19 市场流动费率逐条照抄（让「为什么被炒到 4 倍」可对）', () => {
    const r = DAT.DJ_MARKET_RATES;
    assert.equal(r.newListing, 0.55);
    assert.equal(r.sold, 0.12);
    assert.equal(r.reprice, 0.3);
    assert.equal(r.repriceThreshold, 0.08);
    assert.equal(DAT.DJ_PRICE_RULES.length, 4, '四条定价系数逐条在场');
});

test('A20 金额写法自己拼（不依赖宿主 toLocaleString）', () => {
    assert.equal(DAT.moneyText(1200), '1,200');
    assert.equal(DAT.moneyText(1234567), '1,234,567');
    assert.equal(DAT.moneyText(null), '--', '取不出来画横线');
    assert.equal(DAT.moneyText(0), '0', '真的 0 就画 0');
});

test('A21 字串取数：不是字符串就当空，但「没给」与 0 不同形', () => {
    assert.equal(DAT.cleanText(123), '');
    assert.equal(DAT.cleanText('x'), 'x');
    assert.equal(DAT.numOrNull(''), null);
    assert.equal(DAT.numOrNull(' 12 '), 12);
    assert.equal(DAT.numOrNull('abc'), null);
    assert.equal(DAT.numOrNull(0), 0, '真的 0 就是 0');
    assert.equal(DAT.numOrNull(NaN), null);
});

/* ══════════════════════ B — App 行为面 ══════════════════════ */
test('B1 取数分两种回报：storage 取不出来不许读成「一件都没收进来」', () => {
    const app = newApp(hostileStorage());
    const p = app.probe();
    assert.equal(p.face, 'absent', '取不出来必须是 absent 面');
    assert.equal(app.faceOf(), 'absent');
    const fresh = newApp(memStorage());
    const p2 = fresh.probe();
    assert.equal(p2.face, 'empty', '没写过是 empty 面');
    assert.notEqual(p.face, p2.face, '取不出来与还没写过不许同形');
});

test('B2 「写了但认不出来」单列：坏内容不许与「还没建过店头」同形', () => {
    const st = memStorage({ doujin_shop: '{坏掉的 JSON' });
    const app = newApp(st);
    const p = app.probe();
    assert.equal(p.face, 'malformed', '写了但读不懂必须是 malformed 面');
    const empty = newApp(memStorage({ doujin_shop: '' }));
    assert.equal(empty.probe().face, 'empty');
});

test('B3 收下商品：成功逐项报，失败分因且**不动现有商品**', () => {
    const app = newApp(memStorage());
    const r = app.ingestShopText(shopJson());
    assert.equal(r.ok, true);
    assert.equal(r.added, 2, '四行里两行合法');
    assert.equal(r.rejected.length, 2, '两行被逐条拒收');
    /* ★ landing 是「行都收进来了」（坏行也落账，好让用户查得到为什么没收），
     *   added 是「其中合法的件数」。两件事分开报，不许混成一个数。 */
    assert.equal(r.landed, 4, '四行都落账（坏行留在拒收面）');
    assert.equal(r.total, 4);
    assert.equal(app.productRows().length, 2, '台面上只有合法的两件');
    assert.equal(app.rejectedRows().length, 2, '拒收面也落着两行');
    /* 坏输入不许把现有商品清掉。 */
    const bad = app.ingestShopText('这段文字里没有括号');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, 'no_bracket');
    assert.equal(app.productRows().length, 2, '失败不许动现有商品');
    /* 三种失败因互不相同。 */
    assert.equal(app.ingestShopText('').why, 'empty');
    assert.equal(app.ingestShopText('[不合法').why, 'bad_json');
});

test('B4 拒收行要落到取数口上（视图才能逐行画）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const rej = app.rejectedRows();
    assert.equal(rej.length, 2);
    for (let i = 0; i < rej.length; i++) {
        assert.ok(typeof rej[i].index === 'number');
        assert.ok(app.rowWhyTextOf(rej[i].why), '每一条都要能翻成人话');
    }
    /* 拒收因翻成中文话，不是键。 */
    assert.notEqual(app.rowWhyTextOf(DAT.DJ_ROW_WHYS[1]), DAT.DJ_ROW_WHYS[1]);
});

test('B5 价格三态要落到商品行与收银台行上', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const rows = app.productRows();
    assert.equal(rows.length, 2);
    for (let i = 0; i < rows.length; i++) assert.ok(rows[i].priceText.indexOf('--') < 0, '合法行不许画横线');
    /* 收银台：入车后价格逐行核。 */
    const add = app.addToCart(rows[0].id);
    assert.equal(add.ok, true);
    const cr = app.cartRows();
    assert.equal(cr.length, 1);
    assert.equal(cr[0].bad, false);
    assert.ok(cr[0].priceText.indexOf('¥') >= 0);
});

test('B6 收银台合计不可信要标出来，且**不许照样结**', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const rows = app.productRows();
    app.addToCart(rows[0].id);
    /* 手动塞一行读不出价的（模拟旧台账里的坏行）。 */
    app._cart.push({ productId: 'row99', qty: 1 });
    app._recompute();
    const info = app.cartInfo();
    assert.equal(info.ok, false, '合计必须不可信');
    assert.ok(app.cartBadRows().length >= 1, '读不出的行要落到取数口');
    const s = app.settle();
    assert.equal(s.ok, false);
    assert.equal(s.why, 'bad_rows', '合计不可信不许照样结');
    assert.ok(app.orderRows().length === 0, '没结成就不许留下订单');
});

test('B7 结账成功：只动本件的车与历史（**不碰钱包**）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const rows = app.productRows();
    app.addToCart(rows[0].id);
    app.setQty(rows[0].id, 3);
    const s = app.settle();
    assert.equal(s.ok, true);
    assert.equal(s.n, 1);
    assert.equal(s.total, 2400, '800 × 3');
    assert.equal(app.cartInfo().rows, 0, '结完车空');
    assert.equal(app.orderRows().length, 1);
    const empty = app.settle();
    assert.equal(empty.why, 'empty', '空车结账要报原因');
});

test('B8 收下二手在售：带稀有度 / 品相 / 卖家类型，逐条核', () => {
    const app = newApp(memStorage());
    const r = app.ingestListingText(listingJson());
    assert.equal(r.ok, true);
    assert.equal(r.added, 2);
    const rows = app.listingRows();
    assert.equal(rows.length, 2);
    /* 稀有度按源的中文键读回来。 */
    const eng = app.engineRows();
    assert.ok(eng.length >= 4, '价格引擎三档要在场');
    const labels = eng.map((e) => e.label);
    assert.ok(labels.indexOf('定価') >= 0);
    assert.ok(labels.indexOf('相场（均价）') >= 0);
    assert.ok(labels.indexOf('这一件') >= 0);
});

test('B9 价格引擎要摊开稀有度倍率与热度口径（源只画两档）', () => {
    const app = newApp(memStorage());
    app.ingestListingText(listingJson());
    const eng = app.engineRows();
    const labels = eng.map((e) => e.label);
    assert.ok(labels.indexOf('稀有度倍率') >= 0, '倍率必须摊开');
    assert.ok(labels.indexOf('角色热度') >= 0);
    assert.ok(labels.indexOf('计算口径') >= 0, '盲盒 / 系列两路口径必须标出来');
});

test('B10 改价：旧价 / 新价 / 幅度逐条报，坏值拒而不夹', () => {
    const app = newApp(memStorage());
    app.ingestListingText(listingJson());
    const rows = app.listingRows();
    const id = rows[0].id;
    const r = app.setPrice(id, '¥9,999');
    assert.equal(r.ok, true);
    assert.equal(r.to, 9999);
    assert.equal(typeof r.from, 'number');
    assert.equal(r.changed, true, '幅度明显必须报 changed');
    const reps = app.repriceRows();
    assert.ok(reps.length >= 1, '重定价要逐条列出来');
    assert.ok(typeof reps[0].from === 'number' && typeof reps[0].to === 'number');
    assert.ok(reps[0].ratio > 0);
    /* 坏值拒而不夹。 */
    const bad = app.setPrice(id, '面议');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, DAT.DJ_PRICE_WHYS[1]);
    const nf = app.setPrice('不存在', '¥100');
    assert.equal(nf.why, 'not_found');
});

test('B11 重定价读数每轮重算（不许越列越长）', () => {
    const app = newApp(memStorage());
    app.ingestListingText(listingJson());
    const id = app.listingRows()[0].id;
    app.setPrice(id, '¥9,999');
    const n1 = app.repriceRows().length;
    /* 再改回原价：幅度同样明显，但**总数不该翻倍**。 */
    app.setPrice(id, '¥3,200');
    const n2 = app.repriceRows().length;
    assert.equal(n2, n1, '每轮重算 —— 上一轮的读数必须被清掉，不许累积');
});

test('B12 改属性：坏值拒而不夹，且如实报 saw', () => {
    const app = newApp(memStorage());
    app.ingestListingText(listingJson());
    const id = app.listingRows()[0].id;
    const ok = app.setField(id, 'rarity', '特典');
    assert.equal(ok.ok, true);
    const bad = app.setField(id, 'rarity', '不认识的稀有度');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, 'unknown');
    assert.ok(bad.saw.length > 0, '拒了要报看到了什么');
    const noField = app.setField(id, 'nosuch', 'x');
    assert.equal(noField.why, 'no_field', '没这个字段与「值不认识」不同形');
    const st = app.setField(id, 'status', 'sold_out');
    assert.equal(st.ok, true);
    assert.equal(app.listingRows()[0].sold, true);
});

test('B13 收藏 / 删除在售：越界一律拒', () => {
    const app = newApp(memStorage());
    app.ingestListingText(listingJson());
    const id = app.listingRows()[0].id;
    const f = app.toggleFav(id);
    assert.equal(f.ok, true);
    assert.equal(f.fav, true);
    assert.equal(app.listingRows()[0].fav, true);
    const f2 = app.toggleFav(id);
    assert.equal(f2.fav, false);
    const rm = app.removeListing(id);
    assert.equal(rm.removed, 1);
    assert.equal(app.listingRows().length, 1);
    const rm2 = app.removeListing(id);
    assert.equal(rm2.removed, 0, '删不存在的要如实报 0');
});

test('B14 入车：已在车里 / 超上限 / 没 id 三态互不相同', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const id = app.productRows()[0].id;
    assert.equal(app.addToCart(id).ok, true);
    const again = app.addToCart(id);
    assert.equal(again.ok, false);
    assert.equal(again.why, 'already');
    const noId = app.addToCart('');
    assert.equal(noId.why, 'no_id');
    /* 顶到上限：不许静默不收。 */
    for (let i = 0; i < DAT.DJ_CART_MAX + 2; i++) app._cart.push({ productId: 'x' + String(i), qty: 1 });
    app._recompute();
    const over = app.addToCart('新的一件');
    assert.equal(over.why, 'over_limit');
    assert.equal(over.max, DAT.DJ_CART_MAX, '超限要报上限');
    assert.equal(typeof over.rows, 'number', '超限要报当前行数');
});

test('B15 数量：坏值拒而不夹（源用 parseInt 后 || 0）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const id = app.productRows()[0].id;
    app.addToCart(id);
    const bad = app.setQty(id, '0');
    assert.equal(bad.ok, false);
    assert.equal(bad.why, 'out_of_range');
    assert.equal(bad.min, 1);
    assert.equal(bad.max, DAT.DJ_QTY_MAX);
    const bad2 = app.setQty(id, '面议');
    assert.equal(bad2.ok, false, '非数字不许读成 0 后收下');
    const ok = app.setQty(id, '5');
    assert.equal(ok.ok, true);
    assert.equal(app.cartInfo().total, 4000);
});

test('B16 清车只清车（店头与在售不许被顺手清掉）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    app.ingestListingText(listingJson());
    app.addToCart(app.productRows()[0].id);
    const r = app.clearCart();
    assert.equal(r.cleared, 1);
    assert.equal(app.cartInfo().rows, 0);
    assert.equal(app.productRows().length, 2, '商品不许被顺手清');
    assert.equal(app.listingRows().length, 2, '在售不许被顺手清');
});

test('B17 台账：动作逐笔留痕，挤掉要计数', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const led = app.ledgerRows();
    assert.ok(led.length >= 1, '动作要留痕');
    assert.equal(led[0].kind, 'ingest_shop');
    assert.equal(led[0].ok, true);
    /* 顶到上限：dropped 要计数。 */
    for (let i = 0; i < DAT.DJ_LEDGER_MAX + 3; i++) app._receipt('tick', true, '', { n: i });
    const info = app.ledgerInfo();
    assert.ok(info.dropped >= 3, '挤掉几条必须报（源静默 shift）');
    assert.equal(info.kept, DAT.DJ_LEDGER_MAX);
});

test('B18 清店头与车：动作记录**留着**（源把四类挤在一处，会一起清）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    app.ingestListingText(listingJson());
    app.addToCart(app.productRows()[0].id);
    const ledBefore = app.ledgerRows().length;
    const r = app.clearShop();
    assert.equal(r.ok, true);
    assert.equal(app.productRows().length, 0);
    assert.equal(app.listingRows().length, 0);
    assert.equal(app.cartInfo().rows, 0);
    assert.equal(app.ledgerRows().length, ledBefore + 1, '动作记录必须留着（只多出「清店头」这一笔）');
    assert.equal(app.faceOf(), 'empty', '清完是「空的」不是「读不懂」');
});

test('B19 要求文本：唯一的「往外写」的出口（本件只产文本）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    app.ingestListingText(listingJson());
    const t = app.requestText();
    assert.ok(t.length > 0);
    assert.ok(t.indexOf('同人商店') >= 0);
    assert.ok(t.indexOf('二手市场') >= 0);
    assert.ok(t.indexOf('四项上限') >= 0);
    /* 草稿优先。 */
    app.setDraft('我自己写的台面');
    assert.equal(app.requestText(), '我自己写的台面');
    app.clearDraft();
    assert.ok(app.requestText().indexOf('同人商店') >= 0, '清了草稿回落到现算文本');
});

test('B20 存档：存进台账 / 越界拒删 / 空文本拒存', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    const s = app.saveToShelf();
    assert.equal(s.ok, true);
    assert.equal(s.kept, 1);
    assert.equal(app.shelfRows().length, 1);
    const bad = app.removeFromShelf(9);
    assert.equal(bad.ok, false);
    assert.equal(bad.why, 'out_of_range');
    const rm = app.removeFromShelf(0);
    assert.equal(rm.ok, true);
    assert.equal(app.shelfRows().length, 0);
});

test('B21 存档要真的落盘（同一键整份覆盖，分开落会丢）', () => {
    const st = memStorage();
    const a = newApp(st);
    a.ingestShopText(shopJson());
    a.saveToShelf();
    /* 新实例从同一份存储读：存档必须在。 */
    const b = newApp(st);
    b.probe();
    assert.equal(b.shelfRows().length, 1, '存档必须真的写进了存储');
    assert.equal(b.productRows().length, 2, '商品也必须在（同一条键）');
});

test('B22 页签与焦点：越界一律拒，换会话收回', () => {
    const app = newApp(memStorage());
    assert.equal(app.tab(), 'shop');
    assert.equal(app.setTab('market'), 'market');
    assert.equal(app.setTab('不存在的页签'), 'shop', '越界一律回落到第一页');
    app.setFocus('x');
    assert.equal(app.focusOf(), 'x');
    app.setTab('cart');
    const r = app.onChatChanged();
    assert.equal(r.ok, true);
    assert.equal(app.tab(), 'shop', '换会话收回第一页');
    assert.equal(app.focusOf(), '', '换会话收回焦点');
});

test('B23 取数口全部在位（视图调了 App 上没有的口 = 一打开就 undefined）', () => {
    const app = newApp(memStorage());
    for (const m of ['faceOf', 'faceTextOf', 'toneOf', 'shopNameOf', 'sourceNoteOf', 'sourceFilesOf',
        'summaryLine', 'shopMetrics', 'productRows', 'rejectedRows', 'eventRows', 'listingRows',
        'repriceRows', 'marketStats', 'cartRows', 'cartBadRows', 'cartInfo', 'orderRows',
        'gaugeRows', 'gaugeInfo', 'overRows', 'ledgerRows', 'ledgerInfo', 'engineRows',
        'focusOf', 'ruleRows', 'ratesRows', 'catalogs', 'priceWhyTextOf', 'rowWhyTextOf',
        'draftOf', 'shelfRows', 'tab', 'requestText', 'composeText']) {
        assert.equal(typeof app[m], 'function', '取数口缺 ' + m);
    }
    for (const m of ['ingestShopText', 'ingestListingText', 'setPrice', 'setField', 'toggleFav',
        'removeListing', 'addToCart', 'setQty', 'removeFromCart', 'clearCart', 'settle',
        'clearLedger', 'clearShop', 'setDraft', 'clearDraft', 'saveToShelf', 'removeFromShelf',
        'setTab', 'setFocus', 'probe', 'render', 'onChatChanged']) {
        assert.equal(typeof app[m], 'function', '动作口缺 ' + m);
    }
});

test('B24 视图取数口的返回形状要能画（不是空对象）', () => {
    const app = newApp(memStorage());
    app.ingestShopText(shopJson());
    app.ingestListingText(listingJson());
    const g = app.gaugeRows();
    assert.equal(g.length, 4);
    for (let i = 0; i < g.length; i++) {
        assert.ok(g[i].label);
        assert.equal(typeof g[i].blank, 'boolean', 'blank 必须是布尔（视图按它决定着不着色）');
        assert.equal(typeof g[i].pct, 'number');
    }
    const c = app.catalogs();
    assert.ok(c.types.length === 5);
    assert.ok(c.rarities.length === 3);
    assert.ok(c.generatable.length === 4);
});

test('B25 无 storage 也不许崩：四格一起报「取不出来」', () => {
    const app = newApp(null);
    const p = app.probe();
    assert.equal(p.face, 'absent');
    assert.equal(app.productRows().length, 0);
    assert.equal(app.listingRows().length, 0);
    assert.equal(app.cartInfo().rows, 0);
    /* 动作口也不许崩。 */
    assert.equal(app.ingestShopText(shopJson()).ok, true, '没存储也能收进内存');
    assert.equal(app.ingestShopText(shopJson()).saved, false, '但要如实报「没存下去」');
});

/* ══════════════════════ C — 接线面 ══════════════════════ */
test('C1 四条会话键随会话隔离（换角色后不许读到别人的账）', () => {
    const st = sessionStorage();
    const a = newApp(st);
    a.ingestShopText(shopJson());
    a.ingestListingText(listingJson());
    a.addToCart(a.productRows()[0].id);
    a.saveToShelf();
    assert.equal(a.productRows().length, 2);
    st.switchTo('c2');
    const b = newApp(st);
    b.probe();
    assert.equal(b.productRows().length, 0, '换会话不许读到别人的商品');
    assert.equal(b.listingRows().length, 0, '换会话不许读到别人的在售');
    assert.equal(b.cartInfo().rows, 0, '换会话不许读到别人的车');
    assert.equal(b.shelfRows().length, 0, '换会话不许读到别人的存档');
    assert.equal(b.ledgerRows().length, 0, '换会话不许读到别人的动作记录');
    st.switchTo('c1');
    const c = newApp(st);
    c.probe();
    assert.equal(c.productRows().length, 2, '换回来还在');
});

test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    const apps = read(APPS);
    assert.ok(apps.indexOf('id: ' + Q + 'doujin' + Q) >= 0, 'App 登记缺');
    assert.ok(apps.indexOf('同人商店') >= 0);
    const storage = read(STORAGE);
    assert.ok(storage.indexOf('^doujin_') >= 0, 'CHAT_DATA_PATTERNS 缺宽前缀');
    const keys = read(KEYS);
    for (const k of ['doujin_shop', 'doujin_market', 'doujin_cart', 'doujin_ledger']) {
        assert.ok(keys.indexOf(k) >= 0, 'keys-audit 缺登记：' + k);
    }
    const idx = read(INDEX);
    assert.ok(idx.indexOf('appId === ' + Q + 'doujin' + Q) >= 0, 'index.js 接线分支缺');
    assert.ok(idx.indexOf('apps/doujin/doujin-app.js') >= 0, '动态 import 路径缺');
    assert.ok(idx.indexOf('DoujinApp') >= 0, '实例化缺');
    assert.ok(idx.indexOf('doujinApp') >= 0, '表单字段登记表缺');
    const pkg = JSON.parse(read('package.json'));
    assert.ok(pkg.scripts.check.indexOf('registry') >= 0);
});

test('C3 样式段头独立成行（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read(PHONE_CSS);
    const mark = '[v3.44.0] 同人商店';
    const idx = css.indexOf(mark);
    assert.ok(idx > 0);
    const lineStart = css.lastIndexOf(NL, idx) + 1;
    const lineEnd = css.indexOf(NL, idx);
    const line = css.slice(lineStart, lineEnd);
    assert.ok(line.startsWith('/*'), '段头行必须以块注释起头，实测：' + line.slice(0, 40));
    assert.ok(line.trimEnd().endsWith('*/'), '段头行必须以块注释收尾，实测：' + line.slice(-40));
    assert.ok(lineStart === 0 || css[lineStart - 1] === NL, '段头不许接在上一段尾后');
    assert.equal(line.split('/*').length, 2, '段头行只许有一个块注释起头');
    /* 段序：本版段必须排在**上一版**段之前（最新版在最前）。
     * ★ 写成绝对形（「heads[0] 必须是本版」）等于给下一版埋一条必红的断言。 */
    assert.ok(css.indexOf(mark) < css.indexOf('[v3.43.0] PV 案头'),
        '本版段必须在 v3.43.0 段之前（最新版在最前）');
});

test('C4 源文件与 phone.css 段必须逐字同源（手工改两处必会再犯）', () => {
    const phone = read(PHONE_CSS);
    const src = read(DJ_CSS).trim();
    assert.ok(phone.indexOf(src) > 0, 'phone.css 里的本版段必须与源文件逐字同源');
});

test('C5 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = read(DJ_VIEW);
    const css = read(DJ_CSS);
    const produced = new Set();
    for (const m of view.matchAll(/djn-[a-z0-9-]+/g)) produced.add(m[0]);
    const styled = new Set();
    for (const m of css.matchAll(/\.(djn-[a-z0-9-]+)/g)) styled.add(m[1]);
    const missing = [];
    for (const c of produced) if (!styled.has(c)) missing.push(c);
    assert.ok(produced.size >= 20, '视图至少要产出二十个类（实测 ' + produced.size + '）');
    assert.ok(missing.length <= 2, '视图产出的类必须有样式落点，缺：' + missing.join('/'));
    /* 样式必须全部挂在 .djn-root 下（宿主样式不外泄）。 */
    const bare = [];
    for (const line of css.split(NL)) {
        const s = line.trim();
        if (!s.startsWith('.djn') && !s.startsWith('@') && !s.startsWith('}') && !s.startsWith('/*')
            && !s.startsWith('*') && s.indexOf('{') >= 0) bare.push(s.slice(0, 60));
    }
    assert.deepEqual(bare, [], '样式选择器必须全部挂 .djn-root 之下');
});

test('C6 视图不自己算内核（那是数据层与 App 的事）', () => {
    const code = stripComments(read(DJ_VIEW));
    const imp = code.slice(code.indexOf('import'), code.indexOf('} from'));
    for (const fn of ['roundPrice', 'characterHeat', 'avgPriceFor', 'listingPrice', 'classifyProducts', 'cartTotal']) {
        assert.equal(imp.indexOf(fn) >= 0, false, '视图不许导入内核函数：' + fn);
    }
});

/* ══════════════════════ D — 四块不缝 ══════════════════════ */
test('D1 零钱包：四件里一个钱包 / 交易流水调用都没有（源直扣余额并写 LinePay）', () => {
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW, DJ_CSS]) {
        const src = stripComments(read(rel));
        for (const w of ['LinePay', 'linepay', 'wallet', 'balance', 'balanceOf', 'spend(', 'deduct']) {
            assert.equal(src.indexOf(w) >= 0, false, rel + ' 不许出现钱包相关：' + w);
        }
    }
});

test('D2 零网络：四件里没有任何网络调用（源直连 AI 会话生成新刊与行情）', () => {
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW]) {
        const src = stripComments(read(rel));
        for (const w of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'axios', 'navigator.sendBeacon']) {
            assert.equal(src.indexOf(w) >= 0, false, rel + ' 不许出现网络调用：' + w);
        }
    }
});

test('D3 零出图零数据库零外链：没有任何 URL / data URL / 图片扩展名 / 索引库', () => {
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW]) {
        const src = stripComments(read(rel));
        assert.equal(src.indexOf('http://') >= 0, false, rel + ' 不许出现外链');
        assert.equal(src.indexOf('https://') >= 0, false, rel + ' 不许出现外链');
        assert.equal(src.indexOf('data:image') >= 0, false, rel + ' 不许出现 data URL');
        assert.equal(src.indexOf('indexedDB') >= 0, false, rel + ' 不许出现索引库');
        assert.equal(src.indexOf('localStorage') >= 0, false, rel + ' 不许出现浏览器存储');
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
            assert.equal(src.indexOf(ext) >= 0, false, rel + ' 不许出现图片扩展名：' + ext);
        }
    }
});

test('D4 零宿主界面读：不许 document.getElementById 直读宿主元素（源满篇直读）', () => {
    for (const rel of [DJ_DATA, DJ_APP]) {
        const src = stripComments(read(rel));
        assert.equal(src.indexOf('document.getElementById') >= 0, false, rel + ' 不许直读宿主元素');
        assert.equal(src.indexOf('document.querySelector') >= 0, false, rel + ' 不许直查宿主 DOM');
    }
    const view = stripComments(read(DJ_VIEW));
    assert.equal(view.indexOf('document.getElementById') >= 0, false, '视图也不许直读宿主元素');
    assert.equal(view.indexOf('document.body') >= 0, false, '视图不许碰宿主 body');
});

test('D5 storage 出口必须收敛：只许 get / set 两个口（不许第三口）', () => {
    const src = stripComments(read(DJ_APP));
    for (const w of ['storage.remove', 'storage.clear', 'storage.delete', 'storage.keys', 'storage.getAll']) {
        assert.equal(src.indexOf(w) >= 0, false, 'storage 出口只许 get / set，实测出现：' + w);
    }
});

/* ══════════════════════ E — 消费面 ══════════════════════ */
test('E1 数据层的每一条真源表与内核函数都必须被产品侧真消费（不许建好了零消费）', () => {
    const app = stripComments(read(DJ_APP));
    const view = stripComments(read(DJ_VIEW));
    const both = app + NL + view;
    const tables = ['DJ_PRODUCT_TYPES', 'DJ_GENERATABLE_TYPES', 'DJ_LEGACY_TYPES', 'DJ_EVENT_TYPES',
        'DJ_EVENT_PHASES', 'DJ_STATUSES', 'DJ_CONDITIONS', 'DJ_RARITIES', 'DJ_SELLER_TYPES',
        'DJ_PRICE_RULES', 'DJ_PRICE_WHYS', 'DJ_ROW_WHYS', 'DJ_MARKET_RATES',
        'DJ_TITLE_MAX', 'DJ_SHELF_MAX', 'DJ_SHELF_STORE_MAX', 'DJ_SHELF_TEXT_MAX',
        'DJ_LEDGER_MAX', 'DJ_CART_MAX', 'DJ_QTY_MAX', 'DJ_LISTING_MAX', 'DJ_GAUGE_KEYS',
        'DJ_SOURCE_NOTE', 'DJ_SOURCE_FILES'];
    for (const t of tables) assert.ok(both.indexOf(t) >= 0, '真源表零消费：' + t);
    const fns = ['cleanText', 'charCount', 'numOrNull', 'priceOf', 'moneyText', 'roundPrice',
        'rarityMult', 'characterHeat', 'avgPriceFor', 'listingPrice', 'soldRatioOf', 'variantPlan',
        'repriceOf', 'classifyProducts', 'cartTotal', 'ledgerTrim', 'listingStats', 'gaugesOf', 'gaugeText'];
    for (const f of fns) assert.ok(both.indexOf(f) >= 0, '内核函数零消费：' + f);
});

test('E2 空与坏不同形：读数取不出来画横线（不是零）', () => {
    const view = stripComments(read(DJ_VIEW));
    /* 视图必须把「取不出来」画成横线：查横线常量在场，且被用在读数上。 */
    assert.ok(view.indexOf('DASH') >= 0, '横线常量必须在场');
    assert.ok(view.indexOf('blank') >= 0, '余量条必须认 blank（取不出来不着色）');
    const app = stripComments(read(DJ_APP));
    assert.ok(app.indexOf('DASH_UNIT') >= 0, 'App 侧也要有横线常量');
    assert.ok(app.indexOf('meterText') >= 0, '读数取值必须过 meterText（取不出来画横线）');
});

test('E3 转义走拼装形：与号与引号不许以字面量出现（落盘链会把实体解码）', () => {
    const view = stripComments(read(DJ_VIEW));
    assert.ok(view.indexOf('String.fromCharCode(38)') >= 0, '与号必须拼装');
    assert.ok(view.indexOf('String.fromCharCode(60)') >= 0, '左尖括号必须拼装');
    assert.ok(view.indexOf('String.fromCharCode(34)') >= 0, '双引号必须拼装');
    assert.ok(view.indexOf('String.fromCharCode(39)') >= 0, '单引号必须拼装');
    /* 不许出现实体字面量（落盘链会把它解码成真字符，转义函数静默失效）。 */
    const raw = read(DJ_VIEW);
    assert.equal(raw.indexOf(AMP + 'amp;') >= 0, false, '不许出现实体字面量 amp;');
    assert.equal(raw.indexOf(AMP + 'lt;') >= 0, false, '不许出现实体字面量 lt;');
});

test('E4 失败面必须可见：坏值 / 拒绝 / 没跑都要有话说（不许静默）', () => {
    const view = stripComments(read(DJ_VIEW));
    assert.ok(view.indexOf('djn-flash') >= 0, '一句回执必须在场');
    assert.ok(view.indexOf('djn-bad-row') >= 0, '拒收行必须在场');
    assert.ok(view.indexOf('djn-over') >= 0, '超限块必须在场');
    assert.ok(view.indexOf('不可信') >= 0, '合计不可信必须标出来');
});

test('E5 视图里的每个 data-act 都要有处理分支（点了没反应 = 静默失效）', () => {
    const view = read(DJ_VIEW);
    const acts = new Set();
    for (const m of view.matchAll(/data-act="([a-z_]+)"/g)) acts.add(m[1]);
    assert.ok(acts.size >= 12, '动作按钮至少要十二个（实测 ' + acts.size + '）');
    const code = stripComments(view);
    for (const a of acts) {
        assert.ok(code.indexOf(Q + a + Q) >= 0, '动作没有处理分支：' + a);
    }
});

/* ══════════════════════ F — 负控制面 ══════════════════════ */
/** 数据层判据（在真模块或破坏副本上跑）。 */
function dataProblems(M) {
    const bad = [];
    /* ① 没数字读成 0。 */
    if (M.priceOf('面议').value !== null) bad.push('no-digits-read-as-zero');
    if (M.priceOf('面议').ok !== false) bad.push('no-digits-accepted');
    /* ② 超限与没数字塔平。 */
    if (M.priceOf(String(M.DJ_PRICE_MAX + 1)).why === M.DJ_PRICE_WHYS[1]) bad.push('over-limit-collapsed');
    /* ③ 行静默跳过。 */
    const c = M.classifyProducts([{ title: '', price: '100' }, { title: 'x', price: '面议' }]);
    if (c.rejected.length !== 2) bad.push('row-silently-skipped');
    if (c.rows.length !== 0) bad.push('bad-row-accepted');
    /* ④ 热度三分量塌平。★ 必须**逐分量单独验**：只断言「三个字段还在」
     *   抓不住「算的时候只用了其中一个」—— 破坏把 raw 收成单分量时，
     *   plotScore / goodsOwn / infoHits 三个字段照样都在，判据会假绿。 */
    const h = M.characterHeat({ goodsOwn: 2, plotHits: [{ index: 0 }], plotCount: 6, infoHits: 1 });
    if (!(h.plotScore > 0) || h.goodsOwn !== 2 || h.infoHits !== 1) bad.push('heat-components-collapsed');
    if (h.heat > 4.0 || h.heat < 0.7) bad.push('heat-not-clamped');
    const hZero = M.characterHeat({ goodsOwn: 0, plotHits: [], plotCount: 6, infoHits: 0 });
    const hPlot = M.characterHeat({ goodsOwn: 0, plotHits: [{ index: 0 }, { index: 3 }], plotCount: 6, infoHits: 0 });
    const hInfo = M.characterHeat({ goodsOwn: 0, plotHits: [], plotCount: 6, infoHits: 3 });
    if (!(hPlot.heat > hZero.heat)) bad.push('heat-components-collapsed');
    if (!(hInfo.heat > hZero.heat)) bad.push('heat-components-collapsed');
    /* ⑤ 盲盒与普通同形。 */
    const blind = M.avgPriceFor({ price: 1000, blindBox: true, variantChar: 'a', variantHeat: {} });
    if (blind.byVariant !== true) bad.push('blind-and-normal-collapsed');
    /* ⑥ 重定价不报。 */
    const rp = M.repriceOf(1000, 1200, 0.08);
    if (rp.changed !== true || rp.delta !== 200) bad.push('reprice-unreported');
    /* ⑦ 合计把读不出的当 0。 */
    const ct = M.cartTotal([{ title: 'a', priceText: '面议', qty: 1 }]);
    if (ct.ok !== false || ct.bad.length !== 1) bad.push('cart-bad-row-swallowed');
    /* ⑧ 台账挤掉不计数。 */
    if (M.ledgerTrim([1, 2, 3], 2).dropped !== 1) bad.push('ledger-drop-unreported');
    /* ⑨ 余量取不出来编 0。 */
    if (M.gaugesOf({ ledger: null })[1].value !== null) bad.push('gauge-faked-zero');
    /* ⑩ 行 id 不按行号。 */
    if (M.classifyProducts([{ title: 'a', price: '1' }]).rows[0].id !== 'row0') bad.push('row-id-not-by-index');
    return bad;
}

/** App 面：取数三态。 */
function appFaceProblems(M) {
    const bad = [];
    const a = new M.DoujinApp(shellStub(), hostileStorage());
    if (a.probe().face !== 'absent') bad.push('storage-absent-lost');
    const b = new M.DoujinApp(shellStub(), memStorage({ doujin_shop: '{坏' }));
    if (b.probe().face !== 'malformed') bad.push('malformed-face-lost');
    const c = new M.DoujinApp(shellStub(), memStorage());
    if (c.probe().face !== 'empty') bad.push('empty-face-lost');
    return bad;
}

/** App 面：内容与动作。 */
function appContentProblems(M) {
    const bad = [];
    const a = new M.DoujinApp(shellStub(), memStorage());
    const r = a.ingestShopText(shopJson());
    if (r.added !== 2) bad.push('ingest-count-wrong');
    if (r.rejected.length !== 2) bad.push('ingest-rejects-unreported');
    /* 拒收行要能落到取数口上（视图靠它逐行画红边）。 */
    if (a.rejectedRows().length !== 2) bad.push('ingest-rejects-unreported');
    /* ★ 「失败不许动现有商品」看的是**用户当下看到的那一份**（内存投影）：
     *   失败的粘贴不许把台面上的两件抹掉。跨实例验会漏 —— 存储里那两件
     *   还在，破坏清掉内存后一 `probe()` 又被读回来，观测不到。 */
    a.ingestShopText('没有括号');
    if (a.productRows().length !== 2) bad.push('failed-ingest-wiped-shop');
    if (a.summaryLine().indexOf('商品 2 件') < 0) bad.push('failed-ingest-wiped-shop');
    /* 合计不可信不许照样结。 */
    const b = new M.DoujinApp(shellStub(), memStorage());
    b.ingestShopText(shopJson());
    b._cart.push({ productId: 'row0', qty: 1 }, { productId: 'row99', qty: 1 });
    b._recompute();
    if (b.cartInfo().ok !== false) bad.push('cart-total-trusted-with-bad-rows');
    if (b.settle().ok !== false) bad.push('settle-through-bad-rows');
    if (b.orderRows().length !== 0) bad.push('settle-through-bad-rows');
    /* 车里的合法行必须真的算得出来（否则「不可信」是假红，判据抓不住真因）。 */
    const c = new M.DoujinApp(shellStub(), memStorage());
    c.ingestShopText(shopJson());
    c.addToCart(c.productRows()[0].id);
    if (c.cartInfo().ok !== true) bad.push('cart-total-false-bad');
    if (c.cartInfo().total !== 800) bad.push('cart-total-false-bad');
    return bad;
}

/** App 面：门与上限。 */
function appGateProblems(M) {
    const bad = [];
    const a = new M.DoujinApp(shellStub(), memStorage());
    a.ingestShopText(shopJson());
    const id = a.productRows()[0].id;
    a.addToCart(id);
    if (a.setQty(id, '0').ok !== false) bad.push('qty-gate-lost');
    if (a.setQty(id, '面议').ok !== false) bad.push('qty-gate-lost');
    /* 台账挤掉计数。★ 上限常量取**数据层**那一个：
     *   它在 APP 模块上并没有导出，写 M.DJ_LEDGER_MAX 会静默变成 undefined，
     *   循环一次都不跑 —— 判据于是永远报红（假红），把「真模块必须干净」也一起带塌。 */
    const b = new M.DoujinApp(shellStub(), memStorage());
    for (let i = 0; i < DAT.DJ_LEDGER_MAX + 3; i++) b._receipt('t', true, '', {});
    if (b.ledgerInfo().dropped < 3) bad.push('ledger-drop-unreported');
    /* 存档越界拒删。 */
    const c = new M.DoujinApp(shellStub(), memStorage());
    if (c.removeFromShelf(0).ok !== false) bad.push('shelf-range-gate-lost');
    /* 清车不许顺手清店头。 */
    const d = new M.DoujinApp(shellStub(), memStorage());
    d.ingestShopText(shopJson());
    d.addToCart(d.productRows()[0].id);
    d.clearCart();
    if (d.productRows().length !== 2) bad.push('clear-cart-wiped-shop');
    return bad;
}

/** App 面：换会话与落盘。 */
function appChatProblems(M) {
    const bad = [];
    const st = sessionStorage();
    const a = new M.DoujinApp(shellStub(), st);
    a.ingestShopText(shopJson());
    a.ingestListingText(listingJson());
    a.addToCart(a.productRows()[0].id);
    a.saveToShelf();
    if (a.productRows().length !== 2) bad.push('chat-same-session-lost');
    /* ★ 真口径：**换出去再换回来，账要还在**。
     *   只看「换到新会话后是空的」观测不到「换会话没重取」——
     *   新会话本来就是空的，两件事同形。 */
    st.switchTo('c2');
    a.onChatChanged();
    if (a.productRows().length !== 0) bad.push('chat-change-no-shop-reload');
    if (a.listingRows().length !== 0) bad.push('chat-change-no-market-reload');
    if (a.cartInfo().rows !== 0) bad.push('chat-change-no-cart-reload');
    if (a.shelfRows().length !== 0) bad.push('chat-change-no-shelf-reload');
    if (a.ledgerRows().length !== 0) bad.push('chat-change-no-ledger-reload');
    st.switchTo('c1');
    a.onChatChanged();
    if (a.productRows().length !== 2) bad.push('chat-change-no-shop-reload');
    if (a.listingRows().length !== 2) bad.push('chat-change-no-market-reload');
    if (a.cartInfo().rows !== 1) bad.push('chat-change-no-cart-reload');
    if (a.shelfRows().length !== 1) bad.push('chat-change-no-shelf-reload');
    if (a.ledgerRows().length < 2) bad.push('chat-change-no-ledger-reload');
    /* 另一个实例也要看得到（换会话是「取数」不是「搬家」）。 */
    const b = new M.DoujinApp(shellStub(), st);
    b.probe();
    if (b.productRows().length !== 2) bad.push('chat-change-no-shop-reload');
    /* 存档要真落盘。 */
    const mem = memStorage();
    const c = new M.DoujinApp(shellStub(), mem);
    c.ingestShopText(shopJson());
    c.saveToShelf();
    const d = new M.DoujinApp(shellStub(), mem);
    d.probe();
    if (d.shelfRows().length !== 1) bad.push('shelf-not-persisted');
    if (d.productRows().length !== 2) bad.push('shelf-not-persisted');
    return bad;
}

/** 视图面：面色相。
 * ★ 判据必须咬住「四项面色**逐一取真源**」这件事本身：
 *   原版只数了键面字符种类，破坏把 malformed 的色换成 FACE_TONE 的自家引用时，
 *   四个键字面量照样都在（`face-tone-not-by-source` 观测不到）。
 *   收成两条硬口径：① 四态四色互不相同；② 每一项**直接写出自己的色值**。 */
function viewFaceProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('FACE_TONE') < 0) bad.push('face-tone-not-by-source');
    /* 四态四色：在源码里逐项抓 'ok' / 'warn' / 'err' / 'off' 各自的落点。 */
    const tones = new Set();
    for (const m of code.matchAll(/(ok|warn|err|off)/g)) tones.add(m[1]);
    if (tones.size < 4) bad.push('face-tone-not-by-source');
    /* ★ 每一项必须**自成字面**（写的是自己那个色，不是引用别人的槽位）：
     *   把 malformed 改成引用数组第 n 项时，这一条会塌。 */
    for (const pair of ['ok: ' + Q + 'ok' + Q, 'empty: ' + Q + 'warn' + Q,
        'malformed: ' + Q + 'err' + Q, 'absent: ' + Q + 'off' + Q]) {
        if (code.indexOf(pair) < 0) bad.push('face-tone-not-by-source');
    }
    return bad;
}

/** 视图面：抬升祖先与动作序。 */
function viewClimbProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('data-act') < 0) bad.push('card-climb-lost');
    if (code.indexOf('getAttribute') < 0) bad.push('card-climb-lost');
    return bad;
}

/** 视图面：空与坏不同形。
 * ★ 原版只查两个关键词在场（DASH / blank）—— 破坏把「画横线」改成「画 0」时，
 *   两者照样在场，判据观测不到。收成两条硬口径：
 *   ① 取不出来必须**返回横线**（不是 String(0)）；② 余量条取不出来时**不留填充块**。 */
function viewCountProblems(src) {
    const code = stripComments(src);
    const bad = [];
    if (code.indexOf('DASH') < 0) bad.push('empty-and-bad-collapsed');
    if (code.indexOf('blank') < 0) bad.push('empty-and-bad-collapsed');
    /* ① 「取不出来画横线」这一句必须真的是**三元回横线**，不是回显 0。 */
    if (code.indexOf('=== null) ? DASH :') < 0 && code.indexOf('=== null ? DASH :') < 0) {
        bad.push('empty-and-bad-collapsed');
    }
    if (code.indexOf('String(v === null || v === undefined ? 0 : v)') >= 0) {
        bad.push('empty-and-bad-collapsed');
    }
    /* ② 取不出来的那一格必须**带上空标记**（视图按它决定要不要画数）。 */
    if (code.indexOf('(r.blank ? ' + Q + ' blank' + Q + ' : ' + Q + Q + ')') < 0) {
        bad.push('empty-and-bad-collapsed');
    }
    /* ③ 余量条取不出来时不许着色：画填充块必须挂在 !blank 上。 */
    if (code.indexOf('if (!r.blank) {') < 0) bad.push('empty-and-bad-collapsed');
    return bad;
}

/** 数据层结构面：失败因必须是**纯键**。
 * ★ 不能只查「源码里出现过 ok / no_digits / over_limit 这几个字面量」——
 *   本仓别处也有 'ok' 这种字面量，破坏把表里的值换成中文话后照样命中，判据观测不到。
 *   收成两条：① 表**取值即键**（按位置逐项对上）；② 源码里那三个键必须**落在表里**。 */
function dataKeyProblems(src) {
    const bad = [];
    const code = stripComments(src);
    for (const k of ['ok', 'no_digits', 'over_limit']) {
        if (code.indexOf(Q + k + Q) < 0) bad.push('why-not-key');
    }
    const codes = [
        'export const DJ_PRICE_WHYS = Object.freeze([' + Q + 'ok' + Q + ', ' + Q + 'no_digits' + Q
            + ', ' + Q + 'over_limit' + Q + ']);'
    ];
    for (const c of codes) if (code.indexOf(c) < 0) bad.push('why-not-key');
    return bad;
}

/** 破坏表：键 → [相对路径, 原串, 替换串]。
 *  ★ 锚点必须落在**真会被走到的**那一行（破坏产品从不走到的分支 = 装饰性破坏）。 */
const DAMAGE = {
    /* ① 没数字读成 0（源的三步里最后那一步）。 */
    q1: [DJ_DATA,
        "    if (!digits) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits: '' };",
        "    if (!digits) return { ok: true, why: DJ_PRICE_WHYS[0], value: 0, digits: '' };"],
    /* ② 超限并进「没数字」。 */
    q2: [DJ_DATA,
        '    if (n > DJ_PRICE_MAX) return { ok: false, why: DJ_PRICE_WHYS[2], value: null, digits };',
        '    if (n > DJ_PRICE_MAX) return { ok: false, why: DJ_PRICE_WHYS[1], value: null, digits };'],
    /* ③ 行静默跳过（源就是直接 return）。 */
    q3: [DJ_DATA,
        "            rejected.push({ index: i, title: title || '(无题)', why: why.join('+') });",
        '            continue;'],
    /* ④ 热度三分量塌平（源只返回一个数）。 */
    q4: [DJ_DATA,
        '    const raw = goodsOwn * 1.0 + plotScore * 0.6 + infoHits * 0.3;',
        '    const raw = goodsOwn * 1.0;'],
    /* ⑤ 盲盒与普通同形。 */
    q5: [DJ_DATA,
        '    const byVariant = (src.blindBox === true) && !!cleanText(src.variantChar);',
        '    const byVariant = false;'],
    /* ⑥ 重定价不报（源静默改价）。 */
    q6: [DJ_DATA,
        '    const changed = ratio > th;',
        '    const changed = false;'],
    /* ⑦ 合计把读不出的当 0 加进去（源就是这样）。 */
    q7: [DJ_DATA,
        "        if (!pr.ok) { bad.push({ index: i, title: cleanText(r.title) || '(无题)', why: pr.why }); continue; }",
        '        if (!pr.ok) { continue; }'],
    /* ⑧ 台账挤掉不计数（源静默 shift）。 */
    q8: [DJ_DATA,
        '    while (arr.length > cap) { arr.shift(); dropped += 1; }',
        '    while (arr.length > cap) { arr.shift(); }'],
    /* ⑨ 余量取不出来编 0（空与坏塔平）。 */
    q9: [DJ_DATA,
        '    const pick = (v) => (numOrNull(v) === null ? null : Math.max(0, numOrNull(v)));',
        '    const pick = (v) => (numOrNull(v) === null ? 0 : Math.max(0, numOrNull(v)));'],
    /* ⑩ 行 id 不按行号（两套标号各说各话）。 */
    q10: [DJ_DATA,
        "                index: i, id: cleanText(p.id) || ('row' + String(i)),",
        "                index: i, id: cleanText(p.id),"],
    /* ⑪ App：取不出来当没事（源把取不到读成空）。 */
    q11: [DJ_APP,
        "        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }",
        "        catch (e) { return { ok: true, why: 'absent', value: undefined }; }"],
    /* ⑫ App：写了但认不出来当空（源就是把它当空）。 */
    q12: [DJ_APP,
        "            return { face: FACE_MALFORMED, why: 'json', obj: null };",
        "            return { face: FACE_EMPTY, why: 'json', obj: null };"],
    /* ⑬ App：失败时把现有商品清掉（源在解析失败时也会清一遍）。
     * ★ 锚点落在**解析失败那条分支**：它正是「失败的粘贴」走的那条路。
     * ★ 破坏必须**顺手重算投影**：清了内存却不 `_recompute()` 的话，
     *   投影面还是上一轮的（用户看到的没变），判据观测不到 —— 这是装饰性破坏。 */
    q13: [DJ_APP,
        '        if (!box.ok) {' + NL + "            this._receipt('ingest_shop', false, box.why, {});",
        '        if (!box.ok) {' + NL + '            this._productsRaw = [];' + NL + '            this._recompute();' + NL
        + "            this._receipt('ingest_shop', false, box.why, {});"],
    /* ⑭ App：合计不可信照样结（源扣完才说）。 */
    q14: [DJ_APP,
        '        if (!this._cartCalc.ok) {',
        '        if (false) {'],
    /* ⑮ App：数量门塔平（坏值照收）。 */
    q15: [DJ_APP,
        '            if (n === null || n < 1 || n > DJ_QTY_MAX) {',
        '            if (false) {'],
    /* ⑯ App：台账挤掉不计数（源静默 shift）。 */
    q16: [DJ_APP,
        '        this._dropped += tr.dropped;',
        '        this._dropped += 0;'],
    /* ⑰ App：换会话不重取（源就是切角色原样留着）。
     * ★ 破坏必须把**整页清**与**重取**一起拿掉：只关掉 probe
     *   时 `_clearToDefaults()` 仍会把内存态清干净，而判据看的正是内存态。 */
    q17: [DJ_APP,
        '    onChatChanged() {' + NL + '        this._clearToDefaults();' + NL + "        this._tab = 'shop';" + NL + "        this._focus = '';" + NL + '        this._now = 0;' + NL + '        this.probe();',
        '    onChatChanged() {' + NL + "        this._tab = 'shop';" + NL + "        this._focus = '';" + NL + '        this._now = 0;'],
    /* ⑱ App：存档不落盘（源把存档塞在同一个大对象里，写一次就带上了）。 */
    q18: [DJ_APP,
        '            products: this._productsRaw, events: this._events,' + NL + '            shelf: this._shelf || []',
        '            products: this._productsRaw, events: this._events'],
    /* ⑲ App：清车顺手清店头（源四类挤在一处就是这个后果）。
     * ★ 替换串不许**原样包含锚点**（J2 会查「替换后原串残留为零」）；
     *   故这里把清车那句本身改成等价写法，再顺手插一句清店头。 */
    q19: [DJ_APP,
        '    clearCart() {' + NL + '        const n = this._cart.length;' + NL + '        this._cart = [];',
        '    clearCart() {' + NL + '        this._productsRaw = [];' + NL
        + '        const n = this._cart.length;' + NL + '        this._cart.splice(0, this._cart.length);'],
    /* ⑳ 视图：面色相塔平（四态只有一种色）。 */
    q20: [DJ_VIEW,
        "    malformed: 'err',",
        "    malformed: 'ok',"],
    /* ㉑ 视图：空与坏塔成一话（取不出来的那一格也当成「真的用到 0」画数）。 */
    q22: [DJ_VIEW,
        "            parts.push('<span class=\"djn-gauge-num' + (r.blank ? ' blank' : '') + '\">' + this._esc(r.text) + '</span>');",
        "            parts.push('<span class=\"djn-gauge-num\">' + this._esc(r.text) + '</span>');"],
    /* ㉒ 视图：余量条取不出来也着色。 */
    q23: [DJ_VIEW,
        '            if (!r.blank) {',
        '            if (true) {'],
    /* ㉓ 视图：失败面不见（回执不许画）。 */
    q24: [DJ_VIEW,
        "        if (this._flash) parts.push('<div class=\"djn-flash\">' + this._esc(this._flash) + '</div>');",
        '        if (false) parts.push(' + Q + Q + ');'],
    /* ㉔ 数据层：失败因写成中文话（程序没法比对）。 */
    q25: [DJ_DATA,
        "export const DJ_PRICE_WHYS = Object.freeze(['ok', 'no_digits', 'over_limit']);",
        "export const DJ_PRICE_WHYS = Object.freeze(['取到数', 'no_digits', 'over_limit']);"],
};

/** 造一棵**真目录结构**的暂存树（破坏副本按真相对路径落盘，相对 import 才解得了）。 */
function stageTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3440_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'num-gate.js'), path.join(dir, 'config', 'num-gate.js'));
    const kd = path.join(dir, 'apps', 'doujin');
    fs.mkdirSync(kd, { recursive: true });
    for (const f of ['doujin-data.js', 'doujin-view.js', 'doujin-app.js']) {
        fs.copyFileSync(path.join(ROOT, 'apps', 'doujin', f), path.join(kd, f));
    }
    return dir;
}

/** NEG：破坏键 / 类别 / 判据 / 期望报出的问题前缀。 */
const NEG = [
    ['I1 破坏「没数字不许读成 0」⇒ 内核判据必须转红', 'q1', 'data', dataProblems, ['no-digits-read-as-zero']],
    ['I2 破坏「超限与没数字不同形」⇒ 内核判据必须转红', 'q2', 'data', dataProblems, ['over-limit-collapsed']],
    ['I3 破坏「商品行不许静默跳过」⇒ 内核判据必须转红', 'q3', 'data', dataProblems, ['row-silently-skipped']],
    ['I4 破坏「热度三分量不塌平」⇒ 内核判据必须转红', 'q4', 'data', dataProblems, ['heat-components-collapsed']],
    ['I5 破坏「盲盒与普通不同形」⇒ 内核判据必须转红', 'q5', 'data', dataProblems, ['blind-and-normal-collapsed']],
    ['I6 破坏「重定价要报」⇒ 内核判据必须转红', 'q6', 'data', dataProblems, ['reprice-unreported']],
    ['I7 破坏「合计要逐行回报」⇒ 内核判据必须转红', 'q7', 'data', dataProblems, ['cart-bad-row-swallowed']],
    ['I8 破坏「台账挤掉要计数」⇒ 内核判据必须转红', 'q8', 'data', dataProblems, ['ledger-drop-unreported']],
    ['I9 破坏「余量不许编 0」⇒ 内核判据必须转红', 'q9', 'data', dataProblems, ['gauge-faked-zero']],
    ['I10 破坏「行 id 按行号」⇒ 内核判据必须转红', 'q10', 'data', dataProblems, ['row-id-not-by-index']],
    ['I11 破坏「取不出来不许当空」（App）⇒ 行为判据必须转红', 'q11', 'appmod', appFaceProblems, ['storage-absent-lost']],
    ['I12 破坏「写了但认不出来单列」（App）⇒ 行为判据必须转红', 'q12', 'appmod', appFaceProblems, ['malformed-face-lost']],
    ['I13 破坏「失败不许动现有商品」（App）⇒ 行为判据必须转红', 'q13', 'appmod', appContentProblems, ['failed-ingest-wiped-shop']],
    ['I14 破坏「合计不可信不许照样结」（App）⇒ 行为判据必须转红', 'q14', 'appmod', appContentProblems,
        ['cart-total-trusted-with-bad-rows', 'settle-through-bad-rows']],
    ['I15 破坏「数量取值门」（App）⇒ 行为判据必须转红', 'q15', 'appmod', appGateProblems, ['qty-gate-lost']],
    ['I16 破坏「台账挤掉要计数」（App）⇒ 行为判据必须转红', 'q16', 'appmod', appGateProblems, ['ledger-drop-unreported']],
    ['I17 破坏「换会话全量重取」（App）⇒ 行为判据必须转红', 'q17', 'appmod', appChatProblems,
        ['chat-change-no-shop-reload', 'chat-change-no-market-reload', 'chat-change-no-cart-reload',
            'chat-change-no-shelf-reload', 'chat-change-no-ledger-reload']],
    ['I18 破坏「存档要落盘」（App）⇒ 行为判据必须转红', 'q18', 'appmod', appChatProblems, ['shelf-not-persisted']],
    ['I19 破坏「清车不顺手清店头」（App）⇒ 行为判据必须转红', 'q19', 'appmod', appGateProblems, ['clear-cart-wiped-shop']],
    ['I20 破坏「面色相取真源」（视图）⇒ 视图判据必须转红', 'q20', 'src', viewFaceProblems, ['face-tone-not-by-source']],
    ['I21 破坏「空与坏不同形」（视图）⇒ 视图判据必须转红', 'q22', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I22 破坏「余量条取不出来不着色」（视图）⇒ 视图判据必须转红', 'q23', 'src', viewCountProblems, ['empty-and-bad-collapsed']],
    ['I23 破坏「失败面要可见」（视图）⇒ 结构判据必须转红', 'q24', 'src', (src) => {
        const code = stripComments(src);
        return code.includes('djn-flash') ? [] : ['flash-line-lost'];
    }, ['flash-line-lost']],
    ['I24 破坏「失败因必须是键」（数据层结构面）⇒ 结构判据必须转红', 'q25', 'src', dataKeyProblems, ['why-not-key']],
];

for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 60));
        const damaged = src.split(from).join(to);
        assert.notEqual(damaged, src, '破坏必须真的发生');
        if (kind === 'src') {
            const bad = judge(damaged);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(src), [], '对照：真源码必须干净');
            return;
        }
        const dir = stageTree();
        fs.writeFileSync(path.join(dir, rel), damaged);
        const mod = await import(pathToFileURL(path.join(dir, rel)).href);
        const bad = judge(mod);
        assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
            '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
        const real = (kind === 'data') ? DAT : APP;
        assert.deepEqual(judge(real), [], '对照：真模块必须干净');
    });
}

/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(' + NL + 'b').includes('fetch('), false, '行注释必须剥掉');
    assert.ok(stripComments('const s = ' + Q + 'fetch(' + Q + ';').includes('fetch('), '字符串里的同形文本必须留住');
    /* ★ 被审三件必须能让剥器复位（尾随哨兵）：剥完不许把哨兵也吃掉。 */
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW]) {
        const src = read(rel) + NL + 'const SENTINEL_TAIL = 1;' + NL;
        assert.ok(stripComments(src).trimEnd().endsWith('const SENTINEL_TAIL = 1;'),
            rel + ' 必须能让剥器复位（否则说明代码里有裸引号骗住了状态机）');
    }
});

test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        assert.equal(src.split(from).length - 1, 1, key + ' 的锚点必须恰中 1 次');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3440k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r2 = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r2.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW]) {
        const r2 = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r2.status, 0, rel + ' 必须语法正确：' + (r2.stderr || '').split(NL)[0]);
    }
});

test('J4 十一道静态门必须在场（含本版缺陷所属的那几道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts.check.includes(g), 'check 链必须含 ' + g + ' 门');
    }
});

test('J5 判据两向自证：真模块上每一条行为判据都必须干净（且真的会跑）', () => {
    assert.deepEqual(dataProblems(DAT), [], '数据层判据在真模块上必须干净');
    assert.deepEqual(appFaceProblems(APP), []);
    assert.deepEqual(appContentProblems(APP), []);
    assert.deepEqual(appGateProblems(APP), []);
    assert.deepEqual(appChatProblems(APP), []);
    assert.deepEqual(viewFaceProblems(read(DJ_VIEW)), []);
    assert.deepEqual(viewClimbProblems(read(DJ_VIEW)), []);
    assert.deepEqual(viewCountProblems(read(DJ_VIEW)), []);
    assert.deepEqual(dataKeyProblems(read(DJ_DATA)), []);
});

test('J6 被审代码的字符纪律：不许正则字面量 / 反斜杠 / 反引号（剥器是字符状态机）', () => {
    for (const rel of [DJ_DATA, DJ_APP, DJ_VIEW]) {
        const src = read(rel);
        const code = stripComments(src);
        /* 反斜杠：源码里一处都不许有（转义一律走 String.fromCharCode）。 */
        assert.equal(src.indexOf(BS) >= 0, false, rel + ' 不许出现反斜杠');
        /* 反引号：模板字符串禁用。 */
        assert.equal(src.indexOf('`') >= 0, false, rel + ' 不许出现反引号');
        /* 正则字面量：被审代码里不许有（剥器不解析它）。 */
        assert.equal(/=\s*\/[^\/\s][^\n]*\/[gimsuy]*\s*[;.,)]/.test(code), false, rel + ' 不许出现正则字面量');
    }
});

/* ══════════════════════ K — 版本与交棒 ══════════════════════ */
test('K1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 44),
        '本套件成立于 RubyPhone 3.44.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "'"), 'index.js 版本常量必须同源');
    assert.ok(log.versions && log.versions[man.version], 'update-log.versions 必须有本版键');
    const rec = log.versions[man.version];
    assert.ok(Array.isArray(rec.items) || Array.isArray(rec.changes), '本版记录必须有条目');
    assert.ok(read('ITERATION_LOG.md').includes(man.version), 'ITERATION_LOG.md 必须含本版号');
    /* 公告块与 update-log 逐字同源（本仓硬判据）。 */
    const items = rec.items || rec.changes;
    for (const it of items) assert.ok(src.includes(JSON.stringify(it)), '公告块必须与条目逐字同源');
});

test('K2 交棒必须指向第 3 层下一步的真实现状（路线图字面不成立时以实测为准）', () => {
    /* ★ 钉**本件自己那一版的 update-log 条目**，不钉 index.js 当前公告 ——
     *   公告随每次抬版整体重写（钉它等于给自己埋一条下一版必红的断言）。 */
    const log = JSON.parse(read('update-log.json'));
    const own = (log.versions['3.44.0'] || {}).items || [];
    const text = own.join(NL);
    assert.ok(text.includes('同人商店'), 'v3.44.0 条目必须自述本件名');
    assert.ok(text.includes('melonbooks'), '交棒必须落到源文件名（便于下一步定位）');
    assert.ok(text.includes('mercari'), '交棒必须写到第二件源（两件合一件是本件的关键决策）');
    assert.ok(text.includes('运行时验证边界'), '条目必须带运行时验证边界段');
    assert.ok(text.includes('看起来没坏但显示不对'), '条目必须与边界文档共用标志语');
});
