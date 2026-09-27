#!/usr/bin/env node
/**
 * keys-audit.mjs — [v2.69.0] 会话键归属门禁（第六道门）
 *
 * 动机（为什么需要它）
 *   `config/storage.js` 的 `CHAT_DATA_PATTERNS` 决定每个 storage 键**落在哪里**：
 *   命中 → 当前会话的 chatMetadata（会话隔离）；不命中 → 全局 extensionSettings。
 *   判错的后果是本仓最贵的形态：**不报错、不崩溃、只错数据**。
 *     · 该隔离的漏配 → 换角色/换会话时数据串味（v2.8.10 事故：成就/抽卡/生理/塔罗互相污染）；
 *     · 不该隔离的误配 → 本该全局的设置跟着会话走，切角色后设置"莫名丢了"。
 *   而在此之前**没有任何地方能回答「这个键归谁、该不该隔离」**：旧的 `/^ruby_/` 兜底条
 *   把 12 个键一口吞下（归属不可知，v2.69.0 已收紧为逐键枚举），其余键散落在各处调用点。
 *
 * 判据（K1 / K2 / K3）
 *   K1（登记完整）真仓库里**每个** storage 键都必须在 `KEY_REGISTRY` 登记并声明 scope。
 *        登记不到的键 ⇒ 红灯（exit 1）。这条把「新增键」从「随手写」变成「必须回答归属」。
 *   K2（归类一致）登记声明的 scope 必须与 `CHAT_DATA_PATTERNS` 的**实际匹配结果**一致。
 *        不一致 ⇒ 红灯（exit 1）。本门禁的核心价值：把「意图」与「机制」钉在一起，
 *        任一侧改动而另一侧未跟上都会被抓住（改了正则忘了改登记，或反之）。
 *   K3（清单存活）`KEY_REGISTRY` 每条登记都必须**仍能在真仓库找到对应使用点**。
 *        零命中 ⇒ exit 2 拒判 —— 与 E10 / R2b / R3b 同族：白名单是准入闸，不是放行条。
 *
 * 关于 `legacy` 标记（历史误存键）
 *   实测有**刻意保留**的历史键：`apps/games/catbox/catbox-data.js` 的
 *   `LEGACY_STORAGE_KEY = 'games_catbox_state'`，作用是「读旧档 → 迁移到新键 → 删旧键」。
 *   迁移完成后该键在仓库里可能已**无写方**（只剩读+删）。这类键标记 `legacy: true`：
 *   K3 仍要求它活着（还有迁移读点），但它**不参与 K2**——它的 scope 由「当年」决定，
 *   是否命中当前 patterns 反映的是历史包袱；硬判会让人为了消红灯去改正则，
 *   反而丢掉旧档迁移能力。
 *
 * 用法
 *   node scripts/keys-audit.mjs              # 校验（npm run keys）
 *   node scripts/keys-audit.mjs --list       # 列出全部登记
 *   node scripts/keys-audit.mjs --root <dir> # 校验指定目录（负控制测试用）
 *   RP_KEYS_FIXTURE=1                        # 夹具模式：只放宽存活判定与最低计数闸
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const ROOT = rootArg >= 0 ? path.resolve(args[rootArg + 1]) : path.resolve(HERE, '..');
const LIST = args.includes('--list');
const FIXTURE_MODE = process.env.RP_KEYS_FIXTURE === '1';

const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

/* ---------- 证据面：键使用点抽取 ----------
 * 照搬 v2.68.0 的踩坑结论：只认 **storage 句柄**上的 set/get/remove。
 *   宽口径会把 Map/Set 的 `.get('active')`、组件 `.set('loading')` 当成 storage 键
 *   （实测宽口径 86 个"键"里 40 个是状态标记假阳性）。
 * 另收一类间接层：`this.storageKey = 'x'` / `const X_KEY = 'x'`（消费方读 this.storageKey）。
 *   踩坑：`const WORTH_KEY = 'worth'` 里的 `'worth'` 是 **JSON 字段名**（读 stock.worth），
 *   不是 storage 键。故 --list 会单列「仅由常量层引用的键」供人工复核，防同类混入。 */
