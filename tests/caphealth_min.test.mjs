// caphealth 最小判据（R22-O6）
import * as V from '../apps/caphealth/caphealth-view.js';
import * as A from '../apps/caphealth/caphealth-app.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
ok("导出 CaphealthView", typeof V.CaphealthView === "function");
ok("导出 CaphealthApp", typeof A.CaphealthApp === "function");
ok("View 有 render", typeof V.CaphealthView.prototype.render === "function");
ok("App 有 render", typeof A.CaphealthApp.prototype.render === "function");
ok("App 有 selfCheck", typeof A.CaphealthApp.prototype.selfCheck === "function");
ok("App 有 destroy", typeof A.CaphealthApp.prototype.destroy === "function");

console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
