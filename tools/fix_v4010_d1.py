import io
p = '/home/user/ruby-phone/tests/system-v4010.test.mjs'
s = io.open(p, encoding='utf-8').read()
old = "test('D1 负控制：破坏「按目标替换」成按键替换，B5 判据必须转红', () => {"
new = "test('D1 负控制：破坏「按目标替换」成按键替换，B5 判据必须转红', async () => {"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('OK async D1')
