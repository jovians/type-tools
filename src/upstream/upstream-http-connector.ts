import { CollectionIndex, CollectionIndexes, KnownCollections, typeFullName, UpstreamDataFilter, UpstreamDataIndexDefinition, UpstreamDatastore, UpstreamDatastoreConfig, UpstreamIndexOptions } from "./common.iface";
import { deepCopy, errorResult, ok, promise, Result, ReturnCodeFamily } from "../common/globals.ix";
import { Class } from "../type-transform";
import * as axios from 'axios';
import { Upstream, UpstreamIndex } from "../upstream";

enum DatastoreCodeEnum {
  CONNECTION_ERROR,
  CREATE_ACK_FAIL,
  CREATE_CONTENTION_INDEX,
  CREATE_ERROR,
  READ_NO_GID,
  READ_ERROR,
  UPDATE_NO_GID,
  UPDATE_INDEX_CONTENTION,
  UPDATE_ERROR,
  COLLECTION_NOT_FOUND,
  COLLECTION_NOT_FOUND_CACHED,
  COLLECTION_FETCH_ERROR,
  COLLECTION_CREATE_ERROR,
  COLLECTION_FETCH_REJECT,
}
export const MongoCode = ReturnCodeFamily('DatastoreCode', DatastoreCodeEnum);

export interface UpstreamHttpDatastoreCredentials {
  authHeaders?: {
    [header: string]: string;
  };
}

export class UpstreamHttpDatastore implements UpstreamDatastore<UpstreamHttpDatastoreCredentials> {
  knownCollections: KnownCollections<any> = {};
  indexEnsuringPromise: Promise<any> = null;
  config: UpstreamDatastoreConfig<UpstreamHttpDatastoreCredentials>;
  endpoint: string;

  constructor(config: UpstreamDatastoreConfig<UpstreamHttpDatastoreCredentials>) {
    this.config = config;
    this.endpoint = this.config.endpoint.endpoint;
  }

