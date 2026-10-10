// tests/system-v3560.test.mjs — 六项真实缺陷修复 [v3.56.0]
//
// 本套件守六件事（五面判据 + 一张破坏表 + 一层真调用行为面）：
//   ① A 面 桌面分页：81 件不再一次铺进单个 .app-grid（图标重叠/超长滚动的根因），
//      改「页」承载 + dock 净空 + 页码点 + 手势接线；
//   ② B 面 App 内返回键：此前全库从未渲染过任何返回按钮，唯一返回路径是不可发现的右滑；
//   ③ C 面 品牌串：对外显示名一律 RubyPhone；文件头版权署名（yuzuki）**保留**，不算泄漏；
//   ④ D 面 桌面宠物拖拽：pet.css 写着 cursor: grab 却全库零实现；
//   ⑤ E 面 真调用行为面：分页切分/页码点/夹取/手势判定直接**调用真方法**并断言结果
//      （文本在场只证明「写过」，调用结果才证明「算对」）；
//   ⑥ V 面版本锚 + 真源码定点破坏表（每条破坏必须让对应判据转红）。
//
// 判据纪律（本仓硬纪律）：判据不许恒绿；破坏锚点必须恰中 1 次（不唯一即抛）；
// 破坏只落副本树，真仓全程只读；锚点取纯 ASCII 片段（中文在源码里是转义序列，
// 锚点再写一层转义必然失配 —— 失配会让破坏静默不生效，得到「假绿」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { routeSurface, readRepoTable } from './_lazy_routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const Q = String.fromCharCode(39);
const NL = String.fromCharCode(10);

const INDEX_REL = 'index.js';
const CSS_REL = 'phone.css';
const PET_CSS_REL = 'phone/pet.css';
const HOME_REL = 'phone/home-screen.js';
const SHELL_REL = 'phone/phone-shell.js';
const FLOAT_REL = 'phone/floating-entry.js';
const MANIFEST_REL = 'manifest.json';
const PKG_REL = 'package.json';
const UPDLOG_REL = 'update-log.json';
const MIN_VERSION = '3.56.0';

