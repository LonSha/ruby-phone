// tests/system-v3150.test.mjs — 洞察 App：使用统计采集面 + 联系人互动分析（计划 #52 + #53）[v3.15.0]
//
//   本版的判据要先回答一个比「功能对不对」更要紧的问题：**这两层坏掉的时候，谁会知道。**
//   本仓最贵的形态是「不报错、不崩溃、只错结论」，而本版两层正好都是这种形态：
//     ① 采集面坏掉 ⇒ 展示面只会显示「还没有记录」—— 与你真的还没用过**完全同形**；
//     ② 微信正文未加载 ⇒ 按空桶算会得到「这个联系人从没聊过」这种**漂亮的假零**。
//   故本套件按三条纪律立判据（单一读写门 / 不抛 / 不猜），并要求每条都能对真源码破坏有反应。
//
//   覆盖：
//     A 接线面（采集咽喉点两处的位置关系 / 单一读写门 / 键归属 / 采集面自检可达 / 不抛）
//     B 时长纪律（4 小时封顶 / 时钟跳变不得出负时长 / 次数在打开时即计 / 裁剪防膨胀）
//     C 形态面（引号转义防退化 / 无记录画虚线 / 取数口径单一份 / 归因面）
//     D 负控制（真源码破坏 → 副本树上重跑**同一份**判据必须转红；含阳性对照自证）
//     E 版本锚（下限形 + 当版条目非空）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const IDX_REL = 'index.js';
const TRK_REL = 'config/usage-tracker.js';
const INS_REL = 'config/contact-insight.js';
const VIEW_REL = 'apps/usage/usage-view.js';
const APP_REL = 'apps/usage/usage-app.js';
const DATA_REL = 'apps/usage/usage-data.js';

const IDX = read(IDX_REL);
const TRK = read(TRK_REL);
const INS = read(INS_REL);
const VIEW = read(VIEW_REL);
const APP = read(APP_REL);
const DATA = read(DATA_REL);

const T = await import('../config/usage-tracker.js');
const I = await import('../config/contact-insight.js');
const D = await import('../apps/usage/usage-data.js');

/* ══════════ T1—T4 ── 「同一份判据」（原件与破坏副本上跑的是它们） ══════════ */

/** T1 使用统计内核：空读数不给假 0 / 时长封顶 / 时钟跳变不给负时长 / 打开即计次。 */
function trackerJudge(m) {
  try {
    const bad = m.readUsage({ get: () => '{ 这不是 JSON', set: () => { throw new Error('boom'); } });
    if (Object.keys(bad.days).length !== 0) return false;
    if (bad.open !== null) return false;
    const rows = m.dailyRows(bad, 7);
    if (rows.length !== 7) return false;
    if (!rows.every((r) => r.ms === null)) return false;   // 无记录的日子必须是 null
    if (!rows.every((r) => r.count === null)) return false;

    const u = m.normalizeUsage(null);
    m.noteOpen(u, 'wechat', 1000);
    if (!u.open || u.open.appId !== 'wechat') return false;
    if (m.usageSummary(u).totalCount !== 1) return false;  // 打开时即计次

    if (m.settleOpen(m.normalizeUsage(null), 0) !== null) return false;  // 幂等：没挂着就是空操作

    const u2 = m.normalizeUsage(null);
    u2.open = { appId: 'wechat', at: 0 };
    const capped = m.settleOpen(u2, 10 * 60 * 60 * 1000);
    if (!capped || capped.ms !== m.USAGE_MAX_VISIT_MS) return false;      // 挂着一天只按 4 小时记

    const u3 = m.normalizeUsage(null);
    u3.open = { appId: 'wechat', at: 5000 };
    const back = m.settleOpen(u3, 4000);
    if (!back || back.ms !== 0) return false;                            // 时间倒流不出负时长

    if (m.usageSummary(m.normalizeUsage(null)).empty !== true) return false;
    return true;
  } catch (_e) { return false; }
}

