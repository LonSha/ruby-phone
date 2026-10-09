/* ============================================================
 * tests/system-v3770.test.mjs — R-O6「长列表 / 面板重开 / 恢复」的判据面 [v3.76.0]
 * ------------------------------------------------------------
 * 本版（v3.76.0）治的是计划 R-O6 的第一层：**把「浏览器里大列表到底多重」变成读数**。
 *   验收原文四条：① 典型与极端数据都有 before/after 对比；② 保留选择态、滚动位置、键盘焦点；
 *   ③ 反复复开资源不增长；④ Node 拼串耗时不得写成浏览器帧耗时，目标设备读数未取得时保留证据缺口。
 *
 * 本套件守的四件事（每件都必须在**真代码**上成立，不看注释）：
 *   A 结构面：探针与首版基线同在，且基线的 `measured_at` 是**冻结的历史值**（抬版不得改写）；
 *   B 对账：探针在**镜像根**上跑出的计数段与真仓逐字节相同（位置无关），两次独立 spawn 也相同；
 *   C 行为面：探针自报的六条判据全绿，且「被跳过的楼」**不静默**（rendered + skipped === n）；
 *   D 负控制：对**真源码**做定点破坏后，相应当判据必须转红 —— 用镜像根跑，真仓零改动。
 *
 * 分工（免得后来者把两层的结论互相顶替）：
 *   · 本套件（Node 层）回答「渲染路径的规模与指令契约对不对」；
 *   · `tests/browser/scenarios/o6-longlist-perf.scen.js`（真 Chromium）回答
 *     「真排版引擎里现场丢不丢、账本涨不涨」—— 其**执行**归浏览器档
 *     （`node tests/browser/run-scenario.mjs …` / `node tests/browser/gate.mjs`），本套件只查它在场且判据面完整。
 *
 * 边界（诚实，四条）：
 *   · 读数**只登记不设阈值**的项：渲染耗时（Node 拼串，环境相关）、图片解码张数（容器几何相关）；
 *   · 未测目标设备：无真机，帧率/滚动流畅度本层与浏览器层都给不出；
 *   · 未测真实存储：夹具是内存数组，不造 IndexedDB / localStorage 压力；
 *   · 未做端到端浏览器验收：本版已在真 Chromium 上跑4 档视口，但那归浏览器档。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CV = 'apps/wechat/chat-view.js';
const PROBE = 'tests/audit/longlist_scale_probe.cjs';
const BASEF = 'tests/audit/longlist_scale_baseline.json';
const SCENE = 'tests/browser/scenarios/o6-longlist-perf.scen.js';
const SELF_REL = 'tests/system-v3770.test.mjs';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CV_SRC = read(CV);
const PROBE_SRC = read(PROBE);
const base = JSON.parse(read(BASEF));
/** 基线首测版：**冻结的历史值**（建基线时的当版），抬版不得改写 —— tests/system-v327 E1 同款纪律。 */
const FIRST_MEASURED_AT = 'v3.76.0';

/* -------------------- 工具 -------------------- */
const runProbe = (root) => {
    const args = [path.join(root, PROBE), '--json'];
    if (root !== ROOT) args.push('--root', root);
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000 });
    let parsed = null;
    try { parsed = JSON.parse(String(r.stdout || '')); } catch (_e) { parsed = null; }
    return { status: r.status, parsed, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
};
const runProbeAt = (probeAbs, root) => {
    const r = spawnSync(process.execPath, [probeAbs, '--json', '--root', root], { cwd: root, encoding: 'utf8', timeout: 180000 });
    let parsed = null;
    try { parsed = JSON.parse(String(r.stdout || '')); } catch (_e) { parsed = null; }
    return { status: r.status, parsed };
};

