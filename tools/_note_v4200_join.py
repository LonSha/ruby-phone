import io

P = 'tests/audit/scan_file_size_ceiling.mjs'
s = io.open(P, encoding='utf8').read()

old = "逐文件天花板只有 settings-app.js 一条往下压。',\n      ' **v4.200.0"
new = "逐文件天花板只有 settings-app.js 一条往下压。 ' +\n      ' **v4.200.0"
assert old in s, 'join anchor miss'
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf8').write(s)
print('joined with previous entry')