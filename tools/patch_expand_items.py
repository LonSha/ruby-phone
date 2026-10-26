import io
import re

p = 'update-log.json'
with io.open(p, 'r', encoding='utf-8') as f:
    import json
    ul = json.load(f)

# 当前 4.87.0 的 5 条记录
items = ul['versions']['4.87.0']['items']

# 拓展为 8 条规范项（细化交付内容）
expanded_items = [
    "◈ 深浅双表面机制：新增 config/app-surfaces.js 作为 App 表面色唯一真源（按各 App CSS 字色亮度实测分 38 深 / 51 浅两档），外壳建层不再硬编码 transparent，修真机「App 整页透出桌面壁纸/状态栏时钟电池」",
    "◈ 返回导航重写：_dispatchSwipeBackWithFallback 取消预弹栈、改用 _viewStateVersion 单调计数判据 + 600/500ms 双观察窗；新增 _forceLayerBack 沿视图历史代退一层并派发 phone:viewBack 让宿主同步 currentApp，修「返回键点了卡死/点了没反应」",
    "◈ 应用库分层：新增 config/app-library.js（21 桌面核心 + 68 库内工具、7 类目），桌面新增应用库全屏页（搜索 + 分类 + 键盘可达），桌面从 5 页 89 图标收敛为核心常用",
    "◈ 返回键 UI 收进状态栏空隙（不再让 89 个 App 各自让位），syncBackButtonVisibility 按表面深浅自动切换配色",
    "◈ 视图回退事件通道：在 config/phone-events.js 登记 PHONE_EVENTS.VIEW_BACK 契约，补齐导航类事件派发元数据",
    "◈ 窄屏断点真源收敛：清理桌面 320ms 防穿透硬编码数值，统一与内核 260ms 阈值对齐并规范类名前缀隔离",
    "◈ 历史断言解耦交棒：将魔坊状态同步与宿主定位方法真身指向 apps/mofo/mofo-sync.js，完成跨版本拆分测试平滑接管",
    "◈ 版本升至 4.87.0（五源同源）"
]

ul['versions']['4.87.0']['items'] = expanded_items

with io.open(p, 'w', encoding='utf-8') as f:
    json.dump(ul, f, ensure_ascii=False, indent=2)
    f.write('\n')

# 同步 index.js 里的 ST_PHONE_CURRENT_UPDATE
idx_p = 'index.js'
with io.open(idx_p, 'r', encoding='utf-8') as f:
    idx_src = f.read()

# 替换 ST_PHONE_CURRENT_UPDATE 块
start_marker = 'const ST_PHONE_CURRENT_UPDATE = {'
end_marker = '};\n// 🔥 防重复加载检查'

start_pos = idx_src.find(start_marker)
end_pos = idx_src.find(end_marker, start_pos)

items_str = json.dumps(expanded_items, ensure_ascii=False, indent=8)
new_update_block = f"""const ST_PHONE_CURRENT_UPDATE = {{
    version: ST_PHONE_VERSION,
    date: "2026-10-26",
    items: {items_str}
"""

idx_src = idx_src[:start_pos] + new_update_block + idx_src[end_pos:]
with io.open(idx_p, 'w', encoding='utf-8') as f:
    f.write(idx_src)

print('Updated 4.87.0 items in update-log.json and index.js successfully!')