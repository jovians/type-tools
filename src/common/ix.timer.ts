/* Jovian (c) 2020, License: MIT */

import { ixConfig } from './ix.config';
import { Entity } from './ix.entity';
import { errorCast } from './ix.error';
import { BoolLike } from './util/options.util';
import { promise, PromUtil } from './util/prom.util';

interface TimerIntervalBehavior<T = any> {
  data?: any;
  begun?: boolean;
  callback?: (bh: TimerIntervalBehavior<T>, reg: TimerRegistrant<T>) => any;
}

interface SharedTimerRegistration {
  reg: TimerRegistrant;
  once?: boolean;
}

interface TimerUnitTime {
  ms?: number;
  s?: number;
  m?: number;
  h?: number;
  d?: number;
  wk?: number;
  mo?: number;
  yr?: number;
}

interface RetryUntilResultOptions {
  backoff?: {
    type?: 'linear' | 'expo';
    start?: number;
    value?: number;
    max?: number;
  };
}

interface BackOffType { backoff: 'default' | 'expo' | 'linear'; }

export interface TimerOptions extends TimerUnitTime {
  /** UNIX Timestamp in ms */
  t?: number;
  name?: string;
  mode?: string;
  nowait?: BoolLike;
  endSharp?: BoolLike;
  defer?: BoolLike;
  forever?: BoolLike;
  count?: number;
  immediately?: BoolLike;
  startNow?: BoolLike;
}

export interface TimerTickSnapshot<T> {
  now: number;
  result: T;
  context: string;
  maxCount: number;
  count: number;
  nth: number;
  ordinal: number;
  elapsed: number;
  timer: Timer;
  error?: Error;
}


