/* ========================================================
 * timeweaver-collector.js — 织光机数据收集器（主动聚合，完全原创）
 * 区别于 life-events.js 的被动上报，本收集器「主动读取」各 App 已沉淀的
 * 私有数据，逐源容错聚合成引擎可消费的 rawSources。任一源缺失/脏数据不毁整部。
 * ======================================================== */
'use strict';
import TW from './timeweaver-engine.js';
// [v2.36.0] 桥读取走 config/world-bridge.js 单一真源：
//   本文件此前**自写**了一份 `window.lonsha_memory_bridge_v1` 读取（只取 snapshot.recallAudit）。
//   同一份桥读取逻辑有两份实现必然漂移（且第二份不知道对方 v3.174 的 sourceState 可归因），
//   故收敛到一处——本文件只负责「取 recallAudit 这一块业务数据」，桥怎么读由真源决定。
import { readLonshaSnapshot, readLonshaEventPlatforms, eventPlatformsLine, readLonshaEvidence, evidenceFaceLine } from '../../config/world-bridge.js';
// [v3.0.2] R2-C：上游**注入读数**的消费侧单一真源（与上面那条桥读取并列，
//   但读的是**不同的一面**：readLonshaSnapshot 取 recallAudit「召回了什么」，
//   本函数取 injection「最终送进上下文的是什么」——中间隔着预算裁剪与去重）。
import { readInjection, injectionLine } from '../../config/injection-contract.js';
/* [v3.10.2 · G-4 余量] 跨 App 时间编排面的**第一处业务消费**。
 *   上游 G-4 把三处时间读数（WorldAxis 世界钟 / 插件剧情日期 / 日历当天）收成单一读数面，
 *   但**只有诊断中心在读** —— 业务面零消费（本仓第九次同形：「建好不消费」）。
 *   接在织光机：这一栏此前能答「想起了什么 / 送进去了什么 / 谁记的 / 出自哪本账」，
 *   独独答不出「这些事发生在**哪一天**」—— 缺的正是判读整条时间线的基准。 */
import { storyClock, storyClockLine, storyClockProbe, CLOCK_SOURCES, CLOCK_REASONS } from '../../config/story-clock.js';
/* [v3.20.0 · F8] 续玩简报：跨面收束。
 *   三个新依赖都是**既有真源**，本文件不新增取数口径：
 *     · `resumeBrief` / `resumeBriefText` —— 收束内核（纯函数：输入由上面各面给好）；
 *     · `evidenceFaceOf` —— 由**已有快照**构建证据面（纯函数，不取数 ⇒ 不与上面那处取数点重复）；
 *     · `promiseList` / `arcList` —— 剧情线既有投影行（不在本文件重解析上游形状）；
 *     · `updateGapLine` —— 本仓表格锚点读数（「落后正文几楼」，已把「未知」与「0」判开）。 */
import { resumeBrief, resumeBriefText } from '../../config/resume-brief.js';
import { evidenceFaceOf } from '../../config/world-bridge.js';
import { promiseList, arcList } from '../plotline/plotline-data.js';
import { updateGapLine } from '../../config/update-gap.js';

// 安全读 storage 键并解析为数组
function readArr(storage, key) {
  try {
    const raw = storage?.get?.(key);
    const v = TW.parseMaybe(raw, null);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      // 对象包数组的常见形态 {records:[]}/{entries:[]}/{list:[]}/{photos:[]}
      for (const k of ['records', 'entries', 'list', 'photos', 'items', 'data']) {
        if (Array.isArray(v[k])) return v[k];
      }
    }
    return [];
  } catch (e) { return []; }
}

