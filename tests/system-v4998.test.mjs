/* ============================================================
 * tests/system-v4998.test.mjs — R11-X4 验收：分享与迁移面接成「可审阅的出口」
 * ------------------------------------------------------------
 * 【这一项为什么单列】
 *   三件内核（`sharing-boundary` / `portable-recovery-hub` / `offline-creator-bundle-pipeline`）
 *   早就写好了、也被 tests/ 逐条消费过，但**产品端零 import**：
 *     · 用户把一段内容发出去之前，看不到收件人会看到什么；
 *     · 发出去之后也撤不回来（内核早就有 revokeShare，产品端一次没调过）；
 *     · 导入前没人告诉他「这个包会动什么」。
 *   计划原文 R11-X4 的验收语：「预览页真能显示收件人可见范围；撤销后对方入口消失；
 *   导入前 diff 列出将改动的键数；拒绝导入时原数据逐字节不变。」
 *   前半句（可见范围）与「拒绝时数据不变」在本面可无头证；「对方入口消失」的**实际观感**
 *   属真机项，写进 `docs/runtime-verification-boundary.md`（见本档 Z 段）。
 *
 * 【直连为什么不行（本版真抓到的坑）】
 *   三件内核的返回体形状各不相同：
 *     · `previewRecipientView` → {status, content|null, reason}  —— 不可读时 content 是 null，
 *       但 `masked_partial` 与 `authorized` 都是「能看」，压成一句就等于骗用户
 *       「他看到的和你一样」；
 *     · `inspectBackupPayload` → {ok, version, totalAppScopes, totalEntries, error} ——
 *       「包认不出来」与「包里一条都没有」在这份返回体里**长得几乎一样**（都 ok:true 或都空）；
 *     · `validateAndPlanBundleImport` → {success, errors, warnings} —— 安全阻断与缺依赖提示
 *       都是「不为空」，若不分开，「包里带可执行脚本」会被念成一句普通警告。
 *   故本版先加一层形状态翻译（`config/share-migrate-bridge.js`），再上产品面。
 *
 * 【覆盖】
 *   A 授权五态：五句不同的话 / 坏值如实念 / 内核抛错另立一态 / 不可读不给内容
 *   B 痕迹：受众 / 已读 / 撤回留痕（撤回前已读 N 人这件事不许被抹掉）
 *   C 备份包体检：missing / rejected / ok(有数据) / ok(空包) 四形不同 + 不重复调内核
 *   D 创作者包计划：missing / 安全阻断 / 可装（含缺依赖提示）三形不同，blocked 语义
 *   E 接线自证：App 真 import 内核与桥 / 视图不写第二套授权判据 / 键三处同源 / 桥是纯函数
 *   F 产品面全链：起草 → 收件人视角 → 记读 → 撤回 → 撤回后视角（一条走到底）
 *   G 负控制：真源码破坏 ⇒ 在副本上重跑**同款判据**必须转红（双向断言，5 条）
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_STATUS } from '../config/sharing-boundary.js';
import {
  accessLabelOf, accessReadable, sharePreviewOf, shareTraceOf,
  payloadInspectFrom, bundlePlanOf
} from '../config/share-migrate-bridge.js';
import { BackupdeskApp, SHARE_KEY } from '../apps/backupdesk/backupdesk-app.js';
import { BackupdeskView } from '../apps/backupdesk/backupdesk-view.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');
const BRIDGE_REL = 'config/share-migrate-bridge.js';
const APP_REL = 'apps/backupdesk/backupdesk-app.js';
const VIEW_REL = 'apps/backupdesk/backupdesk-view.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── 夹具 ─────────────────────────────────────────────────── */
/** 内存 storage：与真 PhoneStorage 同口径 —— 存的是**字符串**。 */
function memStorage(init = {}, opts = {}) {
  const mem = new Map(Object.entries(init));
  const stub = {
    _mem: mem,
    get(k) {
      if (opts.getThrows) throw new Error('storage_get_boom');
      return mem.has(k) ? mem.get(k) : null;
    },
    set(k, v) {
      if (opts.setFails) return false;
      if (opts.setThrows) throw new Error('storage_set_boom');
      mem.set(k, v);
      return true;
    },
    keys: () => [...mem.keys()]
  };
  return stub;
}
/** 装一个 App；`render` 打桩（本档判 _vm() 与 _html()，不装 DOM）。 */
function mkApp(init = {}, opts = {}) {
  const storage = memStorage(init, opts);
  const app = new BackupdeskApp({ setContent() {}, screen: null }, storage);
  app.render = () => {};
  return { app, storage };
}
/** 一份真草案（字段与内核 buildShareDraft 同形，手写以便逐字段控制）。 */
function draftOf(over = {}) {
  return Object.assign({
    id: 'share_1', snippet: '这段是给你的悄悄话',
    scope: 'private_one_to_one', recipients: ['阿澈'],
    sensitiveTokens: [], reshareable: false, expiresAt: null,
    revoked: false, createdAt: 100, readLogs: []
  }, over);
}

