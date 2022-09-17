/* Jovian (c) 2020, License: MIT */

import { settingsInitialize, TypeToolsBase, TypeToolsExtension, TypeToolsExtensionData } from './type-tools';
import { PropertiesController, PropertiesControllerSettings, PropertiesManagementOptions, PropertyAccessEvent, PropertyControlLayer } from './properties-controller';
import { Class, ClassStaticTemplate, GetLatterIfNoExtraProp, Intersect, MergeClass, MergeClassPartial, PartialAny, PartialCustom } from './type-transform';
import { ClassLineage } from './class-lineage';
import { Ephemerals } from './ephemerals';
import { Context, runtimeLocation } from './context';

import {
  typeFullName, UpstreamDatastore, UpstreamDatastoreConfig, UpstreamDataIndexDefinition, UpstreamIndexType, UpstreamClassConfig,
  upstreamRuntime, UpstreamIndexOptions, defaultUpstreamRoute, defaultUpstreamPath, defaultUpstreamUniverse, UpstreamTargetMatcher,
  parseGlobalId, UpstreamTargetMetadata, CollectionIndex, CollectionIndexes,
} from './upstream/common.iface';
import { ok, passthru, Result, ReturnCodeFamily } from './common/util/enum.util';
import { promise, PromUtil } from './common/util/prom.util';
import { ClassSettings, dp, dpa, spotfull } from './common/globals.ix';

// Error.stackTraceLimit = 10;

enum UpstreamCodeEnum {
  CREATE_ACK_FAIL,
  CREATE_INSERT_FLOW_FAILURE,
  CREATE_INSERT_FLOW_UNSUPPORTED,
  CREATE_ERROR,
  INSERT_FLOW_MEMBER_CREATE_ERROR,
  CREATE_OFFLINE_BACKLOG,
  TARGET_HAS_NO_UPSTREAM,
  TARGET_TYPE_HAS_NO_UPSTREAM_DEF,
  TARGET_UPSTREAM_ROUTER_UNRESOLVABLE,
  TARGET_UPSTREAM_ROUTE_UNRESOLVABLE,
}
export const UpstreamCode = ReturnCodeFamily('UpstreamCode', UpstreamCodeEnum);

export { UpstreamClassConfig };

export interface Owned {
  owners: string[];
}

// export const upstreamConfigs: {[kind: string]: UpstreamMapping} = {};

// export const cachedConfigFetch: {[target: string]: Promise<UpstreamMapping>} = {};