// 从 chatMetadata 收集 st_virtual_phone_* 下疑似事件数组（兜底源）
function readChatMetaArrays(ctx) {
  const out = [];
  try {
    const meta = ctx?.chatMetadata;
    if (!meta || typeof meta !== 'object') return out;
    for (const [k, v] of Object.entries(meta)) {
      if (!k.startsWith('st_virtual_phone')) continue;
      const arr = Array.isArray(v) ? v : (v && Array.isArray(v.events) ? v.events : (v && Array.isArray(v.records) ? v.records : null));
      if (arr) for (const it of arr) if (it && typeof it === 'object') out.push({ ...it, _src: k });
    }
  } catch (e) {}
  return out;
}

/**
 * [v2.15.0] 读取 LonSha 侧召回自检摘要（跨项目观测互喂）。
 *  数据源：window.lonsha_memory_bridge_v1.snapshot.recallAudit
 *  （lonsha v3.151 把 v3.150 召回自检账本压成只读摘要外供）。
 *  产出「你最常回望的时光」维度：轮数 / 空结果轮数 / 平均命中 / 热点楼层 Top10。
 *  插件未安装 / 未生成 / 旧版无该字段 → 返回 null（不影响织光机其它源）。
 */
export function collectLonshaRecall() {
  try {
    // [v2.36.0] 经单一真源读桥（只读、不抛、可归因）；本文件不再自己摸 window 全局。
    const r = readLonshaSnapshot();
    const snap = (r && r.ok && r.snapshot) ? r.snapshot : null;
    if (!snap) return null;   // 桥未装 / 对方未就绪 / 无快照 ⇒ 返回 null（不影响织光机其它源）
    const ra = snap.recallAudit;
    if (!ra || !Number(ra.rounds)) return null;
    const hotFloors = (Array.isArray(ra.hotFloors) ? ra.hotFloors : [])
      .map(h => ({ floor: Number(h && h.floor), count: Number(h && h.count) || 0 }))
      .filter(h => Number.isFinite(h.floor) && h.floor >= 0)
      .slice(0, 10);
    return {
      rounds: Number(ra.rounds) || 0,
      emptyRounds: Number(ra.emptyRounds) || 0,
      avgHits: Number(ra.avgHits) || 0,
      hotFloors,
      lastQuery: String(ra.lastQuery || '').slice(0, 80),
      lastTs: Number(ra.lastTs) || 0,
      pluginVersion: String(snap.pluginVersion || '')
    };
  } catch (e) { return null; }
}

/**
 * [v3.0.2] R2-C：读取 LonSha 侧的**注入读数**（本轮最终实际注入）。
 *
 * 与 `collectLonshaRecall` 的分工（两者常被混为一谈，是两个不同的问题）：
 *   · collectLonshaRecall —— 召回侧：「想起了哪段剧情」（recallAudit）；
 *   · collectLonshaInjection —— 送达侧：「哪几块**真的**进了上下文」（injection）。
 *   中间隔着预算裁剪与去重，故两边数字本就不该相等；少的那部分正是「被裁掉」的。
 *
 * 插件未装 / 未就绪 / 旧版无该字段 → 返回 null（不影响织光机其它源）。
 * 刻意**不在这里拼结论文案**：那是真源 injectionLine() 的活（单一出口）。
 */
export function collectLonshaInjection(win) {
  try {
    /* 显式注入 window（无头测试用；运行时不传即取全局）—— 与 config/world-bridge.js
       的 read* 同规格：消费方要能在无宿主环境下被独立驱动，否则行为面判据只能靠全局状态，
       而那正是本仓 v2.97 之前 7 份重复实现各自为政的温床。 */
    const r = readInjection(win);
    if (!r || r.reason !== 'ready') return null;
    return {
      verdict: r.verdict,
      line: injectionLine(r),
      round: r.round,
      origin: r.origin,
      // [v3.0.3] R2-E：结局带出（回望页要显示「这一轮有没有出稿」）
      outcome: r.outcome,
      outcomeAt: r.outcomeAt,
      strayOrigin: r.strayOrigin,
      total: r.total,
      kept: r.kept,
      dropped: r.dropped,
      chars: r.chars,
      tokens: r.tokens,
      ts: r.ts,
      blocks: r.blocks
    };
  } catch (e) { return null; }
}