/* ══════════ A ── 授权五态 ══════════ */
test('A1 五态五句话：authorized 与 masked_partial 绝不同形（同一句话就是骗用户「他看到的和你一样」）', () => {
  const all = Object.values(ACCESS_STATUS);
  assert.equal(all.length, 5, '内核必须是五态（少了就是内核被改坏）');
  const labels = all.map(accessLabelOf);
  assert.equal(new Set(labels).size, 5, '五个状态必须五句不同的话：' + JSON.stringify(labels));
  assert.deepEqual(all.filter(accessReadable), ['authorized', 'masked_partial'],
    '只有前两态算「能看」（其余三态界面不许给他画内容）');
  for (const s of ['unauthorized', 'expired', 'revoked']) assert.equal(accessReadable(s), false, s + ' 不可读');
  /* 遮蔽态必须自己说出来「已遮蔽」：这是它与原样看到之间**唯一**的用户可见差别。 */
  assert.match(accessLabelOf('masked_partial'), /遮蔽/, '遮蔽态文案必须出现「遮蔽」');
});

test('A2 坏值如实念：未知授权态不许回落成「可见」（回落到可见 = 把读坏演成一切正常）', () => {
  assert.match(accessLabelOf('weird_state'), /未知授权态/);
  assert.match(accessLabelOf('weird_state'), /weird_state/, '要说得出是哪个坏值');
  assert.equal(accessLabelOf(''), '授权态未判');
  assert.equal(accessLabelOf(null), '授权态未判');
  assert.equal(accessReadable('weird_state'), false, '坏值一律不可读（不许猜成能看）');
  assert.equal(accessReadable(null), false);
});

test('A3 不可读就是不给内容：内核把 content 带出来也不许透给视图（含 expired / revoked）', () => {
  const masked = sharePreviewOf(draftOf({ scope: 'shared_group', snippet: '他的秘密', sensitiveTokens: ['秘密'] }), '阿澈', 200);
  assert.equal(masked.status, 'masked_partial');
  assert.equal(masked.readable, true);
  assert.equal(masked.content, '他的***', '遮蔽态给的是遮蔽后的内容');
  assert.equal(masked.masked, true);

  const clean = sharePreviewOf(draftOf(), '阿澈', 200);
  assert.equal(clean.status, 'authorized');
  assert.equal(clean.content, '这段是给你的悄悄话');
  assert.equal(clean.masked, false, '授权态不许标成遮蔽');

  const unauth = sharePreviewOf(draftOf(), '路人', 200);
  assert.equal(unauth.status, 'unauthorized');
  assert.equal(unauth.readable, false);
  assert.equal(unauth.content, '', '无权看 ⇒ 一个字节都不给');

  const expired = sharePreviewOf(draftOf({ expiresAt: 50 }), '阿澈', 200);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.content, '', '过期 ⇒ 一个字节都不给');

  const revoked = sharePreviewOf(draftOf({ revoked: true, revokedAt: 60, revokeReason: '不想给了' }), '阿澈', 200);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.content, '', '撤回 ⇒ 一个字节都不给');
  /* 三态（无权/过期/撤回）**文案各不相同**：压成一句会让用户以为原因都一样。 */
  assert.equal(new Set([unauth.label, expired.label, revoked.label]).size, 3,
    '无权 / 过期 / 撤回必须三句不同的话');
});

test('A4 内核自己抛错 ≠ 无权查看：另立 threw 一态，界面据此说「判不出来」', () => {
  /* 造一份「一读属性就抛」的草案：内核 previewRecipientView 会在 includes 处炸。 */
  const evil = { revoked: false, expiresAt: null, scope: 'private_one_to_one', snippet: 'x' };
  Object.defineProperty(evil, 'recipients', { get() { throw new Error('boom_recipients'); } });
  const p = sharePreviewOf(evil, '阿澈', 200);
  assert.equal(p.status, 'threw', '抛错必须另立一态，不许混进 unauthorized');
  assert.equal(p.ok, false);
  assert.equal(p.readable, false);
  assert.equal(p.content, '');
  assert.match(p.why, /boom_recipients/, '要说得出内核为什么炸');
  assert.notEqual(p.label, accessLabelOf('unauthorized'), '「判不出来」与「看不到」不是同一句话');
});

