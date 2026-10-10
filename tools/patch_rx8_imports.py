# -*- coding: utf-8 -*-
"""R-X8 咽喉接线所需的 import：内核增补 minUpstreamOf + 新引 world-bridge 只读出口。"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
IDX = os.path.join(ROOT, 'index.js')

OLD = u"""import {
    CAPABILITY_IDS, capHealthSummary, capHealthReport, crossRepoNotice,
    capHealthSelfCheck,
} from './config/capability-health.js';"""

NEW = u"""import {
    CAPABILITY_IDS, capHealthSummary, capHealthReport, crossRepoNotice,
    capHealthSelfCheck, minUpstreamOf,
} from './config/capability-health.js';
/* [v3.92.0 · 拓展计划 R-X8] 上游只读出口（本仓已有的唯一真源，不新建第二份）：
 *   · `lonshaSource`  —— 记忆插件的**来源自述态**（mounted / sourceState / lastError）；
 *   · `readPushProbe` —— 推/拉统一探针（快照 + 来源 id，用于上游版本归因）；
 *   · `CROSSREPO_FEATURES` —— 登记面真源（插件级最低版本由 `minUpstreamOf` 从它派生，
 *     不在咽喉写常数 —— 写常数就是「同一口径的第二份实现」）。 */
import {
    LONSHA_BRIDGE_ID, lonshaSource, readPushProbe,
} from './config/world-bridge.js';
import { CROSSREPO_FEATURES } from './config/crossrepo-registry.js';"""


def main():
    with io.open(IDX, 'r', encoding='utf-8') as f:
        src = f.read()
    n = src.count(OLD)
    if n != 1:
        print('ANCHOR-COUNT', n)
        sys.exit(1)
    src = src.replace(OLD, NEW)
    with io.open(IDX, 'w', encoding='utf-8') as f:
        f.write(src)
    print('OK imports')


if __name__ == '__main__':
    main()