#!/usr/bin/env node
/**
 * tests/r22_o3_a11y.test.mjs — 无障碍面判据（计划 R22-O3）
 * ------------------------------------------------------------
 * 正面：117 个纯图标按钮全部补上可访问名，扫描门 rc=0，基线不下滑。
 * 反面（证明门禁抓得住，而不是「有没有属性都算绿」）：
 *   ① 纯图标按钮无 aria-label/title → 必须报；
 *   ② 带可见文字的按钮没 aria-label → **不许**报（否则会逼出假无障碍：aria-label="按钮"）；
 *   ③ 已有 aria-label 的纯图标按钮 → 不许报；
 *   ④ 计数低于基线 → 必须报下滑；
 *   ⑤ 白名单理由过短 → 必须判不合格；
 *   ⑥ 扫不到文件（探针失效）→ 必须 fail-closed exit 2。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditA11y, measureA11y } from './audit/a11y_icon_buttons.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..');

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/a11y_baseline.json'), 'utf8'));
const real = auditA11y({ rootDir: ROOT });

/* ── 正面 ─────────────────────────────────────────────── */
assert('真仓 a11y 检查 rc=0', real.status === 'ok' && real.exitCode === 0, real.violations);
assert('纯图标按钮缺名 = 0', (real.violations.uncovered || []).length === 0, real.violations.uncovered);
assert('无计数下滑', (real.violations.regressions || []).length === 0, real.violations.regressions);
assert('基线覆盖数：aria-label ≥ 350（补前 233）', real.totals.ariaLabel >= 350 && baseline.totals.ariaLabel >= 350,
  { now: real.totals.ariaLabel, base: baseline.totals.ariaLabel });
assert('纯图标按钮 100% 有可访问名', real.totals.iconOnly > 0 && real.totals.iconOnlyCovered === real.totals.iconOnly,
  { iconOnly: real.totals.iconOnly, covered: real.totals.iconOnlyCovered });
assert('新增的 aria-label 全部是中文语义（不是 aria-label="button" 式占位）',
  !/aria-label="(button|btn|icon|点击|按钮)"/.test(
    fs.readFileSync(path.join(ROOT, 'apps/wechat/chat-view.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'apps/phone/phone-view.js'), 'utf8')
  ));

/* 抽查三个语义点：返回 / 拒接 / 放大 */
{
  const chatSrc = fs.readFileSync(path.join(ROOT, 'apps/wechat/chat-view.js'), 'utf8');
  assert('微信返回按钮带 aria-label="返回"', /<button aria-label="返回"[^>]*>\s*<i class="fa-solid fa-chevron-left"/.test(chatSrc));
  const phoneSrc = fs.readFileSync(path.join(ROOT, 'apps/phone/phone-view.js'), 'utf8');
  assert('通话页拒接按钮带 aria-label="拒接"', /aria-label="拒接"/.test(phoneSrc));
  assert('通话页接听按钮带 aria-label="接听"', /aria-label="接听"/.test(phoneSrc));
  const cropSrc = fs.readFileSync(path.join(ROOT, 'apps/settings/image-cropper.js'), 'utf8');
  assert('裁图放大按钮带 aria-label="放大"', /aria-label="放大"/.test(cropSrc));
}

/* ── 反面控制 ① 纯图标无名 ─────────────────────────────── */
{
  const src = '<button class="x"><i class="fa-solid fa-xmark"></i></button>';
  const m = measureA11y(new Map([['apps/t/t-view.js', src]]));
  assert('负控制①：纯图标无名 → 计入 uncovered', m.iconOnlyUncovered.length === 1, m.iconOnlyUncovered);
}

/* ── 反面控制 ② 有可见文字不强制 ───────────────────────── */
{
  const src = '<button class="x">发送</button>';
  const m = measureA11y(new Map([['apps/t/t-view.js', src]]));
  assert('负控制②：有文字按钮 → 不算 uncovered（也不计入纯图标）',
    m.iconOnlyUncovered.length === 0 && m.perFile['apps/t/t-view.js'].iconOnly === 0, m.perFile);
}

/* ── 反面控制 ③ 已命名不误报 ───────────────────────────── */
{
  const src = '<button aria-label="关闭" class="x"><i class="fa-solid fa-xmark"></i></button>';
  const m = measureA11y(new Map([['apps/t/t-view.js', src]]));
  assert('负控制③：已命名纯图标 → 计入覆盖且不报', m.iconOnlyUncovered.length === 0
    && m.perFile['apps/t/t-view.js'].iconOnlyCovered === 1, m.perFile);
}

/* ── 反面控制 ④ 计数下滑 ──────────────────────────────── */
{
  const inflated = JSON.parse(JSON.stringify(baseline));
  inflated.perFile['apps/wechat/chat-view.js'].ariaLabel += 5;
  const r = auditA11y({ rootDir: ROOT, baseline: inflated, whitelist: { entries: [] } });
  assert('负控制④：基线被抬高 → 报下滑',
    (r.violations.regressions || []).some((v) => v.file === 'apps/wechat/chat-view.js' && v.key === 'ariaLabel'),
    r.violations.regressions);
}

/* ── 反面控制 ⑤ 白名单理由过短 ─────────────────────────── */
{
  const src = '<button class="x"><i class="fa-solid fa-xmark"></i></button>';
  const r = auditA11y({
    rootDir: ROOT,
    sources: new Map([['apps/t/t-view.js', src]]),
    baseline: { totals: { ariaLabel: 0, role: 0, tabindex: 0 }, perFile: {} },
    whitelist: { entries: [{ file: 'apps/t/t-view.js', why: '不管' }] },
  });
  assert('负控制⑤：白名单理由过短 → 判不合格', (r.violations.badWhitelist || []).length === 1, r.violations.badWhitelist);
  assert('负控制⑤：理由过短时该文件仍报 uncovered',
    (r.violations.uncovered || []).some((v) => v.file === 'apps/t/t-view.js'), r.violations.uncovered);
}

/* ── 反面控制 ⑥ 探针失效 fail-closed ───────────────────── */
{
  const r = auditA11y({ rootDir: path.join(ROOT, 'no-such-dir') });
  assert('负控制⑥：扫不到文件 → fail-closed exit 2',
    r.status === 'fail_closed' && r.exitCode === 2, { status: r.status, exitCode: r.exitCode });
}

console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);