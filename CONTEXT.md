# RubyPhone 工程宪法 (Project Context)

## 项目定位
RubyPhone 是 SillyTavern 原生第三方扩展，三方整合：yuzuki-phone 物理手势底座 + 瑟瑟小手机社媒生态 + 色色灵感状态栏玩法/成就体系，并新增健康生理推演、音乐微信联动。

## 零数据库铁律 (Zero-Database Iron Rule)
1. 禁止调用 AutoCardUpdaterAPI / querySql / executeSql 等任何外部数据库接口。
2. 玩法库 (data/plays.json, 458条) 与成就库 (data/achievements.json, 666条) 为内置静态事实源，禁止改为外部模板。
3. 运行时状态（已选玩法/已解锁成就/生理周期/社媒内容）统一持久化到 chatMetadata 命名空间 ruby_*，随会话隔离。

## App 架构规范
- 每个App独立目录 apps/<name>/，含 <name>-app.js (控制器) / <name>-data.js (数据) / <name>-view.js (视图) / <name>.css (样式)。
- 新增App必须完成四处注册：config/apps.js 桌面图标、phone.css 样式合并、index.js phone:openApp 路由分支、（可选）AI标签解析监听。
- 样式采用深色毛玻璃现代风，遵循各App既定主色：灵感工坊紫(#9333ea)/成就簿金(#f59e0b)/小红书红(#ff2442)/贴吧蓝(#2563eb)/健康粉(#f43f5e)。

## AI 联动标签协议
- 小红书：<RED>{JSON}</RED> 或 <xhs>{JSON}</xhs>
- 贴吧：<Tieba>{JSON}</Tieba>
- 生理状态：由健康App经 GENERATE_BEFORE_COMBINE_PROMPTS 钩子注入 <Physiological_Status> 块
- 玩法注入：由灵感工坊经同一钩子注入 <Scene_Inspiration> 块，发后自清开关控制 MESSAGE_RECEIVED 清空

## 发布链路
- 修改后必须通过 node --check 全量语法校验。
- manifest.json 版本号按 semver 递增；release 附带离线 zip。
- README.md 安装指引指向 GitHub 仓库 LonSha/ruby-phone。