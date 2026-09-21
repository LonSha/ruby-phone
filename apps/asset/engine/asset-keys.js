/* ========================================================
 * asset-keys.js — 资产引擎（移植自 LA-0.7.68 拓展版 src/asset-keys.js）
 *
 * 【移植纪律：零转录】
 *   本文件的正文**逐字**来自上游源文件，包含它原有的 `(function(){ ... })();` 外壳。
 *   外壳之内一个字都没有改写 —— 只在外层套了三个自由变量的兼容层：
 *     · `module`  → 让上游末尾的 `module.exports = api` 照常执行，工厂再把它交出来；
 *     · `require` → 按 __REQ 映射表返回静态 import 进来的依赖模块（上游是惰性取）；
 *     · `window`  → 置为 undefined，屏蔽上游的浏览器全局挂载分支（不污染宿主 window.parent）。
 *   因此本模块的导出面与上游**逐字等价**，无需重读逻辑即可信任。
 *
 * 【依赖】无（纯函数层）
 * 【上游定位】asset-keys.js
 * ======================================================== */
'use strict';

const __REQ = {};

export default (function () {
  const module = { exports: {} };
  const window = undefined;
  const require = function (p) {
    const f = __REQ[p];
    if (typeof f !== 'function') throw new Error('[asset-engine] unmapped require: ' + p);
    return f();
  };

(function(){
/* src/modules/asset/asset-keys.js */
'use strict';

// ============================================================================
// 资产模块 · 键写入原语（批次 G2 第 2 轮 · 同族清账）
// ----------------------------------------------------------------------------
// 本文件只做一件事：把"**用户可控字符串当键**"的写入收敛成**唯一一份**。
//
// 为什么必须有它（不是抽象洁癖）：
//   `o[k] = v` 里 `k` 可以是任意 JSON 键。当 `k` 恰好是 `'__proto__'` 时，
//   裸 `{}` 上这句**不是加一格而是改写原型** —— `Object.keys` 当场少一格，
//   而那一格的值**静默落到了原型上**：读一遍再写一遍就永久丢了。
//   模块里原先有两处各写了一份同样的特判（行情层 / 账本层的 `flatten`），
//   本轮又要往 core / ledger / 面板再加几处 ⇒ 再抄几份必然有一天只改其中一份。
//   ⇒ 按本模块既有纪律（通用小工具住在最低层、只留那一份）提成这一份。
//
// ⚠️ **本文件自己踩得到两条扫描面**（新文件自动落进去，没有例外）：
//   · `test/asset-terms.test.js` ③（反硬编码）：面板结构词的字面量只许留在 `asset-terms.js`；
//   · `test/asset-panel.test.js` E2（剥注释后）：`src/modules/asset/` 下每个源文件
//     都不许出现那四个字。⇒ 本文件连注释里都避开这两组词。
//
// 挂载点与同族一致：Node 走 `require('./asset-keys.js')`，真机走
// `window.parent.__LA_ASSET_KEYS__`（每个源文件各一个作用域，没有别的通道）。
// ⚠️ `scripts/build-artifact.js` 的 `sources` 里本文件**排在资产块最前面**
//    （`asset-library.js` 之前）—— 所以它**不能**依赖任何资产源文件，
//    而任何资产源文件都可以在调用时刻取到它。
// ============================================================================

// 键是用户数据时的**唯一**写入原语：只特判 `__proto__`（造一个**自有可枚举**格），
// 其余键照常赋值 ⇒ **原型一位不动**（这一点是关键：产物经常要拿 `deepStrictEqual`
// 与**手写的普通对象字面量**逐字对拍，本仓测试用的是 `node:assert/strict`）。
// ⚠️ 反面口径：`Object.create(null)` 也防穿透，但它**换掉了原型** —— 只适合
//    "这一个对象只被自己读 / 写，或者消费方只有 `Object.keys` / 下标 / 鸭子类型判定"
//    的那些位置。要用 null 原型的，**当场直接写 `Object.create(null)`**：那本来就是语言内建，
//    包一层 helper 只是"没人用的灵活性"（G2AB 收口轮把这里那个 helper 删了：
//    全仓 0 个调用点、0 条针脚 —— 复审 §3.5 的 M2 变异存活，是本轮唯一的真盲点）。
function setKey(o, k, v) {
  if (k === '__proto__') {
    Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  } else {
    o[k] = v;
  }
  return o;
}

const api = { setKey };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') {
  const rt = window.parent || window;
  rt.__LA_ASSET_KEYS__ = api;
}

})();

  return module.exports;
})();
