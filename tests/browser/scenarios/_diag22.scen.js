
/* _diag22: R-O6 第二层 —— 修前 before 基线取证（动效 / 主线程忙时 / 后台 / 规模档次） */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const LINES = 1500;
const NS = 'st_virtual_phone';
const host = installBrowserHost({ chat: [{ mes: 'x', is_user: false, swipes: ['x'], swipe_id: 0 }] });
host.ctx.chatMetadata[NS] = host.ctx.chatMetadata[NS] || {};
const msgs=[];
for(let i=0;i<LINES;i++){ const c={id:'m'+i,timestamp:1758000000000+i*60000,time:'12:0'+(i%10),isMe:i%2===0};
  msgs.push(i%5===0 && (i/5)<300 ? Object.assign(c,{content:'/apps/calendar/assets/1.png?n='+(i/5),type:'image'}) : Object.assign(c,{content:'第 '+i+' 楼正文',type:'text'})); }
host.ctx.chatMetadata[NS].wechat_data = JSON.stringify({chats:[{id:'c1',name:'长会话',type:'single',timestamp:1758000000000}],contacts:[],settings:{},messages:{}});
host.ctx.chatMetadata[NS].wechat_msg_c1 = JSON.stringify(msgs);
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }

/* ---- 被动采样器：只测「浏览器自己报的长任务」，不自己起轮询（取证工具用，不进产品） ---- */
const lt={count:0,total:0,max:0};
try{ new PerformanceObserver((l)=>{ for(const e of l.getEntries()){ lt.count++; lt.total+=e.duration; if(e.duration>lt.max) lt.max=e.duration; } }).observe({entryTypes:['longtask']}); }catch(_e){}
function resetLT(){ lt.count=0; lt.total=0; lt.max=0; }
function anims(label){
  let all=[]; try{ all=document.getAnimations?document.getAnimations():[]; }catch(_e){ all=[]; }
  const inPanel = all.filter(a=>{ try{ return a.effect && a.effect.target && a.effect.target.closest && !!a.effect.target.closest('#phone-panel'); }catch(_e){ return false; } });
  const inf = inPanel.filter(a=>{ try{ const t=a.effect.getTiming(); return t.iterations===Infinity; }catch(_e){ return false; } });
  const running = inPanel.filter(a=>a.playState==='running');
  const rInf = inf.filter(a=>a.playState==='running');
  report({name:'b22-anims-'+label, ok:true, detail:'panelAnims='+inPanel.length+' running='+running.length+' infinite='+inf.length+' runningInfinite='+rInf.length+' vinylEl='+!!document.querySelector('.home-vinyl-record')});
}
let panelUp=false;
try { await import('/index.js'); } catch(_e){}
const up = await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:25000});
for(let i=0;i<3&&!panelUp;i++){ const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon'); if(t) realClick(t); panelUp=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000}); }
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:12000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){ const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary'); if(b) realClick(b); await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000}); }
report({name:'b22-shell-ready', ok:!!(up&&panelUp), detail:'ver='+String(window.VirtualPhone&&window.VirtualPhone.version)+' lines='+LINES});
async function openWechat(){
  const dots=[...document.querySelectorAll('.home-page-dot')];
  for(const d of dots){ realClick(d); await window.__sleep(250);
    const ic=[...document.querySelectorAll('.app-icon')].find(el=>{const t=el.querySelector('.app-name');return t&&t.textContent.trim()==='微信';});
    if(ic){ realClick(ic); return await waitFor(()=>document.querySelector('.wechat-app'),{timeoutMs:15000}); } }
  return false;
}
async function openLongChat(){ const row=document.querySelector('.wechat-app .chat-item'); if(!row) return false; realClick(row); return await waitFor(()=>document.getElementById('chat-messages'),{timeoutMs:12000}); }
let wechatUp=false, roomUp=false;
try{ wechatUp=await openWechat(); }catch(_e){ wechatUp=false; }
try{ roomUp=wechatUp?await openLongChat():false; }catch(_e){ roomUp=false; }
report({name:'b22-longlist-open', ok:!!(wechatUp&&roomUp), detail:'wechat='+wechatUp+' room='+roomUp+' msgs='+document.querySelectorAll('.chat-message').length+' nodesPerMsg='+(document.querySelectorAll('.chat-message').length?Math.round(document.getElementsByTagName('*').length/document.querySelectorAll('.chat-message').length*100)/100:0)});
if(roomUp){ await window.__sleep(900); }

/* ---- 态 A：面板开着、长会话静置 3s（主线程忙时） ---- */
resetLT(); anims('A-open');
await window.__sleep(3000);
report({name:'b22-busy-A-open', ok:true, detail:'longtask='+lt.count+' totalMs='+Math.round(lt.total*100)/100+' maxMs='+Math.round(lt.max*100)/100+' 口径=Chromium longtask(>50ms) 被动观察 3s 静置'});

/* ---- 态 B：面板隐藏（display:none + PANEL_VISIBILITY）静置 3s ---- */
const panel=document.getElementById('phone-panel');
panel.classList.remove('phone-panel-open'); panel.classList.add('phone-panel-hidden');
panel.style.cssText='display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; position:absolute !important; width:0 !important; height:0 !important; overflow:hidden !important;';
window.dispatchEvent(new CustomEvent('phone:panelVisibility',{detail:{open:false}}));
await window.__sleep(400);
resetLT(); anims('B-panel-hidden');
await window.__sleep(3000);
report({name:'b22-busy-B-panelhidden', ok:true, detail:'longtask='+lt.count+' totalMs='+Math.round(lt.total*100)/100+' maxMs='+Math.round(lt.max*100)/100+' runtimeLive='+String((()=>{try{return window.VirtualPhone.runtimeStats().total;}catch(_e){return 'err';}})())});

/* ---- 态 C：页面隐藏（visibilitychange）静置 3s ---- */
const desc=Object.getOwnPropertyDescriptor(Document.prototype,'hidden');
try{ Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); }catch(_e){}
document.dispatchEvent(new Event('visibilitychange'));
await window.__sleep(400);
resetLT(); anims('C-doc-hidden');
await window.__sleep(3000);
report({name:'b22-busy-C-dochidden', ok:true, detail:'longtask='+lt.count+' totalMs='+Math.round(lt.total*100)/100+' longtaskPerPoll= neste='+lt.count});
if(desc){ try{ Object.defineProperty(document,'hidden',desc); }catch(_e){} }
document.dispatchEvent(new Event('visibilitychange'));

