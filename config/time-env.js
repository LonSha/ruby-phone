/**
 * 时间-环境感知注入 (TPES 移植)
 * 规则移植自 TPES 时间感知增强系统 1.0 (MODULE 2/3/5/6/7/8 精简)
 * 纯本地规则：从 TimeManager 读剧情时间 → 时段/光照/生理绑定 → 注入块
 * 不新增 API 管线，不写世界书
 */

import { numOrNull } from './num-gate.js';

const STORAGE_ENABLED_KEY = 'time_env_auto_inject_enabled';

// TPES MODULE 5A：时段-光照绑定
const PERIODS = [
  { from: 5, to: 7, label: '黎明', light: '天色渐亮，晨光初现' },
  { from: 7, to: 11, label: '上午', light: '日光渐强，亮度上升' },
  { from: 11, to: 13, label: '正午', light: '太阳当头，光线最强' },
  { from: 13, to: 17, label: '下午', light: '日头西移，光线转暖' },
  { from: 17, to: 19, label: '黄昏', light: '金色时刻，日落色调' },
  { from: 19, to: 21, label: '傍晚', light: '光线消退，路灯渐次点亮' },
  { from: 21, to: 23, label: '夜晚', light: '黑暗，人工照明为主' },
  { from: 23, to: 5, label: '深夜', light: '深黑安静，万籁俱寂' },
];

function clampHour(n, fallback) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? Math.max(0, Math.min(23, v)) : fallback;
}

export class TimeEnvManager {
  constructor(storage) {
    this.storage = storage;
    this._hooked = false;
  }

  isEnabled() {
    try {
      const raw = this.storage?.get?.(STORAGE_ENABLED_KEY);
      if (raw === undefined || raw === null || raw === '') return true; // 默认开
      return raw === true || raw === 'true' || raw === 1;
    } catch (e) {
      return true;
    }
  }

  async setEnabled(on) {
    try { await this.storage?.set?.(STORAGE_ENABLED_KEY, !!on); } catch (e) {}
  }

  _periodFor(hour) {
    for (const p of PERIODS) {
      if (p.from > p.to) {
        if (hour >= p.from || hour < p.to) return p;
      } else if (hour >= p.from && hour < p.to) {
        return p;
      }
    }
    return PERIODS[7];
  }

  _mealHint(hour) {
    if (hour >= 7 && hour < 9) return '早餐时段';
    if (hour >= 11 && hour < 13) return '临近或处于午餐时段';
    if (hour >= 17 && hour < 19) return '临近或处于晚餐时段';
    return '';
  }

  _storyTime() {
    try {
      return window.VirtualPhone?.timeManager?.getCurrentStoryTime?.() || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 生成注入块；时间不可用时返回空串（静默跳过，不注入垃圾）
   */
  buildDirective() {
    const t = this._storyTime();
    /* [v3.12.0] 取数走唯一实现：空白串 / 空数组会被 `Number` 读成 0 并**通过** isFinite，
     *  于是注入块会写上一份「1970-01-01 早上」的时段光照（比不注入更坏）。 */
    if (!t || numOrNull(t.timestamp) === null) return '';
    const d = new Date(Number(t.timestamp));
    const hour = d.getHours();
    const period = this._periodFor(hour);
    const meal = this._mealHint(hour);
    const dateText = String(t.date || '').trim();
    const timeText = String(t.time || '').trim();
    const weekday = String(t.weekday || '').trim();
    const ancient = t.isAncient === true;

    const lines = [
      '<Time_Env>',
      '【时间感知规则 — 按此推进与描写，不输出时间戳元标注】',
      `- 当前剧情时间: ${dateText}${weekday ? ' ' + weekday : ''} ${timeText}${ancient ? '（古代纪时，按上述时辰对应的昼夜光线描写）' : ''}`,
      `- 时段: ${period.label} — ${period.light}`,
    ];
    if (meal) lines.push(`- 生理节点: ${meal}，角色到点会饿，可自然带出用餐意愿`);
    lines.push(
      '- 时间只前进：不冻结、不循环、不倒流；对话内的活动要累积耗时（聊了多久时间就过了多久）',
      '- 两次交互之间现实间隔多久，剧情也同样流逝（离开三天就是三天后，各自照常生活）',
      '- 环境随时间联动：光线/人流/噪音/店铺营业状态与上述时段一致；熬夜次日显疲态，刚醒显迷糊',
      '- 用户离线期间角色按自己人设作息生活，可发生日常小事，不推进主线剧情',
      '- 时间感只通过叙事体现（光线、哈欠、提到饭点），禁止输出 [时间:xx] 一类元标注',
      '</Time_Env>',
    );
    return lines.join('\n');
  }

  attachPromptHook() {
    if (this._hooked) return true;
    try {
      const context = window.SillyTavern?.getContext?.();
      const eventSource = context?.eventSource;
      const event_types = context?.event_types;
      if (!eventSource || !event_types || !event_types.GENERATE_BEFORE_COMBINE_PROMPTS) return false;
      eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
        try {
          if (!this.isEnabled() || !payload || !Array.isArray(payload.prompt)) return;
          const directive = this.buildDirective();
          if (directive) payload.prompt.push({ role: 'system', content: directive });
        } catch (e) { /* 静默 */ }
      });
      this._hooked = true;
      return true;
    } catch (e) {
      console.warn('[TimeEnv] prompt 钩子挂载失败:', e);
      return false;
    }
  }
}

export default TimeEnvManager;
