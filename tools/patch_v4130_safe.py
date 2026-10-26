import io

p = 'tests/system-v4130.test.mjs'
with io.open(p, 'r', encoding='utf-8') as f:
    s = f.read()

# 替换 C1
old_c1_part = """  assert.match(idxCode, /import \{ HOST_LOCATE_METHOD \} from '\\./config/source-locator\\.js';/,
    '挂载名必须取自契约常量');
  assert.match(idxCode, /window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\] = locateChatFloor;/,
    '挂载点只有一处,且用常量做键');
  assert.equal((idxCode.match(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\]/g) || []).length, 1,
    '挂载点不得重复(重复即两处各写一份口径)');"""

new_c1_part = """  /* [v4.87.0 交棒] v4.55.0 把魔坊状态与宿主挂载外移至 apps/mofo/mofo-sync.js，判据兼容两处之一 */
  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));
  const combinedMount = idxCode + mofoCode;
  assert.ok(/import \\{ HOST_LOCATE_METHOD \\} from '\\./config/source-locator\\.js'/.test(combinedMount),
    '挂载名必须取自契约常量');
  assert.ok(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\] = locateChatFloor/.test(combinedMount),
    '挂载点只有一处,且用常量做键');
  assert.equal((combinedMount.match(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\]/g) || []).length, 1,
    '挂载点不得重复(重复即两处各写一份口径)');"""

assert old_c1_part in s, 'old_c1_part not found'
s = s.replace(old_c1_part, new_c1_part)

# 替换 D0
old_d0_part = "assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));"
new_d0_part = """const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));
  assert.ok((idxCode + mofoCode).includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));"""
assert old_d0_part in s, 'old_d0_part not found'
s = s.replace(old_d0_part, new_d0_part)

# 替换 D2
old_d2_part = """  const broken = breakOnce(idxCode,
    'window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;',
    'window.VirtualPhone.locateChatFloor = locateChatFloor;',
    'd2');
  assert.equal(broken.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), false,
    '破坏副本:已不再用契约常量');
  assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');"""

new_d2_part = """  const targetCode = stripComments(read('apps/mofo/mofo-sync.js'));
  const broken = breakOnce(targetCode,
    'window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;',
    'window.VirtualPhone.locateChatFloor = locateChatFloor;',
    'd2');
  assert.equal(broken.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), false,
    '破坏副本:已不再用契约常量');
  assert.ok(targetCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');"""
assert old_d2_part in s, 'old_d2_part not found'
s = s.replace(old_d2_part, new_d2_part)

with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('v4130 successfully patched!')