/* ---- 恢复瞬间：是否存在「恢复时全量重算」的可见信号（长任务峰值/一次性大工作量） ---- */
resetLT();
await window.__sleep(20);
panel.classList.remove('phone-panel-hidden'); panel.style.cssText='';
panel.classList.add('phone-panel-open','drawer-content','fillRight','openDrawer');
window.dispatchEvent(new CustomEvent('phone:panelVisibility',{detail:{open:true}}));
await window.__sleep(2500);
report({name:'b22-busy-D-resume', ok:true, detail:'longtask='+lt.count+' totalMs='+Math.round(lt.total*100)/100+' maxMs='+Math.round(lt.max*100)/100+' msgsAfter='+document.querySelectorAll('.chat-message').length+' 口径=恢复窗口 2.5s 一次观察（不是帧率）'});

/* ---- 守护面现状：有没有常驻轮询/采样器 ---- */
report({name:'b22-guard-surface', ok:true, detail:'apiKeys='+JSON.stringify(Object.keys(window.VirtualPhone).filter(k=>/perf|sample|motion|throttle|jank|guard/i.test(k)))+' runtimeByKind='+JSON.stringify((()=>{try{return window.VirtualPhone.runtimeStats().byKind;}catch(_e){return null;}})())+' matchMediaReduce='+String((()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_e){return 'n/a';}})())});
done();
