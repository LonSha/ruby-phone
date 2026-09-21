/* ============================================================
 * RubyPhone v2.46.0 —— 地点图景（apps/place/）：上游场所面终于有消费点
 *
 * 本版问题（本仓反复出现的欠债形态再次现形）：
 *   lonsha-memory-plugin v3.181.0 把「地点」从一句注记做成了一个可查询的面
 *   （scene-book.js：场景树 / 到访史 / 在场索引 / 地点挂账 / 覆盖度 / 不变量六面），
 *   并且把它外供到了只读快照桥上（`lonsha_memory_bridge_v1.snapshot.scene`）。
 *   而 RubyPhone 侧实测 **全库零消费**：手机端看得到剧情，看不到「人在哪儿」。
 *   —— 上游把面做出来了、下游一个消费点都没有，这正是 v2.41 建门禁要拦的那一类。
 *
 * 本版判据（照抄 config/world-bridge.js 的消费面先例：只读、不抛、不猜）：
 *   ① 归因必须**六态分开**：桥未装 / 桥装了没快照 / 快照是旧版没有场所面 /
 *      场所模块缺席（退路在跑）/ 这个会话还没登记过场所 / 就绪 —— 六种完全不同的
 *      处境不得塌成同一种「没数据」（本仓反复治理的静默降级）。
 *   ② 不变量三态不得塌两态：ok / warn / broken 必须给出三种不同字样，
 *      缺席单列为第四态（absent 不算通过）。
 *   ③ 读数不落库、每次现取：onChatChanged 只丢弃旧会话的探针归因，
 *      实例**不持有任何读数副本**（否则换会话/删楼回滚后必成陈旧数据）。
 *   ④ 缺项如实置空、绝不编 0：读不到位置链给 []（不是编一条），
 *      非数值如实 null（不是补 0 冒充「世界是空的」）。
 *
 * 负控制在 H 组：真源码破坏（把「缺席」并入「空」）⇒ 六态判据必须报红，
 *   同一判据在原版上不成立。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`\u2713 ${name}`); }
    else { fail++; console.log(`\u2717 ${name} ${detail}`); }
};
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const AMP = String.fromCharCode(38); // 与号：避免内联实体字面量被工具链改写

const D = await import('../apps/place/place-data.js');
const { PLACE_REASONS, IV_TEXT, defaultPlaceSettings, readSceneFace,
    projectScene, presenceGroups, currentChainOf, coverageLines,
    invariantLines, scenePromptBlock } = D;
void defaultPlaceSettings;

/* ========== A. 结构锁：四处注册 + 模块构成 ========== */
{
    ok('A1 apps/place/place-data.js 存在', fs.existsSync(path.join(root, 'apps/place/place-data.js')));
    ok('A2 apps/place/place-app.js 存在（控制器命名 <dir>-app.js）', fs.existsSync(path.join(root, 'apps/place/place-app.js')));
    ok('A3 apps/place/place-view.js 存在', fs.existsSync(path.join(root, 'apps/place/place-view.js')));
    ok('A4 apps/place/place.css 存在（源文件）', fs.existsSync(path.join(root, 'apps/place/place.css')));
    // ① 桌面图标
    const appsJs = read('config/apps.js');
    ok('A5 config/apps.js 注册了 place 桌面条目', /id:\s*'place'/.test(appsJs));
    const entryAt = appsJs.indexOf("id: 'place'");
    const placeEntry = entryAt < 0 ? '' : appsJs.slice(Math.max(0, entryAt - 100), entryAt + 220);
    ok('A5b 桌面条目四字段齐备（name/icon/color/badge）',
        /name:\s*'[^']+'/.test(placeEntry) && /icon:\s*'[^']+'/.test(placeEntry)
        && /color:\s*'#[0-9a-fA-F]{6}'/.test(placeEntry) && /badge:/.test(placeEntry), placeEntry.slice(0, 80));
    ok('A6 place 主色为地理青 #14b8a6（不与既有 App 撞色）', /id:\s*'place'[\s\S]{0,120}#14b8a6/.test(appsJs));
    // ② 样式合并
    const css = read('phone.css');
    ok('A7 phone.css 已合并 .pl-* 样式（运行时载体）', /^\.pl-root \{/m.test(css));
    const nCssSrc = (read('apps/place/place.css').match(/^\.pl-[\w-]+/gm) || []).length;
    const nPhone = (css.match(/^\.pl-[\w-]+/gm) || []).length;
    ok('A8 源文件不得多于运行时载体（无孤儿样式）', nCssSrc <= nPhone, `src=${nCssSrc} phone=${nPhone}`);
    ok('A8b phone.css 真的载入了 place 规则（不是只写了源文件）', nPhone >= 35, String(nPhone));
    // ③ 路由分支
    const idx = read('index.js');
    ok('A9 index.js 有 phone:openApp 的 place 路由分支', /appId === 'place'/.test(idx));
    ok('A10 路由为懒加载单例（实例复用于跨会话）', /appId === 'place'[\s\S]{0,600}if \(!window\.VirtualPhone\.placeApp\)/.test(idx));
    ok('A11 路由懒加载模块路径指向 place-app.js', /import\('\.\/apps\/place\/place-app\.js'\)/.test(idx));
    // ④ 会话隔离
    const st = read('config/storage.js');
    ok('A12 config/storage.js 的 CHAT_DATA_PATTERNS 含 /^place_/', /\/\^place_\//.test(st));
    ok('A13 控制器设置键常量真实存在且匹配 /^place_/',
        read('apps/place/place-app.js').includes("const SETTINGS_KEY = 'place_settings_v1'"));
}

/* ========== B. 归因六态：六种处境不得同形 ========== */
{
    const R = readSceneFace({ mounted: false, hasSnapshot: false, snapshot: null });
    ok('B1 桥未装 → bridge-absent', R.reason === 'bridge-absent' && R.state === 'absent');
    const N = readSceneFace({ mounted: true, hasSnapshot: false, snapshot: null });
    ok('B2 桥在但没快照 → no-snapshot（不是 bridge-absent）', N.reason === 'no-snapshot');
    const O = readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { protagonist: {} } });
    ok('B3 旧版快照没有场所面 → no-scene-face（升级提示只有这一态能给）', O.reason === 'no-scene-face');
    const M = readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { scene: { absent: true } } });
    ok('B4 场所模块缺席 → module-absent（退路在跑，不与「空」同形）',
        M.reason === 'module-absent' && M.state === 'absent' && !!M.snapshot);
    const E = readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { scene: { empty: true } } });
    ok('B5 会话没登记过场所 → empty', E.reason === 'empty' && E.state === 'empty');
    const Y = readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { scene: { scale: {}, presence: [], coverage: {} } } });
    ok('B6 就绪 → ready', Y.reason === 'ready' && Y.state === 'ready');
    ok('B7 六态文案恰好六个键', Object.keys(PLACE_REASONS).length === 6, Object.keys(PLACE_REASONS).join(','));
    ok('B8 六态文案互不相同（不得同形）', new Set(Object.values(PLACE_REASONS)).size === 6);
    ok('B9 六个 reason 全部可达（readSceneFace 分支齐全）',
        new Set([R.reason, N.reason, O.reason, M.reason, E.reason, Y.reason]).size === 6);
    ok('B10 未知 reason 由视图如实显示（不吞）',
        read('apps/place/place-view.js').includes('未知归因（如实显示原值，不吞）'));
    ok('B11 探针异常入参不抛（undefined / null）',
        readSceneFace(undefined).reason === 'bridge-absent' && readSceneFace(null).reason === 'bridge-absent');
}

