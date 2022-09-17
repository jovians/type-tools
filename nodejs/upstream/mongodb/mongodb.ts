/**
 * Jovian © 2020
 * License: MIT
 */
import { typeFullName, defaultUpstreamDatabaseName, defaultUpstreamMetadataTable, defaultUpstreamPath, 
        defaultUpstreamTxDataTable, getGlobalId, parseGlobalId, UpstreamDataFilter, UpstreamDataIndexDefinition, 
        UpstreamDatastore, UpstreamDatastoreConfig, UpstreamIndexOptions, UpstreamIndexType, UpstreamTargetUpdater, UpstreamDataIndexes, UpstreamAdminOperations, CollectionIndexes, KnownCollections, CollectionIndex } from '../../../src/upstream/common.iface';
import { errorResult, ok, passthru, Result, ReturnCodeFamily } from '../../../src/common/util/enum.util';
import { Class, PartialCustom } from '../../../src/type-transform';
import { Upstream, UpstreamIndex } from '../../../src/upstream';
import * as MongoDB from 'mongodb';
import { deepCopy, promise, PromUtil } from '../../../src';

enum MongoCodeEnum {
  CONNECTION_ERROR,
  CREATE_ACK_FAIL,
  CREATE_CONTENTION_INDEX,
  CREATE_ERROR,
  READ_NO_GID,
  UPDATE_NO_GID,
  UPDATE_INDEX_CONTENTION,
  UPDATE_ERROR,
  COLLECTION_NOT_FOUND,
  COLLECTION_NOT_FOUND_CACHED,
  COLLECTION_FETCH_ERROR,
  COLLECTION_CREATE_ERROR,
  COLLECTION_FETCH_REJECT,
  INDEX_CREATE_CONTENTION,
  INDEX_CREATE_ERROR,
}
export const MongoCode = ReturnCodeFamily('MongoCode', MongoCodeEnum);

export interface MongoDbCredentialType {
  endpoint: string;
  dbname?: string;
  username?: string;
  password?: string;
}

export class UpstreamDatastoreMongo implements UpstreamDatastore<MongoDbCredentialType> {
  knownCollections: KnownCollections<MongoDB.Collection> = {};
  indexEnsuringPromise: Promise<any> = null;
  config: UpstreamDatastoreConfig<MongoDbCredentialType>;
  client: MongoDB.MongoClient;
  dbconn: MongoDB.Db;
  dbConnResolver: () => void;
  dbConnAwaiter = promise(async resolve => this.dbConnResolver = resolve);

  constructor(config: UpstreamDatastoreConfig<MongoDbCredentialType>) {
    if (!config.path) { config.path = defaultUpstreamPath; }
    this.config = config;
    this.initialize();
  }

