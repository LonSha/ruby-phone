
/* _diag23: 动效面枚举（修前真读数）：document.getAnimations() 逐条 dump */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
function dump(label){
  let all=[]; try{ all=document.getAnimations?document.getAnimations():[]; }catch(_e){ all=[]; }
  const rows=[];
  for(const a of all){
    let nm='', it=null, tgt='', inPanel=false, vis=false;
    try{ nm=String(a.animationName||''); }catch(_e){}
    try{ it=a.effect.getTiming().iterations; }catch(_e){}
    try{ const t=a.effect.target; tgt=String((t&&t.className)||(t&&t.id)||''); inPanel=!!(t&&t.closest&&t.closest('#phone-panel')); 
         if(t&&t.getBoundingClientRect){ const r=t.getBoundingClientRect(); vis=(r.width>0&&r.height>0); } }catch(_e){}
    rows.push({nm, it:String(it), st:a.playState, tgt:tgt.slice(0,44), inPanel, vis});
  }
  report({name:'d23-'+label, ok:true, detail:'n='+all.length+' rows='+JSON.stringify(rows).slice(0,1400)});
}
try { await import('/index.js'); } catch(_e){}
const up = await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
let panelUp=false;
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
await window.__sleep(1200);
dump('home-open');
report({name:'d23-vinyl-present', ok:true, detail:'vinylEl='+!!document.querySelector('.home-vinyl-record')+' vinylRect='+JSON.stringify((()=>{const e=document.querySelector('.home-vinyl-record'); if(!e) return null; const r=e.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)};})())});
/* 打开通话APP：验证 .phone-call-* 那组无限动画 */
const dots=[...document.querySelectorAll('.home-page-dot')];
let callUp=false;
for(const d of dots){ realClick(d); await window.__sleep(250);
  const ic=[...document.querySelectorAll('.app-icon')].find(el=>{const t=el.querySelector('.app-name');return t&&/通话|电话/.test(t.textContent.trim());});
  if(ic){ realClick(ic); callUp=await waitFor(()=>document.querySelector('.phone-call-app, .phone-call-transcript, .call-fullscreen'),{timeoutMs:9000}); break; } }
await window.__sleep(900);
report({name:'d23-call-open', ok:true, detail:'callUp='+callUp});
dump('call-open');
/* 隐藏面板后 */
const panel=document.getElementById('phone-panel');
panel.classList.remove('phone-panel-open'); panel.classList.add('phone-panel-hidden');
panel.style.cssText='display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
window.dispatchEvent(new CustomEvent('phone:panelVisibility',{detail:{open:false}}));
await window.__sleep(900);
dump('panel-hidden');
report({name:'d23-reduced', ok:true, detail:'matchMediaReduce='+String((()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_e){return 'n/a';}})())});
done();
