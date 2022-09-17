/* Jovian (c) 2020, License: MIT */

import { Subject, Observable, BehaviorSubject, Observer, Subscription } from 'rxjs';
import { enscope, error$, errorCast, ScopedError } from './ix.error';
import { event$, eventCast } from './ix.event';
import { PromUtil } from './util/prom.util';

const commonEntityIdData = { index: 0 };
const commonEntityIdGeneration = {
  type: 'default',
  generator: (entityType?: string) => {
    const idx = (commonEntityIdData.index++).toString(36);
    return `${entityType}-${idx}`;
  },
  changeHistory: [] as Error[],
};

export class LinkedObservable<T = any> extends Observable<T> {
  static fromLinkedSubject<T = any>(subj: Subject<T> | BehaviorSubject<T>) {
    const obs = subj.asObservable();
    (obs as LinkedObservable<T>).subject = subj;
    (obs as LinkedObservable<T>).dataSourceEntity = (subj as any).__rx_data_source_entity;
    const rxOpts: RxOptions = (subj as any).__rx_opts;
    if (rxOpts) {
      if (rxOpts.trackSubscribers) {
        Object.defineProperty(obs, 'subscribe2', { value: obs.subscribe });
        (obs as any).subscribe = <T>(listener: ((value: T) => any) | Partial<Observer<T>>) => {
          const entity: Entity = (listener as any).__rx_data_source_entity;
          if (rxOpts.onNewSubscriber) { rxOpts.onNewSubscriber(new Error, entity); }
          (obs as any).subscribe2(listener);
        }
      }
    }
    return obs as LinkedObservable<T>;
  }
  constructor() { super(); }
  subject: Subject<T> | BehaviorSubject<T>;
  dataSourceEntity: Entity;
  next(nextValue: T, errorHandler?: (e: Error) => any) {
    try {
      const sub = this.subject;
      sub.next(nextValue);
    } catch (e) {
      try {
        if (errorHandler) { errorHandler(e); }
      } catch (e2) {}
    }
  }
}

export interface RxInfo<T = any> {
  name: string;
  data: {[key: string]: any};
  subject: Subject<T>;
  observable: LinkedObservable<T>;
  oninits: (() => any)[];
  init: () => any;
  obs: () => LinkedObservable<T>;
  next: (v: T) => any;
}

export interface RxOptions {
  trackSubscribers?: boolean;
  onNewSubscriber?: <T>(e: Error, subber?: Entity) => any;
  findNameFromThisObservable?: Observable<any> | LinkedObservable<any>;
}

