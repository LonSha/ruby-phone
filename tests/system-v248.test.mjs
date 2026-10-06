// ============================================================
// system-v248.test.mjs — 撩语（词库）版本锁 [v2.48.0]
//
// 本套件锁住 v2.48.0 的四件事，任何一件被改坏都必须红灯：
//   A 数据同源：data/dirtytalk.js ⇄ data/dirtytalk-index.js 逐字一致；
//   B 装配语义：归一/上限/只读不猜；C 注入块：空则空串、内容逐字；
//   D 抽卡映射与合并：模块以 dt_ 前缀入包、撩语池独立不污染「全部」；
//   E 四处注册 + F 三处接线 + G 控制器真行为 + H 真源码破坏负控制。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const _readRaw = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const read = withRouteSurface(_readRaw, root);
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};

const { dirtyTalkModules } = await import('../data/dirtytalk.js');
const idxMod = await import('../data/dirtytalk-index.js');
const { dirtyTalkIndex, DT_TIER_META, DT_TIER_ORDER, DT_STYLES, DT_ITEM_PREFIX, dtItemId, dtModuleIdOfItem } = idxMod;
const { dirtyTalkCorpus } = await import('../data/dirtytalk-corpus.js');
const DD = await import('../apps/dirtytalk/dt-data.js');
const { GachaData } = await import('../apps/gacha/gacha-data.js');

/* ========== A. 数据同源 ========= */
{
    ok('A1 正文库非空且条数合理', Array.isArray(dirtyTalkModules) && dirtyTalkModules.length >= 100, String(dirtyTalkModules?.length));
    ok('A2 索引与正文条数一致', dirtyTalkIndex.length === dirtyTalkModules.length, `${dirtyTalkIndex.length}/${dirtyTalkModules.length}`);
    const byId = new Map(dirtyTalkModules.map((p) => [p.id, p]));
    ok('A3 索引 id 集合 == 正文 id 集合',
        dirtyTalkIndex.length === byId.size && dirtyTalkIndex.every((r) => byId.has(r.id)));
    const fields = ['name', 'cat', 'chars', 'sub', 'tier', 'desc'];
    const mism = [];
    for (const r of dirtyTalkIndex) {
        const p = byId.get(r.id);
        for (const f of fields) {
            const a = f === 'chars' || f === 'sub' ? Number(r[f]) : r[f];
            const b = f === 'chars' || f === 'sub' ? Number(p[f]) : p[f];
            if (a !== b) mism.push(`${r.id}.${f}`);
        }
    }
    ok('A4 同 id 的 name/cat/chars/sub/tier/desc 逐字相同', mism.length === 0, mism.slice(0, 5).join(','));
    const badChars = dirtyTalkModules.filter((p) => Number(p.chars) !== String(p.content || '').length);
    ok('A5 chars == 正文实际字符数（不虚报负担）', badChars.length === 0,
        badChars.slice(0, 3).map((p) => `${p.id}:${p.chars}/${String(p.content || '').length}`).join(' '));
    ok('A6 正文全部非空', dirtyTalkModules.every((p) => String(p.content || '').trim().length > 0));
    ok('A7 id 唯一', new Set(dirtyTalkModules.map((p) => p.id)).size === dirtyTalkModules.length);
    ok('A8 档位全部在合法集合内',
        dirtyTalkModules.every((p) => DT_TIER_ORDER.includes(p.tier)), [...new Set(dirtyTalkModules.map((p) => p.tier))].join(','));
    ok('A9 8 风格齐全', DT_STYLES.length === 8 && DT_STYLES.every((n) => dirtyTalkModules.some((p) => p.cat === 'style' && p.name === n)), DT_STYLES.join(','));
    const cdMeta = DD.default.TIER_META;
    ok('A10 App 侧档位表与索引逐项相同',
        !!cdMeta && Object.keys(DT_TIER_META).length === Object.keys(cdMeta).length
        && Object.keys(DT_TIER_META).every((q) => {
            const x = DT_TIER_META[q], y = cdMeta[q];
            return y && x.weight === y.weight && x.color === y.color && x.order === y.order;
        }), JSON.stringify(cdMeta));
    ok('A11 App 侧档位顺序与索引逐项相同',
        (DD.default.TIER_ORDER || []).join(',') === DT_TIER_ORDER.join(','), String(DD.default.TIER_ORDER));
    ok('A12 dtItemId/dtModuleIdOfItem 往返一致',
        dirtyTalkModules.every((p) => dtModuleIdOfItem(dtItemId(p.id)) === p.id));
    ok('A13 非撩语 itemId 反解为空串（不猜）',
        dtModuleIdOfItem('jaseff0021') === '' && dtModuleIdOfItem(null) === '' && dtModuleIdOfItem('cheat_x') === '' && dtModuleIdOfItem('dt') === '');
    ok('A14 前缀常量为 dt_', DT_ITEM_PREFIX === 'dt_');
    ok('A15 语料档非空且不参与装配', Array.isArray(dirtyTalkCorpus) && dirtyTalkCorpus.length >= 10
        && dirtyTalkCorpus.every((p) => !String(p.name || '').startsWith('dt_')));
    const ov = DD.vaultOverview();
    ok('A16 档位计数与正文自洽', ov.byTier['重'] + ov.byTier['中'] + ov.byTier['轻'] === dirtyTalkModules.length, JSON.stringify(ov.byTier));
    ok('A17 语料档概览被产品端消费', DD.corpusOverview().total === dirtyTalkCorpus.length);
}