export class UpstreamSettings extends PropertiesControllerSettings {
  static extensionUpstream = 'Upstream';
  extensionUpstream = UpstreamSettings.extensionUpstream;
  constructor(init?: Partial<UpstreamSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export enum UpstreamSync {
  IMMEDIATE = 0,
  NEXT_TICK = 1,
  QUICK = 100,
  DEFAULT = 500,
  LONG = 1000,
  EXTRA_LONG = 2000,
  CUSTOM = 9999,
  MANUAL = 99999
}

export enum TxInstructionType {
  NOOP = 0,
  INSERT = 1,
  FETCH = 2,
  UPDATE = 3,
  DELETE = 4,
}

export interface TxInstruction {
  type: TxInstructionType;
  idemhash: string;
  data: any;
  t: number;
  ran?: boolean;
  result?: boolean;
}

export class TxData {
  id: string = makeid(20);
  vars: {[varname: string]: any} = {};
  cursor: number = 0;
  txlist: TxInstruction[] = [];
  t: number = Date.now();
  constructor(init?: Partial<TxData>) {
    if (init) { Object.assign(this, init); }
  }
}

export const txData: {[id: string]: TxData} = {};

// export type IndexColumnsOf<T, S> = NoExtra<PartialCustom<T, any>, S>;

export class UpstreamIndex<T = any, Indexer = T> implements UpstreamIndexType<Indexer, T> {
  private name: string = null;
  private type: Class<T> = null;
  private options: UpstreamIndexOptions = null;
  private columns: PartialCustom<T, any> = null;
  constructor(type: Class<T>, options: UpstreamIndexOptions, columns: PartialCustom<T, any>) {
    this.type = type;
    this.options = options;
    this.columns = columns;
  }
  async get(target: Indexer, errorCallback?: (errors: Result[]) => any): Promise<T> {
    return (await this.lookUp(target, errorCallback))[0];
  }
  async find(target: Indexer, errorCallback?: (errors: Result[]) => any): Promise<T[]> {
    return await this.lookUp(target, errorCallback);
  }
  indexInfo(): CollectionIndex<T> {
    return { name: this.name, options: this.options, columns: this.columns, } as CollectionIndex<T>;
  }
  private async lookUp(targetLookUp: Indexer, errorCallback: (errors: Result[]) => any): Promise<T[]> {
    let target: T = targetLookUp as unknown as T;
    const ext = Upstream.getExtensionData(targetLookUp);
    if (!ext) {
      target = new this.type;
      Object.assign(target, targetLookUp);
    }
    const connResult = await Upstream.getTargetDatastore(target);
    if (connResult.bad) { return null; }
    const conn = connResult.data;
    const filter: UpstreamTargetMatcher<T> = {} as any;
    for (const column of Object.keys(this.columns)) {
      const colval = targetLookUp[column];
      if (colval === null || colval === undefined) { continue; }
      filter[column] = colval;
    }
    const allPromises: Promise<Result<T[], any>>[] = [];
    const found = conn.find(this.type, filter, null, this.name);
    allPromises.push(found);
    const totalResults = await Promise.all(allPromises);
    if (errorCallback) {
      const totalErrors = totalResults.filter(a => a && a.bad);
      if (totalErrors.length > 0) { errorCallback(totalErrors); }
    }
    const totalResultsFlat = ([] as T[]).concat(...totalResults
                                        .filter(a => a && a.ok)
                                        .map(a => a.data));
    const hydrated = totalResultsFlat.map(a => Upstream.targetSolidify(this.type, a)).filter(a => a);
    return hydrated;
  }
}

export interface UpstreamDatastoreRouter {
  getRoute: <T>(target: T) => Promise<string>;
  routes: { [routeKey: string]: UpstreamDatastore };
}

export type UpstreamWorkload<T = any> = (
  ['push', T, number, (UpstreamDataOpCallback)? ] |
  ['pull', T, (UpstreamDataOpCallback)? ] | 
  ['premake', Class<T> ] |
  ['callback', (() => any) ]
);

export interface UpstreamPremakeConfig<T> { list: T[]; size: number; }

export interface UpstreamSharedQueue {
  started: boolean;
  queue: UpstreamWorkload[][];
  length: number;
  last: number;
  cursor: number;
  deltaOffset: number;
  beingHandled: boolean;
}

export interface UpstreamInsertFlowMember<T = any> {
  parent: number;
  lvl: number;
  path: string[];
  target: T;
  typename: string;
  oref: string;
  insertedGid?: string;
  typeGetter?: () => Class<T>;
  targetGetter?: () => T;
  updater?: {
    set: { [key: string]: any; };
  };
  conn?: UpstreamDatastore;
}

export type UpstreamDataOpCallback<T = any> = (result: T) => any;

export class UpstreamExtensionData<T = any> implements TypeToolsExtensionData {
  props: {[propName: string]: {
    oldValue?: any;
    newValue?: any;
    lastAcknowledgedValue?: any;
    syncType?: UpstreamSync;
    syncCustomMs?: number;
    disconnected?: boolean;
    touched?: boolean;
    pending?: boolean;
    lastFetched?: number;
    rootVersionWhenModified?: number;
  }};
  target: T;
  class: Class<T>;
  upstreamMeta?: UpstreamClassConfig<T>;
  syncType?: UpstreamSync;
  syncCustomMs?: number;
  connected?: boolean;
  touched?: boolean;
  paused?: boolean;
  lastFetched?: number;
  localId?: string;
  version?: number;
  versionLastSynced?: number;
  insertJsonList?: any[];
  syncCallback?: UpstreamDataOpCallback;
  push: {
    explicit: boolean;
    locked: boolean;
    fullPushPromise: Promise<Result<T>>;
  };
  pull: {
    locked: boolean;
    fullPullPromise: Promise<Result<T>>;
    pullFailure?: Result<T>;
  };
}

export interface UpstreamData {
  _id?: string;
  _parent?: string;
  _lock?: number;
  _locker?: string;
}
export type UpstreamClass<T> = MergeClassPartial<T, UpstreamData>;
export type IndexDefinition<T, S> = MergeClassPartial<{ [K in keyof Intersect<S, T>]: T[K] }, UpstreamData>;
let currentIndexTargetType: Class<any>;
const indexGetter = <T, S extends PartialAny<T>>(options: UpstreamIndexOptions, columns: S) => {
  return new UpstreamIndex<T, IndexDefinition<T, S>>(currentIndexTargetType as Class<T>, options, columns);
}
export type IndexGetterType<T> = <S>(options: UpstreamIndexOptions, columns: S extends GetLatterIfNoExtraProp<T, S> ? S : PartialAny<T>) => UpstreamIndex<T, IndexDefinition<T, S>>;
type UpstreamConfigGetter<T, S> = (indexer: IndexGetterType<T>) => S;
// function indexGetterOverloadType<T, S>(options: UpstreamIndexOptions, columns: S extends GetLatterIfNoExtraProp<T, S> ? S : PartialAny<T>): UpstreamIndex<T, IndexDefinition<T, S>>;
// function indexGetterOverloadType<T, S>(columns: S extends GetLatterIfNoExtraProp<T, S> ? S : PartialAny<T>): UpstreamIndex<T, IndexDefinition<T, S>>;
// function indexGetterOverloadType(...args) { return null; }
// type UpstreamConfigGetter<T, S> = (indexer: typeof indexGetterOverloadType<T,S>) => S;
const versionGetter = <U>(version: SemVer, nscInfo: UpstreamNamespaceCosortiumInfo, cls: Class<U>): ClassStaticTemplate<U, UpstreamClassRequirement> => {
  (cls as any).version = version;
  if (nscInfo) {
    return dataclass(nscInfo)(cls as any) as ClassStaticTemplate<U, UpstreamClassRequirement>;
  }
  return cls as ClassStaticTemplate<U, UpstreamClassRequirement>; 
}
type UpstreamVersionsGetter<T, S> = (addVersions: <U>(version: SemVer, nscInfo: UpstreamNamespaceCosortiumInfo, cls: Class<U>) => ClassStaticTemplate<U, UpstreamClassRequirement>) => S;

export class Upstream implements TypeToolsExtension {
  // Settings
  static currentUniverse = defaultUpstreamUniverse;
  static trackClassSource = true;
  static sharedQueueCheckerInterval = 33;
  static showOperationErrors = false;
  static protected = ClassSettings.protect(this);
  // Static Var
  static defaultSync: UpstreamSync | number = runtimeLocation === 'server' ? UpstreamSync.NEXT_TICK : UpstreamSync.DEFAULT;
  static queueStarted = false;
  static tempObjectReferenceRegistry: {[refKey: string]: { obj: any; t: number }} = {};
  static objectRegistry: {[_gid: string]: { pending: Promise<any>, obj: any}} = {};
  static backlog: UpstreamWorkload[] = [];
  static sharedQueue: UpstreamSharedQueue = { queue: [], cursor: 0, deltaOffset: 0, length: 5500, last: Date.now(), started: false, beingHandled: false };
  static localIdCounter = 0;
  static sharedQueueChecker: any;
  static datastore: { [universe: string]: UpstreamDatastoreRouter; } = {};
  static errors: Error[] = [];
  static topError: Error = null;
  static types: {[typeFullName: string]: Class<any>} = {};
  static typesPremakePending: {[typeFullName: string]: boolean} = {};

  static getExtensionData(target: any, settings = UpstreamSettings): UpstreamExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionUpstream, settings);
  }

  static typeCheck(target: any, settings = UpstreamSettings): boolean {
    return target && !!Upstream.getExtensionData(target, settings);
  }