/** T2 联系人内核：三态分形 / 未加载是下界不是 0 / 不像时间戳的值不得收下 / 读不到的沉底。 */
function insightJudge(m) {
  try {
    const now = Date.now();
    const ins = m.buildContactInsight({
      wechat: {
        chats: [
          { id: 'a', name: '甲', type: 'single', timestamp: now - 3 * 86400000 },
          { id: 'b', name: '乙', type: 'single', timestamp: now - 40 * 86400000 },
          { id: 'c', name: '丙', type: 'single', timestamp: 5 }
        ],
        buckets: {}, loadedIds: []
      }
    }, { now: now, staleDays: 30 });
    const by = (n) => ins.rows.find((r) => r.name === n);
    if (!by('甲') || !by('乙') || !by('丙')) return false;
    if (by('甲').freshness !== 'fresh') return false;
    if (by('乙').freshness !== 'stale') return false;
    if (by('丙').freshness !== 'unknown') return false;
    if (by('丙').at !== null) return false;
    if (by('甲').count !== null) return false;
    if (by('甲').partial !== true) return false;
    if (ins.partialWechat !== 3) return false;
    if (ins.rows[0].freshness !== 'fresh') return false;
    if (ins.rows[ins.rows.length - 1].freshness !== 'unknown') return false;
    const bare = m.buildContactInsight({}, {});
    if (bare.empty !== true) return false;
    if (bare.sources.find((s) => s.id === 'wechat').state !== 'no-host') return false;
    return true;
  } catch (_e) { return false; }
}

/** T3 接线面：采集咽喉点两处的位置关系 + 单一读写门（不得在咽喉点看见键字面量）。 */
function gateJudge(src) {
  try {
    const oEv = src.indexOf('phone:openApp');
    const guard = src.indexOf('if (Date.now() < homeGuardUntil)');
    const open = src.indexOf('usageTrackOpen(storage, appId)');
    const route = src.indexOf('const app = currentApps.find', open);
    if (!(oEv >= 0 && guard > oEv && open > guard && route > open)) return false;
    const gEv = src.indexOf("addEventListener('phone:goHome'");
    const close = src.indexOf('usageTrackClose(storage)');
    const zero = src.indexOf('currentApp = null;', close);
    if (!(gEv >= 0 && close > gEv && zero > close)) return false;
    if (!src.includes('trackerNote as usageTrackOpen')) return false;
    if (!src.includes('trackerClose as usageTrackClose')) return false;
    /* 只看**代码**：文件头的中文散文里合法地引着键名（用它说明「唯一读写口」是谁）。
     *   判据面不得被散文侵入 —— 本仓的老账，这里也要守。 */
    const code = src.slice(src.lastIndexOf('*/', open) + 2);
    if (code.includes('usage_stats_v1')) return false;
    return true;
  } catch (_e) { return false; }
}

/** T4 形态面：无记录画虚线占位 / 采集面自检卡 / 未加载条数如实标未知。 */
function viewJudge(src) {
  try {
    if (!src.includes('uq-bar-none')) return false;
    if (!src.includes('无记录')) return false;
    if (!src.includes('_selfCheckHTML()')) return false;
    if (!src.includes('条数未知')) return false;
    return true;
  } catch (_e) { return false; }
}

/* ══════════ 副本与破坏（绝不对真仓做破坏） ══════════ */
const temps = [];
function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3150_'));
  temps.push(dir);
  copyTreeSafe(path.join(ROOT, 'config'), path.join(dir, 'config'));
  fs.mkdirSync(path.join(dir, 'apps', 'usage'), { recursive: true });
  for (const rel of [APP_REL, DATA_REL, VIEW_REL, IDX_REL]) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
}
process.on('exit', () => {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* 忽略 */ } }
});
/** 真源码破坏：锚点必须**恰中一次**（多一点即意味着改了不该改的地方）。 */
function damage(rel, anchor, replacement) {
  const dir = makeCopy();
  const src = read(rel);
  const hits = src.split(anchor).length - 1;
  assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 70));
  fs.writeFileSync(path.join(dir, rel), src.split(anchor).join(replacement));
  return dir;
}
async function loadMod(dir, rel) {
  return import(pathToFileURL(path.join(dir, rel)).href + '?v=' + Date.now() + Math.random());
}

