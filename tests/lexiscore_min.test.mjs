// lexiscore 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/lexiscore/lexiscore-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
ok("导出 tokenize", typeof M.tokenize === "function");
ok("大小写归一 + 切词", JSON.stringify(M.tokenize("Hello, WORLD")) === JSON.stringify(["hello","world"]));
ok("空查询零 token", M.tokenize("").length === 0);
ok("负控制：null 查询零 token", M.tokenize(null).length === 0);
ok("trimRows(null) 得空 rows", M.trimRows(null).rows.length === 0);
ok("trimRows 超限报 dropped", (()=>{const t=M.trimRows([1,2,3],2);return t.rows.length===2&&t.dropped===1;})());
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
