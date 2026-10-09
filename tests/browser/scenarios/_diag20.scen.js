/* _diag20 — 决定性微测：本环境（headless old + dump-dom）里 loading=lazy 到底能不能生效？
   A 组：简单滚动容器里 600 张互不相同 URL 的图（lazy）
   B 组：同样布局但外观相同尺寸的对照（eager） */
const IMG = '/apps/calendar/assets/1.png';
function build(useLazy) {
  const wrap = document.createElement('div');
  wrap.id = useLazy ? 'lazybox' : 'eagerbox';
  wrap.style.cssText = 'width:390px;height:300px;overflow-y:auto;position:relative;';
  let html = '';
  for (let i = 0; i < 600; i++) {
    html += '<div style="height:60px"><img class="mimg" src="' + IMG + '?box=' + (useLazy ? 'L' : 'E') + '&n=' + i + '"' + (useLazy ? ' loading="lazy"' : '') + ' style="width:40px;height:40px"></div>';
  }
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}
const A = build(true);
const B = build(false);
await window.__sleep(1200);
function state(box) {
  const list = Array.from(box.querySelectorAll('.mimg'));
  let decoded = 0; list.forEach((n) => { try { if (n.naturalWidth > 0) decoded++; } catch (e) { } });
  return { total: list.length, decoded: decoded };
}
let reqs = -1;
try { reqs = performance.getEntriesByType('resource').filter((e) => String(e.name).indexOf('1.png') >= 0).length; } catch (e) { }
report({ name: 'micro-A-lazy', ok: true, detail: JSON.stringify(state(A)) });
report({ name: 'micro-B-eager', ok: true, detail: JSON.stringify(state(B)) });
report({ name: 'micro-requests', ok: true, detail: 'resourceEntries=' + reqs + '（若 A、B 两组 decoded 都是全量，则说明本层根本不触发懒加载，而不是阈值问题）' });
/* 容器是否真的在滚动（能量证明）：滚动容器高度 300 < 内容高度 */
report({ name: 'micro-scrollbox', ok: true, detail: 'A.scrollHeight=' + A.scrollHeight + ' A.clientHeight=' + A.clientHeight });
done();
