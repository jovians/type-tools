import { Entity } from './ix.entity';

export class HalfLifed extends Entity {
  /** half-life in seconds */
  hl: number = 86400;
  hlInvertedMs: number = 0;
  last: number = Date.now();
  threshold: number = 0.000001;
  ticker: { type: string; data: any } = null;
  valueData: number = 0;
  frozen = false;
  v?: number;
  afterUpdate: ((self: HalfLifed, value: number) => any)[] = [];
  afterEachTick: ((self: HalfLifed, value: number) => any)[] = [];
  constructor(init: Partial<HalfLifed>) {
    super('halflifed');
    Object.assign(this, init);
    if (this.hl < 0.01) { this.hl = 0.01; }
    this.hlInvertedMs = 1 / (this.hl * 1000); // turn into ms and invert
    if (init.v !== undefined) { this.value = init.v; }
    this.addOnDestroy(() => {
      this.unlinkTicker();
      this.afterUpdate.length = 0;
      this.afterEachTick.length = 0;
    });
  }
  get value() { this.update(); return this.valueData; }
  set value(v) { this.valueData = v; this.last = Date.now(); }
  add(v: number) {
    if (!Number.isFinite(v) || v <= 0) { return this; }
    this.update();
    this.valueData += v;
    this.trim();
    return this.afterValueChange();
  }
  sub(v: number) {
    if (!Number.isFinite(v) || v <= 0) { return this; }
    this.update();
    this.valueData -= v;
    this.trim();
    return this.afterValueChange();
  }
  mul(v: number) {
    if (!Number.isFinite(v) || v < 0) { return this; }
    this.update();
    this.valueData *= v;
    this.trim();
    return this.afterValueChange();
  }
  div(v: number) {
    if (!Number.isFinite(v) || v <= 0) { return this; }
    this.update();
    this.valueData /= v;
    this.trim();
    return this.afterValueChange();
  }
  reset(v = 0) {
    this.value = v;
    this.trim();
    return this.afterValueChange();
  }
  afterValueChange() {
    for (const afterUpdateCb of this.afterUpdate) { afterUpdateCb(this, this.valueData); }
    return this;
  }
  update() {
    if (this.frozen) { return this; }
    const now = Date.now();
    if (this.valueData > 0) {
      const deltaMs = now - this.last;
      if (deltaMs > 0) {
        this.valueData = this.valueData * Math.pow(0.5, deltaMs * this.hlInvertedMs);
        this.trim();
      }
    }
    this.last = now;
    return this;
  }
  linkTicker(callbackkMap: {[id: string]: HalfLifed}) {
    this.unlinkTicker();
    callbackkMap[this.ixId] = this;
    this.ticker = {
      type: 'linked',
      data: callbackkMap,
    };
    return this;
  }
  trim() {
    if (this.valueData < this.threshold || !Number.isFinite(this.valueData)) {
      this.valueData = 0;
    }
    return this;
  }
  unlinkTicker() {
    if (!this.ticker) { return this; }
    if (this.ticker.type === 'default') {
      clearInterval(this.ticker.data);
    } else if (this.ticker.type === 'linked') {
      const callbackMap: {[id: string]: HalfLifed} = this.ticker.data;
      if (callbackMap[this.ixId]) {
        delete callbackMap[this.ixId];
      }
    }
    this.ticker = null;
    return this;
  }
  tick() {
    this.update();
    if (this.afterEachTick.length > 0) {
      for (const afterEachTick of this.afterEachTick) {
        afterEachTick(this, this.valueData);
      }
    }
    return this;
  }
  startTicker(type = 'default', intervalMs = 1000, afterEachTick: (self: HalfLifed, value: number) => any = null) {
    this.unlinkTicker();
    if (!type) { type = 'default'; }
    if (type === 'default') {
      if (afterEachTick) { this.afterEachTick.push(afterEachTick); }
      this.ticker = {
        type: 'default',
        data: setInterval(() => { this.tick(); }, intervalMs)
      };
    }
    return this;
  }
  afterTick(afterTickCallback: (self: HalfLifed, value: number) => any) {
    this.afterEachTick.push(afterTickCallback);
    return this;
  }
}
