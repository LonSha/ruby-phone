/**
 * tests/system-v271.test.mjs — v2.71.0 工具调用中的最终回复正文提取
 *
 * 覆盖：
 *   1. 三种协议形态抽取（OpenAI tool_calls / function_call / Gemini functionCall）
 *   2. 流式分片 vs 完整态的 arguments 累积语义
 *   3. 最终回复约定的工具名识别
 *   4. 端到端 content 兜底（Map 与对象两种入口）
 *   5. ApiManager 四处接线自证
 *   6. 版权纯度与依赖零外链
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const {
  isFinalResponseToolName,
  extractToolCallFragments,
  mergeToolCallFragments,
  extractFinalResponseToolContent,
} = await import('../config/tool-call-content.js');

let pass = 0;
const ok = (name, cond, extra) => {
  assert.ok(cond, extra ? name + ' — ' + extra : name);
  pass += 1;
};

// ========== 1. 工具名识别 ==========
{
  ok('emit_complete_response 命中', isFinalResponseToolName('emit_complete_response'));
  ok('带后缀命中', isFinalResponseToolName('emit_complete_response_v2'));
  ok('大小写不敏感', isFinalResponseToolName('Emit_Complete_Response'));
  ok('其他工具不命中', !isFinalResponseToolName('search_web'));
  ok('空前缀不误命中', !isFinalResponseToolName('emit_complete'));
  ok('空名不命中', !isFinalResponseToolName(''));
  ok('null 不抛', !isFinalResponseToolName(null));
}

// ========== 2. 三种协议形态 ==========
{
  // OpenAI 流式分片
  const s1 = extractToolCallFragments({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'emit_complete_response', arguments: '{"content":' } }] } }],
  });
  ok('OpenAI 流式分片抽取', s1.length === 1 && s1[0].name === 'emit_complete_response' && s1[0].complete === false);

  // OpenAI 完整响应
  const s2 = extractToolCallFragments({
    choices: [{ message: { tool_calls: [{ index: 0, function: { name: 'emit_complete_response', arguments: '{"content":"你好"}' } }] } }],
  });
  ok('OpenAI 完整态抽取', s2.length === 1 && s2[0].complete === true);

  // OpenAI 旧版 function_call
  const s3 = extractToolCallFragments({
    choices: [{ message: { function_call: { name: 'emit_complete_response', arguments: '{"content":"旧版"}' } } }],
  });
  ok('OpenAI function_call 抽取', s3.length === 1 && s3[0].name === 'emit_complete_response');

  // Gemini
  const s4 = extractToolCallFragments({
    candidates: [{ content: { parts: [{ functionCall: { name: 'emit_complete_response', args: { content: ' Gemini ' } } }] } }],
  });
  ok('Gemini functionCall 抽取', s4.length === 1 && s4[0].complete === true);
  ok('Gemini args 对象被序列化', s4[0].arguments.includes('content'));

  // payload.data 包裹
  const s5 = extractToolCallFragments({
    data: { choices: [{ message: { tool_calls: [{ function: { name: 'emit_complete_response', arguments: '{"content":"包裹"}' } }] } }] },
  });
  ok('payload.data 包裹抽取', s5.length === 1);

  // 空输入不抛
  ok('null 输入', extractToolCallFragments(null).length === 0);
  ok('无工具调用', extractToolCallFragments({ choices: [{ delta: { content: 'hi' } }] }).length === 0);
  ok('keep-alive 空片跳过', extractToolCallFragments({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] }).length === 0);
}

// ========== 3. arguments 累积语义 ==========
{
  const state = new Map();
  mergeToolCallFragments(state, [
    { index: 0, name: 'emit_complete_response', arguments: '{"content":', complete: false },
  ]);
  mergeToolCallFragments(state, [
    { index: 0, name: '', arguments: '"今天天气不错"}', complete: false },
  ]);
  ok('流式 arguments 增量拼接', state.get(0).arguments === '{"content":"今天天气不错"}');
  ok('name 在后续空名分片保留', state.get(0).name === 'emit_complete_response');

  // 完整态覆写
  const state2 = new Map();
  mergeToolCallFragments(state2, [
    { index: 0, name: 'emit_complete_response', arguments: '{"content":', complete: false },
  ]);
  mergeToolCallFragments(state2, [
    { index: 0, name: 'emit_complete_response', arguments: '{"content":"完整值"}', complete: true },
  ]);
  ok('完整态 arguments 覆写不拼接', state2.get(0).arguments === '{"content":"完整值"}');

  ok('非 Map 不抛', mergeToolCallFragments(null, []) === null);
  ok('空片段列表不抛', mergeToolCallFragments(new Map(), null).size === 0);
}

// ========== 4. 端到端兜底 ==========
{
  // 流式跨分片
  const state = new Map();
  mergeToolCallFragments(state, extractToolCallFragments({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'emit_complete_response', arguments: '{"content":"第' } }] } }],
  }));
  mergeToolCallFragments(state, extractToolCallFragments({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '一段回复"}' } }] } }],
  }));
  ok('流式端到端取正文', extractFinalResponseToolContent(state) === '第一段回复');

  // 对象直传
  ok('对象入口取正文', extractFinalResponseToolContent({
    choices: [{ message: { tool_calls: [{ function: { name: 'emit_complete_response', arguments: '{"content":"对象入口"}' } }] } }],
  }) === '对象入口');

  // content 为数组
  ok('数组 content 拼接', extractFinalResponseToolContent({
    choices: [{ message: { tool_calls: [{ function: { name: 'emit_complete_response', arguments: '{"content":[{"text":"A"},{"text":"B"}]}' } }] } }],
  }) === 'AB');

  // 无最终回复约定
  ok('非约定工具返回空', extractFinalResponseToolContent({
    choices: [{ message: { tool_calls: [{ function: { name: 'search', arguments: '{"q":"x"}' } }] } }],
  }) === '');

  // JSON 未完整
  ok('不完整 JSON 返回空不抛', extractFinalResponseToolContent(new Map([[0, { name: 'emit_complete_response', arguments: '{"content":' }]])) === '');

  // 多调用按 index 升序
  const multi = new Map();
  mergeToolCallFragments(multi, extractToolCallFragments({
    choices: [{ message: { tool_calls: [
      { index: 1, function: { name: 'emit_complete_response', arguments: '{"content":"第二个"}' } },
      { index: 0, function: { name: 'other', arguments: '{}' } },
    ] } }],
  }));
  ok('按 index 升序扫描', extractFinalResponseToolContent(multi) === '第二个');

  ok('null 入口不抛', extractFinalResponseToolContent(null) === '');
}

// ========== 5. 接线自证 ==========
{
  const src = read('config/api-manager.js');
  ok('导入工具调用模块', src.includes("from './tool-call-content.js'"));
  ok('_extractStreamContent 返回 toolCalls', /return \{ content, reasoning, finishReason, error: null, toolCalls \}/.test(src));
  ok('_parseApiResponse 流式分支接线', src.includes('mergeToolCallFragments(toolCallState, toolCalls);'));
  ok('_parseApiResponse 非流式兜底', src.includes('extractFinalResponseToolContent(data) ||'));
  ok('_parseChunkedApiText 接线', src.includes('extractFinalResponseToolContent(toolCallState) ||'));
  ok('_readUniversalStream 累积接线', /mergeToolCallFragments\(toolCallState, toolCalls\);/.test(src));
  ok('回写调用点共 4 处', (src.match(/extractFinalResponseToolContent\(/g) || []).length >= 4);

  const mod = read('config/tool-call-content.js');
  ok('模块无外部引擎水印', !/AUTHOR_ZERO_WIDTH_WATERMARK|AUTHOR_INTEGRITY_EXPECTED_SHA256/.test(mod));
  ok('模块零网络请求', !/fetch\s*\(|XMLHttpRequest/.test(mod));
  ok('模块零 npm 依赖', !/require\(|from '[^.]/.test(mod));
}

// ========== 6. 版本同源 ==========
{
  // 从 manifest 读版本而非硬编码：本仓每个版本都会新增测试，硬编码会让
  // 下一轮改版本时旧测试集体假红（那是测试自己的债，不是工程的债）。
  const mf = JSON.parse(read('manifest.json'));
  const v = mf.version;
  ok('manifest 版本形如 x.y.z', /^\d+\.\d+\.\d+$/.test(v), v);
  ok('入口同源', read('index.js').includes(`const ST_PHONE_VERSION = '${v}'`), v);
  const log = JSON.parse(read('update-log.json'));
  ok('update-log 指向同版本', log.latest === v && !!(log.versions || {})[v], v);
  ok('package.json 同源', JSON.parse(read('package.json')).version === v);
  ok('update-log 首键为当前版本', Object.keys(log.versions)[0] === v);
}

console.log('\n' + pass + ' 通过');