  async read<T>(type: Class<T> | string, _gid: string, _v?: number): Promise<Result<T>> {
    try {
      if (!_gid) { return MongoCode.error('READ_NO_GID'); }
      const collection = await this.ensureCollection(type);
      const parsed = parseGlobalId(_gid);
      const result = await collection.find({ _id: new MongoDB.ObjectId(parsed.localId) } as any);
      const resultArray = await result.toArray();
      return ok(resultArray[0] as unknown as T);
    } catch (e) {
      if (Upstream.showOperationErrors) { console.error(e); }
      return errorResult(e);
    }
  };
  async create<T>(type: Class<T> | string, target: T, typeVersion?: string): Promise<Result<string>> {
    try {
      const collection = await this.ensureCollection(type);
      const typename = typeof type === 'string' ? type : typeFullName(type);
      const targetAny = target as any;
      targetAny._id = new MongoDB.ObjectId(); // local id
      targetAny._tfn = typename; // full global unique type name
      targetAny._tv = typeVersion; // type version
      targetAny._v = 1; // version
      targetAny._ct = Date.now(); // created time
      targetAny._ut = Date.now(); // updated time
      const result = await collection.insertOne(target);
      if (!result || !result.acknowledged) { return MongoCode.error('CREATE_ACK_FAIL'); }
      const localId = result.insertedId.toString();
      const _gid = getGlobalId(targetAny._tfn, this.config.path, localId);
      return ok(_gid);
    } catch (e) {
      if (Upstream.showOperationErrors) { console.error(e); }
      if (e.code === 11000) { return MongoCode.error('CREATE_CONTENTION_INDEX', e); }
      return MongoCode.error('CREATE_ERROR', e);
    }
  };
  async update<T>(type: Class<T> | string, _gid: string, updater: any): Promise<Result<boolean>> {
    try {
      if (!_gid) { return MongoCode.error('UPDATE_NO_GID'); }
      const collection = await this.ensureCollection(type);
      const parsed = parseGlobalId(_gid);
      const result = await collection.updateOne({ _id: new MongoDB.ObjectId(parsed.localId) }, this.getUpdateRubric(updater));
      return ok(result.modifiedCount ? true: false);
    } catch (e) {
      if (Upstream.showOperationErrors) { console.error(e); }
      return errorResult(e);
    }
  };
  async delete<T>(type: Class<T> | string, id:string): Promise<Result<boolean>> {
    return ok(false);
  };
  async find<T, Indexer>(type: Class<T> | string, matcher: any, limit = 0, indexName?: string): Promise<Result<T[]>> {
    try {
      const collection = await this.ensureCollection(type);
      const parsedMatcher = this.getMatcherRubric(matcher);
      let result = indexName ? collection.find(parsedMatcher).hint(indexName) : collection.find(parsedMatcher);
      if (limit) { result = result.limit(limit); }
      const resultArray = await result.toArray();
      return ok(resultArray as unknown as T[]);
    } catch (e) {
      if (Upstream.showOperationErrors) { console.error(e); }
      return errorResult(e);
    }
  };
  async list<T>(type: Class<T> | string, filter: UpstreamDataFilter): Promise<Result<T[]>> {
    try {
      const collection = await this.ensureCollection(type);
      // if (filter.type === FilterType.RECENT
    } catch (e) {
      if (Upstream.showOperationErrors) { console.error(e); }
      return errorResult(e);
    }
  };
  admin: UpstreamAdminOperations = {
    dropCollection: async <T>(type: Class<T> | string): Promise<Result<boolean>> => {
      try {
        const typename = typeof type === 'string' ? type : typeFullName(type);
        const collection = await this.ensureCollection(type, true);
        const collections = await this.dbconn.listCollections().toArray();
        const hasCollection = collections.filter(c => c.name === typename).length > 0;
        if (hasCollection) {
          await collection.drop();
          if (this.knownCollections[typename]) { delete this.knownCollections[typename]; }
          return ok(true);
        }
        return ok(false);
      } catch (e) {
        if (Upstream.showOperationErrors) { console.error(e); }
        return ok(false);
      }
    }
  };
  index: UpstreamDataIndexes = {
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
        const collection = await this.ensureCollection(type, true);
        if (!indexDefinition.columns) { return ok(false); }
        const columnsCopy = deepCopy(indexDefinition.columns);
        const partialFilterExpression = {};
        for (const columnName of Object.keys(columnsCopy)) {
          partialFilterExpression[columnName] = { $type: 'string' };
          if (columnsCopy[columnName]) { // normalized index sort order
            columnsCopy[columnName] = 1;
          } else {
            columnsCopy[columnName] = -1;
          }
        }
        const indexOptions: any = { name: indexDefinition.name };
        let indexOptionsArg = indexDefinition.options ? indexDefinition.options : {};
        indexOptionsArg = deepCopy(indexOptionsArg);
        if (indexOptionsArg.unique) {
          indexOptions.unique = true;
          // indexOptions.sparse = true;
          indexOptions.partialFilterExpression = partialFilterExpression;
        }
        Object.assign(indexOptions, indexOptionsArg);
        await collection.createIndex(columnsCopy, indexOptions);
        return ok(true);
      } catch (e) {
        if (e.code === 11000) { return MongoCode.error('INDEX_CREATE_CONTENTION', e); }
        return MongoCode.error('INDEX_CREATE_ERROR', e);
      }
    },
    delete: async<T>(type: Class<T> | string, indexDefinition: CollectionIndex<T>): Promise<Result<boolean>> => {
      return ok(true);
    },
    list: async <T>(type: Class<T> | string): Promise<Result<UpstreamDataIndexDefinition[]>> => {
      try {
        const collection = await this.ensureCollection(type, true);
        return ok(await collection.indexes() as UpstreamDataIndexDefinition[]);
      } catch (e) {
        if (Upstream.showOperationErrors) { console.error(e); }
        return errorResult(e);
      }
    },
    ensure: async <T>(type: Class<T> | string, indexDefinitions?: CollectionIndexes<T>, forceRecheck?: boolean): Promise<Result<boolean>> => {
      if (this.indexEnsuringPromise) { return this.indexEnsuringPromise; }
      const prom = this.indexEnsuringPromise = promise(async resolve => {
        try {
          if (!this.dbconn) { await this.dbConnAwaiter; }
          const typename = typeof type === 'string' ? type : typeFullName(type);
          const collection = await this.ensureCollection(typename, true);
          let collectionInfo = this.knownCollections[typename];
          if (!collectionInfo) { collectionInfo = this.knownCollections[typename] = {}; }
          if (indexDefinitions) { collectionInfo.indexDefinitions = indexDefinitions; forceRecheck = true; }
          if (!forceRecheck && collectionInfo.timeIndexUpdated) { return resolve(ok(true)); }
          if (!indexDefinitions) { indexDefinitions = collectionInfo.indexDefinitions; }
          if (!indexDefinitions || Object.keys(indexDefinitions).length === 0) {
            collectionInfo.timeIndexUpdated = Date.now();
            return resolve(ok(true));
          }
          const proms = [];
          for (const indexName of Object.keys(indexDefinitions)) {
            if (await collection.indexExists(indexName)) { continue; }
            const indexInfo = indexDefinitions[indexName];
            proms.push(this.index.create(type, indexInfo));
          }
          await PromUtil.allSettled(proms);
          collectionInfo.timeIndexUpdated = Date.now();
          return resolve(ok(true));
        } catch (e) {
          if (Upstream.showOperationErrors) { console.error(e); }
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
  private getUpdateRubric(updater: any) {
    const updateRubric: any = {};
    updateRubric.$set = {};
    updateRubric.$inc = {};
    if (updater.set) {
      for (const path of Object.keys(updater.set)) {
        updateRubric.$set[path] = updater.set[path];
      }
    }
    if (updater.add) {
      for (const path of Object.keys(updater.add)) {
        updateRubric.$inc[path] = updater.add[path];
      }
    }
    if (!updateRubric.$set._gid) {
      updateRubric.$set._ut = Date.now();
      updateRubric.$inc._v = 1;
    }
    return updateRubric;
  }
  getMatcherRubric(matcher: any) {
    return matcher;
  }
  private async connectToMongo(cred: MongoDbCredentialType) {
    try {
      const userPass = cred.username && cred.password ? `${encodeURIComponent(cred.username)}:${encodeURIComponent(cred.password)}@` : '';
      const hasPort = cred.endpoint.indexOf(':') >= 0;
      const mongoUrl = hasPort ? `mongodb://${userPass}${cred.endpoint}` : `mongodb+srv://${userPass}${cred.endpoint}`;
      const client = new MongoDB.MongoClient(mongoUrl);
      await client.connect();
      const db = client.db(cred.dbname ? cred.dbname : defaultUpstreamDatabaseName);
      return ok({ client, db });
    } catch (e) {
      return MongoCode.error('CONNECTION_ERROR', e);
    }
  }
  private async initialize() {
    const connectResult = await this.connectToMongo(this.config.endpoint.credentials);
    if (connectResult.bad) { return passthru(connectResult); }
    this.client = connectResult.data.client;
    this.dbconn = connectResult.data.db;
    await this.ensureEndpointMeta(this.dbconn);
    this.dbConnResolver();
  }
  private async ensureEndpointMeta(db: MongoDB.Db): Promise<Result<boolean>> {
    const list = await db.listCollections().toArray();
    let metadataTableAccounted = false;
    let txTableAccounted = false;
    for (const tableInfo of list) {
      if (tableInfo.name.startsWith('__')) {
        if (tableInfo.name === defaultUpstreamMetadataTable) { metadataTableAccounted = true; }
        if (tableInfo.name === defaultUpstreamTxDataTable) { txTableAccounted = true; }
        continue;
      }
      if (!this.knownCollections[tableInfo.name]) {
        this.knownCollections[tableInfo.name] = { collection: this.dbconn.collection(tableInfo.name) };
      }
    }
    if (!metadataTableAccounted) {
      try {
        const collection = await this.dbconn.createCollection(defaultUpstreamMetadataTable);
        const indexes = await collection.listIndexes();
        if ((await indexes.toArray()).filter(item => item.name === 'last_insert_ids').length === 0) {
          await this.index.create(defaultUpstreamMetadataTable as any,
                                  { name: 'last_insert_ids', options: { unique: 1 }, columns: { type_name: 1 } });  
        }
      } catch (e) { if (e.codeName !== 'NamespaceExists') { console.error(e); } } 
    }
    if (!txTableAccounted) {
      try {
        const collection = await this.dbconn.createCollection(defaultUpstreamTxDataTable);
        const indexes = await collection.listIndexes();
        if ((await indexes.toArray()).filter(item => item.name === 'tx_flow').length === 0) {
          await this.index.create(defaultUpstreamTxDataTable as any,
                                  { name: 'tx_flow', options: {}, columns: { tx_id: 1 } });
        }
      } catch (e) { if (e.codeName !== 'NamespaceExists') { console.error(e); } }
    }
    return ok(true);
  }
  async ensureCollection<T = any>(type: Class<T> | string, skipIndexCheck = false): Promise<MongoDB.Collection> {
    if (!this.dbconn) { await this.dbConnAwaiter; }
    const typename = typeof type === 'string' ? type : typeFullName(type);
    let collectionInfo = this.knownCollections[typename];
    if (!collectionInfo) { collectionInfo = this.knownCollections[typename] = {}; }
    if (!skipIndexCheck && collectionInfo.indexDefinitions && !collectionInfo.timeIndexUpdated) {
      await this.index.ensure(type);
    }
    if (collectionInfo.collection) { return collectionInfo.collection; }
    try {
      collectionInfo.collection = await this.dbconn.createCollection(typename); 
    } catch (e) {
      collectionInfo.collection = this.dbconn.collection(typename);
    }
    return collectionInfo.collection;
  }
}
