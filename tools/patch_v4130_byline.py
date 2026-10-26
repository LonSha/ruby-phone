import io

p = 'tests/system-v4130.test.mjs'
with io.open(p, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    # 替换 C1 断言段
    if "assert.match(idxCode, /import \\{ HOST_LOCATE_METHOD \\}" in line:
        new_lines.append("  /* [v4.87.0 交棒] v4.55.0 把魔坊状态与宿主挂载外移至 apps/mofo/mofo-sync.js，判据兼容两处之一 */\n")
        new_lines.append("  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));\n")
        new_lines.append("  const combinedMount = idxCode + mofoCode;\n")
        new_lines.append("  assert.match(combinedMount, /import \\{ HOST_LOCATE_METHOD \\} from '\\.\\/config\\/source-locator\\.js';/,\n")
        new_lines.append("    '挂载名必须取自契约常量');\n")
        new_lines.append("  assert.match(combinedMount, /window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\] = locateChatFloor;/,\n")
        new_lines.append("    '挂载点只有一处,且用常量做键');\n")
        new_lines.append("  assert.equal((combinedMount.match(/window\\.VirtualPhone\\[HOST_LOCATE_METHOD\\]/g) || []).length, 1,\n")
        new_lines.append("    '挂载点不得重复(重复即两处各写一份口径)');\n")
        skip = True
        continue
    if skip and "'挂载点不得重复(重复即两处各写一份口径)');" in line:
        skip = False
        continue
    if skip:
        continue

    # 替换 D0
    if "assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));" in line:
        new_lines.append("  const mofoCode = stripComments(read('apps/mofo/mofo-sync.js'));\n")
        new_lines.append("  assert.ok((idxCode + mofoCode).includes('window.VirtualPhone[HOST_LOCATE_METHOD] = locateChatFloor;'));\n")
        continue

    # 替换 D2
    if "const broken = breakOnce(idxCode," in line:
        new_lines.append("  const targetCode = stripComments(read('apps/mofo/mofo-sync.js'));\n")
        new_lines.append("  const broken = breakOnce(targetCode,\n")
        continue
    if "assert.ok(idxCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');" in line:
        new_lines.append("  assert.ok(targetCode.includes('window.VirtualPhone[HOST_LOCATE_METHOD]'), '原版必须用常量');\n")
        continue

    new_lines.append(line)

with io.open(p, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('v4130 by line replaced successfully!')