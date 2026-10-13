p = 'scripts/keys-audit.mjs'
s = open(p, encoding='utf-8').read()
old = "  { key: 'backup_ledger', scope: 'chat', note: '[v3.91.0]"
new = "  { key: 'cw_drafts', scope: 'chat', note: '[v4.01.0] 创作工作台草稿本（多目标草稿行：幂等键/source/materialId/target/note/tags/state/version；同键后到覆盖，上限 24，最早先出）' },\n" + old
assert s.count(old) == 1, 'anchor=' + str(s.count(old))
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('cw_drafts registered')
