/* ============================================================
 * [v2.23.0] 懒加载单例 App 换会话重绑 回归测试。
 * ------------------------------------------------------------
 * 背景（与 v2.21 worldpulse 同源的实例级会话状态缺陷）：
 *   tieba / xhs / gacha / reading / tarot / health / achievement /
 *   playbook 八个 App 均为懒加载单例（index.js: `if (!window.VirtualPhone
 *   .xxxApp) new XxxApp(...)`），构造期从会话键把数据载入实例内存，且
 *   load 只在构造器执行一次。换会话后实例被复用，内存数据仍属旧会话：
 *   - 读取端（render/统计/注入）展示旧会话数据；
 *   - 写入端（addNote/addPost/unlock/saveState）把旧会话数据写回新会话键；
 *   - tarot 的 buildInjection 会把旧会话牌面注入新会话 prompt。
 *   修复：各 App 新增 onChatChanged()（重建数据层从新会话键重新载入；
 *   tarot 清空内存态后重载），index.js 在换会话（onChatChanged）与两处
 *   清数据（clearCurrentData / clearAllData）三处接入。
 *
 * 注意（v2.21 教训）：tieba/xhs/health/playbook 构造器注册了常驻全局监听器
 *   （eventSource.on / window.addEventListener），故采用「保留实例、仅重建
 *   数据层」方案，而非置 null 重建——后者会累积监听器泄漏。
 *
 * 分工：真实数据层（TiebaData/XhsData/GachaData/ReadingData/AchievementData）
 *       + 会话路由内存 storage（按会话分桶）+ 接线断言（8 App 方法存在、
 *       三处接入、实例保留、数据层重建、tarot 内存态清空）。
 *       不硬编码版本号。
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

const { TiebaData } = await import('../apps/tieba/tieba-data.js');
const { XhsData } = await import('../apps/xhs/xhs-data.js');
const { GachaData } = await import('../apps/gacha/gacha-data.js');
const { ReadingData } = await import('../apps/reading/reading-data.js');
const { AchievementData } = await import('../apps/achievement/achievement-data.js');

// 会话路由内存 storage：按 bucketKey 分桶（模拟 chatMetadata 会话隔离）。
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

// ========== 1. tieba：X 会话写入 → 换到 Y 会话 → 数据层重载不串味 ==========
{
    const env = makeEnv('A');
    env.storage.set('ruby_tieba_posts', [{ id: 'p_A', title: 'A会话的帖子' }]);
    const dataX = new TiebaData(env.storage);
    ok('tieba: 构造期载入当前会话数据', dataX.posts.some(p => p.id === 'p_A'));
    ok('tieba: 构造器提供了 loadPosts 方法', typeof dataX.loadPosts === 'function');

    env.setSession('B');
    env.storage.set('ruby_tieba_posts', [{ id: 'p_B', title: 'B会话的帖子' }]);
    // 模拟 onChatChanged：重建数据层
    const dataY = new TiebaData(env.storage);
    ok('tieba: 重建后读到新会话数据（不串味）',
        dataY.posts.some(p => p.id === 'p_B') && !dataY.posts.some(p => p.id === 'p_A'),
        JSON.stringify(dataY.posts.map(p => p.id)));
    ok('tieba: 旧数据层实例保留旧会话数据（隔离性）', dataX.posts.some(p => p.id === 'p_A'));
}
{
    // 空会话：新会话无存档 → 用默认帖（不回落到旧会话）
    const env = makeEnv('A');
    env.storage.set('ruby_tieba_posts', [{ id: 'p_A', title: 'A会话的帖子' }]);
    new TiebaData(env.storage);
    env.setSession('EMPTY');
    const dataEmpty = new TiebaData(env.storage);
    ok('tieba: 新会话无存档时用默认数据（不回落旧会话）',
        !dataEmpty.posts.some(p => p.id === 'p_A'));
}

// ========== 2. xhs：笔记隔离 ==========
{
    const env = makeEnv('A');
    env.storage.set('ruby_xhs_notes', [{ id: 'n_A', title: 'A会话笔记' }]);
    const dX = new XhsData(env.storage);
    ok('xhs: 构造期载入当前会话笔记', dX.notes.some(n => n.id === 'n_A'));
    env.setSession('B');
    env.storage.set('ruby_xhs_notes', [{ id: 'n_B', title: 'B会话笔记' }]);
    const dY = new XhsData(env.storage);
    ok('xhs: 重建后读到新会话笔记（不串味）',
        dY.notes.some(n => n.id === 'n_B') && !dY.notes.some(n => n.id === 'n_A'));
}

// ========== 3. gacha：幸运币/库存/记录隔离 ==========
{
    const env = makeEnv('A');
    env.storage.set('ruby_gacha_state', JSON.stringify({ coins: 777, inventory: { item_A: 3 }, history: [{ at: 1 }], pullCount: 5 }));
    const gX = new GachaData(env.storage);
    ok('gacha: 构造期载入当前会话状态', gX.coins === 777 && gX.inventory.item_A === 3);
    env.setSession('B');
    const gY = new GachaData(env.storage); // B 无存档 → 初始赠送 1000
    ok('gacha: 重建后为新会话初始态（不被旧会话污染）',
        gY.coins === 1000 && !gY.inventory.item_A && gY.pullCount === 0, JSON.stringify({ c: gY.coins, inv: gY.inventory }));
}

// ========== 4. reading：书架隔离 ==========
{
    const env = makeEnv('A');
    env.storage.set('ruby_reading_shelf', JSON.stringify([{ id: 'b_A', title: 'A会话的书' }]));
    const rX = new ReadingData(env.storage);
    ok('reading: 构造期载入当前会话书架', rX.shelf.some(b => b.id === 'b_A'));
    env.setSession('B');
    env.storage.set('ruby_reading_shelf', JSON.stringify([{ id: 'b_B', title: 'B会话的书' }]));
    const rY = new ReadingData(env.storage);
    ok('reading: 重建后读到新会话书架（不串味）',
        rY.shelf.some(b => b.id === 'b_B') && !rY.shelf.some(b => b.id === 'b_A'));
}

// ========== 5. achievement：解锁清单隔离（构造器同时 loadState） ==========
{
    const env = makeEnv('A');
    env.storage.set('ruby_unlocked_achievements', { ach_1: 111 });
    const aX = new AchievementData(env.storage);
    ok('achievement: 构造期载入当前会话解锁清单', aX.unlockedMap.has('ach_1'));
    env.setSession('B');
    env.storage.set('ruby_unlocked_achievements', { ach_2: 222 });
    const aY = new AchievementData(env.storage);
    ok('achievement: 重建后读到新会话解锁清单（不串味）',
        aY.unlockedMap.has('ach_2') && !aY.unlockedMap.has('ach_1'),
        JSON.stringify([...aY.unlockedMap.keys()]));
}

// ========== 6. 接线断言：8 个 App 定义 onChatChanged 且重建数据层 ==========
{
    const expect = {
        'apps/tieba/tieba-app.js': 'this.data = new TiebaData(this.storage);',
        'apps/xhs/xhs-app.js': 'this.data = new XhsData(this.storage);',
        'apps/gacha/gacha-app.js': 'this.data = new GachaData(this.storage);',
        'apps/reading/reading-app.js': 'this.data = new ReadingData(this.storage);',
        'apps/health/health-app.js': 'this.data = new HealthData(this.storage);',
        'apps/achievement/achievement-app.js': 'this.data = new AchievementData(this.storage);',
        'apps/playbook/playbook-app.js': 'this.data = new PlaybookData(this.storage);',
    };
    for (const [file, needle] of Object.entries(expect)) {
        const src = fs.readFileSync(path.join(root, file), 'utf8');
        ok(`${file}: 定义 onChatChanged`, /onChatChanged\s*\(\s*\)\s*\{/.test(src));
        ok(`${file}: onChatChanged 内重建数据层`, src.includes(needle));
        // 关键：方法体在 render 之外，且不置 null 自身（避免监听器累积）
        ok(`${file}: 保留实例（未在 onChatChanged 中置 null）`,
            !/onChatChanged\s*\(\s*\)\s*\{[\s\S]{0,200}window\.VirtualPhone\.\w+App\s*=\s*null/.test(src));
    }
    // tarot 无 data 类：清空内存态 + 重载
    const tarot = fs.readFileSync(path.join(root, 'apps/tarot/tarot-app.js'), 'utf8');
    ok('tarot: 定义 onChatChanged', /onChatChanged\s*\(\s*\)\s*\{/.test(tarot));
    ok('tarot: onChatChanged 清空内存态并重载',
        /onChatChanged[\s\S]{0,220}this\.history = \[\][\s\S]{0,120}this\.currentDraw = null[\s\S]{0,120}this\._load\(\)/.test(tarot));
}

// ========== 7. 接线断言：index.js 三处接入（换会话 + 两处清数据） ==========
{
    const isrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const apps = ['tiebaApp', 'xhsApp', 'gachaApp', 'readingApp', 'tarotApp', 'healthApp', 'achievementApp', 'playbookApp'];
    for (const a of apps) {
        const _tbl = (isrc.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
        ok(`index.js: ${a} 在懒加载重绑表（P1/P2/P3 单一真源）`, _tbl.includes(`'${a}'`));
        ok('index.js: rebindLazyApps() 三处接入（换会话/清当前/清全部）',
            (isrc.match(/rebindLazyApps\(\);/g) || []).length === 3);
    }
    // 换会话接入点位于 onChatChanged 清理块内
    // [v2.47.0] 判据由「tieba→wechatApp=null 的字符距离 <=800」改为**区间成员核对**：
    //   距离式判据在清理块里每新增一个 App 就会误报（本版新增 cheatApp 后实测 865/946/943 > 800 = 假红），
    //   而它本来要守的是「这些重绑调用真的落在换会话清理块内、且在 wechatApp = null 之前」。
    const chatFrom = isrc.indexOf('彻底清空微信单例缓存');
    const chatTo = isrc.indexOf('window.VirtualPhone.wechatApp = null;', chatFrom);
    const chatBlock = (chatFrom >= 0 && chatTo > chatFrom) ? isrc.slice(chatFrom, chatTo) : '';
    ok('index.js: 换会话清理块含 rebindLazyApps()（wechatApp = null 之前）',
        chatFrom >= 0 && chatTo > chatFrom && chatBlock.includes('rebindLazyApps();'),
        `block=${chatBlock.length}`);
    const _tbl2 = (isrc.match(/ST_PHONE_REBIND_APP_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
    const rebindApps = ['tiebaApp', 'xhsApp', 'gachaApp', 'readingApp', 'tarotApp', 'healthApp',
        'achievementApp', 'playbookApp', 'bilibiliApp', 'theaterApp', 'placeApp', 'cheatApp'];
    const rebindMissing = rebindApps.filter((a) => !_tbl2.includes(`'${a}'`));
    ok('index.js: 重绑表覆盖 v2.23/v2.24/v2.46/v2.47 全部 App', rebindMissing.length === 0, rebindMissing.join(','));
    // 清数据路径接入
    ok('index.js: clearCurrentData 路径接入',
        /clearCurrentData[\s\S]{0,3000}rebindLazyApps\(\);/.test(isrc));
    ok('index.js: clearAllData 路径接入',
        /clearAllData[\s\S]{0,3000}rebindLazyApps\(\);/.test(isrc));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;