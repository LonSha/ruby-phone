/* ========================================================
 *  RubyPhone · 副模型通道的隔离面（A7）
 * ========================================================
 *
 * 【为什么有这个模块】
 *   手机内部的每一次「副模型」调用（日记 / 微博 / 微信 / 记忆抽取 / 判定…）
 *   都走 `ApiManager.callAI` → 酒馆原生 `generateRaw` 兜底。而 `generateRaw`
 *   在酒馆里是**公共入口**：它会让**所有已装载的扩展**的生成钩子跑起来
 *   （世界书注入、越狱/角色卡拼装、其它插件在 `GENERATE_BEFORE_COMBINE_PROMPTS`
 *   上的接线）。对本插件的副模型调用来说，这些钩子**没有一个是想要的**：
 *     · 世界书按关键词命中注入 ⇒ 副模型收到的是「当下这一轮的设定」，
 *       而它要做的是**抽取手机内部已发生的事实**，多注入会污染答案；
 *     · 角色卡 / 越狱 / 名字面同理 —— 副模型不该扮演角色，它只该做加工。
 *   后果不是崩溃，而是**读数的方向被改变**：抽取结果开始反映注入进去的设定，
 *   而这件事在读数面上看不出来（副模型照样返回一段工整的 JSON）。
 *
 *   本次改动前，这份隔离是**十个字面量写在 `api-manager.js` 的一个对象里**：
 *   它正确、但它**不可被点名**——没有任何一处能回答「副模型的隔离面是哪几项」，
 *   也没有任何一处能在有人删掉其中一行时响一声（删了照常发请求、照常拿到答案）。
 *
 * 【本模块的裁定口径（三态互不同形，方向不可互换）】
 *   · `isolated`（就绪）：静默面全开、上下文面全关、空载面为空；
 *   · `missing`（**没写**）：某一项根本不在参数里 —— 处置是「不知道会不会触发」，
 *     故它既不算通过、也不算越界，单独一格；
 *   · `leaky`（**写了但方向错**）：`quiet: false`（会写楼层、触发保存钩子）、
 *     `include_world_info: true`（把世界书注入进副模型）之流 —— 这是**明确会触发**，
 *     与 `missing` 的「未声明」不是同一件事。
 *   把 `missing` 并进 `leaky`，诊断页会答不出「是漏写了、还是写反了」；
 *   把 `leaky` 并进 `missing`，则「写反了」会被当成「还没写」而永远等不到人修。
 *
 * 【与上游的关系（方向不可互换）】
 *   本模块不读桥、不碰宿主、不做 IO：纯函数进纯函数出。
 *   调用方（`api-manager.js`）拿 `buildSubmodelParams` 造参数、拿
 *   `judgeSubmodelIsolation` 自检并在异常时留一行可读读数。
 * ============================================================ */

import { numOrNull } from './num-gate.js';

/** 副模型隔离三态。 */
export const SUBMODEL_ISOLATION_STATES = Object.freeze({
    ISOLATED: 'isolated',
    MISSING: 'missing',
    LEAKY: 'leaky'
});

/** 静默面：必须为 `true` —— 不打 UI 卡、不写楼层、不触发保存/回写钩子。 */
export const SUBMODEL_SILENCE_FLAGS = Object.freeze(['quiet', 'skip_save']);

/** 上下文面：必须为 `false` —— 不注入世界书 / 越狱 / 角色卡 / 名字。 */
export const SUBMODEL_CONTEXT_FLAGS = Object.freeze([
    'include_world_info', 'include_jailbreak', 'include_character_card', 'include_names'
]);

/** 空载面：必须是空数组 —— 不附图片、无停机串（停机串会被宿主当成「用户自定义」）。 */
export const SUBMODEL_EMPTY_KEYS = Object.freeze(['images', 'stop', 'stop_sequence']);

/** 必须为 `false` 的杂项开关：`dryRun` 开着就没有真生成，属「另一个方向」的错。 */
export const SUBMODEL_FALSE_FLAGS = Object.freeze(['dryRun']);

/**
 * 造一份副模型参数：隔离面由本模块**唯一**持有，调用方不再手写字面量。
 *
 * @param {{prompt?:Array, maxTokens?:number, useStream?:boolean}} input
 * @returns {object} 直接可交给宿主的参数对象
 */
