// ============================================================
// system-v247.test.mjs — 金手指（万界武库）版本锁 [v2.47.0]
//
// 本套件锁住 v2.47.0 的四件事，任何一件被改坏都必须红灯：
//   A 数据同源：data/cheats.js（正文）⇄ data/cheat-index.js（轻量索引）逐字一致；
//   B 装配语义：归一/上限/只读不猜；C 注入块：空则空串、内容逐字；
//   D 抽卡映射与合并：外挂以 cheat_<packId> 入包、外挂池独立不污染「全部」；
//   E 四处注册 + F 三处接线 + G 控制器真行为 + H 真源码破坏负控制。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};

const { cheatPacks } = await import('../data/cheats.js');
const idxMod = await import('../data/cheat-index.js');
const { cheatIndex, CHEAT_QUALITY_META, CHEAT_QUALITY_ORDER, CHEAT_ITEM_PREFIX, cheatItemId, cheatPackIdOfItem } = idxMod;
const CD = await import('../apps/cheat/cheat-data.js');
const { GachaData } = await import('../apps/gacha/gacha-data.js');

/* ========== A. 数据同源（正文 ⇄ 轻量索引） ========== */
{
    ok('A1 正文库非空且条数合理', Array.isArray(cheatPacks) && cheatPacks.length >= 100, String(cheatPacks?.length));
    ok('A2 索引与正文条数一致', cheatIndex.length === cheatPacks.length, `${cheatIndex.length}/${cheatPacks.length}`);
    const byId = new Map(cheatPacks.map((p) => [p.id, p]));
    ok('A3 索引 id 集合 == 正文 id 集合',
        cheatIndex.length === byId.size && cheatIndex.every((r) => byId.has(r.id)));
    const fields = ['name', 'quality', 'chars', 'sub', 'type', 'desc'];
    const mism = [];
    for (const r of cheatIndex) {
        const p = byId.get(r.id);
        for (const f of fields) {
            const a = f === 'chars' || f === 'sub' ? Number(r[f]) : r[f];
            const b = f === 'chars' || f === 'sub' ? Number(p[f]) : p[f];
            if (a !== b) mism.push(`${r.id}.${f}`);
        }
    }
    ok('A4 同 id 的 name/quality/chars/sub/type/desc 逐字相同', mism.length === 0, mism.slice(0, 5).join(','));
    // 字数必须是「正文真实长度」，否则视图显示的注入负担是假的
    const badChars = cheatPacks.filter((p) => Number(p.chars) !== String(p.content || '').length);
    ok('A5 chars == 正文实际字符数（不虚报负担）', badChars.length === 0,
        badChars.slice(0, 3).map((p) => `${p.id}:${p.chars}/${String(p.content || '').length}`).join(' '));
    ok('A6 正文全部非空', cheatPacks.every((p) => String(p.content || '').trim().length > 0));
    ok('A7 id 唯一', new Set(cheatPacks.map((p) => p.id)).size === cheatPacks.length);
    ok('A8 品阶全部在合法集合内',
        cheatPacks.every((p) => QUALITY_ORDER_has(p.quality)), [...new Set(cheatPacks.map((p) => p.quality))].join(','));
    function QUALITY_ORDER_has(q) { return CHEAT_QUALITY_ORDER.includes(q); }
    // 权重单一真源：App 侧品阶表必须与索引**逐项等价**。
    //   注意 cheat-data.js 用「别名 import」（`CHEAT_QUALITY_META as QUALITY_META`）而非具名再导出，
    //   故只能经 default 对象取（若补成具名导出会被零消费导出门禁判为死导出——App 侧只用
    //   qualityColorOf/qualityOrderOf，不直接消费这张表）。这里守的是数值漂移，不是对象身份。
    const cdMeta = CD.default.QUALITY_META;
    ok('A9 App 侧品阶表与索引逐项相同',
        !!cdMeta && Object.keys(CHEAT_QUALITY_META).length === Object.keys(cdMeta).length
        && Object.keys(CHEAT_QUALITY_META).every((q) => {
            const x = CHEAT_QUALITY_META[q], y = cdMeta[q];
            return y && x.weight === y.weight && x.color === y.color && x.order === y.order;
        }), JSON.stringify(cdMeta));
    ok('A10 App 侧品阶顺序与索引逐项相同',
        (CD.default.QUALITY_ORDER || []).join(',') === CHEAT_QUALITY_ORDER.join(','),
        String(CD.default.QUALITY_ORDER));
    // 前缀契约往返
    ok('A11 cheatItemId/cheatPackIdOfItem 往返一致',
        cheatPacks.every((p) => cheatPackIdOfItem(cheatItemId(p.id)) === p.id));
    ok('A12 非外挂 itemId 反解为空串（不猜）',
        cheatPackIdOfItem('jaseff0021') === '' && cheatPackIdOfItem(null) === '' && cheatPackIdOfItem('cheat') === '');
    ok('A13 前缀常量为 cheat_', CHEAT_ITEM_PREFIX === 'cheat_');
}