  static implementOn(target: any, settings = UpstreamSettings): boolean {
    if (!TypeToolsBase.checkContext(Upstream)) { return false; }
    if (!Upstream.getExtensionData(target, settings)) {
      Ephemerals.implementOn(target);
      PropertiesController.implementOn(target, settings);
      const extension: UpstreamExtensionData = {
        target,
        class: null,
        upstreamMeta: null,
        props: {},
        localId: (++Upstream.localIdCounter) + '',
        version: 0,
        versionLastSynced: 0,
        push: { explicit: false, locked: false, fullPushPromise: null },
        pull: { locked: false, fullPullPromise: null },
      };
      TypeToolsBase.addExtension(target, settings.extensionUpstream, extension);
    }
    return true;
  }

  static setupOn<T = any>(target: T, type: Class<T>, config?: UpstreamClassConfig<T>, settings = UpstreamSettings) {
    if (!Upstream.implementOn(target, settings)) { return; }
    if (type !== Context.current) { return; }
    const extension = Upstream.getExtensionData(target, settings);
    if (!(target as any)._meta) { TypeToolsBase.addMetaProperty(target); }
    extension.class = type;
    if (!config) {
      config = (type as any).upstream as UpstreamClassConfig<T>;
      if (!config) { config = (type as any).upstream = { index: {} }; }
    }
    const manageOptions: PropertiesManagementOptions = { alwaysBack: true, order: 9 };
    const skel = TypeToolsBase.getSkeleton(type);
    const descriptorsRubric: PartialCustom<T, Partial<PropertyControlLayer>> = {};
    for (const prop of Object.keys(skel as any)) {
      if (!extension.props[prop]) {
        extension.props[prop] = {};
        descriptorsRubric[prop] = { change: (oldValue, newValue, e) => {
          Upstream.handlePropUpdate(target, extension, e.property, oldValue, newValue, e).catch(e => {});
        } }
      }
    }
    PropertiesController.manage(target, manageOptions, descriptorsRubric, settings);
  }

  static constructMultiverse<S>(multiverseMap: S) {
    return multiverseMap;
  }

  static class<T>(type: Class<T>) {
    return type as ClassStaticTemplate<T, UpstreamClassRequirement>;
  }

  static index<T, IndexMap>(type: Class<T>, indexDef: UpstreamConfigGetter<T, IndexMap> | IndexMap) {
    const typeAny = (type as any);
    if (!(type as any).upstream) {
      throw new Error('Cannot define index on class without upstream namespace. Did you forget to add @ns?');
    }
    let indexMap: IndexMap;
    if ((indexDef as any).apply && (indexDef as any).call) {
      currentIndexTargetType = type;
      indexMap = (indexDef as any)(indexGetter as any);
      currentIndexTargetType = null;
    } else {
      indexMap = indexDef as IndexMap;
    }
    if (!typeAny.index) { typeAny.index = {}; }
    if (!typeAny.upstream.index) { typeAny.index = {}; }
    if (!typeAny.upstream.indexColumns) { typeAny.index = {}; }
    Object.assign(typeAny.index, indexMap);
    Object.assign(typeAny.upstream.index, indexMap);
    const upstreamDefaultIndex = {
      parent: new UpstreamIndex(type, {}, { _parent: true } as any),
    };
    typeAny.manager = {
      dropCollection: async () => {
        const target = TypeToolsBase.getSampleInstance(type);
        const dsResult = await Upstream.getTargetDatastore(target);
        if (dsResult.bad) { return false; }
        const dropResult = await dsResult.data.admin.dropCollection(type);
        if (dropResult.bad) { return false; }
        return dropResult.data;
      },
      recreateIndexes: async () => {
        const target = TypeToolsBase.getSampleInstance(type);
        const dsResult = await Upstream.getTargetDatastore(target);
        if (dsResult.bad) { return false; }
        await Upstream.initializeIndexFor(type, dsResult.data, true);
      },
    };
    Object.assign(typeAny.index, upstreamDefaultIndex);
    Object.assign(typeAny.upstream.index, upstreamDefaultIndex);
    const indexConfig: UpstreamClassConfig<T, IndexMap> = typeAny.index;
    for (const indexName of Object.keys(indexConfig)) {
      const index: UpstreamIndex = indexConfig[indexName];
      if (index instanceof UpstreamIndex) {
        (index as any).name = indexName;
        Object.assign(typeAny.upstream.indexColumns, index.indexInfo().columns);
      }
    }
    return indexConfig as MergeClass<IndexMap, typeof upstreamDefaultIndex>;
  }

  static admin<T>(type: Class<T>) {
    const typeAny = (type as any);
    return typeAny.manager as {
      dropCollection: () => Promise<any>;
      recreateIndexes: () => Promise<any>;
    };
  }

  static versions<T, VersionsMap>(type: Class<T>, versionsDef: UpstreamVersionsGetter<T, VersionsMap>) {
    const typeAny = (type as any);
    if (!typeAny.upstream) {
      throw new Error('Cannot define index on class without upstream namespace. Did you forget to add @ns?');
    }
    const map = versionsDef(versionGetter);
    typeAny.v = map;
    return map;
  }

  static add<T>(datastore: UpstreamDatastore<T>, route: string = defaultUpstreamRoute) {
    if (!route) { route = defaultUpstreamRoute; }
    if (!datastore.config.path) { datastore.config.path = defaultUpstreamPath; }
    let dsRoute = Upstream.datastore[datastore.config.path];
    if (!dsRoute) { dsRoute = Upstream.datastore[datastore.config.path] = { getRoute: async () => defaultUpstreamRoute, routes: {} }; }
    dsRoute.routes[route] = datastore;
    return datastore;
  }

  static remove(path: string, route: string = defaultUpstreamRoute) {
    if (!route) { route = defaultUpstreamRoute; }
    let dsRoute = Upstream.datastore[path];
    if (!dsRoute) { dsRoute = Upstream.datastore[path] = { getRoute: async () => defaultUpstreamRoute, routes: {} }; }
    if (dsRoute.routes[route]) { delete dsRoute.routes[route]; }
  }

