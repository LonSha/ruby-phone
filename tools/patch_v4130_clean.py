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

# 在文件里真实搜索匹配
target = "test('C1 宿主侧:`locateChatFloor` 真实现,且按**契约常量**挂载(不手写字面量)', () => {"
idx = s.find(target)
end_idx = s.find("const body = idxCode.slice(idxCode.indexOf('function locateChatFloor('));", idx)

print('Found C1 block:', idx, end_idx)

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
    '挂载点不得重复(重复即两处各写一份口径)');
  """

s = s[:idx] + new_c1 + s[end_idx:]

# D0
d0_target = "test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', () => {"
d0_idx = s.find(d0_target)
d0_end = s.find("test('D1 ★★★ 破坏「楼层取值走唯一门」⇒ 同款判据必转红(弱口径回归)', () => {", d0_idx)
new_d0 = """test('D0 ★★★ 阳性对照:未破坏时三条判据必须全为真(否则 D 组是假绿)', () => {
  /* 判据1:纯函数件不得出现弱口径签名。 */
  assert.equal(/Number\\.isFinite\\(Number\\(/.test(locCode), false);
  /* 判据2:宿主挂载必须走契约常量（真身在 mofo-sync）。 */
  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));
  assert.ok((idxCode + mofoCode).includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));
  /* 判据3:视图必须有真事件落点。 */
  assert.ok(viewCode.includes('this._goSource(srcBtn);'));
});
"""
s = s[:d0_idx] + new_d0 + s[d0_end:]

# D2
d2_target = "test('D2 ★★★ 破坏「宿主口按契约常量挂载」⇒ 同款判据必转红(手写字面量)', () => {"
d2_idx = s.find(d2_target)
d2_end = s.find("test('D3 ★★★ 破坏「不回报 = 没成」⇒ 同款判据必转红(静默当成功)', () => {", d2_idx)
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
});
"""
s = s[:d2_idx] + new_d2 + s[d2_end:]

with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('v4130 Patched successfully!')