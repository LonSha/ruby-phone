// [v2.8.13] 私有耦合收敛测试: graph-bridge 优先走记忆插件官方门面
// 不变量: 门面存在时优先用门面; 门面缺失时降级到旧 engine 直访 (向后兼容)。
const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { results.push(name); console.log(`✓ ${name}`); }
  else { console.error(`✗ ${name} ${detail}`); process.exitCode = 1; }
};

// ---- 浏览器环境最小 mock ----
const win = {};
globalThis.window = win;

const { GraphBridge } = await import('../apps/memory/graph-bridge.js');

// ============================================================
// 1. 门面优先: getPublicData 存在时不再触 engine 深层结构
// ============================================================
{
  let engineTouched = false;
  const pubData = {
    graph: { nodes: [{ id: 'n1', name: '角色A', type: 'character' }], edges: [] },
    summaries: [{ id: 's1' }], diaries: [], povs: [], timeline: [], status: null, ledger: null, vectors: []
  };
  win.LonShaMemory = {
    getPublicData() { return pubData; },
    get engine() { engineTouched = true; return null; } // 访问引擎会被记录
  };
  const b = new GraphBridge();
  ok('门面可用时 probe() 为 true', b.probe() === true);
  const d = b.getData(true);
  ok('getData 走门面返回 runtime 源', d && d.source === 'runtime');
  ok('getData 数据来自门面 (含节点)', d.graph.nodes.length === 1 && d.graph.nodes[0].name === '角色A');
  ok('门面路径未触碰 engine 深层结构', engineTouched === false);
}

// ============================================================
// 2. 降级: 无 getPublicData 的旧版记忆插件仍可用
// ============================================================
{
  win.LonShaMemory = {
    engine: {
      graph: { nodes: new Map([['k1', { id: 'n9', name: '旧版角色' }]]), edges: new Map() },
      summary: { summaries: [] }
    }
  };
  const b = new GraphBridge();
  ok('旧版插件 probe() 为 true (engine 降级)', b.probe() === true);
  const d = b.getData(true);
  ok('降级路径返回 runtime 源', d && d.source === 'runtime');
  ok('降级路径仍能从 engine.graph 读节点', d.graph.nodes.length === 1 && d.graph.nodes[0].name === '旧版角色',
     JSON.stringify(d?.graph?.nodes).slice(0, 100));
}

// ============================================================
// 3. 写入门面: getGraphWriter 优先, 缺失时降级 engine.graph
// ============================================================
{
  // 3a. 门面写入优先
  let facadeUsed = false, engineUsed = false;
  const fakeGraph = { addNode() { return 'newid'; }, addEdge() {}, nodes: new Map() };
  win.LonShaMemory = {
    getGraphWriter() { facadeUsed = true; return fakeGraph; },
    get engine() { engineUsed = true; return null; }
  };
  win.VirtualPhone = { memoryCore: { longTerm: [{ content: '高价值手机记忆', importance: 8, tags: [] }] } };
  const b = new GraphBridge();
  const n = b.pushPhoneMemories({ minImportance: 7 });
  ok('pushPhoneMemories 经门面写入节点', n === 1, `n=${n}`);
  ok('写入门面被调用', facadeUsed === true);
  ok('门面可用时未触 engine', engineUsed === false);

  // 3b. 降级写入
  facadeUsed = false;
  let engineGraphUsed = false;
  const fakeGraph2 = { addNode() { return 'x'; }, addEdge() {}, nodes: new Map() };
  win.LonShaMemory = { engine: { get graph() { engineGraphUsed = true; return fakeGraph2; } } };
  const b2 = new GraphBridge();
  const n2 = b2.pushPhoneMemories({ minImportance: 7 });
  ok('旧版降级写入节点', n2 === 1, `n2=${n2}`);
  ok('降级路径用了 engine.graph', engineGraphUsed === true);
}

// ============================================================
// 4. 插件不可用: 双侧都安全返回
// ============================================================
{
  delete win.LonShaMemory;
  const b = new GraphBridge();
  ok('插件缺失时 probe() 为 false', b.probe() === false);
  ok('插件缺失时 pushPhoneMemories 返回 0', b.pushPhoneMemories() === 0);
}

console.log(`\n[graph-facade] ${results.length} 项断言全部通过`);