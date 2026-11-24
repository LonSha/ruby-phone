/* ============================================================
 * tests/system-v4200-layer.test.mjs — v4.200.0
 * 「样式的来源数必须是 1」——桌面 v2 写了却一条样式都不生效的真因判据
 * ------------------------------------------------------------
 * 本版治的事：`home-screen.js` 明明挂上了 `data-rp-desktop="2"`，
 *   `phone/design/rp-desktop-v2.css` 的 31 条规则也都在（全在 `@layer rp.components`、
 *   零 `!important`），用户看到的桌面仍与旧版一字不差。
 *
 * 真因：base 样式**有两条来源同时在跑**——
 *   ① manifest 的 css 入口 `phone/design/rp-entry.css` 静态 @import
 *      分层副本 `layer(rp.legacy) → legacy-phone.css`（生成物，已去 !important）；
 *   ② `phone/font-scale.js` 的 `ensureGlobalPhoneCSS()` 运行时 `fetch(./phone.css)`
 *      把整份未分层（0 个 @layer）+ 2008 处 !important 的原文塞进
 *      `<style id="st-phone-global-css">`。
 *   CSS 级联里 `!important` 恒压任何 `@layer` 内的普通声明 ⇒ 皮肤层被逐条压死。
 *
 * 判据纪律（沿用全仓）：
 *   · 版本锚一律**下限形**「不低于」，避免每抬一版就红一次；
 *   · 必须有真源码破坏型负控制（改坏就当场转红），且复原在 finally 里；
 *   · 判据只认**真规则**，注释里写到的字样不算（否则「解释」会被当成「实现」，
 *     负控制也跟着假绿 —— 首版实测踩到：文件头注释里逐字含 important 与属性选择器）；
 *   · 负控制不碰未提交产物：只改**真源**并立即复原，不新建临时分支、不 git checkout。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createFontScaleManager } from '../phone/font-scale.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FS = path.join(ROOT, 'phone/font-scale.js');
const D2 = path.join(ROOT, 'phone/design/rp-desktop-v2.css');
const LEG = path.join(ROOT, 'phone/design/legacy-phone.css');
const ATTR = '[data-rp-desktop="2"]';

/** 去掉 CSS 注释与行注释：判据只认真内容，不认「注释里提到的字样」。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 抽出 CSS 里**所有真规则块的选择器**：按花括号深度走，能正确处理
 *  @layer / @media 嵌套，不会把注释、@ 规则头、以及同一行里的多条规则搞混。
 *  ★ @keyframes 的 from / to / 百分比是**关键帧步**，不是选择器：它们本来就不带
 *    作用域，混进来会让本判据假红（首版实测踩到：报了两条名为 from / to 的「规则」）。 */
function rulesOf(css) {
  const s = stripComments(css);
  const out = [];
  const stack = [];          // 'at' = @规则容器层；'kf' = 关键帧容器层；'decl' = 声明块
  let cur = '';
  for (const ch of s) {
    if (ch === '{') {
      const prelude = cur.trim();
      cur = '';
      const isAt = prelude.startsWith('@');
      const isKeyframes = isAt && /keyframes/i.test(prelude);
      const inSelectorPos = stack.length === 0 || stack[stack.length - 1] === 'at';
      if (!isAt && inSelectorPos && prelude !== '') out.push(prelude);
      stack.push(isKeyframes ? 'kf' : (isAt ? 'at' : 'decl'));
      continue;
    }
    if (ch === '}') {
      cur = '';
      stack.pop();
      continue;
    }
    if (stack.length === 0 || stack[stack.length - 1] === 'at') cur += ch;
  }
  return out;
}

/** 取某函数体（从签名到下一个顶格 `}`）。 */
function fnBodyOf(src, signature) {
  const i = src.indexOf(signature);
  assert.notEqual(i, -1, '函数签名可提取：' + signature);
  const end = src.indexOf('\n    }', i);
  assert.notEqual(end, -1, '函数体可定位：' + signature);
  return src.slice(i, end);
}

