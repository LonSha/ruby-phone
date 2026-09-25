
/* O-5 下游侧性能探针：合成数据 + 真模块（无浏览器 / 无宿主）。
 * 口径纪律（两条，都是被上游 O-5 教训换来的）：
 *   ① setup 不计时 —— 把夹具成本算进被测调用，读数可差 290 倍；
 *   ② **先预热** —— 首测含 JIT 编译成本：首版「projectScene 200 在场」报 3.335ms，
 *      反而比「1000 在场」的 1.328ms 慢，那不是算法特征，是冷启动。 */
const P='/home/user/ruby-phone/';
const { projectScene } = await import(P+'apps/place/place-data.js');
const { injectionBlocksOf } = await import(P+'config/injection-contract.js');
const { scoreHit, makeSnippet } = await import(P+'apps/memory/global-search-engine.js');
function bigFace(N){ const presence=[]; for(let f=0;f<N;f++) presence.push({name:'角色'+f, key:'城'+(f%20)+'街'+(f%7), atFloor:f}); return { presence, visits: [], tree: [], nodes: [], track: [] }; }
function bigBlocks(N){ const blocks=[]; for(let i=0;i<N;i++) blocks.push({ref:'b'+i, id:i, label:'块'+i, kept:i%3!==0, chars:100+i, reason:i%3===0?'dropped-budget':'ok', dropped:i%3===0}); return { blocks, round:1, ts:Date.now(), tokens:1234 }; }
const DOCS=[]; for(let i=0;i<2000;i++) DOCS.push('这是第'+i+'条测试文本，包含关键词 记忆 与 剧情 与 手机');
// 预热（不计时）
for(let i=0;i<5;i++){ projectScene(bigFace(1000)); injectionBlocksOf(bigBlocks(2000)); DOCS.forEach(t=>{ scoreHit(t,'记忆 剧情'); makeSnippet(t,'记忆'); }); }
function time(label, setup, fn, reps){
  const hosts=[]; for(let i=0;i<reps;i++) hosts.push(setup());
  const t0=process.hrtime.bigint(); let sum=0;
  for(let i=0;i<reps;i++) sum+=fn(hosts[i])||0;
  const ms=Number(process.hrtime.bigint()-t0)/1e6;
  return { label, per_op_ms:+(ms/reps).toFixed(3), reps };
}
const rows=[];
rows.push(time('projectScene 1000 在场', ()=>bigFace(1000), f=>projectScene(f).presence.length, 7));
rows.push(time('projectScene 200 在场', ()=>bigFace(200), f=>projectScene(f).presence.length, 7));
rows.push(time('injectionBlocksOf 2000 块', ()=>bigBlocks(2000), b=>injectionBlocksOf(b).length, 7));
rows.push(time('injectionBlocksOf 500 块', ()=>bigBlocks(500), b=>injectionBlocksOf(b).length, 7));
rows.push(time('scoreHit x2000 文档', ()=>DOCS.slice(), d=>d.reduce((a,t)=>a+(scoreHit(t,'记忆 剧情')||0),0), 5));
rows.push(time('makeSnippet x2000 文档', ()=>DOCS.slice(), d=>d.reduce((a,t)=>a+String(makeSnippet(t,'记忆')||'').length,0), 5));
console.log(JSON.stringify({synth:true, note:'合成数据 + 真模块（非实机；无浏览器 / 无 SillyTavern 宿主参与）', warmup:true, rows}, null, 1));