/* ========== C. 不变量三态不得塌两态 ========== */
{
    ok('C1 IV_TEXT 四态齐全（ok/warn/broken/absent）', Object.keys(IV_TEXT).length === 4);
    ok('C2 ok/warn/broken 三态字样互不相同',
        new Set([IV_TEXT.ok, IV_TEXT.warn, IV_TEXT.broken]).size === 3);
    ok('C3 缺席单列第四态且明写「不算通过」',
        IV_TEXT.absent.includes('缺席') && IV_TEXT.absent.includes('不算通过'));
    const ivBroken = invariantLines({ state: 'broken', broken: [{ kind: 'broken-chain', key: 'a/b' }], warnings: [] });
    ok('C4 broken 态逐条可读化并带 ✗ 前缀',
        ivBroken.text === IV_TEXT.broken && ivBroken.broken[0].includes('层级断裂')
        && ivBroken.broken[0].includes('\u2717'), ivBroken.broken[0]);
    const ivWarn = invariantLines({ state: 'warn', broken: [], warnings: [{ kind: 'visit-unregistered', key: 'c' }] });
    ok('C5 warn 态逐条可读化并标明未登记',
        ivWarn.text === IV_TEXT.warn && ivWarn.warnings[0].includes('到访过但未登记'), ivWarn.warnings[0]);
    const ivUnknown = invariantLines({ state: 'warn', warnings: [{ kind: 'something-new', key: 'x' }] });
    ok('C6 未知 kind 如实显示原始 kind（不吞、不猜）',
        ivUnknown.warnings[0].includes('something-new'), ivUnknown.warnings[0]);
    const ivAbsent = invariantLines(undefined);
    ok('C7 传入缺失 → absent（不是伪装成 ok）', ivAbsent.state === 'absent' && ivAbsent.text === IV_TEXT.absent);
}