/* ========== B. 装配语义 ========= */
{
    const ids = dirtyTalkModules.map((p) => p.id);
    const a = ids[0], b = ids[1], c = ids[2], d = ids[3];
    const r1 = DD.sanitizeInstalled([a, a, b, '不存在的模块', c, d], { limit: 8 });
    ok('B1 去重 + 丢未知 id', r1.ids.length === 4 && !r1.ids.includes('不存在的模块'), JSON.stringify(r1));
    ok('B2 丢未知 id 被如实上报', r1.dropped.includes('不存在的模块'));
    ok('B3 保持调用方次序', r1.ids.join(',') === [a, b, c, d].join(','), r1.ids.join(','));
    const r2 = DD.sanitizeInstalled([a, b, c], { limit: 2 });
    ok('B4 超上限截断且截断项被上报', r2.ids.length === 2 && r2.ids.join(',') === [a, b].join(',') && r2.truncated.includes(c), JSON.stringify(r2));
    ok('B5 非法入参降级为空（不抛）',
        DD.sanitizeInstalled(null).ids.length === 0 && DD.sanitizeInstalled('乱传').ids.length === 0 && DD.sanitizeInstalled([1, 2, 3]).ids.length === 0);
    ok('B6 limit 夹在 1..8', DD.sanitizeInstalled(ids.slice(0, 12), { limit: 99 }).ids.length === DD.INSTALL_MAX);
    ok('B7 limit 下界夹到 1', DD.sanitizeInstalled([a, b], { limit: 0 }).ids.length === 1);
    ok('B8 INSTALL_MIN/MAX == 1/8', DD.INSTALL_MIN === 1 && DD.INSTALL_MAX === 8);
    ok('B9 默认装配 4 条', DD.defaultDtSettings().maxInstall === 4);
    const unknownOrder = DD.tierOrderOf('不存在的档');
    ok('B10 未知档位排在已知档之后', unknownOrder > DT_TIER_ORDER.length - 1
        && DT_TIER_ORDER.every((q) => DD.tierOrderOf(q) < unknownOrder), String(unknownOrder));
    ok('B11 未知 id 查询返回 null', DD.getModuleById('nope') === null && DD.getModuleById('') === null);
    const ch = DD.installedChars([a, 'nope', b]);
    ok('B12 字数合计只计已知 id', ch.count === 2 && ch.chars === Number(dirtyTalkModules[0].chars) + Number(dirtyTalkModules[1].chars), JSON.stringify(ch));
    const before = dirtyTalkModules.map((p) => p.id).join(',');
    DD.allModules().sort((x, y) => (x.id < y.id ? 1 : -1));
    ok('B13 allModules() 是副本', dirtyTalkModules.map((p) => p.id).join(',') === before);
}