const HANDLE = String.raw`(?:(?:window\.)?VirtualPhone(?:\?)?\.storage|phoneStorage|phone(?:\?)?\.storage|\bthis\.storage|\bthis\.app(?:\.phone)?(?:\?)?\.storage|\bapp(?:\.phone)?(?:\?)?\.storage|\bstorage)`;
const CALL_RE = new RegExp(HANDLE + String.raw`\??\.(?:set|get|remove)\??\.?\s*\(\s*['"\`]([A-Za-z_][A-Za-z0-9_]*)['"\`]`, 'g');
const CONST_RE = /(?:storageKey|\bconst KEY\b|\b[A-Z][A-Z0-9_]*_KEY|this\.KEY)\s*[:=]\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
/* 本地包装层（实测踩到，v2.69.0）：本仓为**可测性**普遍写作
 *     const get = (key, dflt = null) => { try { return storage?.get?.(key, dflt) ?? dflt; } catch { return dflt; } };
 *   之后同文件内用裸 `get('ruby_reading_books')` 读键（global-search-engine.js 的 buildDefaultSources）。
 *   只认 `storage.get(...)` 会漏掉这类键，把它们误报成「登记已失效」（实测：ruby_reading_books 即此形）。
 *   判据：同文件内出现 `=> ... storage?..get?.(key` 形态的包装器定义 ⇒ 该文件的裸 `get('lit')` 也算键面。
 *   刻意只认「参数名就是 key」且「体内确实调 storage.get」的定义，避免把普通 Map 包装误收。 */