export function buildSubmodelParams(input = {}) {
    const params = {
        prompt: Array.isArray(input.prompt) ? input.prompt : [],
        images: [],
        quiet: true,
        dryRun: false,
        skip_save: true,
        stream: input.useStream !== false,
        include_world_info: false,
        include_jailbreak: false,
        include_character_card: false,
        include_names: false,
        stop: [],
        stop_sequence: []
    };
    /* 上限两个键同源：宿主各版本读的不一定是同一个（`max_tokens` / `length`），
     *  两个都给才不至于在某些版本上「没限长」—— 没限长的副模型会写到截断为止。 */
    const maxTokens = numOrNull(input.maxTokens);
    if (maxTokens !== null && maxTokens > 0) {
        params.max_tokens = maxTokens;
        params.length = maxTokens;
    }
    return params;
}

/**
 * 判定一份副模型参数的隔离面。
 *
 * @param {object} params 待判参数（任意对象；非对象视为「全缺席」）
 * @returns {{state:string, missing:Array<string>, leaky:Array<string>, note:string}}
 */
export function judgeSubmodelIsolation(params) {
    const present = params && typeof params === 'object';
    const missing = [];
    const leaky = [];
    for (const key of SUBMODEL_SILENCE_FLAGS) {
        if (!present || !(key in params)) { missing.push(key); continue; }
        if (params[key] !== true) leaky.push(key + '=' + String(params[key]));
    }
    for (const key of SUBMODEL_CONTEXT_FLAGS) {
        if (!present || !(key in params)) { missing.push(key); continue; }
        if (params[key] !== false) leaky.push(key + '=' + String(params[key]));
    }
    for (const key of SUBMODEL_FALSE_FLAGS) {
        if (!present || !(key in params)) { missing.push(key); continue; }
        if (params[key] !== false) leaky.push(key + '=' + String(params[key]));
    }
    for (const key of SUBMODEL_EMPTY_KEYS) {
        if (!present || !(key in params)) { missing.push(key); continue; }
        if (!Array.isArray(params[key]) || params[key].length > 0) {
            leaky.push(key + ' 非空');
        }
    }
    /* 三态：越界优先报（方向明确的那一面先说话），两组都空才是就绪。 */
    let state = SUBMODEL_ISOLATION_STATES.ISOLATED;
    if (leaky.length) state = SUBMODEL_ISOLATION_STATES.LEAKY;
    else if (missing.length) state = SUBMODEL_ISOLATION_STATES.MISSING;
    const note = state === SUBMODEL_ISOLATION_STATES.ISOLATED
        ? ''
        : (state === SUBMODEL_ISOLATION_STATES.LEAKY
            ? '隔离面被写反：宿主会注入上下文或触发保存钩子'
            : '隔离面缺项未声明：宿主可能按默认行为触发世界书/角色卡钩子');
    return { state: state, missing: missing, leaky: leaky, note: note };
}

/** 一行读数（诊断页 / 控制台）。三态各占一格，不得压成「参数已就绪」。 */
export function isolationLine(result) {
    if (!result || typeof result !== 'object') return '副模型隔离：无读数';
    if (result.state === SUBMODEL_ISOLATION_STATES.ISOLATED) {
        return '副模型隔离：就绪（静默 ' + SUBMODEL_SILENCE_FLAGS.length
            + ' · 上下文 ' + SUBMODEL_CONTEXT_FLAGS.length
            + ' · 空载 ' + SUBMODEL_EMPTY_KEYS.length + '）';
    }
    if (result.state === SUBMODEL_ISOLATION_STATES.LEAKY) {
        return '副模型隔离：越界 ' + result.leaky.length + ' 项（' + result.leaky.join(' · ') + '）—— ' + result.note;
    }
    return '副模型隔离：缺席 ' + result.missing.length + ' 项（' + result.missing.join(' · ') + '）—— ' + result.note;
}

export default {
    SUBMODEL_ISOLATION_STATES, SUBMODEL_SILENCE_FLAGS, SUBMODEL_CONTEXT_FLAGS,
    SUBMODEL_EMPTY_KEYS, SUBMODEL_FALSE_FLAGS,
    buildSubmodelParams, judgeSubmodelIsolation, isolationLine
};