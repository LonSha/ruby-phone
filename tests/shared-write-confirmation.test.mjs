import { LonShaBridge } from '../apps/memory/lonsha-bridge.js';
import { PhoneStorage } from '../config/storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Core from '../apps/memory/memory-data.js';
const block = text => ({items:[{text, kind:'fact'}]});
function instance(storage) {return Object.assign(Object.create(Core.prototype),{storage,longTerm:[],_sharedWriteCount:0});}
test('private by default; confirmed world writes survive reload and clear failures are retryable',async()=>{
 let data,fail=false; const storage={get:()=>data,async set(k,v){if(fail) throw Error('quota'); data=v;}};
 const a=instance(storage); await a._absorbMemoryBlock(block('private'), 'assistant', {cardId:'A'});
 assert.equal(instance(storage)._sharedStoreNow().world.length,0);
 await Promise.all(['public one','public two'].map(text=>a._absorbMemoryBlock(block(text),'assistant',{sharedLevel:'world'})));
 assert.equal(instance(storage)._sharedStoreNow().world.length,2);
 fail=true; assert.equal(await a.clearShared(),false); assert.equal(a._sharedWriteCount,2); assert.equal(a._sharedStoreNow().world.length,2);
 assert.equal(instance(storage)._sharedStoreNow().world.length,2);
 fail=false; assert.equal(await a.clearShared(),true); assert.equal(instance(storage)._sharedStoreNow().world.length,0);
});

test('memo-only reply survives reopening card A and is absent on card B', () => {
    const rows = new Map();
    const open = card => new Core({
        get: key => rows.get((key === 'memory_core_v1' ? card : 'global') + key),
        set: (key, value) => rows.set((key === 'memory_core_v1' ? card : 'global') + key, value)
    });
    const a = open('A');
    a.record('ai', '```memo\nevent | 私人校历提醒\n```', {}, { floor: 1 });
    a._save(true);
    assert.match(JSON.stringify(open('A').recallShared({text: '私人校历'}).items), /私人校历提醒/);
    assert.doesNotMatch(JSON.stringify(open('B').recallShared({text: '私人校历'}).items), /私人校历提醒/);
    assert.equal(rows.size, 1);
});

test('failed shared reset leaves session memory intact', async () => {
    const a = new Core({ get() {}, async set() { throw Error('quota'); } });
    a.shortTerm.push({ content: 'keep' });
    assert.equal(await a.clear(), false);
    assert.equal(a.shortTerm[0].content, 'keep');
    assert.equal(a._sharedWriteCount, 0);
test('calendar recall needs explicit scoped consent, a current row and plugin acceptance', t => {
    const rows = [{id:'same', title:'test appointment', dateKey:'2027-02-01'}];
    const storage = { currentConversationId:'A', getContext:()=>({getCurrentChatId:()=>'chat'}), get:()=>rows };
    let state = 'accepted';
    const old = globalThis.window;
    globalThis.window = {LonShaMemory:{engine:{phoneFactBridgeHandle:()=>({lifecycle:{state}})}}};
    t.after(() => {if (old === undefined) delete globalThis.window; else globalThis.window = old;});
    const read = () => LonShaBridge.prototype._calendarHits.call({storage}, 'appointment', 3);
    assert.deepEqual(read(), []);
    rows[0].memoryScope = 'A';
    rows.push({...rows[0]});
    assert.equal(read().length, 1);
    rows[0].dateKey = '2027-02-04';
    assert.match(read()[0].content, /02-04/);
    storage.currentConversationId = 'B';
    assert.deepEqual(read(), []);
    storage.currentConversationId = 'A';
    state = 'pending';
    assert.deepEqual(read(), []);
    state = 'accepted';
    rows.length = 0;
    assert.deepEqual(read(), []);
});

});

test('host resolving its save is insufficient; readback must match', async t => {
    const disk = {bucket: 'old'};
    const ctx = {saveSettings: async () => {}, getRequestHeaders: () => ({})};
    t.mock.method(globalThis, 'fetch', async () => ({ok: true, json: async () => ({
        settings: JSON.stringify({extension_settings: {phone: disk}})
    })}));
    const confirm = () => PhoneStorage.prototype._confirmHostSettings.call({NAMESPACE:'phone'}, ctx, ns => ns.bucket === 'new');
    await assert.rejects(confirm, /mismatch/);
    disk.bucket = 'new';
    await confirm();
});