/* ══════════ A ── 接线面 ══════════ */
test('A1 ★★★ 采集咽喉点两处：打开记在 guard 之后 / 路由之前；回桌面记在清零之前', () => {
  const oEv = IDX.indexOf('phone:openApp');
  assert.ok(oEv >= 0, 'openApp 监听在场');
  const guard = IDX.indexOf('if (Date.now() < homeGuardUntil)');
  const open = IDX.indexOf('usageTrackOpen(storage, appId)');
  const route = IDX.indexOf('const app = currentApps.find', open);
  assert.ok(guard > oEv, 'guard 判定在监听体内');
  assert.ok(open > guard, '★ 采集必须在 guard 之后：被 _homeReturnGuardUntil 拦下的重入点击不是一次真实打开');
  assert.ok(route > open, '★ 采集必须在路由之前：热路径上先记账再开 App');
  const gEv = IDX.indexOf("addEventListener('phone:goHome'");
  const close = IDX.indexOf('usageTrackClose(storage)');
  const zero = IDX.indexOf('currentApp = null;', close);
  assert.ok(close > gEv, 'close 在 goHome 监听体内');
  assert.ok(zero > close, '★ close 必须在 currentApp 清零之前：清零后就没有「刚才是哪个 App」这条信息了');
  assert.ok(IDX.includes('trackerNote as usageTrackOpen'), '采集出口必须从唯一读写门来');
  assert.ok(IDX.includes('trackerClose as usageTrackClose'), '结算出口同上');
  const uStart = IDX.indexOf("} else if (appId === 'usage') {");
  const tail = IDX.slice(uStart + 30);
  const seg = tail.slice(0, tail.indexOf('} else if ('));
  assert.ok(seg.length > 200, '洞察分支必须找得到（切片不得空）');
  assert.equal(seg.includes('storage.set('), false, '★ 洞察 App 是纯只读面：打开统计页不得改动被统计的数据');
});

test('A2 ★★★ 单一读写门：统计键只有一处读写口，咽喉点自己绝不碰它', () => {
  const IDX_CODE = IDX.slice(IDX.lastIndexOf('*/', IDX.indexOf('usageTrackOpen')));
  assert.equal(IDX_CODE.includes('usage_stats_v1'), false, '★ index.js 不得出现统计键字面量（否则「谁在写这个键」没有答案）');
  assert.ok(TRK.includes("USAGE_KEY = 'usage_stats_v1'"), '键在唯一读写门里声明');
  assert.ok(TRK.includes('export function trackerNote'), '采集出口在场');
  assert.ok(TRK.includes('export function trackerClose'), '结算出口在场');
  assert.ok(TRK.includes('export function readUsage'), '读门在场');
  const stor = read('config/storage.js');
  assert.ok(stor.includes('/^usage_/'), '两键必须命中会话隔离面 /^usage_/');
  const ka = read('scripts/keys-audit.mjs');
  assert.ok(ka.includes('usage_stats_v1') && ka.includes('usage_settings_v1'), '两键都要在 keys 门里登记归属');
  assert.ok(!/function writeUsage[\s\S]{0,200}throw/.test(TRK), '写门不得外抛');
});

test('A3 ★★ 采集面自检在场：采集坏了与「你还没用过」必须可分辨', () => {
  assert.ok(APP.includes('selfCheck()'), 'App 必须暴露 selfCheck');
  assert.ok(APP.includes('usageSelfCheck'), '自检读数必须从唯一读写门取');
  assert.ok(VIEW.includes('_selfCheckHTML()'), '视图必须渲染自检卡');
  assert.ok(VIEW.includes('已记天数'), '自检卡必须给出「已记天数」这个可核对的读数');
  assert.ok(VIEW.includes('采集没在工作'), '自检卡必须写明它存在的理由：两种情形长得一模一样');
});

