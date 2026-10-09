/* ============================================================
 * tests/browser/scenarios/o6-motion-throttle.scen.js — R-O6 第二层：动效档位与后台降频
 * ------------------------------------------------------------
 * 计划原文（R-O6 第二层第 3 / 4 条）：
 *   · 「优先移除非必要动画与粒子（已知会明显拖慢渲染）」；
 *   · 「后台降频与恢复后重取一起设计，避免恢复瞬间全量重算」。
 *
 * 修前实测（本环境 Chromium 131 / headless old / 单帧 dump，不是推演）：
 *   · `prefers-reduced-motion` 全仓零命中、`animation-play-state` 全仓零命中；
 *   · 卡片布局首页那条 `yzp-home-vinyl-spin` 是 Infinity / running；
 *   · 把页面标记为隐藏（`document.hidden` 替换 + `visibilitychange`）后，
 *     该动画**仍是 running**、宠物 video **仍是 playing**。
 *
 * 本场景回答六个问题（真排版引擎 + 真 phone.css + 真入口）：
 *   ① 档位是否真写到浏览器懂的载体上？四档互不同形？
 *   ② 装饰类动效在各档下到底停没停？（读 playState / iterations —— 那是浏览器的结果；
 *      我们自己写的属性只是**请求**。两者不同形，本仓治过「属性在但不表达这件事」。）
 *   ③ 后台（页面隐藏）时：动画 paused / 宠物 paused / 采样器断开？三条都要真读数。
 *   ④ 恢复时：宠物复播 / 采样器复订 / 恢复次数真增长？（挡的是「恢复了但什么都没做」）
 *   ⑤ 采样器自身不得常驻拖累：有界，且「没测到」不得读成「0 条」。
 *   ⑥ 本读数不是帧率（写进读数，不只是注释）。
 *
 * 口径边界（诚实三条）：
 *   · 本层**不测帧率**：单帧 dump 下拿到的是当下状态快照；
 *   · `document.hidden` 是**属性替换模拟**，不触发浏览器真实节流窗口 ——
 *     本层证明的是「代码收到隐藏信号后真停了」，不是「手机上省了多少电」；
 *   · 懒加载那条高优动画无法在单帧里读「跳帧」，故本层读的是**停没停**（二态可判定）。
 * ============================================================ */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';

const host = installBrowserHost({ chat: [{ mes: '宿主楼层', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el) { if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }

function animsIn(scopeSel) {
  let all = [];
  try { all = document.getAnimations ? document.getAnimations() : []; } catch (_e) { all = []; }
  const out = [];
  for (const a of all) {
    let t = null;
    try { t = a.effect && a.effect.target; } catch (_e) { t = null; }
    if (scopeSel && !(t && t.closest && t.closest(scopeSel))) continue;
    let name = ''; let it = null;
    try { name = String(a.animationName || ''); } catch (_e) { /* 忽略 */ }
    try { it = a.effect.getTiming().iterations; } catch (_e) { it = null; }
    out.push({ name: name, iterations: it === null ? null : String(it), state: String(a.playState) });
  }
  return out;
}
const countOf = (rows, pred) => rows.filter(pred).length;
const runningInfinite = (rows) => countOf(rows, (r) => r.state === 'running' && r.iterations === 'Infinity');
const runningAny = (rows) => countOf(rows, (r) => r.state === 'running');

function petFace() {
  const vids = Array.from(document.querySelectorAll('#phone-pet-root video'));
  return {
    videos: vids.length,
    playing: vids.filter((v) => !v.paused && !v.ended).length,
    paused: vids.filter((v) => v.paused).length,
    withSrc: vids.filter((v) => String(v.getAttribute('src') || '').length > 0).length,
  };
}
function setHidden(v) {
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === true }); } catch (_e) { /* 忽略 */ }
  document.dispatchEvent(new Event('visibilitychange'));
}
const motionStats = () => { try { return window.VirtualPhone.motion.stats(); } catch (_e) { return null; } };
const setLevel = (lv) => {
  try { window.VirtualPhone.storage.set('sys_motion_level', lv); } catch (_e) { /* 忽略 */ }
  try { window.VirtualPhone.motion.refresh(); } catch (_e) { /* 忽略 */ }
};