/** 带文件时间戳原样复原（顺带守住「负控制不留痕」）。 */
function withTamper(file, mutate, body) {
  const original = fs.readFileSync(file, 'utf8');
  const st = fs.statSync(file);
  const mutated = mutate(original);
  assert.notEqual(mutated, original, '负控制的破坏点必须真的命中（否则是假负控制）：' + path.basename(file));
  try {
    fs.writeFileSync(file, mutated, 'utf8');
    return body();
  } finally {
    fs.writeFileSync(file, original, 'utf8');
    try { fs.utimesSync(file, st.atime, st.mtime); } catch (_e) { /* 时间戳复原失败不影响内容 */ }
  }
}

/* ══════════════ A. font-scale.js：base 样式不再生产第二份 ══════════════ */

test('A1 收口：base 分支不得再 fetch 根 phone.css 并注入 <style>（旧形整段不许留）', () => {
  const src = read('phone/font-scale.js');
  const body = fnBodyOf(src, 'async function ensureGlobalPhoneCSS() {');
  /* base 分支 = 像素皮肤标记之前的那一段。像素皮肤是**允许**追加 style 的增强层，
   *   本版没动它，也不该拿它去判 base 是否收口。 */
  const pixelAt = body.indexOf('[v4.92.0]');
  assert.notEqual(pixelAt, -1, '像素皮肤分支标记必须还在（A4 另判）');
  const basePart = body.slice(0, pixelAt);
  assert.equal(src.includes('fetch(ST_PHONE_GLOBAL_CSS_URL'), false,
    '仍然在 fetch 根 phone.css ⇒ 未分层 base 会继续恒压 @layer 里的皮肤层');
  assert.equal(basePart.includes('createElement'), false, 'base 分支不得创建任何 style 节点');
  assert.equal(/\.textContent\s*=/.test(basePart), false, 'base 分支不得把 CSS 文本写进节点');
  /* 正向：base 分支必须真的**摘除**（否则 A1 就成了「只删代码、不留语义」） */
  assert.ok(basePart.includes('existing'), 'base 分支必须查既有节点');
  assert.ok(/\bexisting\.remove\(\)/.test(basePart), 'base 分支必须真的 remove');
});

test('A2 保留契约面：仍以 st-phone-global-css 为 id，且语义是**摘除**（幂等）', () => {
  const src = read('phone/font-scale.js');
  assert.ok(src.includes("'st-phone-global-css'"), '常量 id 必须保留（升级后残留的旧注入要能被摘掉）');
  const body = fnBodyOf(src, 'async function ensureGlobalPhoneCSS() {');
  assert.ok(body.includes('getElementById(styleId)'), '必须查一次既有节点');
  assert.ok(body.includes('if (existing)'), '必须条件化：没有就不做（幂等）');
  assert.ok(/\bexisting\.remove\(\)/.test(body), '必须真的 remove（不是「什么都不做」）');
});

test('A3 行为级：假 DOM 下调用 ensureGlobalPhoneCSS 必须真把残留 style 摘掉（不是只写了注释）', async () => {
  /* 源码里写了 remove 不等于运行时真调用。用最小假 document/window
   * （本仓 L2 口径：只提供模块用到的那几个面）。 */
  const removed = [];
  const styleNode = { id: 'st-phone-global-css', remove() { removed.push('st-phone-global-css'); } };
  const g = globalThis;
  const saved = { document: g.document, window: g.window, fetch: g.fetch };
  g.window = { localStorage: { getItem: () => 'default' }, VirtualPhone: {} };
  g.document = {
    getElementById: (id) => (id === 'st-phone-global-css' ? styleNode : null),
    createElement: () => ({ id: '', setAttribute() {}, textContent: '' }),
    head: { appendChild() {} },
    documentElement: { style: { setProperty() {} } },
  };
  const fetched = [];
  g.fetch = (url) => { fetched.push(String(url)); return Promise.resolve({ ok: true, text: async () => '' }); };
  try {
    const m = createFontScaleManager({
      ST_PHONE_VERSION: 'test', ST_PHONE_CSS_REVISION: 'test',
      ST_PHONE_GLOBAL_CSS_URL: './phone.css', ST_PHONE_PIXEL_CSS_URL: './pixel.css',
    });
    m.setStorage({ get: () => undefined, set() {} });
    await m.ensureGlobalPhoneCSS();
  } finally {
    g.document = saved.document; g.window = saved.window; g.fetch = saved.fetch;
  }
  assert.deepEqual(removed, ['st-phone-global-css'],
    '残留的无层 style 节点必须被摘掉（否则 important 继续压皮肤层）');
  assert.equal(fetched.includes('./phone.css'), false,
    '不得再去取根 phone.css（取来就是要注入第二份 base；本版已收口）');
});

