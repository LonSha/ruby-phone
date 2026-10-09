
/* _diag21: R-O6 第二层修前取证 —— 动效 / 后台 / 采样三条线的真读数 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
try { await import('/index.js'); } catch(_e){}
const up = await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
let panelUp=false;
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
await window.__sleep(1500);

function anims(label){
  let all=[];
  try { all = document.getAnimations ? document.getAnimations() : []; } catch(_e){ all=[]; }
  let running=0, infinite=0, runningInfinite=0;
  const names={};
  for(const a of all){
    const ps = a.playState;
    let it=null; try{ it = a.effect && a.effect.getTiming ? a.effect.getTiming().iterations : null; }catch(_e){}
    const inf = (it===Infinity);
    const rn = (ps==='running');
    if(rn) running++;
    if(inf) infinite++;
    if(rn&&inf){ runningInfinite++;
      let nm='?'; try{ nm = (a.animationName)||(a.effect&&a.effect.getKeyframes?String((a.effect.target&&a.effect.target.className)||''):''); }catch(_e){}
      names[nm]=(names[nm]||0)+1;
    }
  }
  report({name:'diag21-'+label, ok:true, detail:'total='+all.length+' running='+running+' infinite='+infinite+' runningInfinite='+runningInfinite+' names='+JSON.stringify(names)});
}
function petState(label){
  const root=document.getElementById('phone-pet-root');
  const vids = root? [...root.querySelectorAll('video')] : [];
  const playing = vids.filter(v=>!v.paused&&!v.ended).length;
  const withSrc = vids.filter(v=>String(v.getAttribute('src')||'').length>0).length;
  report({name:'diag21-pet-'+label, ok:true, detail:'root='+!!root+' state='+String(root&&root.dataset&&root.dataset.petState)+' videos='+vids.length+' playing='+playing+' withSrc='+withSrc+' petEnabledSetting='+JSON.stringify((()=>{try{return window.VirtualPhone.storage.get('phone-pet-enabled');}catch(_e){return 'err';}})())});
}
anims('panel-open');
petState('panel-open');

/* 关闭面板（走产品自己的 PANEL_VISIBILITY 事件 + 隐藏类，与真实关闭同路径的 DOM 侧） */
const panel=document.getElementById('phone-panel');
panel.classList.remove('phone-panel-open');
panel.classList.add('phone-panel-hidden');
panel.style.cssText='display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
window.dispatchEvent(new CustomEvent('phone:panelVisibility',{detail:{open:false}}));
await window.__sleep(1200);
anims('panel-closed');
petState('panel-closed');

/* 页面隐藏 */
const desc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
try{ Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); }catch(_e){}
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(1200);
anims('doc-hidden');
petState('doc-hidden');
report({name:'diag21-bg-ticks', ok:true, detail:'lockClockTimer='+String(!!(window.VirtualPhone&&window.VirtualPhone.phoneShell&&window.VirtualPhone.phoneShell.lockScreen&&window.VirtualPhone.phoneShell.lockScreen._clockTimer))+' runtimeStats='+JSON.stringify((()=>{try{const s=window.VirtualPhone.runtimeStats();return {live:s.total,byKind:s.byKind};}catch(_e){return null;}})())});
if(desc){ try{ Object.defineProperty(document,'hidden',desc); }catch(_e){} }
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(600);
/* prefers-reduced-motion 是否被任何地方消费 */
report({name:'diag21-reduced-motion', ok:true, detail:'matchMedia-reduce='+String((()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_e){return 'n/a';}})())+' api='+JSON.stringify(Object.keys(window.VirtualPhone).filter(k=>/motion|perf|sample|gate|throttle|visibility/i.test(k)))});
done();