/**
 * [v3.5.0] F-2 下游侧：读取「这条事件是谁记的」（跨平台事件来源构成）。
 *
 * 与上面两个读数的分工（三个问题，各答一个，互不顶替）：
 *   · `collectLonshaRecall`     —— 召回侧：想起了哪段剧情（recallAudit）；
 *   · `collectLonshaInjection`  —— 送达侧：哪几块真的进了上下文（injection）；
 *   · `collectLonshaEventPlatforms` —— **来源侧：事件是谁记的**（eventPlatforms）。
 *   前两个回答「模型看到了什么」，这一个回答「那件事是哪一侧发生的」——
 *   跨平台对照（插件从正文提的 vs 手机 App 里发生的）此前在这台设备上**无据可查**。
 *
 * 五态归因由真源给出（bridge-absent / face-absent / unusable / empty / ok），此处**不重判**：
 *   本仓 v2.97 的教训正是每个消费点自写形态判定（7 份 probeBridge 各自为政）。
 *
 * 哪两态**不建卡**（返回 null）：桥未装 / 本版没有这一面 —— 那不是本机用户的问题面，
 *   每张卡都刷一行「尚未读到」只是噪声；而其余三态照旧建卡：
 *   · `unusable` —— 插件装了但上游模块没挂上（装了却读不出，必须说出来，否则又是一次静默降级）；
 *   · `empty`    —— 有面、账里还没有事件段（**真读数**，不是错误）；
 *   · `ok`       —— 有构成。
 */
export function collectLonshaEventPlatforms(win) {
  try {
    const r = readLonshaEventPlatforms(win);
    if (!r) return null;
    if (r.state === 'bridge-absent' || r.state === 'face-absent') return null;
    return {
      state: r.state,
      reason: r.reason,
      line: eventPlatformsLine(win),
      platforms: r.platforms,
      platformCount: r.platformCount,
      topPlatform: r.topPlatform,
      topSegments: r.topSegments,
      segments: r.segments,
      countedEvents: r.countedEvents,
      unlabeled: r.unlabeled,
      truncated: r.truncated,
      pluginVersion: r.pluginVersion
    };
  } catch (e) { return null; }
}

/**
 * [v3.6.0] R1-E 下游侧：读取**九账证据对账面**（这个承诺是哪一楼说的）。
 *
 * 与上面三个读数的分工（四个问题，各答一个，互不顶替）：
 *   · `collectLonshaRecall`           —— 召回侧：想起了哪段剧情（recallAudit）；
 *   · `collectLonshaInjection`        —— 送达侧：哪几块真的进了上下文（injection）；
 *   · `collectLonshaEventPlatforms`   —— 来源侧：事件是谁记的（eventPlatforms）；
 *   · `collectLonshaEvidence`         —— **出处侧：她说过的话在哪一楼、出自哪本账**（evidence）。
 *   前三个都在说「模型这一侧发生了什么」，本面第一次让**上游九本账本身**可读：
 *   伏笔 / 约定 / 平行事实 / 秘密 / 前文回扣 / 回声 / 事实版本 / 事件完整性 / 修复闭环，
 *   并且每条带**稳定引用键与出处楼层** —— 此前下游要回答「这个承诺是哪一楼说的」只能逐 App 翻且拿不到出处。
 *
 * 五态归因由真源给出（bridge-absent / face-absent / unusable / empty / ok），此处**不重判**：
 *   本仓 v2.97 的教训正是每个消费点自写形态判定（7 份 probeBridge 各自为政）。
 *
 * 哪两态**不建卡**（返回 null）：桥未装 / 本版没有这一面 —— 那不是本机用户的问题面，
 *   每张卡都刷一行「尚未读到」只是噪声；而其余三态照旧建卡：
 *   · `unusable` —— 一本账也读不到（上游模块没挂上 / 读面抛错，必须说出来，否则又是一次静默降级）；
 *   · `empty`    —— 九账都在位、确实一条证据都没有（**真读数**，不是错误）；
 *   · `ok`       —— 有可查条目。
 * 【为什么这里可以调取数式出口 `readLonshaEvidence`】织光机是**独立业务面**、手上没有现成快照，
 *   与诊断内核（已握快照，走 `evidenceFaceOf` 纯函数）处境不同 —— 同一轮里不存在第二个取数点。
 */
