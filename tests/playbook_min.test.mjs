// playbook 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/playbook/playbook-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
import { PlaybookData } from '../apps/playbook/playbook-data.js';
const stub={get(){return null;},set(){},remove(){}};
ok("导出 PlaybookData", typeof PlaybookData === "function");
ok("有 searchPlays", typeof PlaybookData.prototype.searchPlays === "function");
nothrow("构造不抛", ()=>new PlaybookData(stub));
nothrow("getCategories 返回数组", ()=>{const d=new PlaybookData(stub);if(!Array.isArray(d.getCategories()))throw new Error("not array");});
nothrow("负控制：searchPlays(null) 不抛", ()=>{const d=new PlaybookData(stub);d.searchPlays(null);});
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