  static stringify(target: any, indent: number = null): string {
    const metaSerialSaved = Context.serializeMeta;
    Context.serializeMeta = true;
    const serialized = JSON.stringify(target, null, indent);
    Context.serializeMeta = metaSerialSaved;
    return serialized;
  }

  static startQueue() {
    if (Upstream.sharedQueue.started) { return; }
    Upstream.sharedQueue.started = true;
    Upstream.sharedQueue.queue.length = Upstream.sharedQueue.length;
    for (let i = 0; i < Upstream.sharedQueue.queue.length; ++i) { Upstream.sharedQueue.queue[i] = []; }
    Upstream.sharedQueue.last = Date.now();
    Upstream.sharedQueueChecker = setInterval(Upstream.tickQueue, Upstream.sharedQueueCheckerInterval);
  }

  static asyncWorkload(ms: number, workload: UpstreamWorkload) {
    Upstream.startQueue();
    if (ms > Upstream.sharedQueue.length) {
      throw new Error(`ms=${ms}; Cannot add workload past queue maximum ms limit of ${Upstream.sharedQueue.length}`);
    }
    let index = ms + Upstream.sharedQueue.deltaOffset + Upstream.sharedQueue.cursor + 33;
    while (index >= Upstream.sharedQueue.length) { index -= Upstream.sharedQueue.length; }
    let msSpot = Upstream.sharedQueue.queue[index];
    if (!msSpot) { msSpot = Upstream.sharedQueue.queue[index] = []; }
    msSpot.push(workload);
  }

  static tickQueue(forceFlush = false): Promise<any>[] {
    const now = Date.now();
    let delta = now - Upstream.sharedQueue.last;
    if (delta > Upstream.sharedQueue.length) { delta = Upstream.sharedQueue.length; }
    if (forceFlush) { delta = Upstream.sharedQueue.length; }
    const cursorAt = Upstream.sharedQueue.cursor;
    const queueLen = Upstream.sharedQueue.length;
    Upstream.sharedQueue.beingHandled = true;
    const proms = [];
    for (let i = 0; i < delta; ++i) {
      let index = cursorAt + i; while (index >= queueLen) { index -= queueLen; }
      Upstream.sharedQueue.deltaOffset = i;
      const list = Upstream.sharedQueue.queue[index];
      for (const a of list) {
        switch (a[0]) {
          case 'push': {
            const target = a[1];
            const ext = Upstream.getExtensionData(target);
            if (!ext) { continue; }
            const versionAtModification: number = a[2];
            if (!(target as any)._gid || ext.version === versionAtModification) { // no newer updates, initiate syncing
              proms.push(promise(async resolve => {
                try { await Upstream.pushImmediate(target, ext); } catch (e) { }
                resolve();
              }));
            }
          } break;
          case 'pull': {
            const target = a[1];
            const ext = Upstream.getExtensionData(target);
            if (!ext) { continue; }
            proms.push(Upstream.pullImmediate(target, ext));
          } break;
          case 'premake': {
            const type = a[1];
            Upstream.typesPremakePending[(type as any).fullname] = false;
            proms.push(new Promise(resolve => resolve(Upstream.premake(type, null, 1))));
          } break;
          case 'callback': {
            const callback = a[1];
            proms.push(new Promise(resolve => resolve(callback())));
          } break;
        }
      }
      if (list.length > 0) { Upstream.sharedQueue.queue[index] = []; }
    }
    Upstream.sharedQueue.cursor += delta;
    while (Upstream.sharedQueue.cursor >= queueLen) { Upstream.sharedQueue.cursor -= queueLen; }
    Upstream.sharedQueue.last = now;
    Upstream.sharedQueue.deltaOffset = 0;
    Upstream.sharedQueue.beingHandled = false;
    return proms;
  }

  static premakeQueue<T = any>(type: Class<T>, ms = 10) {
    const typeAny = (type as any);
    const premakeConf: UpstreamPremakeConfig<T> = typeAny.premake;
    if (!premakeConf || Upstream.typesPremakePending[typeAny.fullname]) { return; }
    Upstream.typesPremakePending[typeAny.fullname] = true;
    Upstream.asyncWorkload(ms, [ 'premake', type ]);
  }

  static premake<T = any>(type: Class<T>, count?: number, limitGenerationMs = 0) {
    const typeAny = type as any;
    const premakeConf: UpstreamPremakeConfig<T> = typeAny.premake;
    const targetSize = count ? count : premakeConf.size;
    if (premakeConf.list.length >= targetSize) { return 0; }
    let makeCount = targetSize - premakeConf.list.length;
    const start = Date.now();
    let totalAdded = 0;
    for (let i = 0; i < makeCount; ++i) {
      if (limitGenerationMs && Date.now() - start >= limitGenerationMs) { break; }
      premakeConf.list.push(new type());
      ++totalAdded;
    }
    const allAdded = (makeCount - totalAdded === 0);
    if (!allAdded && limitGenerationMs === 1) { // from async workload
      Upstream.premakeQueue(type);
    }
    return makeCount - totalAdded;
  }

  static premakeSetSize<T = any>(type: Class<T>, size = 100) {
    const typeAny = type as any;
    if (!typeAny.premake) {
      typeAny.premake = { list: [], size };
      return;
    }
    const premakeConf: UpstreamPremakeConfig<T> = typeAny.premake;
    premakeConf.size = size;
    Upstream.premakeQueue(type);
  }

  static async flush() {
    const proms = Upstream.tickQueue(true);
    if (proms.length) { await PromUtil.allSettled(proms); }
  }

  static connect<T>(target: T, extension?: UpstreamExtensionData) {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    extension.connected = true;
  }

  static disconnect<T>(target: T, extension?: UpstreamExtensionData) {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    extension.connected = false;
  }

  static pause<T>(target: T, extension?: UpstreamExtensionData) {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    extension.paused = true;
  }

  static resume<T>(target: T, extension?: UpstreamExtensionData) {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    extension.paused = false;
    if (extension.touched) {
      Upstream.pushBaseOnSyncType(target, extension);
    }
  }

  static push<T>(target: T): Promise<void> {
    return promise(async resolve => {
      const extension = Upstream.getExtensionData(target);
      extension.push.explicit = true;
      await Upstream.pushImmediate(target, extension);
      resolve();
    });
  }

