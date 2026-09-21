/* ========================================================
 * asset-store.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-store.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】./asset-keys.js、./asset-library.js
 * 【上游定位】asset-store.js
 * ======================================================== */
'use strict';

import __assetDep0 from './asset-keys.js';
import __assetDep1 from './asset-library.js';

const __REQ = {
    './asset-keys.js': () => __assetDep0,
    './asset-library.js': () => __assetDep1,
};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/modules/asset/asset-store.js */
'use strict';

// ============================================================================
// 资产模块 · 存储（唯一读写门）
// ----------------------------------------------------------------------------
// 照 docs/机制库.md「一个聊天变量键 = 一个 store（唯一读写门）」：
//   ① 只导出语义化方法，不导出裸读写；
//   ② 工厂函数收 { host } → 纯 Node 可测；
//   ③ 浏览器里挂一份默认实例 + 工厂，其他模块惰性取；
//   ④ 归一化/校验集中在 store，别在调用方各写一遍；
//   ⑤ 写失败返回 false + lastError()。
//
// 键（§3.4）：
//   __la_asset_config_v1   ← 本聊天分支的启用状态（§3.7）
//   __la_asset_ledger_v1   ← 角色账本（实例 + 流水）
//   __la_asset_market_v1   ← 行情状态（批次 G）
//   __la_asset_extract_v1  ← 提取结果待人工确认池 + 层号标记（批次 F）
//   __la_asset_snapshots_v1← 快照
//   __la_asset_projection_v1 ← 投影三级闸门（批次 D2：总开关 / 逐角色 / 逐字段）
//
// ⚠️ 投影闸门**为什么不并进 `__la_asset_config_v1`**（D2 自定裁定）：那一份的
//   `normalizeConfig` 是**三格白名单**（onboarded / onboardedAt / enabledCategories），
//   多出来的第四格会被**静默剥掉**（面板按"改了"重绘、盘上却没变 —— 读了又变）。
//   往那份白名单里加格 = 碰 §3.7 的两条铁律（键缺失 = 未开启 / onboarded 只置位），
//   代价与收益不对称。所以投影状态**单开一个键**：一份状态一个门，谁也不动谁。
//   形状：`{ enabled: bool, off: string[], hiddenByCat: { <类目 id>: string[] } }`
//   （判据全在 `asset.script.js` 的 `readProjection` / `asset-project.js` 的 `hiddenByCatOf`，
//   本层只负责**原样存取**—— 不在 store 里再判一次语义，那会变成第二份口径）。
//
// ⚠️ §3.7 两条铁律（批次 B~J 的四处消费者都靠它们，改这里等于改全局）：
//   铁律 ①「未开启」= **键缺失**，不是「键存在但字段为假」—— 否则"从没点过开始"与
//          "点过开始但把分类全清了"分不开，引导屏会在用户清空分类之后又弹出来。
//   铁律 ② `onboarded` **只置位、永不由 UI 重置** —— 想彻底关掉走"清空全部资产数据"。
//   ②的判据 `onboarded===true && enabledCategories.length>0` **只在这个文件里算一次**，
//   由 `isEnabled()` 作为唯一出口（面板渲染 / 投影 / 提取 / 结算四处都读它）。
//
// ⚠️ 0.7.52 复查补的三条（都是"降级读 + 盲写 = 静默毁表"这一类，照 medical-store 的
//   `chatBag` L43~64 同一模式：**宁可这一轮全失败，不静默毁表**）：
//   A. `raw()` **索引之前**先认异步宿主：`getVariables` 抛错或回 thenable → 当读不到。
//      否则 `writeConfig` 推出来的 cur 恒是"未开启"的默认形状，只置位的闸门形同虚设，
//      一次 `{ onboarded: false }` 就把存好的 true 抹掉、引导屏复活（存的是同一个键）。
//   B. 读不可信**且**这次合并会让 onboarded 落回假 → `writeConfig` 拒绝写（false + 理由）。
//   C. 键缺失时**只有 patch 明确 onboarded===true 才建键**：§3.7 要求关掉引导屏什么都不写，
//      `{ enabledCategories: [...] }` 这种补丁不能把 `hasConfig()` 从假翻成真（翻了就再也不引导）。
// ============================================================================