test('A4 像素皮肤分支仍在，且失败静默降级（不许把增强层变成硬依赖）', () => {
  const body = fnBodyOf(read('phone/font-scale.js'), 'async function ensureGlobalPhoneCSS() {');
  assert.ok(body.includes("'rp-pixel-skin'"), '像素皮肤 style id 必须保留');
  assert.ok(body.includes("'phone-theme-pack'"), '必须仍按主题包开关判定');
  assert.ok(body.includes("__pack !== 'pixel'"), '非 pixel 包必须走摘除而不是加载');
  assert.ok(/静默/.test(body), '像素皮肤失败必须静默（不能让「皮肤没加载」变成手机不可用）');
});

/* ══════════════ B. 分层单源：legacy 生成物与皮肤层口径 ══════════════ */

test('B1 legacy-phone.css 与生成器同源（--check 必须一致，产物不许比源旧）', () => {
  /* 「生成物比源旧」本轮实测发生过：产物停在 11-22 / baf87bf，源已到 11-23 / 4.187.0。
   * 这里不重写生成逻辑（两份取数必然漂移），直接把生成器自己的 --check 当作门。 */
  const out = execFileSync(process.execPath, ['scripts/gen-legacy-layer.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /一致/, '生成器 --check 必须报一致：' + out.trim());
});

test('B2 manifest 的 css 入口必须把皮肤层 @import 进来（分层与层序才成立）', () => {
  const man = JSON.parse(read('manifest.json'));
  assert.equal(man.css, 'phone/design/rp-entry.css', 'manifest css 入口');
  const entry = read('phone/design/rp-entry.css');
  assert.ok(/@import\s+url\("\.\/rp-desktop-v2\.css"\)/.test(entry), '入口必须 @import 桌面 v2 皮肤');
  assert.ok(/@import\s+url\("\.\/legacy-phone\.css"\)\s+layer\(rp\.legacy\)/.test(entry),
    '旧表必须以 layer(rp.legacy) 下沉（否则旧样式压过皮肤层）');
});

test('B3 真规则里零 !important：皮肤层与 legacy 产物都不许用「打架」代替层序', () => {
  const d2 = read('phone/design/rp-desktop-v2.css');
  const bang = (stripComments(d2).match(/!\s*important/gi) || []).length;
  assert.equal(bang, 0, `rp-desktop-v2.css 有 ${bang} 处 important —— 皮肤层一旦带它，`
    + '将来任何人都会用叠加 important 的方式「让皮肤生效」，层序就废了');
  assert.ok(/^@layer rp\.components \{/m.test(d2), '皮肤层必须整份包在 @layer rp.components');
  const leg = read('phone/design/legacy-phone.css');
  const legBang = (stripComments(leg).match(/!\s*important/gi) || []).length;
  assert.equal(legBang, 0, `legacy-phone.css 有 ${legBang} 处 important —— 生成器必须去掉它，`
    + '否则分层副本仍会压过皮肤层（等于什么都没改）');
  assert.ok(/^@layer rp\.legacy \{/m.test(leg), 'legacy 产物必须整份包在 @layer rp.legacy');
});

/* ══════════════ C. 接线：属性、默认值、作用域 ══════════════ */

test('C1 桌面 v2 的开关真的挂着且默认开（storage phone-desktop-v2=0 才关）', () => {
  const src = read('phone/home-screen.js');
  assert.ok(src.includes("' data-rp-desktop=\"2\"'"), 'home-screen 必须把属性拼进 DOM 字符串');
  const g = fnBodyOf(src, 'getDesktopV2() {');
  assert.ok(g.includes("'phone-desktop-v2'"), '默认值绑定的 storage 键名必须可读');
  assert.ok(/raw === undefined/.test(g) && /raw === null/.test(g), '未设置/null 都必须落到默认分支');
  assert.ok(/!== '0'/.test(g), "只有显式 '0' 才关（写反了就会默认关）");
  assert.ok(/return String\(/.test(g), '必须有显式返回值');
});

test('C2 皮肤层每条真规则都必须落在属性作用域内（默认零命中，可回退）', () => {
  const all = rulesOf(read('phone/design/rp-desktop-v2.css'));
  /* 实测真规则 29 条（文件里共 31 个花括号块 = 29 条规则 + 1 个 @keyframes 容器
   *   + 1 个 @media 容器）。下限取 25：低于它就是抽取器坏了（会静默漏检）。 */
  assert.ok(all.length >= 25, `真规则数过少（${all.length}）—— 抽取器失效，本判据会假绿`);
  for (const sel of all) {
    assert.ok(sel.includes(ATTR),
      '有一条规则没挂在属性开关上（默认会命中，等于不能回退）：' + sel.slice(0, 90));
    assert.ok(sel.startsWith('#phone-panel-content .phone-screen'),
      '作用域前缀必须是 #phone-panel-content .phone-screen'
      + '（对照 phone.css 的 .phone-screen .home-screen 口径）：' + sel.slice(0, 90));
  }
});

/* ══════════════ V. 版本锚（下限形） ══════════════ */

test('V1 版本不低于 4.200.0', () => {
  const pkg = JSON.parse(read('package.json'));
  const [a, b, c] = String(pkg.version).split('.').map(Number);
  const cur = a * 1000000 + b * 1000 + c;
  const floor = 4 * 1000000 + 200 * 1000 + 0;
  assert.ok(cur >= floor, `版本 ${pkg.version} 低于 4.200.0`);
});

test('V2 五源同源 + 本版条目与公告逐字同源（items ≥ 8 且含收尾条）', () => {
  const pkg = JSON.parse(read('package.json'));
  const man = JSON.parse(read('manifest.json'));
  const log = JSON.parse(read('update-log.json'));
  const idx = read('index.js');
  const mv = /const ST_PHONE_VERSION = '([^']+)'/.exec(idx);
  const vals = [pkg.version, man.version, log.latest, mv && mv[1]];
  assert.equal(new Set(vals).size, 1, `五源不同源：${vals}`);
  assert.equal(log.head, log.latest, 'update-log.json 的 head 必须等于 latest');
  const e = log.versions[log.latest];
  assert.ok(e, '本版条目存在');
  assert.ok(e.items.length >= 8, `本版条目只有 ${e.items.length} 条（约定 ≥ 8）`);
  assert.ok(e.items.some((it) => it.startsWith('【版本升至 ' + log.latest + '（五源同源）】')),
    '必须有收尾条目「【版本升至 X（五源同源）】」');
  const block = /const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/.exec(idx);
  assert.ok(block, 'ST_PHONE_CURRENT_UPDATE 可提取');
  for (const it of e.items) {
    assert.ok(block[0].includes(JSON.stringify(it)), '公告项逐字同源：' + it.slice(0, 24) + '…');
  }
  assert.ok(block[0].includes('date: "' + e.date + '"'), '公告 date 必须与条目同源');
});

/* ══════════════ G. 负控制（真源码破坏 ⇒ 同款判据必红） ══════════════ */

test('G1 ★ 负控制：把 legacy 产物改一个字节 ⇒ B1 的 --check 必红', () => {
  withTamper(LEG, (s) => s.replace('@layer rp.legacy {', '@layer rp.legacy { /*tamper*/'), () => {
    let code = 0;
    let msg = '';
    try {
      execFileSync(process.execPath, ['scripts/gen-legacy-layer.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    } catch (err) {
      code = err.status;
      msg = String(err.stdout || '') + String(err.stderr || '');
    }
    assert.equal(code, 1, '产物被改后 --check 必须退出码 1（若仍为 0 ⇒ B1 只是「跑了生成器」而不是比对内容）：'
      + msg.slice(0, 200));
  });
});

test('G2 ★ 负控制：把皮肤层外层 @layer 去掉 ⇒ B3 必红（分层才是生效前提）', () => {
  withTamper(D2, (s) => s.replace('@layer rp.components {', ''), () => {
    const d2 = fs.readFileSync(D2, 'utf8');
    assert.equal(/^@layer rp\.components \{/m.test(d2), false, '破坏点必须真的把外层 @layer 去掉');
    assert.throws(() => {
      assert.ok(/^@layer rp\.components \{/m.test(d2), '皮肤层必须整份包在 @layer rp.components');
    }, '去掉外层 @layer 后 B3 的断言必须失败（否则 B3 是假绿）');
  });
});

test('G3 ★ 负控制：把旧注入形恢复进 ensureGlobalPhoneCSS ⇒ A1 必红', () => {
  withTamper(FS,
    (s) => s.replace("const styleId = 'st-phone-global-css';",
      "const styleId = 'st-phone-global-css'; fetch(ST_PHONE_GLOBAL_CSS_URL, { cache: 'no-cache' });"),
    () => {
      assert.throws(() => {
        const src = fs.readFileSync(FS, 'utf8');
        assert.equal(src.includes('fetch(ST_PHONE_GLOBAL_CSS_URL'), false, 'A1 必须抓到这个旧形');
      }, '把根表 fetch 写回去后 A1 必须转红（否则判据抓不到旧形）');
    });
});

test('G4 ★ 负控制：把属性从 DOM 字符串里摘掉 ⇒ C1 必红', () => {
  withTamper(path.join(ROOT, 'phone/home-screen.js'),
    (s) => s.replace("? ' data-rp-desktop=\"2\"' : ''", "? ' data-rp-desktop-off=\"2\"' : ''"),
    () => {
      assert.throws(() => {
        const src = fs.readFileSync(path.join(ROOT, 'phone/home-screen.js'), 'utf8');
        assert.ok(src.includes("' data-rp-desktop=\"2\"'"), 'C1 必须抓到这个属性');
      }, '摘掉属性后 C1 必须转红（若仍绿 ⇒ C1 命中的是注释而不是代码）');
    });
});

test('G5 ★ 负控制：给皮肤层加一条 important ⇒ B3 必红，且 C2 的抽取器认得这条新规则', () => {
  withTamper(D2,
    (s) => s.replace('@layer rp.components {',
      '@layer rp.components {\n/*tamper*/ .phone-screen .home-screen { color: red !important; }'),
    () => {
      const d2 = fs.readFileSync(D2, 'utf8');
      const bang = (stripComments(d2).match(/!\s*important/gi) || []).length;
      assert.equal(bang, 1, '破坏点必须真写进一条 important（剥离注释后仍算数）');
      assert.throws(() => {
        assert.equal((stripComments(d2).match(/!\s*important/gi) || []).length, 0,
          '皮肤层真规则里不许有 important');
      }, '加一条 important 后 B3 必须转红');
      const sels = rulesOf(d2);
      assert.ok(sels.some((x) => x.includes('.phone-screen .home-screen')),
        'C2 的抽取器认不出新插入的规则 ⇒ C2 会漏掉「新增一条逃出作用域的规则」这种破坏');
    });
});