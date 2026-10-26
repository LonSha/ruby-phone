import io

p = 'tests/system-v4130.test.mjs'
with io.open(p, 'r', encoding='utf-8') as f:
    s = f.read()

# 替换 C1
old_c1 = """test('C1 宿主侧:`locateChatFloor` 真实现,且按**契约常量**挂载(不手写字面量)', () => {
  assert.match(idxCode, /function locateChatFloor\\(floor, opts = \\{\\}\\) \\{/,
    '宿主必须有这一口的真实实现');
  assert.match(idxCode, /import \\{ HOST_LOCATE_METHOD \\} from '\\./config/source-locator\\.js';/,
    '挂载名必须取自契约常量');
  assert.match(idxCode, /window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\] = locateChatFloor;/,
    '挂载点只有一处,且用常量做键');
  assert.equal((idxCode.match(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\]/g) || []).length, 1,
    '挂载点不得重复(重复即两处各写一份口径)');"""

new_c1 = """test('C1 宿主侧:`locateChatFloor` 真实现,且按**契约常量**挂载(不手写字面量)', () => {
  assert.match(idxCode, /function locateChatFloor\\(floor, opts = \\{\\}\\) \\{/,
    '宿主必须有这一口的真实实现');
  /* [v4.87.0 交棒] v4.55.0 把魔坊状态与宿主挂载外移至 apps/mofo/mofo-sync.js，判据兼容两处之一 */
  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));
  const combinedMount = idxCode + mofoCode;
  assert.match(combinedMount, /import \\{ HOST_LOCATE_METHOD \\} from '\\./config/source-locator\\.js';/,
    '挂载名必须取自契约常量');
  assert.match(combinedMount, /window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\] = locateChatFloor;/,
    '挂载点只有一处,且用常量做键');
  assert.equal((combinedMount.match(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\]/g) || []).length, 1,
    '挂载点不得重复(重复即两处各写一份口径)');"""

assert old_c1 in s, 'old_c1 not found'
s = s.replace(old_c1, new_c1)

# 替换 D0 / D2
old_d0 = """test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', () => {
  /* 判据1:纯函数件不得出现弱口径签名。 */
  assert.equal(/Number\\.isFinite\\(Number\\(/.test(locCode), false);
  /* 判据2:宿主挂载必须走契约常量。 */
  assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));
  /* 判据3:视图必须有真事件落点。 */
  assert.ok(viewCode.includes('this._goSource(srcBtn);'));
});"""

new_d0 = """test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', () => {
  /* 判据1:纯函数件不得出现弱口径签名。 */
  assert.equal(/Number\\.isFinite\\(Number\\(/.test(locCode), false);
  /* 判据2:宿主挂载必须走契约常量（真身在 mofo-sync）。 */
  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));
  assert.ok((idxCode + mofoCode).includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));
  /* 判据3:视图必须有真事件落点。 */
  assert.ok(viewCode.includes('this._goSource(srcBtn);'));
});"""

assert old_d0 in s, 'old_d0 not found'
s = s.replace(old_d0, new_d0)

old_d2 = """test('D2 ★★★ 破坏「宿主口按契约常量挂载」⇒ 同款判据必转红(手写字面量)', () => {
  const broken = breakOnce(idxCode,
    'window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;',
    'window.VirtualPhone.locateChatFloor = locateChatFloor;',
    'd2');
  assert.equal(broken.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), false,
    '破坏副本:已不再用契约常量');
  assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');
  /* 交叉核对:常量值必须真是那个名字,否则「用常量」也只是形式。 */
  assert.equal(S.HOST_LOCATE_METHOD, 'locateChatFloor');
});"""

new_d2 = """test('D2 ★★★ 破坏「宿主口按契约常量挂载」⇒ 同款判据必转红(手写字面量)', () => {
  const targetCode = stripComments(read('apps/mofo/mofo-sync.js'));
  const broken = breakOnce(targetCode,
    'window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;',
    'window.VirtualPhone.locateChatFloor = locateChatFloor;',
    'd2');
  assert.equal(broken.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), false,
    '破坏副本:已不再用契约常量');
  assert.ok(targetCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');
  /* 交叉核对:常量值必须真是那个名字,否则「用常量」也只是形式。 */
  assert.equal(S.HOST_LOCATE_METHOD, 'locateChatFloor');
});"""

assert old_d2 in s, 'old_d2 not found'
s = s.replace(old_d2, new_d2)

with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('v4130 Patched successfully!')