test('A4 ★★ 使用统计不进上下文（只注入联系人疏远度）', () => {
  assert.ok(APP.includes('contactPromptBlock(this._insight, 5)'), '注入块只由联系人洞察生成');
  const pb = APP.slice(APP.indexOf('promptBlock()'), APP.indexOf('_initHook()'));
  assert.ok(pb.length > 40, 'promptBlock 必须能切片');
  assert.equal(pb.includes('summaryLine()'), false, '★ 统计读数不得进 Prompt：写进上下文只会白烧 token');
  assert.ok(DATA.includes('export { formatDuration }'), '时长可读化只有一份实现');
});

test('A5 ★★ 采集点不做分支：采集是旁路，路由是主路', () => {
  const open = IDX.indexOf('usageTrackOpen(storage, appId)');
  const NLc = String.fromCharCode(10);
  const line = IDX.slice(IDX.lastIndexOf(NLc, open) + 1, IDX.indexOf(NLc, open));
  assert.ok(/^\s*try \{ usageTrackOpen\(storage, appId\); \} catch \(_e\)/.test(line), '调用必须被就地 try 包住且不看返回值：' + line.slice(0, 80));
});

/* ══════════ B ── 时长纪律（走真模块） ══════════ */
test('B1 ★★★ 时长：单次按 4 小时封顶；时钟跳变不得产生负时长；没挂着是空操作', () => {
  const u = T.normalizeUsage(null);
  T.noteOpen(u, 'wechat', 1000000);
  assert.equal(u.open.appId, 'wechat');
  assert.equal(T.settleOpen(T.normalizeUsage(null), 0), null, '★ 幂等：连按返回键 / 重复派发 goHome 不会重复计时');
  const u2 = T.normalizeUsage(null);
  u2.open = { appId: 'wechat', at: 0 };
  assert.equal(T.settleOpen(u2, 10 * 60 * 60 * 1000).ms, T.USAGE_MAX_VISIT_MS, '★ 把手机开着不管，不得把一个 App 算成用了一整天');
  const u3 = T.normalizeUsage(null);
  u3.open = { appId: 'wechat', at: 5000 };
  assert.equal(T.settleOpen(u3, 4000).ms, 0, '★ 时间倒流不得产生一条负时长，也不得产生天文数字');
  assert.equal(T.USAGE_MAX_VISIT_MS, 4 * 60 * 60 * 1000, '封顶值就是 4 小时');
});

test('B2 ★★ 次数在打开时即计（只记时长会让「开一下就关」的 App 完全消失）', () => {
  const u = T.normalizeUsage(null);
  T.noteOpen(u, 'gacha', 1000000);
  const s = T.usageSummary(u);
  assert.equal(s.totalCount, 1, '打开即计一次');
  assert.equal(s.topApp, 'gacha');
  assert.equal(s.empty, false);
});

test('B3 ★ 裁剪：超过 60 天的日子必须被裁掉（防 chatMetadata 长线膨胀）', () => {
  const days = {};
  for (let i = 0; i < 70; i++) {
    const key = T.usageDayKey(new Date(2026, 0, 1 + i).getTime());
    days[key] = { apps: { wechat: { count: 1, ms: 1000 } }, hours: { '1': 1 }, ms: 1000, count: 1 };
  }
  const u = T.normalizeUsage({ days: days });
  assert.equal(Object.keys(u.days).length, T.USAGE_MAX_DAYS, '裁剪到 ' + T.USAGE_MAX_DAYS + ' 天');
});

test('B4 ★★ 形态归一：畸形读数一律按「没给」处理，未知字段一律丢弃', () => {
  const u = T.normalizeUsage({
    days: { '不是日期': { apps: {} }, '2026-09-30': { apps: { wechat: { count: -3, ms: 'x' }, bad: null }, hours: { '99': 5, '3': 2 } } },
    open: { appId: '', at: 1 },
    我们没定义过的字段: 1
  });
  assert.deepEqual(Object.keys(u.days), ['2026-09-30'], '非法日期键必须被丢弃');
  assert.deepEqual(Object.keys(u.days['2026-09-30'].hours), ['3'], '越界小时（99）必须被丢弃');
  assert.equal(u.open, null, '畸形 open 必须丢弃');
  assert.equal('我们没定义过的字段' in u, false, '未知字段一律丢弃');
});

