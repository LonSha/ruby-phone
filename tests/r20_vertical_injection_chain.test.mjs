import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_RUNTIME_KEY as KEY, deviceActionCatalog, dispatchDeviceAction as dispatch, buildDeviceRuntimePrompt, advanceDeviceRuntime, reviewDeviceNotifications } from '../config/device-runtime.js';
import { collectMissingAppInjections, mountMissingAppInjection } from '../apps/app-injection.js';
import { LonShaBridge } from '../apps/memory/lonsha-bridge.js';
import { PhoneStorage } from '../config/storage.js';
const catalog = deviceActionCatalog();
const args = (id,p={}) => ({...catalog.find(a=>a.id===id)?.example,...p});
function fixture() {
    let chat='a', writes=0; const buckets=new Map();
    const storage={
        get(k,d=null) { return JSON.parse(buckets.get(chat)?.[k] ?? JSON.stringify(d)); },
        set(k,v) { const b=buckets.get(chat)||{}; b[k]=JSON.stringify(v); buckets.set(chat,b); writes++; return true; }
    };
    const bridge=new LonShaBridge(storage,{}), win={VirtualPhone:{lonshaBridge:bridge}};
    const run=(id,p={})=>{ const result=dispatch(storage,id,args(id,p),win); assert.equal(result.ok,true,`${id}: ${result.error}`); return result; };
    run('configure',{enabled:true,injectToPrompt:true});
    return {storage,bridge,win,run,switchChat(id){chat=id;},writes:()=>writes};
}
const prompt=f=>collectMissingAppInjections(f.win,f.storage).blocks.find(b=>b.appId==='deviceContext')?.content||'';