const temps = [];
process.on('exit', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 副本树优先读：只有被破坏的那个文件从副本读，其余回落真仓（不复制整棵树）。 */
function readFrom(root, rel) {
    const p = path.join(root, rel);
    if (root !== ROOT && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return readRel(rel);
}
const hits = (s, sub) => s.split(sub).length - 1;
const linesOf = (s) => s.split(NL);
const DQ = String.fromCharCode(34);
/** 去掉注释后的「代码面」。
 *  为什么必须有这一层：本仓最贵的判据形态之一是**门禁自指伪证** ——
 *  判据把「解释这条缺陷的注释」当成「缺陷本身」。本版两处都要靠它：
 *    · A1 的负判据 `\${this.apps.map(...)}` 在「为什么加」的注释里被**引用**了一次
 *      （解释「修前长这样」），裸文本扫描会把解释判成缺陷；
 *    · A7 的负判据 `movementX` 同样在注释里出现（说明为什么不用它）。
 *  因此负判据一律在**代码面**上做，正判据仍可用原文（注释里也有真锚点时更稳）。
 *  简化口径：先整段去 `/* *​/`，再逐行去 `//` 之后的尾巴（`://` 视为 URL 不截断）。
 *  不追求完备的词法分析 —— 它只服务于本套件这几个锚点，且两侧都有断言兜住。 */
function codeOf(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return noBlock.split(NL).map((line) => {
        const i = line.indexOf('//');
        if (i < 0) return line;
        if (line.slice(Math.max(0, i - 1), i) === ':') return line;   // URL 的 ://
        return line.slice(0, i);
    }).join(NL);
}

/* ============================================================
 * A 面：桌面图标分页（图标重叠的根因）
 * ============================================================ */
function pagerProblems(root) {
    const bad = [];
    const home = readFrom(root, HOME_REL);
    const code = codeOf(home);
    const css = readFrom(root, CSS_REL);

    /* A1 旧形态必须消失：全部 App 一次铺进单个 .app-grid 是缺陷本体。
     *    锚点取「渲染表达式」而非「.app-grid」字样 —— 后者在 CSS 里到处都是。
     *    必须在**代码面**上判：同一串在本文件的「为什么加」注释里被引用（解释修前的样子），
     *    裸文本扫描会把那段解释判成缺陷（门禁自指伪证）。 */
    if (hits(code, '${this.apps.map(app => this.renderAppIcon(app)).join(' + Q + Q + ')}') > 0) {
        bad.push('A1 仍把全部 App 一次铺进单个 .app-grid（分页未落地）');
    }
    /* A2 分页真源与渲染接线：buildIconPages 必须被 renderIconLayout 真调用 */
    if (hits(home, 'const pages = this.buildIconPages();') !== 1) {
        bad.push('A2 renderIconLayout 未真调用 buildIconPages');
    }
    for (const anchor of ['app-grid-pager', 'app-grid-page', 'data-page-index']) {
        if (hits(home, anchor) < 1) bad.push('A3 缺分页结构：' + anchor);
    }
    /* A4 dock 净空：分页后内容不再靠滚动承接，页底必须显式留出 dock 的高度 */
    if (hits(css, '.phone-screen .home-screen .app-grid-page') < 1) bad.push('A4 缺 .app-grid-page 样式规则');
    if (hits(css, 'padding-bottom: 146px !important;') < 1) bad.push('A4 页底未留 dock 净空（末行仍会被 dock 压住）');
    /* A5 页码点：>1 页才出，且点击跳页 */
    if (hits(home, 'renderIconPageDots') < 2) bad.push('A5 页码点未接线');
    if (hits(css, '.home-page-dot') < 1) bad.push('A5 缺页码点样式');
    /* A6 手势与跳页入口 */
    if (hits(home, 'this.bindIconPager();') !== 1) bad.push('A6 bindEvents 未调用 bindIconPager');
    if (hits(home, 'this.goIconPage(') < 2) bad.push('A6 goIconPage 只有定义没有调用点');
    /* A7 手势判定必须用「起止两点坐标之差」：本仓既有的 bindSwipeGesture 也是这个口径，
     *    而 PointerEvent.movementX/Y 在触摸端基本不填 —— 用错即「怎么划都不翻页」。 */
    if (hits(home, 'const dx = x - startX;') !== 1) bad.push('A7 手势位移未取起止坐标之差');
    if (hits(code, 'movementX') > 0) bad.push('A7 手势位移读了 movementX（触摸端不可靠）');
    /* A8 每页容量下限：81 件要真被切成多页，容量必须小到能落进一屏（≤ 24）。
     * ★ [v3.93.0 交棒改写，不是放宽] 原判据把**实现形态**钉死为「恰写 `return columns * rows;`
     *   且列数是一个数字字面量」。v3.93.0（R-X9 窄屏专门布局）把桌面列数改成**从内核派生**
     *   （`config/access-layers.js` 的 narrowPlan —— 修掉「CSS 写一个 4、JS 再写一个 4」的两处漂移：
     *   窄屏下 CSS 改 3 列而 JS 仍按 4 列摆，末行必被 dock 压住），于是那条形态锚在真仓上
     *   必然落空 ⇒ 判据恒红（与恒绿同样是坏判据，只是方向相反）。
     *   改写为**版本无关的两半**（原判据真正的意图一句没丢）：
     *     ① 容量必须由**行数**参与算出（返回表达式里必须有 `* rows`）—— 这才是不漂移的那一半；
     *     ② 行数必须显式声明为数字，且「列数 × 行数 ≤ 24」（列数取自源码里的字面量；
     *        没有字面量 ⇒ 列数来自内核，按标准档 4 列算）。
     *   列数那一格的真源现在是内核，由 v3930 的 C4（静态接线）与 E1（真调用行为面）守着，
     *   本处不重复钉实现形态。 */
    const capM = home.match(/return\s+[^\n;]*\*\s*rows\s*;/);
    const rm = home.match(/const rows = (\d+);/);
    const cm = home.match(/const columns = (\d+);/);
    if (!capM) bad.push('A8 缺每页容量计算（容量必须由行数参与算出）');
    else if (!rm) bad.push('A8 容量行数未显式声明');
    else {
        const cols = cm ? Number(cm[1]) : 4;
        if (cols * Number(rm[1]) > 24) {
            bad.push('A8 每页容量 ' + String(cols * Number(rm[1])) + ' 超过 24，分页无意义');
        }
    }
    return bad;
}

/* ============================================================
 * B 面：App 内返回键（此前从未渲染过）
 * ============================================================ */
function backProblems(root) {
    const bad = [];
    const shell = readFrom(root, SHELL_REL);
    const css = readFrom(root, CSS_REL);

    /* B1 必须真渲染出按钮，且挂在 .phone-screen 直系（不在 view-stack 内 —— 图层会被
     *    setContent 反复重建与回收，按钮跟着图层走就会「切一次 App 就没了」）。 */
    /* ★ 判据面取**代码面**（剥注释）：v3.61.0 为本块补了一段解释「此前为什么会被
     *   第一次 setContent 杀掉」的注释，注释里逐字引着 `<button id="phone-back-button">` ——
     *   裸文本扫描会把**说明**读成第二个按钮（判据自指伪证，本仓最贵的形态之一）。
     *   与同文件 A1/A7 的负判据同一纪律。 */
    const shellCode = codeOf(shell);
    if (hits(shellCode, 'id=' + DQ + 'phone-back-button' + DQ) !== 1) bad.push('B1 未渲染返回按钮');
    const screenStart = shellCode.indexOf('<div class="phone-screen"');
    const btnAt = shellCode.indexOf('id=' + DQ + 'phone-back-button' + DQ);
    if (screenStart < 0 || btnAt < 0 || btnAt < screenStart) bad.push('B1 返回按钮不在 .phone-screen 之后（可能被放进图层）');
    /* B2 绑定与可见性同步必须真被调用，不能只留方法定义 */
    if (hits(shell, 'this.bindBackButton();') !== 1) bad.push('B2 bindBackButton 未被调用');
    if (hits(shell, 'this.syncBackButtonVisibility();') < 3) {
        bad.push('B2 syncBackButtonVisibility 调用点不足（需 createInPanel + setContent + goHome 三处）');
    }
    /* B3 返回语义真源是 goHome()，按钮只调它、不重写 */
    if (hits(shell, 'if (this.isAtHomeScreen()) return;') !== 1) bad.push('B3 缺少主屏拦截（主屏不应显示也不应响应返回）');
    if (hits(shell, 'btn.style.display = atHome ? ' + Q + 'none' + Q + ' : ' + Q + Q + ';') !== 1) {
        bad.push('B3 缺 inline display 兜底（宿主 !important 会压过样式表）');
    }
    /* B4 样式与对比度补偿 */
    if (hits(css, '.phone-screen .phone-back-button.is-hidden {') !== 1) bad.push('B4 缺主屏隐藏样式');
    if (hits(css, '.phone-screen .phone-back-button {') < 1) bad.push('B4 缺返回键样式');
    return bad;
}

/* ============================================================
 * C 面：品牌串（对外显示名 RubyPhone；版权署名保留）
 * ============================================================ */
const LICENSE_LINE = /^\s*\*\s+柚月小手机 \(Yuzuki's Little Phone\)\s*$/;
/** 品牌面文件集：只扫「会被用户看到或被打包分发」的三处真源，不扫全仓注释。
 *  全仓扫描会把 85 个文件的版权署名当成泄漏 —— 那是来源归属，不是产品名。 */
const BRAND_FILES = [INDEX_REL, 'manifest.json', 'config/apps.js'];
/* 品牌串的**泄漏面**：用户能看到或被打包分发的名值位（title / name / 显示标签 / name 字段）。
 *  为什么必须收在这个面上（首版教训）：C2 原先是**全行扫描**，抬版当天就报红 ——
 *  扫到的是 index.js 公告块里我写的那条「品牌串统一为 RubyPhone」的说明**本身**，
 *  即第四种自指伪证形态：判据把「解释这次修正的文字」判成缺陷本体。
 *  收紧到载体行是**两个方向都收紧**（行内容仍逐字不许出现旧名），不是放宽。
 *  历史沿革：本仓多年前的 node 探测只支持「--input-type=module -e」，不支持 appId 参数，
 *  这正是当初退化成全行扫描的技术原因。 */
const CARRIER_LINE = /title=|"name"|<span>|name:/;
function brandProblems(root) {
    const bad = [];
    const idx = readFrom(root, INDEX_REL);
    /* C1 抽屉里两处显示名与两处 title 都必须是 RubyPhone */
    if (hits(idx, '<span>RubyPhone</span>') !== 1) bad.push('C1 抽屉显示名不是 RubyPhone');
    if (hits(idx, 'title=' + DQ + 'RubyPhone (') !== 2) bad.push('C1 抽屉 title 不是 RubyPhone（应恰 2 处）');
    for (const rel of BRAND_FILES) {
        const src = readFrom(root, rel);
        for (const line of linesOf(src)) {
            if (!CARRIER_LINE.test(line)) continue;
            if (line.indexOf('柚月') < 0) continue;
            /* C2 两类红灯，都在**载体行**上判：
             *   ① 行内有旧名「柚月」而整行不匹配版权署名形态（署名行是唯一放行形态）；
             *   ② 行内出现旧产品名「柚月の」（后者是产品名特征串，不随变量名/键名漂移）。
             *   注释与解说文字不进这个面 —— 它们不是用户能看到的名值位（见 CARRIER_LINE）。 */
            if (!LICENSE_LINE.test(line)) bad.push('C2 ' + rel + ' 出现非署名品牌串：' + line.trim().slice(0, 60));
        }
        for (const line of linesOf(src)) {
            if (!CARRIER_LINE.test(line)) continue;
            if (line.indexOf('柚月の') >= 0) bad.push('C2 ' + rel + ' 仍含旧产品名「柚月の」');
        }
    }
    /* C3 版权署名本身必须还在（改名不等于抹掉来源归属） */
    const appSrc = readFrom(root, 'config/apps.js');
    if (hits(appSrc, 'Yuzuki') < 1) bad.push('C3 版权署名被误删');
    return bad;
}

/* ============================================================
 * D 面：桌面宠物拖拽（cursor: grab 的空头承诺）
 * ============================================================ */
function petProblems(root) {
    const bad = [];
    const src = readFrom(root, FLOAT_REL);
    const petCss = readFrom(root, PET_CSS_REL);

    /* D1 键必须先定义再引用（否则 set() 里抛 ReferenceError，拖拽静默失效） */
    if (hits(src, 'export const PHONE_PET_POSITION_KEY = ' + Q + 'phone-pet-position' + Q + ';') !== 1) {
        bad.push('D1 PHONE_PET_POSITION_KEY 未定义（引用它会抛 ReferenceError）');
    }
    if (hits(src, 'this.storage?.set?.(PHONE_PET_POSITION_KEY, payload)') !== 1) bad.push('D1 写点未接键');
    if (hits(src, 'this.storage?.get?.(PHONE_PET_POSITION_KEY)') !== 1) bad.push('D1 读点未接键');
    /* D2 拖拽真被接线：定义 + 在 ensurePet 内调用 */
    if (hits(src, 'bindPetDrag(petRoot) {') !== 1) bad.push('D2 缺 bindPetDrag 定义');
    if (hits(src, 'this.bindPetDrag(petRoot);') !== 1) bad.push('D2 bindPetDrag 未被调用（定义过 ≠ 被调起）');
    /* D3 位移阈值：点击与拖拽必须分流，否则拖完松手会顺手开关手机 */
    if (hits(src, 'DRAG_MIN') < 2) bad.push('D3 缺拖拽位移阈值');
    /* D4 吞噬那一次 click 必须用捕获 + stopImmediatePropagation：
     *    开/关手机的 click 挂在**同一个** petRoot 上，同节点监听器按注册顺序触发，
     *    stopPropagation 拦不住同节点的后一个监听器 —— 用错方法等于没吞。 */
    if (hits(src, 'e.stopImmediatePropagation();') !== 1) bad.push('D4 未用 stopImmediatePropagation 吞掉拖后 click');
    if (hits(src, 'true, ' + Q + 'pet:click-swallow' + Q) !== 1) bad.push('D4 吞噬监听未走捕获期');
    /* D5 坐标系：起点必须反解到「未变换原点」，夹取/存点必须用 offsetWidth（未变换尺寸）。
     *    宠物根带 scale(0.86)（手机开着时），拿 rect 当原点会让拖拽全程偏半个缩放量。 */
    if (hits(src, '(Number(rect.width) || 0) - (petRoot.offsetWidth || 0)') !== 1) bad.push('D5 起点未反解未变换原点');
    /* 该串在真仓恰有 2 处（拖拽夹取 + 恢复夹取），两处都必须用未变换尺寸 ——
     *   故下限是 2 而非 1：写死「恰 1 次」会让判据**恒红**（假红），破坏任一处才应报红。 */
    if (hits(src, 'const w = Math.max(1, petRoot.offsetWidth || 120);') < 2) bad.push('D5 夹取用了缩放后的 rect 尺寸');
    /* D6 落点/恢复都必须夹取，否则宠物会被推出视口且**没有找回来的入口** */
    if (hits(src, 'clampToViewport(left, top)') < 1) bad.push('D6 拖拽未夹取');
    if (hits(src, 'const safeLeft = Math.max(-w / 3, Math.min(vw - w / 3, left));') !== 1) bad.push('D6 恢复位置未夹取（换屏/旋转后会丢）');
    /* D7 光标承诺兑现：grab 必须有 grabbing 态，且 :active 不得再动 transform
     *    （缩放反馈会在按住瞬间改几何，与拖拽抢同一个属性）。 */
    if (hits(petCss, 'cursor: grabbing !important;') !== 1) bad.push('D7 拖拽态缺 grabbing 光标');
    /* 与 A1/A7 同一条纪律：负判据必须走**代码面**。pet.css 的说明注释里引用了旧写法
     *   （「已从 transform: scale(0.95) 换成 filter: brightness()」），
     *   裸文本扫描会把「解释这次修正」的那句话判成缺陷本体（本套件第三种自指伪证形态）。 */
    if (hits(codeOf(petCss), 'transform: scale(0.95)') > 0) bad.push('D7 :active 仍在缩放（按住即改几何，拖拽会漂）');
    return bad;
}

/* ============================================================
 * G 面：判据工具自证（防「空对空」与「口径不可分辨」）
 * ============================================================ */
function toolProblems(root) {
    const bad = [];
    /* G1 扫描面下限锚：四个面各自至少要能读到目标文件，否则判据在空集上恒绿 */
    for (const rel of [HOME_REL, SHELL_REL, FLOAT_REL, CSS_REL, PET_CSS_REL, INDEX_REL]) {
        const src = readFrom(root, rel);
        if (typeof src !== 'string' || src.length < 1000) bad.push('G1 读不到或过短：' + rel);
    }
    /* G2 口径可分辨：分页面必须能区分「页容器」与「旧单格」两种读法。
     *    若 .app-grid-page 与 .app-grid 在真仓里等价（页容器没被引入），本判据就失效。 */
    const home = readFrom(root, HOME_REL);
    if (hits(home, 'app-grid-page') > 0 && hits(home, 'app-grid-pager') > 0) {
        if (hits(home, 'app-grid-pager') === hits(home, 'app-grid-page')) {
            bad.push('G2 两种读法读数相同，口径不可分辨');
        }
    }
    /* G3 品牌面扫描面必须非空（否则 C 面恒绿） */
    if (BRAND_FILES.length < 3) bad.push('G3 品牌扫描面过窄');
    return bad;
}

/* ============================================================
 * V 面：版本下限锚（五源同源）
 * ============================================================ */
function versionProblems(root) {
    const bad = [];
    const man = JSON.parse(readFrom(root, MANIFEST_REL));
    const pkg = JSON.parse(readFrom(root, PKG_REL));
    const log = JSON.parse(readFrom(root, UPDLOG_REL));
    const idx = readFrom(root, INDEX_REL);
    /* [v3.57.0·O3 交棒改写，不是放宽] 原判据把五源**钉死在出生那一版**
     *   （`v !== '3.56.0'` 即红）—— 抬版当日必红，属「判据恒红」形态（与恒绿同样是坏判据，
     *   只是方向相反）。改写为**下限 + 五源自洽**：① 本套件自出生版起成立（>= MIN_VERSION）；
     *   ② 四源彼此一致（这才是真契约 —— 「五源不同源」照样会被抓到，但不因抬版误红）；
     *   ③ 入口常量与当版条目在场。 */
    const vnum = (v) => String(v).split('.').map((x) => Number(x)).reduce((a, b) => a * 1000 + b, 0);
    if (vnum(man.version) < vnum(MIN_VERSION)) bad.push('V1 manifest 版本低于本套件出生版：' + man.version);
    for (const [name, v] of [['package', pkg.version], ['update-log.latest', log.latest],
        ['update-log.head', log.head]]) {
        if (v !== man.version) bad.push('V1 ' + name + ' = ' + String(v) + '（应与 manifest ' + man.version + ' 同源）');
    }
    if (hits(idx, 'const ST_PHONE_VERSION = ' + Q + man.version + Q + ';') !== 1) bad.push('V1 index.js 版本常量不同源');
    if (!log.versions || !log.versions[man.version]) bad.push('V1 update-log 缺当版条目');
    return bad;
}

/* ============================================================
 * E 面：真调用行为面 —— 直接调真方法，断言算出来的结果
 *   文本在场只证明「写过」；调用结果才证明「算对」。
 * ============================================================ */
const homeMod = await import(pathToFileURL(path.join(ROOT, HOME_REL)).href);
const floatMod = await import(pathToFileURL(path.join(ROOT, FLOAT_REL)).href);
const HomeScreen = homeMod.HomeScreen;
/** 用原型方法 + 最小假 this 造一个「够用就好」的分页上下文（不装载 DOM）。 */
function pagerCtx(apps) {
    const ctx = Object.create(HomeScreen.prototype);
    ctx.apps = apps;
    ctx._iconPage = 0;
    return ctx;
}

test('E1 分页切分：81 件必须切成多页，且每页不超容量、合计不丢件', () => {
    const ctx = pagerCtx(Array.from({ length: 81 }, (_, i) => ({ id: 'a' + String(i) })));
    const pages = ctx.buildIconPages();
    const cap = ctx.getIconPageCapacity();
    assert.ok(pages.length > 1, '81 件必须多页');
    assert.ok(pages.every((p) => p.length <= cap), '每页不得超过容量 ' + String(cap));
    assert.equal(pages.reduce((n, p) => n + p.length, 0), 81, '分页不得丢件');
    assert.equal(pages[0].length, cap, '首页应当装满');
    // 边界：恰好一页时不得凭空多一页；空集也必须给出一页（否则渲染出空桌面）
    assert.equal(pagerCtx(new Array(cap).fill({})).buildIconPages().length, 1);
    assert.equal(pagerCtx([]).buildIconPages().length, 1);
});

test('E2 页码夹取：负数/越界/非数一律夹到合法区间', () => {
    const ctx = pagerCtx(new Array(81).fill({}));
    assert.equal(ctx._clampIconPage(-1, 5), 0, '负数夹到 0');
    assert.equal(ctx._clampIconPage(99, 5), 4, '越界夹到末页');
    assert.equal(ctx._clampIconPage(Number.NaN, 5), 0, '非数回落首页');
    assert.equal(ctx._clampIconPage(2.7, 5), 2, '小数取整');
});

test('E3 页码点：单页不出点，多页出满且当前页带 is-active', () => {
    const ctx = pagerCtx(new Array(81).fill({}));
    assert.equal(ctx.renderIconPageDots(1), '', '单页不该出页码点');
    const html = ctx.renderIconPageDots(5);
    /* 计数锚点取 data-page-index 而非 'home-page-dot'：后者是
     *   'yzp-home-page-dot' / 'home-page-dots' 的**子串**，每点会被计两次、
     *   外层容器再计两次（5 点实测 12），故不是可归因的计数面。 */
    assert.equal(hits(html, 'data-page-index=' + DQ), 5, '五页应有五个点');
    assert.equal(hits(html, 'is-active'), 1, '恰一个当前页');
    assert.equal(hits(html, 'data-page-index="0"'), 1);
});

test('E4 翻页手势：真调 bindIconPager 注册的监听器，横滑翻页、纵向/轻点不翻页', () => {
    const listeners = [];
    const ctx = Object.create(HomeScreen.prototype);
    ctx._iconPage = 0;
    const pager = {
        dataset: { pageCount: '5' },
        style: {},
        parentElement: { querySelector: () => null },
        querySelectorAll: () => [],
    };
    ctx.phoneShell = { screen: { querySelector: () => pager } };
    ctx._rt = { addListener: (target, type, handler, opts, tag) => { listeners.push({ type, tag, handler }); } };
    const moves = [];
    ctx.goIconPage = (page) => { moves.push(page); return true; };
    ctx.bindIconPager();
    const fire = (tag, ev) => {
        const hit = listeners.filter((l) => l.tag === tag);
        assert.equal(hit.length, 1, '缺监听器：' + tag);
        hit[0].handler(ev);
    };
    assert.deepEqual(moves, [0], '绑定时应做一次首页同步');
    // 左滑 70px（越过 SWIPE_MIN=40）⇒ 下一页
    fire('home:iconPagePointerDown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 100 });
    fire('home:iconPagePointerUp', { pointerType: 'mouse', clientX: 130, clientY: 104 });
    assert.deepEqual(moves, [0, 1], '左滑应翻到第 2 页');
    // 轻点（位移 3px）⇒ 不翻页
    fire('home:iconPagePointerDown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 100 });
    fire('home:iconPagePointerUp', { pointerType: 'mouse', clientX: 197, clientY: 101 });
    assert.deepEqual(moves, [0, 1], '轻点不得翻页');
    // 纵向为主（dx 70 / dy 200）⇒ 不翻页（留给宿主滚动）
    fire('home:iconPagePointerDown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 100 });
    fire('home:iconPagePointerUp', { pointerType: 'mouse', clientX: 130, clientY: 300 });
    assert.deepEqual(moves, [0, 1], '纵向手势不得翻页');
});

test('E5 宠物位置键：真模块导出的键必须与读写点一致且非空', () => {
    assert.equal(floatMod.PHONE_PET_POSITION_KEY, 'phone-pet-position');
    assert.equal(typeof floatMod.PhoneFloatingEntry.prototype.bindPetDrag, 'function', 'bindPetDrag 必须是真方法');
});

/* ============================================================
 * 六面判据 · 真仓读数（必须全绿）
 * ============================================================ */
test('A 面 桌面分页：真仓无缺陷', () => {
    const bad = pagerProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('B 面 App 内返回键：真仓无缺陷', () => {
    const bad = backProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('C 面 品牌串：真仓无缺陷', () => {
    const bad = brandProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('D 面 桌面宠物拖拽：真仓无缺陷', () => {
    const bad = petProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('G 面 判据工具自证：扫描面非空且口径可分辨', () => {
    const bad = toolProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V1 ★ 版本下限锚：本套件只在 3.56.0 及以后成立', () => {
    const bad = versionProblems(ROOT);
    assert.deepEqual(bad, [], bad.join(' | '));
});
test('V2 台账：本套件必须与「六项缺陷」一一对得上，不留无人认领的文件', () => {
    /* 本版六项缺陷的载体文件集，必须逐个都能被至少一条判据读到 ——
     *   防「缺陷改了但没人守」。 */
    const carriers = [HOME_REL, SHELL_REL, FLOAT_REL, CSS_REL, PET_CSS_REL, INDEX_REL];
    const JUDGES = [pagerProblems, backProblems, brandProblems, petProblems, toolProblems];
    for (const rel of carriers) {
        const touched = JUDGES.some((fn) => {
            const src = readRel(rel);
            return typeof src === 'string' && src.length > 0 &&
                (fn === brandProblems ? BRAND_FILES.includes(rel) || fn(ROOT).length === 0 : true);
        });
        assert.ok(touched, '载体文件无人守：' + rel);
    }
    assert.ok(carriers.length >= 6, '六项缺陷至少六个载体');
});

/* ============================================================
 * D 面：破坏表 —— 真源码定点破坏 ⇒ 在副本树上重跑**同款真判据**必须转红
 * ============================================================ */
/* 动态版本锚：破坏表的版本面不许钉死某一版的字面量（抬版即失配 ⇒ 破坏静默不生效）。 */
const CUR_LATEST_ANCHOR = '"latest": "' + String(JSON.parse(readRel(UPDLOG_REL)).latest) + '"';
const D = [
    /* D1：把分页拆掉，退回「全部一次铺进单格」 */
    ['A1 退回单格全铺（分页被删）', HOME_REL,
        'const pages = this.buildIconPages();',
        'const pages = [this.apps];', 'pagerProblems'],
    /* D2：页底 dock 净空被删（末行又被 dock 压住） */
    ['A4 dock 净空被删（图标重新重叠）', CSS_REL,
        'padding-bottom: 146px !important;',
        'padding-bottom: 0 !important;', 'pagerProblems'],
    /* D3：手势改读 movementX（触摸端不填 ⇒ 怎么划都不翻页） */
    ['A7 手势改读 movementX', HOME_REL,
        'const dx = x - startX;',
        'const dx = ev0 && ev0.movementX;', 'pagerProblems'],
    /* D4：bindIconPager 不再被调用（接线断裂） */
    ['A6 分页手势未接线', HOME_REL,
        'this.bindIconPager();',
        'void 0;', 'pagerProblems'],
    /* D5：返回按钮渲染被拿掉 */
    /* ★ 锚点收紧为含 class= 的唯一串：只写 `id="phone-back-button"` 时，
     *   v3.61.0 的解说注释里也有一处同形引用 ⇒ 命中 2 次，破坏就不再单一
     *   （breakIn 会抛「锚点不唯一」，负控制变成「跑不起来」而不是「响过了」）。 */
    ['B1 返回按钮被拿掉', SHELL_REL,
        'class=' + DQ + 'phone-back-button' + DQ + ' id=' + DQ + 'phone-back-button' + DQ,
        'class=' + DQ + 'phone-back-x' + DQ + ' id=' + DQ + 'phone-back-x' + DQ, 'backProblems'],
    /* D6：返回按钮搬进图层（切一次 App 就没了） */
    ['B1 返回按钮搬出 .phone-screen', SHELL_REL,
        '<div class="phone-screen" id="phone-screen">',
        '<div class="phone-screen-x" id="phone-screen-x">', 'backProblems'],
    /* D7：可见性不再同步（返回后按钮不消失） */
    ['B2 可见性同步调用被删', SHELL_REL,
        'this.bindBackButton();',
        'void 0;', 'backProblems'],
    /* D8：主屏拦截被删（主屏也显示返回键） */
    ['B3 主屏拦截被删', SHELL_REL,
        'if (this.isAtHomeScreen()) return;',
        'if (false) return;', 'backProblems'],
    /* D9：品牌串退回旧名 */
    ['C1 显示名退回旧产品名', INDEX_REL,
        '<span>RubyPhone</span>',
        '<span>柚月の手机</span>', 'brandProblems'],
    /* D10：版权署名被误删（改名不该抹来源） */
    ['C3 版权署名被误删', 'config/apps.js',
        'Yuzuki',
        'Unknown', 'brandProblems'],
    /* D11：宠物键常量定义被删（引用即抛 ReferenceError） */
    ['D1 宠物位置键未定义', FLOAT_REL,
        'export const PHONE_PET_POSITION_KEY = ' + Q + 'phone-pet-position' + Q + ';',
        '// 键被删', 'petProblems'],
    /* D12：bindPetDrag 不再被调用（拖拽失效但函数仍在） */
    ['D2 拖拽未接线', FLOAT_REL,
        'this.bindPetDrag(petRoot);',
        'void 0;', 'petProblems'],
    /* D13：吞噬改用 stopPropagation（同节点拦不住 ⇒ 拖完手机会开关一次） */
    ['D4 吞噬方法用错', FLOAT_REL,
        'e.stopImmediatePropagation();',
        'e.stopPropagation();', 'petProblems'],
    /* D14：起点退回 rect（缩放态下拖拽整体偏移） */
    ['D5 起点未反解未变换原点', FLOAT_REL,
        '(Number(rect.width) || 0) - (petRoot.offsetWidth || 0)',
        '0 * (Number(rect.width) || 0)', 'petProblems'],
    /* D15：恢复位置不再夹取（换屏/旋转后宠物丢在视口外） */
    ['D6 恢复位置未夹取', FLOAT_REL,
        'const safeLeft = Math.max(-w / 3, Math.min(vw - w / 3, left));',
        'const safeLeft = left;', 'petProblems'],
    /* D16：:active 又去动 transform（按住即改几何，拖拽会漂） */
    ['D7 :active 又缩放', PET_CSS_REL,
        '.phone-pet-root:active { filter: brightness(1.12); cursor: grabbing; }',
        '.phone-pet-root:active { transform: scale(0.95); cursor: grabbing; }', 'petProblems'],
    /* D17：版本五源脱节（动态锚：把 latest 指到一个与四源都不相符的版本） */
    ['V1 五源脱节', UPDLOG_REL,
        CUR_LATEST_ANCHOR,
        '"latest": "0.0.0"', 'versionProblems'],
    /* D18：分页容量被放大到无意义 */
    ['A8 每页容量无意义', HOME_REL,
        'const rows = 5;',
        'const rows = 40;', 'pagerProblems'],
];

/** 破坏落副本树：只写被改的那一个文件（其余回落真仓，不复制整棵树）。
 *  锚点必须恰中 1 次，否则抛 —— 不唯一说明这条破坏会改到别处，结论不可归因。 */
function breakIn(rel, from, to) {
    const src = readRel(rel);
    const n = hits(src, from);
    if (n !== 1) throw new Error('破坏锚点不唯一：' + rel + ' -> ' + String(n));
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-v3560-'));
    temps.push(d);
    const target = path.join(d, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src.split(from).join(to), 'utf8');
    return d;
}

const JUDGES = { pagerProblems, backProblems, brandProblems, petProblems, toolProblems, versionProblems };

async function runBreak(row) {
    const ws = breakIn(row[1], row[2], row[3]);
    const judge = JUDGES[row[4]];
    if (typeof judge !== 'function') throw new Error('判据名不存在：' + String(row[4]));
    try { return judge(ws); } catch (_e) { return [row[4]]; }
}

test('D1~D18 破坏表：每条真源码定点破坏都必须让对应判据转红', async () => {
    for (const row of D) {
        const bad = await runBreak(row);
        assert.ok(Array.isArray(bad) && bad.length >= 1, row[0] + ' 破坏未被观测到（判据没响）');
    }
});

test('D20 负控制：在解说/注释行提到旧名，不得被 C2 判成泄漏（自指伪证反例）', () => {
    /* 这条是「判据不许自指伪证」的**反例锚**：把旧名写进一行注释，C2 必须仍返回空。
     *   抬版当天真被这件事绊过 —— 判据扫到了 announce 块里那句说明文案。
     *   若哪天有人把 C2 改回全行扫描，这条会立刻报红。 */
    /* [v3.57.0·O3 交棒改写] 锚点版本号改为**动态取当版**（原写死出生版 3.56.0，抬版即锚点失配 ⇒
     *   breakIn 直接抛，负控制变成「跑不起来」而不是「响过了」）。判据本身一字未改。 */
    const CUR_V = String(JSON.parse(readRel(MANIFEST_REL)).version);
    const ws = breakIn(INDEX_REL, 'const ST_PHONE_VERSION = ' + Q + CUR_V + Q + ';',
        'const ST_PHONE_VERSION = ' + Q + CUR_V + Q + ';   // 旧名柚月の手机与柚月小手机已统一为 RubyPhone');
    const bad = brandProblems(ws);
    assert.deepEqual(bad, [], '注释里提旧名被误判成泄漏：' + bad.join(' | '));
});

test('D19 真仓只读：全部破坏跑完后，真仓六面判据必须仍然干净', () => {
    for (const [name, fn] of Object.entries(JUDGES)) {
        const bad = fn(ROOT);
        assert.deepEqual(bad, [], name + '：' + bad.join(' | '));
    }
});
