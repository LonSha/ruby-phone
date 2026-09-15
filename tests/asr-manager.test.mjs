// RubyPhone ASR 语音输入管理器测试 [v2.13.0]
// 无浏览器环境：用 mock storage / mock fetch / mock Web Speech 验证核心逻辑
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

// ---------- mock storage（对齐 PhoneStorage 的 get/set） ----------
function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    get: (k) => (k in store ? store[k] : null),
    set: async (k, v) => { store[k] = v; },
    _raw: store,
  };
}

// ---------- 1. 模块存在与导出 ----------
ok('asr-manager.js 存在且导出 AsrManager', typeof AsrManager === 'function');
ok('AsrManager 有 transcribe 方法', typeof AsrManager.prototype.transcribe === 'function');
ok('AsrManager 有 recognizeOnce 方法', typeof AsrManager.prototype.recognizeOnce === 'function');
ok('AsrManager 有 startRecording 方法', typeof AsrManager.prototype.startRecording === 'function');

// ---------- 2. provider 默认值 ----------
{
  const m = new AsrManager(makeStorage());
  const d = m._getProviderDefaults('openai');
  ok('openai 默认 url 正确', String(d.url).includes('/audio/transcriptions'), d.url);
  ok('openai 默认 model 非空', !!d.model, d.model);
  ok('未知 provider 回落 openai', m._getProviderDefaults('unknown_xxx').url === d.url);
  ok('local provider url 为空（本地无需接口）', m._getProviderDefaults('local').url === '');
}

// ---------- 3. storage key 命名规范（与 TTS 同构） ----------
{
  const m = new AsrManager(makeStorage());
  ok('scoped key 格式 phone-asr-<provider>-<field>',
    m._getProviderConfigKey('openai', 'key') === 'phone-asr-openai-key');
}

// ---------- 4. 配置解析与 legacy 兜底 ----------
{
  const s = makeStorage({
    'phone-asr-provider': 'openai',
    'phone-asr-key': 'sk-legacy',
    'phone-asr-openai-key': 'sk-scoped',
  });
  const m = new AsrManager(s);
  const cfg = m._resolveConfig();
  ok('provider 从 phone-asr-provider 读取', cfg.provider === 'openai');
  ok('scoped key 优先于 legacy key', cfg.apiKey === 'sk-scoped', cfg.apiKey);
}
{
  // 无 scoped 时回落 legacy
  const s = makeStorage({ 'phone-asr-key': 'sk-legacy' });
  const m = new AsrManager(s);
  const cfg = m._resolveConfig();
  ok('无 scoped 时回落 legacy key', cfg.apiKey === 'sk-legacy', cfg.apiKey);
}
{
  // local provider 不要求 key/url
  const s = makeStorage({ 'phone-asr-provider': 'local' });
  const m = new AsrManager(s);
  const cfg = m._resolveConfig();
  ok('local provider 的 apiUrl 为空', cfg.apiUrl === '', cfg.apiUrl);
}

// ---------- 5. URL → provider 推断 ----------
{
  const m = new AsrManager(makeStorage());
  ok('minimaxi.com → minimax_cn', m._inferProviderFromUrl('https://api.minimaxi.com/v1/audio/translations') === 'minimax_cn');
  ok('openspeech → volcengine', m._inferProviderFromUrl('https://openspeech.bytedance.com/api/v3/sauc/bigmodel') === 'volcengine');
  ok('openai.com → openai', m._inferProviderFromUrl('https://api.openai.com/v1/audio/transcriptions') === 'openai');
  ok('空 url 回落 fallback', m._inferProviderFromUrl('', 'minimax_cn') === 'minimax_cn');
}

// ---------- 6. 响应文本提取（多后端格式） ----------
{
  const m = new AsrManager(makeStorage());
  ok('OpenAI 格式 {text}', m._extractText({ text: '你好' }) === '你好');
  ok('transcript 字段', m._extractText({ transcript: '你好' }) === '你好');
  ok('segments 数组拼接', m._extractText({ segments: [{ text: '你好 ' }, { text: '世界' }] }) === '你好 世界');
  ok('MiniMax translations 数组', m._extractText({ translations: [{ text: '你好' }, { text: '世界' }] }) === '你好 世界');
  ok('字符串透传', m._extractText('你好') === '你好');
  ok('空 payload 返回空串', m._extractText(null) === '');
  ok('嵌套 data 递归', m._extractText({ data: { text: '嵌套' } }) === '嵌套');
}

// ---------- 7. transcribe：本地模式 ----------
{
  const m = new AsrManager(makeStorage({ 'phone-asr-provider': 'local' }));
  let called = null;
  m._recognizeLocal = async (opts) => { called = opts; return '本地识别结果'; };
  const text = await m.transcribe(null, {});
  ok('local 模式 transcribe 不要求音频 blob', text === '本地识别结果', text);
  ok('local 模式传入 language', called && called.language === 'zh-CN');
}

// ---------- 8. transcribe：云端直连（mock fetch） ----------
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: '云端识别结果' }),
    };
  };
  globalThis.fetch = fakeFetch;
  const s = makeStorage({
    'phone-asr-provider': 'openai',
    'phone-asr-openai-key': 'sk-test',
  });
  const m = new AsrManager(s);
  const blob = new Blob(['fake-audio'], { type: 'audio/webm' });
  const text = await m.transcribe(blob, {});
  ok('云端直连返回识别文本', text === '云端识别结果', text);
  ok('请求发往配置的 url', String(calls[0].url).includes('/audio/transcriptions'), calls[0].url);
  ok('携带 Authorization Bearer', String(calls[0].init?.headers?.Authorization || '').startsWith('Bearer sk-test'));
  ok('multipart 表单含 model', calls[0].init?.body instanceof FormData);
  globalThis.fetch = undefined;
}

