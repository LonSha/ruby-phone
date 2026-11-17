// freehome 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/freehome/freehome-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 sizeOf", typeof M.sizeOf === "function");
ok("wide 小部件占 4 列", M.sizeOf({type:"widget",size:"wide"},null).width === 4);
ok("负控制：isInt 拒绝小数", M.isInt(1.5) === false);
ok("isInt 接受整数", M.isInt(2) === true);
ok("负控制：toStr(null) 为空串", M.toStr(null) === "");
nothrow("sizeOf 非对象不抛", ()=>M.sizeOf(null,null));
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
