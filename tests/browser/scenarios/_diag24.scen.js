
/* _diag24: 修前 before —— cards 布局下 infinite 动画是否真在跑；doc-hidden 下的真读数 */
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
    rows.push(nm+'/'+String(it)+'/'+a.playState+'/'+(inPanel?'panel':'out')+'/'+tgt.slice(0,32));
  }
  report({name:'d24-anims-'+label, ok:true, detail:'n='+all.length+' panelRunningInfinite='+rInf+' rows='+JSON.stringify(rows).slice(0,900)});
}
function pet(label){
  const vids=[...document.querySelectorAll('#phone-pet-root video')];
  report({name:'d24-pet-'+label, ok:true, detail:'playing='+vids.filter(v=>!v.paused&&!v.ended).length+'/'+vids.length+' curTime>0='+vids.filter(v=>v.currentTime>0).length+' state='+String(document.getElementById('phone-pet-root')&&document.getElementById('phone-pet-root').dataset.petState)});
}
try { await import('/index.js'); } catch(_e){}
await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
/* 切到卡片布局 */
try{ window.VirtualPhone.storage.set('phone-home-layout','cards'); }catch(_e){}
let panelUp=false;
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
try{ window.VirtualPhone.refreshGlobalFontScale?.(); }catch(_e){}
/* 强制重绘首页（卡片布局） */
try{ const hs=window.VirtualPhone.phoneShell; hs?.render?.(); }catch(_e){}
await window.__sleep(1200);
report({name:'d24-layout', ok:true, detail:'vinylEl='+!!document.querySelector('.home-vinyl-record')+' cardClass='+String(document.querySelector('.phone-card-home-layout')!==null)+' screenClass='+String((document.querySelector('.phone-screen')||{}).className||'')});
anims('home-cards-open');
pet('open');
/* 隐藏文档，但面板仍开着 */
const desc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
try{ Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); }catch(_e){}
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(1500);
anims('doc-hidden-panel-open');
pet('doc-hidden');
if(desc){ try{ Object.defineProperty(document,'hidden',desc); }catch(_e){} }
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(600);
anims('restored');
done();
