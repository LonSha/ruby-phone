import test from 'node:test';
import assert from 'node:assert/strict';
import { liveSources, liveChanges, readLive, writeLive } from '../config/affair-live.js';
function setup() { const map = new Map([['calendar_memos', JSON.stringify([{id:'m', title:'约会',dateKey:'2026-11-08'}])], ['tv_party', {id:'trip',title:'旅行',stops:[]}]]); return {map,storage:{get:k=>map.get(k),set:(k,v)=>map.set(k,v)}}; }
test('真实来源变化按身份更新，不写原始来源', () => {
 const {storage,map} = setup(); const before = new Map(map);
 const source = liveSources(storage); const entry = {id:'e',title:'出游',refs:['calendar:m','travel:trip','calendar:m'],seen:{}};
 assert.equal(liveChanges(entry,source).length,2);
 assert.equal(liveChanges(entry,source)[0].state,'新增');
 entry.seen = Object.fromEntries(source.rows.map(r=>[r.key,r.value]));
 map.set('calendar_memos',JSON.stringify([{id:'m',title:'约会',dateKey:'2026-11-09'}]));
 assert.equal(liveChanges(entry,liveSources(storage))[0].state,'已修改');
 entry.refs = [...new Set(entry.refs)]; assert.equal(writeLive(storage,[entry]),true); assert.equal(readLive(storage).rows.length,1);
 assert.equal(writeLive(storage,[]),true);
 assert.deepEqual(map.get('tv_party'),before.get('tv_party'));
 assert.equal(JSON.parse(map.get('calendar_memos'))[0].dateKey,'2026-11-09');
});
test('坏来源与失效来源区分，坏实况不覆盖', () => {
 const {storage,map}=setup(); const entry={refs:['calendar:m'],seen:{}};
 map.set('calendar_memos','broken'); assert.equal(liveChanges(entry,liveSources(storage))[0].state,'来源读不出来');
 map.set('calendar_memos','[]'); assert.equal(liveChanges(entry,liveSources(storage))[0].state,'来源失效');
 map.set('affairs_live_v1','broken'); assert.equal(writeLive(storage,[]),false);
 assert.equal(map.get('affairs_live_v1'),'broken');
});
test('回复与作品变化可见，读取不调用微信迁移写入口', () => {
 const {storage,map}=setup(); const previous=globalThis.window;
 const messages=[{id:'m1',type:'text',sender:'甲',content:'好'}];
 globalThis.window={VirtualPhone:{wechatApp:{wechatData:{storage,data:{chats:[{id:'c',name:'甲'}],messages:{c:messages}},_messagesLoaded:{c:true},getMessages(){throw Error('must not call');}}}}};
 try {
 map.set('pixiv_content',{novels:[{id:'w',title:'作品',chapters:[]}]});
 const source=liveSources(storage);
 const entry={refs:['reply:c','work:w'],seen:Object.fromEntries(source.rows.map(r=>[r.key,r.value]))};
 messages.push({id:'m2',type:'text',sender:'甲',content:'再见'});
 map.set('pixiv_content',{novels:[{id:'w',title:'作品',chapters:[{text:'新增章节'}]}]});
 assert.deepEqual(liveChanges(entry,liveSources(storage)).map(r=>r.state),['已修改','已修改']);
 assert.equal(JSON.stringify(entry.seen).includes('新增章节'),false);
 } finally {globalThis.window=previous;}
});

test('invalid new payload never overwrites storage', () => { const {storage,map}=setup(); const before=new Map(map); for (const refs of [[],['secret:x'],['calendar:m','calendar:m']]) assert.equal(writeLive(storage,[{id:'e',title:'Event',refs,seen:{}}]),false); assert.deepEqual(map,before); });