/**
 * 镜像根：**逐文件复制**（见 mirror() 里的来由 —— `cp -al` 在本仓的 proot
 * `--link2symlink` 容器里会反向改写被复制的源树，是被实测证伪的写法）。
 * 破坏写口因此不再需要「先断开硬链」：副本与真仓没有共享 inode，改写副本天然安全。
 */
let MIRROR = null;
/**
 * 镜像根 = **逐文件复制**，不是 `cp -al` 硬链接 —— 这条不是风格选择，是本版实测的根因修复。
 * ------------------------------------------------------------
 * 本仓的验证容器以 proot `--link2symlink` 运行：该模式下**任何硬链接创建
 * （`ln` / `cp -al`）都被模拟成「把**源文件**改名成 `.l2s.*` 别名，再在原名处放一个
 * 指向它的符号链接」**。于是 `cp -al ROOT/.` 会**反过来改写被复制的源树**：
 * 真仓的文件被改名成 `.l2s.*`、原名变成符号链接（扩展名随之丢失）。
 * 后果（全部实测过）：跑一次本套件就把**被测仓库自己**污染一次 ——
 *   · `node --test tests/*.test.mjs` 报 `ERR_UNKNOWN_FILE_EXTENSION: ".0001"`（模块名不再是 `.mjs`）；
 *   · `git status` 里真改动（`M apps/wechat/chat-view.js`）被「改名」吞掉，只剩下 `.l2s.*` 一堆 untracked；
 *   · 污染在每次运行后继续加深（目击四层嵌套）。
 * 这不是判据逻辑错，是**宿主的一个副作用**；但「建镜像根」这个动作由本套件发起，
 * 按本仓纪律就由本套件承担：改用逐文件 `copyFileSync`（普通写，不触发该模拟）。
 * 代价与边界：只复制**探针真正会读到的文件**（chat-view 的静态导入闭包 + manifest/package + 探针自身），
 * 不是整仓。两个负控制的破坏点（chat-view / manifest）都在其中，判据面不受影响；
 * 「换一个根仍跑出同一份读数」由 B2 证明 —— 那才是这条要证的东西。
 */
const MIRROR_FILES = [
    PROBE, 'manifest.json', 'package.json', CV,
    /* [v3.79.0 · 交棒] 动效面（L8）的输入面**由一份 phone.css 扩成全仓 CSS**：
     *   本版收口复核实测到探针原先只扫 phone.css，而全仓带 infinite 的动画共
     *   **21 处 / 19 个名字 / 7 张 CSS**，漏掉的 14 处恰好是「门全绿而动画照转」那一族。
     *   判据面扩了，镜像面就得跟着扩 —— 不扩 ⇒ 副本读数 css=1 而真仓 css=85，
     *   B2（位置无关）当场转红：那证明的是「两个根看到的不是同一件事」。 */
    ...allCssUnder(ROOT),
    'apps/wechat/chat-snapshot.js', 'apps/wechat/gift-catalog.js', 'apps/wechat/group-scheduler.js',
    'apps/wechat/voice-text.js', 'apps/wechat/wechat-data.js',
    'apps/honey/honey-app.js', 'apps/honey/honey-data.js',
    'apps/music/music-ambience.js', 'apps/music/music-app.js', 'apps/music/music-data.js', 'apps/music/music-view.js',
    'apps/settings/image-cropper.js',
    'apps/wangxiang/points.js', 'apps/wangxiang/wangxiang-app.js',
    'apps/wangxiang/wangxiang-task-parser.js', 'apps/wangxiang/wangxiang-view.js',
    'apps/weibo/weibo-app.js', 'apps/weibo/weibo-data.js', 'apps/weibo/weibo-view.js',
    'apps/games/catbox/catbox-data.js',
    'config/context-compose.js', 'config/context-settings.js', 'config/global-social-store.js',
    'config/image-mime.js', 'config/json-symbol-repair.js', 'config/knowledge-contract.js',
    'config/l0-assets.js', 'config/num-gate.js', 'config/phone-chat-memory.js', 'config/phone-emoji.js',
    'config/phone-events.js', 'config/points-engine.js', 'config/runtime-lifecycle.js',
    'config/session-gate.js', 'config/story-clock.js', 'config/tag-filter.js',
    'config/world-bridge.js', 'config/write-receipt.js',
];
/* [v3.79.0] 递归枚举全仓 .css —— 与 tests/audit/longlist_scale_probe.cjs 里那份**逐字同口径**
 *   （口径片段由本文件末的 D5 判据看守）。为什么两处各写一份而不上收：探针是 .cjs，
 *   套件是 .mjs，共享一个 .mjs 模块会让 .cjs 侧走不了 require；而镜像面比模块复用更
 *   要紧的是「两边枚举到的清单必须一样」，那就交给判据守，不靠人记得同步。 */