/* ══════════ B ── 痕迹（受众 / 已读 / 撤回留痕） ══════════ */
test('B1 撤回不抹记忆：撤回前已读 N 人这件事必须留痕（内核契约，界面不许改写成「没人看过」）', () => {
  const read1 = draftOf({ readLogs: [{ readerId: '阿澈', readAt: 110 }, { readerId: '小满', readAt: 120 }] });
  const t1 = shareTraceOf(read1);
  assert.equal(t1.revoked, false);
  assert.equal(t1.readCount, 2);
  assert.match(t1.line, /受众 1 人 · 已读 2 人/);

  const revoked = shareTraceOf(draftOf({
    revoked: true, revokedAt: 130, revokeReason: '不想给了',
    readLogs: [{ readerId: '阿澈', readAt: 110 }]
  }));
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.revokedAt, 130);
  assert.equal(revoked.readCount, 1, '撤回后已读账**原样保留**');
  assert.match(revoked.line, /撤回前已读 1 人/, '必须明写撤回前已读人数');
  assert.match(revoked.line, /不会被抹掉/, '必须说明这段痕迹不抹');
  assert.match(revoked.line, /不想给了/, '撤回原因要念出来');

  /* 「没有收件人」与「撤回过」是三件不同的事，三句话。 */
  const empty = shareTraceOf(draftOf({ recipients: [] }));
  assert.equal(empty.readCount, 0);
  assert.match(empty.line, /还没有指定收件人/);
  assert.equal(new Set([empty.line, t1.line, revoked.line]).size, 3, '未指定 / 有受众 / 已撤回 三句不同');
});

test('B2 草案读不到要说成「读不到」，不许说成「没分享过」（两者处置相反）', () => {
  for (const bad of [null, undefined, 0, 'x']) {
    const t = shareTraceOf(bad);
    assert.equal(t.ok, false);
    assert.match(t.line, /读不到/);
    assert.ok(!/没有分享过/.test(t.line), '不许把「读不到」念成「没分享过」');
  }
});

test('B3 桥不改入参：预览与痕迹都不许往草案里写东西（草案是真源）', () => {
  const d = draftOf({ scope: 'shared_group', sensitiveTokens: ['悄悄话'] });
  const before = JSON.stringify(d);
  sharePreviewOf(d, '阿澈', 200);
  shareTraceOf(d);
  assert.equal(JSON.stringify(d), before, '入参必须一字不动');
  assert.equal(d.readLogs.length, 0, '预览不是「记已读」，不许往 readLogs 里塞东西');
});

/* ══════════ C ── 备份包体检四形 ══════════ */
test('C1 四形不同：没包 / 体检自己坏了 / 包认不出 / 认出来（有数据或空）—— 四句话', () => {
  const missing = payloadInspectFrom(null);
  assert.equal(missing.state, 'missing');
  assert.match(missing.label, /不是「包是空的」/);

  /* 「体检这一步自己坏了」与「包体不认」必须分开：前者是**我们的代码**炸了，
   *   后者是**这个包**不合法，处置方向相反（该报 bug / 该换包）。 */
  const threw = payloadInspectFrom({ ok: false, error: 'inspect_threw: boom_payload' });
  assert.equal(threw.state, 'threw');
  assert.match(threw.label, /内核抛错/);
  assert.match(threw.label, /boom_payload/, '抛错原话要念出来');
  assert.match(threw.why, /inspect_threw/);

  const rawRejected = payloadInspectFrom({ ok: false, error: 'invalid-payload-format' });
  assert.equal(rawRejected.state, 'rejected');
  assert.match(rawRejected.label, /包体不认/);
  assert.match(rawRejected.why, /invalid-payload-format/, '内核给的原因要原样念出来');

  const okData = payloadInspectFrom({ ok: true, version: '2.0', totalAppScopes: 2, totalEntries: 4 });
  assert.equal(okData.state, 'ok');
  assert.equal(okData.version, 2, '版本要读成数字（不是字符串 "2.0"）');
  assert.equal(okData.scopes, 2);
  assert.equal(okData.entries, 4);
  assert.match(okData.label, /2 个作用域 \/ 4 条/);

  const okEmpty = payloadInspectFrom({ ok: true, version: '1.0', totalAppScopes: 0, totalEntries: 0 });
  assert.equal(okEmpty.state, 'ok');
  assert.match(okEmpty.label, /一条数据都没有/, '「认出来但空」必须自己说出来');

  const labels = [missing.label, threw.label, rawRejected.label, okData.label, okEmpty.label];
  assert.equal(new Set(labels).size, 5, '五形五句不同的话：' + JSON.stringify(labels));
  assert.equal(new Set([missing.state, threw.state, rawRejected.state, okData.state]).size, 4, '四态名也必须不同');
});

test('C2 真内核读数能翻：inspectBackupPayload 的返回体走同一条路（App 侧调一次、桥翻形状）', async () => {
  const { inspectBackupPayload } = await import('../config/portable-recovery-hub.js');
  const raw = inspectBackupPayload({ version: '2.0', data: { wechat: [1, 2, 3], chars: { a: 1 } } });
  const ok = payloadInspectFrom(raw);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.scopes, 2);
  assert.equal(ok.entries, 4, '真内核算出来的条目数必须原样透出（不许桥自己重算）');
  const bad = payloadInspectFrom(inspectBackupPayload(null));
  assert.equal(bad.state, 'rejected');
  assert.match(bad.why, /invalid-payload-format/);
});

