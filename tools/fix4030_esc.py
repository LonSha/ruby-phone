import io
p = 'tests/system-v4030.test.mjs'
s = io.open(p, encoding='utf-8').read()
Q = chr(34)
BS = chr(92)
SQ = chr(39)
bad = 'assert.equal(keys.includes(' + BS + Q + 'key: ' + SQ + 'tv_party' + SQ + ', scope: ' + SQ + 'chat' + SQ + BS + Q + '), true);'
good = ('assert.equal(keys.indexOf(' + Q + 'key: ' + Q + ' + ' + Q + SQ + 'tv_party' + SQ + ', scope: ' + Q + ' + '
        + Q + SQ + 'chat' + SQ + Q + ') >= 0, true);')
print('bad count:', s.count(bad))
assert s.count(bad) == 1
s = s.replace(bad, good, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('escapes left:', s.count(BS + Q))
print('done')