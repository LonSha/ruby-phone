# -*- coding: utf-8 -*-
"""[v3.34.0] 六处接线（本仓新增 App 的固定落点）。

① config/apps.js      —— 加老福特 App 条目（date 之后、widget 之前）
② config/storage.js   —— 加 ^lofter_ 会话键前缀
③ index.js            —— 懒加载分支 + 重绑表槽位名 lofterApp
④ scripts/keys-audit.mjs —— 三条会话键登记
⑤ tests/system-v255.test.mjs —— 懒加载 dirMap 登记
⑥ phone.css           —— 贴本版样式段
每处锚点命中次数必须恰好 1。
"""
import sys

def patch(path, old, new, tag):
    with open(path, encoding='utf-8') as f:
        text = f.read()
    n = text.count(old)
    if n != 1:
        print('FAIL[%s]: 锚点命中 %d 次（必须恰好 1 次）' % (tag, n))
        sys.exit(1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text.replace(old, new, 1))
    print('OK  %s' % tag)


# ---------- ① config/apps.js ----------
A_OLD = """        id: 'date',
        name: '约会大作战',
        icon: '\U0001f496',
        color: '#f43f5e',
        badge: 0,
        data: {}
    },
    {
        // [v3.28.0] 自定义组件"""
A_NEW = """        id: 'date',
        name: '约会大作战',
        icon: '\U0001f496',
        color: '#f43f5e',
        badge: 0,
        data: {}
    },
    {
        // [v3.34.0] 老福特：中文同人圈创作平台（缝合自 Perigee js/lofter.js，4445 行 / 267370 字节）。
        //   源是一个挂在全局 AppState.data.lofterData 上、**共用微博粉丝池与 CP 设定**的仿真。
        //   取五块：① 短文批量 ② 长篇合集（含前文滑窗）③ 评论楼中楼 ④ 关注 / 订阅 / 我的四格
        //   ⑤ 阅读面（首页 / 分月 / tag / 搜索）。设置面取「文风库」这一块机制（11 款内置 + 自建）。
        //   四处不缝：① **不直连模型**（源自己读 apiOverride.apiKey、自己拼 systemPrompt、自己发
        //   POST）—— 生成走两条合法通道：视图摆出可复制的要求文本，用户从对话框拿回结果贴回来；
        //   ② **不落 Dexie、不碰 db.chats / chat.history**（源整块 lofterData 经 Utils.saveData 回写、
        //   把卡片往 history 里 push）；③ **不共用别的 App 的池**（源要 weiboData.fanFriends 与 CP
        //   设定）—— 本件自带原创作者池，零跨 App 读；④ **一张图都不存、一条外链都不收**（源存生图
        //   URL 与外链封面）—— 只登记「有没有图 / 几张」。
        //   三条偏离：统计数收成唯一实现 deriveStats(heat, cold)（源三处各掷一次随机、序关系不保证），
        //   本件同一 (heat, cold) 必得同一读数且「心 >= 收藏 >= 评论」恒成立；前文滑窗提成纯函数
        //   prevChapterContext（最近 5 章全文、更早给摘要）；评论树深度有上限且上溯带访问集防自指
        //   （源 _topAncestorId 无保护，数据自指时无限上溯）。写盘三条键走 ^lofter_ 前缀随会话隔离。
        id: 'lofter',
        name: '老福特',
        icon: '\U0001f58b',
        color: '#38bdf8',
        badge: 0,
        data: {}
    },
    {
        // [v3.28.0] 自定义组件"""
patch('config/apps.js', A_OLD, A_NEW, 'config/apps.js 条目')

# ---------- ② config/storage.js ----------
B_OLD = """            /^date_/,"""
B_NEW = """            /^date_/,
            // [v3.34.0] 老福特（lofter_settings / lofter_content / lofter_store）：
            //   一条前缀覆盖三键（无元字符、无需宽匹配登记）。
            //   作者池、稿子、合集、关注与订阅、我的四个列表都是「这段关系的账」，
            //   随会话隔离：换角色后那是另一个人的另一批稿子。
            /^lofter_/,"""
patch('config/storage.js', B_OLD, B_NEW, 'config/storage.js 前缀')

