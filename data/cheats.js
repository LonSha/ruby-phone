/* ========================================================
 * 万界武库 (Cheat Vault) — 数据聚合（R24-O9 数据/代码分离后只剩代码，v4.158.0）
 *
 * 【本文件现在只做三件事】列分片 import、按原顺序拼接、导出同一个 `cheatPacks`。
 *   正文本身在 data/cheats/part-NN.js（每包一行 JSON），本文件物理行数 <1000。
 *   【纪律】消费方一行代码都不用改：`cheatPacks` 的名字、类型、顺序与分离前逐项一致。
 *
 * 【id 稳定性铁律】分片顺序 = 原文件顺序，id 永不重排/删除；下线包只标记不下架。
 * 【同源】轻量索引仍是 data/cheat-index.js（抽卡侧只读元数据），两文件由测试锁定一致。
 * 【生成】分片由 scripts/split-cheats-v24.mjs（1120 批次由 scripts/merge-cheats-1120.mjs）写出，幂等。
 * ======================================================== */
'use strict';
import { packs as p01 } from './cheats/part-01.js';
import { packs as p02 } from './cheats/part-02.js';
import { packs as p03 } from './cheats/part-03.js';
import { packs as p04 } from './cheats/part-04.js';
import { packs as p05 } from './cheats/part-05.js';
import { packs as p06 } from './cheats/part-06.js';
import { packs as p07 } from './cheats/part-07.js';
import { packs as p08 } from './cheats/part-08.js';
import { packs as p09 } from './cheats/part-09.js';
import { packs as p10 } from './cheats/part-10.js';
import { packs as p11 } from './cheats/part-11.js';
import { packs as p12 } from './cheats/part-12.js';
import { packs as p13 } from './cheats/part-13.js';
import { packs as p14 } from './cheats/part-14.js';
import { packs as p15 } from './cheats/part-15.js';
import { packs as p16 } from './cheats/part-16.js';
import { packs as p17 } from './cheats/part-17.js';
import { packs as p18 } from './cheats/part-18.js';
import { packs as p19 } from './cheats/part-19.js';
import { packs as p20 } from './cheats/part-20.js';
import { packs as p21 } from './cheats/part-21.js';
import { packs as p22 } from './cheats/part-22.js';
import { packs as p23 } from './cheats/part-23.js';
import { packs as p24 } from './cheats/part-24.js';
import { packs as p25 } from './cheats/part-25.js';
import { packs as p26 } from './cheats/part-26.js';
import { packs as p27 } from './cheats/part-27.js';
import { packs as p28 } from './cheats/part-28.js';
import { packs as p29 } from './cheats/part-29.js';
import { packs as p30 } from './cheats/part-30.js';
import { packs as p31 } from './cheats/part-31.js';
import { packs as p32 } from './cheats/part-32.js';
import { packs as p33 } from './cheats/part-33.js';
import { packs as p34 } from './cheats/part-34.js';
import { packs as p35 } from './cheats/part-35.js';
import { packs as p36 } from './cheats/part-36.js';
import { packs as p37 } from './cheats/part-37.js';
import { packs as p38 } from './cheats/part-38.js';
import { packs as p39 } from './cheats/part-39.js';

export const cheatPacks = [].concat(p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39);

export const CHEAT_PART_COUNT = 39;
export const CHEAT_PACK_COUNT = cheatPacks.length;

export default { cheatPacks, CHEAT_PART_COUNT, CHEAT_PACK_COUNT };
