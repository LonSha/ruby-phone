/**
 * tool-call-content.js — [v2.71.0] 工具调用中的最终回复正文提取
 *
 * 【为什么需要这一层 / 修前实测后果】
 *   RubyPhone 的 ApiManager 此前只认 `choices[0].delta.content` 一族字段。当上游按
 *   OpenAI function calling / Gemini functionCall 协议把「最终回复」装进工具调用里
 *   （本仓常见的 `emit_complete_response` 约定）时，标准 content 通道是**空的**。
 *   实测后果：配了工具调用预设的用户，微信/蜜语/微博等所有走 apiManager.callAI 的
 *   App 拿到空文本，报「API 返回内容为空」——不是崩溃，而是**静默错数据**，
 *   正是本仓最贵的缺陷形态。
 *
 * 【设计来源】
 *   参考 yuzuki-phone 1.5.6（config/api-manager.js，提交 45f37e5）的工具调用兼容实现，
 *   按 RubyPhone 工程规范重写为**零依赖纯函数模块**：剥离其对 ApiManager 实例方法的
 *   依赖（`this._extractStreamContent` 等），使判定逻辑可在无 SillyTavern 环境下单测。
 *
 * 【职责边界（只做三件事）】
 *   ① 从单个分片/响应里抽取工具调用**片段**（三种协议形态 + 流式分片与完整态两种完成度）；
 *   ② 把跨分片片段按 index 合并为完整调用（流式 arguments 增量累积，完整态覆写）；
 *   ③ 从合并后的调用里取出「最终回复」正文（识别 emit_complete_response 约定名）。
 *
 * 【刻意不做】
 *   - 不执行任何工具调用（本仓没有工具调用需求，只要正文）；
 *   - 不改变既有 content 通道的优先级：正文通道非空时**永远不**走工具调用兜底，
 *     避免上游同时给两种通道时行为漂移；
 *   - 不做工具名白名单配置化（约定名写死，减少一个会漂移的设置项）。
 */

/** 最终回复约定的工具名：emit_complete_response / emit_complete_response_v2 等。 */
const FINAL_RESPONSE_TOOL_RE = /^emit_complete_response(?:[_\s-]|$)/i;

// 模块内部使用，不对外导出（死导出门禁：导出必须产品端真消费）
const FINAL_RESPONSE_RE = FINAL_RESPONSE_TOOL_RE;

/**
 * 判断工具名是否为「最终回复」约定。
 * 空名不匹配（空名意味着这一片还没到 name 字段，继续等后续分片）。
 */
export function isFinalResponseToolName(name) {
  const value = String(name || '').trim();
  if (!value) return false;
  return FINAL_RESPONSE_TOOL_RE.test(value);
}

function pickFunctionObject(call) {
  if (!call || typeof call !== 'object') return null;
  if (call.function && typeof call.function === 'object') return call.function;
  if (call.functionCall && typeof call.functionCall === 'object') return call.functionCall;
  return call;
}

function stringifyArguments(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 从单个分片或完整响应中抽取工具调用片段。
 *
 * 覆盖三种协议形态：
 *   - OpenAI：choices[0].delta.tool_calls（流式分片）/ choices[0].message.tool_calls（完整）
 *   - OpenAI 旧版：choices[0].delta.function_call / message.function_call
 *   - Gemini：candidates[0].content.parts[].functionCall
 * 以及两种外层包裹：payload 自身 / payload.data
 *
 * @returns {Array<{index:number, name:string, arguments:string, complete:boolean}>}
 */
export function extractToolCallFragments(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const fragments = [];
  const append = (calls, complete) => {
    if (!Array.isArray(calls)) return;
    calls.forEach((call, position) => {
      if (!call || typeof call !== 'object') return;
      const fn = pickFunctionObject(call);
      const argsValue = fn?.arguments ?? fn?.args ?? call.arguments ?? call.args;
      const name = String(fn?.name || call.name || '').trim();
      // name 与 arguments 都空 = 这一片没有任何信息（可能是 keep-alive 片），跳过。
      if (!name && argsValue === undefined) return;
      fragments.push({
        index: Number.isInteger(call.index) ? call.index : position,
        name,
        arguments: stringifyArguments(argsValue),
        complete: complete === true,
      });
    });
  };

  const choice = payload.choices?.[0] || payload.data?.choices?.[0];
  append(choice?.delta?.tool_calls, false);
  append(choice?.message?.tool_calls, true);
  if (choice?.delta?.function_call) append([choice.delta.function_call], false);
  if (choice?.message?.function_call) append([choice.message.function_call], true);

  const candidateParts = Array.isArray(payload.candidates?.[0]?.content?.parts)
    ? payload.candidates[0].content.parts
    : [];
  const geminiCalls = candidateParts.filter((part) => part?.functionCall);
  if (geminiCalls.length) append(geminiCalls.map((part) => part.functionCall), true);

  return fragments;
}

/**
 * 把片段合并进状态表（Map<index, {name, arguments}>）。
 * 流式片段：arguments 增量累积。完整态片段：覆写（服务端重发视为权威值）。
 * 就地修改传入的 Map，同时返回它（便于链式与测试断言）。
 */
export function mergeToolCallFragments(state, fragments = []) {
  if (!(state instanceof Map)) return state;
  const list = Array.isArray(fragments) ? fragments : [];
  list.forEach((fragment, position) => {
    if (!fragment || typeof fragment !== 'object') return;
    const index = Number.isInteger(fragment.index) ? fragment.index : position;
    const current = state.get(index) || { name: '', arguments: '' };
    const nextArgs = String(fragment?.arguments || '');
    current.name = fragment?.name || current.name;
    if (fragment.complete === true) {
      // 完整态：arguments 是这一片的全量，直接覆写而非拼接。
      if (nextArgs) current.arguments = nextArgs;
    } else if (nextArgs) {
      current.arguments += nextArgs;
    }
    state.set(index, current);
  });
  return state;
}

function normalizeToolContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const joined = content
    .map((part) => (typeof part === 'string' ? part : String(part?.text || part?.content || '')))
    .join('')
    .trim();
  return joined;
}

/**
 * 从「合并后的调用表」或「单个响应对象」中取出最终回复正文。
 *
 * 传 Map 时按 index 升序扫描；传对象时先抽取再扫描。
 * 找不到最终回复约定、或参数 JSON 尚未完整时返回空串（由调用方走既有兜底链）。
 *
 * @param {Map|object} source
 * @returns {string}
 */
export function extractFinalResponseToolContent(source) {
  const state = source instanceof Map
    ? source
    : mergeToolCallFragments(new Map(), extractToolCallFragments(source));

  const ordered = [...state.entries()].sort((left, right) => left[0] - right[0]);
  for (const [, call] of ordered) {
    if (!isFinalResponseToolName(call?.name)) continue;
    const rawArgs = String(call?.arguments || '').trim();
    // 流式参数尚未拼完整时 JSON.parse 会失败——此时不抛，继续等后续分片。
    if (!rawArgs) continue;
    let parsed;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      continue;
    }
    const content = normalizeToolContent(parsed?.content);
    if (content) return content;
  }
  return '';
}