# ---------- ③ index.js 懒加载分支 ----------
C_OLD = """                } else if (appId === 'widget') {"""
C_NEW = """                } else if (appId === 'lofter') {
                    // [v3.34.0] 老福特：中文同人圈（缝合自 Perigee lofter）。
                    //   取五块：短文批量 / 长篇合集与滑窗 / 评论楼中楼 / 关注与订阅 / 阅读面；设置面取文风库。
                    //   四处不缝：不直连模型（源自己拼 systemPrompt 发 POST）—— 改摆可复制的要求文本，
                    //   结果由用户贴回来；不落 Dexie 也不往 chat.history push；不共用别的 App 的粉丝池
                    //   （自带原创作者池）；不存图也不收外链（只记「有没有 / 几张」）。
                    //   三条偏离：统计数收成唯一实现且「心 >= 收藏 >= 评论」恒成立；前文滑窗提成纯函数；
                    //   评论树深度有上限、上溯带访问集防自指。写盘三条键走 ^lofter_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/lofter/lofter-app.js'), './apps/lofter/lofter-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.lofterApp) {
                                window.VirtualPhone.lofterApp = new module.LofterApp(phoneShell, storage);
                            }
                            window.VirtualPhone.lofterApp.render();
                        })
                        .catch(err => {
                            console.error('\u274c 加载老福特App失败:', err);
                            phoneShell?.showNotification('错误', '老福特App加载失败', '\u274c');
                        });
                } else if (appId === 'widget') {"""
patch('index.js', C_OLD, C_NEW, 'index.js 懒加载分支')

# ---------- ③ index.js 重绑表 ----------
D_OLD = """    'dateApp'         // [v3.31.0] 约会大作战：有未提交草稿（场景三格 / JSON 批量 / 剧情与日志文本）、
//             选中场次与展开面（_current / _editScene / _showShare / _face 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
];"""
D_NEW = """    'dateApp',        // [v3.31.0] 约会大作战：有未提交草稿（场景三格 / JSON 批量 / 剧情与日志文本）、
                      //             选中场次与展开面（_current / _editScene / _showShare / _face 皆为视图态），
                      //             换会话必须丢草稿重取，必须进表
    'lofterApp'       // [v3.34.0] 老福特：有未提交草稿（短文批量 / 续章正文 / 评论框 / 三处作者与文风格）、
                      //             选中面与展开项（_article / _collection / _myFace / _promptFor / _replyTo
                      //             皆为视图态），换会话必须丢草稿重取，必须进表
];"""
patch('index.js', D_OLD, D_NEW, 'index.js 重绑表')

# ---------- ④ scripts/keys-audit.mjs ----------
E_OLD = """  { key: 'date_store', scope: 'chat', note: '[v3.31.0] 约会场次与欠账（出资分配不变量「我出的 + Ta 出的 = 花费」；不碰任何余额）' },"""
E_NEW = """  { key: 'date_store', scope: 'chat', note: '[v3.31.0] 约会场次与欠账（出资分配不变量「我出的 + Ta 出的 = 花费」；不碰任何余额）' },
  { key: 'lofter_settings', scope: 'chat', note: '[v3.34.0] 老福特设置（列表面 / 每章篇幅 / 每轮条数 / 文风库）' },
  { key: 'lofter_content', scope: 'chat', note: '[v3.34.0] 老福特内容（自建作者 + 稿子 + 合集；超上限如实计数后裁剪）' },
  { key: 'lofter_store', scope: 'chat', note: '[v3.34.0] 老福特互动（关注 / 订阅 tag 与合集 / 我的四个列表各自独立）' },"""
patch('scripts/keys-audit.mjs', E_OLD, E_NEW, 'keys-audit 三键')

# ---------- ⑤ tests/system-v255.test.mjs ----------
F_OLD = """    dateApp: 'date'            // [v3.31.0] 约会大作战：换会话丢草稿（场景三格 / 剧情与日志）与视图态（_current / _editScene）并全量重取
  };"""
F_NEW = """    dateApp: 'date',           // [v3.31.0] 约会大作战：换会话丢草稿（场景三格 / 剧情与日志）与视图态（_current / _editScene）并全量重取
    lofterApp: 'lofter'        // [v3.34.0] 老福特：换会话丢草稿（短文批量 / 续章 / 评论 / 作者与文风格）与视图态并全量重取
  };"""
patch('tests/system-v255.test.mjs', F_OLD, F_NEW, 'v255 dirMap')

print('\n五处接线完成。')
