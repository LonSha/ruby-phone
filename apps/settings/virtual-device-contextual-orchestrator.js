/* ============================================================
 * virtual-device-contextual-orchestrator.js
 * [v4.137.0 · V20 史诗级双计划 · R20-18 · 终极收官之作]
 * 虚拟手机全息情境综合编排与认知指令投射中枢 (Virtual Device Contextual Orchestrator & Cognitive Projector)
 *
 * 核心机制：
 * 1. 终极聚合控制器：作为 RubyPhone 第二十期全部系统工具、硬件感知与安全机制的顶层神经中枢；
 * 2. 冲突仲裁与优先级分层：
 *    - P0: 熔断与绝密危机（自毁已触发、强制关机、伪基站监听、AI拟真克隆诈骗）
 *    - P1: 现实物理与外设受阻（屏幕碎裂断触、低电量濒临关机、近场隔空快传接收、外设蓝牙断开）
 *    - P2: 侦探物证与极客沙盒渗透（不在场证明矛盾、终端命令日志）
 * 3. 动态 Token 预算压缩与精简：防止多项指令同时爆发导致提示词爆炸，严格精炼为高度拟真的行动指引；
 * 4. 全息共生总线双向投射：将仲裁后的关键设备态打包广播给 LonSha 记忆中枢，实现双系统无缝共振。
 * ============================================================ */

export function createInitialDeviceOrchestratorState() {
  return {
    activeDirectivesQueue: [],
    lastOrchestrationTimestamp: null,
    totalArbitrationsCount: 0
  };
}

/**
 * 聚合来自各子系统的提示词指令并进行优先级分层仲裁
 */
export function arbitrateDeviceDirectives({
  powerDirective = '',
  simDirective = '',
  bleDirective = '',
  shellDirective = '',
  damageDirective = '',
  airdropDirective = '',
  duressDirective = '',
  voiceTamperDirective = '',
  hardwareDirective = '', meshDirective = '', evidenceDirective = '',
  forensicDirective = '', leakDirective = '', vaultDirective = '', notificationDirective = ''
} = {}) {
  const p0Critical = [];
  const p1Urgent = [];
  const p2Context = [];

  // P0: 涉及生命安危、不可逆自毁、伪基站监听、克隆伪造
  if (duressDirective) p0Critical.push(duressDirective);
  if (voiceTamperDirective) p0Critical.push(voiceTamperDirective);
  if (simDirective && simDirective.includes('伪基站')) p0Critical.push(simDirective);
  if (powerDirective && powerDirective.includes('强制黑屏关机')) p0Critical.push(powerDirective);

  if (leakDirective) p0Critical.push(leakDirective);
  if (hardwareDirective) p1Urgent.push(hardwareDirective);
  // P1: 物理设备残损、极度低电量、隔空投送接收
  if (powerDirective && !powerDirective.includes('强制黑屏关机')) p1Urgent.push(powerDirective);
  if (damageDirective) p1Urgent.push(damageDirective);
  if (airdropDirective) p1Urgent.push(airdropDirective);
  if (bleDirective && bleDirective.includes('距离告警')) p1Urgent.push(bleDirective);

  // P2: 常规外设连接、极客终端输出、国际漫游
  if (shellDirective) p2Context.push(shellDirective);
  if (bleDirective && !bleDirective.includes('距离告警')) p2Context.push(bleDirective);
  if (simDirective && !simDirective.includes('伪基站')) p2Context.push(simDirective);

  for (const item of [meshDirective, evidenceDirective, forensicDirective, vaultDirective, notificationDirective]) {
    if (item) p2Context.push(item);
  }
  // 严格按 P0 -> P1 -> P2 组装，限制最多输出 3 条最核心矛盾
  const selected = [];
  for (const item of p0Critical) {
    if (selected.length < 3) selected.push(item);
  }
  for (const item of p1Urgent) {
    if (selected.length < 3) selected.push(item);
  }
  for (const item of p2Context) {
    if (selected.length < 3) selected.push(item);
  }

  // Enforce a character budget, not an unverified token claim. Never stringify arbitrary objects.
  let remaining = 3200;
  for (let i = 0; i < selected.length; i++) {
    const text = typeof selected[i] === 'string' ? selected[i] : '';
    selected[i] = text.slice(0, Math.min(1200, remaining));
    remaining -= selected[i].length;
  }
  if (selected.length === 0) return '';

  return `【虚拟手机情境全息编排 · 物理与数字环境综合指示】\n` +
         selected.join('\n\n') + '\n\n' +
         `※ 角色须知：上述手机物理硬件与网络事件正在真实发生，请根据优先级在行动与台词中自然体现。`;
}

const VirtualDeviceContextualOrchestrator = {
  createInitialDeviceOrchestratorState,
  arbitrateDeviceDirectives
};

export default VirtualDeviceContextualOrchestrator;