export class SharedTimerBlock extends Entity {
  name: string = '';
  active = true;
  started = false;
  startTime = 0;
  maxBlocks = 10000; // 10 seconds
  blockMs = 1; // 1 slot = 1 ms
  procCount = 1;
  procInterval = 1;
  controller: SharedTimer;
  replacedBy: SharedTimerBlock;
  replacing: SharedTimerBlock;
  lastRegister = 0;
  pendingCount = 0;
  notMsBlock = false;
  checkingLogic: (immediatesOnly?: boolean) => any;
  private procs: any[] = [];
  private immediates: SharedTimerRegistration[] = [];
  private timeblock: SharedTimerRegistration[][] = [];
  private timeblockCursor = 0;
  private maxMs = this.maxBlocks * this.blockMs;
  private last = 0;
  private totalHandledBlocksCount = 0;
  constructor(init?: Partial<SharedTimerBlock>) {
    super('timerblock');
    if (init) { Object.assign(this, init); }
    this.addOnDestroy(async () => { this.clearAllProcs(); });
    this.maxMs = this.maxBlocks * this.blockMs;
    this.notMsBlock = (this.blockMs > 1);
  }
  get maxSupportedMs() { return this.maxMs; }
  get totalHandledBlocks() { return this.totalHandledBlocksCount; }
  clearAllProcs() {
    this.checkingLogic(true); // clear out all immediates
    for (const proc of this.procs) { clearInterval(proc); }
  }
  setImmediate(reg: TimerRegistrant) {
    if (!reg.regStart) { reg.regStart = Date.now(); }
    if (!this.replacedBy) {
      const now = Date.now();
      this.lastRegister = now;
      this.immediates.push({reg});
    } else {
      this.getReplacement().setImmediate(reg);
    }
  }
  getReplacement() {
    let rpl = this.replacedBy;
    while (rpl.replacedBy) { rpl = rpl.replacedBy; }
    return rpl;
  }
  setImmediateOnce(reg: TimerRegistrant) {
    if (!reg.regStart) { reg.regStart = Date.now(); }
    if (!this.controller.started) { this.controller.startBlocks(); }
    if (!this.replacedBy) {
      const now = Date.now();
      this.lastRegister = now;
      this.immediates.push({reg, once: true});
    } else {
      const rpl = this.getReplacement();
      rpl.immediates.push({reg, once: true});
    }
  }
  setIntoBlock(reg: TimerRegistrant) {
    if (!this.replacedBy) {
      const now = Date.now();
      this.lastRegister = now;
      ++this.pendingCount;
      if (this.notMsBlock) {
        let adjusted = reg.blockInterval;
        adjusted += this.timeblockCursor; while (adjusted >= this.timeblock.length) { adjusted -= this.timeblock.length; }
        const spot = this.timeblock[adjusted];
        spot.push({reg});
        reg.regSpot = spot;
        reg.regLast = now;
      } else {
        if (reg.nowait && reg.blockInterval > 0 && reg.regLast > 0) { // precise ms control
          const overflow = now - reg.regLast - reg.blockInterval + reg.regOverflow;
          let adjusted = reg.blockInterval - overflow; if (adjusted < 0) { adjusted = 0; }
          adjusted += this.timeblockCursor; while (adjusted >= this.timeblock.length) { adjusted -= this.timeblock.length; }
          const spot = this.timeblock[adjusted];
          spot.push({reg});
          reg.regSpot = spot;
          reg.regOverflow = overflow;
        } else {
          let adjusted = reg.blockInterval;
          adjusted += this.timeblockCursor; while (adjusted >= this.timeblock.length) { adjusted -= this.timeblock.length; }
          const spot = this.timeblock[reg.blockInterval];
          spot.push({reg});
          reg.regSpot = spot;
          reg.regLast = now;
        }
      }
      reg.regLast = now;
      reg.timerblock = this;
      reg.controller = this.controller;
    } else {
      this.getReplacement().setIntoBlock(reg);
    }
  }
  register(reg: TimerRegistrant) {
    if (!reg.regStart) { reg.regStart = Date.now(); }
    if (!this.controller.started) { this.controller.startBlocks(); }
    if (reg.immediate || reg.ms < 1) {
      this.controller.baseblock.setImmediate(reg);
    } else {
      if (!this.replacedBy) {
        this.setIntoBlock(reg);
      } else {
        this.getReplacement().setIntoBlock(reg);
      }
    }
    return reg;
  }
  start() {
    if (this.started) { return; }
    this.started = true;
    this.startTime = Date.now();
    this.last = Date.now();
    this.timeblock.length = this.maxBlocks;
    for (let i = 0; i < this.maxBlocks; ++i) { this.timeblock[i] = []; }
    this.checkingLogic = (immediatesOnly: false) => {
      const now = Date.now();
      const repeatersList: TimerRegistrant[] = [];
      // Handle immediates
      for (let j = 0; j < this.immediates.length; ++j) {
        this.handleRegistration(this.immediates[j], now, repeatersList);
      }
      this.immediates = [];
      this.handlerRepeatersIfAny(repeatersList);
      if (immediatesOnly) { return; }
      // Handle timed blocked
      const delta = now - this.last; if (delta === 0) { return; }
      const rawDelta = this.notMsBlock ? delta / this.blockMs : delta;
      const blockCountToHandle = this.notMsBlock ? Math.floor(delta / this.blockMs) : delta;
      if (blockCountToHandle === 0) { return; }
      if (this.notMsBlock) {
        const timeOvercounted = Math.round((rawDelta - blockCountToHandle) * this.blockMs);
        this.last = now - timeOvercounted;
      } else {
        this.last = now;
      }
      if (this.timeblock.length === 0) { this.clearAllProcs(); return; }
      const blockCountToHandleSafe = Math.min(blockCountToHandle, this.timeblock.length);
      for (let j = 0; j < blockCountToHandleSafe; ++j) {
        let index = this.timeblockCursor + j; while(index >= this.timeblock.length) { index -= this.timeblock.length; }
        const ontheblock = this.timeblock[index];
        for (const streg of ontheblock) {
          --this.pendingCount;
          this.handleRegistration(streg, now, repeatersList);
        }
        if (!this.replacedBy) {
          this.timeblock[index] = [];
        } else if (this.timeblock.length === 0) {
          this.clearAllProcs();
          break;
        }
      }
      this.timeblockCursor += blockCountToHandleSafe;
      while (this.timeblockCursor >= this.timeblock.length) { this.timeblockCursor -= this.timeblock.length; }
      this.handlerRepeatersIfAny(repeatersList);
      this.totalHandledBlocksCount += blockCountToHandleSafe;
    };
    for (let i = 0; i < this.procCount; ++i) {
      this.procs.push(setInterval(this.checkingLogic, this.procInterval));
    }
  }
  private handlerRepeatersIfAny(repeatersList: TimerRegistrant[]) {
    if (repeatersList.length > 0) {
      for (const reg of repeatersList) {
        reg.timerblock.setIntoBlock(reg);
      }
      repeatersList.length = 0;
    }
  }
  private handleRegistration(streg: SharedTimerRegistration, now: number, repeatersList: TimerRegistrant[]) {
    const reg = streg.reg;
    if (!reg.active) { return; }
    reg.last = now;
    if (!reg.paused && reg.skipCount === 0) {
      reg.pre?.(reg);
      reg.callback(reg);
      const ibhKeys = reg.intervalBehavior ? Object.keys(reg.intervalBehavior) : null;
      if (ibhKeys && ibhKeys.length > 0) {
        for (const ibhKey of ibhKeys) {
          const bh = reg.intervalBehavior[ibhKey];
          bh.callback?.(bh, reg);
        }
      }
      reg.post?.(reg);
    }
    if (reg.skipCount > 0) { --reg.skipCount; }
    if (reg.repeat) {
      if (!reg.waitBeforeRepeat) {
        repeatersList.push(reg);
      } else {
        ++this.pendingCount;
        reg.waitBeforeRepeat.then(async () => {
          if (reg.regSpot) { --this.pendingCount; }
          if (reg.active && reg.repeat) {
            reg.timerblock.setIntoBlock(reg);
          }
        });
        reg.waitBeforeRepeat = null;
      }
    }
  }
}