/* ========== B. 装配语义（归一 / 上限 / 不猜） ========== */
{
    const ids = cheatPacks.map((p) => p.id);
    const a = ids[0], b = ids[1], c = ids[2], d = ids[3];

    const r1 = CD.sanitizeInstalled([a, a, b, '不存在的外挂', c, d], { limit: 5 });
    ok('B1 去重 + 丢未知 id', r1.ids.length === 4 && !r1.ids.includes('不存在的外挂'),
        JSON.stringify(r1));
    ok('B2 丢未知 id 被如实上报（可诊断）', r1.dropped.includes('不存在的外挂'));
    ok('B3 保持调用方次序（先装的在前）', r1.ids.join(',') === [a, b, c, d].join(','), r1.ids.join(','));

    const r2 = CD.sanitizeInstalled([a, b, c], { limit: 2 });
    ok('B4 超上限截断且截断项被上报',
        r2.ids.length === 2 && r2.ids.join(',') === [a, b].join(',') && r2.truncated.includes(c),
        JSON.stringify(r2));

    ok('B5 非法入参降级为空（不抛）',
        CD.sanitizeInstalled(null).ids.length === 0
        && CD.sanitizeInstalled('乱传').ids.length === 0
        && CD.sanitizeInstalled([1, 2, 3]).ids.length === 0);
    ok('B6 limit 夹在 1..5（传 99 不会放行 99 条）',
        CD.sanitizeInstalled([a, b, c, d, ids[4], ids[5], ids[6]], { limit: 99 }).ids.length === CD.INSTALL_MAX);
    ok('B7 limit 下界夹到 1', CD.sanitizeInstalled([a, b], { limit: 0 }).ids.length === 1);
    ok('B8 INSTALL_MIN/MAX == 1/5', CD.INSTALL_MIN === 1 && CD.INSTALL_MAX === 5);
    ok('B9 默认装配 3 条', CD.defaultCheatSettings().maxInstall === 3);

    // 不猜：未知品阶排末位，不塌进任一已知档
    const unknownOrder = CD.qualityOrderOf('不存在的品阶');
    ok('B10 未知品阶排在已知档之后', unknownOrder > CHEAT_QUALITY_ORDER.length - 1
        && CHEAT_QUALITY_ORDER.every((q) => CD.qualityOrderOf(q) < unknownOrder), String(unknownOrder));
    ok('B11 未知 id 查询返回 null（不造）', CD.getCheatById('nope') === null && CD.getCheatById('') === null);

    const ch = CD.installedChars([a, 'nope', b]);
    ok('B12 字数合计只计已知 id', ch.count === 2 && ch.chars === Number(cheatPacks[0].chars) + Number(cheatPacks[1].chars),
        JSON.stringify(ch));

    // 只读：allCheats 返回副本，调用方就地排序不得污染事实源
    const before = cheatPacks.map((p) => p.id).join(',');
    CD.allCheats().sort((x, y) => (x.id < y.id ? 1 : -1));
    ok('B13 allCheats() 是副本，就地改动不污染事实源', cheatPacks.map((p) => p.id).join(',') === before);
}