/* ========== D. 投影：只读、不抛、缺项如实置空 ========== */
{
    const face = {
        scale: { nodes: 6, detailed: 3, depth: 2, visits: 4, presence: 2 },
        currentLine: '老城 › 钟楼 › 顶层',
        presence: [{ name: '甲', key: '老城/钟楼/顶层', atFloor: 12 }, { name: '乙', key: '老城/钟楼/顶层', atFloor: 12 }],
        coverage: {
            floors: [10, 11, 12], floorCount: 3,
            steps: [{ after: 12, before: 10, missing: 2 }],
            unregistered: ['码头/旧仓库'],
            state: 'broken', broken: [{ kind: 'key-path-mismatch', key: '码头/旧仓库' }], warnings: []
        },
        empty: false
    };
    const p = projectScene(face, { maxEntries: 5 });
    ok('D1 就绪面 → ok', p.ok === true && p.state === 'ready');
    ok('D2 位置链按 › 拆且由粗到细', p.current.join(',') === '老城,钟楼,顶层', p.current.join(','));
    ok('D3 在场按地点聚组', p.presence.length === 1 && p.presence[0].members.length === 2);
    ok('D4 不变量从覆盖度继承（broken 不被吞成 ok）',
        p.invariants.state === 'broken' && p.invariants.text === IV_TEXT.broken);
    ok('D5 规模读数如实透传', p.scale.nodes === 6 && p.scale.depth === 2 && p.scale.visits === 4);
    const pNull = projectScene(null);
    ok('D6 空入参 → ok=false 且不抛', pNull.ok === false && pNull.invariants.state === 'absent');
    ok('D7 空入参的规模读数如实 null（不编 0 冒充「世界是空的」）',
        pNull.scale.nodes === null && pNull.scale.depth === null);
    ok('D8 空入参的位置链为空数组（不是编一条）', Array.isArray(pNull.current) && pNull.current.length === 0);
    ok('D9 畸形入参不抛（字符串）', projectScene('not-an-object').ok === false);
    ok('D10 无 currentLine 回落 current（按 / 拆）',
        currentChainOf({ current: 'a/b/c' }).join(',') === 'a,b,c');
    ok('D11 两者都缺 → []（如实）', currentChainOf({}).length === 0);
}

/* ========== E. 在场分组：按 key 聚合、按人数降序 ========== */
{
    const g = presenceGroups([
        { name: '丁', key: 'c' },
        { name: '甲', key: 'a/b', atFloor: 3 },
        { name: '乙', key: 'a/b', atFloor: 3 },
        { name: '丙', key: 'a/b', atFloor: 3 }
    ]);
    ok('E1 两个地点 → 两组（同地三人聚成一组）', g.length === 2, String(g.length));
    ok('E2 按人数降序（人数多的在前）', g[0].key === 'a/b' && g[0].members.length === 3, g[0].key);
    ok('E3 组内成员按 Unicode 码位升序（渲染稳定，不依赖插入顺序）',
        g[0].members.join(',') === '丙,乙,甲', g[0].members.join(','));
    ok('E4 保留 atFloor（第 N 楼）', g[0].atFloor === 3);
    const gBad = presenceGroups([null, 1, 'x', { name: '', key: 'k' }, { name: 'n', key: '' }]);
    ok('E5 脏记录被过滤（不抛、不产出空组）', gBad.length === 0, JSON.stringify(gBad));
    ok('E6 非数组入参 → []', presenceGroups(undefined).length === 0 && presenceGroups('x').length === 0);
}

