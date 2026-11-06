/* ============================================================
 * local-sandbox-reverse-shell-executor.js
 * [v4.137.0 · V20 史诗级双计划 · R20-14]
 * 手机终端原生 Linux 沙盒与极客黑客脚本执行机 (Local Sandbox Reverse Shell Executor)
 *
 * 核心机制：
 * 1. 模拟手机内部 Termux / Linux PRoot 极客沙盒环境；
 * 2. 模拟黑客攻防指令执行（如 ping/nmap/curl/sh/openssl）；
 * 3. 产出高度拟真的终端命令输出（Stdout/Stderr/ExitCode）；
 * 4. 驱动角色在黑客攻防对峙中生成极具科技质感的真实终端口令与渗透日志。
 * ============================================================ */

export function createInitialShellSandboxState() {
  return {
    currentWorkingDir: '/home/termux',
    environmentVariables: {
      USER: 'u0_a189',
      SHELL: '/bin/bash',
      PATH: '/data/data/com.termux/files/usr/bin'
    },
    commandExecutionHistory: []
  };
}

/**
 * 执行一条沙盒黑客命令
 */
export function executeSandboxCommand(state, rawCommand) {
  if (!state || !rawCommand) return null;

  const cmd = rawCommand.trim();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  if (cmd.startsWith('ping ')) {
    const host = cmd.split(' ')[1] || '127.0.0.1';
    stdout = `PING ${host} (10.0.0.8): 56 data bytes\n64 bytes from 10.0.0.8: icmp_seq=0 ttl=64 time=12.4 ms\n64 bytes from 10.0.0.8: icmp_seq=1 ttl=64 time=11.8 ms\n--- ${host} ping statistics ---\n2 packets transmitted, 2 packets received, 0.0% packet loss`;
  } else if (cmd.startsWith('nmap ') || cmd.includes('scan')) {
    stdout = `Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for host (192.168.1.105)\nPORT     STATE SERVICE\n22/tcp   open  ssh\n80/tcp   open  http\n443/tcp  open  https\n8080/tcp open  http-proxy\nNmap done: 1 IP address scanned in 1.42 seconds`;
  } else if (cmd.startsWith('cat ') && cmd.includes('shadow')) {
    stderr = 'cat: /etc/shadow: Permission denied';
    exitCode = 1;
  } else if (cmd.startsWith('openssl ') || cmd.includes('decrypt')) {
    stdout = 'SUCCESS: AES-256-GCM Payload decrypted with ephemeral key [0x9F...A2]. Output written to /tmp/secret.dec';
  } else {
    stdout = `[exec] ${cmd} completed successfully.`;
  }

  const resultRecord = {
    command: cmd,
    stdout,
    stderr,
    exitCode,
    executedAt: new Date().toISOString()
  };

  state.commandExecutionHistory.push(resultRecord);
  return resultRecord;
}

/**
 * 生成终端黑客攻防指令
 */
export function generateShellSandboxDirectives(state) {
  if (!state || !Array.isArray(state.commandExecutionHistory) || state.commandExecutionHistory.length === 0) return '';

  const recent = state.commandExecutionHistory.slice(-2);
  const logs = recent.map(r => `$ ${r.command}\n${r.stdout || r.stderr}`).join('\n\n');

  return `【手机极客终端 · Linux沙盒执行输出】\n` +
         `${logs}\n` +
         `指令要求：发话角色刚在手机底层黑客终端执行了上述渗透指令！在台词或心理活动中自然流露出极客操作反馈（如“对方的22端口和8080代理还敞开着”、“秘钥解密成功了”等）。`;
}

const LocalSandboxReverseShellExecutor = {
  createInitialShellSandboxState,
  executeSandboxCommand,
  generateShellSandboxDirectives
};

export default LocalSandboxReverseShellExecutor;