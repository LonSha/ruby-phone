/* ============================================================
 * tools/gen_status_ledger.mjs — R-O9 的状态台账**生成器**
 * ------------------------------------------------------------
 * R-O9 的真实需求（计划原文）：「`PLAN.md`、`TODO.md`、`ITERATION_LOG.md` 与真实
 * HEAD 之间仍存在历史快照混杂……台账表没有判据看守，每次抬版靠人肉复算。」
 *
 * 本工具的回答：把「当前状态」从**散文**变成**机器可读的一份账**，
 * 每个数都从磁盘现读一次，写完带 `generated_from` 与 `source_digest`。
 * 判据（tests/system-v3730.test.mjs）另跑同一批取数函数并对账 ——
 * 台账与磁盘不一致就转红，不靠人记得重跑。
 *
 * 为什么生成器与判据**共用同一份取数函数**而不是各写一遍：
 *   两份取数必然漂移，漂移的后果是「同一个读数在两处显示成不同结论」——
 *   本仓已在 `browser-runner` 的 printReports 上立过同款纪律
 *   （判据在场景里、格式化在库里，不许各抄一份）。
 *   故本文件**导出** `collectStatus()`，判据 import 它，不重写。
 *
 * 「未知不报 0，未执行不报通过」（R-O9 验收原文）在本文件里的落法：
 *   每个计数格要么是真数，要么是 `null`（并在 `unknown[]` 里说明为什么）。
 *   绝不把「数不出来」塌成 0 —— 那正是本仓最贵的假绿形态。
 *
 * 用法：
 *   node tools/gen_status_ledger.mjs            # 打印 JSON 到 stdout
 *   node tools/gen_status_ledger.mjs --write    # 写入 tests/audit/status-ledger.json
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (_e) { return null; }
}
function listDir(rel) {
  try { return fs.readdirSync(path.join(ROOT, rel)); } catch (_e) { return null; }
}
function countFiles(rel, filter) {
  const names = listDir(rel);
  if (!names) return null;
  return names.filter(filter).length;
}
/** 目录是否存在（不存在与「存在但空」必须不同形）。 */
function dirExists(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).isDirectory(); } catch (_e) { return false; }
}
/** 扫描面的内容摘要：用于「干净检出后能重建同一份基线」这一条。 */
function digestOf(rels) {
  const h = crypto.createHash('sha256');
  for (const rel of rels) {
    try {
      const buf = fs.readFileSync(path.join(ROOT, rel));
      h.update(rel);
      h.update('\0');
      h.update(buf);
    } catch (_e) {
      h.update(rel + '\0MISSING');
    }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * 现场取数。返回一份**可序列化**的账。
 * 数字格三态：真数 / 0（真的数出来是零）/ null（数不出来，必须在 unknown 里有解释）。
 */
export function collectStatus() {
  const unknown = [];
  const pkg = readJson('package.json');
  const man = readJson('manifest.json');
  const ul = readJson('update-log.json');

  /* ── 版本面：三源同源；不同源如实记，不取其中一个 */
  const v = {
    package: pkg ? String(pkg.version || '') : null,
    manifest: man ? String(man.version || '') : null,
    update_log_latest: ul ? String(ul.latest || '') : null,
    index_const: null,
  };
  try {
    const ij = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const m = /const ST_PHONE_VERSION = '([^']+)'/.exec(ij);
    v.index_const = m ? m[1] : null;
  } catch (_e) { v.index_const = null; }
  const versionSources = [v.package, v.manifest, v.update_log_latest, v.index_const]
    .filter((x) => typeof x === 'string' && x.length > 0);
  const versionSame = versionSources.length === 4 && new Set(versionSources).size === 1;
  if (!versionSame) {
    unknown.push(`版本四源不全同源：package=${v.package} manifest=${v.manifest} update-log=${v.update_log_latest} index=${v.index_const}`);
  }

  /* ── 门禁面：静态门（scripts/*.mjs）与 npm scripts 链 */
  const scriptNames = listDir('scripts');
  const gates = scriptNames
    ? scriptNames.filter((n) => n.endsWith('-check.mjs') || n.endsWith('-audit.mjs')).sort()
    : null;
  if (!gates) unknown.push('scripts/ 读不到，静态门清单为 null');
  const checkChain = (pkg && pkg.scripts && typeof pkg.scripts.check === 'string')
    ? (pkg.scripts.check.match(/npm run ([a-z0-9-]+)/g) || []).map((s) => s.replace('npm run ', ''))
    : null;
  if (!checkChain) unknown.push('package.json 的 check 链读不到');

  /* ── 测试面 ──
   * ★ 自指排除：状态台账自己就落在 `tests/audit/` 里，若不排除，
   *   则「写入台账」这一动作本身会让读数 +1 —— 台账与现场**永远差一**，
   *   而这差一会被 S3 判成漂移。**它不是漂移，是自指**。
   *   判据（tests/system-v3730.test.mjs 的 S3）第一次真跑就抓住了这一点，
   *   故此处显式排除，并把排除口径**写进台账**（口径不许只活在代码里）。 */
  const tests = countFiles('tests', (n) => n.endsWith('.test.mjs') || n.endsWith('.test.cjs'));
  if (tests === null) unknown.push('tests/ 读不到，测试文件数为 null');
  const auditDirExists = dirExists('tests/audit');
  const SELF_AUDIT_FILE = 'status-ledger.json';
  const auditFiles = auditDirExists
    ? (listDir('tests/audit') || []).filter((n) => n !== SELF_AUDIT_FILE).length
    : null;

  /* ── 浏览器层（L4）：场景与基建 */
  const scenAll = listDir('tests/browser/scenarios');
  const scen = scenAll ? scenAll.filter((n) => n.endsWith('.scen.js') && !n.startsWith('_')).sort() : null;
  const scenProbes = scenAll ? scenAll.filter((n) => n.endsWith('.scen.js') && n.startsWith('_')).length : null;
  if (!scen) unknown.push('tests/browser/scenarios/ 读不到，浏览器场景清单为 null');
  const l4 = {
    runner: fs.existsSync(path.join(ROOT, 'tests/browser/browser-runner.mjs')),
    driver: fs.existsSync(path.join(ROOT, 'tests/browser/run-scenario.mjs')),
    gate: fs.existsSync(path.join(ROOT, 'tests/browser/gate.mjs')),
    host_stub: fs.existsSync(path.join(ROOT, 'tests/browser/host-stub.mjs')),
  };

  /* ── 素材依赖面（R-O9 工作第 4 条）──
   * 计划原文：「干净检出依赖 `.sourcematerial` 的用例按『公开夹具验机制 /
   *   私有真素材验保真』两组分报。」
   *
   * 为什么必须分报（不分报会把两种**含义相反**的红塌成一个数）：
   *   · `.sourcematerial/` 是**私有源档**，`.gitignore` 不 track（实测
   *     `git ls-files | grep sourcematerial` = 0 条）⇒ 干净检出**必然缺席**；
   *   · 缺席时那些用例读不到源档 ⇒ 报红。这一种红说的是「本机没有私有素材」，
   *     **不是**「产品坏了」；
   *   · 而素材在场时跑出来的红才是真的产品/机制缺陷。
   *   两组混在一个「测试失败数」里，读的人无从分辨 —— 这正是本仓一贯治的
   *   「两种不同的事被显示成同一件」。
   *
   * 本格的取数口径（只认**磁盘现状**，不猜「应该有」）：
   *   suite_files：tests/ 下正文里出现 `.sourcematerial` 的套件数（真读文件内容）；
   *   suite_list ：其文件名清单（判据据此逐条核回磁盘）；
   *   material_present：私有素材目录此刻是否在场（split 的分组依据）；
   *   groups     ：两组各自的套件数与**当前可跑性**。
   *     · mechanism（公开夹具验机制）：不依赖私有素材的用例 ⇒ 任何检出都可跑；
   *     · fidelity （私有真素材验保真）：依赖 `.sourcematerial` 的用例 ⇒
   *       素材缺席时登记 `unrunnable`，**不登记为「通过」，也不登记为「产品红」**。
   *   ★ 本格不报「哪一组绿了」：那要真跑；台账只报**可跑性**（静态可判定），
   *     真跑结果归各档门禁。未知不报 0 —— 数不出来一律 null + unknown 说明。
   */
  const testNames = listDir('tests');
  let materialSuites = null;
  if (!testNames) {
    unknown.push('tests/ 读不到，素材依赖套件清单为 null');
  } else {
    materialSuites = testNames
      .filter((n) => n.endsWith('.test.mjs'))
      .filter((n) => {
        try { return fs.readFileSync(path.join(ROOT, 'tests', n), 'utf8').includes('.sourcematerial'); }
        catch (_e) { return false; }
      })
      .sort();
  }
  const materialDir = dirExists('.sourcematerial');
  let materialFiles = null;
  if (materialDir) {
    try {
      materialFiles = fs.readdirSync(path.join(ROOT, '.sourcematerial')).length;
    } catch (_e) { materialFiles = null; unknown.push('.sourcematerial/ 存在但列不出内容，文件数为 null'); }
  }

  /* ── 应用面（规模读数） */
  const appDirs = listDir('apps');
  const appCount = appDirs ? appDirs.filter((n) => dirExists(path.join('apps', n))).length : null;
  if (appCount === null) unknown.push('apps/ 读不到，App 目录数为 null');
  let appsIds = null;
  try {
    const src = fs.readFileSync(path.join(ROOT, 'config/apps.js'), 'utf8');
    // 只数 id 字段（口径与浏览器场景 A1 一致：config/apps.js 的 id 条数）
    appsIds = (src.match(/^\s*id:\s*'/gm) || []).length;
    if (appsIds === 0) { appsIds = null; unknown.push('config/apps.js 里 id 条数解析为 0（口径可能变了），如实记 null'); }
  } catch (_e) {
    unknown.push('config/apps.js 读不到，APPS id 数为 null');
  }

  /* ── 体量面 */
  let indexLines = null;
  try {
    indexLines = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8').split('\n').length;
  } catch (_e) { unknown.push('index.js 读不到，行数为 null'); }
  let cssBytes = null;
  try { cssBytes = fs.statSync(path.join(ROOT, 'phone.css')).size; } catch (_e) { unknown.push('phone.css 读不到，字节数为 null'); }

  /* ── 跨仓面（上游冻结读数；跨仓只读，拿不到就 null） */
  let upstream = null;
  try {
    const reg = fs.readFileSync(path.join(ROOT, 'config/crossrepo-registry.js'), 'utf8');
    upstream = {
      produced_faces: (reg.match(/since:/g) || []).length || null,
    };
  } catch (_e) { unknown.push('config/crossrepo-registry.js 读不到，跨仓面为 null'); }

  /* ── 摘要面（干净检出重建基线的锚） */
  const digestScope = ['package.json', 'manifest.json', 'update-log.json'];
  const digest = digestOf(digestScope);

  return {
    schema: 'status-ledger@1',
    generated_by: 'tools/gen_status_ledger.mjs',
    version: versionSame ? versionSources[0] : null,
    version_sources: v,
    version_same: versionSame,
    gates: {
      static_gate_files: gates ? gates.length : null,
      static_gate_list: gates,
      check_chain: checkChain,
      check_chain_len: checkChain ? checkChain.length : null,
    },
    tests: {
      test_files: tests,
      audit_dir_exists: auditDirExists,
      audit_files: auditFiles,
    },
    browser: {
      scenarios: scen,
      scenario_count: scen ? scen.length : null,
      probe_scenarios: scenProbes,
      infra: l4,
      /* 环境面：本机此刻有没有浏览器。
       * ★ 三态而不是两态：**未设置环境变量**（null）与**设了但没设**是两件事，
       *   而「设了」也不等于「可用」—— 可用性归 findBrowser 探针（要起进程）。
       *   台账在这一格只如实记「有没有显式指定」；把 null 当成"没有浏览器"
       *   或"未执行"都是把两件事塌成一件。S4 要求 null 必须自带解释，故这里
       *   连同解释一起记进 unknown[] 之外的 self_explained 面。 */
      chromium_env: process.env.RUBY_PHONE_CHROMIUM || null,
      chromium_env_note: process.env.RUBY_PHONE_CHROMIUM
        ? '显式指定了 RUBY_PHONE_CHROMIUM（可用性仍须由探针判定）'
        : '未显式指定 RUBY_PHONE_CHROMIUM —— 走 Playwright 缓存探测通道；本格为 null 表示「未指定」，不表示「没有浏览器」',
    },
    scale: {
      app_dirs: appCount,
      apps_ids: appsIds,
      index_lines: indexLines,
      css_bytes: cssBytes,
      crossrepo: upstream,
    },
    /* ── 素材依赖两组分报（R-O9 工作第 4 条 · 验收第 2 条「未知不报 0」）──
     * 两组**分列**，各自带 group / suite_files / suite_list / runnable / why。
     * 「可跑性」是静态可判定的（素材在不在场），故能进台账；
     * 「跑没跑过、跑绿没绿」要真执行，**不在本格**（那属各档门禁的输出）——
     * 把没跑过的组写成 pass 就是「未执行报通过」，本仓明令禁止。 */
    material_split: {
      material_dir: '.sourcematerial',
      material_present: materialDir,
      material_files: materialFiles,
      /* 素材目录不在场时 material_files 为 null —— 必须自带解释（S4「未知不报 0」）。
         null 在这里的准确含义是**「无此目录，故无可数」**，不是「数出来是 0 个文件」：
         前者是「本机没有私有素材」，后者会读成「素材在但空」，两件事含义相反。 */
      material_files_note: materialDir
        ? '私有素材目录在场，文件数为实读'
        : '`.sourcematerial/` 不在场（私有素材未随仓分发）⇒ 文件数无意义，记 null；'
          + '本格为 null 表示「没有这个目录」，不表示「目录里是 0 个文件」',
      suite_files: materialSuites ? materialSuites.length : null,
      suite_list: materialSuites,
      scanner: 'tests/ 下正文含 ".sourcematerial" 的 *.test.mjs（读文件内容，不按文件名猜）',
      groups: [
        {
          id: 'mechanism',
          label: '公开夹具验机制',
          /* 不依赖私有素材的那一大批 —— 数得出总数，清单不落台账（216 条太长，
             清单归 tests/ 目录本身；此处只落**可跑性**这一格的依据）。 */
          suite_scope: 'tests/ 下不含 ".sourcematerial" 的套件',
          suite_files: (testNames && materialSuites)
            ? testNames.filter((n) => n.endsWith('.test.mjs')).length - materialSuites.length
            : null,
          runnable: true,
          why: '不读私有素材 ⇒ 干净检出即可跑（本组永远是「可跑」，缺的只是「跑没跑」）',
        },
        {
          id: 'fidelity',
          label: '私有真素材验保真',
          suite_scope: 'tests/ 下正文含 ".sourcematerial" 的套件',
          suite_files: materialSuites ? materialSuites.length : null,
          suite_list: materialSuites,
          runnable: materialDir === true,
          why: materialDir
            ? '私有素材在场 ⇒ 本组可跑（真跑结果归各档门禁，本格只说可跑性）'
            : '私有素材缺席（.gitignore 不 track ⇒ 干净检出必然如此）⇒ **本组不可跑**：'
              + '如实登记 unrunnable，既不报通过，也不算作产品红',
        },
      ],
      /* 口径声明：避免读者把「组内套件数」读成「组内通过数」。 */
      note: '本格只报**可跑性**（静态可判定），不报跑绿与否 —— 那要真执行，归门禁输出。'
        + '「套件数 ≠ 通过数」；素材缺席组不得计入任何「通过」分子。',
    },
    digest: { scope: digestScope, sha256_16: digest },
    unknown,
    unknown_count: unknown.length,
  };
}

/* ── CLI ── */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = collectStatus();
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    const dest = path.join(ROOT, 'tests/audit/status-ledger.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    console.log(`[status-ledger] 已写入 ${path.relative(ROOT, dest)} —— ver=${out.version} 测试 ${out.tests.test_files} 门 ${out.gates.static_gate_files} 场景 ${out.browser.scenario_count} unknown=${out.unknown_count}`);
  } else {
    process.stdout.write(text);
  }
}