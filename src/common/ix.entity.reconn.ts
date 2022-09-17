/* Jovian (c) 2020, License: MIT */

import { Observable, Subscription } from 'rxjs';
import { ConfigSource } from './ix.config.source';
import { Entity } from './ix.entity';
import { HalfLifed } from './ix.halflifed';
import { timerInterval, Timer } from './ix.timer';

export class ReconnEntityBehavior {
  static defaultProfile: ReconnEntityBehavior = null;
  resetThreshold?: number = 5;
  defunctThreshold?: number = 3;
  errorHalfLife?: number = 300;
  defunctHalfLife?: number = 3600;
  restoreCheckInterval?: number = 60;
  constructor(init?: Partial<ReconnEntityBehavior>) { if (init) { Object.assign(this, init); } }
}

export class ReconnEntity extends Entity {
  ixReconn = {
    config: { resetThreshold: 5, defunctThreshold: 3, } as ReconnEntityBehavior,
    configSource: null as ConfigSource<ReconnEntityBehavior>,
    configSubs: null as Subscription,
    resetInProgress: null as Promise<void>,
    error: null as Error,
    errorLast: 0,
    errorHeat: new HalfLifed({ hl: 300 }),
    defunctHeat: new HalfLifed({ hl: 3600 }),
    defunctState: false,
    defunctRestoreCheckedLast: 0,
    defunctRestoreCheckInterval: 60,
    defunctRestoreChecker: null as Timer,
    setRestoreFunction: (attempt: (self: ReconnEntity) => (boolean | Promise<boolean>)) => {
      this.ixReconn.actions.attemptToRestore = attempt;
    },
    setConfigSource: (src: ConfigSource<ReconnEntityBehavior>) => {
      if (this.ixReconn.configSource === src) { return; }
      if (this.ixReconn.configSubs) { this.ixReconn.configSubs.unsubscribe(); }
      this.ixReconn.configSource = src;
      // tslint:disable-next-line: deprecation
      this.ixReconn.configSubs = src.change$.subscribe(confData => {
        const conf = new ReconnEntityBehavior(confData);
        this.ixReconn.config.resetThreshold = conf.resetThreshold;
        this.ixReconn.config.defunctThreshold = conf.defunctThreshold;
        this.ixReconn.errorHeat.hl = conf.errorHalfLife;
        this.ixReconn.defunctHeat.hl = conf.defunctHalfLife;
        this.ixReconn.defunctRestoreCheckInterval = conf.restoreCheckInterval;
        this.ixRx<ReconnEntity>('reconn:config_change').next(this);
      });
    },
    actions: {
      reset: null as () => any,
      attemptToRestore: null  as (self: ReconnEntity) => (boolean | Promise<boolean>),
    },
    on: {
      reset: null as () => any,
      defunct: null as () => any,
      restore: null as () => any,
    },
    event: {
      self: this,
      get errorHeatUp$() { return (this.self as ReconnEntity).ixRx<number>('reconn:error_heat_up').obs(); },
      get defunctHeatUp$() { return (this.self as ReconnEntity).ixRx<number>('reconn:defunct_heat_up').obs(); },
      get errorDuringDefunct$() { return (this.self as ReconnEntity).ixRx<Error>('reconn:error_during_defunct').obs(); },
      get beforeReset$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:before_reset').obs(); },
      get reset$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:reset').obs(); },
      get beforeDefunct$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:before_defunct').obs(); },
      get defunct$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:defunct').obs(); },
      get beforeRestore$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:before_restore').obs(); },
      get restore$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:restore').obs(); },
      get configChange$() { return (this.self as ReconnEntity).ixRx<ReconnEntity>('reconn:config_change').obs(); },
    }
  };

  constructor(entityType?: string, ixIdOverride?: string) {
    super(entityType, ixIdOverride);
    if (!ReconnEntityBehavior.defaultProfile) { ReconnEntityBehavior.defaultProfile = new ReconnEntityBehavior(); }
    const dfProfile = ReconnEntityBehavior.defaultProfile;
    this.ixReconn.config.resetThreshold = dfProfile.resetThreshold;
    this.ixReconn.config.defunctThreshold = dfProfile.defunctThreshold;
    this.ixReconn.errorHeat.hl = dfProfile.errorHalfLife;
    this.ixReconn.defunctHeat.hl = dfProfile.defunctHalfLife;
    this.ixReconn.defunctRestoreCheckInterval = dfProfile.restoreCheckInterval;
    this.ixReconn.errorHeat.afterUpdate.push(async (heat, v) => {
      if (this.ixReconn.defunctState) {
        this.ixRx<Error>('reconn:error_during_defunct').next(this.ixReconn.error);
        return;
      }
      if (this.ixReconn.errorHeat.value > this.ixReconn.config.resetThreshold) {
        this.ixReconn.errorHeat.reset();
        this.ixReconn.defunctHeat.add(1);
        this.ixRx<number>('reconn:defunct_heat_up').next(this.ixReconn.defunctHeat.value);
        if (this.ixReconn.defunctHeat.value < this.ixReconn.config.defunctThreshold) {
          this.ixRx<ReconnEntity>('reconn:before_reset').next(this);
          let resolver = null;
          this.ixReconn.resetInProgress = new Promise<void>(resolve => resolver = resolve );
          try { await Promise.resolve(this.ixReconn.actions.reset?.()); } catch (e) { this.ixError(e); }
          this.ixReconn.resetInProgress = null;
          resolver?.();
          this.ixReconn.on.reset?.();
          this.ixRx<ReconnEntity>('reconn:reset').next(this);
        } else {
          this.ixReconn.defunctHeat.reset();
          this.ixReconn.defunctState = true;
          this.ixReconn.defunctRestoreCheckedLast = Date.now();
          this.ixRx<ReconnEntity>('reconn:before_defunct').next(this);
          this.ixReconn.on.defunct?.();
          this.ixRx<ReconnEntity>('reconn:defunct').next(this);
        }
      }
    });
    this.ixReconn.defunctRestoreChecker = timerInterval(1000, async () => {
      if (!this.ixReconn.defunctState) { return; }
      if (Date.now() - this.ixReconn.defunctRestoreCheckedLast > this.ixReconn.defunctRestoreCheckInterval * 1000) {
        this.ixReconn.defunctRestoreCheckedLast = Date.now();
        if (this.ixReconn.actions.attemptToRestore) {
          const res = await Promise.resolve(this.ixReconn.actions.attemptToRestore(this));
          if (res) {
            this.ixReconn.defunctState = false;
            this.ixRx<ReconnEntity>('reconn:before_restore').next(this);
            this.ixReconn.errorHeat.reset();
            this.ixReconn.defunctHeat.reset();
            this.ixReconn.on.restore?.();
            this.ixRx<ReconnEntity>('reconn:restore').next(this);
          }
        }
      }
    });
    // tslint:disable-next-line: deprecation
    const eSub = this.error$.subscribe(e => {
      const severity = e.severity ? e.severity : 1;
      this.ixReconn.errorLast = Date.now();
      this.ixReconn.error = e;
      this.ixReconn.errorHeat.add(severity);
      this.ixRx<number>('reconn:error_heat_up').next(this.ixReconn.errorHeat.value);
    });
    this.ixReconn.errorHeat.lcManagedBy(this);
    this.ixReconn.defunctHeat.lcManagedBy(this);
    this.ixReconn.defunctRestoreChecker.lcManagedBy(this);
    this.addOnDestroy(() => {
      eSub.unsubscribe();
      if (this.ixReconn.configSubs) { this.ixReconn.configSubs.unsubscribe(); }
    });
  }
}
