import io

# 1. 修改 config/creator-career-market.js 中的 deadline 为 dueTime
p1 = 'config/creator-career-market.js'
with io.open(p1, 'r', encoding='utf-8') as f:
    s1 = f.read()

# 替换委托条目结构中的 deadline -> dueTime
s1 = s1.replace(
    'deadline: safeNum(raw.deadline, Date.now() + 7 * 86400000),',
    'dueTime: safeNum(raw.dueTime ?? raw.deadline, Date.now() + 7 * 86400000),'
)
s1 = s1.replace(
    'export function clarifyAndQuoteCommission(commission, { budget, deadline, license, requirements }, now = Date.now()) {',
    'export function clarifyAndQuoteCommission(commission, { budget, deadline, dueTime, license, requirements }, now = Date.now()) {'
)
s1 = s1.replace(
    'deadline: deadline !== undefined ? safeNum(deadline, norm.deadline) : norm.deadline,',
    'dueTime: (dueTime !== undefined || deadline !== undefined) ? safeNum(dueTime ?? deadline, norm.dueTime) : norm.dueTime,'
)

with io.open(p1, 'w', encoding='utf-8') as f:
    f.write(s1)

# 2. 修改 tests/seventh-cycle-expansion-batch-b.test.mjs 中的 deadline -> dueTime
p2 = 'tests/seventh-cycle-expansion-batch-b.test.mjs'
with io.open(p2, 'r', encoding='utf-8') as f:
    s2 = f.read()

s2 = s2.replace('deadline: Date.now() + 10 * 86400000,', 'dueTime: Date.now() + 10 * 86400000,')
with io.open(p2, 'w', encoding='utf-8') as f:
    f.write(s2)

print('Replaced deadline with dueTime in creator-career-market!')