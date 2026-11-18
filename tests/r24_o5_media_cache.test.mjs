// tests/r24_o5_media_cache.test.mjs — R24-O5 判据：图片与媒体内存治理
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA_FACES, createMediaCache, mediaCacheSelfCheck } from '../config/media-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; let fail = 0;
function ok(name, cond) { if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name); } }

const cache = createMediaCache({ maxBytes: 3000, maxEntries: 4 });
ok('三态登记', ['loaded', 'failed', 'absent'].every((f) => typeof MEDIA_FACES[f] === 'string'));
ok('空缓存 = missing', cache.get('x').face === 'missing');
ok('命中率在无读取时为空值（不是 0）', createMediaCache({ maxBytes: 100 }).stats().hitRate === null);

cache.putLoaded('p1', { bytes: 800, meta: { w: 640 } });
cache.putLoaded('p2', { bytes: 800 });
ok('写入后可命中', cache.get('p1').face === 'loaded');
ok('命中率可复现（1 中 / 2 读）', cache.stats().hitRate === 0.5);
cache.get('p2');
ok('两次连续命中后命中率 2/3', cache.stats().hitRate === 0.667);
cache.get('nope');
ok('未命中计入 misses', cache.stats().misses === 2 && cache.stats().hitRate === 0.5);

for (let i = 3; i <= 8; i += 1) cache.putLoaded('p' + i, { bytes: 800 });
ok('字节上限生效', cache.stats().bytes <= 3000);
ok('淘汰确实发生', cache.stats().evictions > 0);
ok('最近写入的还在', cache.get('p8').face === 'loaded');

cache.markAbsent('no-such-photo');
cache.putFailed('broken', 'HTTP_500');
ok('缺图 = absent', cache.get('no-such-photo').face === 'absent');
ok('失败带错误码', cache.get('broken').face === 'failed' && cache.get('broken').code === 'HTTP_500');
ok('absent 与 failed 不同形（负控制）', cache.get('no-such-photo').face !== cache.get('broken').face);

ok('单张超上限拒缓存', createMediaCache({ maxBytes: 50 }).putLoaded('big', { bytes: 100 }).reason === 'too-large');
ok('缩略按 dpr 计算', cache.thumbnail({ width: 300, dpr: 3 }).side === 900);
ok('缩略下限 64', cache.thumbnail({ width: 10, dpr: 1 }).side === 64);
ok('缩略上限 1024', cache.thumbnail({ width: 4000, dpr: 2 }).side === 1024);
ok('缺尺寸 = invalid（不是 0）', cache.thumbnail({ dpr: 2 }).face === 'invalid');

const before = cache.stats().bytes;
const rel = cache.release('chat-changed');
ok('释放报出释放字节', rel.freedBytes === before && cache.stats().bytes === 0);
ok('释放次数与字节可复算', cache.stats().releaseCount === 1 && cache.stats().releasedBytes === before);
ok('释放后不再命中', cache.get('p8').face === 'missing');
ok('自检绿', mediaCacheSelfCheck().ok === true);

const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
ok('接线：import 真进 index.js', indexSrc.includes("from './config/media-cache.js'"));
ok('接线：桥表真登记 _r24O5', indexSrc.includes("'_r24O5'") || indexSrc.includes('["_r24O5"') || indexSrc.includes("['_r24O5'"));

console.log(pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);