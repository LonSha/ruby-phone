import io

P = 'tools/refresh_baselines_v4999.py'
src = io.open(P, encoding='utf8').read()

old_head = '"""refresh_baselines_v4999.py — v4.99.9 抬版后的**探针基线对账**（现场读数写回，零手抄）。'
new_head = (
    '"""refresh_baselines_v4200.py — v4.200.0 的**探针基线对账**（现场读数写回，零手抄）。\n'
    '（由 tools/refresh_baselines_v4999.py 逐字派生，只改版本常量与末尾那条来由散文。）\n'
    '\n'
    '【v4.200.0】本版把枚举面真正长起来了（APP_CATEGORY 补登 5 个子 App、像素图标生成器随之产出\n'
    '5 张字形），于是 `lifecycle_declarative` 的枚举面读数必然跟着涨：\n'
    '`app_classes 85→98 / slots 99→115 / app_slots 86→99 / sig_empty 75→88`。\n'
    '注意**接线点与语义面一格未动**（wiring 59 / app_exit 47 / non_app 12 / semantic 9·5·4）——\n'
    '新 App 全部落在「有类无实例出口」这一档，所以覆盖率 79.7%、非 App 占比 20.3%、\n'
    '一致率 55.6% 三个百分比与 R1..R4 的判定一律不变。这是「输入面变了、读数跟着变」的**显式**动作，'
)
assert old_head in src, 'docstring 头未命中'
src = src.replace(old_head, new_head, 1)

assert "VER = '4.110.0'" in src, 'VER 未命中'
src = src.replace("VER = '4.110.0'", "VER = '4.200.0'", 1)

tail_anchor = "v4998.py 再刷一次（同纪律：零手抄、幂等、冻结 measured_at、冻结面跳过、名单不一致即报错）。'\n)"
assert tail_anchor in src, 'REFRESH_NOTE 尾未命中'
new_tail = (
    "v4998.py 再刷一次（同纪律：零手抄、幂等、冻结 measured_at、冻结面跳过、名单不一致即报错）。'\n"
    "    '【v4.200.0】当版把 5 个漏登的子 App（weibotext / honeytext / phonetext / gamesprotocol / "
    "diagnosereason）真正接进类目与像素图标真源，于是 apps/ 下的 `*-app.js` 枚举面从 85 涨到 98，"
    "「实例槽位 / App 槽位 / 无参出口」这三条派生读数一并跟着涨（99→115 / 86→99 / 75→88）。"
    "这是「输入面变了、读数跟着变」的显式动作，不是转写漂移：新 App 全部没有实例出口调用，"
    "所以 wiring_points / app_exit_points / non_app_points 与三条路径区间一字未动。"
    "本版以 tools/refresh_baselines_v4200.py 再刷一次（同纪律：零手抄、幂等、冻结 measured_at、"
    "冻结面跳过、名单不一致即报错）。'\n)"
)
src = src.replace(tail_anchor, new_tail, 1)

io.open('tools/refresh_baselines_v4200.py', 'w', encoding='utf8').write(src)
print('WROTE tools/refresh_baselines_v4200.py')