export function collectLonshaEvidence(win) {
  try {
    const r = readLonshaEvidence(win);
    if (!r) return null;
    if (r.state === 'bridge-absent' || r.state === 'face-absent') return null;
    return {
      state: r.state,
      reason: r.reason,
      line: evidenceFaceLine(r),
      version: r.version,
      total: r.total,
      okCount: r.okCount,
      emptyCount: r.emptyCount,
      absentCount: r.absentCount,
      itemCount: r.itemCount,
      selfConsistent: r.selfConsistent,
      ledgers: r.ledgers,
      items: r.items,
      absentReasons: r.absentReasons
    };
  } catch (e) { return null; }
}

/**
 * [v3.10.2 · G-4 余量] 第五面：**当前剧情时刻**（这些事发生在哪一天）。
 *
 * 与上面四个读数的分工（五个问题，各答一个，互不顶替）：
 *   · `collectLonshaRecall`           —— 召回侧：想起了哪段剧情（recallAudit）；
 *   · `collectLonshaInjection`        —— 送达侧：哪几块真的进了上下文（injection）；
 *   · `collectLonshaEventPlatforms`   —— 来源侧：事件是谁记的（eventPlatforms）；
 *   · `collectLonshaEvidence`         —— 出处侧：出自哪本账、哪一楼（evidence）；
 *   · `collectStoryClock`             —— **时间侧：现在算哪一天**（storyClock）。
 *   前四个说的都是「发生了什么/模型看到了什么」，本面给的是**判读基准** ——
 *   没有它，「三月的日记与六月的约定哪个在前」只能靠现实时间猜，而那正是本仓最贵的错读数之一。
 *
 * 三源一致性由真源给出（`storyClock` 的 agree / conflict / primary 与逐源 state），此处**不重判**：
 *   本仓 v2.97 的教训正是每个消费点自写形态判定（7 份 probeBridge 各自为政）。
 * 取数口也走真源 `storyClockProbe()`（本文件不自摸宿主对象 —— 三处各写一份必然漂移）。
 *
 * 什么时候**不建卡**（返回 null）：三源**全部**落在「不是本机用户的问题面」的缺席档上 ——
 *   即 `bridge-absent`（这一层的桥没装）与 `source-missing`（这一层没给时间读数）。
 *   每张卡都刷一行「本机没装插件」只是噪声（与上面两面同一取舍）。
 * 什么时候**照旧建卡**（只要有任何一源「**有面**」）：
 *   · `ok`            —— 真读数（可能不止一处，一致性由真源判）；
 *   · `unusable`      —— 有面却读不出（**必须说出来**，否则又是一次静默降级）；
 *   · `face-absent`   —— 快照在、这一版没有时间面（读者据此知道「升级插件才有」）；
 *   · `no-snapshot`   —— 桥在、还没产出过快照（读者据此知道「再聊一轮就有」）。
 *   ★ 判据不写成「存在 unusable 才建卡」：实测该态在探针路径上几乎不可达
 *     （上游每层都有 try/catch 兜底），把建卡挂在它上面等于**在空集合上立判据**。
 *     改判「是否有面」—— 可达、可证伪，且语义更准：**本机/本版的事实必须可见**。
 */
