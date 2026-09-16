/* ============================================================
 * [v2.19.0] 会话隔离第二波 + 集成修复回归测试。
 * ------------------------------------------------------------
 * 背景（本批次修复的真实缺陷，全部为跨批次审计新发现）：
 *  1. jiwen_state 未命中会话隔离 pattern：五轴状态写进全局 extensionSettings，
 *     换角色/换会话串味；引擎内存态永不失效，旧角色漂移状态继续写进新会话。
 *  2. 微信待处理联系人写入键 ggp_pending_contacts / 读取键 pending-contacts
 *     不配对——暂存联系人从未被消费（v2.8.0 起静默丢失）。
 *  3. 显示缩放双源分裂：设置页只写 phone-shell-scale、控制中心只写 sys_shell_scale。
 *  4. 心境 App 积温卡「假交付」：引擎未暴露 state 快照，jw.state 恒 null。
 *
 * 分工：真实运行时（engine.reset / pattern 路由）+ 接线断言（消费点文本）。
 * 不硬编码版本号（版本跨源自洽由 entry-integrity 锁定）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiwen } from '../config/jiwen-engine.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};

// ========== 1. PhoneStorage：jiwen_ 路由到 chatMetadata ==========
{
    const { PhoneStorage } = await import('../config/storage.js');
    const pstore = new PhoneStorage();
    ok('jiwen_state 路由到 chatMetadata', pstore._isChatData('jiwen_state') === true);
    ok('jiwen_ 前缀全量命中', pstore._isChatData('jiwen_anything') === true);
    ok('phone-shell-scale 仍为全局配置（未被误伤）', pstore._isChatData('phone-shell-scale') === false);
}

// ========== 2. createJiwen：reset() 真实运行时契约 ==========
{
    // 可切换上下文的内存 storage（模拟换会话后读写落进新空间）
    const store = { current: {} };
    const storage = {
        get(k, dflt = null) { return (k in store.current) ? store.current[k] : dflt; },
        set(k, v) { store.current[k] = v; }
    };
    const jw = createJiwen({
        onLoad: async () => storage.get('jiwen_state'),
        onSave: async (s) => storage.set('jiwen_state', s),
    });
    // 初始加载 → 推进一个 tick 产生内存态与落盘
    await jw.tick(10);
    const stA = await jw.getState();
    ok('tick 后 state 可见（getState 快照）', typeof stA.connection === 'number');
    ok('引擎暴露 state getter（心境 App 消费点）', jw.state && typeof jw.state.connection === 'number');
    ok('state getter 返回快照副本（外部改动不污染内部）', (() => { const s = jw.state; s.connection = 999; return jw.state.connection !== 999; })());
    // 旧会话空间已落盘
    ok('旧会话空间已写入 jiwen_state', 'jiwen_state' in store.current);
    // 切会话：storage 指向新会话空间
    store.current = {};
    const had = jw.reset();
    ok('reset 返回 true（确有已加载内存态被丢弃）', had === true, String(had));
    ok('reset 后内存态归一为默认值', jw.state.connection === 0 && jw.state.lastActivity === null);
    ok('reset 不落盘（新会话空间未被写入旧状态）', !('jiwen_state' in store.current), JSON.stringify(Object.keys(store.current)));
    // 新会话首次 getState 会惰性加载（新空间为空 → 默认值）
    const stB = await jw.getState();
    ok('reset 后惰性加载新会话（读到默认值而非旧会话状态）', stB.connection === 0);
    // 新会话正常写入
    await jw.tick(5);
    ok('reset 后新会话写入正常', 'jiwen_state' in store.current);
    // 幂等
    jw.reset();
    ok('连续 reset 幂等（第二次返回 false）', jw.reset() === false);
}

// ========== 3. 接线断言（读源码文本，防假交付） ==========
{
    const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const storageSrc = fs.readFileSync(path.join(root, 'config/storage.js'), 'utf8');
    const settingsSrc = fs.readFileSync(path.join(root, 'apps/settings/settings-app.js'), 'utf8');
    const fsSrc = fs.readFileSync(path.join(root, 'phone/font-scale.js'), 'utf8');

    // 3.1 jiwen 会话失效三处
    ok('CHAT_DATA_PATTERNS 收录 /^jiwen_/', /\/\^jiwen_\//.test(storageSrc));
    ok('onChatChanged 调用 jiwen.reset', /VirtualPhone\?\.jiwen\?\.reset\?\.\(\)/.test(idx));
    const resetCount = (idx.match(/jiwen\?\.reset\?\.\(\)/g) || []).length;
    ok('jiwen.reset 接线共 3 处（换会话 + 清数据 x2）', resetCount === 3, String(resetCount));
    // tick 会话守卫：捕获代号先于 tick 调用、守卫先于 chatMetadata 写入
    const tickCap = idx.indexOf('const _tickGeneration = _chatSessionGeneration;');
    const tickCall = idx.indexOf('jw.tick(Math.max(1, elapsedMin))');
    const tickGuard = idx.indexOf('if (_chatSessionGeneration !== _tickGeneration) return;');
    const tickWrite = idx.indexOf("ctx.chatMetadata['st_virtual_phone_jiwen'] = { proactive: directive");
    ok('tick 代号捕获先于 tick 调用', tickCap > 0 && tickCap < tickCall, `cap=${tickCap} call=${tickCall}`);
    ok('tick 守卫先于 chatMetadata 写入', tickGuard > 0 && tickCall < tickGuard && tickGuard < tickWrite, `guard=${tickGuard} write=${tickWrite}`);

    // 3.2 联系人键名统一（注释中可保留旧键名说明，但功能性读写不得再用旧键）
    ok('写入端已改用 pending-contacts（旧键无功能性使用）', !/storage\.(get|set)\('ggp_pending_contacts'/.test(idx));
    ok('写入端与读取端同键', /storage\.set\('pending-contacts', pending\)/.test(idx) && /storage\.get\('pending-contacts'/.test(idx));

    // 3.3 显示缩放双源统一
    ok('settings 引入 SYS_KEYS', /import \{ SYS_KEYS \} from '\.\.\/\.\.\/config\/system-controls\.js'/.test(settingsSrc));
    ok('settings 滑杆双键同写', /storage\.set\('phone-shell-scale', percent\);[\s\S]{0,200}storage\.set\(SYS_KEYS\.SCALE, percent\);/.test(settingsSrc));
    ok('settings 初始化新键优先', /_sysScaleRaw[\s\S]{0,120}normalizePhoneShellScalePercent/.test(settingsSrc));
    ok('font-scale 新键优先回落旧键', /sys_shell_scale[\s\S]{0,220}phone-shell-scale/.test(fsSrc));

    // 3.4 引擎 reset/state 导出存在
    const engineSrc = fs.readFileSync(path.join(root, 'config/jiwen-engine.js'), 'utf8');
    ok('引擎导出 reset', /\n    reset,/.test(engineSrc));
    ok('引擎导出 state getter', /get state\(\) \{ return \{ \.\.\.state \}; \}/.test(engineSrc));
    ok('reset 实现不调用 save（不落盘）', (() => {
        const i = engineSrc.indexOf('function reset() {');
        const j = engineSrc.indexOf('}', engineSrc.indexOf('return hadLoaded;', i));
        const body = engineSrc.slice(i, j);
        return !/save\(/.test(body);
    })());
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);