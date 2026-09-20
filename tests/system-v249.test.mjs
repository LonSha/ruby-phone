/* ========================================================
 * system-v249.test.mjs — [v2.49.0] 三个桥面消费 App + 撩语场景联动 + 微信注入补口
 * ======================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('v249 A: 钱袋（wallet）四件套与注册', () => {
    const apps = read('config/apps.js');
    const idx = read('index.js');
    const storage = read('config/storage.js');
    const css = read('phone.css');
    assert.match(apps, /id:\s*'wallet'[\s\S]{0,200}?#eab308/, 'A1 桌面条目');
    assert.match(idx, /appId === 'wallet'[\s\S]{0,400}?import\('\.\/apps\/wallet\/wallet-app\.js'\)[\s\S]{0,220}?if \(!window\.VirtualPhone\.walletApp\)[\s\S]{0,120}?new module\.WalletApp\(/, 'A3 路由懒加载单例');
    assert.match(idx, /加载钱袋App失败/, 'A4 失败兜底');
    assert.match(storage, /\/\^wallet_\//, 'A5 会话隔离');
    assert.match(css, /\.wl-root\s*\{/, 'A6 phone.css 合并');
    const app = read('apps/wallet/wallet-app.js');
    assert.ok(app.includes("from './wallet-data.js'"), 'A7 import 内核');
    assert.ok(app.includes("from './wallet-view.js'"), 'A8 import 视图');
    assert.match(app, /GENERATE_BEFORE_COMBINE_PROMPTS/, 'A9 生成前钩子');
    assert.match(app, /es\.on\([\s\S]{0,600}?try \{[\s\S]{0,400}?\} catch \(_e\) \{ \/\* 静默失败/, 'A10 注入失败不阻断');
    assert.ok(!/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,300}window\.VirtualPhone\.walletApp\s*=\s*null/.test(app), 'A11 不置 null 自身');
    const data = read('apps/wallet/wallet-data.js');
    assert.ok(data.includes('export function readWalletFace'), 'A12');
    assert.ok(data.includes('export function projectWallet'), 'A13');
    assert.ok(data.includes('export function walletPromptBlock'), 'A14');
});

test('v249 A* 钱袋内核纯函数（五态归因 + 投影 + 注入块）', async () => {
    const m = await import(join(root, 'apps/wallet/wallet-data.js'));
    assert.equal(m.readWalletFace({ mounted: false }).reason, 'bridge-absent', 'A*1');
    assert.equal(m.readWalletFace({ mounted: true, hasSnapshot: false, snapshot: null }).reason, 'no-snapshot', 'A*2');
    assert.equal(m.readWalletFace({ mounted: true, hasSnapshot: true, snapshot: {} }).reason, 'no-ledger-face', 'A*3');
    assert.equal(m.readWalletFace({ mounted: true, hasSnapshot: true, snapshot: { moneyLedger: { money: {}, moneyLog: [] } } }).reason, 'empty', 'A*4');
    const ready = m.readWalletFace({ mounted: true, hasSnapshot: true, snapshot: { moneyLedger: { money: { cash: { name: '现金', amount: 1200, floor: 3 } }, moneyLog: [{ key: 'cash', name: '现金', time: 'L1', floor: 1, desc: '工资', delta: 1200, timestamp: 1700000000000 }] } } });
    assert.equal(ready.reason, 'ready', 'A*5');
    const proj = m.projectWallet(ready.ledger, { maxEntries: 10 });
    assert.equal(proj.accounts.length, 1, 'A*6');
    assert.equal(proj.accounts[0].amount, 1200, 'A*7');
    assert.equal(proj.tx[0].delta, 1200, 'A*8');
    const blk = m.walletPromptBlock(ready.ledger, { maxLines: 6 });
    assert.ok(blk.includes('现金') && blk.includes('1200'), 'A*9');
    assert.equal(m.walletPromptBlock(null, {}), '', 'A*10');
    assert.equal(m.walletPromptBlock({ money: {}, moneyLog: [] }, {}), '', 'A*11');
    assert.doesNotThrow(() => m.projectWallet('bad', {}), 'A*12');
    assert.doesNotThrow(() => m.readWalletFace('bad'), 'A*13');
});

test('v249 B: 档案（profile）四件套与注册', () => {
    const apps = read('config/apps.js');
    const idx = read('index.js');
    const storage = read('config/storage.js');
    const css = read('phone.css');
    assert.match(apps, /id:\s*'profile'[\s\S]{0,200}?#818cf8/, 'B1');
    assert.match(idx, /appId === 'profile'[\s\S]{0,400}?import\('\.\/apps\/profile\/profile-app\.js'\)[\s\S]{0,220}?if \(!window\.VirtualPhone\.profileApp\)[\s\S]{0,120}?new module\.ProfileApp\(/, 'B2');
    assert.match(storage, /\/\^profile_\//, 'B3');
    assert.match(css, /\.pf-root\s*\{/, 'B4');
    const app = read('apps/profile/profile-app.js');
    assert.ok(app.includes("from './profile-data.js'"), 'B5');
    assert.ok(app.includes('GENERATE_BEFORE_COMBINE_PROMPTS'), 'B6');
    const data = read('apps/profile/profile-data.js');
    assert.ok(data.includes('export function readProfileFace'), 'B7');
    assert.ok(data.includes('export function protagonistFields'), 'B8');
    assert.ok(data.includes('export function lifeDetailsGroups'), 'B9');
});

test('v249 B* 档案内核纯函数（五态归因 + empty 可达）', async () => {
    const m = await import(join(root, 'apps/profile/profile-data.js'));
    assert.equal(m.readProfileFace({ mounted: false }).reason, 'bridge-absent', 'B*1');
    assert.equal(m.readProfileFace({ mounted: true, hasSnapshot: false, snapshot: null }).reason, 'no-snapshot', 'B*2');
    assert.equal(m.readProfileFace({ mounted: true, hasSnapshot: true, snapshot: {} }).reason, 'no-profile-face', 'B*3');
    assert.equal(m.readProfileFace({ mounted: true, hasSnapshot: true, snapshot: { protagonist: {}, lifeDetails: [] } }).reason, 'empty', 'B*4 empty 可达');
    assert.equal(m.readProfileFace({ mounted: true, hasSnapshot: true, snapshot: { protagonist: { gender: '女' }, lifeDetails: [] } }).reason, 'ready', 'B*5');
    const fields = m.protagonistFields({ gender: '女', age: 24, extra: { nested: 1 } });
    assert.equal(fields.length, 2, 'B*6 嵌套不展开');
    const groups = m.lifeDetailsGroups([{ text: 'a', tier: 'pinned' }, { text: 'b', tier: 'archive' }, { text: 'c' }]);
    assert.equal(groups.pinned.length, 1, 'B*7');
    assert.equal(groups.archive.length, 1, 'B*8');
    assert.equal(groups.active.length, 1, 'B*9 未知 tier 归 active');
    const blk = m.profilePromptBlock({ protagonist: { gender: '女' }, lifeDetails: [{ text: '养了一只猫', tier: 'pinned' }] }, { maxLines: 8 });
    assert.ok(blk.includes('女') && blk.includes('养了一只猫'), 'B*10');
    assert.equal(m.profilePromptBlock(null, {}), '', 'B*11');
    assert.doesNotThrow(() => m.protagonistFields('bad'), 'B*12');
});

test('v249 C: 剧情线（plotline）四件套与注册', () => {
    const apps = read('config/apps.js');
    const idx = read('index.js');
    const storage = read('config/storage.js');
    const css = read('phone.css');
    assert.match(apps, /id:\s*'plotline'[\s\S]{0,200}?#b08d57/, 'C1');
    assert.match(idx, /appId === 'plotline'[\s\S]{0,400}?import\('\.\/apps\/plotline\/plotline-app\.js'\)[\s\S]{0,220}?if \(!window\.VirtualPhone\.plotlineApp\)[\s\S]{0,120}?new module\.PlotlineApp\(/, 'C2');
    assert.match(storage, /\/\^plotline_\//, 'C3');
    assert.match(css, /\.pn-root\s*\{/, 'C4');
    const app = read('apps/plotline/plotline-app.js');
    assert.ok(app.includes("from './plotline-data.js'"), 'C5');
    assert.ok(app.includes('GENERATE_BEFORE_COMBINE_PROMPTS'), 'C6');
    const data = read('apps/plotline/plotline-data.js');
    assert.ok(data.includes('export function readPlotlineFace'), 'C7');
    assert.ok(data.includes('export function outlineStage'), 'C8');
    assert.ok(data.includes('export function promiseList'), 'C9');
    assert.ok(data.includes('export function arcList'), 'C10');
    assert.ok(data.includes('export function knowledgeList'), 'C11');
});

test('v249 C* 剧情线内核纯函数（五态归因 + 四块投影）', async () => {
    const m = await import(join(root, 'apps/plotline/plotline-data.js'));
    assert.equal(m.readPlotlineFace({ mounted: false }).reason, 'bridge-absent', 'C*1');
    assert.equal(m.readPlotlineFace({ mounted: true, hasSnapshot: false, snapshot: null }).reason, 'no-snapshot', 'C*2');
    assert.equal(m.readPlotlineFace({ mounted: true, hasSnapshot: true, snapshot: {} }).reason, 'no-plot-face', 'C*3');
    assert.equal(m.readPlotlineFace({ mounted: true, hasSnapshot: true, snapshot: { outline: { stage: {} }, worldProg: {} } }).reason, 'empty', 'C*4');
    const snap = {
        outline: { stage: { title: '初遇', goal: '建立信任', nodes: [{ title: '节点一', goal: 'g1' }] } },
        worldProg: {
            promises: [{ id: 'p1', character: '苏', deadlineFloor: 5, content: '周末一起吃饭', status: 'open' }],
            plotArcs: [{ id: 'a1', title: '旧友重逢', clue: '旧照片', status: 'active' }],
            knowledge: { '苏': { known: ['主角住钟楼'], unaware: ['主角的过去'] } }
        }
    };
    const ready = m.readPlotlineFace({ mounted: true, hasSnapshot: true, snapshot: snap });
    assert.equal(ready.reason, 'ready', 'C*5');
    const stage = m.outlineStage(ready.outline);
    assert.equal(stage.hasStage, true, 'C*6');
    assert.equal(stage.nodes.length, 1, 'C*7');
    const ps = m.promiseList(ready.worldProg);
    assert.equal(ps.length, 1, 'C*8');
    assert.equal(ps[0].deadline, '第5楼', 'C*9');
    const arcs = m.arcList(ready.worldProg);
    assert.equal(arcs[0].status, 'active', 'C*10');
    const kn = m.knowledgeList(ready.worldProg);
    assert.equal(kn.length, 1, 'C*11');
    assert.equal(kn[0].unaware.length, 1, 'C*12');
    const blk = m.plotlinePromptBlock(ready, { maxLines: 10 });
    assert.ok(blk.includes('初遇') && blk.includes('周末一起吃饭') && blk.includes('旧友重逢'), 'C*13');
    assert.equal(m.plotlinePromptBlock({ outline: null, worldProg: null }, {}), '', 'C*14');
    assert.doesNotThrow(() => m.outlineStage('bad'), 'C*15');
    assert.doesNotThrow(() => m.promiseList(null), 'C*16');
});

test('v249 D: 撩语×场景联动（纯函数 + 控制器 + 视图 + CSS）', () => {
    const data = read('apps/dirtytalk/dt-data.js');
    assert.ok(data.includes('export function sceneStyleHints'), 'D1');
    assert.ok(data.includes('SCENE_STYLE_MAP'), 'D2');
    const app = read('apps/dirtytalk/dirtytalk-app.js');
    assert.match(app, /sceneStyleHints\(\)\s*\{/, 'D3');
    assert.ok(app.includes("from '../place/place-data.js'"), 'D4 复用 place 唯一真源');
    const view = read('apps/dirtytalk/dt-view.js');
    assert.ok(view.includes('_sceneCard'), 'D5');
    const css = read('phone.css');
    assert.match(css, /\.dt-scene\s*\{/, 'D6');
    const dtCss = read('apps/dirtytalk/dt.css');
    assert.match(dtCss, /\.dt-scene\s*\{/, 'D7');
});

test('v249 D* 场景联动纯函数（不猜不编）', async () => {
    const m = await import(join(root, 'apps/dirtytalk/dt-data.js'));
    const a = m.sceneStyleHints(['老城', '酒店', '顶层']);
    assert.ok(a.styles.some((s) => s.name === '甜撩'), 'D*1 私密场所');
    const b = m.sceneStyleHints(['学校', '办公室']);
    assert.ok(b.styles.some((s) => s.name === '规训'), 'D*2 秩序场所');
    assert.deepEqual(m.sceneStyleHints([]).styles, [], 'D*3 无链空');
    assert.deepEqual(m.sceneStyleHints(null).styles, [], 'D*4 null 不抛');
    assert.deepEqual(m.sceneStyleHints(['某某山']).styles, [], 'D*5 未命中不编');
    const c = m.sceneStyleHints(['夜', '天台', '海边'], { max: 2 });
    assert.ok(c.styles.length <= 2, 'D*6 max 上限');
});

test('v249 E: 微信链路注入补 dt+cheat', () => {
    const cv = read('apps/wechat/chat-view.js');
    assert.match(cv, /\[v2\.49\.0\][\s\S]{0,300}?撩语\/金手指：微信链路走独立注入路径/, 'E1');
    assert.match(cv, /const _dtBlk = _vp\?\.dtApp\?\.promptBlock\?\.\(\);/, 'E2');
    assert.match(cv, /name: 'SYSTEM \(撩语\)'/, 'E3');
    assert.match(cv, /const _cheatBlk = _vp\?\.cheatApp\?\.promptBlock\?\.\(\);/, 'E4');
    assert.match(cv, /name: 'SYSTEM \(金手指\)'/, 'E5');
    assert.match(cv, /撩语\/金手指注入静默失败，不影响发送/, 'E6');
    const i = cv.indexOf('async buildMessagesArray');
    const j = cv.indexOf('lonsha 记忆注入静默失败');
    const k = cv.indexOf('SYSTEM (撩语)');
    assert.ok(i > 0 && j > i && k > j, 'E7 注入点位置正确');
});

test('v249 F: 三处 onChatChanged 接线（wallet/profile/plotline）', () => {
    const idx = read('index.js');
    for (const a of ['walletApp', 'profileApp', 'plotlineApp']) {
        const cnt = (idx.match(new RegExp(`window\\.VirtualPhone\\.${a}\\?\\.onChatChanged\\?\\.\\(\\)`, 'g')) || []).length;
        assert.equal(cnt, 3, `F-${a} 三处接入（实际 ${cnt}）`);
    }
    const rxInd = new RegExp('( *)window\\.VirtualPhone\\.dtApp\\?\\.onChatChanged\\?\\.\\(\\);\\n'
        + '( *)window\\.VirtualPhone\\.walletApp\\?\\.onChatChanged\\?\\.\\(\\);', 'g');
    const inds = [...idx.matchAll(rxInd)];
    assert.equal(inds.length, 3, 'F4 三处 dt→wallet 相邻');
    assert.ok(inds.every((mm) => mm[1].length === mm[2].length), 'F5 缩进一致');
    for (const key of ['clearCurrentData', 'clearAllData']) {
        assert.ok(new RegExp(`${key}[\\s\\S]{0,4000}walletApp\\?\\.onChatChanged\\?\\.\\(\\)`).test(idx), `F6 ${key} 接入`);
        assert.ok(new RegExp(`${key}[\\s\\S]{0,4000}plotlineApp\\?\\.onChatChanged\\?\\.\\(\\)`).test(idx), `F7 ${key} 末位接入`);
    }
});

test('v249 G: 版本同源 2.49.0', () => {
    const pkg = JSON.parse(read('package.json'));
    const manifest = JSON.parse(read('manifest.json'));
    const idx = read('index.js');
    const upd = JSON.parse(read('update-log.json'));
    assert.equal(pkg.version, '2.49.0', 'G1');
    assert.equal(manifest.version, '2.49.0', 'G2');
    assert.match(idx, /const ST_PHONE_VERSION = '2\.49\.0';/, 'G3');
    assert.equal(upd.latest, '2.49.0', 'G4');
    assert.ok(upd.versions['2.49.0'], 'G5');
    assert.ok(Array.isArray(upd.versions['2.49.0'].items) && upd.versions['2.49.0'].items.length >= 4, 'G6');
});
