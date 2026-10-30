import { TheaterData } from './theater-data.js';
import { TheaterView } from './theater-view.js';
/* ========================================================
 * [v4.96.0 · R11-O3 第二批] 规则剧场（config/rule-theatre.js）接到本 App。
 * --------------------------------------------------------
 * 为什么接这里（而不是新开一个 App）：本 App 本来就是「用声明式条件编排一段小剧场」的面 ——
 *   主题 + 风格 + 字数 + 世界书随机结果 → 拼提示词 → 保存。规则剧场是同一件事的**条件化**形态：
 *   「什么事件发生时、把哪一段当作要演的东西递上来」。放在别处会变成第二个「小剧场」入口。
 * ★ 语义边界（照实写）：rule-theatre 的规则**不改本 App 的生成流**。它产出的是
 *   「触发了哪些白名单动作」的纯数据（propose_notification / create_memo / flag_calendar /
 *   suggest_dialogue / tag_relation），本 App 只把它们显示成「本次触发的建议」，
 *   **不代发通知、不代写日历** —— 那些动作的 owner 各有其人（通知中心 / 日历 / 备忘），
 *   在这里替它们写就是第二份 owner 口径。
 * ★ 零脚本：`registerRule` 只收声明式白名单（触发器 / 运算符 / 动作三张表），
 *   本 App 也不提供任何自定义代码入口 —— 「小剧场里能跑的东西是有限的」这条不收窄。
 * ======================================================== */
import {
  RULE_TRIGGERS, RULE_OPERATORS, RULE_ACTIONS, RT_MAX_RULES,
  validateRuleSpec, normalizeRuleState, registerRule, evaluateEvent
} from '../../config/rule-theatre.js';

/** 规则台账的键（随会话隔离：模式 /^rt_/ 已在 config/storage.js 收录，keys-audit 已登记）。 */
export const RT_KEY = 'rt_rules_state_v1';

