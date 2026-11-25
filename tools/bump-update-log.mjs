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
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
console.log('已插入', ver, '条目数', items.length, 'latest =', d.latest);