test('actions -> persisted state -> production collect and generation hook; no injected directive fixture',()=>{
    const f=fixture(); f.run('authenticate'); f.run('impact');
    const text=prompt(f); assert.match(text,/胁迫解锁已生效/); assert.match(text,/屏幕碎裂/); assert.match(text,/剧情设备模拟边界/);
    const callbacks=new Map();
    f.win.SillyTavern={getContext:()=>({event_types:{GENERATE_BEFORE_COMBINE_PROMPTS:'generate'},eventSource:{on:(n,fn)=>callbacks.set(n,fn)}})};
    assert.equal(mountMissingAppInjection(f.win,f.storage),true); assert.equal(mountMissingAppInjection(f.win,f.storage),false);
    const payload={prompt:[]}; callbacks.get('generate')(payload);
    assert.ok(payload.prompt.some(m=>m.role==='system'&&m.content===text));
    const before=f.writes(); prompt(f); prompt(f); assert.equal(f.writes(),before);
});
for (const [name,steps,expected] of [
    ['hardware',[['environment']],/手机无信号/],
    ['power',[['power',{elapsedMinutes:68}]],/低电量|省电/],
    ['sim',[['baseStation']],/伪基站/],
    ['ble',[['peripheral'],['rssi']],/距离告警/],
    ['shell',[['shell']],/Linux沙盒/],
    ['damage',[['impact']],/屏幕碎裂/],
    ['airdrop',[['peer'],['airdrop']],/隔空快传到账/],
    ['duress',[['authenticate']],/胁迫解锁已生效/],
    ['vault',[['domain'],['dossier',{content:'DO_NOT_LEAK_SECRET'}]],/模拟暗域已开启/],
    ['evidence',[['evidence'],['evidence',{id:'evidence-2',location:'码头',source:'wallet'}]],/侦探破绽证据链/],
    ['mesh',[['environment'],['meshPeer'],['meshSend']],/自组网/],
    ['forensic',[['forensic']],/跨设备数字取证/],
    ['security',[['secureFile'],['leak']],/泄露溯源警报/],
    ['voice',[['voice']],/AI拟真语音篡改/]
]) test(`${name}: kernel action -> JSON hydration -> real production prompt`,()=>{
    const f=fixture(); for (const [id,p] of steps) f.run(id,p);
    const text=prompt(f); assert.match(text,expected); assert.doesNotMatch(text,/DO_NOT_LEAK_SECRET/);
    assert.equal(text,buildDeviceRuntimePrompt(f.storage)); assert.ok(f.storage.get(KEY).active.includes(name));
});
test('offline NPC elapsed tick is idempotent; explicit review drains persisted queue',()=>{
    const f=fixture(); f.run('npc'); const now=f.storage.get(KEY).lastTickAt+61*60000;
    assert.equal(advanceDeviceRuntime(f.storage,now).generated,1); assert.match(prompt(f),/离线通知待审阅/);
    assert.equal(advanceDeviceRuntime(f.storage,now).generated,0);
    const got=reviewDeviceNotifications(f.storage); assert.equal(got.ok,true); assert.equal(got.items.length,1);
    assert.equal(reviewDeviceNotifications(f.storage).items.length,0);
});
test('same bridge instance: session switches isolate state and event queues',()=>{
    const f=fixture(); f.run('impact'); const count=f.bridge._holographicBusEvents.length;
    f.switchChat('b'); f.bridge.onChatChanged(); assert.equal(prompt(f),''); assert.equal(f.bridge.drainHolographicEvents().length,0);
    f.run('configure',{enabled:true,injectToPrompt:true}); f.run('baseStation'); assert.doesNotMatch(prompt(f),/屏幕碎裂/);
    f.switchChat('a'); f.bridge.onChatChanged(); assert.match(prompt(f),/屏幕碎裂/); assert.doesNotMatch(prompt(f),/伪基站/);
    assert.equal(f.bridge.drainHolographicEvents().length,count); assert.equal(f.bridge.drainHolographicEvents().length,0);
});
test('actual PhoneStorage class classifies both runtime keys as chat data',()=>{
    const actual=new PhoneStorage(); assert.equal(actual._isChatData(KEY),true); assert.equal(actual._isChatData('device_holographic_events_v1'),true);
});
test('disabled, corrupt, write refused and invalid params do not pretend success',()=>{
    const f=fixture(); f.run('impact'); f.run('configure',{enabled:false}); assert.equal(prompt(f),'');
    assert.equal(dispatch(f.storage,'impact',{}).ok,false);
    assert.equal(dispatch({get:()=>'{bad'},'configure',{enabled:true}).ok,false);
    assert.equal(buildDeviceRuntimePrompt({get:()=>'{bad'}),'');
    assert.equal(dispatch({get:()=>null,set:()=>false},'configure',{enabled:true}).ok,false);
    f.run('configure',{enabled:true}); const before=f.writes();
    for(const p of [{elapsedMinutes:-1},{elapsedMinutes:null},{elapsedMinutes:Infinity},{unknown:1}]) assert.equal(dispatch(f.storage,'power',args('power',p)).ok,false);
    assert.equal(f.writes(),before);
});
test('wipe requires confirmation, clears only simulator secrets and prevents resurrection',()=>{
    const f=fixture(); f.run('domain'); f.run('dossier',{content:'sensitive-simulator-record'}); f.run('shell');
    f.storage.set('wechat_msg_demo',[{text:'must remain'}]); assert.equal(dispatch(f.storage,'wipe',{confirm:false}).ok,false);
    f.run('wipe',{confirm:true}); const saved=f.storage.get(KEY);
    assert.equal(saved.modules.vault,undefined); assert.equal(saved.modules.shell,undefined);
    assert.equal(f.storage.get('wechat_msg_demo')[0].text,'must remain'); assert.match(prompt(f),/自毁/);
    assert.equal(dispatch(f.storage,'domain',args('domain')).ok,false);
    assert.equal(JSON.stringify(f.bridge._holographicBusEvents).includes('sensitive-simulator-record'),false);
});
test('logs and bus queue are bounded; explicit injection off yields empty',()=>{
    const f=fixture(); for(let i=0;i<80;i++) f.run('shell',{command:`ping scene-${i}.test`});
    assert.equal(f.storage.get(KEY).modules.shell.commandExecutionHistory.length,50); assert.ok(f.bridge._holographicBusEvents.length<=50);
    f.run('configure',{injectToPrompt:false}); assert.equal(prompt(f),'');
});
test('settings and both host paths consume production entry points',()=>{
    const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
    assert.match(source('../apps/settings/settings-app.js'),/mountDeviceRuntimeSection\(this\._getActiveSettingsRoot\(\), this\.storage\)/);
    assert.match(source('../index.js'),/advanceDeviceRuntime\(storage\)/);
    assert.match(source('../apps/wechat/chat-view.js'),/collectMissingAppInjections\(/);
});