/* ========== F. 覆盖度：拒绝只报百分比 ========== */
{
    const c = coverageLines({
        floors: [1, 2, 3], floorCount: 3,
        steps: [{ after: 9, before: 5, missing: 4 }, { after: 4, before: 3, missing: 0 }],
        unregistered: ['码头/旧仓库']
    });
    ok('F1 逐楼列号（不是只给一个百分比）', c.head.includes('第3楼') && c.head.includes('变更覆盖 3 楼'), c.head);
    ok('F2 缺口逐条可行动（缺哪几楼、缺多少）',
        c.steps.length === 1 && c.steps[0].includes('第9楼') && c.steps[0].includes('缺 4 楼'), JSON.stringify(c.steps));
    ok('F3 missing 为 0 的步骤不进列表', c.steps.length === 1);
    ok('F4 未登记到访单列（不是并进总数）', c.unregistered.length === 1 && c.unregistered[0].includes('码头'));
    const cEmpty = coverageLines({});
    ok('F5 无观测 → 明说未观测到（不是报 0%）', cEmpty.head.includes('尚未观测到任何楼层变更'), cEmpty.head);
}

/* ========== G. 生成侧一致性块（空则 ''，不产生空块） ========== */
{
    ok('G1 空面 → 空串（不带空块进 prompt）', scenePromptBlock(null) === '' && scenePromptBlock({}) === '');
    ok('G2 empty 面 → 空串', scenePromptBlock({ empty: true, existence: 'x' }) === '');
    const blk = scenePromptBlock({
        currentLine: '老城 › 钟楼 › 顶层',
        presence: [{ name: '甲', key: '老城/钟楼/顶层' }],
        scale: { nodes: 6, detailed: 3, depth: 2, visits: 4, presence: 1 }
    }, { maxLines: 4 });
    ok('G3 就绪面 → 带块头的一致性块', blk.startsWith('【本世界已登记的场所与在场'), blk.slice(0, 30));
    ok('G4 块内写明当前所在（由粗到细）', blk.includes('- 当前所在：老城 › 钟楼 › 顶层'));
    ok('G5 块内写明在场（地点 › 人名）', blk.includes('- 老城 › 钟楼 › 顶层：甲'));
    ok('G6 块内写明规模读数', blk.includes('已登记场所 6 处'));
    const capped = scenePromptBlock({ presence: [{ name: '甲', key: 'k1' }], scale: { nodes: 1 } }, { maxLines: 1 });
    ok('G7 maxLines 限行生效（不无界膨胀）', capped.split('\n').length <= 4, String(capped.split('\n').length));
    ok('G8 畸形入参不抛', scenePromptBlock('x') === '' && scenePromptBlock(123) === '');
}

/* ========== H. 负控制：真源码破坏（六态塌态必须报红） ========== */
{
    const src = read('apps/place/place-data.js');
    const anchor = 'if (face.absent === true) {';
    ok('H1 破坏锚点在真源码中恰出现 1 次', src.split(anchor).length - 1 === 1, String(src.split(anchor).length - 1));
    const broken = src.replace(anchor, 'if (false) {');
    ok('H2 破坏确已发生（副本与原版不同）', broken !== src);
    const tmp = path.join(root, `apps/place/.neg_${process.pid}.mjs`);
    try {
        fs.writeFileSync(tmp, broken, 'utf8');
        const neg = await import(new URL(`file://${tmp}`));
        const r = neg.readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { scene: { absent: true } } });
        ok('H3 同判据在破坏副本上不成立（缺席被误报成「空」）', r.reason !== 'module-absent', r.reason);
        ok('H4 破坏后投影的规模读数仍为 null（对照：破坏影响的是归因，不是读数）',
            neg.projectScene({ empty: false }).scale.nodes === null);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_e) { /* 清理失败不影响结论 */ }
    }
    const R = readSceneFace({ mounted: true, hasSnapshot: true, snapshot: { scene: { absent: true } } });
    ok('H5 原版上同一判据真成立（真源码未被触碰）', R.reason === 'module-absent');
}

