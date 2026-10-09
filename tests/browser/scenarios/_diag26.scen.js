/* _diag26: 深查 —— cards 首页唱盘、宠物降频、floating entry 挂载面 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
try { await import('/index.js'); } catch(_e){}
await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
let panelUp=false;
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
await window.__sleep(1000);
report({name:'d26-before', ok:true, detail:'layout='+String((()=>{try{return window.VirtualPhone.storage.get('phone-home-layout');}catch(_e){return 'err';}})())+' vinyl='+!!document.querySelector('.home-vinyl-record')+' screenClass='+String(document.querySelector('.phone-screen')?.className||'')});
try{ await window.VirtualPhone.storage.set('phone-home-layout','cards'); }catch(_e){}
try{ window.VirtualPhone.home.render({ forceDomRefresh: true }); }catch(_e){}
try{ window.VirtualPhone.phoneShell?.syncHomeLayoutChromeClass?.(); }catch(_e){}
await window.__sleep(1200);
const anims=()=>{ let a=[]; try{ a=document.getAnimations(); }catch(_e){} return a.map(x=>{ let nm='',it=null; try{nm=x.animationName;}catch(_e){} try{it=x.effect.getTiming().iterations;}catch(_e){} return nm+'/'+String(it)+'/'+x.playState+'/'+String(x.effect?.target?.className||'').slice(0,28); }); };
report({name:'d26-after-cards', ok:true, detail:'layout='+String((()=>{try{return window.VirtualPhone.storage.get('phone-home-layout');}catch(_e){return 'err';}})())+' vinyl='+!!document.querySelector('.home-vinyl-record')+' anims='+JSON.stringify(anims())});
/* 宠物控制器状态 */
const fe = (()=>{ try{ return window.VirtualPhone.floatingEntry || null; }catch(_e){ return null; } })();
report({name:'d26-pet-obj', ok:true, detail:'floatingEntryOnVP='+!!fe+' petRoot='+!!document.getElementById('phone-pet-root')+' petVideos='+document.querySelectorAll('#phone-pet-root video').length+' vpKeys='+JSON.stringify(Object.keys(window.VirtualPhone).filter(k=>/float|pet/i.test(k)))});
/* 直接拿宠物控制器：经 floating-entry 实例字段不可达时，用 setActive 的可观察面 */
let petInfo = null;
try{ petInfo = fe && fe.pet ? {active: fe.pet.active, pausedByGate: fe.pet.pausedByGate} : null; }catch(_e){ petInfo='err'; }
report({name:'d26-pet-field', ok:true, detail:'pet='+JSON.stringify(petInfo)});
const desc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
try{ Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); }catch(_e){}
document.dispatchEvent(new Event('visibilitychange'));
window.VirtualPhone.motion?.refresh?.();
await window.__sleep(1200);
const vids=[...document.querySelectorAll('#phone-pet-root video')];
let pet2=null; try{ pet2 = fe && fe.pet ? {active: fe.pet.active, pausedByGate: fe.pet.pausedByGate} : null; }catch(_e){ pet2='err'; }
report({name:'d26-doc-hidden', ok:true, detail:'playing='+vids.filter(v=>!v.paused&&!v.ended).length+'/'+vids.length+' pet='+JSON.stringify(pet2)+' anims='+JSON.stringify(anims())});
if(desc){ try{ Object.defineProperty(document,'hidden',desc); }catch(_e){} }
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(1200);
const vids2=[...document.querySelectorAll('#phone-pet-root video')];
let pet3=null; try{ pet3 = fe && fe.pet ? {active: fe.pet.active, pausedByGate: fe.pet.pausedByGate} : null; }catch(_e){ pet3='err'; }
report({name:'d26-restored', ok:true, detail:'playing='+vids2.filter(v=>!v.paused&&!v.ended).length+'/'+vids2.length+' pet='+JSON.stringify(pet3)});
done();
