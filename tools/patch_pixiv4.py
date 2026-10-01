#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch_pixiv4.py — v3.35.0 六处接线（照 v3.34.0 老福特那一版逐处对位）。

① config/apps.js      App 注册条目（含注释块：取哪几块 / 四块不缝 / 三条偏离）
② config/storage.js   会话键前缀 /^pixiv_/
③ index.js            入口重绑表 + 懒加载分支
④ scripts/keys-audit.mjs 登记三条会话键
⑤ tests/system-v255.test.mjs 目录映射 pixivApp: 'pixiv'
⑥ phone.css           样式段（段头**独立成行**）

★ 每一处的锚点都要求「命中恰 1 次」，否则拒改（幂等：跑第二遍会全 FAIL 提示已改过）。
★ 目标含 JS：改完用 node --check 逐个复核。
"""
import os
import subprocess
import sys
import tempfile

FAILS = []


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def node_check(path):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode != 0:
        FAILS.append('%s 语法不合法: %s' % (path, (r.stderr or '').strip()[:300]))


def patch(path, anchor, insert, where='after', check=True):
    """在 anchor 之后（默认）或之前插入 insert；anchor 命中次数必须恰为 1。"""
    text = read(path)
    n = text.count(anchor)
    if n != 1:
        FAILS.append('%s 锚点命中 %d 次（应恰 1 次）：%r' % (path, n, anchor[:60]))
        return
    out = text.replace(anchor, (anchor + insert) if where == 'after' else (insert + anchor), 1)
    write(path, out)
    if check and (path.endswith('.js') or path.endswith('.mjs')):
        node_check(path)


# ---------------------------------------------------------------- ① apps.js
APPS_ANCHOR = """        id: 'lofter',
        name: '老福特',
        icon: '🖋',
        color: '#38bdf8',
        badge: 0,
        data: {}
    },
"""
APPS_INSERT = """    {
        // [v3.35.0] Pixiv：日文同人平台（缝合自 Perigee js/pixiv-illust.js 1411 行 +
        //   js/pixiv-novel.js 3888 行 + js/pixiv-comments.js 563 行，共 5862 行 / 324763 字节）。
        //   源是一个挂在全局 AppState.data.pixivData 上（65 处命中）、以 Utils.saveData 整块回写
        //   （38 处命中）的仿真：插画生成 / 小说连载 / 文风库 / 评论楼中楼四块齐备，
        //   且**自带三条生图链路 + 两条正文链路**（NovelAI / OpenAI 兼容 / OpenRouter；
        //   19 处网络调用）、插画 Blob 落 IndexedDB（IllustGallery）、还要 twitterData.fanFriends
        //   当作者池、要 broadcast.plotProgress 当题材源、要 forumData.threads 当分享出口。
        //   取五块：① 作品面（列表 / 分月 / tag / 本地检索）② 阅读器（目录 + 逐章点赞 + 正文渲染）
        //   ③ 续章滑窗（最近 5 章全文、更早给梗概）④ 评论楼中楼 ⑤ 我的四格 + 插画登记面。
        //   设置面取「文风库 + 语言模式（日文正文 / 中文折叠译文）」。
        //   四块不缝：① **不直连任何模型**（源自己读 imageApiConfig.provider 决定走哪条链路）——
        //   本件一个网络调用都没有：生成走两条合法通道，视图摆出可复制的要求文本、结果由用户贴回来；
        //   ② **不落 IndexedDB、不碰宿主对象**（源把插画 Blob 落 IllustGallery、把卡片往宿主消息数组
        //   push）—— 本件零数据库、零宿主写入；③ **不共用别的 App 的池**（源要推特粉丝池 / 广播题材
        //   源 / 论坛分享出口）—— 本件自带 9 位原创写手，零跨 App 读；④ **一张图都不存、一条外链
        //   都不收**（源存生图 URL 与外链封面、把 Blob 转 base64 data URL 塞帖）—— 插画面是
        //   **登记面**，只存「提示词 / 尺寸 / 张数 / 收藏 / 谁画的」，没有任何地址字段，视图不渲染 img。
        //   三条偏离：① 心数模型收成唯一确定性实现 deriveHeatBase / deriveChapterHearts
        //   （源 _rollHeatBase 掷随机、_rollChapterHearts 再乘一次随机，同一作品每次读数不同且
        //   缓存与逐章永久不一致）—— 本件同一 (fc, cold) 必得同一读数、hearts 恒等于逐章最高；
        //   ② 评论树深度有显式上限、上溯带访问集（源 _topAncestorId 只靠 guard < 50 步数上限，
        //   数据自指时停但**不报告**）—— 本件把 truncated / orphans 分开报；
        //   ③ 译文折叠块走**白名单**不走转义器耦合（源 _sanitizeDetailsBlock 靠 [^&] 匹配，
        //   自己注释里写明「勿收编 Utils.escapeHtml」）—— 本件扫字符流逐标签判白名单。
        //   写盘三条键走 ^pixiv_ 前缀随会话隔离。
        id: 'pixiv',
        name: 'Pixiv',
        icon: '🎨',
        color: '#818cf8',
        badge: 0,
        data: {}
    },