function allCssUnder(root) {
    const out = [];
    (function walk(dir, depth) {
        if (depth > 6) return;
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_e) { return; }
        for (const nm of names) {
            if (nm === 'node_modules' || nm === '.git') continue;
            const abs = path.join(dir, nm);
            let st = null;
            try { st = fs.statSync(abs); } catch (_e) { continue; }
            if (st.isDirectory()) walk(abs, depth + 1);
            else if (nm.slice(-4) === '.css') out.push(path.relative(root, abs));
        }
    })(root, 0);
    return out.sort();
}
function mirror(dirOverride) {
    if (dirOverride) return buildMirrorInto(dirOverride);
    if (MIRROR) return MIRROR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o6mirror-'));
    try {
        for (const rel of MIRROR_FILES) {
            const dst = path.join(dir, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(path.join(ROOT, rel), dst);
        }
    } catch (_e) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e2) { /* 忽略 */ }
        assert.fail('镜像根建不起来（逐文件复制失败）：' + String(_e && _e.message || _e).slice(0, 200));
    }
    MIRROR = dir;
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } });
    return MIRROR;
}
/** 定点破坏：写副本前先断开硬链，真仓文件不受影响。 */

/** [v3.79.0] 往指定目录铺一份镜像（与 mirror() 同一份清单；供需要的负控制拿**干净副本**）。
 *   为什么要有它：镜像根本身是**缓存**，先跑的负控制会把它破坏掉，后面的判据看到的是
 *   别人弄坏的那份（实测：D1~D3 破坏过 chat-view 之后，D5 读到 L1/L2/L6/L7 一并转红）。
 *   本仓纪律：负控制必须在它自己那份输入上取数。 */
function buildMirrorInto(dir) {
    for (const rel of MIRROR_FILES) {
        const dst = path.join(dir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } });
    return dir;
}
function breakFile(mirrorRoot, rel, mutator) {
    const abs = path.join(mirrorRoot, rel);
    const src = fs.readFileSync(abs, 'utf8');
    const next = mutator(src);
    if (next === src) assert.fail('破坏没有真正发生（锚点未命中）：' + rel);
    fs.rmSync(abs);
    fs.writeFileSync(abs, next);
    return abs;
}

/* ══════════════════ A 结构面 ══════════════════ */
test('v3770 A1. 探针与首版基线同在，且基线冻结在首测版（抬版不得改写）', () => {
    assert.ok(fs.existsSync(path.join(ROOT, PROBE)), '探针必须落盘：' + PROBE);
    assert.ok(fs.existsSync(path.join(ROOT, BASEF)), '基线必须落盘：' + BASEF);
    assert.equal(base.measured_at, FIRST_MEASURED_AT,
        '基线的 measured_at 是建基线时的**冻结历史值**，不随抬版漂移（实得 ' + base.measured_at + '）');
    assert.ok(Array.isArray(base.criteria) && base.criteria.length >= 5, '基线必须带判据段（实得 ' + (base.criteria || []).length + '）');
    assert.ok(base.readings && Object.keys(base.readings).length >= 8, '基线必须带读数组');
});

