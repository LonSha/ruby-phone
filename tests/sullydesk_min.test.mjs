// sullydesk 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/sullydesk/sullydesk-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 isSafeField", typeof M.isSafeField === "function");
ok("负控制：未知字段判不安全", M.isSafeField("zzz_not_a_field") === false);
ok("凭据名被识别", M.fieldNameLooksCredential("apiKey") === true);
ok("toStr 类型严格：数字给空串", M.toStr(1) === "");
ok("toStr 保留字符串", M.toStr("x") === "x");
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