export class Entity {
  static idGenType() { return commonEntityIdGeneration.type; }
  static idGenChangeHistory() { return commonEntityIdGeneration.changeHistory.slice(0); }
  static idGenCustom(type: string, generator: (entityType?: string) => string) {
    commonEntityIdGeneration.type = type;
    commonEntityIdGeneration.generator = generator;
    commonEntityIdGeneration.changeHistory.push(new Error());
  }
  private ixIdV: string;
  private ixParentV: Entity;
  private ixMajorScopeV: MajorScope;
  private ixChildrenMapV: {[childIxId: string]: Entity} = {};
  private ixRegistriesV: {[registryId: string]: Registry<Entity>} = {};
  private ixRxObjectsV: {[type: string]: RxInfo} = {};
  private ixOnDestoys: ((self: Entity) => any)[] = [];
  private ixDestroyed: boolean = false;
  constructor(entityType: string, ixIdOverride?: string) {
    this.ixIdV = ixIdOverride ? ixIdOverride : commonEntityIdGeneration.generator(entityType);
  }
  get ixId() { return this.ixIdV; }
  get ixParent() { return this.ixParentV; }
  get ixChildrenMap() { return this.ixChildrenMapV; }
  get ixRegistries() { return this.ixRegistriesV; }
  get ixMajorScope() { return this.ixMajorScopeV; }
  get destroyed() { return this.ixDestroyed; }
  get ixBase() { return this.ixMajorScopeV ? this.ixMajorScopeV.name : `unknown`; }
  get error$() {
    const rxObj = this.ixRx('error');
    if (!rxObj.subject) { rxObj.init(); }
    if (!rxObj.data.init) {
      rxObj.data.init = true;
      // tslint:disable-next-line: deprecation
      const gSub = error$.subscribe(e => {
        if (e.entity === this || (e.appliesTo && e.appliesTo[this.ixId])) { rxObj.next(e); }
      });
      this.addOnDestroy(() => { gSub.unsubscribe(); });
    }
    return rxObj.observable as Observable<ScopedError>;
  }
  get event$() {
    const rxObj = this.ixRx('event');
    if (!rxObj.subject) { rxObj.init(); }
    if (!rxObj.data.init) {
      rxObj.data.init = true;
      // tslint:disable-next-line: deprecation
      const gSub = event$.subscribe(e => {
        if (e.entity === this || (e.appliesTo && e.appliesTo[this.ixId])) { rxObj.next(e); }
      });
      this.addOnDestroy(() => { gSub.unsubscribe(); });
    }
    return rxObj.observable as Observable<Event>;
  }
  get any$() {
    const rxObj = this.ixRx('__any');
    if (!rxObj.subject) { rxObj.init(); }
    return rxObj.observable as Observable<any>;
  }
  ixRegisterOn(registry: Registry<Entity>) {
    registry.register(this);
    return this;
  }
  ixSetEntityId(id: string) {
    if (id === this.ixIdV) { return this; }
    const oldId = this.ixIdV;
    const registries: {t: number, registry: Registry<Entity>}[] = [];
    for (const regId of Object.keys(this.ixRegistries)) {
      const registry = this.ixRegistries[regId];
      const t = registry.registrationTime(this);
      registries.push({ registry, t });
      registry.deregister(this);
    }
    this.ixIdV = id;
    if (this.ixParentV?.ixChildrenMapV[oldId]) {
      delete this.ixParentV.ixChildrenMapV[oldId];
      this.ixParentV.ixChildrenMapV[id] = this;
    }
    for (const regInfo of registries) {
      regInfo.registry.register(this, regInfo.t);
    }
    return this;
  }
  ixError(e: Error | string, severity?: number, metadata?: {[key: string]: any}) {
    if (typeof e === 'string') { e = new Error(e); }
    const se = enscope(e, this);
    if (!severity) { severity = 1; }
    if (metadata) { se.meta = metadata; }
    se.severity = severity;
    if (!se.appliesTo) { se.appliesTo = {}; }
    se.appliesTo[this.ixId] = this;
    errorCast(se);
    return this;
  }
  ixEvent(evtName: string, evtData: any) {
    eventCast(evtName, evtData, this);
    return this;
  }
  ixListen<T = any>(obs: LinkedObservable<T>, listener: ((value: T) => any) | Partial<Observer<T>>) {
    Object.defineProperty(listener, '__rx_data_source_entity', { value: this });
    const subs = typeof listener === 'function' ? obs.subscribe(listener) : obs.subscribe(listener);
    this.addOnDestroy(() => { subs.unsubscribe(); });
    return this;
  }
  lcManagedBy(parent: Entity) {
    if (!parent) { return this; }
    this.lcDetach(true);
    parent.ixChildrenMapV[this.ixIdV] = this;
    this.ixParentV = parent;
    this.lcSetMajorScope(parent.ixMajorScopeV);
    return this;
  }
  lcManage(child: Entity) {
    if (!child) { return this; }
    child.lcDetach(true);
    this.ixChildrenMapV[child.ixId] = child;
    child.ixParentV = this;
    child.lcSetMajorScope(this.ixMajorScopeV);
    return this;
  }
  lcDetach(skipRootDetach: boolean = false) {
    if (this.ixParentV) {
      delete this.ixParentV.ixChildrenMapV[this.ixIdV];
      this.ixParentV = null;
      if (!skipRootDetach) { this.lcSetMajorScope(null); }
    }
  }
  lcSetMajorScope(rootScope: MajorScope, alsoUpdateChildren: boolean = true) {
    this.ixMajorScopeV = rootScope;
    if (alsoUpdateChildren) {
      for (const childId of Object.keys(this.ixChildrenMapV)) {
        const child = this.ixChildrenMapV[childId];
        if (child) { child.lcSetMajorScope(rootScope); }
      }
    }
    return this;
  }
  ixRx<T = any>(rxName: string, rcOpts?: RxOptions) {
    if (rcOpts?.findNameFromThisObservable && (rcOpts.findNameFromThisObservable as any).__rx_name) {
      rxName = (rcOpts.findNameFromThisObservable as any).__rx_name;
    }
    if (!rxName) { return null; }
    let rxObj = this.ixRxObjectsV[rxName];
    if (!rxObj) {
      rxObj = this.ixRxObjectsV[rxName] = {
        name: rxName,
        data: {},
        subject: null,
        observable: null,
        oninits: [],
        init: () => {
          if (rxObj.subject) { return; }
          rxObj.subject = new Subject<T>();
          Object.defineProperty(rxObj.subject, '__rx_data_source_entity', { value: rxName });
          Object.defineProperty(rxObj.subject, '__rx_opts', { value: rxName });
          rxObj.observable = LinkedObservable.fromLinkedSubject(rxObj.subject);
          Object.defineProperty(rxObj.observable, '__rx_name', { value: rxName });
          Object.defineProperty(rxObj.observable, 'next', { value: (nextValue: T, errorHandler?: (e: Error) => any) => {
            try {
              const sub = rxObj.subject;
              sub.next(nextValue);
            } catch (e) {
              try {
                if (errorHandler) { errorHandler(e); }
              } catch (e2) {}
            }
          } });
          for (const oninit of rxObj.oninits) { oninit(); }
        },
        obs: () => {
          if (!rxObj.subject) { rxObj.init(); }
          return rxObj.observable;
        },
        next: (v) => {
          if (!rxObj.subject) { rxObj.init(); }
          if (rxName !== '__any') {
            const genericSelfRx = this.ixRx('__any');
            if (!genericSelfRx.subject) { genericSelfRx.init(); }
            genericSelfRx.next(v);
          }
          rxObj.next(v);
        }
      };
    }
    return rxObj as RxInfo<T>;
  }
  addOnDestroy(ondestroy: (self: Entity) => any) {
    this.ixOnDestoys.push(ondestroy);
    return this;
  }
  destroy() {
    if (this.ixDestroyed) { return Promise.resolve(null); }
    this.ixDestroyed = true;
    const subDestroyProms = [];
    if (this.ixOnDestoys) {
      for (const ixOnDestroy of this.ixOnDestoys) {
        if (ixOnDestroy) {
          try {
            const v = ixOnDestroy(this);
            if (v && v.then) { subDestroyProms.push(v); }
          } catch (e) { errorCast(e); }
        }
      }
    }
    for (const regId of Object.keys(this.ixRegistries)) {
      this.ixRegistries[regId].deregister(this);
    }
    for (const childId of Object.keys(this.ixChildrenMapV)) {
      const child = this.ixChildrenMapV[childId];
      if (child) { subDestroyProms.push(child.destroy()); }
    }
    this.lcDetach();
    for (const rxName of Object.keys(this.ixRxObjectsV)) {
      const rxReg = this.ixRxObjectsV[rxName];
      rxReg.subject?.complete();
    }
    this.ixRxObjectsV = null;
    this.ixMajorScopeV = null;
    this.ixChildrenMapV = null;
    return PromUtil.allSettled(subDestroyProms);
  }
}


