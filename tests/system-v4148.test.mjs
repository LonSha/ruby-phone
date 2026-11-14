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
    assert.equal(findEv('phone:goHome').emit, 35);
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

test('A4 debt 与 zeroUse 落真仓实值', () => {
    assert.deepEqual(READING.debt, ['phone:pet-statechange', 'phone:motionResume',
        'phone:viewBack', 'phone:canonAdopt', 'phone:causalSource']);
    assert.deepEqual(READING.zeroUse, []);
    for (const d of READING.debt) {
        const r = findEv(d);
        assert.ok(r.emit > 0 && r.on === 0, d + ' 必须是 emit>0 且 on=0');
    }
});

/* ══════════════ B. 台账 fail-closed ══════════════ */
test('B1 五条欠账每条有写实理由（≥20 字、非套话）', () => {
    assert.equal(Object.keys(READING.debtLedger).length, READING.debt.length,
        '台账条数与 debt 同源');
    for (const [k, v] of Object.entries(READING.debtLedger)) {
        assert.ok(READING.debt.includes(k), '台账键 ' + k + ' 必须在 debt 里（不许挂空账）');
        assert.ok(typeof v === 'string' && v.length >= 20, k + ' 理由 ≥20 字');
        assert.ok(!/^(暂留|待定|TODO|以后再说)/.test(v), k + ' 不许套话搪塞');
        assert.ok(/[：;，；]|承接|遥测|API|owner|兜底|同步/.test(v), k + ' 理由必须含实证要素');
    }
});

test('B2 台账落审计工具真代码面（fail-closed 不是注释自述）', () => {
    assert.ok(toolSrc.includes('const DEBT_LEDGER = Object.freeze'), '台账常量在工具真代码面');
    assert.ok(toolSrc.includes('process.exit(2)'), '无理由欠账 exit 2 拒判');
    assert.ok(toolSrc.includes('先实证再落账'), '拒判话术锚在');
    for (const d of READING.debt) {
        assert.ok(toolSrc.includes("'" + d + "'"), '台账键 ' + d + ' 逐字在工具源码');
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

/* ══════════════ D. 负控制：真删真源 ⇒ 读数必变且 fail-closed 转红 ══════════════
 * 靶点：phone:albumImageDeleted（emit 1 / on 1）——删掉唯一订阅行
 * （apps/album/album-app.js:43），重扫读数必须 debt 5→6 且新欠账无台账理由
 * ⇒ 工具 exit 2 拒判。一石二鸟：既证扫描器活着，又证 fail-closed 活着。 */
test('D1 真删唯一订阅行 ⇒ 重扫 debt 5→6 且 exit 2 拒判', () => {
    const target = path.join(ROOT, 'apps', 'album', 'album-app.js');
    const orig = fs.readFileSync(target, 'utf8');
    const SENTINEL = "window.addEventListener(PHONE_EVENTS.ALBUM_IMAGE_DELETED, this._onImageDeleted);";
    const hits = orig.split(SENTINEL).length - 1;
    assert.equal(hits, 1, '靶点订阅行必须恰 1 处（真删真源，不许误伤）');
    assert.ok(READING.events.find((e) => e.event === 'phone:albumImageDeleted').on === 1,
        '前置：albumImageDeleted 当前 on=1');
    try {
        fs.writeFileSync(target, orig.replace(SENTINEL + '\n', ''));
        /* 重扫（不带 --write，不污染盘上读数）：必须 exit 2 且点名新欠账。 */
        let out = '', code = 0, err = '';
        try {
            out = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL)],
                { encoding: 'utf8' });
        } catch (e) {
            code = e.status;
            out = (e.stdout || '').toString();
            err = (e.stderr || '').toString();
        }
        assert.equal(code, 2, 'fail-closed 必须拒判，实得 exit ' + code);
        const joined = out + err;
        assert.ok(joined.includes('phone:albumImageDeleted'), '拒判必须点名新欠账');
        assert.ok(joined.includes('无台账理由'), '拒判话术必须说明原因');
    } finally {
        fs.writeFileSync(target, orig, 'utf8');
    }
    /* 原版对照：恢复后真跑必须 exit 0 且 debt 仍 5 条。 */
    const out2 = execFileSync(process.execPath, [path.join(ROOT, TOOL_REL)], { encoding: 'utf8' });
    assert.ok(out2.includes('欠账 5 条'), '恢复后 debt 仍 5 条：' + out2.trim());
});

test('D2 反向对照：台账多挂一条非欠账键也必须被 B1 同款判据抓住', () => {
    /* 台账键必须在 debt 里 —— 多挂空账同样拒判，判据不是只查「少」不查「多」。
     * 假账键取真实契约事件（albumImageDeleted，on=1 不在欠账）：既让 B1 判定转红，
     * 又不在仓内留下契约外事件名字面量（v226 对账①扫全仓，占位符会污染它）。 */
    const fake = { ...READING.debtLedger, 'phone:albumImageDeleted': '假账：这条事件有订阅、不在欠账里，台账不许挂它' };
    let caught = 0;
    for (const [k, v] of Object.entries(fake)) {
        if (!READING.debt.includes(k)) caught++;
    }
    assert.equal(caught, 1, '假账键必须被同款判定抓住');
});

/* ══════════════ E. 版本锚（下限形） ══════════════ */
test('E1 版本锚：读数 version 与 package.json 同源', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(READING.version, pkg.version, '读数 version 必须与 package.json 同源');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});