/* ========== C. 注入块 ========= */
{
    const a = dirtyTalkModules[0], b = dirtyTalkModules[1];
    ok('C1 空清单 → 空串', DD.buildDtPromptBlock([], {}) === '');
    ok('C2 全未知 id → 空串', DD.buildDtPromptBlock(['nope', 'nope2'], {}) === '');
    ok('C3 畸形入参 → 空串（不抛）',
        DD.buildDtPromptBlock(null, {}) === '' && DD.buildDtPromptBlock('x', {}) === ''
        && DD.buildDtPromptBlock([a.id], { settings: null }) !== '');
    ok('C4 关掉注入开关 → 空串', DD.buildDtPromptBlock([a.id], { settings: { injectToPrompt: false } }) === '');
    const blk = DD.buildDtPromptBlock([a.id, b.id], { settings: { injectToPrompt: true, maxInstall: 8 } });
    const HEAD = '【当前撩语】';
    ok('C5 块以固定块头开头', blk.startsWith(HEAD));
    ok('C6 块头写明既定风格', blk.includes('既定风格'));
    ok('C7 每条以〔类别·名称〕开头',
        blk.includes(`〔${a.label || a.cat}·${a.name}〕`) && blk.includes(`〔${b.label || b.cat}·${b.name}〕`));
    ok('C8 正文逐字进入注入块', blk.includes(String(a.content).trim()) && blk.includes(String(b.content).trim()));
    ok('C9 装配超上限时只注入上限条数',
        DD.buildDtPromptBlock([a.id, b.id, dirtyTalkModules[2].id], { settings: { maxInstall: 2 } })
            .includes(`〔${b.label || b.cat}·${b.name}〕`)
        && !DD.buildDtPromptBlock([a.id, b.id, dirtyTalkModules[2].id], { settings: { maxInstall: 2 } })
            .includes(`〔${dirtyTalkModules[2].label || dirtyTalkModules[2].cat}·${dirtyTalkModules[2].name}〕`));
    ok('C10 未知 id 混入不会让整块失败', DD.buildDtPromptBlock(['nope', a.id], {}).includes(`〔${a.label || a.cat}·${a.name}〕`));
}

/* ========== D. 抽卡映射 ========= */
{
    const items = DD.dtGachaItems();
    ok('D1 撩语道具数 == 索引条数', items.length === dirtyTalkIndex.length, String(items.length));
    ok('D2 每件 id 为 dt_ 前缀', items.every((i) => i.id.startsWith(DT_ITEM_PREFIX)));
    ok('D3 weight 取档位权重', items.every((i) => {
        const row = dirtyTalkIndex.find((r) => r.id === i.id);
        return i.weight === (DT_TIER_META[row.tier] || {}).weight;
    }));
    ok('D4 不可叠加', items.every((i) => i.unique === true && i.stackable === false && Number(i.grantQuantity) === 1));
    ok('D5 全部归入 pool_dt', items.every((i) => (i.poolTags || []).join(',') === 'pool_dt'));
    ok('D6 quality 落在扭蛋六档', items.every((i) => ['神话','传说','史诗','稀有','优秀','普通'].includes(i.quality)));
    const pool = DD.dtGachaPool();
    ok('D7 撩语池 includeInAll=false', pool.id === 'pool_dt' && pool.includeInAll === false);
    class MockStorage { constructor() { this.d = {}; } get(k) { return this.d[k] ?? null; } set(k, v) { this.d[k] = v; } remove(k) { delete this.d[k]; } }
    const g = new GachaData(new MockStorage());
    const pools = g.getPools();
    ok('D8 撩语池已合并进抽卡池表', pools.some((p) => p.id === 'pool_dt'), pools.map((p) => p.id).join(','));
    ok('D9 「全部」池不含撩语', !g.getItemsOfPool('all').some((i) => String(i.id).startsWith(DT_ITEM_PREFIX)));
    ok('D10 撩语池只含撩语', g.getItemsOfPool('pool_dt').every((i) => String(i.id).startsWith(DT_ITEM_PREFIX)));
    ok('D11 内置池道具数未被改动（erotic 仍 210）', g.getItemsOfPool('pool_erotic').length === 210);
    ok('D12 「全部」仍不含外挂（不打红 v247）', !g.getItemsOfPool('all').some((i) => String(i.id).startsWith('cheat_')));
    const st = new MockStorage();
    const g2 = new GachaData(st);
    g2.addCoins(100000);
    let leaked = 0;
    for (let i = 0; i < 60; i++) {
        const r = g2.pullOnce('all');
        if (r.ok && r.results.some((x) => String(x.id).startsWith(DT_ITEM_PREFIX))) leaked++;
    }
    ok('D13 「全部」抽取路径不会抽到撩语（60 连测）', leaked === 0, String(leaked));
    let allDt = true;
    for (let i = 0; i < 20; i++) {
        const r = g2.pullOnce('pool_dt');
        if (!r.ok || !r.results.every((x) => String(x.id).startsWith(DT_ITEM_PREFIX))) allDt = false;
    }
    ok('D14 撩语池抽出的必是撩语', allDt);
}

