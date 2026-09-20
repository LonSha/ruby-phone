/**
 * Health view with BioTracker pregnancy, labor and race speed
 */
// [v2.41.0] 严重度中文名改由 medical-core 单一真源供给。
//   此前此处手写三连三元（mild/中/重/危重），与 medical-core 的
//   SEVERITY_LABELS 各写一份：新增一档严重度时两处必须同步改，漏一处即显示英文原文。
import { severityLabel } from './medical-core.js';

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function h(tag, attrs, html) {
  const a = attrs ? (" " + attrs) : "";
  return "<" + tag + a + ">" + (html || "") + "<" + "/" + tag + ">";
}

const FETUS_TAG_OPTIONS = [
  ["chimera", "嵌合体"],
  ["surrogacy", "代孕"],
  ["selfing", "自交"],
  ["identical", "同卵"],
  ["superfetation", "异期复孕"],
  ["nested", "孕中孕"],
];

function attr(name, val) {
  const q = String.fromCharCode(34);
  return name + "=" + q + val + q;
}

function cls(name) {
  return attr("class", name);
}

export class HealthView {
  constructor(app) {
    this.app = app;
    this.container = null;
  }


  render(container) {
    this.container = container;
    const data = this.app.data;
    const info = data.getPhaseInfo();
    const percent = Math.round(Math.max(0, Math.min(1, info.progress)) * 100);
    const races = data.knownRaces();
    const laborish = ["产兆前驱", "第一产程", "第二产程", "第三产程"].includes(info.phase);
    const pregnant = data.isPregnant || info.phase === "产后恢复" || laborish;
    const sliderMax = pregnant ? 42 : 28;
    const sliderVal = pregnant ? Math.max(0, Math.min(42, data.gestationWeeks)) : data.currentCycleDay;
    const sliderLabel = pregnant
      ? ("孕周 " + data.gestationWeeks + " / 足月折算 " + Math.round(info.pregnancyTotalDays / 7) + " 周")
      : ("周期第 " + data.currentCycleDay + " 天");
    let ringMain;
    if (pregnant && data.isPregnant) ringMain = "W" + data.gestationWeeks;
    else if (info.phase === "产后恢复") ringMain = "D" + Math.floor(data.stageDays);
    else ringMain = "Day " + data.currentCycleDay;
    const raceOpts = races.map((n) => {
      const sel = n === data.race ? " selected" : "";
      return h("option", attr("value", esc(n)) + sel, esc(n));
    }).join("");
    const fetusCards = (info.fetuses || []).map((f, i) => {
      const tags = new Set(f.tags || []);
      const tagBtns = FETUS_TAG_OPTIONS.map(([id, label]) => {
        const on = tags.has(id) ? " on" : "";
        return h("button", attr("type", "button") + " " + cls("hl-tag" + on) + " " + attr("data-fetus", i) + " " + attr("data-tag", id), esc(label));
      }).join("");
      const del = info.fetuses.length > 1
        ? h("button", attr("type", "button") + " " + cls("hl-mini") + " " + attr("data-del-fetus", i), "移除")
        : "";
      const genderInput = "<input " + attr("data-fgender", i) + " " + attr("value", esc(f.gender)) + " " + attr("maxlength", 8) + " />";
      const fatherInput = "<input " + attr("data-ffather", i) + " " + attr("value", esc(f.fathers)) + " " + attr("maxlength", 24) + " />";
      return h("div", cls("hl-fetus"),
        h("div", cls("hl-fetus-top"), h("strong", "", "第" + (i + 1) + "胎") + h("span", "", esc(f.embryoType || info.embryoType)) + del) +
        h("div", cls("hl-fetus-row"), h("label", "", "性别 " + genderInput) + h("label", "", "父源 " + fatherInput)) +
        h("div", cls("hl-tag-row"), tagBtns));
    }).join("");
    const notifyHtml = info.lastNotify ? h("p", cls("hl-notify"), esc(info.lastNotify)) : "";
    const icon = data.isPregnant ? "fa-baby" : "fa-droplet";
    const pregClass = data.isPregnant ? " active" : "";
    const pregLabel = data.isPregnant ? "解除妊娠" : "模拟受孕";
    const disabled = data.isPregnant ? "" : " disabled";
    const autoChecked = data.autoInject ? " checked" : "";
    const fetusSection = data.isPregnant
      ? h("div", cls("hl-controls-section"), h("div", cls("hl-section-title"), "胎儿 " + info.fetuses.length + " " + h("button", cls("hl-mini") + " " + attr("id", "hl-add-fetus"), "+加胎")) + fetusCards)
      : "";
    const ringStyle = "--ring-color: " + info.color + "; --ring-pct: " + percent + "%;";
    const iconHtml = "<i class=" + String.fromCharCode(34) + "fa-solid " + icon + " hl-droplet-icon" + String.fromCharCode(34) + " style=" + String.fromCharCode(34) + "color: " + info.color + ";" + String.fromCharCode(34) + "></i>";
    const badgeStyle = "background: " + info.color + "22; color: " + info.color + "; border: 1px solid " + info.color + "55;";
    const phaseStyle = "color: " + info.color + ";";
    const fertStyle = "color: " + info.color + ";";
    const header = h("header", cls("hl-header"),
      h("button", cls("hl-back-btn") + " " + attr("id", "hl-back-btn"), "<i class=" + String.fromCharCode(34) + "fa-solid fa-chevron-left" + String.fromCharCode(34) + "></i>") +
      h("h2", cls("hl-title"), "经期与身体健康") +
      h("div", cls("hl-spacer"), "")
    );
    const ring = h("div", cls("hl-ring-card"),
      h("div", cls("hl-ring-outer") + " " + attr("style", ringStyle),
        h("div", cls("hl-ring-inner"), iconHtml + h("span", cls("hl-ring-day"), esc(ringMain)) + h("span", cls("hl-ring-phase") + " " + attr("style", phaseStyle), esc(info.phase)))
      ) +
      h("div", cls("hl-badge-pill") + " " + attr("style", badgeStyle), esc(info.badge)) +
      notifyHtml
    );
    const cards = h("div", cls("hl-info-cards"),
      h("div", cls("hl-card"), h("div", cls("hl-card-label"), "受孕评估") + h("div", cls("hl-card-val") + " " + attr("style", fertStyle), esc(info.fertility))) +
      h("div", cls("hl-card"), h("div", cls("hl-card-label"), "体温 / 敏感") + h("div", cls("hl-card-val"), info.bodyTemp + "℃ · " + esc(info.arousalLevel))) +
      h("div", cls("hl-card full-width"), h("div", cls("hl-card-label"), "阶段体征") + h("div", cls("hl-card-desc"), esc(info.desc))) +
      h("div", cls("hl-card full-width"), h("div", cls("hl-card-label"), "种族 / 胚胎类型") + h("div", cls("hl-card-desc"), esc(info.race) + " · " + esc(info.embryoType) + " · 孕速 ×" + info.gestationSpeed.toFixed(2) + "<br>" + esc(info.embryoLore)))
    );
    const raceBox = h("div", cls("hl-controls-section"),
      h("div", cls("hl-section-title"), "种族与孕速") +
      h("label", cls("hl-select-row"), "母体种族" + h("select", attr("id", "hl-race"), raceOpts)) +
      h("div", cls("hl-slider-row"), h("span", cls("hl-slider-label"), "孕速修正 ×" + data.gestationModifier.toFixed(2)) +
        "<input type=" + String.fromCharCode(34) + "range" + String.fromCharCode(34) + " " + cls("hl-slider") + " " + attr("id", "hl-speed") + " min=" + String.fromCharCode(34) + "10" + String.fromCharCode(34) + " max=" + String.fromCharCode(34) + "400" + String.fromCharCode(34) + " " + attr("value", Math.round(data.gestationModifier * 100)) + " />")
    );
    const q = String.fromCharCode(34);
    const daySlider = h("div", cls("hl-slider-row"), h("span", cls("hl-slider-label"), esc(sliderLabel)) +
      "<input type=" + q + "range" + q + " " + cls("hl-slider") + " " + attr("id", "hl-day-slider") + " min=" + q + (pregnant ? 0 : 1) + q + " max=" + q + sliderMax + q + " " + attr("value", sliderVal) + " />");
    const stepBtns = h("div", cls("hl-btn-grid hl-btn-grid-4"),
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-step-prev"), "前一天") +
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-step-next"), "后一天") +
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-hour-prev"), "-1h") +
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-hour-next"), "+1h")
    );
    const pregBtns = h("div", cls("hl-btn-grid"),
      h("button", cls("hl-action-btn" + pregClass) + " " + attr("id", "hl-toggle-preg"), pregLabel) +
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-start-labor") + disabled, "进入产兆") +
      h("button", cls("hl-action-btn") + " " + attr("id", "hl-finish-birth") + disabled, "完成分娩")
    );
    const controlBox = h("div", cls("hl-controls-section"), h("div", cls("hl-section-title"), "快速推演") + daySlider + stepBtns + pregBtns);
    const injectBox = h("div", cls("hl-inject-box"),
      h("div", cls("hl-inject-top"),
        h("span", cls("hl-inject-title"), "同步至大模型上下文") +
        h("label", cls("hl-inject-toggle"), "<input type=" + q + "checkbox" + q + " " + attr("id", "hl-auto-inject") + autoChecked + " /> 自动") +
        h("button", cls("hl-inject-now-btn") + " " + attr("id", "hl-inject-now"), "立即同步")
      ) +
      h("p", cls("hl-inject-hint"), "只注入阶段、孕周、产程与种族胚胎类型等事实体征，不请求模型演情感。")
    );
    const tab = data.healthTab || "cycle";
    const tabs = h("div", cls("hl-tabs"),
      h("button", cls("hl-tab" + (tab === "cycle" ? " on" : "")) + " " + attr("data-tab", "cycle"), "周期") +
      h("button", cls("hl-tab" + (tab === "needs" ? " on" : "")) + " " + attr("data-tab", "needs"), "体征") +
      h("button", cls("hl-tab" + (tab === "medical" ? " on" : "")) + " " + attr("data-tab", "medical"), "健康") +
      h("button", cls("hl-tab" + (tab === "family" ? " on" : "")) + " " + attr("data-tab", "family"), "家谱")
    );
    const needCards = (data.describeNeeds() || []).map((row) => {
      return h("div", cls("hl-need"), h("div", cls("hl-need-top"), esc(row.label) + " " + row.value) + h("div", cls("hl-need-bar"), h("span", attr("style", "width:" + row.value + "%"), "")) + h("div", cls("hl-need-text"), esc(row.text)));
    }).join("");
    const needBox = h("div", cls("hl-controls-section"), h("div", cls("hl-section-title"), "五维体征（按小时累积）") + needCards +
      h("div", cls("hl-btn-grid"),
        h("button", cls("hl-action-btn") + " " + attr("data-need", "eat"), "进食") +
        h("button", cls("hl-action-btn") + " " + attr("data-need", "drink"), "饮水") +
        h("button", cls("hl-action-btn") + " " + attr("data-need", "void"), "如厕") +
        h("button", cls("hl-action-btn") + " " + attr("data-need", "wash"), "洗漱")
      )
    );
    const kids = (data.lineage?.births || []).map((child) => {
      return h("div", cls("hl-child"), h("div", cls("hl-child-top"), esc(child.name) + h("button", cls("hl-mini") + " " + attr("data-del-child", child.id), "移除")) + h("div", cls("hl-card-desc"), esc(child.gender + " · " + child.father + " · " + child.race)));
    }).join("") || h("div", cls("hl-card-desc"), "尚无子嗣记录。分娩完成后会自动登记。");
const familyBox = h("div", cls("hl-controls-section"), h("div", cls("hl-section-title"), "子嗣 " + ((data.lineage && data.lineage.births && data.lineage.births.length) || 0) + " " + h("button", cls("hl-mini") + " " + attr("id", "hl-add-child"), "+登记")) + kids);
    // ---- 健康档案（medical） ----
    const medOv = data.illnessOverview ? data.illnessOverview() : { total: 0, active: 0, chronic: 0 };
    const sevCn = severityLabel;   // [v2.41.0] 单一真源（medical-core）
    const medConds = (data.conditions || []).length ? data.conditions.map((c) => {
      const sevTag = c.severity ? " <span class='hl-med-sev'>" + esc(sevCn(c.severity)) + "</span>" : "";
      const outTag = c.outcome === 'recovered' ? " <span class='hl-med-out'>已痊愈</span>" : (c.outcome === 'chronic' ? " <span class='hl-med-chr'>慢性</span>" : "");
      const expText = c.expiresAt ? " <span class='hl-med-exp'>" + esc(data.conditionLineText ? data.conditionLineText(c) : '') + "</span>" : "";
      return h("div", cls("hl-med-item"),
        h("div", cls("hl-med-top"), esc(c.name) + sevTag + outTag + h("button", cls("hl-mini") + " " + attr("data-del-med", c.id), "移除")) +
        h("div", cls("hl-card-desc"), esc((c.stage || '') + (c.desc ? ' — ' + c.desc : '')) + expText));
    }).join("") : h("div", cls("hl-card-desc"), "暂无病症记录。下方可从病症库中添加。");
    const catOptions = (data.illnessCategories || []).map(c => "<option value='" + esc(c.id) + "'>" + esc(c.label) + "</option>").join("");
    const medIllnessSel = h("div", cls("hl-med-add"), h("select", attr("id", "hl-med-cat"), catOptions) + h("select", attr("id", "hl-med-ill"), "<option value=''>选病症…</option>") + h("select", attr("id", "hl-med-sev"), "<option value=''>程度</option><option value='mild'>轻度</option><option value='moderate'>中度</option><option value='severe'>重度</option><option value='critical'>危重</option>") + h("button", cls("hl-mini") + " " + attr("id", "hl-add-med"), "添加"));
    const medicalBox = h("div", cls("hl-controls-section"), h("div", cls("hl-section-title"), "健康档案 · " + medOv.active + " 进行中 / " + medOv.total + " 条 " + h("button", cls("hl-mini") + " " + attr("id", "hl-adv-med"), "每日推进")) + medConds + h("div", cls("hl-section-title"), "添加病症") + medIllnessSel);
    const cycleBody = ring + cards + raceBox + controlBox + fetusSection + injectBox;
    const body = tab === "needs" ? needBox : (tab === "family" ? familyBox : tab === "medical" ? medicalBox : cycleBody);
    container.innerHTML = h("div", cls("hl-root"), header + tabs + h("main", cls("hl-body"), body));
    this._bindEvents();
  }