test('C3 体检只跑一遍：桥不持有 inspectBackupPayload（同一次点击不许跑两遍内核）', () => {
  const src = stripComments(read(BRIDGE_REL));
  assert.equal(/inspectBackupPayload/.test(src), false,
    '桥里出现了 inspectBackupPayload ⇒ 它与调用点各调一遍；且那个便捷口在产品端没人用（死导出）');
  assert.equal(/export function payloadInspectOf/.test(src), false, '不许留「调内核」的兄弟便捷口');
  /* 调用点（备份台）自己调一次，然后把读数（含 catch 转形）交给桥 —— 这一条是上面那句的对照。 */
  const appSrc = stripComments(read(APP_REL));
  const at2 = appSrc.indexOf('inspectPayload(payload) {');
  assert.ok(at2 > 0);
  const seg2 = appSrc.slice(at2, appSrc.indexOf('\n    }', at2));
  assert.equal((seg2.match(/inspectBackupPayload\s*\(/g) || []).length, 1, 'App 里必须恰好调内核一次');
  assert.match(seg2, /payloadInspectFrom\(/, '拿到读数必须交给桥翻形状（不许 App 自己判三态）');
  assert.match(seg2, /inspect_threw/, 'catch 到的抛错必须转成桥认得的形状（吞成 null 会念成「没有包」）');
});

/* ══════════ D ── 创作者包计划 ══════════ */
test('D1 安全阻断 ≠ 缺依赖提示：blocked 只跟 errors 走，warnings 不许把人挡在外面', () => {
  const evil = bundlePlanOf({ name: 'x', theme: true, rules: '<script>alert(1)</script>' }, { modules: ['theme'] });
  assert.equal(evil.ok, false);
  assert.equal(evil.blocked, true, '包里带可执行脚本是**安全阻断**，不是警告');
  assert.match(evil.label, /包不能用/);

  const warn = bundlePlanOf({ name: '夜灯', theme: true }, { modules: ['programs'] });
  assert.equal(warn.ok, true, '缺节目单只是提示，不阻断');
  assert.equal(warn.blocked, false, 'warnings 不许变成 blocked');
  assert.match(warn.label, /缺依赖提示/);
  assert.equal(evil.label === warn.label, false, '「装不了」与「能装但缺东西」必须两句话');

  const missing = bundlePlanOf(null, {});
  assert.equal(missing.state, 'missing');
  assert.match(missing.label, /不是「包是空的」/);
  assert.equal(new Set([evil.label, warn.label, missing.label]).size, 3, '三形三句话');

  const picked = bundlePlanOf({ name: 'y', theme: true, assets: true }, { modules: ['theme', 'assets'] });
  assert.deepEqual(picked.modules, ['theme', 'assets'], '选择性导入：只回选中的那几类');
  assert.equal(picked.blocked, false);
});

/* ══════════ E ── 接线自证 ══════════ */
test('E1 产品端真的 import 了内核与桥（不是只有 tests/ 在用）', () => {
  const appSrc = read(APP_REL);
  assert.match(appSrc, /from '\.\.\/\.\.\/config\/sharing-boundary\.js'/,
    'App 必须真 import 分享边界内核');
  assert.match(appSrc, /from '\.\.\/\.\.\/config\/share-migrate-bridge\.js'/,
    'App 必须真 import 形状翻译层');
  for (const fn of ['sharePreviewOf', 'shareTraceOf', 'payloadInspectFrom', 'bundlePlanOf']) {
    assert.match(appSrc, new RegExp('\\b' + fn + '\\('), '桥函数 ' + fn + ' 必须被真调用');
  }
  for (const fn of ['kernBuildShareDraft', 'kernMarkRecipientRead', 'kernRevokeShare']) {
    assert.match(appSrc, new RegExp('\\b' + fn + '\\('), '内核 ' + fn + ' 必须被真调用');
  }
  /* 这三件内核此前产品端零 import —— 本版就是要让「零」变成非零。
   * ★ 注意分工：`portable-recovery-hub` 由**备份台**直接 import（体检是它的本业），
   *   桥只 import 另外两件 + 那件的**读数形状**（不 import 它本身，理由见 C3）。 */
  const bridgeSrc = read(BRIDGE_REL);
  for (const dep of ['sharing-boundary.js', 'offline-creator-bundle-pipeline.js']) {
    assert.match(bridgeSrc, new RegExp('from \'\\./' + dep.replace('.', '\\.') + '\''), '桥必须接 ' + dep);
  }
  assert.match(read(APP_REL), /from '\.\.\/\.\.\/config\/portable-recovery-hub\.js'/,
    '备份台必须自己 import 便携恢复内核（体检是它的本业）');
});

test('E2 视图不写第二套判据：五个授权态字面量一个都不许出现在视图里', () => {
  const viewSrc = stripComments(read(VIEW_REL));
  for (const lit of ['authorized', 'masked_partial', 'unauthorized', 'expired']) {
    assert.equal(viewSrc.includes("'" + lit + "'"), false, '视图里出现了授权态字面量 ' + lit + '（第二份口径）');
  }
  /* 视图也不许自己判包体检 / 创作者包的三态：那两格只认桥给的 label 与 blocked。
   *  ★ 注意收窄：视图里**允许**出现 `r.state === 'rejected'`（第 91 行，那是**导入计划行**的
   *    内核状态，属 BACKUP_ENTRY_STATES，与包体检三态是两个域）。判据只针对 inspect / bundle。 */
  assert.equal(/s\.inspect\.state\s*===/.test(viewSrc), false, '视图不许自己判包体检状态');
  assert.equal(/s\.bundle\.state\s*===/.test(viewSrc), false, '视图不许自己判创作者包状态');
  assert.match(viewSrc, /s\.bundle\.blocked/, '视图只消费桥给的 blocked 布尔（结论在桥里定）');
  assert.match(viewSrc, /s\.preview\.readable/, '视图只消费桥给的 readable');
  assert.match(viewSrc, /esc\(s\.preview\.label/, '视图只渲染桥给的 label');
  /* 「预览」不许做成按钮：选人即算，做成按钮会让人以为「点了才算过一遍」。 */
  assert.equal(viewSrc.includes('data-bk-shareact="preview"'), false, '「预览」不许是按钮');
});

test('E3 分享键三处同源：App 常量 == storage 模式 == keys-audit 登记（且随会话隔离）', () => {
  assert.equal(SHARE_KEY, 'share_drafts_v1');
  const storageSrc = read('config/storage.js');
  assert.match(storageSrc, /\/\^share_\//, 'storage.js 必须收录 /^share_/ 模式');
  const auditSrc = read('scripts/keys-audit.mjs');
  const at = auditSrc.indexOf("key: 'share_drafts_v1'");
  assert.ok(at > 0, 'keys-audit 必须登记 share_drafts_v1');
  const seg = auditSrc.slice(at, at + 240);
  assert.match(seg, /scope: 'chat'/, '分享草案必须随会话隔离（落全局会让别的角色看到谁分享给了谁）');
  /* 模式要落在会话隔离那一段（不是全局段）—— 否则「随会话」只是文案。 */
  const chatBlock = storageSrc.slice(storageSrc.indexOf('CHAT_DATA_PATTERNS'));
  assert.ok(chatBlock.indexOf('/^share_/') > 0, '/^share_/ 必须写在 CHAT_DATA_PATTERNS 里');
});

test('E4 桥是纯函数层：不 import storage、不写盘、不发网络', () => {
  const src = stripComments(read(BRIDGE_REL));
  for (const bad of ['config/storage', 'writeReceipt', 'fs.', 'fetch(', 'localStorage']) {
    assert.equal(src.includes(bad), false, '桥层不许出现 ' + bad + '（它是纯形状翻译）');
  }
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./offline-creator-bundle-pipeline.js', './sharing-boundary.js'],
    '桥只许依赖这两件内核（便携恢复内核由调用点持有，见 C3）：' + JSON.stringify(imports));
});

/* ══════════ F ── 产品面全链 ══════════ */
test('F1 一条走到底：起草 → 收件人视角 → 记读 → 撤回 → 撤回后视角', () => {
  const { app, storage } = mkApp();
  const r = app.draftShare({ snippet: '这段是给你的悄悄话', scope: 'private_one_to_one', recipients: ['阿澈'] });
  assert.equal(r.ok, true, '起草要落盘成功：' + r.note);
  assert.equal(app._sharePick, r.id, '起草成功后自动选中这一份');
  assert.ok(storage._mem.has(SHARE_KEY), '草案必须真写进 share_drafts_v1');

  /* 收件人视角：先看无权、再看有权 —— 两句话必须不同。 */
  const out = app.previewShare(r.id, '路人');
  assert.equal(out.preview.readable, false);
  assert.equal(out.preview.content, '', '无权者的预览不许带内容');
  const yes = app.previewShare(r.id, '阿澈');
  assert.equal(yes.preview.readable, true);
  assert.equal(yes.preview.content, '这段是给你的悄悄话');

  /* 预览不是记已读：这一步之前 readCount 必须还是 0。 */
  const vm0 = app._vm();
  assert.equal(vm0.share.rows[0].readCount, 0, '预览不许替对方记已读');

  app.markShareRead(r.id, '阿澈');
  const vm1 = app._vm();
  assert.equal(vm1.share.rows[0].readCount, 1, '记读之后已读账 +1');
  assert.match(vm1.share.rows[0].line, /已读 1 人/);

  const rv = app.revokeShare(r.id, '不想给了');
  assert.equal(rv.ok, true);
  assert.match(rv.note, /撤回前已读 1 人/, '撤回提示必须带上「撤回前已读」这件事');
  const vm2 = app._vm();
  assert.equal(vm2.share.rows[0].revoked, true);
  assert.equal(vm2.share.rows[0].readCount, 1, '撤回后已读账不许被清掉');
  /* 撤回后收件人视角：从「能看」变「看不到」，且内容清空。 */
  const after = app.previewShare(r.id, '阿澈');
  assert.equal(after.preview.readable, false);
  assert.equal(after.preview.content, '');
  assert.match(after.preview.label, /已撤回/);
});

test('F2 写不下去就不许选中：没落盘的草案被选中 ⇒ 下一次读盘找不到它（界面指着不存在的东西）', () => {
  const { app } = mkApp({}, { setFails: true });
  const r = app.draftShare({ snippet: 's', scope: 'private_one_to_one', recipients: ['阿澈'] });
  assert.equal(r.ok, false, '写盘失败必须如实报失败');
  assert.equal(app._sharePick, '', '写不下去时选中项必须留空');
  assert.equal(app._vm().share.rows.length, 0, '盘上没有这份草案，视图也不许画出来');
});

test('F3 台账读不到与空台账分两句：读不出时不许画「这个会话还没起草过分享」', () => {
  const empty = mkApp();
  assert.equal(empty.app._vm().share.empty, true, '真·空台账才允许说「还没起草过」');
  assert.match(empty.app._vm().share.text, /分享草案 0 份/);

  for (const [opts, why] of [[{ getThrows: true }, 'read_threw']]) {
    const bad = mkApp({}, opts);
    const vm = bad.app._vm().share;
    assert.equal(vm.readable, false);
    assert.equal(vm.empty, false, '读不到时 empty 必须 false（否则界面说「没分享过」）');
    assert.equal(vm.why, why);
    assert.match(vm.text, /读不到/);
    const r1 = bad.app.draftShare({ snippet: 's' });
    assert.equal(r1.ok, false, '台账读不到时不许在它上面盲写');
  }
  const broken = mkApp({ [SHARE_KEY]: '{坏 json' });
  assert.equal(broken.app._vm().share.readable, false);
  assert.equal(broken.app._vm().share.why, 'bad_json');
  assert.equal(broken.app.draftShare({ snippet: 's' }).ok, false, '坏 JSON 时同样不许盲写');
});

test('F4 视图真渲染：授权态画内容、不可读不画、撤回行有痕迹、创作者包审过才画', () => {
  const { app } = mkApp();
  const view = new BackupdeskView(app);
  /* 还没审过创作者包：那一行**不出现**（不画 ≠ 假装没这功能）。
   *   判据看的是渲染出来的那一行本身（`<span class="bk-row-k">创作者包</span>`），
   *   而不是「创作者包」这四个字 —— 后者在按钮文案里也出现，会假红。 */
  const BUNDLE_ROW = '<span class="bk-row-k">创作者包</span>';
  assert.equal(view._html(app._vm()).includes(BUNDLE_ROW), false, '没审过时不许画创作者包那一行');

  const r = app.draftShare({ snippet: '这段是给你的悄悄话', scope: 'private_one_to_one', recipients: ['阿澈'] });
  app.markShareRead(r.id, '阿澈');
  app.setShareViewer('阿澈');
  let html = view._html(app._vm());
  assert.match(html, /分享与迁移审阅/, '分享区块必须真出现在页面里');
  assert.match(html, /他会看到/, '可读时必须画出「他会看到」');
  assert.match(html, /这段是给你的悄悄话/);

  app.setShareViewer('路人');
  html = view._html(app._vm());
  assert.equal(html.includes('他会看到'), false, '不可读时不许画「他会看到」（画空白等于说他什么都没看到）');
  assert.match(html, /不在受众名单/, '必须说得出为什么看不到');

  app.revokeShare(r.id, '不想给了');
  html = view._html(app._vm());
  assert.match(html, /撤回前已读 1 人/, '撤回痕迹必须出现在行上');
  assert.match(html, /bk-row-revoked/, '撤回行要有独立样式（不是普通行）');

  app.planBundle({ name: '夜灯', theme: true }, { modules: ['programs'] });
  html = view._html(app._vm());
  assert.match(html, /创作者包/, '审过之后必须画出来');
  assert.match(html, /缺依赖提示/, '缺依赖提示要原样念（这是能装的那种）');
});

test('F6 体检四态上到界面：没包 / 坏了 / 不认 / 认出来，四句不同的话（App 的 catch 不许吞成「没有包」）', () => {
  const { app } = mkApp();
  /* ① 没包 */
  const a = app.inspectPayload(null);
  assert.equal(a.state, 'missing');
  /* ② 认出来：真包体 */
  const ok = app.inspectPayload({ version: '2.0', data: { wechat: [1, 2, 3] } });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.entries, 3);
  /* ③ 不认：内核自己会返回 ok:false（null 形状） */
  const bad = app.inspectPayload({ data: null, version: '1.0' });
  assert.ok(bad.state === 'ok' || bad.state === 'rejected', '形状怪但不抛的包落在 ok 或 rejected 之一');
  /* ④ 「体检这一步自己坏了」：拿一个会让内核在 Object.keys 处抛的包 —— 用 Proxy 让 data 读取抛错。
   *   ★ 这是本版真抓到的一处：原先 App 层 catch 后把 raw 置 null，界面于是念「还没有包体可体检」，
   *     把「我们的代码炸了」演成「你没选包」。 */
  const boom = { version: '1.0' };
  Object.defineProperty(boom, 'data', { get() { throw new Error('boom_payload'); } });
  const threw = app.inspectPayload(boom);
  assert.equal(threw.state, 'threw', '抛错必须落到 threw 态（不是 missing）');
  assert.match(threw.label, /boom_payload/, '抛错原话要念出来');
  assert.notEqual(threw.label, a.label, '「体检坏了」与「没选包」不是同一句话');
  /* 四态文案两两不同。 */
  const labels = [a.label, ok.label, bad.label, threw.label];
  assert.equal(new Set(labels).size, 4, '四态四句不同的话：' + JSON.stringify(labels));
});

test('F5 换会话丢实例态：上一个会话选中的草案 / 收件人不许贴到新会话', () => {
  const { app } = mkApp();
  const r = app.draftShare({ snippet: 's', scope: 'private_one_to_one', recipients: ['阿澈'] });
  app.setShareViewer('阿澈');
  app.planBundle({ name: 'x', theme: true }, { modules: ['theme'] });
  assert.ok(app._sharePick && app._shareViewer && app._bundlePlan);
  app.onChatChanged();
  assert.equal(app._sharePick, '');
  assert.equal(app._shareViewer, '');
  assert.equal(app._bundlePlan, null, '创作者包读数也是「这一次审出来的」，换会话必须丢');
  assert.equal(r.ok, true);
});

/* ══════════ G ── 负控制（双向断言） ══════════ */
/** 真源码破坏（锚点必须恰中一次）。 */
function brokenSource(rel, pairs) {
  let src = read(rel);
  for (const [from, to] of pairs) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '负控制锚点必须恰中一次：' + JSON.stringify(String(from).slice(0, 70)));
    src = src.replace(from, to);
  }
  return src;
}
/** 把破坏后的桥落成临时文件（同目录三件内核一并复制），返回 file:// URL。 */
function brokenBridgeCopy(pairs, outName) {
  const src = brokenSource(BRIDGE_REL, pairs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x4_'));
  for (const dep of ['sharing-boundary.js', 'portable-recovery-hub.js', 'offline-creator-bundle-pipeline.js']) {
    fs.copyFileSync(path.join(ROOT, 'config', dep), path.join(dir, dep));
  }
  const file = path.join(dir, outName);
  fs.writeFileSync(file, src, 'utf8');
  return 'file://' + file;
}
/** 把破坏后的 App 落成临时目录（apps/backupdesk 全件 + config 全件），返回模块。 */
async function brokenAppModule(pairs) {
  const src = brokenSource(APP_REL, pairs);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_x4app_'));
  const dir = path.join(tmp, 'apps', 'backupdesk');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'apps', 'backupdesk'))) {
    const from = path.join(ROOT, 'apps', 'backupdesk', f);
    if (!fs.statSync(from).isFile()) continue;
    if (f === 'backupdesk-app.js') { fs.writeFileSync(path.join(dir, f), src, 'utf8'); continue; }
    fs.copyFileSync(from, path.join(dir, f));
  }
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'config'))) {
    if (/\.js$/.test(f)) fs.copyFileSync(path.join(ROOT, 'config', f), path.join(tmp, 'config', f));
  }
  return await import('file://' + path.join(dir, 'backupdesk-app.js').replace(/\\/g, '/'));
}

