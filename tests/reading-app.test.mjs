// 阅读 App 渲染 + 导入冒烟测试
class MockEl {
  constructor() { this.innerHTML = ''; this.listeners = {}; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}
class MockScreen extends MockEl {}
class MockStorage {
  constructor() { this.d = {}; }
  get(k) { return this.d[k] ?? null; }
  set(k, v) { this.d[k] = v; }
  remove(k) { delete this.d[k]; }
}
const mock = {
  phoneShell: {
    screen: new MockScreen(),
    showNotification() {},
    /* [v3.61.0 · O1] 视图改走 setContent（唯一内容入口），夹具必须跟上新接口：
     *   缺它则 render 当场抛「setContent is not a function」，后续断言全不跑。 */
    setContent(html) { this.screen.innerHTML = html; },
  },
  storage: new MockStorage(),
};
global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
global.toastr = { info() {}, error() {} };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.document = { querySelector: () => null, querySelectorAll: () => [], createElement: () => new MockEl() };
global.FileReader = class {
  constructor() { this.onload = null; this.onerror = null; }
  readAsArrayBuffer(file) { this.onload?.({ target: { result: file.buffer } }); }
};
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
}

try {
  const { ReadingApp } = await import('../apps/reading/reading-app.js');
  const app = new ReadingApp(mock.phoneShell, mock.storage);
  assert('ReadingApp 实例化', app instanceof ReadingApp);
  assert('有 render 方法', typeof app.render === 'function');

  app.render();
  assert('render 不抛错', true);
  assert('书架渲染为 shelf', app.view.currentBook === null);

  // 模拟导入一个 UTF-8 TXT 文件
  const text = '第一章 初遇\n\n她站在门口，手里拿着伞。\n\n第二章 雨中\n\n雨下了整夜。';
  const buffer = new TextEncoder().encode('\uFEFF' + text).buffer;
  /* [第三期 R3-X8] 导入接口**如实返回 Promise**（附件层 relink/落盘是异步的）。
   *   旧夹具点完立刻断言，在「回调改 async」之后必然读到 null —— 那是夹具跟不上
   *   接口，不是导入坏了。这里改为 await 真句柄，并把「返回可等待句柄」本身
   *   立成判据：接口再退化成返回 undefined 时本行立刻转红。 */
  const p = app.importFile({ name: '雨中故事.txt', buffer });
  assert('importFile 返回可等待句柄(不许把异步藏起来)', !!p && typeof p.then === 'function');
  const imported = await p;
  assert('导入后进入阅读态', app.view.currentBook !== null);
  assert('导入句柄解析出同一本书', !!imported && imported.id === app.view.currentBook.id);
  assert('导入章节=2', app.view.currentBook.chapters.length === 2);
  assert('书名解析正确', app.view.currentBook.title === '雨中故事');

  // 打开书架
  const bookId = app.data.getBooks()[0].id;
  const opened = await app.openBook(bookId);
  assert('openBook 能打开', opened === true && app.view.currentBook !== null && app.view.currentBook.id === bookId);
  app.render();
  assert('阅读态 render 不抛错', true);

  console.log(`\n${pass} 通过, ${fail} 失败`);
} catch (e) {
  console.log('✗ 异常:', e.message);
  fail++;
  console.log(`\n${pass} 通过, ${fail} 失败`);
}
process.exit(fail > 0 ? 1 : 0);