/* ══════════ C ── 形态面 ══════════ */
test('C1 ★★★ 引号转义不得退化回恒等替换（v3.10.1 / v257 F3 同款形态）', () => {
  const DQ = String.fromCharCode(34);
  const SQ = String.fromCharCode(39);
  const bad = 'replace(/' + DQ + '/g, ' + SQ + DQ + SQ + ')';
  const escBody = (/\n    _esc\(s\) \{[\s\S]*?\n    \}/.exec(VIEW) || [''])[0];
  assert.ok(escBody.length > 80, '本体可提取（否则判据是空转的）');
  assert.equal(escBody.includes(bad), false, '★ 右侧必须是实体而不是裸引号（写成裸引号即恒等替换，看起来一切都对）');
  assert.ok(VIEW.includes('x26quot'), '根因是实体字面量在写盘层会被就地解码 ⇒ 合法写法必须是转义序列形态');
  assert.ok(VIEW.includes('uq-stale') && VIEW.includes('uq-alert'), '疏远度必须有可见的强调形态');
});

test('C2 ★★ 近 7 天：无记录的日子画虚线占位而不是 0 高度实柱', () => {
  assert.ok(VIEW.includes('uq-bar-none'), '虚线占位类必须被用上');
  assert.ok(VIEW.includes('无记录'), '必须如实写「无记录」，不写「0 分钟」');
  assert.ok(VIEW.includes('d.ms !== null'), '判据是「读得到」而不是「大于 0」');
  const css = read('apps/usage/usage.css');
  assert.ok(css.includes('uq-bar-none'), '样式必须真的给虚线（只加类名不改样式是假修）');
  assert.ok(css.includes('dashed'), '虚线必须是 dashed');
  const phone = read('phone.css');
  assert.ok(phone.includes('uq-bar-none'), '样式必须投递进 phone.css（第九道门的样式投递面）');
});

test('C3 ★★ 取数口径只有一份实现（config/num-gate.js）', () => {
  assert.ok(INS.includes("import { numOrNull } from './num-gate.js'"), '联系人内核必须引用唯一实现');
  assert.equal(INS.includes('function numOrNull'), false, '★ 不得自带一份同义的 numOrNull（逐处复制即下一个漏网处）');
  assert.ok(INS.includes('978307200000'), '最近联系时间必须过「像不像毫秒时间戳」这一关');
  assert.ok(INS.includes("staleDays = numOrNull(opts.staleDays) !== null"), '阈值取数也走唯一实现');
});

test('C4 ★★ 取数归因：读不到的源不得被说成「没有联系人」', () => {
  assert.equal(typeof D.collectContactInsight, 'function');
  const ins = D.collectContactInsight({}, 30);
  assert.equal(ins.empty, true);
  assert.ok(ins.sources.some((s) => s.state !== 'ok'), '无宿主时必须留下归因');
  assert.ok(ins.sources.length >= 3, '三处来源都要有归因行');
  assert.ok(VIEW.includes('取数归因'), '视图必须把归因摆出来');
  assert.ok(VIEW.includes('表里没有不等于没有'), '★ 归因面必须写明这条推理边界');
});

test('C5 ★★ 注射块空内容返回空串（不得产生空块）', () => {
  assert.equal(I.contactPromptBlock(null), '');
  assert.equal(I.contactPromptBlock({ empty: true }), '');
  assert.equal(I.contactPromptBlock(I.buildContactInsight({}, {})), '', '无数据时不得注入空块');
  assert.equal(I.insightSummaryLine(null), '还没有可统计的联系人');
});