const KEY_CONFIG = '__la_asset_config_v1';
const KEY_LEDGER = '__la_asset_ledger_v1';
const KEY_MARKET = '__la_asset_market_v1';
const KEY_EXTRACT = '__la_asset_extract_v1';
const KEY_SNAPSHOTS = '__la_asset_snapshots_v1';
const KEY_PROJECTION = '__la_asset_projection_v1';

// 键写入原语（`asset-keys.js`，批次 G2 第 2 轮提成共享原语）：取法与 core / ledger 同一形状
// （Node `require` / 浏览器 `window.parent` 上的全局）。
// ⚠️ **G2AB 收口轮追加（报告 §11 发现 2）**：本文件从前**没有**这一份，而下面 `write()` 的
//    兜底分支里有一句 `Object.assign({}, current || {}, { [key]: value })` —— 危险在**源**：
//    宿主变量表里若有一个**自有 `__proto__`** 键（别的模块写的），`Object.assign` 对源上每个
//    own 键走一次 `[[Set]]` ⇒ 新表的原型被写成那一格的值，**而那个自有 `__proto__` 键
//    在拷贝这一步就被吞掉了**（`Object.keys(next)` 少一格）。
// ★★ **G2AB-fix3（复审 Important-2）——机制与后果按实测更正，原文写反了**：
//    原文写的是"**本次要写的那一格被挤掉** ⇒ `writeConfig` 回 true 而 config 一个字节都没落
//    ⇒ `hasConfig()` 恒 false ⇒ 引导屏永远不再弹"。**实测不是这样**（复审用**会真写回**的
//    忠实宿主复现；原那支证据探针的宿主**只 log、从不写回** ⇒ 它的读数不可信）：
//      · **资产的配置那一格照旧落盘**：计算键是 `KEY_*` 常量、**不是** `__proto__` ⇒ 它是
//        `CreateDataProperty`、不是 `[[Set]]`；实测改前 `writeConfig=true` / `lastError=""` /
//        `hasConfig=true` / `isEnabled=true` ⇒ **配置确实在**。
//      · 真正丢的是**别人那一格**：那个自有 `__proto__` 键被吞 ⇒ 宿主整表替换之后
//        **它在宿主表里消失了**（实测改前 `自有__proto__还在=false`）。⇒ 后果是
//        **丢别人的数据（原型污染 + 吞键）**，**不是**"自己的配置静默丢失"。
//    ⇒ 逐格 `setKey` 拷进新桶：自有 `__proto__` 走 `Object.defineProperty` 造**自有可枚举格**、
//      **原型的归属一位不动**，那一格也照旧活着。
// ⚠️ **不许在顶层抛**（几十个模块拼在同一个脚本里）：取不到时退成一份**形状完全相同**的
//    内联实现（与 core / ledger 同一口径 —— 两条路写的是同一件事）。
const KEYS = (function resolveKeys() {
  try {
    if (typeof module !== 'undefined' && module.exports) return require('./asset-keys.js');
  } catch (e) { /* 浏览器/裁剪产物里没有 require —— 落到下面 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    if (rt.__LA_ASSET_KEYS__) return rt.__LA_ASSET_KEYS__;
  }
  return null;
})();
// ★★ H2（0.7.66）· §5.1 第三层（本聊天分支覆盖）的**键名**：归 `asset-library.js`
//    （三层合并的唯一出处，`KEY_MARKET_OVERRIDE_CHAT`），本文件只是存储门 —— 所以**惰性取**，
//    不在这里再抄一份字面量（抄一份 = 键名一改就分家，而且是**静默**分家：读恒空、写恒落空）。
//    取不到 ⇒ 回空串（调用方拒绝写、读回 null）。
function marketOverrideKey() {
  try {
    if (typeof module !== 'undefined' && module.exports) {
      const L = require('./asset-library.js');
      if (L && L.KEY_MARKET_OVERRIDE_CHAT) return String(L.KEY_MARKET_OVERRIDE_CHAT);
    }
  } catch (e) { /* 裁剪产物 / 浏览器 bundle 里没有 require 这条路 */ }
  if (typeof window !== 'undefined') {
    const rt = window.parent || window;
    const L = rt && rt.__LA_ASSET_LIBRARY__;
    if (L && L.KEY_MARKET_OVERRIDE_CHAT) return String(L.KEY_MARKET_OVERRIDE_CHAT);
  }
  return '';
}

const setKey = (KEYS && typeof KEYS.setKey === 'function') ? KEYS.setKey
  : function (o, k, v) {
    if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
    else o[k] = v;
    return o;
  };

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v : []; }