  async read<T>(type: Class<T> | string, _gid: string, _v?: number): Promise<Result<T>> {
    try {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      await this.index.ensure(typename);
      if (!_gid) { return MongoCode.error('READ_NO_GID'); }
      const res = await axios.default.get(`${this.endpoint}/read`, { data: { typename, _gid  } });
      return ok(res.data.result);
    } catch (e) {
      const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
      if (Upstream.showOperationErrors) { console.error(concise); }
      return MongoCode.error('READ_ERROR', e);
    }
  };
  async create<T>(type: Class<T> | string, target: T, typeVersion?: string): Promise<Result<string>> {
    try {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      await this.index.ensure(typename);
      const targetAny = target as any;
      targetAny._tfn = typename; // full global unique type name
      targetAny._tv = typeVersion; // type version
      targetAny._v = 1; // version
      targetAny._ct = Date.now(); // created time
      targetAny._ut = Date.now(); // updated time
      const res = await axios.default.post(`${this.endpoint}/create`, { typename, target, typeVersion });
      return ok(res.data.result);
    } catch (e) {
      const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
      if (Upstream.showOperationErrors) { console.error(concise); }
      return MongoCode.error('CREATE_ERROR', e);
    }
  };
  async update<T>(type: Class<T> | string, _gid: string, updater: any): Promise<Result<boolean>> {
    try {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      await this.index.ensure(typename);
      if (!_gid) { return MongoCode.error('UPDATE_NO_GID'); }
      const res = await axios.default.post(`${this.endpoint}/update`, { typename, _gid, updater });
      return ok(res.data.result);
    } catch (e) {
      const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
      if (Upstream.showOperationErrors) { console.error(concise); }
      return errorResult(e);
    }
  };
  async delete<T>(type: Class<T> | string, id:string): Promise<Result<boolean>> {
    return ok(false);
  };
  async find<T, Indexer>(type: Class<T> | string, matcher: any, limit = 0, indexName: string = null): Promise<Result<T[]>> {
    try {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      await this.index.ensure(typename);
      const res = await axios.default.get(`${this.endpoint}/find`, { data: { typename, matcher, limit, indexName } });
      return ok(res.data.result as unknown as T[]);
    } catch (e) {
      const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
      if (Upstream.showOperationErrors) { console.error(concise); }
      return errorResult(e);
    }
  };
  async list<T>(type: Class<T> | string, filter: UpstreamDataFilter): Promise<Result<T[]>> {
    try {
      // const collection = this.ensureCollection(type);
      // if (filter.type === FilterType.RECENT
    } catch (e) {
      const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
      if (Upstream.showOperationErrors) { console.error(concise); }
      return errorResult(e);
    }
  };
  admin = {
    dropCollection: async <T>(type: Class<T> | string): Promise<Result<boolean>> => {
      try {
        const typename = typeof type === 'string' ? type : typeFullName(type);
        const res = await axios.default.post(`${this.endpoint}/collection/drop`, { typename });
        return ok(res.data.result);
      } catch (e) {
        const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
        if (Upstream.showOperationErrors) { console.error(concise); }
        return errorResult(e);
      }
    }
  };
  index = {
    checkDefinitions: <T>(type: Class<T> | string) => {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      const collectionInfo = this.knownCollections[typename];
      return {
        definitions: collectionInfo?.indexDefinitions,
        timeSet: collectionInfo?.timeIndexDefinitionSet,
        timeUpdated: collectionInfo?.timeIndexUpdated,
      };
    },
    setDefinitions: <T>(type: Class<T> | string, indexDefinitions: CollectionIndexes<T>) => {
      const typename = typeof type === 'string' ? type : typeFullName(type);
      let collectionInfo = this.knownCollections[typename];
      if (!collectionInfo) { collectionInfo = this.knownCollections[typename] = {}; }
      collectionInfo.indexDefinitions = indexDefinitions;
      collectionInfo.timeIndexDefinitionSet = Date.now();
    },
    create: async <T>(type: Class<T> | string, indexDefinition: CollectionIndex<T>): Promise<Result<boolean>> => {
      try {
        const typename = typeof type === 'string' ? type : typeFullName(type);
        const columnsCopy = deepCopy(indexDefinition.columns);
        for (const columnName of Object.keys(columnsCopy)) {
          if (columnsCopy[columnName]) { // normalized index sort order
            columnsCopy[columnName] = 1;
          } else {
            columnsCopy[columnName] = -1;
          }
        }
        const indexOptions: any = { name: indexDefinition.name, sparse: true };
        let indexOptionsArg = indexDefinition.options ? indexDefinition.options : {};
        indexOptionsArg = deepCopy(indexOptionsArg);
        if (indexOptionsArg.unique) { indexOptions.unique = true; }
        if (indexOptionsArg.nonsparse) { indexOptions.sparse = false; }
        const res = await axios.default.post(`${this.endpoint}/index/create`, { typename, columns: columnsCopy, options: indexOptions });
        return ok(res.data.result);
      } catch (e) {
        const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
        if (Upstream.showOperationErrors) { console.error(concise); }
        return errorResult(e);
      }
    },
    delete: async<T>(type: Class<T> | string, indexDefinition: CollectionIndex<T>): Promise<Result<boolean>> => {
      try {
        const typename = typeof type === 'string' ? type : typeFullName(type);
        await this.index.ensure(typename);
        return ok(true);
      } catch (e) {
        const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
        if (Upstream.showOperationErrors) { console.error(concise); }
        return errorResult(e);
      }
    },
    list: async <T>(type: Class<T> | string): Promise<Result<UpstreamDataIndexDefinition[]>> => {
      try {
        const typename = typeof type === 'string' ? type : typeFullName(type);
        await this.index.ensure(typename);
        const res = await axios.default.get(`${this.endpoint}/index/list`, { data: { typename } });
        return ok(res.data.result);
      } catch (e) {
        const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
        if (Upstream.showOperationErrors) { console.error(concise); }
        return errorResult(e);
      }
    },
    ensure: async <T>(type: Class<T> | string, indexDefinitions?: CollectionIndexes<T>, forceRecheck?: boolean): Promise<Result<boolean>> => {
      if (this.indexEnsuringPromise) { return this.indexEnsuringPromise; }
      const prom = this.indexEnsuringPromise = promise(async resolve => {
        try {
          const typename = typeof type === 'string' ? type : typeFullName(type);
          let collectionInfo = this.knownCollections[typename];
          if (!collectionInfo) { collectionInfo = this.knownCollections[typename] = {}; }
          if (indexDefinitions) { collectionInfo.indexDefinitions = indexDefinitions; forceRecheck = true; }
          if (!forceRecheck && collectionInfo.timeIndexUpdated) { return resolve(ok(true)); }
          if (!indexDefinitions) { indexDefinitions = this.knownCollections[typename].indexDefinitions; }
          if (!indexDefinitions || Object.keys(indexDefinitions).length === 0) {
            collectionInfo.timeIndexUpdated = Date.now();
            return resolve(ok(true));
          }
          await axios.default.post(`${this.endpoint}/index/ensure`, { typename, indexDefinitions, forceRecheck });
          collectionInfo.timeIndexUpdated = Date.now();
          return resolve(ok(true));
        } catch (e) {
          const concise = e.response?.data?.message ? e.response?.data?.message : e.code;
        if (Upstream.showOperationErrors) { console.error(concise); }
          return resolve(errorResult(e));
        }
      }).finally(() => {
        if (prom === this.indexEnsuringPromise) {
          this.indexEnsuringPromise = null;  
        }
      });
      return prom;
    }
  };
}