/* ══════════ D ── 负控制（真源码破坏 → 同一份判据必须转红） ══════════ */
test('D0 ★★★ 阳性对照：未破坏时四条判据必须全为真（否则 D 组是假绿）', async () => {
  assert.equal(trackerJudge(T), true, 'T1 在原件上必须为真');
  assert.equal(insightJudge(I), true, 'T2 在原件上必须为真');
  assert.equal(gateJudge(IDX), true, 'T3 在原件上必须为真');
  assert.equal(viewJudge(VIEW), true, 'T4 在原件上必须为真');
  const dir = makeCopy();
  assert.ok(fs.existsSync(path.join(dir, TRK_REL)), '副本树必须带上唯一读写门');
  assert.ok(fs.existsSync(path.join(dir, INS_REL)), '副本树必须带上联系人内核');
  assert.ok(fs.existsSync(path.join(dir, 'config/num-gate.js')), '副本树必须带上取数口径（否则是「因缺文件而红」的假绿）');
  assert.equal(await trackerJudge(await loadMod(dir, TRK_REL)), true, '未经破坏的副本树上 T1 必须仍为真');
  assert.equal(await insightJudge(await loadMod(dir, INS_REL)), true, '未经破坏的副本树上 T2 必须仍为真');
});

test('D1 ★★★ 破坏「时间倒流归零」⇒ T1 必须转红（负时长会污染时长读数）', async () => {
  const dir = damage(TRK_REL, 'if (!Number.isFinite(ms) || ms < 0) ms = 0;', 'void 0;');
  const m = await loadMod(dir, TRK_REL);
  const probe = m.normalizeUsage(null);
  probe.open = { appId: 'wechat', at: 5000 };
  assert.equal(m.settleOpen(probe, 4000).ms, -1000, '破坏后确实产出负时长（差异可观测）');
  assert.equal(trackerJudge(m), false, '★ T1 在破坏副本上必须为 false');
  assert.equal(trackerJudge(T), true, '对照：原件上仍为真');
});

test('D2 ★★★ 破坏「4 小时封顶」⇒ T1 必须转红', async () => {
  const dir = damage(TRK_REL, 'if (ms > USAGE_MAX_VISIT_MS) ms = USAGE_MAX_VISIT_MS;', 'void 0;');
  const m = await loadMod(dir, TRK_REL);
  const probe = m.normalizeUsage(null);
  probe.open = { appId: 'wechat', at: 0 };
  assert.equal(m.settleOpen(probe, 10 * 60 * 60 * 1000).ms, 10 * 60 * 60 * 1000, '破坏后确实不再封顶（差异可观测）');
  assert.equal(trackerJudge(m), false, '★ T1 在破坏副本上必须为 false');
});

test('D3 ★★★ 破坏「无记录的日子如实 null」⇒ T1 必须转红（假零是要害）', async () => {
  const dir = damage(TRK_REL, 'ms: rec ? asFiniteInt(rec.ms) : null,', 'ms: rec ? asFiniteInt(rec.ms) : 0,');
  const m = await loadMod(dir, TRK_REL);
  assert.equal(m.dailyRows(m.normalizeUsage(null), 7)[0].ms, 0, '破坏后无记录的日子读成 0（差异可观测）');
  assert.equal(trackerJudge(m), false, '★ T1 在破坏副本上必须为 false');
});

test('D4 ★★★ 破坏「像不像毫秒时间戳」⇒ T2 必须转红（5 会被算成 55 年没联系）', async () => {
  const dir = damage(INS_REL, 'if (n !== null && n > 978307200000) return { at: n, via: c.via };', 'if (n !== null) return { at: n, via: c.via };');
  const m = await loadMod(dir, INS_REL);
  const ins = m.buildContactInsight({ wechat: { chats: [{ id: 'c', name: '丙', type: 'single', timestamp: 5 }], buckets: {}, loadedIds: [] } }, { now: Date.now(), staleDays: 30 });
  assert.equal(ins.rows[0].freshness, 'stale', '破坏后 5 被当成时间戳（差异可观测）');
  assert.equal(insightJudge(m), false, '★ T2 在破坏副本上必须为 false');
  assert.equal(insightJudge(I), true, '对照：原件上仍为真');
});