  static pushImmediate<T>(target: T, extension?: UpstreamExtensionData, cb?: UpstreamDataOpCallback) {
    return promise(async (resolve, reject) => {
      const wrappedCb: UpstreamDataOpCallback = (r: Result) => {
        if (cb) { cb(r?.ok); }
        if (r?.ok) {
          return resolve();
        } else {
          return reject(r?.error ? r.error : new Error(r?.message));
        }
      }
      if (!extension) { extension = Upstream.getExtensionData(target); }
      if (!Context.online) {
        Upstream.backlog.push(['push', target, extension.version, wrappedCb]);
        return UpstreamCode.error('CREATE_OFFLINE_BACKLOG');
      }
      let finalRes;
      if (extension.push.fullPushPromise) {
        finalRes = await extension.push.fullPushPromise;
      }
      if (!(target as any)._gid) {
        const insertFlowJson = Upstream.getInsertFlowJson(target, extension);
        extension.push.fullPushPromise = Upstream.handleInsertList(insertFlowJson);
        finalRes = await extension.push.fullPushPromise;
        extension.push.fullPushPromise = null;
        if (extension.syncCallback) { extension.syncCallback(finalRes); }
      } else {
        const updaterVersion = extension.version;
        const updater: {set: {[key: string]: any}} = { set: {} };
        for (const propName of Object.keys(extension.props)) {
          const propDef = extension.props[propName];
          if (!propDef || !propDef.rootVersionWhenModified) { continue; }
          if (extension.versionLastSynced < propDef.rootVersionWhenModified) {
            updater.set[propName] = propDef.newValue;
          }
        }
        extension.push.fullPushPromise = promise(async resolve2 => {
          const connResult = await Upstream.getTargetDatastore(target);
          if (connResult.bad) { return resolve2(passthru(connResult)); }
          const conn = connResult.data;
          const res = await conn.update<T>(extension.class, (target as any)._gid, updater);
          if (res.bad || res.data === false) {
            for (const propName of Object.keys(extension.props)) {
              const propDef = extension.props[propName]; if (!propDef) { continue; }
              if (propDef.lastAcknowledgedValue !== null) {
                const contextDisabeldBefore = Context.disabled;
                Context.disabled = true;
                target[propName] = propDef.lastAcknowledgedValue;
                Context.disabled = contextDisabeldBefore;
              }
            }
            return resolve2(passthru(res));
          }
          if (updaterVersion > extension.versionLastSynced) {
            extension.versionLastSynced = updaterVersion;
          }
          return resolve2(ok(true));
        });
        finalRes = await extension.push.fullPushPromise;
      }
      wrappedCb(finalRes);
      return finalRes;
    });
  }

  static async pushBaseOnSyncType(target: any, extension?: UpstreamExtensionData, cb?: UpstreamDataOpCallback) {
    return promise(async (resolve, reject) => {
      if (!extension) { extension = Upstream.getExtensionData(target); }
      const syncType = isDefined(extension.syncType) ? extension.syncType : Upstream.defaultSync;
      if (syncType === UpstreamSync.IMMEDIATE) {
        return await Upstream.pushImmediate(target, extension, cb);
      } if (syncType === UpstreamSync.MANUAL) {
        return resolve();
      } else {
        if (!Upstream.queueStarted) { Upstream.startQueue(); }
        const pushResolve = async () => {
          try {
            resolve(await Upstream.push(target));
          } catch (e) { reject(e); }
        }
        if (syncType > Upstream.sharedQueue.length) {
          setTimeout(pushResolve, syncType);
        } else {
          const delta = syncType + (Date.now() - Upstream.sharedQueue.last);
          if (delta > Upstream.sharedQueue.length) {
            setTimeout(pushResolve, syncType);
          } else {
            // modCount must match at the time of sync, otherwise ignored.
            Upstream.asyncWorkload(delta, [ 'push', target, extension.version, cb ]);
          }
        }
      }
    });
  }

  static async pullGid<T>(type: Class<T>, _gid: string): Promise<T> {
    let reg = Upstream.objectRegistry[_gid];
    if (!reg) {
      reg = Upstream.objectRegistry[_gid] = { pending: null, obj: null };
      reg.pending = new Promise<T>(async resolve => {
        const connResult = await Upstream.getTargetDatastore<T>({ _gid } as unknown as T);
        if (connResult.bad) { return passthru(connResult); }
        const conn = connResult.data;
        const res = await conn.read<T>(type, _gid);
        if (res.bad) {
          reg.pending = null;
          return resolve(null);
        }
        const target = Upstream.targetSolidify(type, res.data, _gid);
        resolve(target);
      });
      return await reg.pending;
    }
    if (reg.pending) { await reg.pending; }
    let target: T = reg.obj;
    if (target) { return Upstream.pull(target); }
    return null;
  }

  static targetSolidify<T>(type: Class<T>, data: Partial<T>, _gid?: string) {
    if (!_gid) { _gid = (data as any)._gid; }
    if (!_gid) { return null; }
    let reg = Upstream.objectRegistry[_gid];
    if (reg && !reg.pending && reg.obj) {
      return reg.obj as T;
    }
    if (!reg) { reg = Upstream.objectRegistry[_gid] = { pending: null, obj: null }; }
    if (!reg.obj) { reg.obj = new type(); }
    Upstream.targetImportData(reg.obj, data);
    const ext = Upstream.getExtensionData(reg.obj);
    if (isNaN(ext.version)) { ext.version = 0; }
    ext.versionLastSynced = ext.version;
    ext.push.explicit = true;
    if (!reg.obj._gid) {
      Object.defineProperty(reg.obj, '_gid', { value: _gid });
    }
    return reg.obj as T;
  }

  static async pull<T>(target: T, extension?: UpstreamExtensionData): Promise<T> {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    return new Promise<T>(resolve => {
      Upstream.pullImmediate(target, extension, _ => { resolve(target); });
    });
  }

  static getMetadata(target: any): UpstreamTargetMetadata {
    return (target as any).__upstream_meta_fields;
  }
 