test('v3770 A2. 探针自带 fail-closed 与位置无关的 CLI 契约（不靠套件替它兜底）', () => {
    assert.ok(/--root/.test(PROBE_SRC), '必须支持 --root（位置无关）');
    assert.ok(/--json/.test(PROBE_SRC), '必须支持 --json（读数零手抄）');
    assert.ok(/process\.exit\(2\)/.test(PROBE_SRC) && /fail-closed/.test(PROBE_SRC),
        '读不到就必须 fail-closed（exit 2），不得发 0 合格证');
    assert.ok(/__dirname/.test(PROBE_SRC) && !/\/home\//.test(PROBE_SRC),
        '根不得写字面量绝对路径（位置无关）');
});

test('v3770 A3. 被否掉的候选路径必须留在探针里（不写下来 = 下一轮重走一遍）', () => {
    for (const token of ['content-visibility', '窗口化', 'loading=lazy']) {
        assert.ok(PROBE_SRC.includes(token), '候选路径的裁定必须在场：' + token);
    }
    assert.ok(Array.isArray(base.corrections) && base.corrections.length >= 3,
        '基线必须带 corrections（本版否掉两个候选、交付一个），实得 ' + (base.corrections || []).length);
});

test('v3770 A4. 交付的图片站点真带上懒加载与异步解码（两处），且不存在第二形态', () => {
    const msgSite = '<img src="${safeImageContent}" loading="lazy" decoding="async" class="message-image';
    assert.ok(CV_SRC.includes(msgSite), '消息图片站点必须带 loading/decoding');
    const bare = /<img src="\$\{safeImageContent\}"(?! loading=)/;
    assert.ok(!bare.test(CV_SRC), '不得存在不带懒加载的消息图片站点（漏改一处即回归）');
    assert.equal(base.readings.meta_n1500.lazy, base.readings.meta_n1500.imgs,
        '基线里 lazy 必须等于 imgs（改前实测两值均为 0）');
    assert.equal(base.readings.meta_n1500.asyncAttr, base.readings.meta_n1500.imgs);
});

test('v3770 A5. 浏览器层场景在场，且判据面覆盖 R-O6 四条验收', () => {
    assert.ok(fs.existsSync(path.join(ROOT, SCENE)), '真 Chromium 场景必须落盘：' + SCENE);
    const s = read(SCENE);
    for (const name of ['o6-longlist-scale', 'o6-media-lazy-contract', 'o6-reopen-20-ledger-stable', 'o6-restore-keeps-live-dom', 'o6-not-a-frame-time']) {
        assert.ok(s.includes(name), '场景缺读数：' + name);
    }
    assert.ok(/runtimeStats\(\)/.test(s), '复开面必须读**产品自己的**资源账本，不得用 DOM 节点数冒充');
    /* 「不是帧率」必须在读数里说清楚（R-O6 验收第 4 条），而不是只写在注释里。 */
    assert.ok(/不是\*\*帧率|\*\*不是\*\*帧率|不是\*\*帧率/.test(s), '必须把「本读数不是帧率」写进读数');
    assert.ok(!path.basename(SCENE).startsWith('_'), '交付场景不得用 `_` 前缀（那是取证探针，不进扫描面）');
});

/* ══════════════════ B 对账（位置无关 + 可复算） ══════════════════ */
test('v3770 B1. 真仓跑探针：计数段与首版基线逐字段相等', () => {
    const r = runProbe(ROOT);
    assert.equal(r.status, 0, '探针必须正常退出（stderr：' + r.stderr.slice(0, 200) + '）');
    assert.ok(r.parsed, '探针必须吐出 JSON');
    assert.deepEqual(r.parsed.readings, base.readings, '计数段与基线必须逐字段相等（环境相关的量不得混进计数段）');
});

