// mofo 最小判据（R22-O6：可 import / 关键投影函数对 / 不抛）
import * as M from '../apps/mofo/mofo-data.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
const nothrow=(n,f)=>{try{f();ok(n,true);}catch(e){ok(n,false);console.log("  "+e.message);}};
import { MofoData } from '../apps/mofo/mofo-data.js';
const stub={get(){return null;},set(){},remove(){}};
ok("导出 MofoData", typeof MofoData === "function");
ok("有 renderTemplate", typeof MofoData.prototype.renderTemplate === "function");
ok("有 getBootstrapState", typeof MofoData.prototype.getBootstrapState === "function");
nothrow("构造不抛", ()=>new MofoData(stub));
nothrow("getBootstrapState 不抛", ()=>{const d=new MofoData(stub);d.getBootstrapState();});
console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
