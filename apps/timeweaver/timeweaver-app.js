/* ========================================================
 * timeweaver-app.js — 织光机 App 控制器
 * 【完全原创】数字生活叙事引擎：主动聚合各 App 散落碎片，织成可回望的时光。
 * ======================================================== */
'use strict';
import { TimeweaverView } from './timeweaver-view.js';

export class TimeweaverApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new TimeweaverView(this);
    }

    render() {
        this.view.render();
    }
}

export default TimeweaverApp;