test('v3770 B2. 位置无关：镜像根上跑出**同一份**计数段', () => {
    const m = mirror();
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 0, '镜像根上探针必须同样能跑（stderr 见下）：' + String(r.stderr || '').slice(0, 200));
    assert.ok(r.parsed, '镜像根上必须吐出 JSON');
    assert.deepEqual(r.parsed.readings, base.readings, '换个根就换读数 ⇒ 必是路径依赖，不是位置无关');
});

test('v3770 B3. 计数段在两次独立 spawn 之间逐字节一致（可复算）', () => {
    const a = runProbe(ROOT);
    const b = runProbe(ROOT);
    assert.ok(a.parsed && b.parsed);
    assert.equal(JSON.stringify(a.parsed.readings), JSON.stringify(b.parsed.readings),
        '同一夹具两次读数不一致 ⇒ 计数段混进了环境相关的量');
});

/* ══════════════════ C 行为面 ══════════════════ */
test('v3770 C1. 探针八条判据全绿（L1~L8，v3.79.0 起为八条）（verdict 是字符串而不是 inconclusive 对象）', () => {
    const r = runProbe(ROOT);
    assert.ok(r.parsed);
    assert.ok(Array.isArray(r.parsed.criteria) && r.parsed.criteria.length >= 8, '判据数不足（v3.79.0 起为 L1~L8 八条，实得 ' + (r.parsed.criteria || []).length + '）');
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id);
    assert.deepEqual(failed, [], '未通过：' + failed.join(','));
    assert.equal(typeof r.parsed.verdict, 'string', '判据全绿时 verdict 必须是结论文本：' + JSON.stringify(r.parsed.verdict));
});

test('v3770 C2. 「被跳过的楼」不静默：rendered + skipped === n（三档 500/1500/4000 都要成立）', () => {
    for (const n of [1500, 500, 4000]) {
        const tag = 'n' + n;
        const rendered = base.readings['rendered_lines_' + tag];
        const skipped = base.readings['stub_skipped_lines_' + tag];
        assert.equal(typeof rendered, 'number', '必须登记真渲染了多少楼：' + tag);
        assert.equal(typeof skipped, 'number', '必须登记跳过了多少楼：' + tag);
        assert.equal(rendered + skipped, n, tag + ' 的 rendered+skipped 必须等于总楼数');
        assert.ok(rendered > 0, tag + ' 必须真渲染出东西');
    }
    assert.ok(base.readings.stub_skipped_lines_n1500 > 0, '本层确实测不到文本楼，该数字必须如实吐出来');
});

test('v3770 C3. 单条消息的 DOM 代价不随会话长度漂移（这是「路径多重」的读数）', () => {
    const a = base.readings.divs_per_msg_n1500;
    const b = base.readings.divs_per_msg_n500;
    const c4 = base.readings.divs_per_msg_n4000;
    assert.ok(a > 0 && b > 0 && c4 > 0, '三档都必须有读数（典型 500/1500 + 极端 4000）');
    assert.ok(Math.abs(a - b) / b <= 0.10, '漂移超过 10% ⇒ 渲染路径变了：' + a + ' vs ' + b);
    assert.ok(Math.abs(c4 - b) / b <= 0.10, '极端档漂移超过 10% ⇒ 渲染路径随规模变了：' + c4 + ' vs ' + b);
});

test('v3770 C4. 身份面完整：每条真渲染出来的消息都带 data-message-id', () => {
    const n = base.readings.meta_n1500;
    assert.equal(n.ids, n.imgs, '身份面与渲染条数必须一致（选择态/定位/跳转全靠它）');
    assert.ok(n.divs > n.imgs, '每楼不止一个 div（divs 少于消息数即渲染被截断）');
});

/* ══════════════════ D 真源码定点破坏（负控制） ══════════════════ */
let cachedMirror = null;
const mirrorFor = () => { cachedMirror = cachedMirror || mirror(); return cachedMirror; };

