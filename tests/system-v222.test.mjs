/* ============================================================
 * [v2.22.0] 配置死角收口 回归测试。
 * ------------------------------------------------------------
 * 背景（读写配对审计命中的三个「消费端就绪、配置端缺席」缺陷）：
 *  1. phone-sms-limit：短信注入条数（phone-view L1441 / chat-view L2204 =
 *     _readNonNegativeLimit，线下 index.js 短信段），全仓库零写入——值恒为
 *     默认 20。同组电话 phone-call-limit 有 UI，且其描述「控制每段电话通话
 *     及每个短信会话注入酒馆正文的最近消息条数」谎称管短信，实际只写
 *     phone-call-limit，构成假交付。
 *  2. wechat-moments-context-limit：朋友圈上下文条数（chat-view L1996 /
 *     index.js 线下注入），设置页「手机内微信线上聊天」5 个 limit 输入框
 *     群里独缺朋友圈。
 *  3. phone-asr-auto-local：ASR「无密钥时自动回落本地识别」开关，读取端
 *     asr-manager.js L370 用 `!== false` 判断，但全仓库零写入——开关永远
 *     无法关闭（写死默认开），亦无 UI。
 *
 * 分工：真实运行时（AsrManager 实例 + mock storage，驱动识别路径选择）
 *       + 接线断言（源码文本：UI 控件 / 监听器写入 / 消费端读取对齐）。
 *       不硬编码版本号。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${detail}`); }
};
const { AsrManager } = await import('../config/asr-manager.js');

// mock storage（对齐 PhoneStorage 的 get：键不存在返回 null，布尔原样返回）
function makeStorage(initial = {}) {
    const store = { ...initial };
    return { get: (k) => (k in store ? store[k] : null), set: async (k, v) => { store[k] = v; }, _raw: store };
}
// 装配：override 本地/云端路径，只观察「选了哪条路」
function mkAsr(initial = {}) {
    const s = makeStorage(initial);
    const m = new AsrManager(s);
    const calls = { local: 0, cloud: 0 };
    m.isLocalAsrSupported = () => true;
    m._recognizeLocal = async () => { calls.local++; return 'LOCAL'; };
    m.startRecording = async () => new Blob(['x'], { type: 'audio/webm' });
    m.transcribe = async () => { calls.cloud++; return 'CLOUD'; };
    return { m, calls, s };
}

// ========== 1. ASR 自动本地回落开关：真实运行时行为 ==========
{
    // 缺省（无该键）→ 自动回落本地（读取端 `!== false` 语义：默认开）
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai' });
    const text = await m.recognizeOnce();
    ok('缺省时无密钥自动回落本地识别', text === 'LOCAL' && calls.local === 1 && calls.cloud === 0, JSON.stringify(calls));
}
{
    // 显式 true → 回落本地
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai', 'phone-asr-auto-local': true });
    const text = await m.recognizeOnce();
    ok('开关为 true 时回落本地', text === 'LOCAL' && calls.local === 1, JSON.stringify(calls));
}
{
    // 布尔 false → 不回落本地，走云端路径（此前无法关闭）
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai', 'phone-asr-auto-local': false });
    const text = await m.recognizeOnce();
    ok('开关为 false 时不回落本地（缺陷修复核心）', text === 'CLOUD' && calls.local === 0 && calls.cloud === 1, JSON.stringify(calls));
}
{
    // 字符串 'false'（兼容旧写法/手工写入）→ 同样不回落
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai', 'phone-asr-auto-local': 'false' });
    const text = await m.recognizeOnce();
    ok("开关为字符串 'false' 时同样不回落本地", text === 'CLOUD' && calls.local === 0, JSON.stringify(calls));
}
{
    // provider 显式 local → 无视开关，必走本地
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'local', 'phone-asr-auto-local': false });
    const text = await m.recognizeOnce();
    ok('provider=local 时无视开关走本地', text === 'LOCAL' && calls.local === 1, JSON.stringify(calls));
}
{
    // 有 API Key → 开关默认开但不触发回落（回落条件含 !apiKey）
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai', 'phone-asr-openai-key': 'sk-x' });
    const text = await m.recognizeOnce();
    ok('有密钥时不回落本地（走云端）', text === 'CLOUD' && calls.local === 0, JSON.stringify(calls));
}
{
    // 有 relay → 同样不触发回落
    const { m, calls } = mkAsr({ 'phone-asr-provider': 'openai', 'phone-asr-openai-relay-url': 'https://r.dev/' });
    const text = await m.recognizeOnce();
    ok('有 Worker 中转时不回落本地', text === 'CLOUD' && calls.local === 0, JSON.stringify(calls));
}
{
    // storage 驱动：同一实例，仅改存储键即切换路径
    const { m, calls, s } = mkAsr({ 'phone-asr-provider': 'openai' });
    await m.recognizeOnce();
    const first = calls.local === 1 && calls.cloud === 0;
    s._raw['phone-asr-auto-local'] = false;
    await m.recognizeOnce();
    ok('切换存储键即切换识别路径（storage 驱动，非内存态）',
        first && calls.local === 1 && calls.cloud === 1, JSON.stringify(calls));
}

// ========== 2. 接线断言：三键「设置端 UI+写入」与「消费端读取」配对 ==========
{
    const settingsSrc = fs.readFileSync(path.join(root, 'apps/settings/settings-app.js'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    const chatViewSrc = fs.readFileSync(path.join(root, 'apps/wechat/chat-view.js'), 'utf8');
    const phoneViewSrc = fs.readFileSync(path.join(root, 'apps/phone/phone-view.js'), 'utf8');
    const asrSrc = fs.readFileSync(path.join(root, 'config/asr-manager.js'), 'utf8');

    const keys = ['phone-sms-limit', 'wechat-moments-context-limit', 'phone-asr-auto-local'];
    for (const k of keys) {
        ok(`[${k}] 设置页有 UI 控件`, settingsSrc.includes(`id="${k}"`), '缺少控件');
        ok(`[${k}] 设置页有写入监听器`, settingsSrc.includes(`set('${k}'`), '缺少写入');
    }

    // 消费端仍读取同名键（写读同名，杜绝键名错配）
    ok('phone-sms-limit 消费端：phone-view 读取', phoneViewSrc.includes("'phone-sms-limit'"));
    ok('phone-sms-limit 消费端：chat-view 读取', chatViewSrc.includes("'phone-sms-limit'"));
    ok('wechat-moments-context-limit 消费端：chat-view 读取', chatViewSrc.includes("'wechat-moments-context-limit'"));
    ok('wechat-moments-context-limit 消费端：index.js 读取', indexSrc.includes("'wechat-moments-context-limit'"));
    ok('phone-asr-auto-local 消费端：asr-manager 读取', asrSrc.includes("'phone-asr-auto-local'"));

    // 误导性描述已修正（不再声称控制短信）
    ok('通话APP记录条数描述不再谎称控制短信',
        settingsSrc.includes('控制每段电话通话注入酒馆正文的最近消息条数')
        && !/控制每段电话通话及每个短信会话/.test(settingsSrc));

    // 短信条数 UI 与控件范围
    ok('短信记录条数控件存在且带说明',
        /id="phone-sms-limit"[\s\S]{0,200}短信/.test(settingsSrc)
        || settingsSrc.includes('短信记录条数'));
}

// ========== 3. 接线断言：index.js 线下注入与线上消费端语义对齐 ==========
{
    const indexSrc = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

    ok('index.js 定义 smsLimit（读取 phone-sms-limit，默认 20）',
        /const smsLimitRaw = parseInt\(storage\?\.get\('phone-sms-limit'\)\)/.test(indexSrc)
        && /Number\.isFinite\(smsLimitRaw\) \? smsLimitRaw : 20/.test(indexSrc));
    ok('index.js 线下短信截断改用 smsLimit（不再误用通话 historyLimit）',
        indexSrc.includes('smsMessages.slice(-smsLimit)')
        && !indexSrc.includes('smsMessages.slice(-historyLimit)'));

    // 朋友圈 0 = 关闭语义（与线上 _readNonNegativeLimit(…,30,100) 的 limit<=0 return '' 对齐）
    ok('index.js 朋友圈 limit 允许 0（0=关闭）',
        /Math\.max\(0, Math\.min\(100, configuredLimit\)\)/.test(indexSrc));
    ok('index.js 朋友圈空集时不注入（避免只注入表头）',
        /recentMoments\.length > 0 \? lines\.join\('\\n'\)\.trim\(\) : ''/.test(indexSrc));
    ok('chat-view 朋友圈消费端保留 0=关闭语义',
        /_readNonNegativeLimit\('wechat-moments-context-limit', 30, 100\)/.test(
            fs.readFileSync(path.join(root, 'apps/wechat/chat-view.js'), 'utf8')));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exitCode = 1;