  static targetImportData<T>(target: T, newData: Partial<T>) {
    if (!(target as any).__upstream_meta_fields) {
      Object.defineProperty(target, '__upstream_meta_fields', { value: {} });
    }
    const metaProps = (target as any).__upstream_meta_fields;
    for (const prop of Object.keys(newData)) {
      if (prop.charAt(0) === '_') {
        metaProps[prop] = newData[prop];
        continue;
      }
      try { target[prop] = newData[prop]; } catch (e) {}
    }
    if (!(target as any)._gid && (newData as any)._gid) {
      Object.defineProperty(target, '_gid', { value: (newData as any)._gid });
    }
  }

  static async pullImmediate<T>(target: T, extension?: UpstreamExtensionData, cb?: UpstreamDataOpCallback<T>) {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    const clsName = extension.class.name;
    if (Context.onlineUpstream[clsName] && !Context.onlineUpstream[clsName].online) {
      Upstream.backlog.push(['pull', target, cb]);
      return;
    }
    if (!Context.online) {
      Upstream.backlog.push(['pull', target, cb]);
      return;
    }
    const connResult = await Upstream.getTargetDatastore(target);
    if (connResult.bad) {
      if (cb) { cb(target); }
      return passthru(connResult);
    }
    const conn = connResult.data;
    const res = await conn.read<T>(extension.class, (target as any)._gid);
    if (res.ok) { Upstream.targetImportData(target, res.data); }
    if (cb) { cb(target); }
  }

  static async getTargetDatastore<T = any>(target: T): Promise<Result<UpstreamDatastore>> {
    const extension = Upstream.getExtensionData(target);
    if (!extension) {
      return UpstreamCode.error('TARGET_HAS_NO_UPSTREAM');
    }
    const type: Class<T> = extension.class;
    const upstreamDef: UpstreamClassConfig<T> = (type as any).upstream;
    if (!type || !upstreamDef) {
      return UpstreamCode.error('TARGET_TYPE_HAS_NO_UPSTREAM_DEF', type.name);
    }
    let path: string = (target as any)._gid ? parseGlobalId((target as any)._gid).path : '';
    let router: UpstreamDatastoreRouter;
    if (!path) {
      const pathResolver = upstreamDef.universe?.[Upstream.currentUniverse];
      if (!pathResolver) {
        path = defaultUpstreamPath;
      } else if (typeof pathResolver === 'string') {
        path = pathResolver;
      } else {
        const resolvePromise = pathResolver(target);
        if (typeof resolvePromise === 'string') {
          path = resolvePromise;
        } else {
          const pathResult = await Promise.resolve(resolvePromise);
          if (typeof pathResult === 'string') {
            path = pathResult;
          } else {
            if (pathResult.bad) {
              // TODO
            }
            path = pathResult.data;  
          }
        }
      }
    }
    router = Upstream.datastore[path];
    if (!router) {
      return UpstreamCode.error('TARGET_UPSTREAM_ROUTER_UNRESOLVABLE',
        `upstream for path '${path}' not found. Did you forget to Upstream.add your datastore?`);
    }
    let route = defaultUpstreamRoute;
    if (router.getRoute) {
      route = await router.getRoute(target);
      if (!route) { route = defaultUpstreamRoute; }
    }
    const conn = router.routes[route];
    if (!conn) {
      return UpstreamCode.error('TARGET_UPSTREAM_ROUTE_UNRESOLVABLE', route);
    }
    const result = conn.index.checkDefinitions(type);
    if (!result.timeUpdated) {
      const indexDefinitions: CollectionIndexes<T> = {};
      for (const indexName of Object.keys(upstreamDef.index)) {

      }
      conn.index.setDefinitions(type, upstreamDef.index);
    }
    await Upstream.initializeIndexFor(type, conn);
    return ok(conn);
  }

  static async initializeIndexFor<T>(type: Class<T>, conn: UpstreamDatastore<any>, forceRecheck = false) {
    const upstreamDef: UpstreamClassConfig<T> = (type as any).upstream;
    if (!upstreamDef?.index) { return; }
    const result = conn.index.checkDefinitions(type);
    if (forceRecheck || !result.timeUpdated) {
      const indexDefinitions: CollectionIndexes<T> = {};
      for (const indexName of Object.keys(upstreamDef.index)) {
        indexDefinitions[indexName] = upstreamDef.index[indexName].indexInfo();
      }
      conn.index.setDefinitions(type, indexDefinitions);
      await conn.index.ensure(type, indexDefinitions, forceRecheck);
    }
  }

  static getInsertFlowJson<T = any>(target: T, extension?: UpstreamExtensionData<T>): UpstreamInsertFlowMember[] {
    if (!extension) { extension = Upstream.getExtensionData(target); }
    const objs = [];
    const igList = [];
    Upstream.markSubtree(target, null, [], objs, (subTarget, parent, path, aggr) => {
      const meta = TypeToolsBase.addMetaProperty(subTarget);
      const objExt = Upstream.getExtensionData(target);
      meta.oref = Upstream.tempObjectRegister(subTarget);
      meta.ins = 1;
      meta.n = aggr.length;
      meta.lvl = 0;
      meta.typename = typeFullName(objExt.class);
      if (parent) {
        meta.lvl = parent._meta.lvl + 1;
        meta.parent = parent._meta.n;
        igList.push(path);
      }
      aggr.push({
        parent: parent ? parent._meta.n : null,
        lvl: meta.lvl,
        path,
        target: subTarget,
        oref: meta.oref,
      });
    });
    const targetJSON = objs.length > 0 ? JSON.parse(Upstream.stringify(objs[0].target))
                                        : JSON.parse(Upstream.stringify(target));
    const jsonList: UpstreamInsertFlowMember[] = [];
    const getMemberFromNode = (node, ig = []) => {
      const target = Upstream.tempObjectDereference(node._meta.oref);
      const targetExt = Upstream.getExtensionData(target);
      Upstream.tempObjectDeregister(node._meta.oref);
      const parent = isNaN(node._meta.parent) ? null : node._meta.parent;
      return {
        parent,
        lvl: node._meta.lvl,
        path: ig,
        target: node,
        typename: node._meta.typename,
        oref: node._meta.oref,
        typeGetter: () => targetExt.class,
        targetGetter: () => target,
      };
    };
    for (let i = igList.length - 1; i >= 0; --i) {
      const ig = igList[i];
      let node = targetJSON;
      const uptilLast = ig.length - 1;
      for (let j = 0; j < uptilLast; ++j) { node = node[ig[j]]; }
      const lastKey = ig[uptilLast];
      const lastNode = node[lastKey];
      jsonList.unshift(getMemberFromNode(lastNode, ig));
      node[lastKey] = null;
      if (lastNode._meta) { delete lastNode._meta; }
    }
    jsonList.unshift(getMemberFromNode(targetJSON));
    if (targetJSON._meta) { delete targetJSON._meta; };
    extension.touched = true;
    return jsonList;
  }

