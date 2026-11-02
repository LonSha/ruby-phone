import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUsagePattern, getUsagePattern } from '../config/usage-pattern.js';
import { trackerNote, trackerClose } from '../config/usage-tracker.js';
import { PhoneStorage } from '../config/storage.js';
import { withAuditCopy } from './lib/audit-copy.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
function fixture() {
    let data = null, at = 1700000000000;
    const chat = new Map();
    const storage = { usagePatternStore: () => ({ read: () => structuredClone(data), write: value => { data = structuredClone(value); return true; } }),
        get: (k, d) => chat.get(k) ?? d, set: (k,v) => chat.set(k,v) };
    return { storage, api: createUsagePattern(storage, () => at), tick: ms => { at += ms; }, chat };
}
test('default off causes zero device writes and never records', () => {
    const f = fixture();
    assert.equal(f.api.open('wechat'), false);
    assert.deepEqual(f.api.summary(['wechat']), { enabled: false, rows: [] });
    assert.equal(f.api.trace('wechat').state, 'never');
    assert.equal(f.storage.usagePatternStore().read(), null);
});
function lifecycle(api, tick) {
    assert.equal(api.configure(true), true);
    for(let i=0;i<3;i++) { api.open('wechat'); tick(1000); api.close(); }
    assert.equal(api.trace('wechat').state, 'rare');
    assert.equal(api.trace('wechat').count, 3);
    assert.equal(api.trace('wechat').ms, 3000);
    tick(14 * 86400000);
    assert.equal(api.trace('wechat').state, 'faded');
    assert.equal(api.acknowledge('wechat'), true);
    assert.equal(api.trace('wechat').acknowledged, true);
    api.clear();
    assert.equal(api.trace('wechat').state, 'never');
}
test('fake wall clock: three opens rare, inactivity faded, clear never', () => { const f=fixture(); lifecycle(f.api,f.tick); });
test('habitual, caps, close idempotency and backwards clock', () => {
    const f=fixture(); f.api.configure(true);
    for(let i=0;i<10;i++) f.api.open('music');
    assert.equal(f.api.trace('music').state,'habitual');
    f.tick(86400000); f.api.close(); f.api.close();
    assert.equal(f.api.trace('music').ms,4*3600000);
    f.api.open('music'); f.tick(-1000); f.api.close();
    assert.equal(f.api.trace('music').ms,4*3600000);
});
test('disable freezes aggregates, hides rows; clear cannot revive an active visit', () => {
    const f=fixture(); f.api.configure(true); f.api.open('music'); f.api.configure(false);
    const before=f.storage.usagePatternStore().read(); f.api.open('music'); f.api.close();
    assert.deepEqual(f.storage.usagePatternStore().read(),before);
    assert.deepEqual(f.api.summary(['music']).rows,[]);
    f.api.configure(true); f.api.open('music'); f.api.clear(); f.api.close();
    assert.equal(f.api.trace('music').state,'never');
});
test('storage failure, corrupt data, invalid IDs and count-zero are safe', () => {
    const bad=createUsagePattern({ usagePatternStore(){ throw Error('denied'); } });
    assert.equal(bad.open('wechat'),false); assert.equal(bad.configure(true),false);
    const f=fixture(); f.api.configure(true);
    for(const id of ['__proto__','constructor','<img>',null]) assert.equal(f.api.open(id),false);
    f.storage.usagePatternStore().write({version:1,enabled:true,apps:{wechat:{count:0,lastAt:1,ms:50}}});
    assert.equal(f.api.trace('wechat').state,'never');
});
test('existing tracker feeds same device singleton, without changing legacy session output when off', () => {
    const f=fixture(); const api=getUsagePattern(f.storage);
    assert.equal(api,getUsagePattern(f.storage));
    trackerNote(f.storage,'wechat',1000);trackerClose(f.storage,2000);
    const off=f.chat.get('usage_stats_v1'); f.chat.clear();
    api.configure(true);trackerNote(f.storage,'wechat',1000);trackerClose(f.storage,2000);
    assert.equal(f.chat.get('usage_stats_v1'),off);
    assert.equal(api.trace('wechat').count,1);assert.equal(api.trace('wechat').ms,1000);
});
test('PhoneStorage device vault stays outside enumerable buckets and survives instance replacement', () => {
    const old=globalThis.localStorage; const local=new Map();
    globalThis.localStorage={getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)};
    try {
        const store=Object.create(PhoneStorage.prototype);
        store._getChatMetadataStore=()=>({role:'unchanged'});store._getExtensionSettingsStore=()=>({theme:'unchanged'});
        const before=store.enumerateKeys(); const api=createUsagePattern(store,()=>1000);
        api.configure(true);api.open('wechat');
        assert.deepEqual(store.enumerateKeys(),before);
        assert.equal(createUsagePattern(store,()=>1000).trace('wechat').count,1);
        assert.equal(local.size,1);
    } finally { if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old; }
});
test('real kernel mutant is rejected by the same lifecycle criterion', async () => {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rp-pattern-negative-'));
    try {
        fs.writeFileSync(path.join(temp,'package.json'),'{"type":"module"}');
        const src=fs.readFileSync(path.join(ROOT,'config/usage-pattern.js'),'utf8');
        const anchor="at - row.lastAt >= 14 * DAY";
        assert.equal(src.split(anchor).length-1,1);
        fs.writeFileSync(path.join(temp,'usage-pattern.js'),src.replace("'./time-source.js'",JSON.stringify(path.join(ROOT,'config/time-source.js'))).replace(anchor,'false'));
        const mutant=await import(path.join(temp,'usage-pattern.js'));
        const f=fixture();
        let clock=1700000000000;
        assert.throws(()=>lifecycle(mutant.createUsagePattern(f.storage,()=>clock),ms=>{clock+=ms;}),{name:'AssertionError'});
    } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
test('audit copy uses independent bytes, skips artifacts and cleans up on throw', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'rp-copy-test-'));let copied;
    try {
        fs.mkdirSync(path.join(root,'scripts')); fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
        fs.writeFileSync(path.join(root,'scripts','gate.mjs'),'export const x=1;');
        fs.mkdirSync(path.join(root,'node_modules'));fs.writeFileSync(path.join(root,'node_modules','junk.js'),'bad');
        assert.throws(()=>withAuditCopy(root,dir=>{
            copied=dir;assert.equal(fs.existsSync(path.join(dir,'node_modules')),false);
            fs.writeFileSync(path.join(dir,'scripts','gate.mjs'),'damaged');
            assert.equal(fs.readFileSync(path.join(root,'scripts','gate.mjs'),'utf8'),'export const x=1;');
            throw Error('test cleanup');
        }),/test cleanup/);
        assert.equal(fs.existsSync(copied),false);
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('settings mounts a separate section after existing binding', () => {
    const src=fs.readFileSync(path.join(ROOT,'apps/settings/settings-app.js'),'utf8');
    assert.match(src,/this\.bindEvents\(\);\s*mountUsagePattern\(this\._getActiveSettingsRoot\(\), this\.storage\)/);
    assert.ok(fs.statSync(path.join(ROOT,'config/usage-pattern.js')).size<=8192);
});