export class SharedTimer extends Entity {
  name: string = '';
  baseblock: SharedTimerBlock;
  timerblocks: SharedTimerBlock[] = [];
  started = false;
  checkerId: any;
  constructor(rubric: { name: string; timerblocks: Partial<SharedTimerBlock>[]}) {
    super('shared-timer');
    this.name = rubric.name;
    for (const timerBlockConfig of rubric.timerblocks) {
      const timerblock = new SharedTimerBlock(timerBlockConfig);
      timerblock.controller = this;
      timerblock.lcManagedBy(this);
      this.timerblocks.push(timerblock);
    }
    this.baseblock = this.timerblocks[0];
    this.addOnDestroy(() => {
      if (this.checkerId) { clearInterval(this.checkerId); }
    });
  }
  startBlocks() {
    if (this.started) { return this; }
    this.started = true;
    for (const timerblock of this.timerblocks) { timerblock.start(); }
    return this;
  }
  endOnEmpty(checkingInterval: number = 200) {
    if (this.checkerId) { return this; }
    this.checkerId = setInterval(() => {
      let totalPending = 0;
      for (const timerblock of this.timerblocks) { totalPending += timerblock.pendingCount; }
      if (totalPending === 0) { this.destroy(); }
    }, checkingInterval);
    return this;
  }
  setPrecision(level: 'max' | 'ultra' | 'super' | 'faster' | 'default' | 'slower' | 'lazy' | 'superlazy' | 'ultralazy') {
    let procInterval = this.baseblock.procInterval;
    switch (level) {
      case 'max': procInterval = 0; break;
      case 'ultra': procInterval = 1; break;
      case 'super': procInterval = 2; break;
      case 'faster': procInterval = 5; break;
      case 'default': procInterval = 10; break;
      case 'slower': procInterval = 20; break;
      case 'lazy': procInterval = 33; break;
      case 'superlazy': procInterval = 50; break;
      case 'ultralazy': procInterval = 100; break;
      default: return;
    }
    if (this.baseblock.procInterval !== procInterval) {
      const oldBlock = this.baseblock;
      const newBlock = new SharedTimerBlock({
        name: oldBlock.name,
        procInterval,
        procCount: oldBlock.procCount,
        blockMs: oldBlock.blockMs,
        maxBlocks: oldBlock.maxBlocks,
      });
      newBlock.controller = this;
      newBlock.replacing = oldBlock;
      newBlock.start();
      oldBlock.replacedBy = newBlock;
      this.baseblock = this.timerblocks[0] = newBlock;
    }
    return this;
  }
}

export const mainSharedTimer = new SharedTimer({
  name: 'main', timerblocks: [
    { name: 'up to 10s', procInterval: 1, blockMs: 1, maxBlocks: 10000 },
    { name: 'up to 10m', procInterval: 200, blockMs: 100, maxBlocks: 6000 },
    { name: 'up to 10h', procInterval: 1000, blockMs: 10000, maxBlocks: 3600 },
    { name: 'up to 10d', procInterval: 1000, blockMs: 120000, maxBlocks: 7200 },
    { name: 'up to 3mo', procInterval: 1000, blockMs: 10800000, maxBlocks: 720 },
  ]
});
mainSharedTimer.addOnDestroy(() => { ixConfig.sleepFunctions.useSharedTimer = false; });