export function collectStoryClock(win) {
  try {
    const probe = storyClockProbe(win);
    const sc = storyClock({ win: probe.win, calendarSource: probe.calendarSource });
    const line = storyClockLine(sc);
    /* 「不是本机问题面」的缺席两态（与上面两面同一取舍：不建卡） */
    const FACELESS = { 'bridge-absent': 1, 'source-missing': 1 };
    const faceless = CLOCK_SOURCES.every((k) => FACELESS[sc.sources[k].state] === 1);
    if (!line.present && faceless) return null;   // 三源全是「本机没装 / 这一层没给」⇒ 不建卡
    return {
      present: line.present,
      agree: sc.agree,
      conflict: sc.conflict,
      basis: sc.basis,
      primary: sc.primary,
      primaryDate: sc.primaryDate,
      verdict: line.verdict,
      detail: line.detail,
      text: sc.text,
      /* 逐源行：state / reason / 原值三者都带出，视图不重判也不拼结论。
       *   `reason` 用真源 CLOCK_REASONS 的文案（缺项即原样显示 state，不静默）。 */
      sources: CLOCK_SOURCES.map((k) => {
        const s = sc.sources[k];
        return {
          key: k,
          state: s.state,
          reason: s.reason,
          reasonText: CLOCK_REASONS[s.reason] || s.reason,
          date: s.date,
          label: s.label,
          precision: s.precision,
          turn: s.turn
        };
      })
    };
  } catch (e) { return null; }
}

/**
 * [v3.20.0 · F8] 第六面：**续玩简报**（隔几天回来该看什么）。
 *
 * 与上面五个读数的分工（六个问题，各答一个，互不顶替）：
 *   · `collectLonshaRecall` / `collectLonshaInjection` / `collectLonshaEventPlatforms` /
 *     `collectLonshaEvidence` / `collectStoryClock` —— 各答「上游发生了什么 / 模型看到了什么 /
 *     现在算哪一天」；
 *   · `collectResumeBrief` —— **收束面：把「上次停在哪 / 还没完的事」收成一份可续清单**。
 *   前五个都是**面读数**（每个回答一个问题），本面是**跨面收束**（它自己不含任何新口径，
 *   只把已取好的面按「续玩」这个目的分组，并按当前正文长度挡掉不可达楼层）。
 *
 * 【为什么不新开取数点】本仓纪律：同一轮里不出现第二个取数点。故本函数
 *   · 优先用调用方**已经取好**的面（`opts.evidence` / `opts.storyClock` / `opts.worldProg`）；
 *   · 未给时才走既有真源各取一次（诊断/独立调用场景）；
 *   · 快照只读**一份**：`readLonshaSnapshot` 一次，`evidenceFaceOf(snapshot)` 是纯函数（不取数）。
 *   这正是 `evidenceFaceOf` 当初被拆出来的同一理由（详见 config/world-bridge.js 的那段注释）。
 *
 * 【两个输入不走桥】`commitments`（本仓自己拥有的约定五态）与 `updateGap`（本仓的表格锚点）
 *   都是**本机字段**：前者读 `calendar_commitments`（已登记键，不改命名空间），
 *   后者读宿主 chatMetadata 的锚点（`updateGapLine(ctx)`）。
 *
 * 【缺口不许填占位】任何一个面读不到 ⇒ 由内核记进 `gaps` 并让总述说明「不完整」；
 *   本函数**不**为读不到的面编一行「暂无」——那会把「没接上」写成「没有」。
 */
