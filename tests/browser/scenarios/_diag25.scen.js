/* _diag25: R-O6 第二层 —— 改后读数（动效档 / 后台降频 / 采样器 / 恢复重取） */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
function anims(label){
  let all=[]; try{ all=document.getAnimations?document.getAnimations():[]; }catch(_e){ all=[]; }
  const rows=[]; let rInf=0;
  for(const a of all){
    let nm='',it=null,tgt='',inPanel=false;
    try{ nm=String(a.animationName||''); }catch(_e){}
    try{ it=a.effect.getTiming().iterations; }catch(_e){}
    try{ const t=a.effect.target; tgt=String((t&&t.className)||''); inPanel=!!(t&&t.closest&&t.closest('#phone-panel')); }catch(_e){}
    if(inPanel && a.playState==='running' && it===Infinity) rInf++;
    rows.push(nm+'/'+String(it)+'/'+a.playState+'/'+(inPanel?'panel':'out'));
  }
  report({name:'d25-anims-'+label, ok:true, detail:'n='+all.length+' panelRunningInfinite='+rInf+' rows='+JSON.stringify(rows).slice(0,700)});
}
function petState(label){
  const vids=[...document.querySelectorAll('#phone-pet-root video')];
  report({name:'d25-pet-'+label, ok:true, detail:'playing='+vids.filter(v=>!v.paused&&!v.ended).length+'/'+vids.length+' paused='+vids.filter(v=>v.paused).length});
}
function motionFace(label){
  const de=document.documentElement;
  const m=window.VirtualPhone && window.VirtualPhone.motion;
  report({name:'d25-motion-'+label, ok:true, detail:'data-motion='+String(de.getAttribute('data-motion'))+' data-still='+String(de.getAttribute('data-still'))+' stats='+JSON.stringify(m?m.stats():null).slice(0,600)});
}
try { await import('/index.js'); } catch(_e){}
const up = await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
let panelUp=false;
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
report({name:'d25-ready', ok:!!(up&&panelUp), detail:'ver='+String(window.VirtualPhone&&window.VirtualPhone.version)+' motionApi='+String(!!(window.VirtualPhone&&window.VirtualPhone.motion))});
await window.__sleep(1200);
try{ window.VirtualPhone.storage.set('phone-home-layout','cards'); }catch(_e){}
try{ window.VirtualPhone.phoneShell?.render?.(); }catch(_e){}
await window.__sleep(900);
report({name:'d25-cards', ok:true, detail:'vinylEl='+!!document.querySelector('.home-vinyl-record')+' cardClass='+document.body.className.length});
anims('A-open-full');
petState('A-open');
motionFace('A-open');
/* —— 切到 reduced：装饰类应停，状态类保留 —— */
try{ window.VirtualPhone.storage.set('sys_motion_level','reduced'); }catch(_e){}
window.VirtualPhone.motion?.refresh?.();
await window.__sleep(900);
anims('B-open-reduced');
motionFace('B-open-reduced');
/* —— 切到 still：状态类也停 —— */
try{ window.VirtualPhone.storage.set('sys_motion_level','still'); }catch(_e){}
window.VirtualPhone.motion?.refresh?.();
await window.__sleep(900);
anims('C-open-still');
motionFace('C-open-still');
/* —— 回 full —— */
try{ window.VirtualPhone.storage.set('sys_motion_level','full'); }catch(_e){}
window.VirtualPhone.motion?.refresh?.();
await window.__sleep(900);
anims('D-open-full2');
motionFace('D-open-full2');
/* —— 页面隐藏：动效停 + 宠物暂停 + 采样器断开 —— */
const desc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
try{ Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); }catch(_e){}
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(1500);
anims('E-doc-hidden');
petState('E-doc-hidden');
motionFace('E-doc-hidden');
/* —— 恢复：宠物复播 + 采样器复订 + resumes 增 —— */
if(desc){ try{ Object.defineProperty(document,'hidden',desc); }catch(_e){} }
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(1500);
anims('F-restored');
petState('F-restored');
motionFace('F-restored');
/* —— 面板隐藏（页面可见）—— */
const panel=document.getElementById('phone-panel');
panel.classList.remove('phone-panel-open'); panel.classList.add('phone-panel-hidden');
panel.style.cssText='display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
window.dispatchEvent(new CustomEvent('phone:panelVisibility',{detail:{open:false}}));
await window.__sleep(1200);
anims('G-panel-hidden');
petState('G-panel-hidden');
motionFace('G-panel-hidden');
report({name:'d25-sampler', ok:true, detail:'perf='+JSON.stringify((()=>{try{return window.VirtualPhone.motion.perf();}catch(_e){return null;}})())+' runtimeLive='+String((()=>{try{return window.VirtualPhone.runtimeStats().total;}catch(_e){return 'err';}})())});
done();
