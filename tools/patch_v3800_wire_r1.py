# -*- coding: utf-8 -*-
"""v3.80.0 接线修正 R1：injection-contract 需把 injectionPriorityLine 再导出
（diagnose-data 是按 injection-contract 这个「注入面唯一入口」导入的）；
并从 memory-data 的 shared-memory 导入里摘掉两个未使用名（recordsOf / clear）。"""
import io, os, sys

R = '/home/user/ruby-phone'
os.chdir(R)

PLAN = [
    ('config/injection-contract.js',
     "import { planInjection, injectionPriorityLine } from './injection-priority.js';\n",
     "import { planInjection, injectionPriorityLine } from './injection-priority.js';\n"
     "/* 再导出：本模块是注入读数对外的**唯一入口**，消费方（诊断页 / 视图）只认这一处，\n"
     " *   不应被迫知道「计划面其实住在另一个文件里」。 */\n"
     "export { injectionPriorityLine };\n",
     'R1a re-export'),
    ('apps/memory/memory-data.js',
     "    SHARED_MEMORY_KEY, LEVELS as SHARED_LEVELS, emptyStore, normalizeStore,\n"
     "    remember as sharedRemember, recordsOf as sharedRecordsOf,\n"
     "    recall as sharedRecall, clear as sharedClear, sharedMemoryLine as sharedMemoryLineOf\n"
     "} from '../../config/shared-memory.js';\n",
     "    SHARED_MEMORY_KEY, LEVELS as SHARED_LEVELS, emptyStore, normalizeStore,\n"
     "    remember as sharedRemember, recall as sharedRecall, sharedMemoryLine as sharedMemoryLineOf\n"
     "} from '../../config/shared-memory.js';\n",
     'R1b drop unused'),
]


def main():
    for rel, anchor, new, label in PLAN:
        src = io.open(rel, encoding='utf-8').read()
        n = src.count(anchor)
        if n != 1:
            print('ABORT [%s] %s: 锚点命中 %d 次' % (rel, label, n))
            return 1
        io.open(rel, 'w', encoding='utf-8').write(src.replace(anchor, new, 1))
        print('ok [%s] %s' % (rel, label))
    return 0


sys.exit(main())