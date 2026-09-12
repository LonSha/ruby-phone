/* ========================================================
 * 幸运转盘 (Gacha) App — 应用控制器
 * 纯本地抽卡; 道具库内置, 幸运币账本, 零 LLM
 * ======================================================== */
'use strict';
import { GachaData, QUALITY_META } from './gacha-data.js';
import { GachaView } from './gacha-view.js';

export class GachaApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new GachaData(storage);
    this.view = new GachaView(this);
  }

  render() {
    if (!this.phoneShell?.screen) return;
    this.view.render();
  }

  // 把抽到的最高品质卡片以消息形式发给角色（互动）
  shareToChat(r) {
    if (!r || !r.results || !r.results.length) return;
    const best = r.results.sort((a, b) => (QUALITY_META[a.quality]?.order ?? 9) - (QUALITY_META[b.quality]?.order ?? 9))[0];
    const message = `[扭蛋出了 ${best.quality}「${best.name}」！]`;
    window.dispatchEvent(new CustomEvent('phone:sendToChat', { detail: { message } }));
  }
}

export default GachaApp;