  static markSubtree(target: any, parent: any, path: any[], aggregator: any[],
                     marker: (subTarget: any, parent: any, path: any[], aggregator?: any[]) => void) {
    if (target) {
      if (Array.isArray(target)) {
        for (let i: number = 0; i < target.length; ++i) {
          const a = target[i]; if (!a) { continue; }
          const addedPath = path.concat(i);
          // (addedPath as any).prop = (path as any).prop;
          Upstream.markSubtree(a, parent, addedPath, aggregator, marker);
        }
      } else if (typeof target === 'object') {
        const ext = Upstream.getExtensionData(target);
        if (ext) {
          marker(target, parent, path, aggregator);
          parent = target;
        }
        let ephemExt;
        if (parent === target) { ephemExt = Ephemerals.getExtensionData(target); }
        for (const prop of Object.keys(target)) {
          const a = target[prop];
          if (!a) { continue; }
          if (ephemExt && ephemExt[prop]) { continue; }
          const addedPath = path.concat(prop);
          // (addedPath as any).prop = prop;
          Upstream.markSubtree(a, parent, addedPath, aggregator, marker);
        }
      }    
    }
  }

  static async handleInsertList(list: UpstreamInsertFlowMember[]): Promise<Result<any>> {
    const allInserted = [];
    let error: Result = null;
    const rootTarget = list[0].targetGetter();
    for (const insertRubric of list) {
      try {
        const target = insertRubric.targetGetter();
        const connResult = await Upstream.getTargetDatastore(target);
        if (connResult.bad) { error = connResult; break; }
        insertRubric.conn = connResult.data;
        if (insertRubric.parent !== null) {
          const parentRubric = list[insertRubric.parent];
          insertRubric.target._parent = parentRubric.insertedGid;
        }
        const createResult = await insertRubric.conn.create(insertRubric.typeGetter(), insertRubric.target, (insertRubric.typeGetter() as any).version);
        if (createResult.bad) {
          error = createResult;
          break;
        }
        const insertedGid = createResult.data;
        insertRubric.insertedGid = insertedGid;
        allInserted.push({ id: insertedGid, rubric: insertRubric });
      } catch (e) {
        error = UpstreamCode.error('INSERT_FLOW_MEMBER_CREATE_ERROR');
      }
    }
    // Update last inserted ids
    // if (upstreamRuntime.trackLastInsertIds && Upstream.metadataHandler) {
    //   const conn = await Upstream.metadataHandler.getEndpoint(Upstream.metadataHandlerDsKey);
    //   for (const typename of Object.keys(typeLastInsertedIds)) {
    //     const insertedId = typeLastInsertedIds[typename];
    //     await conn.upsert(UpstreamClassConfigClass, { type_name: typename }, {
    //       set: { last_insert_id: insertedId }
    //     });
    //   }
    // }
    // update parent linkage
    for (const childRubric of list) {
      if (error) { break; }
      if (childRubric.parent !== null) {
        const parentRubric = list[childRubric.parent];
        if (!parentRubric.updater) { parentRubric.updater = { set: { _gid: parentRubric.insertedGid } }; }
        parentRubric.updater.set[childRubric.path.join('.')] = childRubric.insertedGid;
      }
    }
    for (const pendingRubric of list) {
      if (error) { break; }
      if (pendingRubric.updater) {
        const updateResult = await pendingRubric.conn.update(pendingRubric.typeGetter(), pendingRubric.insertedGid, pendingRubric.updater);    
        if (updateResult.bad) {
          error = updateResult;
          break;
        }
      }
    }
    for (const insertRubric of list) {
      if (error) { break; }
      const target = insertRubric.targetGetter();
      if (!target) { continue; }
      const objExt = Upstream.getExtensionData(target);
      if (isNaN(objExt.version)) { objExt.version = 0; }
      if (!insertRubric.updater) {
        const gidUpdateResult = await insertRubric.conn.update(insertRubric.typeGetter(), insertRubric.insertedGid, { set: { _gid: insertRubric.insertedGid } });
        if (gidUpdateResult.bad) {
          error = gidUpdateResult;
          break;
        }
      }
      objExt.versionLastSynced = objExt.version;
      if (!target._gid) {
        Object.defineProperty(target, '_gid', { value: insertRubric.insertedGid });
      }
      for (const propName of Object.keys(objExt.props)) {
        const propDef = objExt.props[propName]; if (!propDef) { continue; }
        if (insertRubric.target[propName] !== null) {
          propDef.lastAcknowledgedValue = insertRubric.target[propName];
        }
      }
      let reg = Upstream.objectRegistry[insertRubric.insertedGid];
      if (!reg) { reg = Upstream.objectRegistry[insertRubric.insertedGid] = { pending: null, obj: null }; }
      reg.obj = target;
      const readResult = await insertRubric.conn.read(insertRubric.typeGetter(), insertRubric.insertedGid);
      if (readResult.bad) {
        error = readResult;
        break;
      }
      Upstream.targetImportData(target, readResult.data);
    }
    if (error) {
      // TODO revert all inserts
      return error;
    } else {
      return ok(rootTarget);
    }
  }