/* ========== C. 注入块（空则空串 / 内容逐字） ========== */
{
    const a = cheatPacks[0], b = cheatPacks[1];
    ok('C1 空清单 → 空串（不产生空块）', CD.buildCheatPromptBlock([], {}) === '');
    ok('C2 全未知 id → 空串', CD.buildCheatPromptBlock(['nope', 'nope2'], {}) === '');
    ok('C3 畸形入参 → 空串（不抛）',
        CD.buildCheatPromptBlock(null, {}) === '' && CD.buildCheatPromptBlock('x', {}) === ''
        && CD.buildCheatPromptBlock([a.id], { settings: null }) !== '');
    const off = CD.buildCheatPromptBlock([a.id], { settings: { injectToPrompt: false } });
    ok('C4 关掉注入开关 → 空串', off === '');

    const blk = CD.buildCheatPromptBlock([a.id, b.id], { settings: { injectToPrompt: true, maxInstall: 5 } });
    const HEAD = '【当前外挂】';
    ok('C5 块以固定块头开头', blk.startsWith(HEAD));
    ok('C6 块头写明「既定事实」（语义：装了就生效，不是建议）', blk.includes('既定事实'));
    ok('C7 每条以〔品阶·名称〕开头',
        blk.includes(`〔${a.quality}·${a.name}〕`) && blk.includes(`〔${b.quality}·${b.name}〕`));
    ok('C8 正文逐字进入注入块（不是摘要、不是截断）',
        blk.includes(String(a.content).trim()) && blk.includes(String(b.content).trim()));
    ok('C9 装配超上限时只注入上限条数',
        CD.buildCheatPromptBlock([a.id, b.id, cheatPacks[2].id], { settings: { maxInstall: 2 } })
            .includes(`〔${b.quality}·${b.name}〕`)
        && !CD.buildCheatPromptBlock([a.id, b.id, cheatPacks[2].id], { settings: { maxInstall: 2 } })
            .includes(`〔${cheatPacks[2].quality}·${cheatPacks[2].name}〕`));
    ok('C10 未知 id 混入不会让整块失败（跳过未知、保留已知）',
        CD.buildCheatPromptBlock(['nope', a.id], {}).includes(`〔${a.quality}·${a.name}〕`));
}

