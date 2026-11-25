#!/usr/bin/env node
/* 把 update-log.json 顶部插入一个新版本条目，latest 指向它。
   用法: node tools/bump-update-log.mjs 4.201.0 "标题" "条目1" "条目2" ... */
import fs from 'fs';
const [ver, title, ...items] = process.argv.slice(2);
if (!ver || !title) {
    console.error('用法: node tools/bump-update-log.mjs <版本> <标题> [条目...]');
    process.exit(1);
}
const p = 'update-log.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
if (d.versions[ver]) {
    console.error('版本已存在:', ver);
    process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);
d.versions = Object.fromEntries(
    [[ver, { version: ver, date, title, items }], ...Object.entries(d.versions)]
);
d.latest = ver;
/* head 与 latest 是两个字段，但所有同名断言都要求它们相等
 *   （tests/system-v4460：head 必须跟上 latest；system-v4188：五源同源 head = 当前版本）。
 *   本工具首版只写 latest，落地就会让「升版本」这一步自带一条红 —— 工具漏一个字段，
 *   下游得靠测试才发现，正是这类脚本最该修的地方。 */
d.head = ver;
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
console.log('已插入', ver, '条目数', items.length, 'latest =', d.latest, 'head =', d.head);