test('v3770 D1. 摘掉消息图片的懒加载 ⇒ L1/L2/L7 必须转红，且不得带红 L3~L6（定点性）', () => {
    const m = mirrorFor();
    breakFile(m, CV, (s) => {
        const anchor = '<img src="${safeImageContent}" loading="lazy" decoding="async"';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '<img src="${safeImageContent}"');
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 0);
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id).sort();
    /* [v3.79.0 · 交棒改写（判据面，不是放宽）] 断言的**对象**从「只红 L1/L2」改成
     *   「L1/L2 必红，且**同族的** L7（极端档的同一契约）也必红」。理由：同一处懒加载缺陷
     *   会被两个夹具各读到一次，而 L7 存在的意义正是「不许只有典型档被查」——
     *   把它排除在射程外，就等于给覆盖面开了个只在负控制里看的洞。
     *   定点性判据改为「L3–L6 一律不得被这处破坏带红」（它们与媒体指令无关）。 */
    assert.ok(failed.includes('L1') && failed.includes('L2'), '摘掉懒加载必须让 L1/L2 转红，实得：' + failed.join(','));
    assert.ok(failed.includes('L7'), '同一契约在极端档上必须同样转红（覆盖面不许只在典型档成立），实得：' + failed.join(','));
    for (const id of ['L3', 'L4', 'L5', 'L6']) {
        assert.ok(!failed.includes(id), id + ' 与媒体指令无关，不得被这处破坏带红（定点性）：' + failed.join(','));
    }
});

