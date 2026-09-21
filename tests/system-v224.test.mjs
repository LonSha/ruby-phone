/* ============================================================
 * [v2.24.0] 懒加载单例 App 换会话重绑（第二批）回归测试。
 * ------------------------------------------------------------
 * 背景（v2.23 同源方向，遗漏项）：
 *   bilibili / theater 两个 App 同样是懒加载单例
 *   （index.js: `if (!window.VirtualPhone.bilibiliApp) new BiliApp(...)`），
 *   构造期 new BiliData/TheaterData 从会话键（bili_entries_v1 /
 *   theater_stories_v1）把数据载入实例内存，_load 只在构造器执行一次。
 *   换会话后实例被复用：读取端（view.render）展示旧会话条目/剧本，
 *   写入端把旧会话数据写回新会话键。
 *   修复：两 App 新增 onChatChanged() 重建数据层；index.js 在换会话
 *   （onChatChanged）与两处清数据（clearCurrentData / clearAllData）
 *   三处接入（与 v2.18/v2.19/v2.21/v2.23 同构）。
 *
 * 注意：两 App 构造器无全局监听器，但沿用 v2.21/v2.23「保留实例、仅重建
 *   数据层」模板（View 经 this.app.data 动态引用），保持一致、避免回归。
 *
 * 分工：真实数据层（BiliData/TheaterData）+ 会话路由内存 storage
 *       （按会话分桶）+ 接线断言。不硬编码版本号。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};

const { BiliData } = await import('../apps/bilibili/bili-data.js');
const { TheaterData } = await import('../apps/theater/theater-data.js');

// 会话路由内存 storage：按会话分桶（模拟 chatMetadata 会话隔离）。
function makeEnv(bucketKey) {
    const buckets = {};
    let session = bucketKey;
    return {
        buckets,
        setSession(s) { session = s; },
        storage: {
            get(k, dflt = null) { const b = buckets[session] || {}; return (k in b) ? b[k] : dflt; },
            set(k, v) { (buckets[session] = buckets[session] || {})[k] = v; }
        }
    };
}

// ========== 1. bilibili：条目隔离 ==========
{
    const env = makeEnv('A');
    env.storage.set('bili_entries_v1', { query: 'A词', summary: 'A会话摘要', entries: [{ id: 'e_A', title: 'A会话条目' }] });
    const dX = new BiliData(env.storage);
    ok('bili: 构造期载入当前会话条目', dX.entries.some(e => e.id === 'e_A'));
    ok('bili: 构造期载入 query/summary', dX.query === 'A词' && dX.summary === 'A会话摘要');
    ok('bili: 使用会话键 bili_entries_v1', dX.storageKey === 'bili_entries_v1');

    env.setSession('B');
    env.storage.set('bili_entries_v1', { query: 'B词', summary: 'B会话摘要', entries: [{ id: 'e_B', title: 'B会话条目' }] });
    const dY = new BiliData(env.storage); // 模拟 onChatChanged 重建数据层
    ok('bili: 重建后读到新会话条目（不串味）',
        dY.entries.some(e => e.id === 'e_B') && !dY.entries.some(e => e.id === 'e_A'),
        JSON.stringify(dY.entries.map(e => e.id)));
    ok('bili: 重建后 query/summary 属新会话',
        dY.query === 'B词' && dY.summary === 'B会话摘要');
    ok('bili: 旧数据层实例保留旧会话数据（隔离性）', dX.entries.some(e => e.id === 'e_A'));
}
{
    // 空会话：新会话无存档 → 空条目（不回落旧会话）
    const env = makeEnv('A');
    env.storage.set('bili_entries_v1', { entries: [{ id: 'e_A' }] });
    new BiliData(env.storage);
    env.setSession('EMPTY');
    const dEmpty = new BiliData(env.storage);
    ok('bili: 新会话无存档时为空（不回落旧会话）',
        dEmpty.entries.length === 0 && !dEmpty.entries.some(e => e.id === 'e_A'),
        JSON.stringify(dEmpty.entries));
}

// ========== 2. theater：剧本/草稿隔离 ==========
{
    const env = makeEnv('A');
    env.storage.set('theater_stories_v1', { stories: [{ id: 's_A', title: 'A会话剧本' }], draft: { theme: 'A主题' } });
    const tX = new TheaterData(env.storage);
    ok('theater: 构造期载入当前会话剧本', tX.stories.some(s => s.id === 's_A'));
    ok('theater: 构造期载入草稿主题', tX.draft.theme === 'A主题');
    ok('theater: 使用会话键 theater_stories_v1', tX.storageKey === 'theater_stories_v1');

    env.setSession('B');
    env.storage.set('theater_stories_v1', { stories: [{ id: 's_B', title: 'B会话剧本' }], draft: { theme: 'B主题' } });
    const tY = new TheaterData(env.storage);
    ok('theater: 重建后读到新会话剧本（不串味）',
        tY.stories.some(s => s.id === 's_B') && !tY.stories.some(s => s.id === 's_A'),
        JSON.stringify(tY.stories.map(s => s.id)));
    ok('theater: 重建后草稿属新会话', tY.draft.theme === 'B主题');
    ok('theater: 旧数据层实例保留旧会话数据（隔离性）', tX.stories.some(s => s.id === 's_A'));
}
{
    // 空会话：新会话无存档 → 默认草稿、空剧本
    const env = makeEnv('A');
    env.storage.set('theater_stories_v1', { stories: [{ id: 's_A' }], draft: { theme: 'A主题' } });
    new TheaterData(env.storage);
    env.setSession('EMPTY');
    const tEmpty = new TheaterData(env.storage);
    ok('theater: 新会话无存档时为空剧本（不回落旧会话）',
        tEmpty.stories.length === 0 && tEmpty.draft.theme === '',
        JSON.stringify({ n: tEmpty.stories.length, theme: tEmpty.draft.theme }));
}

// ========== 3. 接线断言：两 App 定义 onChatChanged 且重建数据层 ==========
{
    const expect = {
        'apps/bilibili/bili-app.js': 'this.data = new BiliData(this.storage);',
        'apps/theater/theater-app.js': 'this.data = new TheaterData(this.storage);',
    };
    for (const [file, needle] of Object.entries(expect)) {
        const src = fs.readFileSync(path.join(root, file), 'utf8');
        ok(`${file}: 定义 onChatChanged`, /onChatChanged\s*\(\s*\)\s*\{/.test(src));
        ok(`${file}: onChatChanged 内重建数据层`, src.includes(needle));
        ok(`${file}: 保留实例（未在 onChatChanged 中置 null 自身）`,
            !/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,200}window\.VirtualPhone\.\w+App\s*=\s*null/.test(src));
        ok(`${file}: 构造器仍持有 View 引用（this.app.data 动态引用成立）`,
            /this\.view = new \w+View\(this\)/.test(src));
    }
    // View 侧经 this.app.data 动态引用（重建数据层后自动指向新数据层）
    const bview = fs.readFileSync(path.join(root, 'apps/bilibili/bili-view.js'), 'utf8');
    ok('bili-view: 经 this.app.data 动态引用', /this\.app\.data/.test(bview));
    const tview = fs.readFileSync(path.join(root, 'apps/theater/theater-view.js'), 'utf8');
    ok('theater-view: 经 this.app.data 动态引用', /this\.app\.data/.test(tview));
}

// ========== 4. 接线断言：index.js 三处接入（换会话 + 两处清数据） ==========
{
    const isrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    for (const a of ['bilibiliApp', 'theaterApp']) {
        const _tbl = (isrc.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
        ok(`index.js: ${a} 在懒加载重绑表（P1/P2/P3 单一真源）`, _tbl.includes(`'${a}'`));
        ok('index.js: rebindLazyApps() 三处接入（换会话/清当前/清全部）',
            (isrc.match(/rebindLazyApps\(\);/g) || []).length === 3);
    }
    // 换会话接入点位于 onChatChanged 清理块内（wechatApp=null 之前）
    ok('index.js: 换会话路径接入（rebindLazyApps 在 wechatApp=null 之前）',
        /rebindLazyApps\(\);\s*\n\s*window\.VirtualPhone\.wechatApp = null;/.test(isrc));
    const _tblB = (isrc.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    ok('index.js: 重绑表含 bilibili/theater（两 App 共用同一入口）',
        _tblB.includes("'bilibiliApp'") && _tblB.includes("'theaterApp'"));
    // 清数据路径接入
    ok('index.js: clearCurrentData 路径接入',
        /clearCurrentData[\s\S]{0,3500}rebindLazyApps\(\);/.test(isrc));
    ok('index.js: clearAllData 路径接入',
        /clearAllData[\s\S]{0,3500}rebindLazyApps\(\);/.test(isrc));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;