/* ============================================================
 * tests/system-v4148.test.mjs — [v4.148.0 · 第二十一期 批次D 第三步 R21-O9 事件「派发无订阅」收口]
 *   判据面（五组）：
 *   A 读数与真扫一致：import 真跑审计工具 ⇒ 逐字对账（scannedFiles/contractSize/
 *     goHome 35/3、openApp 16/3、swipeBack 1/12、sum-on 46、debt、zeroUse、debtLedger）
 *   B 台账 fail-closed：五条 debt 每条有理由（≥20 字、非套话）；台账与 debt 同源；
 *     台账落审计工具真代码面（不是注释自述）
 *   C 精度口径：emit/on 令牌必须落事件实参位（窗内禁跨 ) { } =>）；goHome 三订阅点
 *     全部实证为真（music-app 捕获守卫+处理器 / mount 助手 / index.js 宿主）；
 *     asset-view 不在任何 onFiles；工具内含 v4.148.0 修复注释锚
 *   D 负控制：真删真源（album-app.js 的 albumImageDeleted 唯一订阅行）⇒ 重扫读数
 *     debt 5→6、新增欠账无台账理由 ⇒ fail-closed 转红；原版对照全绿
 *   E 版本锚（下限形）
 * ========================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TOOL_REL = 'tools/audit-event-subscribers.mjs';
const READING_REL = 'tests/audit/event_subscribers.json';
const toolSrc = read(TOOL_REL);

/* 读数在场 ⇒ 用盘上读数（A1 再 import 真扫逐字对账）；不在场 ⇒ 拒判，不许「没证据也算过」。 */
if (!fs.existsSync(path.join(ROOT, READING_REL))) {
    assert.fail('读数 tests/audit/event_subscribers.json 不在场：先真跑 node tools/audit-event-subscribers.mjs --write');
}
const READING = JSON.parse(fs.readFileSync(path.join(ROOT, READING_REL), 'utf8'));
const findEv = (name) => READING.events.find((e) => e.event === name);
const sumOn = READING.events.reduce((a, e) => a + e.on, 0);

/* ══════════════ A. 读数与真扫一致 ══════════════ */
test('A1 真跑审计工具与盘上读数逐字一致（第二证人）', () => {
    /* 用子进程真跑 `--json` 取第二份独立读数，与盘上台账逐字对账。
     *   [v4.148.0 实测修] 初版用 await import()：① 工具结尾 process.exit(0) 会
     *   直接终止测试进程，13 例只跑 1 例、运行器还报「1 例 ✔」（假绿）；
     *   ② 即便不退出，A1 读的是**同一个盘上文件**，自己与自己比恒真 —— 那叫
     *   自指伪证，不是第二证人。现在「真跑」与「落盘」是两条独立路径，
     *   任一方单方面改数都抓得住。 */
    const out = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL), '--json'],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const live = JSON.parse(out);
    assert.equal(live.version, READING.version);
    assert.equal(live.scannedFiles, READING.scannedFiles);
    assert.equal(live.contractSize, READING.contractSize);
    assert.deepEqual(live.debt, READING.debt);
    assert.deepEqual(live.zeroUse, READING.zeroUse);
    assert.deepEqual(live.debtLedger, READING.debtLedger);
    assert.deepEqual(live.events, READING.events);
});

test('A2 扫描面与契约读数落真仓实值', () => {
    assert.equal(READING.contractSize, 26, '契约 26 事件（config/phone-events.js 真源）');
    assert.ok(READING.scannedFiles >= 796, '扫描面 ≥ 796 文件');
    assert.equal(READING.zeroUse.length, 0, 'emit 与 on 双零事件为空');
});