function normalizeConfig(raw) {
  const c = isObj(raw) ? raw : {};
  return {
    onboarded: c.onboarded === true,
    onboardedAt: str(c.onboardedAt),
    enabledCategories: arr(c.enabledCategories).map(str).filter(Boolean),
  };
}
function normalizeLedger(raw) {
  const l = isObj(raw) ? raw : {};
  const actors = isObj(l.actors) ? l.actors : {};
  // ⚠️ **`Object.create(null)`**：键是 **actor 键（人名）**，用户可以把角色叫 `__proto__`。
  //    取 `{}` 时 `out['__proto__'] = bucket` 是**改原型**而不是加一格 ⇒ 实测
  //    `readLedger().actors` 的 keys 只剩别的角色，那位角色**静默消失**（再写回一次仍然没有
  //    —— 写盘这条路也要过本函数 ⇒ 一次穿透就永久丢）。下游只读 `Object.keys` / 下标 / `hasOwnProperty.call`。
  const out = Object.create(null);
  for (const [k, v] of Object.entries(actors)) {
    out[k] = { entries: arr(v && v.entries), flows: arr(v && v.flows) };
  }
  return { actors: out };
}

function createAssetStore(opts = {}) {
  const host = opts.host || {};
  let lastError = '';

  // ⚠️ 只读：键**缺失**返回 undefined（不是默认对象）—— "未开启"必须能与"开启了但空"区分开
  //
  // 读失败的两条路都必须留下**同一种**痕迹（白名单里的 `sawReadFail`）：`getVariables` 抛错，
  // 以及它回了 thenable（宿主某版本改成异步返回时，索引 `vars[key]` 只会得到 undefined，
  // 既不报错也没有任何标志 —— 这正是"降级读"最危险的那种静默）。一旦看到过，就说明
  // 本实例的读**不可信**，写 config 时按"读不到"保守处理。
  let sawReadFail = false;
  function raw(key) {
    sawReadFail = false;
    try {
      if (typeof host.getVariables !== 'function') { sawReadFail = true; return undefined; }
      const vars = host.getVariables({ type: 'chat' }) || {};
      if (typeof vars.then === 'function') {          // ★ 索引之前先认 thenable
        sawReadFail = true;
        lastError = 'read fail: async host (getVariables returned a thenable): ' + key;
        return undefined;
      }
      if (!isObj(vars)) { sawReadFail = true; return undefined; }
      return vars[key];
    } catch (e) { sawReadFail = true; lastError = 'read fail: ' + (e && e.message); return undefined; }
  }
  function write(key, value) {
    try {
      if (typeof host.insertOrAssignVariables === 'function') {
        const ok = host.insertOrAssignVariables({ [key]: value }, { type: 'chat' });
        if (ok === false) { lastError = 'write rejected: ' + key; return false; }
        return true;
      }
      if (typeof host.updateVariablesWith === 'function') {
        // ⚠️★ **G2AB 收口轮追加（报告 §11 发现 2）**：不许 `Object.assign({}, current || {}, …)` ——
        //    `current` 里若有一个**自有 `__proto__`** 键，`Object.assign` 会在拷贝那一步把它
        //    `[[Set]]` 到新靶子上 ⇒ **新表的原型被改写**、**那一格被吞**（`Object.keys` 少一格），
        //    而本函数照旧返回 true。
        //    ★★ **G2AB-fix3（复审 Important-2）更正**：原文接着说"本次要写的那一格被挤掉 ⇒
        //      `hasConfig()` 恒 false ⇒ 引导屏永远不再弹"——**实测不是这样**（原证据探针的宿主
        //      只 log 不写回，读数不可信）：**配置那一格照旧落盘**（计算键是常量、不走 `[[Set]]`），
        //      丢的是**别人那一格**、后果是**原型污染 + 丢别人的键**。
        //      实测（宿主的变量表里另有一个自有 `__proto__`、且宿主只有这一条写路）：
        //        updateVariablesWith 收到的表 own keys `["other_key","__la_asset_config_v1"]`、
        //        proto `{"evilV":1}`；`writeConfig` 回 `true`、`lastError()` 为空、
        //        **`hasConfig()` 也是 true**（所以它**区分不出来**这件事）；经忠实宿主整表替换后
        //        **`自有__proto__还在=false`** ⇒ 别人的键没了。
        //    ⇒ 逐格 `setKey` 拷进新桶、再 `setKey` 盖上本次那一格（原型一位不动、别人的键照旧在）。
        //    ★ 回调**照旧收 `current`**（那是宿主的约定，有些宿主会传它们自己当下的那一份）——
        //      只是不再把 `current` 交给 `Object.assign`。
        host.updateVariablesWith(current => {
          const next = {};
          if (isObj(current)) for (const k of Object.keys(current)) setKey(next, k, current[k]);
          setKey(next, key, value);
          return next;
        }, { type: 'chat' });
        return true;
      }
      lastError = 'no writer: ' + key;
      return false;
    } catch (e) { lastError = 'write fail: ' + (e && e.message); return false; }
  }

  // 读一次 config，并把"这次读可不可信""键在不在"一起交出来（`writeConfig` 的闸门判据）
  function readConfigOnce() {
    const rawConfig = raw(KEY_CONFIG);
    const readable = !sawReadFail;
    return {
      cur: normalizeConfig(rawConfig),
      // 键缺失本身不算"读坏"（区分开，报错文案才说得清是哪一种）
      keyPresent: readable && rawConfig !== undefined,
      // ★ 不可信有两种：读坏了，或键压根不在 —— 两种都不许凭默认形状去推导"该写什么"
      unreliable: !readable || rawConfig === undefined,
    };
  }

  return {
    KEY_CONFIG, KEY_LEDGER, KEY_MARKET, KEY_EXTRACT, KEY_SNAPSHOTS, KEY_PROJECTION,
    hasConfig() { return raw(KEY_CONFIG) !== undefined; },          // ★ 键缺失 = 没点过开始
    readConfig() { return normalizeConfig(raw(KEY_CONFIG)); },
    writeConfig(patch) {
      const p = isObj(patch) ? patch : {};
      const { cur, keyPresent, unreliable } = readConfigOnce();
      const next = normalizeConfig(Object.assign({}, cur, p));
      // ★ onboarded 只置位：调用方想写回 false 时**拒绝**（想彻底关掉走"清空全部资产数据"）
      if (cur.onboarded === true && next.onboarded !== true) { next.onboarded = true; }
      // ★ B/C：读不可信（读坏了）或键缺失时，只有 patch **明确**把 onboarded 置真才允许落盘。
      //   「读坏了」时连"存着一条 true"都无从得知，而要被覆盖的正是那个键 → 保守拒绝；
      //   「键缺失」时按 §3.7 什么都不写（写下去会把 hasConfig() 翻真、引导屏永不再弹）。
      if (unreliable && p.onboarded !== true) {
        lastError = (keyPresent ? 'unreliable read' : 'key absent')
          + ', refuse write: ' + KEY_CONFIG + ' (patch does not set onboarded===true)';
        return false;
      }
      return write(KEY_CONFIG, next);
    },
    // ★ enabled 判据**唯一出口**（§3.7）：面板渲染 / 投影 / 提取 / 结算四处都读它
    isEnabled() {
      const c = this.readConfig();
      return c.onboarded === true && c.enabledCategories.length > 0;
    },
    readLedger() { return normalizeLedger(raw(KEY_LEDGER)); },
    writeLedger(next) { return write(KEY_LEDGER, normalizeLedger(next)); },
    // 键缺失 → null / 默认形状（市场与提取池各有一个"没有"的语义，别混成空对象）
    readMarket() { const v = raw(KEY_MARKET); return isObj(v) ? v : null; },
    writeMarket(next) { return write(KEY_MARKET, next); },
    // ---- ★★ H2（0.7.66）· §5.1 三层覆盖里的**第三层**（本聊天分支覆盖）----
    // 它是「一键提升为新标的」与「记进别名」的**落点**（§5.1 末条：用户改名 / 增删落在覆盖层；
    //   第三层 = **仅本聊天分支生效**，第一层基础表一个字节都不动）。
    // ⚠️ **键名不在本文件再抄一份**：它归 `asset-library.js`（三层合并的唯一出处）；
    //    本文件只是**存储门**，所以这里是**惰性取**（照 `asset-keys.js` 那一支）：
    //    · 单测：`require('./asset-library.js')`；
    //    · 真机：bundle 全局 `__LA_ASSET_LIBRARY__`（构建清单里它排在 store **之前**，
    //      惰性取让"加载顺序"这件事根本不成前提）。
    //    取不到 ⇒ 读回 `null` / 写回 `false`（**拒绝写**：宁可动作不生效，也不写到一个自己
    //    猜出来的键上 —— 那会造出第二份覆盖口径，而三层合并只认这一层）。
    readMarketOverride() {
      const k = marketOverrideKey();
      if (!k) return null;
      const v = raw(k);
      return (isObj(v) || Array.isArray(v)) ? v : null;      // 键缺失 / 坏形状 ⇒ null（这一层没表态）
    },
    writeMarketOverride(next) {
      const k = marketOverrideKey();
      if (!k) { lastError = 'refuse write: no market override key (asset-library 没挂上)'; return false; }
      if (!isObj(next) && !Array.isArray(next)) { lastError = 'refuse write: bad override shape'; return false; }
      return write(k, next);
    },
    readExtract() { const v = raw(KEY_EXTRACT); return isObj(v) ? v : { pool: [], floors: [] }; },
    writeExtract(next) { return write(KEY_EXTRACT, next); },
    readSnapshots() { return arr(raw(KEY_SNAPSHOTS)); },
    writeSnapshots(next) { return write(KEY_SNAPSHOTS, arr(next)); },
    // ---- 投影三级闸门（D2）----
    // ⚠️ **原样存取、不在这里归一化**：闸门的语义判据在 `asset.script.js` 的 `readProjection`
    //    （面板那一侧）与 `asset-project.js` 的 `hiddenByCatOf`（渲染那一侧），
    //    本层再判一次就是第三份口径。键缺失 → `null`（"从没设过"必须能与"设成全关"分开：
    //    前者是默认（总开关关 = 不投影），后者是用户明确关过）。
    readProjection() { const v = raw(KEY_PROJECTION); return isObj(v) ? v : null; },
    writeProjection(next) { return write(KEY_PROJECTION, isObj(next) ? next : {}); },
    lastError() { return lastError; },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createAssetStore, KEY_CONFIG, KEY_LEDGER, KEY_MARKET, KEY_EXTRACT, KEY_SNAPSHOTS, KEY_PROJECTION };
if (typeof window !== 'undefined') {
  const rt = (window.parent || window);
  rt.__LA_ASSET_STORE_FACTORY__ = { createAssetStore };
  if (!rt.__LA_ASSET_STORE__) {
    // ★ 别名两个都认：全仓宿主 API 的取法是 `TavernHelper || TavernHelper_API_ACU`
    //   （medical-store L43/L78、physio body-store L59）。只认前者的话，在只挂别名的真机上
    //   读恒空、写恒 false —— 模块的唯一闸门是死的，而单测 require 源码不碰这段，套件照样绿。
    const helper = () => rt.TavernHelper || rt.TavernHelper_API_ACU || null;
    rt.__LA_ASSET_STORE__ = createAssetStore({
      host: {
        getVariables: o => { const h = helper(); return h && h.getVariables ? h.getVariables(o) : {}; },
        insertOrAssignVariables: (p, o) => { const h = helper(); return h && h.insertOrAssignVariables ? h.insertOrAssignVariables(p, o) : false; },
        updateVariablesWith: (f, o) => { const h = helper(); return h && h.updateVariablesWith ? h.updateVariablesWith(f, o) : false; },
      },
    });
  }
}

})();

  return module.exports;
})();