/* ========== D. 抽卡映射与池合并 ========== */
{
    const items = CD.cheatGachaItems();
    ok('D1 外挂道具数 == 索引条数', items.length === cheatIndex.length, String(items.length));
    ok('D2 每件 id 为 cheat_ 前缀', items.every((i) => i.id.startsWith(CHEAT_ITEM_PREFIX)));
    ok('D3 weight 取品阶权重（神话最稀、普通最多）',
        items.every((i) => i.weight === (CHEAT_QUALITY_META[i.quality] || {}).weight));
    ok('D4 外挂不可叠加（unique / stackable=false / grantQuantity 1）',
        items.every((i) => i.unique === true && i.stackable === false && Number(i.grantQuantity) === 1));
    ok('D5 全部归入外挂池 poolTags', items.every((i) => (i.poolTags || []).join(',') === 'pool_cheat'));
    ok('D6 品阶权重单调（越稀有 weight 越小）',
        CHEAT_QUALITY_ORDER.every((q, i, arr) => i === 0
            || CHEAT_QUALITY_META[arr[i - 1]].weight < CHEAT_QUALITY_META[q].weight));

    const pool = CD.cheatGachaPool();
    ok('D7 外挂池 includeInAll=false（不稀释既有概率）', pool.id === 'pool_cheat' && pool.includeInAll === false);

    class MockStorage { constructor() { this.d = {}; } get(k) { return this.d[k] ?? null; } set(k, v) { this.d[k] = v; } remove(k) { delete this.d[k]; } }
    const g = new GachaData(new MockStorage());
    const pools = g.getPools();
    ok('D8 外挂池已合并进抽卡池表', pools.some((p) => p.id === 'pool_cheat'), pools.map((p) => p.id).join(','));
    ok('D9 「全部」池不含外挂（157 个外挂不混进日常池）',
        !g.getItemsOfPool('all').some((i) => String(i.id).startsWith(CHEAT_ITEM_PREFIX)));
    ok('D10 外挂池只含外挂', g.getItemsOfPool('pool_cheat').every((i) => String(i.id).startsWith(CHEAT_ITEM_PREFIX)));
    ok('D11 内置池道具数未被改动（erotic 仍 210）', g.getItemsOfPool('pool_erotic').length === 210);
    // 'all' 抽取多次不得抽出外挂（includeInAll 过滤对抽取路径同样生效）
    const st = new MockStorage();
    const g2 = new GachaData(st);
    g2.addCoins(100000);
    let leaked = 0;
    for (let i = 0; i < 60; i++) {
        const r = g2.pullOnce('all');
        if (r.ok && r.results.some((x) => String(x.id).startsWith(CHEAT_ITEM_PREFIX))) leaked++;
    }
    ok('D12 「全部」抽取路径不会抽到外挂（60 连测）', leaked === 0, String(leaked));
    // 外挂池抽取必然落在外挂上
    let allCheat = true;
    for (let i = 0; i < 20; i++) {
        const r = g2.pullOnce('pool_cheat');
        if (!r.ok || !r.results.every((x) => String(x.id).startsWith(CHEAT_ITEM_PREFIX))) allCheat = false;
    }
    ok('D13 外挂池抽出的必是外挂', allCheat);
}