  static async handlePropUpdate(target: any, ext: UpstreamExtensionData, prop: string, oldValue: any, newValue: any, e: PropertyAccessEvent) {
    if (Context.disabled) { return; }
    if (isNaN(ext.version)) { ext.version = 0; }
    ++ext.version; ext.touched = true;
    const propDef = ext.props[prop];
    propDef.newValue = newValue;
    propDef.touched = true;
    propDef.rootVersionWhenModified = ext.version;
    if (!propDef || propDef.disconnected || ext.paused) { return; }
    if (!ext.push.explicit) { return; } // not even authorized to upload yet
    const syncType = isDefined(propDef.syncType) ? propDef.syncType : isDefined(ext.syncType) ? ext.syncType : Upstream.defaultSync;
    if (syncType === UpstreamSync.IMMEDIATE) {
      try {
        await Upstream.pushImmediate(target, ext);
      } catch (e) { console.error(e); }
    } else if (syncType === UpstreamSync.MANUAL) {
      return;
    } else {
      if (!Upstream.queueStarted) { Upstream.startQueue(); }
      if (syncType > Upstream.sharedQueue.length) {
        setTimeout(async () => {
          try {
            await Upstream.push(target);  
          } catch (e) { console.error(e); }
        }, syncType);
      } else {
        // modCount must match at the time of sync, otherwise ignored.
        const delta = syncType + (Date.now() - Upstream.sharedQueue.last);
        Upstream.asyncWorkload(delta, [ 'push', target, ext.version ]);
      }
    }
  }

  static tempObjectRegister(obj: any) {
    const oref = makeid(32);
    Upstream.tempObjectReferenceRegistry[oref] = { obj, t: Date.now() };
    return oref;
  }

  static tempObjectDeregister(oref: string) {
    if (Upstream.tempObjectReferenceRegistry[oref]) { delete Upstream.tempObjectReferenceRegistry[oref]; }
  }

  static tempObjectDereference(oref: string)  {
    const refObj = Upstream.tempObjectReferenceRegistry[oref];
    if (!refObj) { return null; }
    return refObj.obj;
  }
  
  static registerError(e: Error) {
    Upstream.errors.push(e);
    Upstream.topError = e;
  }

  static hasUpstream<T>(type: Class<T>) {
    return type && (type as any).upstream;
  }

  static forTest = {
    purge: () => { for (const key of Object.keys(Upstream.datastore)) { delete Upstream.datastore[key]; } }
  };

  settings: UpstreamSettings;

  constructor(settings?: Partial<UpstreamSettings>) {
    this.settings = settingsInitialize(UpstreamSettings, settings);
  }

  getExtensionData(target: any) { return Upstream.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return Upstream.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return Upstream.implementOn(target, this.settings as any); }

}

export type SemVer = `${number}.${number}.${number}` | `${number}.${number}.${number}-${string}` | `${number}.${number}.${number}+${string}`;
export function semver<T>(v: SemVer) {
  return v;
}

export interface UpstreamClassRequirement<T = any> {
  nameAtDef?: string;
  // must have namespace consortium
  nscInfo?: UpstreamNamespaceCosortiumInfo;
  // must have version as static member
  version?: SemVer;
  name: string;
}

export interface UpstreamNamespaceCosortiumInfo {
  classVersion: SemVer;
  name?: string;
  consortium?: string;
  url?: string;
  season?: number;
}

/**
 * 
 * @param nsc Namespace Consortirum this class falls under
 * @returns decorator for input class with upstream data initialized
 */
export function dataclass(nscInfo: UpstreamNamespaceCosortiumInfo) {
  return function <U extends UpstreamClassRequirement>(type: U) {
    if (!Upstream.queueStarted) { Upstream.startQueue(); }
    const typeAny = (type as any);
    if (!nscInfo) { nscInfo = { classVersion: '0.0.1' }; }
    if (!nscInfo.consortium) { nscInfo.consortium = 'local'; }
    if (!nscInfo.url) { nscInfo.url = ''; }
    if (!nscInfo.season) { nscInfo.season = 1; }
    if (!nscInfo.name) { nscInfo.name = nscInfo.consortium; }
    if (!nscInfo.classVersion) { nscInfo.classVersion = '0.0.1'; }
    typeAny.version = nscInfo.classVersion;
    typeAny.nscInfo = nscInfo;
    typeAny.upstream = { universe: {}, index: {}, indexColumns: {} };
    const fullname = typeFullName(typeAny);
    // if (!typeAny.versions) { typeAny.versions = {}; }
    // if (!typeAny.versions[fullname]) {
    //   throw new Error(`${typeAny.name} does not have static version identifier (e.g. static version = semver(this, '0.0.1'))`);
    // }
    if (!Upstream.types[fullname]) {
      Upstream.types[fullname] = typeAny;
      if (Upstream.trackClassSource) { typeAny.src = spotfull(new Error, 3); }
      const lin = ClassLineage.of(type);
      const linCopy = []; for (let i = 1; i < lin.length; ++i) { linCopy.push(lin[i]); }
      typeAny.lineage = linCopy;
      typeAny.premake = { list: [], size: 100 } as UpstreamPremakeConfig<U>;
      typeAny.make = getFactory(typeAny);
      typeAny.fullname = fullname;
    } else {
      typeAny.olderType = 'yes';
    }
    return type;
  }
}

export function make<T = any>(type: Class<T>, init?: Partial<T>) {
  const maker = (type as any).make;
  if (!maker) { return new type; }
  return maker(init);
}

export function getFactory<T = any>(type: Class<T>) {
  const typeAny = (type as any);
  return (init?: Partial<T>) => {
    if (!typeAny.premake) { return new type(init); }
    let target: T ;
    if (typeAny.premake.list.length > 0) {
      target = typeAny.premake.list.pop();
      if (init) { Object.assign(target, init); }
    } else {
      target = new type(init);
    }
    Upstream.premakeQueue(type);
    return target;
  };
}

export const push = Upstream.push;
export const pull = Upstream.pull;

function isDefined(a) {
  return a !== undefined && a !== null;
}

// https://stackoverflow.com/a/1349426
function makeid(length: number) {
  const result = [];
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for (let i = 0; i < length; ++i) {
     result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
  }
  return result.join('');
}