  _bindEvents() {
    const root = this.container;
    const data = this.app.data;
    const rerender = () => this.render(this.container);
    root.querySelector("#hl-back-btn")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("phone:goHome"));
    });
    root.querySelector("#hl-day-slider")?.addEventListener("change", (e) => { data.setDay(e.target.value); rerender(); });
    root.querySelector("#hl-race")?.addEventListener("change", (e) => { data.setRace(e.target.value); rerender(); });
    root.querySelector("#hl-speed")?.addEventListener("change", (e) => { data.setGestationModifier(Number(e.target.value) / 100); rerender(); });
    root.querySelector("#hl-step-prev")?.addEventListener("click", () => { data.advanceDays(-1); rerender(); });
    root.querySelector("#hl-step-next")?.addEventListener("click", () => { data.advanceDays(1); rerender(); });
    root.querySelector("#hl-hour-prev")?.addEventListener("click", () => { data.advanceHours(-1); rerender(); });
    root.querySelector("#hl-hour-next")?.addEventListener("click", () => { data.advanceHours(1); rerender(); });
    root.querySelector("#hl-toggle-preg")?.addEventListener("click", () => {
      const next = !data.isPregnant;
      data.togglePregnancy(next, 4);
      window.toastr?.info(next ? "已切换至妊娠（第4周）" : "已恢复常规生理周期", "健康App");
      rerender();
    });
    root.querySelector("#hl-start-labor")?.addEventListener("click", () => { data.startLabor(); rerender(); });
    root.querySelector("#hl-finish-birth")?.addEventListener("click", () => { data.finishBirth({ surgical: true }); rerender(); });
    root.querySelector("#hl-add-fetus")?.addEventListener("click", () => { data.addFetus(); rerender(); });
    root.querySelector("#hl-auto-inject")?.addEventListener("change", (e) => { data.setAutoInject(e.target.checked); });
    root.querySelector("#hl-inject-now")?.addEventListener("click", () => {
      data.buildPromptDirective();
      window.toastr?.success("生理状态已准备，下一次生成时自动带入", "健康App");
    });
    root.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => { data.setHealthTab(btn.getAttribute("data-tab")); rerender(); });
    });
    root.querySelectorAll("[data-need]").forEach((btn) => {
      btn.addEventListener("click", () => { data.applyNeed(btn.getAttribute("data-need")); rerender(); });
    });
    root.querySelector("#hl-add-child")?.addEventListener("click", () => { data.addChild(); rerender(); });
    root.querySelectorAll("[data-del-child]").forEach((btn) => {
      btn.addEventListener("click", () => { data.removeChild(btn.getAttribute("data-del-child")); rerender(); });
    });
    // ---- 健康档案事件 ----
    root.querySelector("#hl-med-cat")?.addEventListener("change", (e) => {
      const cat = e.target.value;
      const within = (data.searchIllness ? data.searchIllness("", cat) : []);
      const opts = within.map(i => "<option value='" + esc(i.name) + "'>" + esc(i.name) + "</option>").join("");
      const illSel = root.querySelector("#hl-med-ill");
      if (illSel) illSel.innerHTML = "<option value=''>选病症…</option>" + opts;
    });
    root.querySelector("#hl-add-med")?.addEventListener("click", () => {
      const nameVal = root.querySelector("#hl-med-ill")?.value;
      const sevVal = root.querySelector("#hl-med-sev")?.value;
      if (!nameVal) { window.toastr?.warning("请选择病症", "健康App"); return; }
      const added = data.addCondition(nameVal, sevVal || "");
      if (added) { window.toastr?.success("已添加「" + added.name + "」", "健康App"); rerender(); }
      else window.toastr?.error("添加失败，未知病症", "健康App");
    });
    root.querySelectorAll("[data-del-med]").forEach((btn) => {
      btn.addEventListener("click", () => { data.removeCondition(btn.getAttribute("data-del-med")); rerender(); });
    });
    root.querySelector("#hl-adv-med")?.addEventListener("click", () => {
      const r = data.advanceMedical();
      if (r.changed) {
        const desc = (r.changes || []).slice(0, 3).map(c => c.name + "→" + (c.to || '痊愈')).join("、");
        window.toastr?.info("病症推进: " + (desc || "状态变化"), "健康App");
      } else if (r.reason === 'already') {
        window.toastr?.info("今天已推进过", "健康App");
      } else {
        window.toastr?.info("病症状态无变化", "健康App");
      }
      rerender();
    });
    root.querySelectorAll("[data-del-fetus]").forEach((btn) => {
      btn.addEventListener("click", () => {
        data.removeFetus(Number(btn.getAttribute("data-del-fetus")));
        rerender();
      });
    });
    root.querySelectorAll("[data-fgender]").forEach((input) => {
      input.addEventListener("change", () => {
        data.updateFetus(Number(input.getAttribute("data-fgender")), { gender: input.value });
      });
    });
    root.querySelectorAll("[data-ffather]").forEach((input) => {
      input.addEventListener("change", () => {
        data.updateFetus(Number(input.getAttribute("data-ffather")), { fathers: input.value });
      });
    });
    root.querySelectorAll("[data-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-fetus"));
        const tag = btn.getAttribute("data-tag");
        const fetus = data.fetuses[i];
        if (!fetus) return;
        const tags = new Set(fetus.tags || []);
        if (tags.has(tag)) tags.delete(tag); else tags.add(tag);
        data.updateFetus(i, { tags: [...tags] });
        rerender();
      });
    });
  }
}

export default HealthView;

