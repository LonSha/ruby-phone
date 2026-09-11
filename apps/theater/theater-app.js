import { TheaterData } from './theater-data.js';
import { TheaterView } from './theater-view.js';

export class TheaterApp {
  constructor(phoneShell, storage) {
    this.phoneShell = phoneShell;
    this.storage = storage;
    this.data = new TheaterData(storage);
    this.view = new TheaterView(this);
  }

  render() {
    this.view.render(this.phoneShell.screen);
  }
}

export default TheaterApp;