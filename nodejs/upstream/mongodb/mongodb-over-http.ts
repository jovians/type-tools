/**
 * Jovian © 2020
 * License: MIT
 */
import { UpstreamDatastoreMongo } from './mongodb';
import { promise, toBe } from '../../../src/common/globals.ix';
import { HttpServerShim, HTTP, HttpBaseLib, HttpOp, ReqProcessor, HttpOpType } from '../../http/http.shim';
import { APP, envVar, getApplicationProfile  } from '../../../src/common/env/env.profile';
import * as MongoDB from 'mongodb';
import { SecureChannelTypes } from '../../../src/common/security/security.common';

// UPSTREAM_MONGO_HTTP_SERVER_APP_PROFILE
// UPSTREAM_MONGO_HTTP_SERVER_LOCAL_MONGODB_ENDPOINT
// UPSTREAM_MONGO_HTTP_SERVER_KEY

const scopeName = `mongo-over-http-server;pid=${process.pid}`;

const roles = {
  ADMIN: 99,
  NO_AUTH: 0,
};

export class UpstreamDatastoreMongoOverHttp extends HttpServerShim<typeof roles> {
  static defaultPort = 28000;

  ds: UpstreamDatastoreMongo;
  mongoDbLocalEndpoint: string;

  constructor() {
    const appProfile = envVar('UPSTREAM_MONGO_HTTP_SERVER_APP_PROFILE', APP.PROFILE);
    const mongoDbLocalEndpoint = envVar('UPSTREAM_MONGO_HTTP_SERVER_LOCAL_MONGODB_ENDPOINT', 'localhost:27017');
    const serverKey = envVar('UPSTREAM_MONGO_HTTP_SERVER_KEY', '');
    super({
      name: `mongodb-over-http-${serverKey}`,
      env: appProfile,
      type: HttpBaseLib.EXPRESS,
      scopeName,
      security: {
        accessor: { required: false, baseToken: `<secret.${serverKey}.token>`, },
        secureChannel: { enabled: true, required: false, encryption: SecureChannelTypes.ECC_4Q, signingKey: `<secret.${serverKey}.signingKey>` },
      },
      startOptions: { port: toBe`<secret.${serverKey}.port ?: number:${UpstreamDatastoreMongoOverHttp.defaultPort}>` },
    });
    this.mongoDbLocalEndpoint = mongoDbLocalEndpoint;
    if (!serverKey) {
      throw new Error(`serverKey (UPSTREAM_MONGO_HTTP_SERVER_KEY) cannot be null`);
    }
    this.apiVersion = 'v1';
    this.apiPath = this.configGlobal.api.basePath;
    this.addDefaultProcessor(ReqProcessor.BASIC);
    this.initialize();
  }
  
  initialize() {
    this.ds = new UpstreamDatastoreMongo({
      path: 'local',
      endpoint: {
        type: 'mongo',
        endpoint: 'localhost',
        credentials: { endpoint: this.mongoDbLocalEndpoint }
      },
    });
  }

  @HTTP.GET(`/read`)
  async upstreamRead(op: HttpOp) {
    const { typename, _gid } = op.params;
    const res = await this.ds.read(typename, _gid);
    return res.bad ? op.raise(res): op.returnJson(res.data);
  }

  @HTTP.POST(`/create`)
  async upstreamCreate(op: HttpOp) {
    const { typename, target, typeVersion } = op.params;
    (target as any)._id = new MongoDB.ObjectId();
    const res = await this.ds.create(typename, target, typeVersion);
    return res.bad ? op.raise(res): op.returnJson(res.data);
  }

  @HTTP.POST(`/update`)
  async upstreamUpdate(op: HttpOp) {
    const { typename, _gid, updater } = op.params;
    const res = await this.ds.update(typename, _gid, updater);
    return res.bad ? op.raise(res): op.returnJson(res.data);
  }

  @HTTP.POST(`/delete`)
  async upstreamDelete(op: HttpOp) {
    const { typename, _gid } = op.params;
    const res = await this.ds.delete(typename, _gid);
    return res.bad ? op.raise(res): op.returnJson(res.data);
  }

  @HTTP.GET(`/find`)
  async upstreamFind(op: HttpOp) {
    const { typename, limit, matcher, indexName } = op.params;
    try {
      const collection = await this.ds.ensureCollection(typename);
      const parsedMatcher = this.ds.getMatcherRubric(matcher);
      let result = indexName ? collection.find(parsedMatcher).hint(indexName) : collection.find(parsedMatcher);
      if (limit) { result = result.limit(limit); }
      const resultArray = (await result.toArray()).map(a => {
        (a._id as any) = a._id.toString();
        return a;
      });
      return op.returnJson(resultArray);
    } catch (e) { return op.raise(e); }
  }

  @HTTP.GET(`/list`)
  async upstreamList(op: HttpOp) {
    // TODO
  }

  @HTTP.POST(`/collection/drop`)
  async upstreamCollectionDrop(op: HttpOp) {
    const { typename } = op.params;
    try {
      const res = await this.ds.admin.dropCollection(typename);
      return op.returnJson(res.data);
    } catch (e) { return op.raise(e); }
  }

  @HTTP.POST(`/index/create`)
  async upstreamIndexCreate(op: HttpOp) {
    const { typename, columns, options } = op.params;
    const collection = await this.ds.ensureCollection(typename);
    try {
      await collection.createIndex(columns, options);
      return op.returnJson(true);
    } catch (e) { return op.raise(e); }
  }

  @HTTP.GET(`/index/list`)
  async upstreamIndexList(op: HttpOp) {
    const { typename } = op.params;
    const collection = await this.ds.ensureCollection(typename);
    try {
      const indexes = await collection.indexes();
      return op.returnJson(indexes);
    } catch (e) { return op.raise(e); }
  }

  @HTTP.POST(`/index/ensure`)
  async upstreamIndexEnsure(op: HttpOp) {
    const { typename, indexDefinitions, forceRecheck } = op.params;
    await this.ds.ensureCollection(typename);
    await this.ds.index.ensure(typename, indexDefinitions, forceRecheck);
    return op.returnJson(true);
  }

}