export function collectResumeBrief(storage, opts = {}) {
  try {
    const win = opts.win;
    const ctx = opts.context || (storage?.getContext ? storage.getContext() : null);

    /* 取数：**已取好的面一律复用**（调用方给了就不再取一次 —— 同一轮不出现第二个取数点）；
     * 未给时走既有真源。快照只在本函数内读**一次**：证据面与上游承诺都从这一份里派生
     * （`evidenceFaceOf` 是纯函数，不取数，这正是它当初被拆出来的理由）。 */
    const needSnap = (opts.evidence === undefined) || (opts.worldProg === undefined);
    const r = needSnap ? readLonshaSnapshot({ win }) : null;
    const snap = (r && r.ok && r.snapshot) ? r.snapshot : null;

    const evidence = (opts.evidence !== undefined)
      ? opts.evidence
      : (snap ? evidenceFaceOf(snap) : null);
    const worldProg = (opts.worldProg !== undefined)
      ? opts.worldProg
      : (snap ? (snap.worldProg || null) : null);

    /* 上游承诺 / 支线一律走 plotline 既有投影函数（不在本文件重解析上游形状）。 */
    const promises = worldProg ? promiseList(worldProg) : null;
    const arcs = worldProg ? arcList(worldProg) : null;

    /* 本机约定（五态）：读的是**已登记键**，不改命名空间、不新增键。 */
    let commitments = null;
    if (opts.commitments !== undefined) commitments = opts.commitments;
    else if (storage?.get) {
      try {
        const raw = storage.get('calendar_commitments');
        commitments = TW.parseMaybe(raw, null);
      } catch (_e) { commitments = null; }
    }

    const storyClockFace = (opts.storyClock !== undefined)
      ? opts.storyClock
      : collectStoryClock(win);

    const updateGap = (opts.updateGap !== undefined) ? opts.updateGap : updateGapLine(ctx);
    const floorCount = Array.isArray(ctx?.chat) ? ctx.chat.length : null;

    const brief = resumeBrief({
      evidence,
      worldProg: promises,
      arcs,
      commitments,
      storyClock: storyClockFace,
      updateGap,
      floorCount,
      at: opts.at
    });
    brief.line = resumeBriefText(brief);
    return brief;
  } catch (e) {
    /* 本函数是**展示面的取数口**，不能因为一个面畸形就把整块卡弄没；
     *   但**不许静默**：把归因带出来（这一形态本仓治过多次 —— 「降级了但没人知道」）。
     *   诊断/判据可据此区分「没数据」与「读崩了」。 */
    try { console.warn('[织光机] 续玩简报取数失败：', e && e.message ? e.message : e); } catch (_e) { /* 无 console 环境 */ }
    return { at: null, present: false, complete: false, sections: [], gaps: [{ face: 'resume', reason: 'thrown:' + String(e && e.message || e) }], faceLedger: [], dropped: { staleFloors: 0 }, floorCount: null, headline: '续玩简报：读取异常（已降级）', line: '续玩简报：读取异常（已降级）', degraded: true };
  }
}

/**
 * 主动聚合所有源 → rawSources（供 TW.normalizeEvents）
 * @param storage PhoneStorage 实例
 */
export function collectSources(storage) {
  const ctx = storage?.getContext?.() || null;
  const safe = (fn) => { try { return fn() || []; } catch (e) { return []; } };

  const raw = {
    diary:        safe(() => readArr(storage, 'diary_entries')),
    photos:       safe(() => readArr(storage, 'album_photos').concat(readArr(storage, 'album_records'), readArr(storage, 'gallery_photos'))),
    achievements: safe(() => readArr(storage, 'ruby_unlocked_achievements').concat(readArr(storage, 'achievements'))),
    calendar:     safe(() => readArr(storage, 'calendar_events').concat(readArr(storage, 'calendar_records'))),
    weibo:        safe(() => readArr(storage, 'weibo_posts').concat(readArr(storage, 'weibo_feed'))),
    honey:        safe(() => readArr(storage, 'honey_records').concat(readArr(storage, 'honey_messages'), readArr(storage, 'honey_moments'))),
    theater:      safe(() => readArr(storage, 'theater_scenes').concat(readArr(storage, 'theater_records'))),
    generic:      safe(() => readArr(storage, 'life_events_v1').map(e => ({ source: e.app || 'life', kind: e.type || 'note', title: e.title, body: e.summary, ts: e.createdAt, moodScore: TW.scoreMood((e.title||'')+' '+(e.summary||'')), weight: (e.importance||3) })))
      .concat(safe(() => readChatMetaArrays(ctx)).map(e => ({ source: e._src || 'chat', kind: 'note', title: e.title || e.summary || '', body: e.summary || e.content || '', ts: e.createdAt || e.ts, floor: e.floor, moodScore: TW.scoreMood((e.title||'')+' '+(e.summary||'')+(e.content||'')), weight: 1 })))
  };
  return raw;
}