test('v3770 D2. 摘掉全部懒加载（两处） ⇒ 媒体指令契约回归失败', () => {
    const m = mirrorFor();
    breakFile(m, CV, (s) => {
        const before = s;
        s = s.split(' loading="lazy" decoding="async"').join('');
        assert.ok(s !== before, '锚点未命中');
        return s;
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id).sort();
    assert.ok(failed.includes('L1') && failed.includes('L2'), '全摘后 L1/L2 必红，实得：' + failed.join(','));
});

test('v3770 D3. 把时间分隔条改成每楼一条 ⇒ L6 必须转红', () => {
    const m = mirrorFor();
    breakFile(m, CV, (s) => {
        const anchor = 'msgTimestamp - lastRenderedTimestamp >= 3 * 60 * 1000';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'msgTimestamp - lastRenderedTimestamp >= 0');
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    const failed = r.parsed.criteria.filter((c) => !c.pass).map((c) => c.id);
    assert.ok(failed.includes('L6'), '每楼一条分隔条必须让 L6 转红，实得：' + failed.join(',') || '(none)');
});

test('v3770 D5. 真源码破坏 phone.css 的装饰类覆盖 ⇒ L8（按动画名）必须点名转红', () => {
    /* 破坏三件事之一：删掉一行覆盖选择器。判据面是 L8 的「按动画名判定装饰类被覆盖」，
     *   故要求它转红**并点名那个动画**（按名判定才可能点名；计数判定只能说不等）。 */
    /* 要一份**干净**的镜像根：共享那份已被前面的负控制破坏过（见 buildMirrorInto 注释）。 */
    const m = fs.mkdtempSync(path.join(os.tmpdir(), 'o6l8-'));
    buildMirrorInto(m);
    breakFile(m, 'phone.css', (src) => {
        const anchor = 'html[data-still="1"] .honey-goto-live-btn,' + String.fromCharCode(10);
        assert.equal(src.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return src.replace(anchor, '');
    });
    const r = runProbeAt(path.join(m, PROBE), m);
    /* 本探针的出口契约：0 = 跑到底（判据结果在 criteria 里）、2 = fail-closed 拒判。' +
     *   它**不会**为「某条判据没过」而 exit 1（初版这里写 1 是把采样器的契约搬错了）。 */
    assert.equal(r.status, 0, '破坏后探针仍须跑到底（实得 ' + r.status + '，2 意味着镜像里读不到输入面）');
    assert.ok(r.parsed, '破坏后仍须吐 JSON（否则是崩溃而不是判据响）');
    const l8 = (r.parsed.criteria || []).filter((c) => c.id === 'L8')[0];
    assert.ok(l8 && l8.pass === false, 'L8（全仓按名覆盖）必须转红');
    assert.ok(String(l8.got).indexOf('honeyFollowPulse') >= 0, '必须**点名**那个没被覆盖的动画：' + String(l8.got).slice(0, 260));
    const others = (r.parsed.criteria || []).filter((c) => !c.pass).map((c) => c.id);
    assert.deepEqual(others, ['L8'], '定点性：其余判据不得被这处破坏带红，实得：' + others.join(','));
});
test('v3770 D4. 删掉 manifest.version ⇒ 探针 fail-closed（exit 2，不得发 0 合格证）', () => {
    const m = mirrorFor();
    breakFile(m, 'manifest.json', () => JSON.stringify({ name: 'ruby-phone' }, null, 2) + String.fromCharCode(10));
    const r = runProbeAt(path.join(m, PROBE), m);
    assert.equal(r.status, 2, '读不到版本必须 exit 2（实得 ' + r.status + '）');
    assert.equal(r.parsed, null, 'fail-closed 时不得吐出任何「合格」读数');
});

/* ══════════════════ D8 动效面（L8）的负控制与面一致性 [v3.79.0] ══════════════════ */
/* ★ 次序有讲究：D5 用共享镜像根（mirrorFor 是**缓存**），而 D4 会把 manifest.version' +
 *   删掉让后续探针 fail-closed —— 故 D5 必须排在 D4 **之前**（这是实测出来的，不是摆好看的）。 */
/* 为什么这两条归本套件而不归 v3790：L8 是**本探针**的判据，它的镜像根要求 chat-view 的
 *   完整输入闭包 —— 本套件的镜像清单正是那份闭包（v3790 的没有）。负控制必须在它真正
 *   运行的那个环境里做，否则「破坏后转红」证明不了任何事。 */


test('v3770 D6. 两处「全仓 CSS 枚举」口径一致（探针内联那份 vs 本套件镜像面那份）', () => {
    /* 同一件事写两遍，就必须有一处判据看守它们不分叉 —— 否则任一边改了深度上限
     *   或后缀判定，另一边的取数面会静默缩水（本仓治过的形态）。 */
    const marks = ['if (depth > 6) return;', "nm.slice(-4) === '.css'",
        "if (nm === 'node_modules' || nm === '.git') continue;"];
    for (const mk of marks) {
        assert.ok(PROBE_SRC.includes(mk), '探针内联枚举缺口径片段：' + mk);
        assert.ok(read(SELF_REL).includes(mk), '镜像面枚举缺口径片段：' + mk);
    }
    assert.ok(read(SELF_REL).includes('...allCssUnder(ROOT),'), '镜像清单必须真的铺上全仓 CSS（不是定义了没人用）');
    assert.ok(PROBE_SRC.includes('const cssFiles = [];'), '探针必须真的枚举全仓 CSS');
    /* 面下限 + 两边同清单：空面 = 「0 命中」与「干净」同形。 */
    const r = runProbe(ROOT);
    const got = r.parsed.readings.after_motion_css;
    assert.ok(got.css_files_scanned > 0, '扫描面不得为空');
    assert.equal(got.css_files_scanned, allCssUnder(ROOT).length, '两处枚举必须得到同一份清单');
});

/* ══════════════════ F 版本锚（下限形） ══════════════════ */
test('v3770 F1. 版本锚（下限形）：三处同源且不低于 3.76.0', () => {
    const VNUM = (v) => String(v).split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    assert.equal(man.version, pkg.version, 'manifest / package 必须同源');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同源');
    assert.ok(VNUM(man.version) >= VNUM('3.76.0'), '本套件自 3.76.0 起成立；当前 ' + man.version);
});