export class Timer<T = any> extends Entity {
  static allActiveTimers: {[key: string]: Timer<any>} = {};
  name = '';
  options: TimerOptions;
  maxCount = 1;
  count = 0;
  paused = false;
  started = false;
  ended = false;
  finished = false;
  startTime: number = -1;
  endTime: number = -1;
  finishTime: number = -1;
  deltaEnd: number = -1;
  deltaFinish: number = -1;
  deltaEndFinish: number = -1;
  lastTick: number = -1;
  lastExec: number = -1;
  autoDestroy = false;
  result: T = null;
  error: Error = null;
  reg = new TimerRegistrant<Timer<T>>({ source: this });
  regWatch: TimerRegistrant<Timer<T>>;
  private interval: number = 1000;
  private ontick: (e: TimerTickSnapshot<T>) => any;
  private onwatchtick: (e: Timer<T>) => any;
  private cond: ((timer: Timer) => boolean) | boolean = null;
  private endResolves: ((timer: Timer) => any)[] = [];
  private finishResolves: ((timer: Timer) => any)[] = [];
  private lingeringLogic: {[key: string]: Promise<any>} = {};
  private endOnResult = false;
  private executing = false;
  private execProm: Promise<T>;
  constructor(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
    super('timer');
    if (!spec) { spec = {}; }
    if (typeof spec === 'number') { spec = { ms: spec }; }
    this.options = spec;
    this.ontick = ontick ? ontick : () => {};
    this.interval = this.fromUnit(this.options);
    if (this.interval <= 0) { this.interval = 1000; }
    this.name = this.options.name ? this.options.name : `(timer-${this.ixId})`;
    this.addOnDestroy(() => { this.end(); });
    if (this.options.count !== null && this.options.count !== undefined) { this.maxCount = this.options.count; }
    if (this.options.forever) { this.maxCount = 0; }
    if (!this.options.defer) {
      const startNow = this.options.immediately || this.options.startNow;
      this.nudge(startNow ? { immediately: true } : null);
    }
  }
  get ordinal() { return this.count + 1; }
  get nth() { return this.count + 1; }
  get elapsed() { return this.startTime < 0 ? 0 : Date.now() - this.startTime; }
  get now() { return Date.now(); }
  get endPromise() { return new Promise<Timer>(resolve => this.ended ? resolve(this) : this.endResolves.push(resolve)); }
  get finishPromise() { return new Promise<Timer>(resolve => this.finished ? resolve(this) : this.finishResolves.push(resolve)); }
  get beforetick$() { return this.ixRx<TimerTickSnapshot<T>>('beforetick').obs(); }
  get tick$() { return this.ixRx<TimerTickSnapshot<T>>('tick').obs(); }
  get aftertick$() { return this.ixRx<TimerTickSnapshot<T>>('aftertick').obs(); }
  get end$() { return this.ixRx<Timer<T>>('end').obs(); }
  get finish$() { return this.ixRx<Timer<T>>('finish').obs(); }
  asPromise() { return this.finishPromise as Promise<Timer>; }
  runOnce() {
    if (this.ended) { return null; }
    this.lastTick = Date.now();
    if (this.startTime < 0) {
      this.started = true;
      this.startTime = Date.now();
    }
    if (this.paused) { return null; }
    let isPromise = false;
    const e = this.getSnapshot('');
    const preCondPassed = (this.cond !== false && this.cond === null || this.cond === true || (this.cond && this.cond(this)));
    if (preCondPassed && this.maxCount === 0 || this.count < this.maxCount) {
      e.context = 'beforetick';
      this.ixRx<TimerTickSnapshot<T>>('beforetick').next(e);
      try {
        this.executing = true;
        this.lastExec = Date.now();
        e.context = 'main';
        const res = this.ontick(e);
        isPromise = (res && res.then);
        if (isPromise) {
          const iterId = this.count + '';
          const iterProm = this.execProm = (res as Promise<T>);
          this.lingeringLogic[iterId] = iterProm;
          iterProm.then(r => {
            this.executing = false;
            this.result = e.result = r;
            this.error = e.error = null;
            if (this.lingeringLogic[iterId]) { delete this.lingeringLogic[iterId]; }
            e.context = 'aftertick-async';
            this.ixRx<TimerTickSnapshot<T>>('aftertick').next(e);
            if (this.result && this.endOnResult) { this.end(); }
            this.detectStopCond();
          }).catch(error => {
            this.executing = false;
            this.result = e.result = null;
            this.error = e.error = error;
            if (this.lingeringLogic[iterId]) { delete this.lingeringLogic[iterId]; }
            e.context = 'main-error-async';
            this.ixError(error, null, e);
            e.context = 'aftertick-async';
            this.ixRx<TimerTickSnapshot<T>>('aftertick').next(e);
            this.detectStopCond();
          });
        } else {
          this.executing = false;
          this.result = e.result = res;
          this.error = e.error = null;
        }
      } catch (error) {
        this.executing = false;
        this.error = e.error = error;
      }
      if (!e.error) {
        e.context = 'tick';
        this.ixRx<TimerTickSnapshot<T>>('tick').next(e);
      } else {
        e.context = 'main-error';
        this.ixError(e.error, null, e);
      }
      if (!isPromise) {
        e.context = 'aftertick';
        this.ixRx<TimerTickSnapshot<T>>('aftertick').next(e);
      }
      this.count += 1;
      if (this.result && this.endOnResult) { this.end(); }
    }
    if (!isPromise) { this.detectStopCond(); }
    return isPromise ? this.execProm : null;
  }
  start() {
    if (this.started) { return this; }
    this.started = true;
    this.startTime = Date.now();
    this.reg.nowait = !!this.options.nowait;
    this.reg.update({
      immediate: !!(this.options?.immediately || this.options?.startNow),
      ms: this.interval,
      repeat: true,
      callback: reg => {
        const res = this.runOnce();
        const needToWait = this.executing && !this.options.nowait;
        if (res && res.then && needToWait) {
          reg.waitBeforeRepeat = res;
        }
      }
    });
    this.reg.registerOn(mainSharedTimer);
    return this;
  }
  immediate() {
    this.options.startNow = this.options.immediately = true;
    return this;
  }
  pause() { this.paused = true; return this; }
  resume() { this.paused = false; return this; }
  nudge(options?: { immediately?: boolean }, beforenudge?: () => any) {
    if (options?.immediately) { this.options.immediately = true; }
    if (!this.started) {
      promise(resolve => setTimeout(resolve, 0)).then(() => {
        if (beforenudge) { beforenudge(); }
        this.start();
      });
    }
    return this;
  }
  watch(ms?: number, onwatchtick?: (e: Timer<T>) => any) {
    if (!ms) { ms = 1000; }
    if (onwatchtick) { this.onwatchtick = onwatchtick; }
    this.startRegCondCheck(ms);
    this.regWatch.callback = () => {
      if (this.onwatchtick) { this.onwatchtick(this); }
      if (this.cond && typeof this.cond !== 'boolean') {
        const passed = this.cond(this);
        if (!passed) { this.end(); }
      }
    };
    this.regWatch.registerOn(mainSharedTimer);
    this.regWatch.updateInterval(ms);
    return this;
  }
  attend(level: 'hyper' | 'super' | 'vigilant' | 'default' |
                'lazy' | 'lazier' | 'superlazy' | 'ultralazy' = 'default',
         onwatchtick?: (e: Timer<T>) => any) {
    switch (level) {
      case 'hyper': return this.watch(1, onwatchtick); // 1ms
      case 'super': return this.watch(10, onwatchtick); // 10ms
      case 'vigilant': return this.watch(100, onwatchtick); // 100 ms
      case 'default': return this.watch(null, onwatchtick); // 1000 ms
      case 'lazy': return this.watch(1000, onwatchtick); // 1 sec
      case 'lazier': return this.watch(10001, onwatchtick); // 10 sec
      case 'superlazy': return this.watch(60000, onwatchtick); // 1 min
      case 'ultralazy': return this.watch(600000, onwatchtick); // 10 min
      default: return this;
    }
  }
  stop() { return this.end(); }
  end() {
    if (this.ended) { return this; }
    if (this.startTime < 0) { this.started = true; this.startTime = Date.now(); }
    this.ended = true;
    this.endTime = Date.now();
    this.deltaEnd = this.endTime - this.startTime;
    if (this.reg) { this.reg.invalidate(); }
    if (this.regWatch) { this.regWatch.invalidate(); }
    this.ixRx<Timer<T>>('end').next(this);
    for (const resolve of this.endResolves) {
      try { resolve(this); } catch (error) {
        const e = this.getSnapshot('end-error');
        e.error = error;
        this.ixError(error, 1, e);
      }
    }
    const lingerIterationsKeys = Object.keys(this.lingeringLogic);
    const finishingNow = (this.options.endSharp || lingerIterationsKeys.length === 0);
    if (finishingNow) {
      this.finishingWrapUp();
    } else {
      const lingeringProms = lingerIterationsKeys.map(key => this.lingeringLogic[key]);
      PromUtil.allSettled(lingeringProms).then(() => { this.finishingWrapUp(); });
    }
    return this;
  }
  /**
   * ```txt
   * [-t-][main][-t-][main][-t-]...
   * ````
   */
  forever() {
    this.maxCount = 0;
    this.nudge();
    return this;
  }
  /**
   * ```txt
   * [main][-t-][main][-t-]...
   * ````
   */
  nowAndForever() {
    this.maxCount = 0;
    this.nudge({ immediately: true });
    return this;
  }
  /**
   * ```txt
   * [-t-][main][-t-][main][-t-]...[main]
   *      |--------- n count -----------|
   * ````
   * @param count how many time should the function execute
   */
  countUp(count?: number) {
    if (count <= 0 || !Number.isFinite(count)) {
      throw new Error(`'count' argument of value '${count} is not valid'`);
    }
    this.maxCount = count;
    this.nudge();
    return this;
  }
  /**
   * ```txt
   * [main][-t-][main][-t-]...[main]
   * |--------- n count -----------|
   * ````
   * @param count how many time should the function execute
   */
  countUpNow(count?: number) {
    if (count <= 0 || !Number.isFinite(count)) {
      throw new Error(`'count' argument of value '${count} is not valid'`);
    }
    this.maxCount = count;
    this.nudge({ immediately: true });
    return this;
  }
  /**
   * ```txt
   * [-t-][first][-t-][repeat1][-t-][repeat2]...[repeat-n]
   *                  |--------- repeat count -----------|
   * ````
   * @param count how many time should the function should *repeat* (first execution not counting)
   */
  repeatFor(count?: number) {
    if (count <= 0 || !Number.isFinite(count)) {
      throw new Error(`'count' argument of value '${count} is not valid'`);
    }
    return this.countUp(count + 1);
  }
  /**
   * ```txt
   * [first][-t-][repeat1][-t-][repeat2]...[repeat-n]
   *             |--------- repeat count -----------|
   * ````
   * @param count how many time should the function should *repeat* (first execution not counting
   */
  nowAndRepeatFor(count?: number) {
    if (count <= 0 || !Number.isFinite(count)) {
      throw new Error(`'count' argument of value '${count} is not valid'`);
    }
    return this.countUpNow(count + 1);
  }
  until(cond: ((timer: Timer) => boolean) | boolean) {
    this.cond = typeof cond === 'boolean' ? !cond : () => !cond(this);
    this.maxCount = 0;
    this.nudge();
    return this;
  }
  while(cond: ((timer: Timer) => boolean) | boolean) {
    this.maxCount = 0;
    this.cond = cond;
    this.nudge();
    return this;
  }
  nowAndWhile(cond: ((timer: Timer) => boolean) | boolean) {
    this.maxCount = 0;
    this.cond = cond;
    this.nudge({ immediately: true });
    return this;
  }
  untilTime(ts: number) {
    this.while(() => Date.now() <= ts);
    return this;
  }
  untilTimeNow(ts: number) {
    this.nowAndWhile(() => Date.now() <= ts);
    return this;
  }
  forDuration(t: TimerUnitTime) {
    const ms = this.fromUnit(t);
    if (ms < 0) { throw new Error(`Given profile has no time units in [ms,s,m,h,d,w,mo,yr]`); }
    const startTime = Date.now();
    this.while(() => Date.now() - startTime <= ms);
    return this;
  }
  forDurationNow(t: TimerUnitTime) {
    const ms = this.fromUnit(t);
    if (ms < 0) { throw new Error(`Given profile has no time units in [ms,s,m,h,d,w,mo,yr]`); }
    const startTime = Date.now();
    this.nowAndWhile(() => Date.now() - startTime <= ms);
    return this;
  }
  untilResult(type: BackOffType = { backoff: 'default' }, options?: RetryUntilResultOptions) {
    this.endOnResult = true;
    this.retryArgsPrep(type, 'untilResult', options);
    return this.while(() => this.result === null || this.result === undefined);
  }
  untilResultNow(type: BackOffType = { backoff: 'default' }, options?: RetryUntilResultOptions) {
    this.endOnResult = true;
    this.retryArgsPrep(type, 'untilResult', options);
    return this.nowAndWhile(() => this.result === null || this.result === undefined);
  }
  backOff(type: 'expo' | 'linear', max = 1200, value = 1, start = this.interval / 1000) {
    this.retryArgsPrep({backoff: type}, 'backOff', {backoff: {type, max, value, start}});
    return this.forever();
  }
  backOffNow(type: 'expo' | 'linear', max = 1200, value = 1, start = this.interval / 1000) {
    this.retryArgsPrep({backoff: type}, 'backOff', {backoff: {type, max, value, start}});
    return this.nowAndForever();
  }
  andOutputTime(nameProfile?: string) {
    this.finishPromise.then(() => {
      if (!nameProfile) { nameProfile = this.name; }
      // tslint:disable-next-line: no-console
      console['log'](
        `${nameProfile} took ${this.deltaFinish} ms.\n` +
        `  └─ start: ${this.startTime}, end: ${this.endTime}, finish: ${this.finishTime}\n` +
        (this.result ? `  └─ result: ${this.result}` : ``)
      );
    });
    return this;
  }
  andDestroy() {
    this.autoDestroy = true;
    if (this.endTime > 0) { this.destroy(); }
    return this;
  }
  newBackOffOptions(type: 'expo' | 'linear', max = 1200, value = 1, start = this.interval / 1000) {
    let profile: RetryUntilResultOptions;
    if (type === 'expo') {
      profile = { backoff: { type, start, value, max } };
    } else if (type === 'linear') {
      profile = { backoff: { type, start, value, max } };
    }
    return profile;
  }
  updateInterval(newIntervalMs: number) {
    this.reg.updateInterval(newIntervalMs);
  }
  newBackOffIntervalBehavior(options: RetryUntilResultOptions): TimerIntervalBehavior<Timer<T>> {
    return {
      data: {},
      begun: false,
      callback: bh => {
        const boConf = options.backoff;
        if (boConf) {
          if (!bh.begun) {
            this.interval = boConf.start * 1000;
            bh.begun = true;
          } else  {
            const maxMs = boConf.max * 1000;
            if (boConf.type === 'expo') {
              if (this.interval < maxMs) {
                this.interval *= (Math.E * boConf.value);
                if (this.interval > maxMs) { this.interval = maxMs; }
                this.updateInterval(this.interval);
              }
            } else if (boConf.type === 'linear') {
              if (this.interval < maxMs) {
                this.interval += boConf.value * 1000;
                if (this.interval > maxMs) { this.interval = maxMs; }
                this.updateInterval(this.interval);
              }
            }
          }
        }
      }
    };
  }
  private startRegCondCheck(ms: number) {
    if (!this.regWatch) {
      this.regWatch = new TimerRegistrant<Timer<T>>({
        source: this,
        ms, repeat: true, immediate: true
      });
    }
  }
  private getSnapshot(context: string) {
    const now = Date.now();
    const e: TimerTickSnapshot<T> = {
      now,
      result: this.result,
      context,
      maxCount: this.maxCount,
      count: this.count,
      nth: this.count + 1,
      ordinal: this.count + 1,
      elapsed: now - this.startTime,
      timer: this,
    };
    return e;
  }
  private detectStopCond() {
    const shouldStop = (this.cond === false || (this.cond && typeof this.cond !== 'boolean' && !this.cond(this)));
    if (shouldStop || (this.maxCount !== 0 && this.count === this.maxCount)) { this.end(); }
  }
  private fromUnit(units: TimerUnitTime) {
    let ms = -1;
    for (const unit of Object.keys(units)) {
      if (unit.length > 2 || unit === 't') { continue; } // units are one or two chars
      const n = units[unit]; if (!n || !Number.isFinite(n)) { continue; }
      if (unit === 'ms') { ms = n; break; }
      if (unit === 's') { ms = n * 1000; break; }
      if (unit === 'm') { ms = n * 60000; break; }
      if (unit === 'h') { ms = n * 3600000; break; }
      if (unit === 'd') { ms = n * 86400000; break; }
      if (unit === 'w') { ms = n * 604800000; break; }
      if (unit === 'mo') { ms = n * 2592000000; break; }
      if (unit === 'yr') { ms = n * 31536000000; break; }
    }
    return ms;
  }
  private retryArgsPrep(type: BackOffType = { backoff: 'default' }, context = 'default', options?: RetryUntilResultOptions) {
    const bhKey = `${this.ixId}-${context}`;
    if (type.backoff === 'default') {
      if (this.reg.intervalBehavior[bhKey]) { delete this.reg.intervalBehavior[bhKey]; }
    } else {
      const retryOptions = options ? options : this.newBackOffOptions(type.backoff);
      const bh = this.newBackOffIntervalBehavior(retryOptions);
      this.reg.intervalBehavior[bhKey] = bh;
    }
  }
  private finishingWrapUp() {
    if (this.finished) { return this; }
    this.finished = true;
    this.finishTime = Date.now();
    this.deltaFinish = this.finishTime - this.startTime;
    this.deltaEndFinish = this.finishTime - this.endTime;
    this.ixRx<Timer<T>>('finish').next(this);
    for (const resolve of this.finishResolves) {
      try { resolve(this); } catch (error) {
        const e = this.getSnapshot('finish-error');
        e.error = error;
        this.ixError(error, 1, e);
      }
    }
    if (this.autoDestroy) { this.destroy(); }
  }
}

