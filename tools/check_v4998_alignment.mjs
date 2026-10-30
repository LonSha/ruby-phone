// check_v4998_alignment.mjs — 三源同源自检（update-log / index.js 公告块 / ITERATION_LOG / 段文件）
import fs from 'node:fs';
const NL = String.fromCharCode(10);
const re = /const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};/;
const read = (p) => fs.readFileSync(p, 'utf8');
const ul = JSON.parse(read('update-log.json'));
const items = ul.versions[ul.latest].items;
const ij = read('index.js');
const m = re.exec(ij);
if (!m) {
  console.log('FAIL 公告块不可提取');
  process.exit(1);
}
const blk = m[0];
const missBlock = items.filter((i) => !blk.includes(JSON.stringify(i)));
const il = read('ITERATION_LOG.md');
const missLog = items.filter((i) => !il.includes(i));
const seg = read('tools/iter232_seg.md');
const segItems = [];
for (const raw of seg.split(NL)) {
  let l = raw.trim();
  if (!l.startsWith('- ')) continue;
  let it = l.slice(2).trim();
  if (it.startsWith('**')) it = it.slice(2);
  if (it.endsWith('**')) it = it.slice(0, -2);
  segItems.push(it.trim());
}
const orderOk = segItems.length === items.length && segItems.every((v, i) => v === items[i]);
const ver = (/const ST_PHONE_VERSION = '([^']+)'/.exec(ij) || [])[1];
const man = JSON.parse(read('manifest.json')).version;
const pkg = JSON.parse(read('package.json')).version;
const led = JSON.parse(read('tests/audit/status-ledger.json'));
console.log('版本: index=' + ver + ' manifest=' + man + ' package=' + pkg
  + ' update-log=' + ul.latest + ' ledger=' + led.version
  + ' -> ' + (ver === man && pkg === man && ul.latest === man && led.version === man ? 'OK' : 'MISMATCH'));
console.log('items=' + items.length + ' / seg=' + segItems.length + ' / 顺序一致=' + orderOk);
console.log('公告块缺项=' + missBlock.length + ' / 迭代日志缺项=' + missLog.length);
console.log('当版条目在首位=' + (Object.keys(ul.versions)[0] === ul.latest));
const bad = items.filter((i) => i.includes('[') || i.includes(']'));
console.log('条目含方括号（禁则）=' + bad.length);
const ok = missBlock.length === 0 && missLog.length === 0 && orderOk && bad.length === 0
  && ver === man && pkg === man && ul.latest === man && led.version === man;
console.log(ok ? 'ALL_ALIGNED' : 'ALIGN_FAIL');
process.exit(ok ? 0 : 1);