/* ========== E. 四处注册 ========== */
{
    const apps = read('config/apps.js');
    const cheatEntry = /id:\s*'cheat'[\s\S]{0,200}?name:\s*'[^']*金手指[^']*'/.test(apps);
    ok('E1 config/apps.js 桌面条目（id=cheat / 名称含金手指）', cheatEntry);
    ok('E2 桌面主色鎏金 #d4af37（不与既有 App 撞色）', /id:\s*'cheat'[\s\S]{0,220}?#d4af37/.test(apps));
    const colors = [...apps.matchAll(/color:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1].toLowerCase());
    ok('E3 鎏金主色在桌面清单中唯一', colors.filter((x) => x === '#d4af37').length === 1, String(colors.length));

    const stor = read('config/storage.js');
    ok('E4 storage.js CHAT_DATA_PATTERNS 含 /^cheat_/', /\/\^cheat_\//.test(stor));
    const { PhoneStorage } = await import('../config/storage.js');
    const s = new PhoneStorage();
    ok('E5 cheat_state_v1 被判为会话数据（随会话隔离）', s._isChatData('cheat_state_v1') === true);
    ok('E6 外挂正文数据文件不被卷进会话键', s._isChatData('cheats.js') === false);

    const css = read('phone.css');
    ok('E7 phone.css 已合并 .ch-* 样式', (css.match(/\.ch-/g) || []).length >= 40, String((css.match(/\.ch-/g) || []).length));
    ok('E8 源文件 apps/cheat/cheat.css 保留（与 bilibili/theater 同规）',
        fs.existsSync(path.join(root, 'apps/cheat/cheat.css')));
    ok('E9 源样式与运行时载体的规则数一致（不是只改了一边）',
        (read('apps/cheat/cheat.css').match(/\.ch-/g) || []).length
        === (css.match(/\.ch-/g) || []).length);

    const idx = read('index.js');
    ok('E10 index.js 有 cheat 路由分支', /appId === 'cheat'/.test(idx));
    ok('E11 路由为懒加载 + 单例（不重复 new，避免监听器累积）',
        /appId === 'cheat'[\s\S]{0,400}?import\('\.\/apps\/cheat\/cheat-app\.js'\)[\s\S]{0,220}?if \(!window\.VirtualPhone\.cheatApp\)[\s\S]{0,120}?new module\.CheatApp\(/.test(idx));
    ok('E12 加载失败有兜底提示（不静默白屏）',
        /加载金手指App失败/.test(idx));
}

/* ========== F. 三处接线（换会话 + 两处清数据） ========== */
{
    const idx = read('index.js');
    const cnt = (idx.match(/window\.VirtualPhone\.cheatApp\?\.onChatChanged\?\.\(\)/g) || []).length;
    ok('F1 cheatApp 三处接入', cnt === 3, String(cnt));
    ok('F2 clearCurrentData 路径接入', /clearCurrentData[\s\S]{0,4000}cheatApp\?\.onChatChanged\?\.\(\)/.test(idx));
    ok('F3 clearAllData 路径接入', /clearAllData[\s\S]{0,4000}cheatApp\?\.onChatChanged\?\.\(\)/.test(idx));
    // 缩进未被写坏：cheat 调用缩进必须与同块 bilibili 调用一致
    const rxInd = new RegExp('( *)window\\.VirtualPhone\\.bilibiliApp\\?\\.onChatChanged\\?\\.\\(\\);\\n'
        + '[\\s\\S]{0,320}?( *)window\\.VirtualPhone\\.cheatApp\\?\\.onChatChanged\\?\\.\\(\\);', 'g');
    const inds = [...idx.matchAll(rxInd)];
    ok('F4 三处插入点缩进与相邻 bilibili 一致', inds.length === 3 && inds.every((m) => m[1].length === m[2].length),
        inds.length ? inds.map((m) => m[1].length + '/' + m[2].length).join(' ') : 'no-match');

    const app = read('apps/cheat/cheat-app.js');
    ok('F5 控制器真实 import 了视图与内核', app.includes("from './cheat-view.js'") && app.includes("from './cheat-data.js'"));
    ok('F6 控制器不置 null 自身（避免监听器累积）',
        !/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,300}window\.VirtualPhone\.cheatApp\s*=\s*null/.test(app));
    ok('F7 不复制背包（只读 ruby_gacha_state，绝不写它）',
        app.includes("GACHA_KEY = 'ruby_gacha_state'") && !/set\(\s*GACHA_KEY/.test(app));
    ok('F8 反解前缀走唯一真源（不手写 cheat_ / slice(6)）',
        app.includes('cheatPackIdOfItem(') && !/slice\(6\)/.test(app) && app.includes("startsWith('cheat_')") === false);
    ok('F9 生成钩子挂在 GENERATE_BEFORE_COMBINE_PROMPTS', app.includes('GENERATE_BEFORE_COMBINE_PROMPTS'));
    ok('F10 注入失败不阻断生成（try 包裹 + 静默）',
        /es\.on\([\s\S]{0,600}?try \{[\s\S]{0,400}?\} catch \(_e\) \{ \/\* 静默失败/.test(app));
    ok('F11 视图 esc() 真转义（& < > 与双引号都在）',
        /&amp;/.test(read('apps/cheat/cheat-view.js')) && /&#34;/.test(read('apps/cheat/cheat-view.js')));
}

/* ========== G. 控制器真行为（端到端，非只 import） ========== */
{
    class MockEl {
        constructor() { this.innerHTML = ''; }
        querySelectorAll() { return []; }
        querySelector() { return null; }
    }
    class MockStorage { constructor() { this.d = {}; } get(k) { return this.d[k] ?? null; } set(k, v) { this.d[k] = v; } remove(k) { delete this.d[k]; } }
    const savedWin = global.window;
    global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
    try {
        const { CheatApp } = await import('../apps/cheat/cheat-app.js');
        const screen = new MockEl();
        const storage = new MockStorage();
        const app = new CheatApp({ screen, showNotification() {} }, storage);

        ok('G1 未装配时注入块为空', app.promptBlock() === '');
        app.render();
        ok('G2 视图真渲染出金手指界面（不白屏）', String(screen.innerHTML).includes('金手指'));

        const ids = cheatPacks.map((p) => p.id);
        const rA = app.toggleInstall(ids[0]);
        ok('G3 装配成功并落库', rA.ok === true && app.getInstalled().join(',') === ids[0]);
        ok('G4 落库内容进入本 App 自己的会话键', !!storage.get('cheat_state_v1'));
        ok('G5 装配后注入块非空且含该外挂', app.promptBlock().includes(cheatPacks[0].name));

        const rDup = app.toggleInstall(ids[0]);
        ok('G6 再次点击 = 卸下', rDup.ok === true && app.getInstalled().length === 0);

        const rBad = app.toggleInstall('不存在的外挂');
        ok('G7 未知 id 如实拒绝且不写脏存储',
            rBad.ok === false && app.getInstalled().length === 0
            && !String(storage.get('cheat_state_v1')).includes('不存在的外挂'));

        app.toggleInstall(ids[0]); app.toggleInstall(ids[1]); app.toggleInstall(ids[2]);
        const rFull = app.toggleInstall(ids[3]);
        ok('G8 到顶如实拒绝（上限 3）', rFull.ok === false && /已满/.test(rFull.reason || ''), rFull.reason || '');
        ok('G9 到顶不静默踢掉先装的', app.getInstalled().join(',') === [ids[0], ids[1], ids[2]].join(','),
            app.getInstalled().join(','));

        app.saveSettings({ maxInstall: 5 });
        ok('G10 上限可调', app.getSettings().maxInstall === 5 && app.toggleInstall(ids[3]).ok === true);

        // 背包从抽卡键现取（不复制）
        storage.set('ruby_gacha_state', JSON.stringify({ inventory: { [cheatItemId(ids[0])]: 1, jaseff0021: 2 } }));
        const owned = app.ownedIds();
        ok('G11 ownedIds 从抽卡背包现取并只认外挂',
            owned.has(ids[0]) && !owned.has('jaseff0021') && owned.size === 1, [...owned].join(','));

        // 换会话：视图浏览位置丢弃，但装配清单随会话键（换键后自然为空）
        app.view.detail = ids[0]; app.view.q = '关键词'; app.view.tab = 'vault';
        app.onChatChanged();
        ok('G12 onChatChanged 丢弃旧会话的浏览位置（详情/搜索/标签）',
            app.view.detail === null && app.view.q === '' && app.view.tab === 'installed');

        // 装配清单随会话隔离：换一个会话键 → 读到的是新会话的清单
        const app2 = new CheatApp({ screen: new MockEl(), showNotification() {} }, new MockStorage());
        ok('G13 另一会话读到空清单（不串味）', app2.getInstalled().length === 0 && app2.promptBlock() === '');
    } finally {
        global.window = savedWin;
    }
}

/* ========== H. 负控制：真源码破坏（判据必须真的在源上成立） ========== */
{
    // H1 破坏 sanitizeInstalled 的上限判据 → 「超上限截断」必须不再成立。
    //   注意：负控制读的是**被测源码实况**（真源码破坏 + 锚点恰中一次），不是自指涉地读本测试文件。
    //   两处 await 一律包 catch，防副本加载/调用抛错时留成未处理的 rejection（异常逃逸会让判据静默失效）。
    const src = read('apps/cheat/cheat-data.js');
    const anchor = 'if (kept.length >= limit) {';
    ok('H1 上限判据锚点在真源码中恰出现 1 次', src.split(anchor).length - 1 === 1, String(src.split(anchor).length - 1));
    const broken = src.replace(anchor, 'if (false) {');
    ok('H2 破坏确已发生（副本与原版不同）', broken !== src);
    ok('H3 破坏后锚点原文不再出现（破坏非空操作）', broken.split(anchor).length - 1 === 0);
    const tmp = path.join(root, `apps/cheat/.neg_${process.pid}.mjs`);
    let h4ok = false, h4detail = '', h4c1 = '', h4c2 = '';
    try {
        fs.writeFileSync(tmp, broken, 'utf8');
        const neg = await import(new URL(`file://${tmp}`));
        const ids = cheatPacks.map((p) => p.id);
        h4c1 = String(neg.sanitizeInstalled(ids.slice(0, 8), { limit: 2 }).ids.length);
        h4c2 = neg.sanitizeInstalled(['x', ids[0], ids[0]], { limit: 5 }).ids.join(',');
        h4ok = h4c1 !== '2';
        h4detail = `破坏后条数=${h4c1}`;
    } catch (e) {
        h4detail = '副本加载/调用抛错: ' + String(e && e.message);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 清理失败不影响结论 */ }
    }
    ok('H4 破坏副本上「超上限被截断」不再成立（真判据，非死断言）', h4ok, h4detail);
    ok('H5 破坏副本上「去重/丢未知」仍成立（对照：破坏只影响上限，判据彼此分离）',
        h4c2 === cheatPacks[0].id, h4c2);
    ok('H6 原版上「超上限被截断」真成立（真源码未被触碰）',
        CD.sanitizeInstalled(cheatPacks.map((p) => p.id).slice(0, 8), { limit: 2 }).ids.length === 2);

    // H7 第二处破坏：注入块的**空清单双重早退**（!kept.length 与 !parts.length 两道守卫）。
    //   实测发现这里刻意留了双道防线：只破一道时行为不变（另一道仍返回空串）——
    //   「破坏不可观测」本身就是要记下来的事实，故负控制同时破两道，并要求行为真变。
    const src2 = read('apps/cheat/cheat-data.js');
    const anchor2a = "if (!kept.length) return '';";
    const anchor2b = "if (!parts.length) return '';";
    ok('H7a 第一道空清单守卫恰出现 1 次', src2.split(anchor2a).length - 1 === 1, String(src2.split(anchor2a).length - 1));
    ok('H7b 第二道空清单守卫恰出现 1 次', src2.split(anchor2b).length - 1 === 1, String(src2.split(anchor2b).length - 1));
    // 先验证「只破一道 → 行为不变」（双重防线的证据）
    {
        const one = src2.replace(anchor2a, '');
        const tmp1 = path.join(root, `apps/cheat/.neg2a_${process.pid}.mjs`);
        let same = null;
        try {
            fs.writeFileSync(tmp1, one, 'utf8');
            const n1 = await import(new URL(`file://${tmp1}`));
            same = n1.buildCheatPromptBlock([], {}) === '';
        } catch (e) { same = 'throw: ' + String(e && e.message); }
        finally { try { fs.unlinkSync(tmp1); } catch (_e) { /* 清理失败不影响结论 */ } }
        ok('H7c 只破一道守卫时行为不变（第二道仍在兜底 = 真·双重防线）', same === true, String(same));
    }
    const tmp2 = path.join(root, `apps/cheat/.neg2_${process.pid}.mjs`);
    let h8ok = false, h8detail = '', h8out = '';
    try {
        fs.writeFileSync(tmp2, src2.replace(anchor2a, '').replace(anchor2b, ''), 'utf8');
        const neg2 = await import(new URL(`file://${tmp2}`));
        h8out = neg2.buildCheatPromptBlock([], {});
        h8ok = h8out !== '';
        h8detail = '空清单产出=' + JSON.stringify(String(h8out).slice(0, 40));
    } catch (e) {
        h8detail = '副本加载/调用抛错: ' + String(e && e.message);
    } finally {
        try { fs.unlinkSync(tmp2); } catch (_e) { /* 清理失败不影响结论 */ }
    }
    ok('H8 两道守卫都破掉后「空清单返回空串」不再成立（判据真在源上成立）', h8ok, h8detail);
    ok('H8b 破坏后可观测的失效形态是「只有块头的空块」（正是要防的那个 bug）',
        h8ok && String(h8out).includes('【当前外挂】'), String(h8out).slice(0, 20));
    ok('H9 原版上「空清单返回空串」真成立（真源码未被触碰）', CD.buildCheatPromptBlock([], {}) === '');
    ok('H10 清理干净：临时副本未残留', !fs.existsSync(tmp) && !fs.existsSync(tmp2));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