/* ---------- 起真入口 ---------- */
try { await import('/index.js'); } catch (_e) { /* 由读数判定 */ }
const up = await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 25000 });
let panelUp = false;
for (let i = 0; i < 3 && !panelUp; i++) {
  const t = document.getElementById('phoneDrawerToolEntry') || document.getElementById('phoneDrawerIcon');
  if (t) realClick(t);
  panelUp = await waitFor(() => document.querySelector('.phone-in-panel'), { timeoutMs: 12000 });
}
await waitFor(() => document.querySelector('.home-screen'), { timeoutMs: 12000 });
const modalShown = await waitFor(() => !!document.getElementById('st-phone-update-modal'), { timeoutMs: 8000 });
if (modalShown) {
  const b = document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');
  if (b) realClick(b);
  await waitFor(() => !document.getElementById('st-phone-update-modal'), { timeoutMs: 5000 });
}
/* 切到卡片布局：那里有本仓唯一的**面板内常驻无限动画**（黑胶唱片旋转）。
 * 图标布局下该元素根本不存在 —— 那时「0 条无限动画」是真读数但空泛，
 * 无法区分「没有装饰动画」与「装饰动画被停了」。 */
try { await window.VirtualPhone.storage.set('phone-home-layout', 'cards'); } catch (_e) { /* 忽略 */ }
try { window.VirtualPhone.home.render({ forceDomRefresh: true }); } catch (_e) { /* 忽略 */ }
try { window.VirtualPhone.phoneShell?.syncHomeLayoutChromeClass?.(); } catch (_e) { /* 忽略 */ }
await window.__sleep(1200);

const hasVinyl = !!document.querySelector('.home-vinyl-record');
report({
  name: 'o6m-fixture-ready',
  ok: !!(up && panelUp && window.VirtualPhone.motion) && hasVinyl,
  detail: 'ver=' + String(window.VirtualPhone && window.VirtualPhone.version) + ' panel=' + panelUp
    + ' motionApi=' + String(!!(window.VirtualPhone && window.VirtualPhone.motion)) + ' vinylEl=' + hasVinyl
    + '（黑胶唱片是面板内唯一常驻无限动画的载体：缺它就无法区分「没有动画」与「动画被停了」）',
});
if (!panelUp || !hasVinyl) { done(); }

/* ---------- ① 档位载体：两属性四档互不同形 ---------- */
const snapAttr = () => ({
  motion: document.documentElement.getAttribute('data-motion'),
  still: document.documentElement.getAttribute('data-still'),
});
const faces = {};
for (const lv of ['auto', 'full', 'reduced', 'still']) {
  setLevel(lv);
  await window.__sleep(700);
  faces[lv] = { attr: snapAttr(), anims: animsIn('#phone-panel') };
}
const stillOf = (lv) => faces[lv].attr.still;
report({
  name: 'o6m-level-carrier',
  ok: faces.auto.attr.motion === 'full'          // auto 在本层解析为 full（本层无系统政策读数）
    && faces.full.attr.motion === 'full' && stillOf('full') === null
    && faces.reduced.attr.motion === 'reduced' && String(stillOf('reduced')) === '1'
    && faces.still.attr.motion === 'still' && String(stillOf('still')) === '1',
  detail: 'faces=' + JSON.stringify(Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, v.attr])))
    + ' 口径=四档互不同形（full 必须移除 data-still 而不是写 0：属性存在即生效）',
});

/* ---------- ② 装饰类动效：full 在跑、reduced 与 still 都停 ---------- */
const fullRun = runningInfinite(faces.full.anims);
const redRun = runningInfinite(faces.reduced.anims);
const stillRun = runningInfinite(faces.still.anims);
report({
  name: 'o6m-decorative-stops',
  ok: fullRun > 0 && redRun === 0 && stillRun === 0,
  detail: 'runningInfinite(full)=' + fullRun + ' (reduced)=' + redRun + ' (still)=' + stillRun
    + ' names(full)=' + JSON.stringify(faces.full.anims.filter((r) => r.state === 'running' && r.iterations === 'Infinity').map((r) => r.name))
    + ' 口径=读 playState 与 iterations（浏览器结果），不读我们自己写的属性（那是请求）',
});

