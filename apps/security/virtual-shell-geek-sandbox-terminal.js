/**
 * 手机虚拟沙盒终端与开发者调试台 (Virtual Shell Geek Sandbox Terminal)
 * 提供无宿主风险的沙盒命令行环境，支持 ls/cat/ps/mem/df/inspect 指令调试与存储探查
 */
export class VirtualShellGeekSandboxTerminal {
    constructor(virtualFs = {}) {
        this.virtualFs = {
            '/': ['data', 'system', 'apps', 'storage'],
            '/data': ['wechat_chats.db', 'contacts.vcf', 'app_state.json'],
            '/storage': ['dcim', 'downloads', 'backups'],
            ...virtualFs
        };
        this.history = [];
        this.env = {
            USER: 'pixel_user',
            HOSTNAME: 'rubyphone-term',
            CWD: '/'
        };
    }

    /**
     * 执行虚拟命令行指令
     */
    execute(cmdString = '') {
        const trimmed = cmdString.trim();
        if (!trimmed) return { exitCode: 0, output: '' };
        this.history.push(trimmed);

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
            case 'pwd':
                return { exitCode: 0, output: this.env.CWD };
            case 'ls': {
                const targetDir = args[0] || this.env.CWD;
                const entries = this.virtualFs[targetDir];
                if (!entries) {
                    return { exitCode: 1, output: `ls: cannot access '${targetDir}': No such directory` };
                }
                return { exitCode: 0, output: entries.join('  ') };
            }
            case 'cat': {
                const targetFile = args[0];
                if (!targetFile) return { exitCode: 1, output: 'cat: missing file operand' };
                if (targetFile.includes('app_state.json')) {
                    return { exitCode: 0, output: JSON.stringify({ battery: 92, network: '5G_LTE', activeApps: 3 }) };
                }
                return { exitCode: 0, output: `[RAW BYTES CONTENT OF ${targetFile}]` };
            }
            case 'ps':
                return {
                    exitCode: 0,
                    output: 'PID  TTY   TIME CMD\n 1   ?     0:01 /sbin/phone_init\n 42  tty1  0:00 com.ruby.wechat\n 88  tty1  0:00 com.ruby.darknet'
                };
            case 'mem':
            case 'free':
                return {
                    exitCode: 0,
                    output: 'Total: 8192MB  Used: 2340MB  Free: 5852MB  Buffer: 60fps_virtual_slice'
                };
            case 'help':
                return {
                    exitCode: 0,
                    output: 'Supported commands: ls, cat, pwd, ps, mem, free, help, clear'
                };
            default:
                return { exitCode: 127, output: `vShell: command not found: ${cmd}` };
        }
    }
}

export default VirtualShellGeekSandboxTerminal;