import io

p = 'config/creator-career-market.js'
with io.open(p, 'r', encoding='utf-8') as f:
    s = f.read()

s = s.replace('raw.dueTime ?? raw.deadline', 'raw.dueTime')
s = s.replace(
    'export function clarifyAndQuoteCommission(commission, { budget, deadline, dueTime, license, requirements }, now = Date.now()) {',
    'export function clarifyAndQuoteCommission(commission, { budget, dueTime, license, requirements }, now = Date.now()) {'
)
s = s.replace(
    'dueTime: (dueTime !== undefined || deadline !== undefined) ? safeNum(dueTime ?? deadline, norm.dueTime) : norm.dueTime,',
    'dueTime: dueTime !== undefined ? safeNum(dueTime, norm.dueTime) : norm.dueTime,'
)

with io.open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('Cleaned all deadline references from creator-career-market.js!')