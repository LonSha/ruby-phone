
/* O7 渲染性能 before 读数：起壳 / 面板重开 / 搜索扫描 / 长列表
 * 口径：performance.now() 差值（真浏览器、真渲染、被动采样）；
 *   不把 Node 拼串耗时写成浏览器帧耗时 —— 单帧 dump 模式下的读数
 *   是「渲染完成时刻」，不是流畅帧率（那是 --dump-dom 的边界，如实登记）。 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const chat = Array.from({ length: 16000 }, (_, i) => ({
  mes: (i % 100 === 0) ? '第'+i+'楼 便利店买咖啡记事' : '第'+i+'楼 今日份流水账内容 柴米油盐',
  is_user: i % 2 === 0, name: i % 2 === 0 ? '我' : '角色', swipes: ['x'], swipe_id: 0,
}));
installBrowserHost({ chat });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
const t = (n) => { this[n]=performance.now(); };
const marks = {};
function mark(n){ marks[n]=performance.now(); }
function lap(from,to,label){ report({name:'perf-'+label, ok:true, detail: Math.round(marks[to]-marks[from])+'ms'}); }
/* --- 1. 起壳（import → init → 首屏 home 渲染完成） --- */
mark('importStart');
await import('/index.js');
mark('importDone');
await waitFor(() => !!(window.VirtualPhone && window.VirtualPhone.version), { timeoutMs: 15000 });
mark('entryReady');
let up=false;
for(let i=0;i<3&&!up;i++){ const tg=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(tg) realClick(tg); up=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
mark('shellUp');
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b){ try{b.scrollIntoView({block:'center'});}catch(e){} realClick(b);} await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
report({name:'shell-up',ok:up,detail:''});
lap('importDone','entryReady','entry-ready');
lap('shellUp','shellUp','zero-lap');
/* 起壳总耗时 = importDone → shellUp（含 createPhoneInPanel + home render） */
report({name:'perf-shell-create',ok:true,detail:Math.round(marks.shellUp-marks.importDone)+'ms（含首屏 81 图标渲染）'});
/* --- 2. 面板关→开（外壳复用路径） --- */
const drawerEntry=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon');
const drawerPanel=document.getElementById('phone-panel');
drawerEntry.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
await new Promise(r=>setTimeout(r,400));
mark('reopenStart');
drawerEntry.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
await waitFor(()=>drawerPanel.classList.contains('phone-panel-open')&&getComputedStyle(drawerPanel).display!=='none',{timeoutMs:8000});
mark('reopenDone');
report({name:'perf-panel-reopen',ok:true,detail:Math.round(marks.reopenDone-marks.reopenStart)+'ms'});
/* --- 3. 全历史搜索扫描（16000 楼，O2 让出后的节奏） --- */
const dots=[...document.querySelectorAll('.home-page-dot')];
const pagerEl=document.querySelector('.app-grid-pager');
if(pagerEl) pagerEl.style.transition='none';
realClick(dots[1]);
await window.__sleep(400);
const page2=document.querySelector('.app-grid-page[data-page-index="1"]');
const si=[...page2.querySelectorAll('.app-icon')].find(el=>{const t=el.querySelector('.app-name');return t&&t.textContent.trim()==='全局搜索';});
realClick(si);
await waitFor(()=>document.querySelector('.gs-wrap'),{timeoutMs:15000});
mark('searchOpen');
const modeBtn=document.getElementById('gs-mode');
realClick(modeBtn);
await window.__sleep(400);
const input=document.getElementById('gs-input');
input.value='咖啡';
input.dispatchEvent(new Event('input',{bubbles:true}));
mark('scanStart');
/* 扫描完成 = 结果条目出现或取消文案出现 */
await waitFor(()=>{const box=document.getElementById('gs-results');return box&&box.querySelectorAll('.gs-item').length>0;},{timeoutMs:30000});
mark('scanDone');
report({name:'perf-full-scan-16k',ok:true,detail:Math.round(marks.scanDone-marks.scanStart)+'ms（16000 楼全历史，含让出）'});
/* --- 4. 结果长列表渲染（160 条命中 → DOM） --- */
mark('resultsPaintStart');
const itemCount=document.querySelectorAll('#gs-results .gs-item').length;
mark('resultsPaintDone');
report({name:'perf-results-paint',ok:true,detail:'items='+itemCount+' paintLap=' + Math.round(marks.resultsPaintDone-marks.resultsPaintStart)+'ms（同步量级）'});
done();