test('D5 ★★★ 破坏「未加载的会话是下界」⇒ T2 必须转红（漂亮的假零）', async () => {
  const dir = damage(INS_REL, 'const count = (bucket && isLoaded) ? bucket.length : null;', 'const count = (bucket && isLoaded) ? bucket.length : 0;');
  const m = await loadMod(dir, INS_REL);
  const ins = m.buildContactInsight({ wechat: { chats: [{ id: 'a', name: '甲', type: 'single', timestamp: Date.now() }], buckets: {}, loadedIds: [] } }, { now: Date.now(), staleDays: 30 });
  assert.equal(ins.rows[0].count, 0, '破坏后未加载被算成 0 条（差异可观测）');
  assert.equal(insightJudge(m), false, '★ T2 在破坏副本上必须为 false');
});

test('D6 ★★★ 抽掉开 App 采集点 ⇒ T3 必须转红（位置关系判据是可观测的）', async () => {
  const dir = damage(IDX_REL, 'usageTrackOpen(storage, appId)', 'void 0');
  assert.equal(gateJudge(read(IDX_REL)), true, '对照：原件上仍为真');
  assert.equal(gateJudge(fs.readFileSync(path.join(dir, IDX_REL), 'utf8')), false, '★ T3 在破坏副本上必须为 false');
});

test('D7 ★★★ 抽掉回桌面结算点 ⇒ T3 必须转红', () => {
  const dir = damage(IDX_REL, 'usageTrackClose(storage)', 'void 0');
  assert.equal(gateJudge(fs.readFileSync(path.join(dir, IDX_REL), 'utf8')), false, '★ T3 在破坏副本上必须为 false');
});

test('D8 ★★ 抽掉「无记录画虚线」的类名 ⇒ T4 必须转红', () => {
  const dir = damage(VIEW_REL, 'uq-bar-none', 'uq-bar-x');
  assert.equal(viewJudge(fs.readFileSync(path.join(dir, VIEW_REL), 'utf8')), false, '★ T4 在破坏副本上必须为 false');
  assert.equal(viewJudge(VIEW), true, '对照：原件上仍为真');
});

/* ══════════ E ── 版本锚 ══════════ */
const VNUM = (s) => Number(String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0));
test('E1 ★ 版本锚（下限形）+ 当版条目非空 + 弹窗文案不含方括号', () => {
  const man = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  const log = JSON.parse(read('update-log.json'));
  const idx = read(IDX_REL);
  const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
  assert.ok(codeVer, '入口版本常量在场');
  assert.equal(codeVer, man.version, '入口 == manifest');
  assert.equal(pkg.version, man.version, 'package == manifest');
  assert.equal(log.latest, man.version, 'update-log.latest == manifest');
  assert.ok(VNUM(man.version) >= VNUM('3.15.0'), '本套件自 3.15.0 起成立；当前 ' + man.version);
  const items = log.versions[log.latest].items;
  /* [v3.17.1 交棒改写 —— 抬版即红的口径，主动改写而非静默改数]
   *   本行原是「当版条目不少于九条」的硬数字：那是本套件**出生版本 v3.15.0** 的当版精确判定
   *   （它的说明正好 9 条）。钉在 `log.latest` 上等于要求以后每一版都写满 9 条 ——
   *   v3.17.1 只写 10 条以外的版本会立刻翻红，而它钉的其实是**别版的历史事实**。
   *   按仓内既定口径（同 v312-E2 / v3160-F1）交棒为**结构下限**：当版条目非空即可；
   *   「当版条目数 / 弹窗逐字同源」由**当版套件**接管（本版即 v3171 的 E1）。
   *   注意：这里改的是**判据自己的口径**，不是把判据关掉 —— 下限仍然掷地有声（非空 + 逐条不含方括号）。 */
  assert.ok(Array.isArray(items) && items.length >= 4, '当版条目不得为空（结构下限 4；实测 ' + items.length + '）');
  for (const it of items) {
    assert.equal(it.includes('[') || it.includes(']'), false, '弹窗文案不得含方括号（既有当版切片判据按首个 ] 截断，会假红）');
  }
});