export class TheaterApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new TheaterData(storage);
    this.view = new TheaterView(this);
    /* 规则面的**实例态**：待填的规则草稿、上一次评估读数、提示行（换会话必须丢）。 */
    this._ruleDraft = TheaterApp.emptyRuleDraft();
    this._ruleFlash = '';
    this._ruleFlashBad = false;
    this._lastFired = null;
  }

  /** 新规则的初始草稿：默认触发器取白名单第一项，动作默认最保守的「建议一句台词」。 */
  static emptyRuleDraft() {
    return {
      id: '', name: '',
      trigger: RULE_TRIGGERS.MESSAGE_RECEIVED,
      field: 'mood', operator: RULE_OPERATORS.EQUALS, value: '',
      actionType: RULE_ACTIONS.SUGGEST_DIALOGUE,
    };
  }

  /** 换会话/清数据时重绑数据层：TheaterData 构造期把当前会话剧本/草稿载入
   *  实例内存，实例为懒加载单例（index.js `if (!window.VirtualPhone.theaterApp)`），
   *  换会话后复用会把旧会话剧本渲染/写回新会话。保留实例，仅重建数据层。
   *  [v4.96.0] 规则面的实例态同样要丢：上一个会话的「本次触发」不能贴到新会话的规则面板上。 */
  onChatChanged() {
    this.data = new TheaterData(this.storage);
    this._ruleDraft = TheaterApp.emptyRuleDraft();
    this._ruleFlash = '';
    this._ruleFlashBad = false;
    this._lastFired = null;
  }

  /* ---------- [v4.96.0] 规则面：读 / 存 / 评（判定全在内核，本件只做读写与提示行） ---------- */
  /** 读规则台账：**读不出与空台账分两句**（前者是「读不到」，后者才是「还没编过规则」）。 */
  readRuleState() {
    if (!this.storage || typeof this.storage.get !== 'function') {
      return { readable: false, why: 'no_storage', state: normalizeRuleState(null) };
    }
    let raw;
    try { raw = this.storage.get(RT_KEY); }
    catch (_e) { return { readable: false, why: 'read_threw', state: normalizeRuleState(null) }; }
    if (raw === undefined || raw === null || raw === '') return { readable: true, why: '', state: normalizeRuleState(null) };
    let parsed = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch (_e) { return { readable: false, why: 'bad_json', state: normalizeRuleState(null) }; }
    }
    return { readable: true, why: '', state: normalizeRuleState(parsed) };
  }

  _writeRuleState(state) {
    if (!this.storage || typeof this.storage.set !== 'function') return { saved: false, why: 'no_api' };
    try {
      const out = this.storage.set(RT_KEY, state);
      /* 本仓 storage.set 可能是 async（返回 Promise）：把 Promise 当布尔读是恒假的老坑，
       *   这里只判「调用有没有抛」+「明确返回 false」，不用 === true。 */
      if (out && typeof out.then === 'function') { out.catch(function () { /* 由 storage 侧报告 */ }); return { saved: true, why: '' }; }
      if (out === false) return { saved: false, why: 'set_false' };
      return { saved: true, why: '' };
    } catch (_e) {
      return { saved: false, why: 'write_threw' };
    }
  }

  setRuleDraft(patch) {
    const p = (patch && typeof patch === 'object') ? patch : {};
    this._ruleDraft = Object.assign({}, this._ruleDraft, p);
    return this._ruleDraft;
  }

  /** 提交一条规则：白名单先判（内核判）→ 写 → 提示行。非法规格**不落盘**且原因可读。 */
  submitRule() {
    const d = this._ruleDraft;
    const spec = {
      id: String(d.id || '').trim() || ('rule_' + Date.now()),
      name: String(d.name || '').trim(),
      trigger: String(d.trigger || ''),
      conditions: d.field ? [{ field: String(d.field), operator: String(d.operator || ''), value: TheaterApp._coerce(d.value) }] : [],
      actions: d.actionType ? [{ type: String(d.actionType) }] : [],
    };
    const check = validateRuleSpec(spec);
    if (!check.valid) {
      this._ruleFlash = '规则没收下：' + String(check.reason);
      this._ruleFlashBad = true;
      this.render();
      return { ok: false, reason: check.reason };
    }
    const read = this.readRuleState();
    if (!read.readable) {
      this._ruleFlash = '规则台账读不到（' + read.why + '），不敢在它上面加一条';
      this._ruleFlashBad = true;
      this.render();
      return { ok: false, reason: 'state-unreadable' };
    }
    const reg = registerRule(read.state, spec);
    if (!reg.success) {
      this._ruleFlash = '规则没收下：' + String(reg.reason);
      this._ruleFlashBad = true;
      this.render();
      return { ok: false, reason: reg.reason };
    }
    const w = this._writeRuleState(reg.state);
    this._ruleFlash = w.saved
      ? ('已存规则「' + reg.rule.name + '」（触发 ' + reg.rule.trigger + '）')
      : ('规则没写下去：' + w.why);
    this._ruleFlashBad = !w.saved;
    if (w.saved) this._ruleDraft = TheaterApp.emptyRuleDraft();
    this.render();
    return { ok: w.saved, rule: reg.rule, why: w.why };
  }

  /** 回放一次事件：内核判哪些规则真的命中，本件只把结果摆出来（不代执行任何动作）。 */
  evaluateRuleEvent(eventType, payload) {
    const read = this.readRuleState();
    if (!read.readable) {
      this._ruleFlash = '规则台账读不到（' + read.why + '），评不了';
      this._ruleFlashBad = true;
      this.render();
      return { ok: false, reason: 'state-unreadable' };
    }
    const event = { type: String(eventType || ''), payload: (payload && typeof payload === 'object') ? payload : {} };
    const res = evaluateEvent(read.state, event);
    const fired = res.triggeredActions || [];
    if (fired.length) this._writeRuleState(res.state);
    this._lastFired = { type: event.type, at: Date.now(), actions: fired };
    this._ruleFlash = fired.length
      ? ('本次触发 ' + String(fired.length) + ' 个动作（只显示，不代发）')
      : '本次没有规则命中（条件全不成立，或没有同触发器的规则）';
    this._ruleFlashBad = false;
    this.render();
    return { ok: true, fired: fired };
  }

  /** 表单里的值一律是字符串：只把**看起来是数字**的转成数字（greater_than / less_than 要数字），
   *  其余原样 —— 不猜类型（把 "abc" 猜成数字会得到 NaN 再恒假，比不猜更糟）。 */
  static _coerce(v) {
    const s = String(v === undefined || v === null ? '' : v);
    if (/^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s.trim());
    return s;
  }

  /** 规则面读数（视图只渲染）。 */
  ruleVm() {
    const read = this.readRuleState();
    const rows = [];
    if (read.readable) {
      for (const r of Object.values(read.state.rules || {})) {
        rows.push({
          id: r.id, name: r.name, trigger: r.trigger, enabled: r.enabled, fireCount: r.fireCount,
          actions: (r.actions || []).map(function (a) { return a && a.type; }).filter(Boolean),
        });
      }
      rows.sort(function (a, b) { return (b.fireCount || 0) - (a.fireCount || 0); });
    }
    return {
      readable: read.readable,
      why: read.why,
      rows: rows,
      countText: read.readable
        ? ('规则 ' + String(rows.length) + ' 条（上限 ' + String(RT_MAX_RULES) + ' 条；同 id 覆盖，不堆积）')
        : ('规则台账**读不到**（' + String(read.why) + '）—— 这是「读不出」，不是「没编过」'),
      triggers: Object.values(RULE_TRIGGERS),
      operators: Object.values(RULE_OPERATORS),
      actions: Object.values(RULE_ACTIONS),
      draft: this._ruleDraft,
      flash: this._ruleFlash,
      flashBad: this._ruleFlashBad,
      lastFired: this._lastFired ? {
        type: this._lastFired.type,
        lines: (this._lastFired.actions || []).map(function (a) {
          return (a.ruleName || a.ruleId) + ' → ' + (a.action && a.action.type);
        }),
      } : null,
    };
  }

  render() {
    this.view.render(this.phoneShell.layerHost?.('theater-main') || this.phoneShell.screen);
  }
}

export default TheaterApp;