export class TimerRegistrant<T = any> {
  source?: T;
  name?: string = '';
  controller?: SharedTimer;
  timerblock?: SharedTimerBlock;
  data?: any;
  ms?: number = -1;
  msBefore?: number = -2;
  immediate?: boolean = false;
  blockInterval?: number = -1;
  repeat?: boolean = false;
  waitBeforeRepeat?: Promise<any>;
  paused?: boolean = false;
  skipCount?: number = 0;
  active?: boolean = true;
  last?: number = 0;
  nowait?: boolean = false;
  regStart?: number = 0;
  regLast?: number = 0;
  regOverflow?: number = 0;
  regSpot?: SharedTimerRegistration[];
  pre?: (reg: TimerRegistrant) => any;
  callback?: (reg: TimerRegistrant) => any;
  intervalBehavior?: {[key: string]: TimerIntervalBehavior} = {};
  post?: (reg: TimerRegistrant) => any;
  constructor(init?: Partial<TimerRegistrant<T>>) {
    if (init) { Object.assign(this, init); }
    if (this.ms < 0) { this.ms = 0; }
    this.ms = Math.ceil(this.ms);
  }
  invalidate() {
    this.active = false;
    if (this.regSpot) {
      let i = 0;
      for (const regInfo of this.regSpot) {
        if (regInfo.reg === this) {
          --this.timerblock.pendingCount;
          this.regSpot.splice(i, 1);
          break;
        }
        ++i;
      }
    }
    this.regSpot = null;
  }
  update(updater?: Partial<TimerRegistrant<T>>) { if (updater) { Object.assign(this, updater); }}
  setImmediate() { this.controller?.baseblock?.setImmediate(this); return this; }
  registerOn(t?: SharedTimer) { this.updatePlacement(t)?.register(this); return this; }
  updateInterval(newMs: number) { this.ms = Math.ceil(newMs); this.updatePlacement(); }
  updatePlacement(t?: SharedTimer) {
    if (!t) { t = this.controller; if (!t) { return null; } }
    if (t !== this.controller) {
      this.msBefore = -1;
      this.timerblock = null;
    }
    if (this.msBefore === this.ms) { return null; }
    let matched: SharedTimerBlock = null;
    for (const timerblock of t.timerblocks) {
      if (this.ms <= timerblock.maxSupportedMs) {
        matched = timerblock; break;
      }
    }
    this.controller = t;
    this.timerblock = matched;
    this.msBefore = this.ms;
    this.blockInterval = this.timerblock.blockMs !== 1 ?
                            Math.ceil(this.ms / this.timerblock.blockMs)
                          : Math.ceil(this.ms);
    return this.timerblock;
  }
}

