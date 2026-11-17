// cardtable 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/cardtable/cardtable-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 tarotNameOf", typeof M.tarotNameOf === "function");
ok("大阿卡纳 22 张", M.CT_MAJOR.length === 22);
ok("四花色", M.CT_SUITS.length === 4);
ok("牌阶 14", M.CT_RANKS.length === 14);
ok("0 -> 愚者", M.tarotNameOf(0) === "愚者");
ok("22 -> 权杖Ace", M.tarotNameOf(22) === "权杖Ace");
ok("负控制：78 越界给空串", M.tarotNameOf(78) === "");
ok("负控制：非数字给空串", M.tarotNameOf("x") === "");
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
