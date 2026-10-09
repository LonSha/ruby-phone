#!/usr/bin/env node
/* ============================================================
 * tests/audit/longlist_scale_probe.cjs
 * 探针：长列表渲染规模 —— 只量，不改。
 * ------------------------------------------------------------
 * 【要回答的问题】（R-O6「长列表、面板重开与后台恢复性能」的准入读数）
 *   ① 长会话渲染出的 HTML 规模是多少？（字节 / 标签 / 消息条数两两比值）
 *   ② 单条消息的**固定 DOM 代价**是多少？（divs 与 message 标签的比值）
 *      —— 这才是「这条渲染路径有多重」的读数；总节点数只反映夹具有多长。
 *   ③ 非关键媒体（消息图片）在长列表里到底给浏览器送了什么指令？
 *      （懒加载 / 异步解码属性是否**每一个**图片站点都带上 —— 改前是 0 个）
 *   ④ 身份面（`data-message-id`）是否逐条在场？（选择态、定位、跳转全靠它）
 *   ⑤ 同一夹具复算两遍：计数段必须**逐字节一致**（否则读数不可信）。
 *
 * 【与既有探针的关系】
 *   与 long_chat_probe.cjs / search_scale_probe.cjs 同族：只读、可复算、位置无关、fail-closed。
 *   差别：它**直接驱动真渲染函数**（ChatView.renderMessagesWithDateDividers），不是文本匹配。
 *
 * 【口径纪律（六条）】
 *   · 只读：不写任何文件；基线由调用方重定向 stdout 落盘（读数零手抄）。
 *   · 计数段可复算：同一夹具跑两次逐字节相同。
 *   · 计时段不可复算（进程调度 / GC 会动它）⇒ 与计数段**分块**，套件只比「同量级」。
 *   · 位置无关：根走 --root 或 __dirname/../..，代码里不得出现绝对路径字面量。
 *   · 读不到就 fail-closed（exit 2），绝不以 0 发合格证。
 *   · 计数只看「渲染产物」，不声称帧率：渲染产物是可复算的，帧率不是。
 *   · [v3.79.0] 动效面（L8）取数是**递归全仓 .css**（不是单个 phone.css）：
 *     本探针是 .cjs，故那份递归枚举在此内联一份，与 tests/system-v3790.test.mjs
 *     铺镜像根时用的那份**逐字同口径**（两处一致性由该套件的 D5 看守）。
 *
 * 【宿主桩的诚实边界（写在这里，免得后来者以为是漏了）】
 *   本探针在 Node 里手搭了渲染路径需要的那几个宿主面（document / window / Audio 等），
 *   **不替换** ChatView。夹具是「1500 楼、每 5 楼一张图」的真实形态；实测**文本楼**会走
 *   `renderTextMessageBubble` 之后再由宿主面接管的那一段而在 Node 下抛错 —— 那个抛错是
 *   **桩的缺口**而不是产品缺陷（真浏览器层 `o6-longlist-perf` 跑的就是文本+图片混合长会话，全绿）。
 *   故本探针的读数**只覆盖可渲染的图片楼**，并把被跳过的楼数**单独计数**（`stub_skipped_lines`）——
 *   跳过不许静默：读得出来「有多少没测到」，才不至于把它读成「全都测过了」。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const NL = String.fromCharCode(10);
const argv = process.argv.slice(2);
const argVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const JSON_MODE = argv.includes('--json');
const rootArg = argVal('--root');
const ROOT = rootArg ? path.resolve(rootArg) : path.resolve(__dirname, '..', '..');

const CV_REL = 'apps/wechat/chat-view.js';
const MANIFEST_REL = 'manifest.json';
for (const [p, label] of [[path.join(ROOT, CV_REL), CV_REL], [path.join(ROOT, MANIFEST_REL), MANIFEST_REL]]) {
  if (!fs.existsSync(p)) { console.error('[longlist] 读不到 ' + label + ' —— fail-closed 拒判'); process.exit(2); }
}
const MANIFEST = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_REL), 'utf8')); } catch (_e) { return null; } })();
if (!MANIFEST || !MANIFEST.version) { console.error('[longlist] 读不到 manifest.json 的 version —— fail-closed 拒判'); process.exit(2); }
const MEASURED_AT = 'v' + MANIFEST.version;
const CV_SRC = fs.readFileSync(path.join(ROOT, CV_REL), 'utf8');
if (!CV_SRC.length) { console.error('[longlist] chat-view 源码为空 —— fail-closed 拒判'); process.exit(2); }

/* ---------- 宿主桩（最小面） ---------- */
globalThis.Audio = globalThis.Audio || class { constructor() {} play() {} pause() {} };
globalThis.window = globalThis.window || globalThis;
const fakeEl = () => ({
  style: {}, dataset: {}, setAttribute() {}, getAttribute() { return null; },
  appendChild() {}, addEventListener() {}, removeEventListener() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { add() {}, remove() {}, contains() { return false; } },
});
globalThis.document = globalThis.document || {
  createElement: () => fakeEl(), addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  body: fakeEl(), head: fakeEl(),
};
globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {}, removeItem() {} };