/* ========== E. 四处注册 ========= */
{
    const apps = read('config/apps.js');
    ok('E1 桌面条目（id=dirtytalk / 名称含撩语）', /id:\s*'dirtytalk'[\s\S]{0,200}?name:\s*'[^']*撩语[^']*'/.test(apps));
    ok('E2 桌面主色品红 #e879f9', /id:\s*'dirtytalk'[\s\S]{0,220}?#e879f9/.test(apps));
    const colors = [...apps.matchAll(/color:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1].toLowerCase());
    ok('E3 品红主色在桌面清单中唯一', colors.filter((x) => x === '#e879f9').length === 1, String(colors.length));
    const stor = read('config/storage.js');
    ok('E4 storage.js 含 /^dt_/', /\/\^dt_\//.test(stor));
    const { PhoneStorage } = await import('../config/storage.js');
    const s = new PhoneStorage();
    ok('E5 dt_state_v1 被判为会话数据', s._isChatData('dt_state_v1') === true);
    ok('E6 语料正文数据文件不被卷进会话键', s._isChatData('dirtytalk.js') === false);
    const css = read('phone.css');
    ok('E7 phone.css 已合并 .dt-* 样式', (css.match(/\.dt-/g) || []).length >= 40, String((css.match(/\.dt-/g) || []).length));
    ok('E8 源文件 apps/dirtytalk/dt.css 保留', fs.existsSync(path.join(root, 'apps/dirtytalk/dt.css')));
    ok('E9 源样式与运行时载体的规则数一致',
        (read('apps/dirtytalk/dt.css').match(/\.dt-/g) || []).length === (css.match(/\.dt-/g) || []).length);
    const idx = read('index.js');
    ok('E10 index.js 有 dirtytalk 路由分支', /appId === 'dirtytalk'/.test(idx));
    ok('E11 路由为懒加载 + 单例',
        /appId === 'dirtytalk'[\s\S]{0,400}?import\('\.\/apps\/dirtytalk\/dirtytalk-app\.js'\)[\s\S]{0,220}?if \(!window\.VirtualPhone\.dtApp\)[\s\S]{0,120}?new module\.DtApp\(/.test(idx));
    ok('E12 加载失败有兜底提示', /加载撩语App失败/.test(idx));
}

/* ========== F. 三处接线 ========= */
{
    const idx = read('index.js');
    const _tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    ok('F1 dtApp 在懒加载重绑表（P1/P2/P3 单一真源）', _tbl.includes("'dtApp'"));
    ok('F1 index.js rebindLazyApps() 三处接入', (idx.match(/rebindLazyApps\(\);/g) || []).length === 3);
    ok('F2 clearCurrentData 路径接入', /clearCurrentData[\s\S]{0,4000}rebindLazyApps\(\);/.test(idx));
    ok('F3 clearAllData 路径接入', /clearAllData[\s\S]{0,4000}rebindLazyApps\(\)/.test(idx));
    const _inds = [...idx.matchAll(/( *)(?:window\.VirtualPhone\.)?rebindLazyApps\(\);/g)];
    ok('F4 三处 rebindLazyApps() 缩进合法', _inds.length === 3 && _inds.every((m) => m[1].length % 4 === 0),
        _inds.length ? _inds.map((m) => m[1].length).join('/') : 'no-match');
    const app = read('apps/dirtytalk/dirtytalk-app.js');
    ok('F5 控制器真实 import 了视图与内核', app.includes("from './dt-view.js'") && app.includes("from './dt-data.js'"));
    ok('F6 控制器不置 null 自身', !/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,300}window\.VirtualPhone\.dtApp\s*=\s*null/.test(app));
    ok('F7 不复制背包', app.includes("GACHA_KEY = 'ruby_gacha_state'") && !/set\(\s*GACHA_KEY/.test(app));
    ok('F8 反解前缀走唯一真源', app.includes('dtModuleIdOfItem(') && !/slice\(/.test(app));
    ok('F9 生成钩子挂在 GENERATE_BEFORE_COMBINE_PROMPTS', app.includes('GENERATE_BEFORE_COMBINE_PROMPTS'));
    ok('F10 注入失败不阻断生成', /es\.on\([\s\S]{0,600}?try \{[\s\S]{0,400}?\} catch \(_e\) \{ \/\* 静默失败/.test(app));
    ok('F11 视图 esc() 真转义', /&amp;/.test(read('apps/dirtytalk/dt-view.js')) && /&#34;/.test(read('apps/dirtytalk/dt-view.js')));
}

/* ========== G. 控制器真行为 ========= */
{
    class MockEl { constructor() { this.innerHTML = ''; } querySelectorAll() { return []; } querySelector() { return null; } }
    class MockStorage { constructor() { this.d = {}; } get(k) { return this.d[k] ?? null; } set(k, v) { this.d[k] = v; } remove(k) { delete this.d[k]; } }
    const savedWin = global.window;
    global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
    try {
        const { DtApp } = await import('../apps/dirtytalk/dirtytalk-app.js');
        const screen = new MockEl();
        const storage = new MockStorage();
        const app = new DtApp({ screen, showNotification() {} }, storage);
        ok('G1 未装配时注入块为空', app.promptBlock() === '');
        app.render();
        ok('G2 视图真渲染出撩语界面', String(screen.innerHTML).includes('撩语'));
        const ids = dirtyTalkModules.map((p) => p.id);
        const rA = app.toggleInstall(ids[0]);
        ok('G3 装配成功并落库', rA.ok === true && app.getInstalled().join(',') === ids[0]);
        ok('G4 落库进入 dt_state_v1', !!storage.get('dt_state_v1'));
        ok('G5 装配后注入块非空且含该模块', app.promptBlock().includes(dirtyTalkModules[0].name));
        const rDup = app.toggleInstall(ids[0]);
        ok('G6 再次点击 = 卸下', rDup.ok === true && app.getInstalled().length === 0);
        const rBad = app.toggleInstall('不存在的模块');
        ok('G7 未知 id 如实拒绝且不写脏存储',
            rBad.ok === false && app.getInstalled().length === 0 && !String(storage.get('dt_state_v1')).includes('不存在的模块'));
        app.toggleInstall(ids[0]); app.toggleInstall(ids[1]); app.toggleInstall(ids[2]); app.toggleInstall(ids[3]);
        const rFull = app.toggleInstall(ids[4]);
        ok('G8 到顶如实拒绝（上限 4）', rFull.ok === false && /已满/.test(rFull.reason || ''), rFull.reason || '');
        ok('G9 到顶不静默踢掉先装的', app.getInstalled().join(',') === [ids[0], ids[1], ids[2], ids[3]].join(','));
        app.saveSettings({ maxInstall: 8 });
        ok('G10 上限可调', app.getSettings().maxInstall === 8 && app.toggleInstall(ids[4]).ok === true);
        storage.set('ruby_gacha_state', JSON.stringify({ inventory: { [dtItemId(ids[0])]: 1, jaseff0021: 2 } }));
        const owned = app.ownedIds();
        ok('G11 ownedIds 从抽卡背包现取并只认撩语', owned.has(ids[0]) && !owned.has('jaseff0021') && owned.size === 1, [...owned].join(','));
        app.view.detail = ids[0]; app.view.q = '关键词'; app.view.tab = 'vault'; app.view.cat = 'style';
        app.onChatChanged();
        ok('G12 onChatChanged 丢弃浏览位置', app.view.detail === null && app.view.q === '' && app.view.tab === 'installed' && app.view.cat === '');
        const app2 = new DtApp({ screen: new MockEl(), showNotification() {} }, new MockStorage());
        ok('G13 另一会话读到空清单', app2.getInstalled().length === 0 && app2.promptBlock() === '');
        ok('G14 overview 带语料档', Number(app.overview()?.corpus?.total) === dirtyTalkCorpus.length);
    } finally {
        global.window = savedWin;
    }
}

/* ========== H. 负控制 ========= */
{
    const src = read('apps/dirtytalk/dt-data.js');
    const anchor = 'if (kept.length >= limit) {';
    ok('H1 上限判据锚点恰出现 1 次', src.split(anchor).length - 1 === 1, String(src.split(anchor).length - 1));
    const broken = src.replace(anchor, 'if (false) {');
    ok('H2 破坏确已发生', broken !== src);
    ok('H3 破坏后锚点原文不再出现', broken.split(anchor).length - 1 === 0);
    const tmp = path.join(root, `apps/dirtytalk/.neg_${process.pid}.mjs`);
    let h4ok = false, h4detail = '', h4c1 = '', h4c2 = '';
    try {
        fs.writeFileSync(tmp, broken, 'utf8');
        const neg = await import(new URL(`file://${tmp}`));
        const ids = dirtyTalkModules.map((p) => p.id);
        h4c1 = String(neg.sanitizeInstalled(ids.slice(0, 8), { limit: 2 }).ids.length);
        h4c2 = neg.sanitizeInstalled(['x', ids[0], ids[0]], { limit: 8 }).ids.join(',');
        h4ok = h4c1 !== '2';
        h4detail = `破坏后条数=${h4c1}`;
    } catch (e) {
        h4detail = '副本加载/调用抛错: ' + String(e && e.message);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    }
    ok('H4 破坏副本上「超上限被截断」不再成立', h4ok, h4detail);
    ok('H5 破坏副本上「去重/丢未知」仍成立', h4c2 === dirtyTalkModules[0].id, h4c2);
    ok('H6 原版上「超上限被截断」真成立', DD.sanitizeInstalled(dirtyTalkModules.map((p) => p.id).slice(0, 8), { limit: 2 }).ids.length === 2);
    const src2 = read('apps/dirtytalk/dt-data.js');
    const anchor2a = "if (!kept.length) return '';";
    const anchor2b = "if (!parts.length) return '';";
    ok('H7a 第一道空清单守卫恰出现 1 次', src2.split(anchor2a).length - 1 === 1);
    ok('H7b 第二道空清单守卫恰出现 1 次', src2.split(anchor2b).length - 1 === 1);
    {
        const one = src2.replace(anchor2a, '');
        const tmp1 = path.join(root, `apps/dirtytalk/.neg2a_${process.pid}.mjs`);
        let same = null;
        try {
            fs.writeFileSync(tmp1, one, 'utf8');
            const n1 = await import(new URL(`file://${tmp1}`));
            same = n1.buildDtPromptBlock([], {}) === '';
        } catch (e) { same = 'throw: ' + String(e && e.message); }
        finally { try { fs.unlinkSync(tmp1); } catch (_e) { /* ignore */ } }
        ok('H7c 只破一道守卫时行为不变', same === true, String(same));
    }
    const tmp2 = path.join(root, `apps/dirtytalk/.neg2_${process.pid}.mjs`);
    let h8ok = false, h8detail = '', h8out = '';
    try {
        fs.writeFileSync(tmp2, src2.replace(anchor2a, '').replace(anchor2b, ''), 'utf8');
        const neg2 = await import(new URL(`file://${tmp2}`));
        h8out = neg2.buildDtPromptBlock([], {});
        h8ok = h8out !== '';
        h8detail = '空清单产出=' + JSON.stringify(String(h8out).slice(0, 40));
    } catch (e) {
        h8detail = '副本加载/调用抛错: ' + String(e && e.message);
    } finally {
        try { fs.unlinkSync(tmp2); } catch (_e) { /* ignore */ }
    }
    ok('H8 两道守卫都破掉后空清单不再返回空串', h8ok, h8detail);
    ok('H8b 破坏后可观测的失效形态是只有块头的空块', h8ok && String(h8out).includes('【当前撩语】'), String(h8out).slice(0, 20));
    ok('H9 原版上空清单返回空串', DD.buildDtPromptBlock([], {}) === '');
    ok('H10 清理干净', !fs.existsSync(tmp) && !fs.existsSync(tmp2));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