"""

# ---------------------------------------------------------------- ② storage.js
STORAGE_ANCHOR = """            /^lofter_/,
"""
STORAGE_INSERT = """            // [v3.35.0] Pixiv（pixiv_settings / pixiv_content / pixiv_store）：
            //   一条前缀覆盖三键（无元字符、无需宽匹配登记）。
            //   作者池、作品、章与评论、插画登记、四本账都是「这段关系的账」，
            //   随会话隔离：换角色后那是另一个人的另一批作品。
            /^pixiv_/,
"""

# ---------------------------------------------------------------- ③ index.js
INDEX_TABLE_ANCHOR = """    'lofterApp'       // [v3.34.0] 老福特：有未提交草稿（短文批量 / 续章正文 / 评论框 / 三处作者与文风格）、
                      //             选中面与展开项（_article / _collection / _myFace / _promptFor / _replyTo
                      //             皆为视图态），换会话必须丢草稿重取，必须进表
"""
INDEX_TABLE_INSERT = """,
    'pixivApp'        // [v3.35.0] Pixiv：有未提交草稿（作品三格 / 续章正文 / 评论框 / 插画登记 / 文风与作者）、
                      //             选中面与展开项（_open / _myFace / _promptFor / _replyTo / _chapter
                      //             皆为视图态），换会话必须丢草稿重取，必须进表
"""
INDEX_LAZY_ANCHOR = """                } else if (appId === 'widget') {"""
INDEX_LAZY_INSERT = """                } else if (appId === 'pixiv') {
                    // [v3.35.0] Pixiv：日文同人平台（缝合自 Perigee pixiv 三片 5862 行）。
                    //   取五块：作品面 / 阅读器与逐章点赞 / 续章滑窗 / 评论楼中楼 / 我的四格与插画登记；
                    //   设置面取文风库与语言模式。
                    //   四块不缝：不直连任何模型（源自带三条生图链路 + 两条正文链路、19 处网络调用）
                    //   —— 改摆可复制的要求文本，结果由用户贴回来；不落 IndexedDB 也不碰宿主对象
                    //   （源把插画 Blob 落 IllustGallery、把卡片往宿主消息数组 push）；不共用别的 App
                    //   的池（源要推特粉丝池 / 广播题材源 / 论坛分享出口，本件自带 9 位原创写手）；
                    //   一张图都不存、一条外链都不收（插画面是登记面，只有提示词 / 尺寸 / 张数 / 谁画的）。
                    //   三条偏离：心数收成唯一确定性实现（源掷两次随机、缓存与逐章永久不一致）；
                    //   评论树深度有上限、上溯带访问集（源只靠 guard < 50）；译文折叠块走白名单
                    //   不走转义器耦合。写盘三条键走 ^pixiv_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/pixiv/pixiv-app.js'), './apps/pixiv/pixiv-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.pixivApp) {
                                window.VirtualPhone.pixivApp = new module.PixivApp(phoneShell, storage);
                            }
                            window.VirtualPhone.pixivApp.render();
                        })
                        .catch(err => {
                            console.error('❌ 加载PixivApp失败:', err);
                            phoneShell?.showNotification('错误', 'PixivApp加载失败', '❌');
                        });