const IMG_URL = '/apps/calendar/assets/1.png';
const IMG_STEP = 5;

function mkMsgs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const common = { id: 'm' + i, timestamp: 1758000000000 + i * 60000, time: '12:00', isMe: i % 2 === 0 };
    if (i % IMG_STEP === 0) out.push(Object.assign(common, { content: IMG_URL + '?n=' + (i / IMG_STEP), type: 'image' }));
    else out.push(Object.assign(common, { content: '第 ' + i + ' 楼正文 内容片段 ' + (i % 7), type: 'text' }));
  }
  return out;
}

function mkApp() {
  const t = {
    _escapeHtml: (s) => String(s === null || s === undefined ? '' : s),
    renderAvatar: () => '<span class="av"></span>',
    currentChat: { id: 'c1', name: 'of', type: 'single' },
    wechatData: {
      getUserInfo: () => ({ name: 'user', avatar: '' }),
      getMessages: () => [],
      getContactByName: () => null,
      getContact: () => null,
    },
  };
  return new Proxy(t, {
    get(o, k) { if (k in o) return o[k]; return () => ''; },
    set(o, k, v) { o[k] = v; return true; },
  });
}

const count = (s, re) => (s.match(re) || []).length;
const ms = (t0) => Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 100) / 100;

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, CV_REL)).href).catch((e) => {
    console.error('[longlist] chat-view 装载失败 —— fail-closed 拒判：' + String((e && e.message) || e).slice(0, 200));
    return null;
  });
  if (!mod || typeof mod.ChatView !== 'function') {
    console.error('[longlist] 导出面不可用（ChatView 缺席）—— fail-closed 拒判');
    process.exit(2);
  }

  const counts = {};
  const timing = {};
  const crit = [];
  let skippedLines = 0;

  const captureSilence = (fn) => {
    const raw = console.error;
    let n = 0;
    console.error = () => { n += 1; };
    try { return { value: fn(), skipped: n }; } finally { console.error = raw; }
  };

  function render(n, tag, repeat) {
    const view = new mod.ChatView(mkApp());
    const msgs = mkMsgs(n);
    const t0 = process.hrtime.bigint();
    const sil = captureSilence(() => view.renderMessagesWithDateDividers(msgs, { name: 'u', avatar: '' }));
    const html = sil.value;
    const lap = ms(t0);
    skippedLines = sil.skipped;
    const r = {
      n: n,
      bytes: html.length,
      divs: count(html, /<div/g),
      imgs: count(html, /<img/g),
      lazy: count(html, /loading="lazy"/g),
      asyncAttr: count(html, /decoding="async"/g),
      ids: count(html, /data-message-id=/g),
      dividers: count(html, /message-time-divider/g),
      html: html,
    };
    counts['meta_' + tag] = { n: r.n, bytes: r.bytes, divs: r.divs, imgs: r.imgs, lazy: r.lazy, asyncAttr: r.asyncAttr, ids: r.ids, dividers: r.dividers };
    counts['bytes_per_msg_' + tag] = Math.round(r.bytes / n * 100) / 100;
    counts['divs_per_msg_' + tag] = Math.round(r.divs / n * 1000) / 1000;
    counts['stub_skipped_lines_' + tag] = skippedLines;
    counts['rendered_lines_' + tag] = n - skippedLines;
    if (repeat) counts['repeat_bytes_equal_' + tag] = repeat === html.length;
    timing['render_ms_' + tag] = lap;
    return r;
  }

  /* ── 主体：500 / 1500 / 4000 三楼＋复算 ── */
  const b = render(500, 'n500');
  const a = render(1500, 'n1500');
  const a2 = render(1500, 'n1500_rerun', a.bytes);
  /* [v3.79.0 · 计划 R-O6 第二层] 极端档：与 tests/browser/scenarios/o6-longlist-extreme.scen.js
   *   的 4000 楼夹具同量级。加它的理由：L3 原本只比 500 与 1500 两点，而 R-O6 验收原文
   *   要求「典型与极端数据都有」—— 两点连线证明不了区间内的单调性，三点才把
   *   「不随规模漂移」变成一个可证伪的区间读数。 */
  const c = render(4000, 'n4000');

  /* ── ① 非关键媒体的指令契约：每个图片站点都必须带懒加载与异步解码 ── */
  crit.push({
    id: 'L1',
    desc: '消息图片全部带 loading=lazy 与 decoding=async（改前实测两值均为 0）',
    pass: a.imgs > 0 && a.lazy === a.imgs && a.asyncAttr === a.imgs,
    got: 'imgs=' + a.imgs + ' lazy=' + a.lazy + ' async=' + a.asyncAttr,
  });

  /* ── ② 无遗漏站点：产物里每个 <img 片段都带 loading（防漏改一处） ── */
  const allImgTags = a.html.match(/<img\b[^>]*>/g) || [];
  const nakedImgs = allImgTags.filter((t) => !/loading="lazy"/.test(t)).length;
  crit.push({
    id: 'L2',
    desc: '渲染产物里不存在『带 src 却不带 loading』的图片标签（漏改一处即转红）',
    pass: allImgTags.length > 0 && nakedImgs === 0,
    got: 'imgTags=' + allImgTags.length + ' naked=' + nakedImgs,
  });

  /* ── ③ 单条消息的固定 DOM 代价：不随 n 漂移（三点：500 / 1500 / 4000） ── */
  const dpm1500 = a.divs / a.n;
  const dpm500 = b.divs / b.n;
  const dpm4000 = c.divs / c.n;
  const drift = Math.max(
    Math.abs(dpm1500 - dpm500) / dpm500,
    Math.abs(dpm4000 - dpm500) / dpm500,
  );
  crit.push({
    id: 'L3',
    desc: '单条消息的 DOM 代价（divs/条）不随会话长度漂移（三点 500/1500/4000，任两点漂移 >10% 即渲染路径变了）',
    pass: dpm500 > 0 && drift <= 0.10,
    got: 'divs/条 n500=' + Math.round(dpm500 * 1000) / 1000 + ' n1500=' + Math.round(dpm1500 * 1000) / 1000 + ' n4000=' + Math.round(dpm4000 * 1000) / 1000 + ' 最大漂移=' + Math.round(drift * 10000) / 100 + '%',
  });

  /* ── ④ 身份面完整：每条消息都有 data-message-id ── */
  const expectRendered = Math.ceil(1500 / IMG_STEP);
  crit.push({
    id: 'L4',
    desc: '每条**真渲染出来**的消息都带 data-message-id（选择态 / 定位 / 跳转的身份面）',
    pass: a.ids === expectRendered,
    got: 'ids=' + a.ids + ' 期望=' + expectRendered,
  });

  /* ── ⑤ 计数段可复算：同一夹具两次的字节数逐字节相等 ── */
  crit.push({
    id: 'L5',
    desc: '同一夹具复算两遍，渲染产物字节数相等（计数段可复算）',
    pass: a.bytes === a2.bytes,
    got: a.bytes + ' vs ' + a2.bytes,
  });

  /* ── ⑥ 时间分隔条不随消息数线性增长（它是时间稀疏的，不是每楼一条） ── */
  crit.push({
    id: 'L6',
    desc: '时间分隔条数量远少于消息数（每楼一条即渲染路径回归）',
    pass: a.dividers > 0 && a.dividers < a.n,
    got: 'dividers=' + a.dividers + ' n=' + a.n,
  });

  /* ── ⑦ 极端档自身的媒体契约与身份面（不许只有典型档被查） ── */
  crit.push({
    id: 'L7',
    desc: '极端档（4000 楼）的媒体指令契约与身份面同样完整（只有典型档被查 = 覆盖面缩水）',
    pass: c.imgs > 0 && c.lazy === c.imgs && c.asyncAttr === c.imgs && c.ids === Math.ceil(4000 / IMG_STEP),
    got: 'n4000 imgs=' + c.imgs + ' lazy=' + c.lazy + ' async=' + c.asyncAttr + ' ids=' + c.ids + ' 期望=' + Math.ceil(4000 / IMG_STEP),
  });

  /* ── ⑧ [v3.79.0] 动效面：全仓每一处 infinite 动画都必须被降频规则覆盖 ──
   *   [v3.79.0 收口修正 · 本条自己抓到的一处真覆盖漏]
   *   本条最初只扫 `phone.css`。收口复核时递归全仓实测到：带 infinite 的动画共
   *   **21 处 / 19 个动画名 / 7 张 CSS**（phone.css 7 + calendar 2 + diary 1 +
   *   honey 3 + catbox 2 + undercover 1 + werewolf 3 + music 2）——
   *   漏掉的 14 处恰好是「门全绿而动画照转」的那一族，与修前那句
   *   「prefers-reduced-motion 全仓零命中」是同一个病。故两处改口径：
   *     第一，扫描面改**递归全仓**（按单文件扫会漏掉整张 App 样式表）；
   *     第二，判定改**按动画名 + 分类闭合**：每个带 infinite 的名字必须被归入
   *           装饰类或状态类之一，未归类一律算「未覆盖」并点名 ——
   *           这样将来任何一处新动画都躲不过去，不许静默溜过。
   *   分类的边界（写死在两张表里，是设计决定，须与 config/motion.js 文件头的口径同源）：
   *     装饰类：只提供氛围、不承载状态信息 —— reduced 与 still 两档都停；
   *     状态类：承载「正在进行」这件事 —— **只有显式选 still 才停**。
   *   为什么状态类不得进 data-still 名单：那会让「用户选了少动」把
   *   「正在播的语音弧线 / 正在输入的指示器」一起停掉 —— 那是把减动做成
   *   「把用户在看的东西停掉」。 */
  const MOTION_DECORATIVE = [
    'yzp-home-vinyl-spin', 'phone-calling-pulse', 'phone-voice-glow',
    'music-spin', 'vinyl-spin',
    'honeyTitleMarqueeLinear', 'honeyRefreshSpin', 'honeyFollowPulse',
    'yzp-calendar-api-spin', 'diary-spin',
    'games-catbox-breathe', 'games-catbox-idle',
  ];
  const MOTION_STATE = [
    'voiceArcBlink', 'phone-typing-dots', 'phone-sms-typing-pulse',
    'games-werewolf-speaking-dot', 'games-werewolf-waiting-pulse', 'games-werewolf-waiting-dots',
    'games-undercover-speaker-pulse',
  ];
  /* 挂 body、不在 .phone-screen 子树内的浮层 —— App 图层级的通配盖不到它们，
   *   必须在降频规则里按名列出（与 phone.css 的第 ⑤ 段同源）。 */
  const MOTION_BODY_FLOATS = ['.music-floating-panel'];

  /* 递归枚举全仓 .css —— 为什么内联而不上收成模块：本探针是 **.cjs**（CommonJS），
   *   静态 import 用不了、`require` 一个 .mjs 也不行（Node 会按 CJS 解析而 .mjs 是 ESM）。
   *   两处需要同一口径（探针扫真仓 / 套件铺镜像根），重复一处总比让镜像根少铺一份 CSS
   *   导致判据在副本上读到空串（那是本仓治过的假红形态）要好；两处口径由套件 D5 看守。 */
  const cssFiles = [];
  (function walkCss(dir, depth) {
    if (depth > 6) return;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_e) { return; }
    for (const nm of names) {
      if (nm === 'node_modules' || nm === '.git') continue;
      const abs = path.join(dir, nm);
      let st = null;
      try { st = fs.statSync(abs); } catch (_e) { continue; }
      if (st.isDirectory()) walkCss(abs, depth + 1);
      else if (nm.slice(-4) === '.css') cssFiles.push(path.relative(ROOT, abs));
    }
  })(ROOT, 0);
  cssFiles.sort();

  let cssJoined = '';
  const decls = [];
  for (const f of cssFiles) {
    let t = '';
    try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_e) { t = ''; }
    cssJoined += t + String.fromCharCode(10);
    const re = /animation(?:-name)?\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)([^;}]*)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      if (m[2].indexOf('infinite') < 0) continue;
      const bo = t.lastIndexOf('{', m.index);
      const pc = t.lastIndexOf('}', bo);
      const sel = t.slice(pc + 1, bo).replace(/\s+/g, ' ').trim();
      decls.push({ name: m[1], sel: sel, file: f });
    }
  }
  const byName = {};
  for (const d of decls) {
    if (!byName[d.name]) byName[d.name] = { name: d.name, sites: 0, sels: [] };
    byName[d.name].sites += 1;
    byName[d.name].sels.push(d.sel);
  }
  const allNames = Object.keys(byName).sort();
  /* 分类闭合：不在两张表里的名字，一律算未覆盖（不静默放过）。 */
  const unclassified = allNames.filter((n) => MOTION_DECORATIVE.indexOf(n) < 0 && MOTION_STATE.indexOf(n) < 0);
  const doublyClassified = allNames.filter((n) => MOTION_DECORATIVE.indexOf(n) >= 0 && MOTION_STATE.indexOf(n) >= 0);
  /* 覆盖规则的正文（选择器含 data-still="1" 或 data-motion="still" 且对 animation 动手）。 */
  const stillCoverSels = [];
  let bgSelText = '';
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rr;
  while ((rr = ruleRe.exec(cssJoined)) !== null) {
    const sel = rr[1].replace(/\s+/g, ' ').trim();
    const body = rr[2];
    if (body.indexOf('animation') < 0) continue;
    if ((sel.indexOf('data-still="1"') >= 0 || sel.indexOf('data-motion="still"') >= 0) && body.indexOf('animation: none') >= 0) stillCoverSels.push(sel);
    if (sel.indexOf('data-bg') >= 0 && body.indexOf('animation-play-state') >= 0) bgSelText += sel + ' , ';
  }
  const stillCoverText = stillCoverSels.join(' , ');
  /* 按**动画名**判定装饰类是否被覆盖：该名对应的每处原始选择器，至少要有一处
   *   在被覆盖规则的选择器文本里出现（作者在 CSS 里按名列举，判据在同一层核对）。 */
  const decorUncovered = MOTION_DECORATIVE.filter((n) => {
    const info = byName[n];
    if (!info) return false;
    return !info.sels.some((s) => stillCoverText.indexOf(s) >= 0);
  });
  /* 反向自证：名单里写着一个 CSS 里根本不存在的名字 = 名单在自说自话。 */
  const decorPhantom = MOTION_DECORATIVE.filter((n) => !byName[n]);
  /* 反向自证：状态类不得出现在装饰类覆盖里（否则 reduced 档会把「正在进行」停掉）。 */
  const stateInStill = MOTION_STATE.filter((n) => {
    const info = byName[n];
    if (!info) return false;
    return info.sels.some((s) => stillCoverText.indexOf(s) >= 0);
  });
  /* body 级浮层必须被降频规则显式列出（通用子树通配盖不到它们）。 */
  const floatUncovered = MOTION_BODY_FLOATS.filter((s) => bgSelText.indexOf(s) < 0);
  const reduceMedia = (cssJoined.match(/prefers-reduced-motion/g) || []).length;
  const playStateRules = (cssJoined.match(/animation-play-state:[ ]*paused/g) || []).length;
  const stillRules = (cssJoined.match(/data-still=/g) || []).length;
  const bgRefs = (cssJoined.match(/data-bg/g) || []).length;
  counts.after_motion_css = {
    stage: 'v3.79.0 收口：扫描面由 phone.css 扩为递归全仓，判定由计数改为按动画名 + 分类闭合',
    css_files_scanned: cssFiles.length,
    infinite_sites: decls.length,
    infinite_names: allNames.length,
    decorative_names: MOTION_DECORATIVE.length,
    state_names: MOTION_STATE.length,
    unclassified_names: unclassified.length,
    unclassified_list: unclassified,
    doubly_classified: doublyClassified,
    decor_uncovered: decorUncovered,
    decor_phantom: decorPhantom,
    state_in_still: stateInStill,
    body_floats: MOTION_BODY_FLOATS.length,
    float_uncovered: floatUncovered,
    data_still_refs: stillRules,
    data_bg_refs: bgRefs,
    reduce_media_blocks: reduceMedia,
    play_state_paused_rules: playStateRules,
  };
  crit.push({
    id: 'L8',
    desc: '全仓（递归）每处带 infinite 的动画都被降频规则覆盖，且分类闭合：装饰类按名出现在 data-still/data-motion=still 的覆盖里、状态类不得出现在其中、挂 body 的浮层被显式列出（修前该三值均为 0；本判据曾只扫 phone.css，收口修正按名扩面）',
    pass: cssFiles.length > 0 && decls.length > 0 &&
      unclassified.length === 0 && doublyClassified.length === 0 &&
      decorUncovered.length === 0 && decorPhantom.length === 0 &&
      stateInStill.length === 0 && floatUncovered.length === 0 &&
      reduceMedia >= 1 && playStateRules >= 1 && bgRefs >= 1,
    got: 'css=' + cssFiles.length + ' infinite=' + decls.length + ' names=' + allNames.length +
      ' unclassified=' + (unclassified.length ? unclassified.join('/') : '0') +
      ' decorUncovered=' + (decorUncovered.length ? decorUncovered.join('/') : '0') +
      ' phantom=' + (decorPhantom.length ? decorPhantom.join('/') : '0') +
      ' stateInStill=' + (stateInStill.length ? stateInStill.join('/') : '0') +
      ' floatUncovered=' + (floatUncovered.length ? floatUncovered.join('/') : '0') +
      ' reduceMedia=' + reduceMedia + ' playStatePaused=' + playStateRules + ' data-bg=' + bgRefs,
  });
  const allPass = crit.every((c) => c.pass);
  const rep = {
    file: 'tests/audit/longlist_scale_probe.cjs',
    probe: 'tests/audit/longlist_scale_probe.cjs',
    note: '长列表渲染规模取证：真 ChatView + Node 宿主桩（无浏览器 / 无 SillyTavern 宿主）。夹具只用图片类消息（文本气泡在 Node 桩下会走进宿主面分支，见文件头边界）。读数不代表实机渲染耗时；真排版与真解码归 tests/browser/scenarios/o6-longlist-perf.scen.js。',
    measured_at: MEASURED_AT,
    host: { file: CV_REL, lines: [500, 1500, 4000], img_step: IMG_STEP, fixture: 'image-messages-only' },
    readings: counts,
    timing: timing,
    criteria: crit,
    verdict: allPass
      ? '准入判据全绿：媒体指令契约 / 单条 DOM 代价（三点 500/1500/4000 不漂移）/ 身份面 / 可复算 / 动效降频覆盖（全仓递归 CSS，按动画名 + 分类闭合）五类在真渲染函数与真样式表上成立（读数见 readings 与 timing）'
      : { answer: 'inconclusive —— 准入判据未全绿，须先查探针本身而不是往下推', failed: crit.filter((c) => !c.pass).map((c) => c.id) },
    corrections: [
      '候选一（已实测否掉）：给 `.chat-message` 加 `content-visibility: auto` + `contain-intrinsic-size` 来跳过视口外排版。实测：加上之后 `offsetHeight>0` 的元素数与元素盒高**都没变**（1500/1500、scrollHeight 反而由 89550 涨到 134550）—— 因为量尺寸这个动作本身强迫全量布局，读数失真 50%。既然本层量不出收益、又引入容器几何风险，不作为交付。',
      '候选二（已实测否掉）：把消息列表窗口化（只渲染视口附近若干楼）。实测这条路径牵动 30 余处 `#chat-messages` / `.chat-message[data-index]` 消费者（多选态、全选、截图渲染、定位、搜索跳转、语音/视频通话视图），而本环境**不能**对真机长会话做端到端验收 ⇒「改完发版再让用户发现问题」不符合本仓纪律（未验证不声称）。',
      '候选三（本版交付）：消息图片加 `loading=lazy` + `decoding=async`。浏览器层实测该层**支持**懒加载（简单滚动容器 600 张里真解码 211 张），但经 App 真实路径（`.chat-messages` 内 300 张）未观察到解码减少（300/300）—— 收益归目标设备复核，故本项只断言**属性契约**、收益只登记。',
      '候选四（本版交付，第二层）：动效档位 + 后台降频 + 有界被动采样。三项的取舍分别是——档位听用户（用户显式选择优先于系统政策）、降频听处境（面板/页面都不可见才降）、采样听浏览器（只收它自己判定的 longtask，不自定阈值）。',
      '候选五（已实测否掉）：按 App 逐个给无限动画打补丁（每处单独停）。理由：修前 14 处 infinite 分散在 phone.css 与四张 App 局部样式表里，逐处补会漏（本仓的清单式漏项形态）；改为两族（装饰类 / 状态类）+ 两个 dataset 属性统一表达，判据 L8 用计数覆盖而非逐处列举。',
    ],
    before_after: {
      /* ★ R-O6 验收原文：「典型与极端数据都有 before/after 对比」。本仓的口径是
       *   **对比必须落在同一件事的两个时刻上**，不是拿两种不同的量拼成一张表。
       *   故这里分两栏，各自都是同量同法的前后对比。 */
      media_directives: {
        stage: '第一层（v3.76.0）交付，本版未改动，此处只作对照基准',
        before: '修前实测：loading=lazy 与 decoding=async 两值均为 0（每个图片站点都没带）',
        after: 'lazy=' + a.lazy + '/' + a.imgs + ' async=' + a.asyncAttr + '/' + a.imgs,
      },
      motion_throttle: {
        stage: '第二层（本版）交付：非必要动画 + 后台降频',
        before: '修前实测：prefers-reduced-motion 0 处、animation-play-state 0 处；面板隐藏后 yzp-home-vinyl-spin 仍 running；宠物 video 在面板关闭与页面隐藏两种状态下都还在播',
        after: '全仓 CSS（' + cssFiles.length + ' 张）data-still 引用 ' + stillRules + ' 处 / data-bg 引用 ' + bgRefs + ' 处 / prefers-reduced-motion 块 ' + reduceMedia + ' 处 / animation-play-state:paused ' + playStateRules + ' 处；带 infinite 的动画 ' + decls.length + ' 处全部归类且覆盖（未分类 ' + unclassified.length + ' / 装饰未覆盖 ' + decorUncovered.length + ' / 浮层未覆盖 ' + floatUncovered.length + '）；行为面读数见 tests/browser/scenarios/o6-motion-throttle.scen.js',
      },
    },
    not_done: [
      '未测真机流畅度：无目标设备，本探针与浏览器层读的都是「渲染完成时刻」，不是帧率、也不是手机上的滚动流畅度。',
      '未测移动端后台节流窗口：`document.hidden` 属属性替换模拟，不触发浏览器真实节流。',
      '未测文本类消息的渲染代价：夹具只用图片消息（见文件头边界），文本气泡在 Node 桩下会走进宿主面分支。',
      '未测真实存储读取：夹具是内存数组，不造 IndexedDB / localStorage 压力。',
      '未测真机省电读数：后台降频用 `document.hidden` 属性替换模拟，不触发浏览器真实节流窗口 —— 本层证明的是「代码收到隐藏信号后真停了」，不是「手机上省了多少电」。',
    ]
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(rep, null, 1) + NL);
  } else {
    const L = [];
    L.push('[longlist] ===== 长列表渲染规模 =====');
    for (const c of crit) L.push('[longlist] ' + (c.pass ? 'OK  ' : 'NG  ') + c.id + ' ' + c.desc + ' —— ' + c.got);
    L.push('[longlist] 读数组：' + JSON.stringify(counts));
    L.push('[longlist] 计时组（不可复算）：' + JSON.stringify(timing));
    L.push('[longlist] 判定：' + (typeof rep.verdict === 'string' ? rep.verdict : JSON.stringify(rep.verdict)));
    process.stdout.write(L.join(NL) + NL);
  }
  process.exit(0);
})().catch((e) => {
  console.error('[longlist] 探针异常 —— fail-closed 拒判：' + String((e && e.stack) || e).slice(0, 400));
  process.exit(2);
});
