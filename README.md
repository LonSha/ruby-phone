# RubyPhone

SillyTavern 的拟真手机 UI 扩展。零外部数据库，安装即用。

## 安装

```
SillyTavern → 扩展 → 安装扩展 → 输入 https://github.com/LonSha/ruby-phone.git → 刷新
```

或手动放入 `third-party/ruby-phone/` 后重启。

## 目录结构

```
ruby-phone/
├── index.js              # 主入口
├── manifest.json          # 插件清单
├── package.json
├── update-log.json        # 版本记录（驱动应用内更新弹窗）
├── phone.css              # 全局样式
├── config/                # 功能模块（ESM 纯函数）
├── apps/                  # 各应用视图与逻辑
├── tests/                 # 测试套件
└── docs/                  # 规划文档与存档
```

## 运行测试

```bash
node --test tests/system-v4540.test.mjs   # 最新版本
node --test tests/*.test.mjs               # 全部
```

## 版本

当前版本见 `update-log.json` 的 `latest` 字段。

## 许可证

MIT License — Copyright (c) 2026 LonSha