/* ========== I. 接线：三处路径 + 实例不置 null + 不持读数副本 ========== */
{
    const idx = read('index.js');
    const _tbl = (idx.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    ok('I1 placeApp 在懒加载重绑表（P1/P2/P3 单一真源）', _tbl.includes("'placeApp'"));
    ok('I1 index.js rebindLazyApps() 三处接入', (idx.match(/rebindLazyApps\(\);/g) || []).length === 3);
    // [v2.47.0] I2 由「theater→place 的行距紧邻断言」改为**区间成员核对**：
    //   本版在 place 之后新增 cheatApp 重绑，紧邻式判据立刻失配；而它本来要守的是
    //   「theater / place / cheat 三个重绑都在换会话块内、且在 wechatApp = null 之前」。
    const _rb = idx.indexOf('rebindLazyApps();');
    const _wx = idx.indexOf('window.VirtualPhone.wechatApp = null;', _rb);
    ok('I2 换会话路径接入（rebindLazyApps 在 wechatApp = null 之前）',
        _rb > 0 && _wx > _rb && (_wx - _rb) < 200, `gap=${_wx - _rb}`);
    ok('I3 clearCurrentData 路径接入', /clearCurrentData[\s\S]{0,4000}rebindLazyApps\(\);/.test(idx));
    ok('I4 clearAllData 路径接入', /clearAllData[\s\S]{0,4000}rebindLazyApps\(\);/.test(idx));
    // 缩进未被写坏：插入点缩进必须与同块内的 bilibili 调用一致
    const _rebInds = [...idx.matchAll(/( *)(?:window\.VirtualPhone\.)?rebindLazyApps\(\);/g)];
    ok('I5 三处 rebindLazyApps() 缩进均为 4 空格倍数（未被写坏）',
        _rebInds.length === 3 && _rebInds.every((m) => m[1].length % 4 === 0),
        _rebInds.length ? _rebInds.map((m) => m[1].length).join('/') : 'no-match');
    const app = read('apps/place/place-app.js');
    ok('I6 onChatChanged 不置 null 自身（避免监听器累积）',
        !/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,300}window\.VirtualPhone\.placeApp\s*=\s*null/.test(app));
    const ocBody = (app.match(/onChatChanged\s*\(\s*\)\s*\{([\s\S]*?)\n    \}/) || [])[1] || '';
    ok('I7 onChatChanged 只丢弃探针归因（实例不持读数副本）',
        ocBody.includes('_lastProbe = null') && !/this\.(data|snapshot|proj)\s*=/.test(ocBody), ocBody.trim());
    ok('I8 控制器真实 import 了视图与内核（不是死代码）',
        app.includes("from './place-view.js'") && app.includes("from './place-data.js'"));
    ok('I9 视图经 this.app.projection() 取数（唯一数据入口）',
        read('apps/place/place-view.js').includes('this.app.projection()'));
}

