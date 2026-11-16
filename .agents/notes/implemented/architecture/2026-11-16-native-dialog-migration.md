# Agent Note: RubyPhone 页内反馈与确认统一迁移

Status: implemented
Date: 2026-11-16

## Problem
RubyPhone 仍有大量直接调用 `alert()`、`confirm()`、`prompt()` 的历史路径。它们阻塞宿主线程、样式不可控、移动端焦点和返回键语义不一致，也让通知、错误、破坏性操作在不同 App 里各自实现。现有 `config/destructive-confirm.js` 只统一了少数声明面，不能覆盖普通提示和输入。

## Decision
建立 `config/phone-feedback.js` 作为统一页内反馈出口：

- `phoneNotice()` 提供非阻塞的页内状态提示；
- `phoneConfirm()` 与 `phonePrompt()` 成为历史同步调用的唯一兼容入口；
- 新代码使用 `phoneConfirmAsync()` / `phonePromptAsync()`，提供可访问的页内对话框，支持 Esc、焦点归还和窄屏布局；
- 逐步把 App 层的原生 `alert/confirm/prompt` 迁移到该出口，不改变业务数据键和保存契约；
- 本轮先完成全仓调用点收口，保证通知全部页内化，并保留同步确认/输入的兼容语义，避免一次性把几十个事件处理器错误改成异步。

## Alternatives considered

1. **继续保留原生对话框，只统一文案**：改动最小，但无法解决提示阻塞、样式不可控和可访问性问题。
2. **只替换 `alert()`，保留 `confirm()`/`prompt()`**：能降低一部分阻塞，但删除、清空和导入仍然依赖散落的原生控件，无法建立统一边界。
3. **全局覆写 `window.alert/confirm/prompt`**：调用点改动少，但会污染宿主、难以区分其他插件，并且无法把同步 API 安全桥接为异步，因此不采用。
4. **立即把所有确认处理器改为异步**：最终体验最好，但一次性改动会改变大量保存时序，风险超过本轮可验证范围；先收口调用面，再按页面逐批切换异步 API。

## Testing

- `npm run syntax`、`npm run import-resolve`、`npm run named-import` 与 `git diff --check` 通过。
- 反馈迁移定向测试 102/102 通过；版本锚定向测试与 R22 v4.157.0 测试通过。
- `npm run dead-exports` 与 `npm run bind-consuming` 已恢复为无新增零消费导出。
- 全量测试仍需独立按历史组与并发生命周期继续收口。

## Risks
同步兼容入口仍可能在没有异步迁移的旧路径中调用原生确认/输入；这是刻意保留的过渡边界，下一批迁移应按页面改为 async API。批量替换必须避开类方法 `confirm()`、注释和测试夹具，并通过静态扫描与行为测试双重验证。