export class Registry<T extends Entity> extends Entity {
  private data: {[id: string]: {target: T, t: number}} = {};
  constructor() {
    super('registry');
  }
  ixSetEntityId(id: string) {
    if (id) {
      const e = Error('Registry type cannot change its ixId');
      this.ixError(e);
      throw e;
    }
    return this;
  }
  get(ixId: string) { return this.data[ixId].target; }
  has(entity: T) { return this.data[entity.ixId] ? true : false; }
  exists(entity: T) { return this.data[entity.ixId] ? true : false; }
  register(entity: T, overrideTime?: number) {
    const entityIxId = entity.ixId;
    if (this.data[entityIxId]) { return this; }
    this.data[entityIxId] = { target: entity, t: overrideTime ? overrideTime : Date.now() };
    entity.ixRegistries[this.ixId] = this;
    return this;
  }
  deregister(entity: T) {
    const reg = this.data[entity.ixId];
    if (reg) {
      delete reg.target.ixRegistries[this.ixId];
      delete this.data[entity.ixId];
    }
    return this;
  }
  registrationTime(entity: T) {
    const reg = this.data[entity.ixId];
    return reg ? reg.t : null;
  }
}

export class Scope extends Entity {
  name: string;
  isMajorScope: boolean;
  executeWithinScope: (scope: Scope) => any;
  constructor(name: string, executeWithinScope?: (scope: Scope) => any, isMajorScope?: boolean) {
    super(isMajorScope ? 'major-scope' : 'scope', null);
    this.name = name;
    this.isMajorScope = !!isMajorScope;
    if (!this.name) { this.name = isMajorScope ? `(major-scope-${this.ixId})` : `(scope-${this.ixId})`; }
    this.executeWithinScope = executeWithinScope;
    if (this.executeWithinScope) { this.executeWithinScope(this); }
  }
}

export class MajorScope extends Scope {
  constructor(name: string, executeWithinScope?: (scope: Scope) => any) {
    super(name, executeWithinScope, true);
    this.lcSetMajorScope(this);
    this.ixRx('error').oninits.push(() => {
      // tslint:disable-next-line: deprecation
      const scopedErrorSubs = error$.subscribe(e => {
        if (e.scope === this) { this.ixRx('error').next(e); }
      });
      this.addOnDestroy(() => { scopedErrorSubs.unsubscribe(); });
    });
    this.ixRx('event').oninits.push(() => {
      // tslint:disable-next-line: deprecation
      const scopedEventSubs = event$.subscribe(e => {
        if (e.scope === this) { this.ixRx('event').next(e); }
      });
      this.addOnDestroy(() => { scopedEventSubs.unsubscribe(); });
    });
  }
}