const WRAPPER_DEF_RE = /=\s*\(?[\w\s,={}]*\)?\s*=>[\s\S]{0,300}?storage\??\.get\??\.\s*\(\s*key|function\s+get\s*\([\s\S]{0,300}?storage\??\.get\??\.\s*\(\s*key/;
const LOCAL_GET_RE = /\bget\s*\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
/* 间接属性键（v2.90.0 补）：本仓另有一类形态——
 *     this.key = 'life_events_v1';   // 构造期把键名存进实例属性
 *     this.storage?.get?.(this.key);  // 之后经 this.<prop> 间接读写
 *   旧抽取面只认字面量实参（'life_events_v1' 从不作为字面量出现），
 *   于是 life_events_v1 等 14 个键**从未进入登记面**：K1/K2/K3 对它全部失效。
 *   规则：同文件内出现 `this.<prop> = '<lit>'` 且存在 `storage…(this.<prop>` 调用时，
 *   把 <lit> 收编为该文件的 storage 键。刻意要求「同文件确有间接调用」——
 *   避免把只是赋值未使用、或仅作常量描述的字面量误收。 */
const PROP_ASSIGN_RE = /this\.([A-Za-z_$][\w$]*)\s*=\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
const PROP_CALL_RE = /(?:storage|VirtualPhone(?:\?)?\.storage)\??\.(?:set|get|remove)\??\.?\s*\(\s*this\.([A-Za-z_$][\w$]*)\b/g;
/* `worth` 例外（实测踩到）：`const WORTH_KEY = 'worth'` 里的 `'worth'` 是 **JSON 字段名**
 *   （asset-project.js 用它读 `stock.worth`），不是 storage 键，也没有任何 storage 调用点。
 *   它靠 `_KEY` 后缀形似键名，无法从语法上区分开同类命名；故显式排除并写明理由——
 *   这是本门禁**唯一**的口径例外，新增例外必须同规格写明「为什么它不是键」。 */
const NON_KEY_LITERALS = new Set(['worth', '__ubBackGuard']);
/* `__ubBackGuard`（v2.99.0 新增，实测踩到）：它是 **window 上的运行时状态槽名**，
 *   由 config/back-guard.js 写入 window[BACK_GUARD_KEY]，与 storage 无关
 *   （back-guard 不调 storage 的任何方法，全仓也无人把它当 storage 键读）。
 *   它命中 CONST_RE 是同形巧合：`const BACK_GUARD_KEY = '__ubBackGuard'` 长得像
 *   `XXX_KEY = '...'`（键常量）。故按 `worth` 的先例显式排除并写明理由 ——
 *   **它不是键**：没有 scope 可声明，登记进 KEY_REGISTRY 才是真的错（K3 会判它幽灵）。 */

const jsFiles = [];
(function walk(dir, base = '') {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (['.git', 'node_modules', 'tests'].includes(e.name) || e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, rel);
    else if (/\.js$/.test(e.name)) jsFiles.push({ rel, abs });
  }
})(ROOT);

const used = new Map(); // key -> Set('rel [kind]')
const bump = (k, rel, kind) => {
  if (!used.has(k)) used.set(k, new Set());
  used.get(k).add(`${rel} [${kind}]`);
};
for (const f of jsFiles) {
  /* 排除 scripts/：那里的键名是**描述**（本门禁的登记表、注释），不是**使用**。
   * 这正是 v2.68.0 踩到的「门禁自指伪证」形态（证据面混入非证据）。 */
  if (/^scripts\//.test(f.rel)) continue;
  let txt = '';
  try { txt = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
  for (const m of txt.matchAll(CALL_RE)) bump(m[1], f.rel, 'call');
  for (const m of txt.matchAll(CONST_RE)) {
    if (NON_KEY_LITERALS.has(m[1])) continue;
    bump(m[1], f.rel, 'const');
  }
  /* 间接属性键（v2.90.0）：先收集本文件经 this.<prop> 调 storage 的属性名，
   *   再收编同文件 `this.<prop> = '<lit>'` 的字面量。 */
  const propCalls = new Set([...txt.matchAll(PROP_CALL_RE)].map((m) => m[1]));
  if (propCalls.size > 0) {
    for (const m of txt.matchAll(PROP_ASSIGN_RE)) {
      if (!propCalls.has(m[1])) continue;
      if (NON_KEY_LITERALS.has(m[2])) continue;
      bump(m[2], f.rel, 'prop-key');
    }
  }
  /* 收编条件（v2.69.0 实测踩到歧义后收紧）：仅当该文件**恰有一处** `get` 包装器定义时才收编裸 get。
 *   反例（真仓库实测）：`index.js` 同时含 storage 包装器与音乐卡片标签解析器 `parseMusicCard`
 *   的局部 `const get = (tag) => [...matchAll(regex)]`；后者被裸 get 正则扫成 storage 键
 *   （`get('Char')` / `get('Media')` 等 7 个假键）。一处定义 = 无歧义；两处以上 = 放弃收编
 *   （宁可漏收、由 K1 在真仓库上暴露，也不引入假键）。 */
if (WRAPPER_DEF_RE.test(txt)) {
    const defs = (txt.match(/const\s+get\s*=|function\s+get\s*\(/g) || []).length;
    if (defs === 1) {
      for (const m of txt.matchAll(LOCAL_GET_RE)) {
        if (NON_KEY_LITERALS.has(m[1])) continue;
        bump(m[1], f.rel, 'local-get');
      }
    }
  }
}

/* ---------- 读 CHAT_DATA_PATTERNS 真值 ---------- */
const storageSrc = read('config/storage.js');
if (!storageSrc) {
  console.error(`[keys] ✗ 读不到 config/storage.js（root=${ROOT}）—— fail-closed 拒判`);
  process.exit(2);
}
const pStart = storageSrc.indexOf('CHAT_DATA_PATTERNS = [');
const pEnd = pStart >= 0 ? storageSrc.indexOf('\n        ];', pStart) : -1;
if (pStart < 0 || pEnd < 0) {
  console.error('[keys] ✗ 无法定位 CHAT_DATA_PATTERNS 数组边界（结构守卫）—— fail-closed 拒判');
  process.exit(2);
}
/* 抽取口径：行首缩进后的**第一个正则字面量**（到第一个未转义斜杠结束，之后可有行内注释）。
 *   踩坑：首版用 `/^\s*(\/\^[^\n]*?\/),?\s*$/` 要求行尾即闭合，49 条只认出 15 条
 *   （带行内注释的行全漏）——结构守卫当场拒判，救了一次假绿。 */
const patterns = [...storageSrc.slice(pStart, pEnd)
  .matchAll(/^[ \t]*(\/(?:\\.|[^/\\\n])+\/)/gm)].map((m) => m[1]);
if (!FIXTURE_MODE && patterns.length < 40) {
  console.error(`[keys] ✗ 只解析出 ${patterns.length} 条 CHAT_DATA_PATTERNS（低于下限 40），` +
    '解析器或数组结构已失效 —— fail-closed 拒判');
  process.exit(2);
}
const isChatByMechanism = (key) => patterns.some((p) => {
  const src = p.slice(1, p.lastIndexOf('/'));
  try { return new RegExp(src).test(key); } catch { return false; }
});

/* ---------- KEY_REGISTRY：键归属登记表 ----------
 * 字段：{ key, scope, note, legacy? }
 *   scope  'chat' 会话隔离 / 'global' 全局配置（须与 CHAT_DATA_PATTERNS 实际落点一致）
 *   legacy 历史误存键（读旧档→迁移→删）：不参与 K2，但仍须活着
 * ⚠️ 这是**准入清单**：新增键必须登记，否则 K1 红灯；K3 检查每条是否还活着。 */
const KEY_REGISTRY = [
  // ══ 会话隔离（chatMetadata）══
  { key: 'wechat_data', scope: 'chat', note: '微信主数据' },
  { key: 'wechat_contact_memory_v1', scope: 'chat', note: '微信联系人记忆' },
  { key: 'wechat_message_sound_enabled', scope: 'chat', note: '微信消息音开关' },
  { key: 'wechat_online_mode', scope: 'chat', note: '微信主动在线（非大厅上下文）' },
  { key: 'wechat_online_only_mode', scope: 'chat', note: '微信仅在线（非大厅上下文）' },
  { key: 'wechat_online_only_real_time_enabled', scope: 'chat', note: '实时回复（非大厅上下文）' },
  { key: 'wechat_online_proactive_enabled', scope: 'chat', note: '主动消息开关（非大厅上下文）' },
  { key: 'wechat_online_proactive_interval_minutes', scope: 'chat', note: '主动消息间隔（非大厅）' },
  { key: 'wechat_online_proactive_last_trigger_at', scope: 'chat', note: '主动消息上次触发' },
  { key: 'wechat_online_proactive_pending_at', scope: 'chat', note: '主动消息待触发时间' },
  { key: 'wechat_online_proactive_quiet_enabled', scope: 'chat', note: '免打扰开关（非大厅）' },
  { key: 'wechat_online_proactive_quiet_start', scope: 'chat', note: '免打扰开始' },
  { key: 'wechat_online_proactive_quiet_end', scope: 'chat', note: '免打扰结束' },
  { key: 'weibo_user_posts', scope: 'chat', note: '微博用户发帖' },
  { key: 'weibo_recommend_posts', scope: 'chat', note: '微博推荐流' },
  { key: 'weibo_hot_searches', scope: 'chat', note: '微博热搜' },
  { key: 'weibo_floor_settings', scope: 'chat', note: '微博楼层设置' },
  { key: 'weibo_auto_last_floor', scope: 'chat', note: '微博自动发帖游标' },
  { key: 'diary_entries', scope: 'chat', note: '日记条目（home-screen 只读消费）' },
  { key: 'diary_settings', scope: 'chat', note: '日记设置' },
  { key: 'diary_auto_settings', scope: 'chat', note: '日记自动织信设置' },
  { key: 'diary_auto_last_floor', scope: 'chat', note: '日记自动织信游标' },
  /* [v3.10.0 · G-3] 日记侧「此刻生效的设定」块开关。刻意用 `diary_` 前缀（会话级）：
   *   干跑取数是「此刻这个会话会触发哪些设定」，跨会话留存即变成旧读数。 */
  { key: 'diary_dryrun_enabled', scope: 'chat', note: '日记注入世界书干跑取数开关' },
  { key: 'calendar_auto_schedule_last_empty_date', scope: 'chat', note: '日历自动排程游标' },
  { key: 'calendar_memos', scope: 'chat', note: '日历备忘（经 global-search-engine 的 get 包装层读取）' },
  { key: 'calendar_commitments', scope: 'chat', note: '日历约定流程（确认/改期/完成/取消）' },
  // [v2.90.0] 以下 11 键此前经 `this.<prop> = 'lit' + storage.x(this.<prop>)` 形态使用，
  //   旧抽取面看不见它们（K1/K2/K3 失效）。keys-audit 补间接属性键面后强制登记：
  //   全部命中会话前缀（^calendar_ / ^life_events_ / ^weibo_ / ^music_）。
  { key: 'life_events_v1', scope: 'chat', note: '生活事件时间线（life-events.js）' },
  { key: 'calendar_holidays', scope: 'chat', note: '日历节假日表' },
  { key: 'calendar_holiday_defaults_version', scope: 'chat', note: '日历默认节假日版本' },
  { key: 'calendar_theme', scope: 'chat', note: '日历主题' },
  { key: 'calendar_reminder_enabled', scope: 'chat', note: '日历提醒开关' },
  { key: 'calendar_reminder_advance_minutes', scope: 'chat', note: '日历提醒提前分钟' },
  { key: 'calendar_auto_schedule_enabled', scope: 'chat', note: '日历自动排程开关' },
  { key: 'music_favorites', scope: 'chat', legacy: true, note: '音乐收藏（旧版按会话存储，读侧迁移到 global_music_favorites 后废弃）' },
  { key: 'weibo_profile', scope: 'chat', note: '微博个人资料' },
  { key: 'weibo_liked_recommend_posts', scope: 'chat', note: '微博点赞推荐流' },
  { key: 'weibo_liked_hot_search_index', scope: 'chat', note: '微博点赞热搜索引' },
  { key: 'sys_notifs', scope: 'chat', note: '系统通知落账（经包装层读取）' },
  { key: 'memory_core', scope: 'chat', note: '记忆核心（历史键名，与 memory_core_v1 并存）' },
  { key: 'music_playlist', scope: 'chat', note: '播放列表' },
  { key: 'music_card_data', scope: 'chat', note: '音乐卡片' },
  { key: 'music_playback_mode', scope: 'chat', note: '播放模式' },
  { key: 'music_repeat_one', scope: 'chat', note: '单曲循环' },
  { key: 'music_auto_play', scope: 'chat', note: '自动播放' },
  { key: 'music_show_floating', scope: 'chat', note: '悬浮窗开关' },
  { key: 'clock_settings', scope: 'chat', note: '时计设置' },
  { key: 'ledger_settings', scope: 'chat', note: '世界账本设置' },
  { key: 'jiwen_state', scope: 'chat', note: '积温引擎五轴状态' },
  { key: 'memory_awakening', scope: 'chat', note: '记忆觉醒状态' },
  { key: 'memory_core_v1', scope: 'chat', note: '记忆核心' },
  { key: 'memory_onboarded_v1', scope: 'chat', note: '记忆引导完成标记' },
  { key: 'phone_call_contacts', scope: 'chat', note: '通话联系人' },
  { key: 'phone_call_history', scope: 'chat', note: '通话记录' },
  { key: 'phone_call_sms_conversations', scope: 'chat', note: '短信会话' },
  { key: 'phone_call_sms_processed_batches', scope: 'chat', note: '短信批处理游标' },
  { key: 'tw_letters', scope: 'chat', note: '织光机收藏册' },
  { key: 'tw_last_auto', scope: 'chat', note: '织光机织信游标' },
  { key: 'sys_shell_scale', scope: 'chat', note: '显示缩放（表驱动 config/system-controls.js）' },
  { key: 'wangxiang_managed_tasks', scope: 'chat', note: '万象任务' },
  { key: 'wangxiang_generated_tasks', scope: 'chat', note: '万象生成任务' },
  { key: 'wangxiang_task_progress_history', scope: 'chat', note: '任务进度' },
  { key: 'wangxiang_marketplace_orders', scope: 'chat', note: '市场订单' },
  { key: 'wangxiang_marketplace_products', scope: 'chat', note: '市场商品' },
  { key: 'wangxiang_market_categories', scope: 'chat', note: '市场分类' },
  { key: 'wangxiang_inventory_items', scope: 'chat', note: '库存' },
  { key: 'wangxiang_delivery_addresses', scope: 'chat', note: '收货地址' },
  { key: 'wangxiang_credit_balance', scope: 'chat', note: '信用余额' },
  { key: 'wangxiang_points_daily_v1', scope: 'chat', note: '积分日表' },
  { key: 'wangxiang_points_ledger_v1', scope: 'chat', note: '积分流水' },
  { key: 'wangxiang_points_stats_v1', scope: 'chat', note: '积分统计' },
  { key: 'games_poker_user_chips', scope: 'chat', note: '扑克：筹码' },
  { key: 'games_poker_player_count', scope: 'chat', note: '扑克：人数' },
  { key: 'games_poker_chips_mode', scope: 'chat', note: '扑克：筹码模式' },
  { key: 'games_poker_selected_contact_ids', scope: 'chat', note: '扑克：参战联系人' },
  { key: 'games_2048_state', scope: 'chat', note: '2048（精确键）' },
  { key: 'games_sudoku_state', scope: 'chat', note: '数独' },
  { key: 'games_board_state', scope: 'chat', note: '五子棋/象棋/斗兽棋' },
  { key: 'games_undercover_state', scope: 'chat', note: '谁是卧底' },
  { key: 'chat_games_catbox_state', scope: 'chat', note: '猫箱（现役键）' },
  { key: 'chat_games_werewolf_state', scope: 'chat', note: '狼人杀（现役键）' },
  { key: 'chat_mofo_runtime_states', scope: 'chat', note: '神灯运行时状态' },
  { key: 'ruby_gacha_state', scope: 'chat', note: '幸运转盘（cheat/dirtytalk/memory 只读共享）' },
  { key: 'ruby_health_cycle', scope: 'chat', note: '生理周期' },
  { key: 'ruby_health_handoff', scope: 'chat', note: '生理状态交接账本（v2.70.0）' },
  { key: 'rubyTableUpdateReviewAnchor', scope: 'chat', note: '表格更新锚点（落后正文几楼的三态读数，v2.72.0）' },
  { key: 'ruby_playbook_state', scope: 'chat', note: '玩法剧本' },
  { key: 'ruby_tarot_history', scope: 'chat', note: '塔罗抽牌' },
  { key: 'ruby_unlocked_achievements', scope: 'chat', note: '成就解锁表' },
  { key: 'ruby_xhs_notes', scope: 'chat', note: '小红书笔记' },
  { key: 'ruby_tieba_posts', scope: 'chat', note: '贴吧帖子' },
  { key: 'ruby_reading_shelf', scope: 'chat', note: '阅读书架' },
  { key: 'ruby_reading_books', scope: 'chat', note: '阅读书架（历史键名，读侧回落）' },
  { key: 'ruby_reading_progress_*', scope: 'chat', note: '阅读进度（前缀型，按 bookId 拼接）' },
  { key: 'ruby_phone_lyrics_settings', scope: 'chat', note: '歌词/氛围设置' },
  { key: 'cheat_state_v1', scope: 'chat', note: '金手指装配清单' },
  { key: 'dt_state_v1', scope: 'chat', note: '撩语装配清单' },
  { key: 'asset_settings_v1', scope: 'chat', note: '资产 App 设置' },
  { key: 'place_settings_v1', scope: 'chat', note: '地点图景设置' },
  { key: 'profile_settings_v1', scope: 'chat', note: '档案设置' },
  { key: 'plotline_settings_v1', scope: 'chat', note: '剧情线设置' },
  { key: 'wallet_settings_v1', scope: 'chat', note: '钱袋设置' },
  { key: 'chars_settings_v1', scope: 'chat', note: '群像设置' },
  { key: 'bili_entries_v1', scope: 'chat', note: 'B站条目' },
  { key: 'theater_stories_v1', scope: 'chat', note: '小剧场' },
  /* [v3.15.0 · 计划 #52 + #53] 洞察 App。两键都刻意命中 `/^usage_/`（会话隔离）：
   *   统计的是「这个角色/这个会话里你怎么用手机」，落全局会让 B 角色读到 A 角色的记录。
   *   采集只写 stats，设置只写 settings —— 两类数据分开，避免「改设置顺手把读数一起写回去」。 */
  { key: 'usage_stats_v1', scope: 'chat', note: '使用统计（次数/时长/时段，不含任何内容）' },
  { key: 'usage_settings_v1', scope: 'chat', note: '洞察设置（注入开关 / 疏远阈值）' },
  { key: 'worldpulse_state_v1', scope: 'chat', note: '世界脉搏状态' },
  { key: 'worldpulse_history_v1', scope: 'chat', note: '世界脉搏历史' },
  { key: 'worldpulse_settings_v1', scope: 'chat', note: '世界脉搏设置' },
  { key: 'games_catbox_state', scope: 'chat', legacy: true, note: '猫箱 LEGACY：读旧档→迁移→删（迁移后无写方，刻意保留读点）' },
  { key: 'games_werewolf_state', scope: 'chat', legacy: true, note: '狼人杀 LEGACY：同 catbox 的迁移形态' },

  // ══ 全局配置（extensionSettings）══
  { key: 'phone_api_config', scope: 'global', note: 'API 配置' },
  { key: 'siliconflow_api_key', scope: 'global', note: 'SiliconFlow 密钥' },
  { key: 'global_alapi_token', scope: 'global', note: 'ALAPI Token' },
  { key: 'image_generation_model', scope: 'global', note: '生图模型' },
  { key: 'phone_memory_permissions', scope: 'global', note: '记忆注入权限' },
  { key: 'phone_images', scope: 'global', note: '图片库' },
  { key: 'phone_image_paths', scope: 'global', note: '图片路径索引' },
  { key: 'phone_album_upload_index', scope: 'global', note: '相册上传索引' },
  { key: 'phone_inline_reply_btn', scope: 'global', note: '行内回复按钮' },
  { key: 'phone_nai_queue_user_id', scope: 'global', note: 'NAI 队列用户标识' },
  { key: 'phone_wechat_alapi_sticker_cache_v1', scope: 'global', note: '表情贴纸缓存' },
  { key: 'phone_global_chat_css', scope: 'global', note: '全局聊天 CSS' },
  { key: 'phone_chat_css_profiles', scope: 'global', note: 'CSS 配置档' },
  { key: 'phone_chat_css_active_profile', scope: 'global', note: '当前 CSS 档' },
  { key: 'phone_lobby_wechat_online_mode', scope: 'global', note: '大厅分支：在线（与 wechat_online_mode 同源双键）' },
  { key: 'phone_lobby_wechat_online_only_mode', scope: 'global', note: '大厅分支：仅在线' },
  { key: 'phone_lobby_wechat_online_only_real_time_enabled', scope: 'global', note: '大厅分支：实时回复' },
  { key: 'phone_lobby_wechat_online_proactive_enabled', scope: 'global', note: '大厅分支：主动消息' },
  { key: 'phone_lobby_wechat_online_proactive_interval_minutes', scope: 'global', note: '大厅分支：主动间隔' },
  { key: 'phone_lobby_wechat_online_proactive_last_trigger_at', scope: 'global', note: '大厅分支：上次触发' },
  { key: 'phone_lobby_wechat_online_proactive_pending_at', scope: 'global', note: '大厅分支：待触发' },
  { key: 'phone_lobby_wechat_online_proactive_quiet_enabled', scope: 'global', note: '大厅分支：免打扰' },
  { key: 'phone_lobby_wechat_online_proactive_quiet_start', scope: 'global', note: '大厅分支：免打扰开始' },
  { key: 'phone_lobby_wechat_online_proactive_quiet_end', scope: 'global', note: '大厅分支：免打扰结束' },
  { key: 'global_diary_bg_cover', scope: 'global', note: '日记封面背景' },
  { key: 'global_diary_bg_global', scope: 'global', note: '日记全局背景' },
  { key: 'global_diary_bg_toc', scope: 'global', note: '日记目录背景' },
  { key: 'global_honey_bg_video', scope: 'global', note: '蜜语背景视频' },
  { key: 'global_weibo_beautify', scope: 'global', note: '微博美化开关' },
  { key: 'global_music_volume', scope: 'global', note: '音乐音量' },
  { key: 'global_music_floating_position', scope: 'global', note: '悬浮窗位置' },
  { key: 'global_wechat_chat_background', scope: 'global', note: '微信聊天背景' },
  { key: 'global_wechat_chatlist_background', scope: 'global', note: '微信列表背景' },
  { key: 'time_env_auto_inject_enabled', scope: 'global', note: '时间环境自动注入' },
  { key: 'games_poker_ai_prompt', scope: 'global', note: '扑克 AI 提示词模板' },
  { key: 'games_poker_ai_chat_enabled', scope: 'global', note: '扑克 AI 开关' },
  { key: 'games_undercover_ai_prompt', scope: 'global', note: '卧底 AI 提示词' },
  { key: 'games_undercover_prompt_presets_migrated', scope: 'global', note: '卧底预设迁移标记' },
  { key: 'games_werewolf_ai_prompt', scope: 'global', note: '狼人 AI 提示词' },
  { key: 'mofo_generators', scope: 'global', note: '神灯生成器配置' },
  { key: 'mofo_deleted_item_ids', scope: 'global', note: '神灯删除记录' },
  { key: 'lonsha_bridge_v1', scope: 'global', note: 'LonSha 桥配置' },
  { key: 'lonsha_memory', scope: 'global', note: 'LonSha 记忆（全局）' },
  { key: 'queue_state', scope: 'global', note: 'NAI 队列状态' },
  // [v2.90.0] 间接属性键面补登记：以下 3 键无会话前缀命中，按实际落点归全局。
  { key: 'global_music_favorites', scope: 'global', note: '音乐收藏（全局共享，跨会话）' },
  { key: 'global_social_store_v1', scope: 'global', note: '全局社交存档（跨会话）' },
  { key: 'phone_album_deleted_paths', scope: 'global', note: '相册已删路径记录（跨会话）' },
  { key: 'virtual_phone', scope: 'global', note: '旧版顶层容器键（storage.js 命名空间）' },
  // [v2.89.0] 存储层迁移账本：记录「哪些旧键已迁进新架构」，防重复搬运。
  //   键名不匹配任何 CHAT_DATA_PATTERNS → 默认落全局命名空间（isChatData=false）；
  //   写端会按 isChatData 选 store，但**键名归属**以 pattern 匹配为准，故登记 global。
  { key: '__migration_ledger', scope: 'global', note: '存储层迁移留痕账本（version+keys）' }
];

const matches = (entry, key) => entry.key.endsWith('*')
  ? key.startsWith(entry.key.slice(0, -1))
  : key === entry.key;

/* ---------- K1：真仓库每个键都已登记 ---------- */
const unregistered = FIXTURE_MODE ? [] : [...used.keys()]
  .filter((k) => !KEY_REGISTRY.some((e) => matches(e, k)))
  .sort();

/* ---------- K2：声明与机制一致（legacy 豁免）---------- */
const mismatched = FIXTURE_MODE ? [] : KEY_REGISTRY.filter((e) => !e.legacy).map((e) => {
  const probe = e.key.endsWith('*') ? e.key.slice(0, -1) + 'probe' : e.key;
  const actual = isChatByMechanism(probe) ? 'chat' : 'global';
  return actual === e.scope ? null : { key: e.key, declared: e.scope, actual };
}).filter(Boolean);

/* ---------- K3：登记条目存活自证 ---------- */
const deadRegistry = FIXTURE_MODE ? [] : KEY_REGISTRY.map((e) => {
  const alive = [...used.keys()].some((k) => matches(e, k));
  return alive ? null : e.key;
}).filter(Boolean);

/* ---------- 结构守卫 ---------- */
if (!FIXTURE_MODE && used.size < 40) {
  console.error(`[keys] ✗ 只抽到 ${used.size} 个 storage 键使用点（低于下限 40），` +
    '键面抽取器或调用口径已失效 —— fail-closed 拒判');
  process.exit(2);
}
if (!FIXTURE_MODE && KEY_REGISTRY.length < 60) {
  console.error(`[keys] ✗ KEY_REGISTRY 只有 ${KEY_REGISTRY.length} 条（低于下限 60）—— fail-closed 拒判`);
  process.exit(2);
}

const chatCount = KEY_REGISTRY.filter((e) => e.scope === 'chat' && !e.legacy).length;
const globCount = KEY_REGISTRY.filter((e) => e.scope === 'global').length;
const legacyCount = KEY_REGISTRY.filter((e) => e.legacy).length;
console.log(`[keys] storage 键使用点 ${used.size} 个 · CHAT_DATA_PATTERNS ${patterns.length} 条 · ` +
  `登记 ${KEY_REGISTRY.length} 条（会话隔离 ${chatCount} · 全局 ${globCount} · 历史键 ${legacyCount}）`);

if (LIST) {
  const show = (t, arr) => {
    console.log(`\n── ${t} ──`);
    for (const e of arr) console.log(`  ${e.key}  // ${e.note}`);
  };
  show('会话隔离', KEY_REGISTRY.filter((x) => x.scope === 'chat' && !x.legacy));
  show('历史误存键（legacy，不参与 K2）', KEY_REGISTRY.filter((x) => x.legacy));
  show('全局配置', KEY_REGISTRY.filter((x) => x.scope === 'global'));
  const ind = [...used.keys()].filter((k) => [...used.get(k)].every((s) => s.includes('[const]')));
  show('仅由常量层引用的键（人工复核，防 JSON 字段名混入）',
    ind.sort().map((k) => ({ key: k, note: [...used.get(k)].join(' | ') })));
  console.log('\n── 未登记（K1 红灯项）──');
  console.log(unregistered.length ? unregistered.map((k) => '  ' + k).join('\n') : '  （无）');
}

let fail = 0;
if (unregistered.length) {
  fail = 1;
  console.error(`[keys] ✗ K1 有 ${unregistered.length} 个 storage 键未登记归属：`);
  for (const k of unregistered) console.error(`    ${k}`);
  console.error('  修法：在 scripts/keys-audit.mjs 的 KEY_REGISTRY 登记并声明 scope。' +
    '该隔离漏配 → 换会话串味；不该隔离误配 → 设置跟着会话走。二者都不报错，只错数据。');
}
if (mismatched.length) {
  fail = 1;
  console.error(`[keys] ✗ K2 有 ${mismatched.length} 条登记与 CHAT_DATA_PATTERNS 实际匹配不符：`);
  for (const m of mismatched) console.error(`    ${m.key}  声明=${m.declared}  实际=${m.actual}`);
  console.error('  修法二选一：① 改 CHAT_DATA_PATTERNS 与意图一致；② 改登记声明。' +
    '两者分歧本身就是缺陷——一个说该隔离、一个不隔离，数据落点无人知道。');
}
if (deadRegistry.length) {
  console.error(`[keys] ✗ K3 有 ${deadRegistry.length} 条登记已失效（真仓库零命中，` +
    '它不再放行任何东西 ⇒ 幽灵放行条）—— fail-closed 拒判：');
  for (const k of deadRegistry) console.error(`    ${k}`);
  console.error('  修法：该键确已废弃 ⇒ 删掉这条登记；否则说明键被改名而登记未跟上。');
  process.exit(2);
}
if (fail) process.exit(1);
console.log('[keys] ✓ 键归属全登记 / 声明与机制一致 / 登记条目全部存活');