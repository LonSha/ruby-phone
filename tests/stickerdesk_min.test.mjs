// stickerdesk 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/stickerdesk/stickerdesk-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 parseStickerLine", typeof M.parseStickerLine === "function");
ok("isHttpUrl 认 http", M.isHttpUrl("http://a.com/x.png") === true);
ok("负控制：ftp 不算 http", M.isHttpUrl("ftp://a") === false);
ok("负控制：空行解析为 null", M.parseStickerLine("") === null);
ok("负控制：注释行解析为 null", M.parseStickerLine("# comment") === null);
ok("含 url 的行解析出对象", M.parseStickerLine("name http://a.com/x.png") !== null);
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