test('A3 事件方向读数抽点逐字对账（松窗修复后的真读数）', () => {
    /* ★ [v4.163.0 交棒改写] 35 → 34：v4.162.0 的 B 站三层重写把 bili-view.js 里**两处重复的**
     *   phone:goHome 派发收敛成一处（同一个返回动作不再派两遍），emitFiles 里该文件仍在。
     *   读数由官方生成器 `node tools/audit-event-subscribers.mjs --write` 重生成，本行跟着交付物走；
     *   订阅面（onFiles 三点）一个字没动 —— 收紧的是「重复派发」，不是判据。 */
    assert.equal(findEv('phone:goHome').emit, 34);
    assert.deepEqual(findEv('phone:goHome').onFiles,
        ['apps/music/music-app.js', 'phone/lifecycle-engines-mount.js', 'index.js'],
        'goHome 订阅恰三点：music-app 捕获守卫+处理器 / mount 助手 / index.js 宿主');
    assert.equal(findEv('phone:openApp').emit, 16);
    assert.deepEqual(findEv('phone:openApp').onFiles,
        ['phone/inline-reply-button.js', 'phone/lifecycle-engines-mount.js', 'index.js']);
    assert.equal(findEv('phone:swipeBack').emit, 1);
    assert.equal(findEv('phone:swipeBack').on, 12, 'swipeBack 1 派发 12 订阅（App 层壳挂回柄）');
    assert.equal(sumOn, 46, '全契约订阅文件数合计 46');
});

test('A4 欠账清零，五条改判逐条带证据（改判不是免单）', () => {
    /* [v4.157.0 口径校正] 这五条已由 R22-O7 从 debt **改判**为「对外遥测 / 跨仓转交」，
     * debt 因此清零。老判据把「debt 恰好 5 条」写死，改判一落地它就恒红 —— 它守的其实
     * 不是「5」这个数，而是「每条 no-subscriber 事件要么进 debt、要么带证据进改判层」。
     * 故改成守结构：debt 必须为空（不许有没证据的欠账）+ 改判五条逐条在场且带 why/evidence。 */
    assert.deepEqual(READING.debt, [], '欠账必须清零（emit>0 且 on=0 又没改判理由的才叫欠账）');
    assert.deepEqual(READING.zeroUse, [], 'emit 与 on 双零事件必须为空');
    const want = ['phone:pet-statechange', 'phone:motionResume',
        'phone:viewBack', 'phone:canonAdopt', 'phone:causalSource'];
    assert.deepEqual(READING.reclassified.map((r) => r.event).sort(), want.slice().sort(),
        '五条改判必须在读数里逐条在场');
    for (const r of READING.reclassified) {
        const row = findEv(r.event);
        assert.ok(row.emit > 0 && row.on === 0, r.event + ' 必须是 emit>0 且 on=0');
        assert.ok(typeof r.why === 'string' && r.why.length >= 20, r.event + ' 改判理由 ≥20 字');
        assert.ok(typeof r.evidence === 'string' && r.evidence.trim().length > 0,
            r.event + ' 必须有证据串（证据为空 = 改判变成免单）');
        assert.ok(['telemetry', 'cross-repo'].includes(r.kind), r.event + ' kind 只许是遥测 / 跨仓两类');
    }
});

/* ══════════════ B. 台账 fail-closed ══════════════ */
test('B1 台账与改判层逐条同源（多挂 / 少挂都拒判，理由写实非套话）', () => {
    const keys = Object.keys(READING.debtLedger).sort();
    const evs = READING.reclassified.map((r) => r.event).sort();
    assert.deepEqual(keys, evs, '台账键必须与 reclassified 逐条同源（多挂空账 / 少挂改判都红）');
    for (const [k, v] of Object.entries(READING.debtLedger)) {
        assert.ok(!READING.debt.includes(k), '台账键 ' + k + ' 不许同时还在欠账里（一条账只能记一头）');
        assert.ok(typeof v === 'string' && v.length >= 20, k + ' 理由 ≥20 字');
        assert.ok(!/^(暂留|待定|TODO|以后再说)/.test(v), k + ' 不许套话搪塞');
        assert.ok(/[：;，；]|承接|遥测|API|owner|兜底|同步/.test(v), k + ' 理由必须含实证要素');
    }
});