// ---------- 9. transcribe：relay 中转 ----------
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, result: { text: '中转识别结果' } }),
    };
  };
  globalThis.fetch = fakeFetch;
  const s = makeStorage({
    'phone-asr-provider': 'openai',
    'phone-asr-openai-key': 'sk-test',
    'phone-asr-openai-relay-url': 'https://relay.workers.dev/',
  });
  const m = new AsrManager(s);
  const blob = new Blob(['fake-audio'], { type: 'audio/webm' });
  const text = await m.transcribe(blob, {});
  ok('relay 中转返回识别文本', text === '中转识别结果', text);
  ok('请求发往 relay /api/asr', String(calls[0].url) === 'https://relay.workers.dev/api/asr', calls[0].url);
  ok('中转用 JSON body（非 FormData）', !(calls[0].init?.body instanceof FormData));
  ok('中转 body 含 audioBase64', String(calls[0].init?.body || '').includes('audioBase64'));
  globalThis.fetch = undefined;
}

// ---------- 10. transcribe：错误降级 ----------
{
  globalThis.fetch = async () => ({
    ok: false, status: 401,
    text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
  });
  const s = makeStorage({ 'phone-asr-provider': 'openai', 'phone-asr-openai-key': 'bad' });
  const m = new AsrManager(s);
  const blob = new Blob(['x'], { type: 'audio/webm' });
  let err = null;
  try { await m.transcribe(blob, {}); } catch (e) { err = e; }
  ok('HTTP 401 抛错含状态码与后端信息', /401/.test(err?.message) && /Invalid API key/.test(err?.message), err?.message);
  globalThis.fetch = undefined;
}
{
  // 缺 key 且无 relay
  const s = makeStorage({ 'phone-asr-provider': 'openai' });
  const m = new AsrManager(s);
  let err = null;
  try { await m.transcribe(new Blob(['x']), {}); } catch (e) { err = e; }
  ok('缺 API Key 且无中转时报错', /API Key|中转/.test(err?.message), err?.message);
}
{
  // 超大文件
  const s = makeStorage({ 'phone-asr-provider': 'openai', 'phone-asr-openai-key': 'k' });
  const m = new AsrManager(s);
  const big = new Blob([new Uint8Array(26 * 1024 * 1024)]);
  let err = null;
  try { await m.transcribe(big, {}); } catch (e) { err = e; }
  ok('超过 25MB 拒绝', /25MB/.test(err?.message), err?.message);
}

// ---------- 11. recognizeOnce：自动选本地 ----------
{
  const s = makeStorage({ 'phone-asr-provider': 'openai' }); // 云端 provider 但无 key
  const m = new AsrManager(s);
  m.isLocalAsrSupported = () => true;
  let localCalled = false;
  m._recognizeLocal = async () => { localCalled = true; return '自动本地'; };
  const text = await m.recognizeOnce();
  ok('无 key 时 recognizeOnce 自动降级本地', localCalled && text === '自动本地', text);
}
{
  const s = makeStorage({ 'phone-asr-provider': 'openai', 'phone-asr-openai-key': 'sk-x' });
  const m = new AsrManager(s);
  m.isLocalAsrSupported = () => true;
  let localCalled = false, recCalled = false;
  m._recognizeLocal = async () => { localCalled = true; return ''; };
  m.startRecording = async () => { recCalled = true; return new Blob(['x']); };
  m.transcribe = async () => '云端结果';
  const text = await m.recognizeOnce();
  ok('有 key 时优先走云端录音链路', !localCalled && recCalled && text === '云端结果', text);
}

// ---------- 12. 网络错误文案 ----------
{
  const m = new AsrManager(makeStorage());
  ok('Failed to fetch 转友好提示', /CORS|中转/.test(m._formatNetworkError(new Error('Failed to fetch'))));
  ok('AbortError 转取消提示', /取消/.test(m._formatNetworkError(new Error('AbortError'))));
}

// ---------- 13. 接线审计：index.js 已装配 ----------
{
  const idx = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  ok('index.js 导入 asr-manager.js', /asr-manager\.js/.test(idx));
  ok('index.js 绑定 AsrManager 类', /AsrManager\s*=\s*asrManagerModule\.AsrManager/.test(idx));
  ok('index.js 实例化 asrManager', /new AsrManager\(storage\)/.test(idx));
  ok('index.js 导出 asrManager 到 VirtualPhone', /asrManager:\s*asrManager/.test(idx));
}
{
  // settings UI 与微信入口接线
  const settings = fs.readFileSync(path.join(root, 'apps/settings/settings-app.js'), 'utf8');
  ok('settings-app 含 ASR provider 下拉', /id="phone-asr-provider"/.test(settings));
  ok('settings-app 含 ASR 测试按钮', /id="phone-asr-test"/.test(settings));
  ok('settings-app 绑定 ASR 事件', /phone-asr-test/.test(settings) && /setAsrProviderField/.test(settings));
  const chat = fs.readFileSync(path.join(root, 'apps/wechat/chat-view.js'), 'utf8');
  ok('chat-view 含语音输入按钮', /id="voice-input-btn"/.test(chat));
  ok('chat-view 绑定语音输入事件', /runVoiceInput/.test(chat));
}

console.log(`\n[asr-manager] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);