"""

# ---------------------------------------------------------------- ④ keys-audit.mjs
KEYS_ANCHOR = """  { key: 'lofter_store', scope: 'chat', note: '[v3.34.0] 老福特互动（关注 / 订阅 tag 与合集 / 我的四个列表各自独立）' },
"""
KEYS_INSERT = """  { key: 'pixiv_settings', scope: 'chat', note: '[v3.35.0] Pixiv设置（语言模式 / 默认文风 / 隐藏无正文作品 / 字号 / 文风库）' },
  { key: 'pixiv_content', scope: 'chat', note: '[v3.35.0] Pixiv内容（自建作者 + 作品 + 章与评论 + 插画登记；超上限如实计数后裁剪）' },
  { key: 'pixiv_store', scope: 'chat', note: '[v3.35.0] Pixiv互动（关注作者 / 订阅 tag / 收藏 / 追更 / 浏览记录各自独立）' },
"""

# ---------------------------------------------------------------- ⑤ v255 目录映射
V255_ANCHOR = """    lofterApp: 'lofter'        // [v3.34.0] 老福特：换会话丢草稿（短文批量 / 续章 / 评论 / 作者与文风格）与视图态并全量重取
"""
V255_INSERT = """,
    pixivApp: 'pixiv'          // [v3.35.0] Pixiv：换会话丢草稿（作品三格 / 续章正文 / 评论 / 插画登记 / 文风与作者）与视图态并全量重取
"""


def main():
    patch('config/apps.js', APPS_ANCHOR, APPS_INSERT)
    patch('config/storage.js', STORAGE_ANCHOR, STORAGE_INSERT, check=False)
    patch('index.js', INDEX_TABLE_ANCHOR, INDEX_TABLE_INSERT)
    patch('index.js', INDEX_LAZY_ANCHOR, INDEX_LAZY_INSERT, where='before')
    patch('scripts/keys-audit.mjs', KEYS_ANCHOR, KEYS_INSERT, check=False)
    patch('tests/system-v255.test.mjs', V255_ANCHOR, V255_INSERT, check=False)

    # ⑥ phone.css：段头独立成行 + apps/pixiv/pixiv.css 正文（跳过其首行注释，段头自己写）
    css = read('apps/pixiv/pixiv.css').split('\n')
    body = '\n'.join(css[1:]).lstrip('\n')
    phone = read('phone.css')
    if '.pxv-root' in phone:
        FAILS.append('phone.css 里已经有 .pxv-root（本段已投递过）')
    else:
        seg = ('\n/* ---------- [v3.35.0] Pixiv App（.pxv-*） ---------- */\n'
               '/* 缝合自 Perigee pixiv 三片（插画 / 小说 / 评论）。四块不缝：不直连任何模型 /\n'
               '   不落 IndexedDB 也不碰宿主对象 / 不共用别的 App 的池 / 一张图都不存也不收外链。\n'
               '   样式投递走机制 A（打包进本文件）。 */\n' + body)
        write('phone.css', phone.rstrip('\n') + '\n' + seg)
        print('OK phone.css 追加 Pixiv 段（段头独立成行）')

    if FAILS:
        print('FAIL:')
        for f in FAILS:
            print('  · ' + f)
        return 1
    print('OK 六处接线全部落地')
    return 0


if __name__ == '__main__':
    sys.exit(main())