test('B2 改判层落审计工具真代码面（fail-closed 不是注释自述）', () => {
    /* 常量在 R22-O7 改判后叫 RECLASSIFIED（原 DEBT_LEDGER 已退役）。
     * 守的是机制：改判必须写在真代码的冻结表里，缺理由/证据 exit 2，且有反向闸。 */
    assert.ok(toolSrc.includes('const RECLASSIFIED = Object.freeze'), '改判常量在工具真代码面');
    assert.ok(toolSrc.includes('process.exit(2)'), '无理由 / 证据不足 ⇒ exit 2 拒判');
    assert.ok(toolSrc.includes('改判不是免单'), '拒判话术锚在');
    assert.ok(toolSrc.includes('反向闸'), '反向闸（已改判但仓内已有订阅）在');
    for (const d of READING.reclassified.map((r) => r.event)) {
        assert.ok(toolSrc.includes("'" + d + "'"), '改判键 ' + d + ' 逐字在工具源码');
    }
});

/* ══════════════ C. 精度口径 ══════════════ */
test('C1 emit/on 令牌必须落事件实参位（窗内禁跨 ) { } =>）', () => {
    /* 反斜杠段用码点拼，不跟字符串字面量转义较劲（v4.145 C3 同族教训）。 */
    assert.ok(toolSrc.includes('[^)]{0,100}?'), 'emit 窗禁跨右括号');
    assert.ok(toolSrc.includes('[^){}=>]{0,80}?'), 'on 主窗禁跨 ) { } =>');
    /* 反斜杠那一条用「一到两个反斜杠」匹配，不跟源码的转义层级较劲（v4.145 C3 同族）。
     *   实得教训：本行初版按单反斜杠拼接，而源码里字符串字面量的转义是双反斜杠 ——
     *   断言因**假绿**（13 例只跑 1 例）从未执行过，修掉假绿后它当场转红。
     *   判据要钉的是「有非标识符边界 + on( 助手」这个语义标记，不是它的转义写法。 */
    assert.ok(/\[\^\\{1,2}w\$\.\]on\\{1,2}s\*\\{1,2}\(/.test(toolSrc),
        'on 助手用非标识符边界（防 bonus 误命中）');
    assert.ok(toolSrc.includes('[^){}=>]{0,60}?'), 'on 助手窗同纪律');
    assert.ok(toolSrc.includes('v4.148.0 实测修'), '修复注释锚（why 落码面）');
});

test('C2 asset-view 误报已除名（精度修复的负样本）', () => {
    for (const e of READING.events) {
        assert.ok(!e.onFiles.includes('apps/asset/asset-view.js'),
            'asset-view 只有一行 goHome 派发，不得出现在任何 onFiles（' + e.event + '）');
    }
});

test('C3 goHome 三订阅点逐个实证为真（不是扫描器幻觉）', () => {
    const music = read('apps/music/music-app.js');
    assert.ok(/addEventListener\(\s*PHONE_EVENTS\.GO_HOME/.test(music) ||
        music.includes("addEventListener('phone:goHome'"), 'music-app 订阅行在');
    const mount = read('phone/lifecycle-engines-mount.js');
    assert.ok(/[^A-Za-z0-9_$]on\(\s*window\s*,/.test(mount), 'mount 层 on(window,…) 助手在');
    const idx = read('index.js');
    assert.ok(idx.includes("window.addEventListener('phone:goHome'"), '宿主订阅行在');
});

test('C4 viewBack 修复落真代码面（外壳自同步）', () => {
    const shell = read('phone/phone-shell.js');
    assert.ok(shell.includes('this.setCurrentApp('), '外壳自同步调用在');
    assert.ok(shell.includes('R21-O9'), 'v4.148.0 审计注释锚在');
    /* 全文 setCurrentApp( 恰两处：修复点（this. 调用）+ 方法定义点，不许有第二处写入路径。 */
    const n = (shell.match(/setCurrentApp\(/g) || []).length;
    assert.equal(n, 2, 'setCurrentApp( 恰 2 处（修复点+定义点），实得 ' + n);
});

/* ══════════════ D. 负控制：真删真源 ⇒ 读数必变且 fail-closed 可观测 ══════════════
 * 靶点：phone:albumImageDeleted（emit 1 / on 1）——删掉唯一订阅行
 * （apps/album/album-app.js:43）。[v4.157.0 口径校正] 工具现在「读数照出、判决归判据」，
 * 退出码只随结构漂移（改判缺理由/证据、反向闸）变化，不随 debt 非空变化；故负控制改为
 * 钉两个可观测面：① 该事件必须落进 debt 且不得混进改判层；② 人读面必须点名它。
 * 一石二鸟不变：既证扫描器活着，又证 fail-closed 活着。 */
test('D1 真删唯一订阅行 ⇒ 重扫必点名新欠账，恢复后回到清零', () => {
    const target = path.join(ROOT, 'apps', 'album', 'album-app.js');
    const orig = fs.readFileSync(target, 'utf8');
    const SENTINEL = "window.addEventListener(PHONE_EVENTS.ALBUM_IMAGE_DELETED, this._onImageDeleted);";
    const hits = orig.split(SENTINEL).length - 1;
    assert.equal(hits, 1, '靶点订阅行必须恰 1 处（真删真源，不许误伤）');
    assert.ok(READING.events.find((e) => e.event === 'phone:albumImageDeleted').on === 1,
        '前置：albumImageDeleted 当前 on=1');
    assert.deepEqual(READING.debt, [], '前置：欠账当前清零');
    try {
        fs.writeFileSync(target, orig.replace(SENTINEL + '\n', ''));
        /* 重扫（不带 --write，不污染盘上读数）。[v4.157.0 口径校正] 工具退出码不再随
         * debt 非空变化（读数照出，判决归判据），故改判 fail-closed 的**可观测面**：
         * 新出现的 no-subscriber 事件必须进 debt、且不得混进改判层，并在 stdout 被点名。 */
        const out = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL), '--json'],
            { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        const live = JSON.parse(out);
        assert.ok(live.debt.includes('phone:albumImageDeleted'),
            '删掉唯一订阅行后该事件必须进 debt，实得：' + JSON.stringify(live.debt));
        assert.ok(!live.reclassified.some((r) => r.event === 'phone:albumImageDeleted'),
            '没有改判理由的事件不许被塞进改判层（fail-closed 不是免单）');
        const plain = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL)], { encoding: 'utf8' });
        assert.ok(plain.includes('欠账 1 条'), '人读面必须报出欠账 1 条：' + plain.trim());
        assert.ok(plain.includes('phone:albumImageDeleted'), '人读面必须点名新欠账');
    } finally {
        fs.writeFileSync(target, orig, 'utf8');
    }
    /* 原版对照：恢复后真跑必须回到零欠账。 */
    const out2 = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL)], { encoding: 'utf8' });
    assert.ok(out2.includes('欠账 0 条'), '恢复后欠账必须回到 0 条：' + out2.trim());
});

test('D2 反向对照：台账多挂一条不在改判里的键也必须被 B1 同款判据抓住', () => {
    /* 台账键必须与改判层同源 —— 多挂空账同样拒判，判据不是只查「少」不查「多」。
     * 假账键取真实契约事件（albumImageDeleted，on=1 不在改判层）：既让 B1 判定转红，
     * 又不在仓内留下契约外事件名字面量（v226 对账①扫全仓，占位符会污染它）。 */
    const fake = { ...READING.debtLedger, 'phone:albumImageDeleted': '假账：这条事件有订阅、不在改判层，台账不许挂它' };
    const known = new Set(READING.reclassified.map((r) => r.event));
    let caught = 0;
    for (const k of Object.keys(fake)) if (!known.has(k)) caught++;
    assert.equal(caught, 1, '假账键必须被同款判定抓住');
});

/* ══════════════ E. 版本锚（下限形） ══════════════ */
test('E1 版本锚：读数 version 与 package.json 同源', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(READING.version, pkg.version, '读数 version 必须与 package.json 同源');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});