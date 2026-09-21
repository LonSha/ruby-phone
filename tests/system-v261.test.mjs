/**
 * system-v261.test.mjs — v2.61.0 资产 App（引擎接到桌面）
 *
 * 引擎已零转录锁定；本套件钉 App 层消费契约：
 *   A 剧情日 → ISO（拿不到 / isReal / 古历 一律空串）
 *   B 四态归因
 *   C 公开层投影无阿拉伯数字 + due 落账走 appendFlow
 *   F 四处注册 / 词从 terms / 零宿主依赖 / CSS
 *   G 版本锚定 2.61.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

import {
    ASSET_REASONS,
    defaultAssetSettings,
    categoryIds,
    uiTermsOf,
    storyTimeToIso,
    eraFromStoryTime,
    readAssetFace,
    projectAssetPanel,
    assetPromptBlock,
    applyDueFlows
} from '../apps/asset/asset-data.js';
import core from '../apps/asset/engine/asset-core.js';
import settlement from '../apps/asset/engine/asset-settlement.js';
import storeApi from '../apps/asset/engine/asset-store.js';

function memHost(bag) {
    const b = bag || {};
    return {
        getVariables() { return b; },
        insertOrAssignVariables(p) { Object.assign(b, p); return true; },
        updateVariablesWith(fn) {
            const next = typeof fn === 'function' ? fn(b) : b;
            if (next && typeof next === 'object') {
                for (const k of Object.keys(b)) delete b[k];
                Object.assign(b, next);
            }
            return true;
        }
    };
}

// ============================================================
// A. 剧情日 → ISO
// ============================================================
test('A1 中文公历 date 转 ISO', () => {
    assert.equal(storyTimeToIso({ date: '2044年10月28日' }), '2044-10-28');
    assert.equal(storyTimeToIso({ calendarDate: '2026年01月02日' }), '2026-01-02');
});

test('A2 year/month/day 分字段优先', () => {
    assert.equal(storyTimeToIso({ year: '2026', month: '3', day: '9', date: '2044年10月28日' }), '2026-03-09');
});

test('A3 isReal / isDefault / 古历 / 缺字段 → 空串（不读系统时钟）', () => {
    assert.equal(storyTimeToIso({ date: '2044年10月28日', isReal: true }), '');
    assert.equal(storyTimeToIso({ date: '2044年10月28日', isDefault: true }), '');
    assert.equal(storyTimeToIso({ date: '大明永乐二年三月初一', isAncient: true, year: '1404', month: '3', day: '1' }), '');
    assert.equal(storyTimeToIso(null), '');
    assert.equal(storyTimeToIso({}), '');
});

test('A4 eraFromStoryTime：古历走 ancient，其余回落', () => {
    assert.equal(eraFromStoryTime({ isAncient: true }, 'modern'), 'ancient');
    assert.equal(eraFromStoryTime({ date: '2044年10月28日' }, 'xianxia'), 'modern');
    assert.equal(eraFromStoryTime(null, 'xianxia'), 'xianxia');
});

test('A5 today 缺失时 planSettlement 不产 due', () => {
    const plan = settlement.planSettlement({ actors: {} }, { today: '', lastAt: '2026-01-01', era: 'modern' });
    assert.equal(plan.skipped, true);
    assert.equal(plan.due.length, 0);
    assert.ok(typeof plan.reason === 'string');
});

// ============================================================
// B. 四态归因
// ============================================================
test('B1 未引导 / 已关 / 空账 / 就绪分开报', () => {
    assert.equal(readAssetFace({}).reason, ASSET_REASONS.off);
    assert.equal(readAssetFace({ hasConfig: false }).reason, ASSET_REASONS.off);
    assert.equal(readAssetFace({ hasConfig: true, enabled: false }).reason, ASSET_REASONS.disabled);
    assert.equal(readAssetFace({ hasConfig: true, enabled: true, ledger: { actors: {} } }).reason, ASSET_REASONS.empty);
    const ready = readAssetFace({
        hasConfig: true, enabled: true,
        ledger: { actors: { 甲: { entries: [{ cat: 'liquid' }], flows: [] } } }
    });
    assert.equal(ready.reason, ASSET_REASONS.ready);
});

test('B2 默认设置含注入开关与结算水位', () => {
    const s = defaultAssetSettings();
    assert.equal(s.injectToPrompt, true);
    assert.equal(s.lastSettleAt, '');
    assert.ok(s.sourceState && typeof s.sourceState === 'object');
});

test('B3 store.isEnabled 是启用唯一出口', () => {
    const bag = {};
    const st = storeApi.createAssetStore({ host: memHost(bag) });
    assert.equal(st.hasConfig(), false);
    assert.equal(st.isEnabled(), false);
    assert.equal(st.writeConfig({ onboarded: true, enabledCategories: categoryIds() }), true);
    assert.equal(st.hasConfig(), true);
    assert.equal(st.isEnabled(), true);
});

// ============================================================
// C. 投影 / 注入 / 落账
// ============================================================
function sampleLedger() {
    const item = core.createEntry({
        id: 'ae_1',
        cat: 'liquid',
        label: '手头',
        ownerKey: '甲',
        state: { 存银: 3200 },
        template: (core.BUILTIN_CATEGORIES || []).filter((c) => c.id === 'liquid')[0]
    });
    return { actors: { 甲: { entries: [item], flows: [] } } };
}

test('C1 公开层投影无阿拉伯数字，量级词来自引擎', () => {
    const ledger = sampleLedger();
    const proj = projectAssetPanel(ledger, { era: 'modern', names: { 甲: '甲' } });
    assert.equal(proj.rows.length, 1);
    assert.ok(proj.rows[0].publicText.length > 0, '公开层有正文');
    assert.equal(/[0-9]/.test(proj.rows[0].publicText), false, '公开层不得含阿拉伯数字：' + proj.rows[0].publicText);
    assert.ok(proj.rows[0].worth && Number.isFinite(proj.rows[0].worth.net), '净值走 sumNetWorth');
});

test('C2 注入块空账回空串；就绪时走词表标题且无阿拉伯数字', () => {
    assert.equal(assetPromptBlock(null), '');
    assert.equal(assetPromptBlock({ actors: {} }), '');
    const block = assetPromptBlock(sampleLedger(), { era: 'modern', names: { 甲: '甲' } });
    assert.ok(block.startsWith('【'), block);
    assert.ok(block.includes(uiTermsOf('modern').assetTab), '标题走词表');
    const body = block.split('\n').slice(1).join('\n');
    assert.equal(/[0-9]/.test(body), false, '注入正文无阿拉伯数字：' + body);
});

test('C3 applyDueFlows 把 due 交给 appendFlow，入参账本不改', () => {
    const ledger = sampleLedger();
    const snap = JSON.stringify(ledger);
    const due = [{ actorKey: '甲', reason: '周期进账到点', at: '2026-02-01', direction: 'in', amount: 10, kind: 'cashflow' }];
    const r = applyDueFlows(ledger, due, '2026-02-01');
    assert.equal(JSON.stringify(ledger), snap, '入参不改');
    assert.equal(r.applied.length, 1);
    assert.equal(r.blocked.length, 0);
    assert.ok(r.ledger.actors['甲'].flows.length >= 1, '流水落在副本上');
});

test('C4 today 空串不落账', () => {
    const ledger = sampleLedger();
    const due = [{ actorKey: '甲', reason: '周期进账到点', direction: 'in', amount: 10, kind: 'cashflow' }];
    const r = applyDueFlows(ledger, due, '');
    assert.ok(r.blocked.length >= 1 || r.applied.length === 0);
});

// ============================================================
// F. 源码不变量
// ============================================================
test('F1 四处注册：apps / index 路由 / REBIND / storage / 微信 / CSS', () => {
    const apps = read('config/apps.js');
    assert.ok(/id: 'asset'/.test(apps), 'apps.js 缺 asset');
    assert.ok(apps.includes('#34d399'), '主色 #34d399');
    const idx = read('index.js');
    assert.ok(idx.includes("appId === 'asset'"), 'index 缺路由');
    assert.ok(idx.includes("window.VirtualPhone.assetApp = new module.AssetApp"), '单例构造');
    assert.ok(idx.includes("'assetApp'"), 'REBIND 含 assetApp');
    const st = read('config/storage.js');
    assert.ok(st.includes('/^asset_/'), '会话键 asset_');
    assert.ok(st.includes('/^__la_asset_/'), '会话键 __la_asset_');
    const wx = read('apps/wechat/chat-view.js');
    assert.ok(wx.includes('_vp.assetApp'), '微信注入表');
    assert.ok(read('phone.css').includes('.as-root'), 'phone.css 含 .as-root');
    assert.ok(read('apps/asset/asset.css').includes('.as-root'), '源 CSS 含 .as-root');
});

test('F2 视图消费词表键，不硬编码现代腔类目名', () => {
    const src = read('apps/asset/asset-view.js');
    assert.ok(src.includes("from './asset-data.js'"), 'import data');
    assert.ok(src.includes('uiTermsOf'), '消费 uiTermsOf');
    assert.ok(src.includes('categoryWordsOf'), '消费 categoryWordsOf');
    assert.ok(src.includes("tw(T, 'assetTab')"), '标题走词表');
    assert.ok(src.includes("tw(T, 'onboardStart')"), '开始按钮走词表');
    assert.equal(src.includes('流动资金'), false, '不得硬编码流动资金');
    assert.equal(src.includes('总资产'), false, '不得硬编码总资产');
});

test('F3 data 零宿主依赖 + App 消费闭环', () => {
    const data = read('apps/asset/asset-data.js');
    for (const bad of ['window.', 'document.', 'localStorage', 'fetch(', 'SillyTavern', 'Date.now']) {
        assert.ok(!data.includes(bad), 'data 不得包含 ' + bad);
    }
    const app = read('apps/asset/asset-app.js');
    assert.ok(app.includes('createAssetStore'), 'store 工厂');
    assert.ok(app.includes('planSettlement'), '结算口');
    assert.ok(app.includes('advanceMarket'), '行情口');
    assert.ok(app.includes('renderAssetText') || read('apps/asset/asset-data.js').includes('renderAssetText'), '投影口');
    assert.ok(app.includes('onChatChanged'), '换会话');
    assert.ok(app.includes('GENERATE_BEFORE_COMBINE_PROMPTS'), '主链路钩子');
    assert.ok(app.includes('promptBlock'), '注入块');
});

test('F4 CSS 落点三档归因 + 主色', () => {
    const src = read('apps/asset/asset.css');
    assert.ok(src.includes('.as-reason-ok'));
    assert.ok(src.includes('.as-reason-warn'));
    assert.ok(src.includes('.as-reason-off'));
    assert.ok(src.includes('#34d399'));
});

test('F5 引擎血缘注释仍在（零转录未改）', () => {
    const coreSrc = read('apps/asset/engine/asset-core.js');
    assert.ok(coreSrc.includes('LA-0.7.68'));
    assert.ok(coreSrc.includes('零转录'));
});

// ============================================================
// G. 版本锚定
// ============================================================
test('G1 版本四源同源（动态跟随）', () => {
    const idx = read('index.js');
    const m = idx.match(/ST_PHONE_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
    assert.ok(m, 'index.js 定义 ST_PHONE_VERSION');
    const v = m[1];
    assert.equal(JSON.parse(read('manifest.json')).version, v);
    assert.equal(JSON.parse(read('package.json')).version, v);
    const log = JSON.parse(read('update-log.json'));
    assert.equal(log.latest, v);
    assert.ok(Object.prototype.hasOwnProperty.call(log.versions, v));
});

test('G2 2.61.0 条目记录资产 App 接线', () => {
    const log = JSON.parse(read('update-log.json'));
    assert.ok(log.versions['2.61.0'], '缺 2.61.0 条目');
    const items = log.versions['2.61.0'].items.join('\n');
    assert.ok(items.includes('资产'), '条目提及资产');
    assert.ok(items.includes('planSettlement') || items.includes('结算'), '条目提及结算');
    assert.ok(items.includes('钱袋'), '条目写明与钱袋分工');
});

test('G3 旧锚点 2.60.0 仍保留', () => {
    const log = JSON.parse(read('update-log.json'));
    assert.ok(log.versions['2.60.0']);
    assert.ok(log.versions['2.60.0'].items.join('\n').includes('起名') || log.versions['2.60.0'].items.join('\n').includes('手术'));
});
