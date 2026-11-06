# RubyPhone 第十六期专版：防全知视界隔离与酒馆跨角色认知净化联动 (V16 / R16)
日期：2026-11-06。基线版本：v4.133.0 / `016d716`。分支：`feat/v16-omniscience-ban-cycle`。

## 目标与核心痛点
配合 LonSha 记忆底座的认知四桶隔离，在虚拟手机层彻底截断"不在场角色的私有通知、备忘录与私信记录跨角色透视"。
支持酒馆任意第三方多角色卡，当切换交互角色或在群聊中时，动态净化手机注入上下文，防全知出戏。

## 交付特性矩阵
1. **R16-O1 · 手机上下文防全知动态净化 (Context Cognitive Sanitizer)**
   - 在 `LonShaBridge` 接入 `filterContextForCognitiveHorizon`，根据现场活跃角色名单动态过滤非在场角色的私密手机动态。
2. **R16-O2 · 跨角色防透视定向单测与负控制 (Vertical Ban Testing & Negative Control)**
   - 编写覆盖单人卡、多人卡、群聊及负控制破坏断言的测试套件。