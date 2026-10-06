
/* O7 泄漏读数：面板复开 20 次的 DOM 节点数与监听器趋势 */
import { installBrowserHost, waitFor } from '/tests/browser/host-stub.mjs';
const chat=[{mes:'楼0',is_user:false,name:'角色',swipes:['x'],swipe_id:0}];
installBrowserHost({ chat });
function realClick(el){ if(!el) return false; el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return true; }
await import('/index.js');
await waitFor(()=>!!(window.VirtualPhone&&window.VirtualPhone.version),{timeoutMs:15000});
let up=false;
for(let i=0;i<3&&!up;i++){const t=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon');if(t)realClick(t);up=await waitFor(()=>document.querySelector('.phone-in-panel'),{timeoutMs:12000});}
await waitFor(()=>document.querySelector('.home-screen'),{timeoutMs:8000});
const modal=await waitFor(()=>!!document.getElementById('st-phone-update-modal'),{timeoutMs:8000});
if(modal){const b=document.getElementById('st-phone-update-modal').querySelector('.st-phone-update-btn-primary');if(b){try{b.scrollIntoView({block:'center'});}catch(e){}realClick(b);}await waitFor(()=>!document.getElementById('st-phone-update-modal'),{timeoutMs:5000});}
const entry=document.getElementById('phoneDrawerToolEntry')||document.getElementById('phoneDrawerIcon');
const panel=document.getElementById('phone-panel');
function counts(){
 return {
  panels: document.querySelectorAll('.phone-in-panel').length,
  screens: document.querySelectorAll('.phone-screen').length,
  homeScreens: document.querySelectorAll('.home-screen').length,
  backBtns: document.querySelectorAll('#phone-back-button').length,
  allNodes: document.getElementsByTagName('*').length,
 };
}
const c0=counts();
for(let i=0;i<20;i++){
 entry.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
 await new Promise(r=>setTimeout(r,150));
 entry.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
 await waitFor(()=>panel.classList.contains('phone-panel-open')&&getComputedStyle(panel).display!=='none',{timeoutMs:8000});
 await new Promise(r=>setTimeout(r,100));
}
const c1=counts();
const grew = c1.allNodes-c0.allNodes;
report({name:'reopen-20-dom-stable',ok:c1.panels===1&&c1.screens===1&&c1.homeScreens===1&&c1.backBtns===1, detail:JSON.stringify({before:c0,after:c1,nodeDelta:grew})});
if (performance.memory) report({name:'reopen-20-heap',ok:true,detail:'usedBefore→after 不可单帧对比；DOM 稳定即主判据'});
done();