test('G1 负控制 · 五态压成四句 ⇒ 「五句不同的话」判据转红', async () => {
  const criterion = (mod) => {
    const labels = ['authorized', 'masked_partial', 'unauthorized', 'expired', 'revoked'].map(mod.accessLabelOf);
    return new Set(labels).size === 5;
  };
  assert.equal(criterion({ accessLabelOf }), true, '原版上必须五句不同');
  const B = await import(brokenBridgeCopy([
    ["expired: '对方看不到（分享已过期）',", "expired: '对方看不到（不在受众名单）',"]
  ], 'share-migrate-bridge.dup.js'));
  assert.equal(criterion(B), false, '过期与无权念成同一句 ⇒ 用户以为原因都一样，判据必须转红');
});

test('G2 负控制 · 不可读也把内容透出去 ⇒ 「不可读不给内容」判据转红（本层最要紧的一条）', async () => {
  const criterion = (mod) => {
    const p = mod.sharePreviewOf(draftOf(), '路人', 200);
    return p.readable === false && p.content === '';
  };
  assert.equal(criterion({ sharePreviewOf }), true, '原版上无权者拿不到内容');
  /* ★ 破坏必须**改行为**，不能只是改写：内核在非可读三态下 `content` 恒为 null，
   *   若破坏写成「去掉三元、直接 String(raw.content || '')」，跑出来仍然是 ''——
   *   那就是本仓 G 段的老坑「破坏与默认行为等价 ⇒ 判据不绿不红地混过去」。
   *   这里注入的是**最像真 bug 的那一种**：不给内容时用草案原文兜底（「他看不到，
   *   那就把原文显示给发送者看」——听起来很像好意，实际是把不该给的内容给出去了）。 */
  const B = await import(brokenBridgeCopy([
    ["content: readable ? String((raw && raw.content) || '') : '',",
     "content: readable ? String((raw && raw.content) || '') : String((draft && draft.snippet) || ''),"]
  ], 'share-migrate-bridge.leak.js'));
  assert.equal(criterion(B), false, '不可读时用草案原文兜底 ⇒ 正是本层要防的泄漏，判据必须转红');
});

