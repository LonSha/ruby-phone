import io

path = 'tests/system-v256.test.mjs'
with io.open(path, 'r', encoding='utf-8') as f:
    txt = f.read()

old = """test('B3 三处引用点全部指向 stStringifyState', () => {
  const aliases = (idx.match(/const stringify(?:State|Value) = stStringifyState;/g) || []).length;
  assert.equal(aliases, 3, `引用点数 ${aliases}`);
});"""

new = """test('B3 三处引用点全部指向 stStringifyState（真身已随拆分移至 mofo-sync 与 inline-reply-button）', () => {
  /* [v4.87.0 交棒] v4.55.0 剥离后，三处引用点移至 apps/mofo/mofo-sync.js (1处) 与 phone/inline-reply-button.js (2处) */
  const combined = idx + read('apps/mofo/mofo-sync.js') + read('phone/inline-reply-button.js');
  const aliases = (combined.match(/const stringify(?:State|Value) = stStringifyState;/g) || []).length;
  assert.equal(aliases, 3, `引用点数 ${aliases}`);
});"""

assert old in txt, 'old block not found in v256'
txt = txt.replace(old, new)
with io.open(path, 'w', encoding='utf-8') as f:
    f.write(txt)
print('v256 Patched Successfully')
