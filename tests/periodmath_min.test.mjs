// periodmath 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/periodmath/periodmath-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 dayDiff", typeof M.dayDiff === "function");
ok("跨一天 = 1", M.dayDiff(0, 86400000) === 1);
ok("负控制：同一时刻 = 0", M.dayDiff(5, 5) === 0);
ok("负控制：null 入参得 null", M.dayDiff(null, 1) === null);
nothrow("normalizeCycle 空对象不抛", ()=>M.normalizeCycle({},0));
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