test('G3 负控制 · 撤回痕迹不再念「撤回前已读」 ⇒ 留痕判据转红', async () => {
  const criterion = (mod) => {
    const t = mod.shareTraceOf(draftOf({
      revoked: true, revokedAt: 130, revokeReason: '不想给了',
      readLogs: [{ readerId: '阿澈', readAt: 110 }]
    }));
    return t.revoked === true && /撤回前已读 1 人/.test(t.line) && /不会被抹掉/.test(t.line);
  };
  assert.equal(criterion({ shareTraceOf }), true, '原版上撤回必须留痕');
  const B = await import(brokenBridgeCopy([
    [' 人，这段痕迹不会被抹掉', ' 人']
  ], 'share-migrate-bridge.nomark.js'));
  assert.equal(criterion(B), false, '撤回痕迹被抹掉 ⇒ 「不伪造记忆抹除」这条契约破了，判据必须转红');
});

test('G4 负控制 · 包认不出被念成「没有包」 ⇒ 三态分辨力判据转红', async () => {
  const criterion = (mod) => {
    const a = mod.payloadInspectFrom({ ok: false, error: 'invalid-payload-format' });
    const b = mod.payloadInspectFrom(null);
    return a.state === 'rejected' && b.state === 'missing' && a.label !== b.label;
  };
  assert.equal(criterion({ payloadInspectFrom }), true, '原版上两态必须分得开');
  /* 两种「坏」都试：① rejected 被念成 missing；② threw 被念成 rejected。
   *   ★ 锚点跟着桥加固后的形状走（err 提出了局部变量），负控制要破坏的仍是
   *     「坏得不一样」这一对分辨力点。 */
  const B = await import(brokenBridgeCopy([
    ["label: '包体不认：' + (err || '未给原因'),",
     "label: '还没有包体可体检（不是「包是空的」）',"]
  ], 'share-migrate-bridge.dubinspect.js'));
  assert.equal(criterion(B), false, '「包认不出」与「没包」压成一句 ⇒ 判据必须转红');
  const C = await import(brokenBridgeCopy([
    ["state: 'threw',", "state: 'rejected',"]
  ], 'share-migrate-bridge.threwasrejected.js'));
  const threwCriterion = (mod) => {
    const a = mod.payloadInspectFrom({ ok: false, error: 'inspect_threw: x' });
    const b = mod.payloadInspectFrom({ ok: false, error: 'invalid-payload-format' });
    return a.state === 'threw' && b.state === 'rejected' && a.state !== b.state;
  };
  assert.equal(threwCriterion({ payloadInspectFrom }), true, '原版上「我们坏了」与「包不合法」分得开');
  assert.equal(threwCriterion(C), false, '「我们坏了」被念成「包不合法」⇒ 用户去换包而我们该修 bug，判据必须转红');
});

