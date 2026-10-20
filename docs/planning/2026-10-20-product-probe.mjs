// Planning evidence only. Synthetic inputs; no DOM, host, network or user storage.
import {facetsOf,matchFacets} from '../../config/search-facets.js';
import {GroupVote} from '../../apps/wechat/group-vote.js';
import {processReply,HandoffLedger} from '../../apps/health/health-state-bridge.js';
const out={};
const f=facetsOf('昨天还款',{now:new Date(2026,9,20,12).getTime()});
out.search={facets:f,todayPass:matchFacets({title:'无关日记',ts:new Date(2026,9,20,8).getTime()},f).pass};
const data=new Map(),storage={get:k=>data.get(k),set:(k,v)=>data.set(k,v)};
let hours=0;const h={advanceHours:n=>hours+=n},ledger=new HandoffLedger(storage);
const text='<state_handoff>'+JSON.stringify({facts:[{type:'time_passed',hours:2,note:'已过两小时'}]})+'</state_handoff>';
const one=processReply(text,h,ledger),two=processReply(text,h,ledger);
out.health={hours,firstApplied:one?.applied.length,secondApplied:two?.applied.length,ledgerAdded:[one?.ledgerAdded,two?.ledgerAdded]};
const gv=new GroupVote({wechatData:{getMessages:()=>[{id:'a',type:'group_vote',groupVote:{question:'周一午餐',round:1,options:[{id:'a',label:'面'}]}},{id:'b',type:'group_vote',groupVote:{question:'周五郊游',round:1,options:[{id:'b',label:'公园'}]}}],getGroupMembers:()=>[],getUserInfo:()=>({name:'我'})}});
out.vote=gv.readings('group');
console.log(JSON.stringify(out,null,2));
