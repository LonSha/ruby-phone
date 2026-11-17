// accessdesk 最小判据（R22-O6）
import * as V from '../apps/accessdesk/accessdesk-view.js';
import * as A from '../apps/accessdesk/accessdesk-app.js';
let pass=0,fail=0;
const ok=(n,c)=>{if(c){pass++;console.log("✓ "+n);}else{fail++;console.log("✗ "+n);}};
ok("导出 AccessdeskView", typeof V.AccessdeskView === "function");
ok("导出 AccessdeskApp", typeof A.AccessdeskApp === "function");
ok("View 有 render", typeof V.AccessdeskView.prototype.render === "function");
ok("App 有 render", typeof A.AccessdeskApp.prototype.render === "function");
ok("App 有 selfCheck", typeof A.AccessdeskApp.prototype.selfCheck === "function");
ok("App 有 destroy", typeof A.AccessdeskApp.prototype.destroy === "function");

console.log(pass+" 通过, "+fail+" 失败");
process.exit(fail>0?1:0);
