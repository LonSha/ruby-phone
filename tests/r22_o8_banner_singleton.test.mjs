// R22-O8 通知横幅单一实现判据
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bannerOf, bannerSelfCheck } from '../config/incoming-banner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/banner_singleton.json'), 'utf8'));
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/audit/banner_whitelist.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("✓ " + n); } else { fail++; console.log("✗ " + n); } };

ok("唯一桥自检通过", bannerSelfCheck().ok);

// 负控制：桥对空内容必须给 none（不许造一条假通知）
ok("负控制：空规格 none", bannerOf(null).face === "none");
ok("负控制：空标题正文 none", bannerOf({ title: "", body: "" }).face === "none");
ok("正例：字段透传", (() => {
    const r = bannerOf({ appId: "wechat", title: "新消息", body: "在吗" });
    return r.face === "banner" && r.banner.title === "新消息" && r.banner.body === "在吗";
})());

ok("扫描：未收口 = 0", L.pending === 0);
ok("扫描：走唯一桥 ≥ 12 处", L.routedCount >= 12);
ok("扫描：白名单 7 条", L.whitelistedCount === 7);
ok("扫描：无未登记站点（19 = 12 + 7）", L.totalSites === L.routedCount + L.whitelistedCount);

const noWhy = (W.entries || []).filter((e) => !e.why || !String(e.why).trim());
ok("白名单每条都有理由", (W.entries || []).length === 7 && noWhy.length === 0);

// 反向闸：登记了白名单的文件，必须真的**不**是走桥的（否则白名单掩盖了已收口项）
const routedFiles = new Set(L.sites.filter((s) => s.routed).map((s) => s.file));
const wrongWhite = (W.entries || []).filter((e) => routedFiles.has(e.file));
ok("负控制：白名单文件不是已走桥的文件", wrongWhite.length === 0);

// 三个 App 真的 import 了桥，不是靠台账声称
for (const f of ["apps/achievement/achievement-app.js", "apps/album/album-voice-view.js", "apps/games/mystery/mystery-view.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    ok(`${f.split("/")[1]} 引入了唯一桥`, src.includes("incoming-banner.js") && src.includes("bannerOf("));
}

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);