/** 聚合 → 完整叙事模型（事件 + 时间线 + 里程碑 + 曲线 + 亲密度榜 + 信） */
export function buildNarrative(storage, opts = {}) {
  const raw = collectSources(storage);
  const events = TW.normalizeEvents(raw);
  // [v2.15.0] 跨项目观测：LonSha 召回自检（你最常回望的时光）。独立于生活事件，空时不影响 empty 判定。
  const recall = (opts.withRecall === false) ? null : collectLonshaRecall();
  // [v3.0.2] R2-C：注入面与召回面**并列**（各答一个问题，不互相顶替）。
  //   注：刻意**不**并入 empty 判定 —— 生活事件为空时注入读数仍可能有效，
  //   把它算进 empty 会让「有剧情侧观测、没生活碎片」被误报成「什么都没有」。
  const injection = (opts.withRecall === false) ? null : collectLonshaInjection(opts.win);
  // [v3.5.0] F-2：来源侧与上面两个并列（第三个问题：那件事是谁记的）。
  //   同样**不并入 empty 判定**：本机还没有生活碎片，不代表剧情侧没有来源构成可读。
  const eventPlatforms = (opts.withRecall === false) ? null : collectLonshaEventPlatforms(opts.win);
  // [v3.6.0] R1-E：出处侧与上面三个并列（第四个问题：这条承诺出自哪本账、哪一楼）。
  //   同样**不并入 empty 判定**：本机没有生活碎片，不代表上游九账里没有可查条目。
  const evidence = (opts.withRecall === false) ? null : collectLonshaEvidence(opts.win);
  // [v3.10.2 · G-4 余量] 时间侧与上面四个并列（第五个问题：这些事发生在哪一天）。
  //   同样**不并入 empty 判定**：本机没有生活碎片，不代表读不出当前剧情时刻；
  //   算进 empty 会让「有剧情侧时间读数、没生活碎片」被误报成「什么都没有」。
  const clockFace = (opts.withRecall === false) ? null : collectStoryClock(opts.win);
  /* [v3.20.0 · F8] 第六面：续玩简报（跨面收束）。
   *   ★ 取数分工（**如实写，不夸大**）：上面刚由 `collectLonshaEvidence` 取好的证据面
   *     直接传下去复用（**不再取第二次**）；`worldProg` 不在任何既有面里外供，
   *     故由收束器自己读一次快照取它 —— 净增**一次**读取，且明写在这里。
   *     （本仓纪律「同一轮不出现第二个取数点」针对的是**同一份口径被抄两处**；
   *      传递而不是重取，正是该纪律要求的做法。）
   *   与「生活碎片为空」的关系：简报**不并入** empty 判定 —— 本机没有生活碎片，
   *     不代表没有未完成的约定或可续的上游条目（与上面五面同一取舍）。 */
  const resume = (opts.withRecall === false) ? null : collectResumeBrief(storage, Object.assign({}, opts, {
    evidence,
    storyClock: clockFace
  }));
  if (!events.length) return { events: [], empty: true, recall, injection, eventPlatforms, evidence, storyClock: clockFace, resume };
  return {
    empty: false,
    events,
    recall,
    injection,
    eventPlatforms,
    evidence,
    storyClock: clockFace,
    resume,
    timeline: TW.buildTimeline(events, opts.bucket || 'day'),
    milestones: TW.detectMilestones(events),
    curve: TW.buildMoodCurve(events, opts.window || 5),
    board: TW.buildAffinityBoard(events),
    letter: TW.composeLetter(events, opts)
  };
}

export default { collectSources, buildNarrative };