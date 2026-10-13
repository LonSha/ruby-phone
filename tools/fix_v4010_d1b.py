import io
p = '/home/user/ruby-phone/tests/system-v4010.test.mjs'
s = io.open(p, encoding='utf-8').read()
old = "assert.equal(src.count(A), 1);"
new = "assert.equal(src.split(A).length - 1, 1);"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK')