/* ---------- ③ 后台降频：动画 paused / 宠物 paused / 采样器断开 ---------- */
setLevel('full');
await window.__sleep(700);
const beforeHide = { anims: animsIn('#phone-panel'), pet: petFace(), stats: motionStats() };
setHidden(true);
await window.__sleep(1400);
const afterHide = { anims: animsIn('#phone-panel'), pet: petFace(), stats: motionStats(), bg: document.documentElement.getAttribute('data-bg') };
report({
  name: 'o6m-background-throttle',
  ok: !!beforeHide.stats && !!afterHide.stats
    && String(afterHide.bg || '').length > 0
    && runningAny(beforeHide.anims) > 0 && runningAny(afterHide.anims) === 0
    && beforeHide.pet.playing > 0 && afterHide.pet.playing === 0
    && afterHide.stats.sampler && afterHide.stats.sampler.armed === false,
  detail: 'data-bg=' + String(afterHide.bg)
    + ' runningAnims before=' + runningAny(beforeHide.anims) + ' after=' + runningAny(afterHide.anims)
    + ' petPlaying before=' + beforeHide.pet.playing + ' after=' + afterHide.pet.playing
    + ' samplerArmed before=' + String(beforeHide.stats && beforeHide.stats.sampler && beforeHide.stats.sampler.armed)
    + ' after=' + String(afterHide.stats && afterHide.stats.sampler && afterHide.stats.sampler.armed)
    + '（document.hidden 是属性替换模拟，不触发真实节流窗口：本项证明代码收到隐藏信号后真停了，不证明省了多少电）',
});

/* ---------- ④ 恢复：复播 / 复订 / 恢复次数真增长 ---------- */
const resumesBefore = Number(afterHide.stats && afterHide.stats.resumes);
setHidden(false);
await window.__sleep(1400);
const afterShow = { anims: animsIn('#phone-panel'), pet: petFace(), stats: motionStats(), bg: document.documentElement.getAttribute('data-bg') };
report({
  name: 'o6m-resume-restores',
  ok: !!afterShow.stats
    && afterShow.bg === null                          // 恢复后属性必须消失（不是写空值）
    && afterShow.pet.playing > 0
    && afterShow.stats.sampler && afterShow.stats.sampler.armed === true
    && Number(afterShow.stats.resumes) > resumesBefore,
  detail: 'data-bg=' + String(afterShow.bg)
    + ' petPlaying=' + afterShow.pet.playing
    + ' samplerArmed=' + String(afterShow.stats && afterShow.stats.sampler && afterShow.stats.sampler.armed)
    + ' resumes=' + resumesBefore + '→' + String(afterShow.stats && afterShow.stats.resumes)
    + ' pending=' + String(afterShow.stats && afterShow.stats.pending)
    + ' 口径=恢复不只「允许跑」，还要真报出「恢复发生过」（否则「恢复了但什么都没做」与正常运行同形）',
});

/* ---------- ⑤ 采样器有界 + 未支持不同形 ---------- */
const s5 = motionStats();
const smp = s5 && s5.sampler;
report({
  name: 'o6m-sampler-bounded',
  ok: (function () {
    if (!smp) return false;
    if (!(Number(smp.limit) > 0)) return false;
    if (!(Number(smp.count) <= Number(smp.limit))) return false;
    if (typeof smp.supported !== 'boolean') return false;
    if (!(Number(smp.dropped) >= 0)) return false;
    /* 有样本却拿不到 maxMs = 读数自相矛盾，必须报出来而不是吞掉。 */
    if (Number(smp.count) > 0 && smp.maxMs === null) return false;
    return true;
  })(),
  detail: 'sampler=' + JSON.stringify(smp)
    + ' 口径=环形缓冲有界（count ≤ limit）；supported=false 是「没测到」而不是「0 条」—— 两者不同形',
});

/* ---------- ⑥ 口径自证：本读数不是帧率 ---------- */
report({
  name: 'o6m-not-a-frame-time',
  ok: true,
  detail: 'api=document.getAnimations + HTMLMediaElement.paused 模式=单帧 dump（读数=当下状态快照，**不是**帧率、也**不是**真机省电读数；目标设备读数未取得，本项不设阈值）',
});
done();