test('G5 负控制 · 安全阻断被降级成警告 ⇒ blocked 判据转红', async () => {
  const criterion = (mod) => {
    const evil = mod.bundlePlanOf({ name: 'x', theme: true, rules: '<script>alert(1)</script>' }, { modules: ['theme'] });
    const warn = mod.bundlePlanOf({ name: 'y', theme: true }, { modules: ['programs'] });
    return evil.ok === false && evil.blocked === true && warn.ok === true && warn.blocked === false;
  };
  assert.equal(criterion({ bundlePlanOf }), true, '原版上「装不了」与「能装缺东西」必须分开');
  const B = await import(brokenBridgeCopy([
    ['const blocked = errors.length > 0;', 'const blocked = false;']
  ], 'share-migrate-bridge.noblock.js'));
  assert.equal(criterion(B), false, '安全阻断不再挡人 ⇒ 带脚本的包被当成「能装」，判据必须转红');
});

test('G6 负控制 · 写不下去仍然选中 ⇒ 「没落盘不许选中」判据转红（产品面）', async () => {
  const criterion = (mod) => {
    const storage = { _mem: new Map(), get(k) { return this._mem.has(k) ? this._mem.get(k) : null; }, set() { return false; } };
    const app = new mod.BackupdeskApp({}, storage);
    app.render = () => {};
    const r = app.draftShare({ snippet: 's', scope: 'private_one_to_one', recipients: ['阿澈'] });
    return r.ok === false && app._sharePick === '' && app._vm().share.rows.length === 0;
  };
  assert.equal(criterion({ BackupdeskApp }), true, '原版：写不下去就不选中');
  const B = await brokenAppModule([
    ['this._sharePick = w.saved ? draft.id : \'\';', 'this._sharePick = draft.id;']
  ]);
  assert.equal(criterion(B), false, '写盘失败也把选中项指过去 ⇒ 界面指着盘上不存在的草案，判据必须转红');
});
