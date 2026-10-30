import io, sys

ROOT = '/home/user/ruby-phone'
FILES = ['tools/iter231_seg.md', 'ITERATION_LOG.md', 'index.js', 'update-log.json']

# ① 判据条数：24 → 27（A1-A3 / B1-B4 / C1-C5 / D1-D2 / E1-E7 / F1 / G1-G5）
OLD_CASES = '【判据 24 条全绿】tests/system-v4997.test.mjs：A1-A3 档次判定有出处 / 入参一字不动 / 阈值三态；B1-B4 三档留得对 / 中枢 URGENT 不被误杀 / 脏输入不炸 / 与内核逐条对拍；C1-C5 隐藏不消失 / 展开实名可点可删 / all 档不占位 / 隐藏≠删除 / 只读反查口；D1-D2 范式读口四态 / 读不到不过滤；E1-E4 真 import / 视图无第二套判据 / 键三处同源 / 先范后 chip；F1 搜索重链；G1-G5 五条负控制全部双向断言（原版上真、破坏副本上假）。'
NEW_CASES = '【判据 27 条全绿】tests/system-v4997.test.mjs：A1-A3 档次判定有出处 / 入参一字不动 / 阈值三态（只比被关心的三个字段，不锁死返回体形状）；B1-B4 三档留得对 / 中枢 URGENT 不被误杀 / 脏输入不炸 / 与内核逐条对拍；C1-C5 隐藏不消失 / 展开实名可点可删 / all 档不占位 / 隐藏≠删除 / 只读反查口；D1-D2 范式读口四态 / 读不到不过滤；E1-E7 真 import / 视图无第二套判据 / 键三处同源 / 先范后 chip / 档名文案只在桥层 / 三档文案行为判据 / 成功形与失败形都带 label；F1 搜索重链；G1-G5 五条负控制全部双向断言（原版上真、破坏副本上假）。'

# ② 五道门读数按当版真值回正
OLD_GATES = '【五道门同步】syntax 1094 文件 / import-resolve 639 文件 1076 条 / dead-export 694 文件 4730 export 零消费 81 条 / keys-audit 505 键全登记 / registry 89 App 无孤儿 —— 全绿。'
NEW_GATES = '【五道门同步】syntax 1095 文件 / import-resolve 639 文件 1075 条 / dead-export 692 文件 4731 export（跨文件消费 1338 · 零消费 81）· 冻结基线 81 条 / keys-audit 505 键全登记（会话隔离 311 · 全局 191 · 历史键 3）/ registry 89 App · 89 懒加载分支 · 样式投递 79 件未覆盖 0 —— 全绿。'

# ③ 第 10 条扩写：绑定级账本同步清账（116→115 那批之后本版再清 1 条）
OLD_DEAD = '【死导出少了一条】冻结基线 82 → 81：`config/usage-paradigm.js::filterNoticesByParadigm` 从「零消费冻结项」里出列了 —— 这条项的消失本身就是「真接线」的证据，不是靠白名单挂掉的。'
NEW_DEAD = '【两张账本同时少一条】导出级冻结基线 82 → 81、绑定级冻结基线 115 → 114，掉的都是 `config/usage-paradigm.js::filterNoticesByParadigm` 这一条 —— 项被清出账本的原因只能是「门禁探针已看不见它」（它被产品侧真调用了），不是靠白名单或豁免挂掉的；两张账本都必须 `--update` 后条目数真的减一，只改一张说明另一个探针没跟着走。'

PAIRS = [(OLD_CASES, NEW_CASES), (OLD_GATES, NEW_GATES), (OLD_DEAD, NEW_DEAD)]

write = '--write' in sys.argv
bad = 0
for rel in FILES:
    p = ROOT + '/' + rel
    s = io.open(p, encoding='utf-8').read()
    for old, new in PAIRS:
        n = s.count(old)
        if n != 1:
            print('ERR  %-24s hits=%d :: %s' % (rel, n, old[:32]))
            bad += 1
            continue
        s = s.replace(old, new)
    if not write:
        print('DRY  %-24s ok' % rel)
        continue
    io.open(p, 'w', encoding='utf-8').write(s)
    print('WROTE %-24s' % rel)

sys.exit(1 if bad else 0)
