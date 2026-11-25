import io

ENT = '&' + 'quot;'
p = 'apps/music/music-core-view.js'
s = io.open(p, encoding='utf8').read()
bad = '.replace(/"/g, \'"\');'
good = '.replace(/"/g, \'' + ENT + '\');'
assert bad in s, '恒等替换行未命中'
n = s.count(bad)
s = s.replace(bad, good)
io.open(p, 'w', encoding='utf8').write(s)
print('replaced', n)
print('now:', good)