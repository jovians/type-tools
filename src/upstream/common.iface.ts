/* Jovian (c) 2020, License: MIT */
import { Class, PartialCustom } from '../type-transform';
import { Result } from '../common/util/enum.util';

export interface UpstreamIndexOptions {
  unique?: any;
  nonsparse?: any;
}

export interface UpstreamTargetMetadata {
  /** global id. e.g. $ref.local.s1.TestClass/local/6316e82600fe6e2c23fdbcb2  */
  _gid: string;
  /** local id. e.g. 6316e82600fe6e2c23fdbcb2 */
  _id: string;
  /** type full name, e.g. 'local.s1.TestClass' */
  _tfn: string;
  /** type version, e.g. 0.0.1 */
  _tv: string;
  /** data version (incremented for every update), e.g. 5 */
  _v: number;
  /** time created */
  _ct: number;
  /** time updated */
  _ut: number;
}

export interface UpstreamDataIndexDefinition {
  name: string;
  options?: UpstreamIndexOptions;
  columns: {[column:string]: any};
}

export const UpstreamComparisonType = Object.freeze({
  'greater than': '__GT',
  GT: '__GT',

  'greater than or equal to': '__GTE',
  GTE: '__GTE',
  
  'less than': '__LT',
  LT: '__LT',

  'less than or equal to': '__LTE',
  LTE: '__LTE',

  'not in': '__NOT_IN',
  'none of': '__NOT_IN',
  'is none of': '__NOT_IN',
  NOT_IN: '__NOT_IN',
  NIN: '__NOT_IN',

  'any of': '__IN',
  'is any of': '__IN',
  ANY_OF: '__IN',
  IN: '__IN',

  is: '__EQ',
  EQ: '__EQ',
  'equal to': '__EQ',

  'is not': '__NEQ',
  NEQ: '__NEQ',
  'not equal to': '__NEQ',
});

export interface UpstreamDataFilter {
  type: any;
  target: any;
  projection?: any;
  range?: { from?: any; to?: any; };
  sort?: {[column: string]: number}[];
  limit?: number;
}

export interface UpstreamDatastoreEndpointConfig<CredType = string> {
  type: string;
  endpoint: string;
  credentials?: CredType;
  info?: any;
}

export interface UpstreamDatastoreConfig<CredType = string> {
  path: string;
  endpoint: UpstreamDatastoreEndpointConfig<CredType>;
  otherEndpoints?: { [endpointKey: string]: { type: string; endpoint: UpstreamDatastoreEndpointConfig<CredType>; }; };
  concurrency?: number;
}

export interface UpstreamDatastore<CredType = any> {
  config: UpstreamDatastoreConfig<CredType>;
  create: <T>(type: Class<T> | string, target: T, typeVersion?: string) => Promise<Result<string>>;
  read: <T>(type: Class<T> | string, gid: string, version?: number) => Promise<Result<T>>;
  update: <T>(type: Class<T> | string, gid:string, updater: UpstreamTargetUpdater) => Promise<Result<boolean>>;
  delete: <T>(type: Class<T> | string, gid:string) => Promise<Result<boolean>>;
  find: <T, Indexer>(type: Class<T> | string, matcher: UpstreamTargetMatcher<T>, limit?: number, indexName?: string) => Promise<Result<T[]>>;
  list: <T>(type: Class<T> | string, filter: UpstreamDataFilter) => Promise<Result<T[]>>;
  admin: UpstreamAdminOperations;
  index: UpstreamDataIndexes;
}

export interface UpstreamAdminOperations {
  dropCollection: <T>(type: Class<T> | string) => Promise<Result<boolean>>;
};

export const ASC: 1 = 1;
export const DESC: -1 = -1;
export type UpstreamIndexSortValues = (typeof ASC | typeof DESC);

export interface CollectionIndex<T> {
  name: string;
  columns?: PartialCustom<T, any>,
  options?: UpstreamIndexOptions,
}

export interface CollectionIndexes<T> {
  [indexName: string]: CollectionIndex<T>;
}