// export function immediate<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
//   return new Timer(spec, ontick).immediate();
// }

// export function timer<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
//   return new Timer(spec, ontick);
// }

export function timerInterval<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
  return new Timer(spec, ontick).forever();
}

// export function intervalNow<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
//   return new Timer(spec, ontick).immediate().forever();
// }


// export function retry<T = any>(timeoutInSeconds: number, func: (ti?: TimerTickSnapshot<T>) => Promise<T>) {
//   return new Promise<T>(async resolve => {
//     const timeoutInMs = timeoutInSeconds * 1000;
//     const ti = new Timer<T>(1000, async t => {
//       try { return await func(t); } catch (e) { errorCast(e); }
//     }).watch(1000, () => { if (ti.elapsed > timeoutInMs) { ti.end(); } });
//     // tslint:disable-next-line: deprecation
//     ti.finish$.subscribe(() => { resolve(ti.result); });
//     ti.untilResultNow({backoff: 'expo'});
//   });
// }


// export function sleep(s: number, afterSleeping?: () => any) {
//   if (!s || s < 0) { s = 0; }
//   return new Promise<void>(resolve => {
//     if (ixConfig.sleepFunctions.useSharedTimer) {
//       new TimerRegistrant({ ms: s * 1000, callback: () => {
//         if (afterSleeping) { afterSleeping(); }
//         resolve();
//       }}).registerOn(mainSharedTimer);
//     } else {
//       setTimeout(resolve, s * 1000);
//     }
//   });
// }

// export function sleepms(ms: number, afterSleeping?: () => any) {
//   if (!ms || ms < 0) { ms = 0; }
//   return new Promise<void>(resolve => {
//     if (false && ixConfig.sleepFunctions.useSharedTimer) {
//       new TimerRegistrant({ ms, callback: () => {
//         if (afterSleeping) { afterSleeping(); }
//         resolve();
//       }}).registerOn(mainSharedTimer);
//     } else {
//       setTimeout(resolve, ms);
//     }
//   });
// }

// export function timeout<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
//   return new Timer(spec, ontick);
// }

// export function repeater<T = any>(spec?: number | TimerOptions, ontick?: (e: TimerTickSnapshot<T>) => any) {
//   const ti = new Timer(spec, ontick);
//   ti.forever();
//   return ti;
// }