/* ========== J. 端到端：真桥形态 → 渲染出内容（不止「模块能 import」） ========== */
{
    class MockEl {
        constructor() { this.innerHTML = ''; this.listeners = {}; }
        addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
        querySelector() { return null; }
        querySelectorAll() { return []; }
    }
    class MockStorage {
        constructor() { this.d = {}; }
        get(k) { return this.d[k] ?? null; }
        set(k, v) { this.d[k] = v; }
        remove(k) { delete this.d[k]; }
    }
    const savedWin = global.window;
    const screen = new MockEl();
    global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
    const { PlaceApp } = await import('../apps/place/place-app.js');
    const storage = new MockStorage();
    const app = new PlaceApp({ screen }, storage);

    ok('J1 桥未装时归因为 bridge-absent', app.sceneFace().reason === 'bridge-absent');
    app.render();
    ok('J2 桥未装时视图仍渲染出主体（不白屏）', screen.innerHTML.includes('地点图景'));
    ok('J3 未安装时注入块为空（不产生空块）', app.promptBlock() === '');

    global.window.lonsha_memory_bridge_v1 = { snapshot: { protagonist: {} } };
    ok('J4 旧版快照 → no-scene-face（提示升级）', app.sceneFace().reason === 'no-scene-face');

    global.window.lonsha_memory_bridge_v1 = {
        snapshot: {
            scene: {
                scale: { nodes: 6, detailed: 3, depth: 2, visits: 4, presence: 2 },
                currentLine: '老城 › 钟楼 › 顶层',
                presence: [{ name: '甲', key: '老城/钟楼/顶层', atFloor: 12 }],
                coverage: { floors: [12], floorCount: 1, steps: [], unregistered: [], state: 'ok', broken: [], warnings: [] },
                empty: false
            }
        }
    };
    ok('J5 真桥快照 → ready（消费点真的接上了）', app.sceneFace().reason === 'ready');
    ok('J6 就绪时注入块非空且写明当前所在', app.promptBlock().includes('当前所在：老城 › 钟楼 › 顶层'));
    app.render();
    ok('J7 视图渲染出当前所在链', screen.innerHTML.includes('pl-chip') && screen.innerHTML.includes('钟楼'));
    ok('J8 视图渲染出在场分组与楼层', screen.innerHTML.includes('pl-group') && screen.innerHTML.includes('第12楼'));

    app.saveSettings({ injectToPrompt: false });
    ok('J9 关闭注入后块为空（开关不是摆设）', app.promptBlock() === '');
    app.saveSettings({ injectToPrompt: true, maxInject: 1 });
    ok('J10 设置键落库为 place_settings_v1（匹配 /^place_/）', !!storage.d['place_settings_v1']);
    const cappedBlock = app.promptBlock();
    // 块 = 块头 + 最多 maxLines 行在场 + 当前所在 + 规模读数 ⇒ 上限 maxLines + 3 行
    ok('J11 maxInject 限行生效（块行数不超过 maxLines + 3）',
        cappedBlock.split('\n').length <= 4, String(cappedBlock.split('\n').length));
    const dl = app.summaryLine();
    ok('J12 一行总述含场所数与不变量文案', dl.includes('场所 6 处') && dl.includes(IV_TEXT.ok), dl);

    app.onChatChanged();
    ok('J13 onChatChanged 后仍能现取到读数（无缓存陈旧面）', app.sceneFace().reason === 'ready');

    app.render();
    const esc = app.view._esc('<b>x</b>' + '"y"' + AMP + 'z');
    ok('J14 _esc 真转义尖括号（无注入面）',
        !esc.includes('<b>') && esc.includes(AMP + 'lt;b' + AMP + 'gt;'), esc);
    ok('J15 _esc 真转义引号（此前写成转义成自身 ＝ 无转义）', esc.includes(AMP + 'quot;'), esc);
    ok('J16 _esc 真转义与号（顺序正确，不产生双重转义）', esc.includes(AMP + 'amp;z'), esc);

    global.window.lonsha_memory_bridge_v1 = {
        refresh: () => ({ scene: { scale: { nodes: 2 }, currentLine: '码头', presence: [], coverage: {}, empty: false } })
    };
    ok('J17 无 snapshot 时回落 refresh() 并成功就绪', app.sceneFace().reason === 'ready');
    const p = app.probeBridge();
    ok('J18 探针如实报告挂载与快照两件事', p.mounted === true && p.hasSnapshot === true);
    global.window = savedWin;
}

/* ========== K. 版本跨源自洽（不硬编码版本号） ========== */
{
    const manifest = JSON.parse(read('manifest.json'));
    const log = JSON.parse(read('update-log.json'));
    const pkg = JSON.parse(read('package.json'));
    ok('K1 四源版本一致（manifest/package/入口常量/update-log.latest）',
        manifest.version === pkg.version
        && String(log.latest) === manifest.version
        && new RegExp(`ST_PHONE_VERSION = '${manifest.version.replace(/\./g, '\\.')}'`).test(read('index.js')),
        `${manifest.version}/${pkg.version}/${log.latest}`);
    const cur = (log.versions || {})[manifest.version];
    ok('K2 当前版本条目含非空 items', !!(cur && Array.isArray(cur.items) && cur.items.length));
    /* [v2.47.0] 交棒：原判据钉死 HEAD 条目里出现「地点图景」（v2.46 的版本专属词），
       每发一版必翻红。改为版本无关的自洽性：HEAD 条目逐条为非空文案，不得留空串占位。 */
    ok('K3 HEAD 条目逐条为非空文案（非占位）',
        !!cur && cur.items.length > 0
        && cur.items.every((x) => typeof x === 'string' && x.trim().length >= 10),
        cur ? String(cur.items.length) : 'missing');
}

console.log(`\n\u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25`);
process.exit(fail > 0 ? 1 : 0);