export interface KnownCollections<T> {
  [typename: string]: {
    exists?: boolean;
    pending?: Promise<Result<T>>;
    pendingDelete?: Promise<any>;
    collection?: T;
    timeIndexUpdated?: number;
    timeIndexDefinitionSet?: number;
    indexDefinitions?: CollectionIndexes<any>;
  }
}

export interface UpstreamDataIndexes {
  checkDefinitions: <T>(type: Class<T> | string) => { definitions: CollectionIndexes<T>; timeSet: number; timeUpdated: number; };
  setDefinitions: <T>(type: Class<T> | string, indexDefinitions: CollectionIndexes<T>) => void;
  create: <T>(type: Class<T> | string, index: CollectionIndex<T>) => Promise<Result<boolean>>;
  delete: <T>(type: Class<T> | string, index: CollectionIndex<T>) => Promise<Result<boolean>>;
  list: <T>(type: Class<T> | string) => Promise<Result<UpstreamDataIndexDefinition[]>>;
  ensure: <T>(type: Class<T> | string, indexDefinitions?: CollectionIndexes<T>, forceRecheck?: boolean) => Promise<Result<boolean>>;
}

export interface UpstreamIndexType<Indexer = any, T = any> {
  get: (target: Partial<Indexer>) => Promise<T>;
  find: (target: Partial<Indexer>) => Promise<T[]>;
  indexInfo: () => CollectionIndex<T>;
}

export interface UpstreamTargetUpdater<T = any> {
  set? : { [K in keyof T]: T[K] }
  typeVersionMatch?: string;
  versionMatch?: number;
}

export type UpstreamTargetMatcher<T = any> = { [K in keyof T]: T[K] };

export interface UpstreamDatastoreActionItem {
  target: any;
  action: string;
  params: any;
}

export type UpstreamDatastorePathResolver<T> = string | ((target: Partial<T>) => Promise<Result<string> | string> | string);
export interface UpstreamClassConfig<T, Indexes = any> {
  universe?: { [universeName: string]: UpstreamDatastorePathResolver<T>; }
  index?: Indexes;
}

export const defaultUpstreamDatabaseName = 'upstream_data';

export const defaultUpstreamMetadataTable = '__upstream_meta';

export const defaultUpstreamTxDataTable = '__upstream_tx';

export const defaultUpstreamUniverse = 'local';

export const defaultUpstreamPath = 'local';

export const defaultUpstreamRoute = '__upstream_df_route';

export const upstreamRuntime = {
  skipMetaChecks: false,
  trackLastInsertIds: true,
};

function aliasedName(type: Class<any>) {
  if ((type as any).importedName) { return (type as any).importedName; }
  const path = (type as any).path;
  if (!path) { return type.name; }
  const prefix = path.namespace ? `${path.namespace}.` : '';
  if (path.importedName) {
    return prefix + path.importedName;
  } else {
    return prefix + type.name;
  }
}

export function typeFullName(type: Class<any>): string {
  const typeAny = (type as any);
  if (typeAny.globalName) { return typeAny.globalName; }
  if (typeAny?.nscInfo) {
    const season = typeAny.nscInfo.season ? typeAny.nscInfo.season : 1;
    typeAny.globalName = `${typeAny.nscInfo.name}.s${season}.${typeAny.nameAtDef ? typeAny.nameAtDef : typeAny.name}`;
  } else {
    typeAny.globalName = aliasedName(type);
  }
  return typeAny.globalName;
}

export function getGlobalId<T = any>(type: Class<T> | string, path: string, localId: string) {
  type = typeof type === 'string' ? type : typeFullName(type);
  if (type.indexOf('.') === -1) {
    type = `local.s1.${type}`;
    // throw new Error(`Global type without namespace (missing dot)`);
  }
  if (path) {
    return `$ref.${type}/${path}/${localId}`;
  } else {
    return `$ref.${type}/${localId}`;
  }
}

export function parseGlobalId(glid: string) {
  const lit = glid.split('/');
  const header = lit[0];
  lit[0] = '';
  const localId = lit.pop();
  const path = lit.filter(a => a).join('/');
  return {
    typeFullName: header.substring(4),
    path,
    localId,
  };
}
