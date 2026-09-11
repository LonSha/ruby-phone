import { BiliData } from './bili-data.js';
import { BiliView } from './bili-view.js';

export class BiliApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new BiliData(storage);
    this.view = new BiliView(this);
  }

  render() {
    this.view.render(this.phoneShell.screen);
  }
}

export default BiliApp;