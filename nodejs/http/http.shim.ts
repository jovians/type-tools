/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import * as express from 'express';
import { completeConfig } from '../../src/common/util/config.util';
import { proxyParameterFunctionToNull } from '../../src/common/util/convenience/dev.null.proxy';
import { Class, configBoolean } from '../../src/type-transform';
import { AsyncWorkerClient } from '../proc/async.worker.proc';
import { SecureChannel, SecureHandshake } from '../secure-channel/secure-channel';
import { ServerConstDataGlobal } from './http.shim.global.conf';
import { HttpCode, HttpMethod, httpRest } from './http.models';
import { SecureChannelWorkerClient } from './http.shim.worker.security';
import * as defaultConfig from './http.shim.default.config.json';
import * as defaultGlobalConfig from './http.shim.global.conf.json';
import * as axios from 'axios';
import { errorResult, GenericResult, ok, passthru, promise, Promise2, PromUtil, Result, ReturnCodeFamily } from '../../src/common/globals.ix';
import { SecretManager } from '../secret-resoluton/secret-resolver';
import { DestorClient, getDestorClient } from './destor/destor.client';
import * as url from 'url';
import { AccessHeaderObject, SecureChannelPayload, SecureChannelPeer, SecureChannelTypes } from '../../src/common/security/security.common';
import { ProcessExit } from '../proc/process.exit.handler';
import ExpressLib from 'express';

enum HttpShimCodeEnum {
  ACCESSOR_HEADER_NOT_FOUND,
  ACCESSOR_BAD_FORMAT,
  NO_ACCESSOR,
  ENCRYPTED_OP_NO_SECURE_PAYLOAD,
  ENCRYPTED_OP_PATH_NOT_FOUND,
  ENCRYPTED_OP_METHOD_NOT_FOUND,
  ENCRYPTED_OP_NON_JSON_PAYLOAD,
  SECURE_CHANNEL_NOT_FOUND,
  AUTH_HEADER_NOT_FOUND,
  AUTH_HEADER_NOT_VALID,
  AUTH_HEADER_SIGNED_BUT_PUBLIC_KEY_NOT_FOUND,
  AUTH_HEADER_SIGNED_NO_ROLES_MAP,
  AUTH_HEADER_SIGNED_ROLE_UNAUTHORZIED_FOR_API,
  AUTH_HEADER_SIGNED_BUT_API_DENIES_ALL,
}
export const HttpShimCode = ReturnCodeFamily('HttpShimCode', HttpShimCodeEnum);

export enum ReqProcessor {
  AUTH = 'AUTH',
  BASIC = 'BASIC',
  DECRYPT = `DECRYPT`,
  ENCRYPT = `ENCRYPT`,
}

export interface ServerStartOptions {
  port: number;
}

interface HttpParams {
  [paramName: string]: any;
}

type PropType<TObj, TProp extends keyof TObj> = TObj[TProp];
export type ParamDef<T extends {[key: string]: {type: string, default: any, required?: boolean | Class<any>;}}> = {
  [key in keyof T]: PropType<T[key], 'default'>
}
export type HttpOpType<T extends { params: {[key: string]: {type: string, default: any, required?: boolean | Class<any>;}}, returns: {type: string, default: any}}> =
      HttpOp<ParamDef<T['params']>, T['returns']['default']>;

export class HttpApiOptions<Params = HttpParams, Returns = any> {
  rootMount?: configBoolean;
  rootVersionMount?: configBoolean;
  pre?: string[];
  post?: string[];
}

export type HttpApiRoleAccess<RoleBook, Params = HttpParams> = {
  [key in keyof RoleBook]?: configBoolean | Class<any> | {
      [param in keyof Params]?: ValueConstraintRules
  };
}

export type HttpOpParamType = (
  'string' |
  'string-base64' |
  'string-bigint' |
  'number' |
  'boolean' |
  'configBoolean' |
  'array' |
  'object'
);

export class HttpServerShimApi<Params = HttpParams, Returns = any> extends HttpApiOptions<Params, Returns> {
  class: Class<any>;
  className: string;
  server?: HttpServerShim;
  path = '';
  apiPath?: string;
  apiVersion?: string;
  public?: boolean;
  fullpath?: string = '';
  method = HttpMethod.GET;
  handlerName?: string;
  parameters?: { [paramName in keyof Params]: HttpOpParamType };
  preDefaultProcesserAdded?: boolean;
  postDefaultProcesserAdded?: boolean;
  registered?: boolean;
}

export enum HttpBaseLib {
  EXPRESS = 'EXPRESS',
}

export interface HttpShimPublicInfo<RoleBook = any> {
  tokenRequired: boolean;
  accessorRequired: boolean;
  secureChannelScheme: SecureChannelTypes;
  secureChannelPublicKey: string;
  secureChannelStrict: boolean;
  secureChannelRequired: boolean;
  apiPathList: string[];
  apiInterface: {[methodName: string]: HttpApiRoleAccess<RoleBook>};
}

export type ValueConstraint = [
  'is' | 'exactly' | 'pattern' | 'startsWith',
  string | number | boolean
];
export type ValueConstraintRules = (ValueConstraint | 'OR' | 'AND' | '(' | ')')[];

export interface HttpServerShimConfig {
  name?: string;
  env?: string;
  type: HttpBaseLib | string;
  scopeName?: string;
  debug?: {
    showErrorStack?: boolean;
  };
  cache?: {
    defaultCacheParser?: CacheParser;
  };
  security?: {
    noauth?: boolean;
    token?: {
      required?: boolean;
      value: string;
      role: string;
    }
    userToken?: {
      required?: boolean;
      map: {[token: string]: {
        user: string;
        role: string;
      }};
    };
    accessor?: {
      required?: boolean;
      baseToken?: string;
      baseTokenBuffer?: Buffer;
      timeHashed?: boolean;
      timeWindow?: number;
      role?: string;
    };
    secureChannel?: {
      required?: boolean;
      enabled?: boolean;
      strict?: boolean;
      encryption?: SecureChannelTypes;
      publicKey?: string;
      signingKey?: string;
    };
  };
  workers?: {
    secureChannelWorkers?: {
      initialCount?: number;
    }
  };
  startOptions?: ServerStartOptions;
  skipConfigSecretResolution?: boolean;
  skipAuthServerResolution?: boolean;
}

export function isClass(target) {
  return !!target.prototype && !!target.constructor.name;
}

function methodsRegister<Params = any, RoleBook = any>(httpMethods: HttpMethod[], path: string, apiOptions?: HttpApiOptions<RoleBook>) {
  path = path.replace(/\/\//g, '/');
  return (target: HttpServerShim<RoleBook>, propertyKey: string, descriptor: PropertyDescriptor) => {
    for (const httpMethod of httpMethods) {
      const apiKey = `${httpMethod} ${path}`;
      const methodApi: HttpServerShimApi<Params> = {
        class: target.constructor as any,
        className: target.constructor.name,
        method: httpMethod, path, handlerName: propertyKey
      };
      if (apiOptions) { Object.assign(methodApi, apiOptions); }
      if (!target.apiMap) { target.apiMap = {}; }
      target.apiMap[apiKey] = methodApi;
      if (!target.apiRegistrations) { target.apiRegistrations = []; }
      target.addRegistration(methodApi);
    }
  };
}

type Tail<T extends any[]> = 
  ((...t: T)=>void) extends ((h: any, ...r: infer R)=>void) ? R : never;
type Last<T extends any[]> = T[Exclude<keyof T, keyof Tail<T>>];
type HttpMethodRegistration = <Params = HttpParams>(path: string, apiOptions?: HttpApiOptions<Params, any>) => 
                              (target: HttpServerShim<any>, propertyKey: string, descriptor: PropertyDescriptor) => void;
type HttpMethodsRegistration = <Params = HttpParams>(methods: HttpMethod[], path: string, apiOptions?: HttpApiOptions<Params, any>) => 
                              (target: HttpServerShim<any>, propertyKey: string, descriptor: PropertyDescriptor) => void;
/**
 * HTTP api registration decorator
 */

export class HTTP {
  static GET = (<Params = HttpParams>(path: string, apiOptions?: HttpApiOptions<Params>) => {
    return methodsRegister([HttpMethod.GET], path, apiOptions);
  }) as (HttpMethodRegistration & Class<any>);
  static POST = (<Params = HttpParams>(path: string, apiOptions?: HttpApiOptions<Params>) => {
    return methodsRegister([HttpMethod.POST], path, apiOptions);
  }) as (HttpMethodRegistration & Class<any>);
  static PATCH = (<Params = HttpParams>(path: string, apiOptions?: HttpApiOptions<Params>) => {
    return methodsRegister([HttpMethod.PATCH], path, apiOptions);
  }) as (HttpMethodRegistration & Class<any>);
  static DELETE = (<Params = HttpParams>(path: string, apiOptions?: HttpApiOptions<Params>) => {
    return methodsRegister([HttpMethod.DELETE], path, apiOptions);
  }) as (HttpMethodRegistration & Class<any>);
  static METHODS = (<Params = HttpParams>(methods: HttpMethod[], path: string, apiOptions?: HttpApiOptions<Params>) => {
    return methodsRegister(methods, path, apiOptions);
  }) as (HttpMethodsRegistration & Class<any>);
  static ACCESS = <RoleBook extends {[roleName: string]: any} = any>(access: HttpApiRoleAccess<RoleBook> | 'allow-all' | 'deny-all') => {
    return (target: HttpServerShim<RoleBook>, propertyKey: string, descriptor: PropertyDescriptor) => { 
      if (typeof access === 'string') {
        const strAccess = access;
        access = {};
        Object.defineProperty(access, strAccess, { value: true });
      }
      Object.defineProperty(access, 'class', { value: target.constructor});
      target.addAccessRule(propertyKey as any, access as HttpApiRoleAccess<RoleBook, HttpParams>);
    };
  };
  static ACL = this.ACCESS;
  static SHIM = {
    ROOT_API_PROXY_REQUEST: '/proxy-request',
    ROOT_API_PUBLIC_INFO: '/public-info',
    ROOT_API_NEW_CHANNEL: '/secure-channel',
    ROOT_API_SECURE_API: '/secure-api',
  };
  static STATUS = HttpCode;
};

export class HttpServerShim<RoleRubric = any> {
  config: HttpServerShimConfig;
  configGlobal: ServerConstDataGlobal;
  configResolutionPromise: Promise<any>;
  publicInfo: any = {};
  publicInfoString: string = '';
  baseApp: any;
  authServers: {[url: string]: { type: 'jwt' | '4q_stamp'; publicKey: string; token?: string}} = {};
  apiPath: string = 'api';
  apiVersion: string = 'v1';
  apiRegistrations: HttpServerShimApi[];
  apiAccess: {[methodName: string]: HttpApiRoleAccess<RoleRubric>};
  apiMap: {[key: string]: HttpServerShimApi; };
  apiPathList: string[] = [];
  apiPathIface: {[mathodAndPath: string]: {
    method: string;
    path: string;
    handlerName: string;
    description: string;
    params: HttpParams;
    returns: any;
    acl: HttpApiRoleAccess<RoleRubric, HttpParams>
  }} = {};
  rolebook: RoleRubric | {[roleName: string]: any};
  destor: DestorClient;
  destorPromise: Promise2<DestorClient>;
  pathTree: {[key: string]: any; } = {};
  preHandler: PreHandler;
  postHandler: PostHandler;
  defaultProcessors: ReqProcessor[] = [];
  proxyRequest = {
    enabled: false,
    requestCheckers: [],
  } as {
    enabled: boolean,
    requestCheckers?: ((params: {[paramName: string]: any}) => Promise2<{ allowed: boolean, message?: string}>)[]
  };
  secureChannels: {[channelId: string]: SecureChannel} = {};
  workerFleet: { [workerFleetClassName: string]: { workers: AsyncWorkerClient[]; } } = {};
  cacheData: {[key: string]: CacheEntry} = {};
  extData: any;
  state = {
    activePort: 0,
    closed: false,
    started: false,
    apiRegistered: false,
    apiRegisterStack: null,
    closingPromise: null as Promise<any>,
  };
  baseLibData = {
    express: {
      server: null,
    },
  };

  constructor(config: HttpServerShimConfig, globalConf?: ServerConstDataGlobal, beforeSuper?: () => any) {
    if (beforeSuper) { beforeSuper(); }
    this.configGlobal = completeConfig(globalConf ? globalConf : {}, defaultGlobalConfig);
    this.config = this.normalizeServerConfig(config);
    this.preHandler = new PreHandler();
    this.postHandler = new PostHandler();
    this.configResolutionPromise = this.configResolution();
    this.setBaseLayer();
    if (!this.config.name) { this.config.name = 'unnamed-server'; }
    if (!this.config.env) { this.config.env = 'test'; }
    ProcessExit.addHandler(e => {
      this.close();
    });
  }

  async configResolution() {
    if (!this.config.skipConfigSecretResolution) {
      const destor = await this.getDestorClient();
      this.config = await SecretManager.resolve(this.config, destor);
      if (!this.config.skipAuthServerResolution) {
        this.authServers = await SecretManager.resolve('<config.authServers>', destor) as any as typeof this.authServers;
      }
    }
    if (this.config.security.secureChannel.enabled && this.config.security.secureChannel.signingKey) {
      const channelKey = this.config.security.secureChannel.signingKey;
      if (!this.config.security.secureChannel.publicKey && channelKey && !channelKey.startsWith('<')) {
        this.config.security.secureChannel.publicKey = SecureHandshake.getPublicKeyFrom(channelKey);
      }
      for (let i = 0; i < this.config.workers.secureChannelWorkers.initialCount; ++i) {
        this.addWorker(SecureChannelWorkerClient, {
          workerId: i, scopeName: this.config.scopeName, signingKey: channelKey,
        });
      }
    }
    this.configResolutionPromise = null;
    this.afterConfigResolution();
  }

  registerApis() {
    if (this.state.apiRegistered) {
      throw new Error(`Cannot register apis twice; already registered from ${this.state.apiRegisterStack}`);
    }
    this.state.apiRegistered = true;
    this.state.apiRegisterStack = new Error().stack;
    for (const api of this.apiRegistrations) {
      if (this instanceof api.class){
        this.register(api);
      }
    }
  }

  normalizeServerConfig(config: HttpServerShimConfig) {
    if (!config.scopeName) { config.scopeName = `httpshim;pid=${process.pid}`; }
    const newConfig = completeConfig<HttpServerShimConfig>(config, defaultConfig as any);
    newConfig.debug.showErrorStack = true;
    return newConfig;
  }

  addDefaultProcessor(...processors: ReqProcessor[]) {
    if (this.state.apiRegistered) {
      throw new Error(`addDefaultProcessor must be called before api registration`);
    }
    for (const proc of processors) {
      this.defaultProcessors.push(proc);
    }
  }

  cacheDefine<T = any>(init?: Partial<CacheDef<T>>) {
    if (this.cacheData[init.path]) {
      throw new Error(`Cache path '${init.path}' is already defined.`);
    }
    const def = new CacheDef<T>(init);
    this.cacheData[def.path] = new CacheEntry<T>({
      value: null,
      hits: 0,
      version: 0,
      def,
    });
    return def;
  }

  addWorker<T extends AsyncWorkerClient>(workerClass: Class<T>, workerData?: {[key: string]: any; }) {
    if (!workerData) { workerData = {}; }
    if (!this.workerFleet[workerClass.name]) {
      this.workerFleet[workerClass.name] = { workers: [] };
    }
    const workersReg = this.workerFleet[workerClass.name];
    const worker = new workerClass(workerData);
    workersReg.workers.push(worker);
    return worker;
  }

  pickWorker<T extends AsyncWorkerClient>(workerClass: Class<T>): T {
    if (!this.workerFleet[workerClass.name]) {
      return proxyParameterFunctionToNull;
    }
    const workers = this.workerFleet[workerClass.name].workers;
    if (workers.length === 0) {
      return proxyParameterFunctionToNull;
    }
    return this.workerFleet[workerClass.name].workers[0] as T;
  }

  setBaseLayer() {
    switch (this.config.type) {
      case HttpBaseLib.EXPRESS:
        this.baseApp = (express.default as any)();
        const secOptions = this.configGlobal.http.securityHeaders;
        if (secOptions.profile === 'allow-all') {
          this.baseApp.use((req, res, next) => {
            if (secOptions.allowRequestOrigin) {
              res.header('Access-Control-Allow-Origin', secOptions.allowRequestOrigin);
            }
            if (secOptions.allowRequestHeaders) {
              res.header('Access-Control-Allow-Headers', secOptions.allowRequestOrigin);
            }
            if (req.method === 'OPTIONS') {
              res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
              return res.end();
            }
            next();
          });
        }
        break;
    }
  }

  setFinalLayer() {
    switch (this.config.type) {
      case HttpBaseLib.EXPRESS:
        // TODO
        break;
    }
  }

  async getDestorClient() {
    if (this.destor) { return this.destor; }
    if (this.destorPromise) { return await this.destorPromise; }
    this.destorPromise = getDestorClient();
    this.destor = await this.destorPromise;
  }

  @HTTP.GET('/test-roles-api', { rootMount: true })
  @HTTP.ACCESS({ ADMIN: true, NO_AUTH: true })
  async getRoles(op: HttpOp<{}>) {
    return op.res.returnJsonPreserialized('');
  }

  @HTTP.GET(HTTP.SHIM.ROOT_API_PUBLIC_INFO, { rootMount: true })
  async getServerPublicInfo(op: HttpOp<{}>) {
    return op.res.returnJsonPreserialized(this.publicInfoString);
  }

  @HTTP.GET(HTTP.SHIM.ROOT_API_NEW_CHANNEL, { rootMount: true })
  async newSecureChannel(op: HttpOp) {
    const accessInfoResult = this.checkAccessor(op, true);
    if (accessInfoResult.bad) { return op.raise(accessInfoResult, HTTP.STATUS.BAD_REQUEST); }
    const accessInfo = accessInfoResult.data;
    const peerInfo: SecureChannelPeer = {
      ecdhPublicKey: Buffer.from(accessInfo.channelPublicKey, 'base64'),
      iden: null, data: null,
    };
    const channel = await this.pickWorker(SecureChannelWorkerClient).newChannel(peerInfo);
    channel.signing = {
      type: '4Q',
      public: this.config.security.secureChannel.publicKey,
      private: this.config.security.secureChannel.signingKey,
    };
    this.secureChannels[channel.peerInfo.ecdhPublicKey.toString('base64')] = channel;
    const secureChannelResponseResult = channel.getSecureChannelResponse();
    if (secureChannelResponseResult.bad) { return op.raise(secureChannelResponseResult, HTTP.STATUS.UNAUTHORIZED); }
    return op.res.returnJson(secureChannelResponseResult.data);
  }

  @HTTP.METHODS(httpRest, HTTP.SHIM.ROOT_API_SECURE_API, { rootMount: true })
  async encryptedOperation(op: HttpOp<{}>, skipRunning = false) {
    const api = op.req.decryptedApiTarget;
    if (!skipRunning) { await this[api.handlerName](op); }
    // await api.handler(op);
  }

  @HTTP.GET(HTTP.SHIM.ROOT_API_PROXY_REQUEST, { rootMount: true })
  async proxyRequestOperation(op: HttpOp) {
    if (this.proxyRequest.enabled) {
      return op.res.returnNotOk(500, `Proxy request not enabled`);
    }
    if (this.proxyRequest.requestCheckers?.length) {
      for (const checker of this.proxyRequest.requestCheckers) {
        const { allowed, message } = await checker(op.req.params);
        if (!allowed) {
          return op.res.returnNotOk(500, `Proxy request not allowed: ${message}`);
        }
      }
    }
    const paramsCopy = JSON.parse(JSON.stringify(op.req.params));
    const url = paramsCopy.__url;
    const method: HttpMethod = paramsCopy.__method ? paramsCopy.__method : HttpMethod.GET;
    const timeout = paramsCopy.__timeout ? paramsCopy.__timeout : 7000;
    const headers = paramsCopy.__headers ? paramsCopy.__headers : '';
    if (paramsCopy.__url) { delete paramsCopy.__url; }
    if (paramsCopy.__method) { delete paramsCopy.__method; }
    if (paramsCopy.__headers) { delete paramsCopy.__headers; }
    if (paramsCopy.__timeout) { delete paramsCopy.__timeout; }
    if (paramsCopy.__enc) { delete paramsCopy.__enc; }
    const newHeaders: {[headerName: string]: string} = {};
    for (const headerName of headers.split(',')) {
      const headerValue = op.req.getHeader(headerName);
      if (headerValue) { newHeaders[headerName] = headerValue; }
    }
    const reqOpts = { timeout, headers: newHeaders, params: paramsCopy, };
    let proxyRequestFunction: <T = any, R = axios.AxiosResponse<T>>(url: string, config?: axios.AxiosRequestConfig) => Promise<R>;
    switch (method) {
      case 'GET': { proxyRequestFunction = axios.default.get; break; }
      case 'PUT': { proxyRequestFunction = axios.default.put; break; }
      case 'POST': { proxyRequestFunction = axios.default.post; break; }
      case 'PATCH': { proxyRequestFunction = axios.default.patch; break; }
      case 'DELETE': { proxyRequestFunction = axios.default.delete; break; }
    }
    op.waitFor(resolve => {
      proxyRequestFunction.apply(axios.default, [url, reqOpts]).then(res => {
        if (typeof res.data === 'string') {
          op.res.returnJson({ message: res.data });
        } else {
          op.res.returnJson(res.data);
        }
        resolve();
      }).catch(e => {
        const res = e.response;
        if (res) {
          op.res.returnNotOk(res.status, `Proxy request failed: ${res.data}`);
        } else {
          op.res.returnNotOk(500, `Proxy request failed: ${e.message}`);
        }
        resolve();
      });
    });
  }

  addAccessRule(memberMethodName: keyof typeof this, access: HttpApiRoleAccess<RoleRubric>) {
    if (!this.apiAccess) { this.apiAccess = { }; }
    const memberMethodName2 = memberMethodName as string;
    if (!this[memberMethodName2]) { throw new Error(`Cannot defined roles for non-existing class method '${memberMethodName2}'`); }
    this.apiAccess[memberMethodName2 as any] = access;
  }

  addRegistration(api: HttpServerShimApi) {
    if (!this.apiRegistrations) { this.apiRegistrations = []; }
    this.apiRegistrations.push(api);
  }

  register(api: HttpServerShimApi) {
    const apiVersion = api.apiVersion ? api.apiVersion : this.apiVersion;
    const apiPath = api.apiPath ? api.apiPath : this.apiPath;
    const finalMountPath = api.rootMount ? '' : `/${apiPath}/${apiVersion}`;
    const fullpath = `${finalMountPath}/${api.path}`.replace(/\/\//g, '/');
    api.fullpath = fullpath;
    this.pathResolve(fullpath, api);
    const apiKey = `${api.method} ${api.fullpath}`;
    this.apiPathList.push(apiKey);
    const iface = this[api.handlerName + '_iface'];
    if (iface) {
      iface.consumed = 1;
      this.apiPathIface[apiKey] = {
        method: api.method,
        path: api.path,
        handlerName: api.handlerName,
        description: iface.description ? iface.description : '',
        params: Object.keys(iface.params).map(paramName => {
          const paramInfo = iface.params[paramName];
          return {
            required: paramInfo.required ? true : false, type: paramInfo.type  
          };
        }),
        returns: iface.returns.type,
        acl: null,
      };
      setImmediate(() => {
        this.apiPathIface[apiKey].acl = this.apiAccess[api.handlerName] ? this.apiAccess[api.handlerName] : null;
      });
    }
    if (!api.pre) { api.pre = []; }
    if (!api.preDefaultProcesserAdded) {
      api.pre = [...this.defaultProcessors, ...api.pre];
      api.pre = api.pre.filter((a, i) => api.pre.indexOf(a) === i);
      api.preDefaultProcesserAdded = true;
    }
    switch (this.config.type) {
      case HttpBaseLib.EXPRESS:
        switch (api.method) {
          case HttpMethod.GET: return this.baseApp.get(fullpath, expressHandler(this, api));
          case HttpMethod.POST: return this.baseApp.post(fullpath, expressHandler(this, api));
          case HttpMethod.PUT: return this.baseApp.put(fullpath, expressHandler(this, api));
          case HttpMethod.PATCH: return this.baseApp.patch(fullpath, expressHandler(this, api));
          case HttpMethod.DELETE: return this.baseApp.delete(fullpath, expressHandler(this, api));
        }
        break;
    }
    console.error(`unmatched api`, api);
  }

  beforeStart() {}
  afterStart() {}
  afterConfigResolution() {}
  beforeStop() {}
  afterStop() {}

  addPublicInfo(info: {[infoKey: string]: any}) {
    Object.assign(this.publicInfo, info);
  }

  start(options?: ServerStartOptions) {
    return promise(async (resolve, reject) => {
      if (this.state.started) { return resolve(); }
      this.state.started = true;
      if (this.configResolutionPromise) { await this.configResolutionPromise; }
      if (!options) { options = this.config.startOptions; }
      if (!options) { return reject(new Error(`Cannot start server without start options.`)); }
      this.addPublicInfo({
        tokenRequired: this.config.security.token.required,
        accessorRequired: this.config.security.accessor.required,
        secureChannelScheme: this.config.security.secureChannel.encryption,
        secureChannelPublicKey: this.config.security.secureChannel.publicKey,
        secureChannelStrict: this.config.security.secureChannel.strict,
        secureChannelRequired: this.config.security.secureChannel.required,
        apiPathList: this.apiPathList,
        apiInterface: this.apiPathIface
      } as HttpShimPublicInfo<RoleRubric>);
      this.apiRegistrations = this.apiRegistrations.filter(api => this instanceof api.class);
      const newAccess = {};
      Object.keys(this.apiAccess).forEach(handlerName => {
        if (this instanceof this.apiAccess[handlerName]['class']) {
          newAccess[handlerName] = this.apiAccess[handlerName];
        }
      })
      this.apiAccess = newAccess;
      this.registerApis();
      this.publicInfoString = JSON.stringify(this.publicInfo, null, 4);
      switch (this.config.type) {
        case HttpBaseLib.EXPRESS:
          try { this.beforeStart(); } catch (e) { console.error(e); }
          try {
            const app = this.baseApp as ExpressLib.Express;
            this.baseLibData.express.server = app.listen(options.port, () => {
              this.state.activePort = options.port;
              resolve();
              try { this.afterStart(); } catch (e) { console.error(e); }
            });
          } catch (e) {
            return reject(e);
          }
          break;
      }
    });
  }

  close() {
    if (this.state.closingPromise) { return this.state.closingPromise; }
    this.state.closed = true;
    switch (this.config.type) {
      case HttpBaseLib.EXPRESS:
        this.state.closingPromise = promise(async resolve => {
          const proms: Promise<any>[] = [];
          try { this.beforeStop(); } catch (e) { console.error(e); }
          try { this.baseLibData.express.server.close(); } catch (e) { console.error(e); }
          try { proms.push(this.destroyAllWorkers()); } catch (e) { console.error(e); }
          try { this.afterStop(); } catch (e) { console.error(e); }
          await PromUtil.allSettled(proms);
          resolve();
        });
        break;
    }
    return this.state.closingPromise;
  }

  async stamp(payload?: string | Buffer, encoding: BufferEncoding = 'ascii') {
    if (!payload) { payload = SecureHandshake.timeAuth(); }
    let payloadB64: string;
    if (typeof payload === 'string') {
      payloadB64 = Buffer.from(payload, encoding).toString('base64');
    } else {
      payloadB64 = payload.toString('base64');
    }
    const sig = await this.pickWorker(SecureChannelWorkerClient).signMessage(payloadB64);
    return { payload: payloadB64, sig };
  }

  prepareEncryptedOperation(op: HttpOp): Result<HttpServerShimApi> {
    if (op.req.decryptedApiTarget) {
      return ok(op.req.decryptedApiTarget);
    }
    const decryptResult = this.getDecryptedPayload(op);
    if (decryptResult.bad) { return op.raise(decryptResult, HTTP.STATUS.UNAUTHORIZED); }
    if (!op.req.decryptedPayloadObject) {
      return op.raise(HttpCode.BAD_REQUEST, `ENCRYPTED_OP_NON_JSON_PAYLOAD`, `Supplied secure payload is not JSON format`);
    }
    const args = op.req.decryptedPayloadObject as { id: string; path: string; body: any; headers?: {[name:string]: string} };
    const resolved = this.pathResolve(args.path);
    if (!resolved) {
      return op.raise(HttpCode.NOT_FOUND, `ENCRYPTED_OP_PATH_NOT_FOUND`, `Encrypted access to unknown path: '${args.path}'`);
    }
    const api = resolved.methods[op.method];
    if (!api) {
      return op.raise(HttpCode.NOT_FOUND, `ENCRYPTED_OP_METHOD_NOT_FOUND`, `Method ${op.method} not found for '${api.fullpath}'`);
    }
    if (args.headers) {
      Object.assign(op.req.headers, args);
    }
    op.params = op.req.params;
    const pathQueryParams = url.parse(args.path, true).query;
    if (Object.keys(resolved.params).length > 0) {
      Object.assign(op.req.params, resolved.params);
    }
    if (Object.keys(pathQueryParams).length > 0) {
      Object.assign(op.req.params, pathQueryParams);
    }
    if (args.body) {
      try {
        const data = JSON.parse(args.body);
        op.req.data = data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          Object.assign(op.req.params, data);
        }
      } catch (e) {
        // non JSON body, ignore
      }
    }
    op.req.decryptedApiTarget = api;
    return ok(api);
  }

  checkAccessor<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>, forceVerify = false):
    Result<Partial<AccessHeaderObject> & Partial<{accessor: string, t: number, channelPublicKey?: string}>> {
    const authorizationHeader = op.req.getHeader('Accessor');
    const accessorConf = this.config.security.accessor;
    if (accessorConf.required || forceVerify) {
      if (!authorizationHeader) {
        return op.raise(HttpCode.UNAUTHORIZED, `ACCESSOR_HEADER_NOT_FOUND`, `Accessor header does not exist`);
      }
    } else {
      return ok({ accessor: null, t: 0, channelPublicKey: '' });
    }
    const authInfo = SecureHandshake.parseAuthHeader(authorizationHeader);
    const accessorExpression = authInfo.accessorExpression;
    const timeWindow = this.config.security.accessor.timeWindow;
    if (!accessorConf.baseTokenBuffer) {
      accessorConf.baseTokenBuffer = Buffer.from(accessorConf.baseToken, 'ascii');
    }
    const accessDataResult = SecureHandshake.verifyAccessor(accessorExpression, accessorConf.baseTokenBuffer, timeWindow);
    if (accessDataResult.bad) {
      return op.raise(accessDataResult, HttpCode.UNAUTHORIZED);
    }
    return ok({ ...accessDataResult.data, channelPublicKey: authInfo.peerEcdhPublicKey });
  }

  getSecureChannel<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>) {
    const accessInfoResult = this.checkAccessor(op, true);
    if (accessInfoResult.bad) { return op.raise(accessInfoResult, HTTP.STATUS.BAD_REQUEST); }
    const channelId = accessInfoResult.data.channelPublicKey;
    const channel = this.secureChannels[channelId];
    if (!channel) {
      return op.raise(HttpCode.UNAUTHORIZED, `SECURE_CHANNEL_NOT_FOUND`, `secure channel not found: ${channelId}`);
    }
    op.secureChannel = channel;
    return ok(channel);
  }

  getDecryptedPayload<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>) {
    if (op.req.decryptedPayload) { return ok(op.req.decryptedPayload); }
    const channelResult = this.getSecureChannel(op); if (channelResult.bad) { return op.raise(channelResult, HTTP.STATUS.UNAUTHORIZED); }
    const channel = channelResult.data;
    const payload: SecureChannelPayload = channel.parseWrappedPayloadBase64(op.req.encryptedPayload);
    if (!payload || !payload.__scp) {
      return op.raise(HttpCode.BAD_REQUEST, 'ENCRYPTED_OP_NO_SECURE_PAYLOAD', 'Secure payload not found');
    }
    op.req.decryptedPayload = channel.decryptSecureChannelPayloadIntoString(payload);
    if (isJsonString(op.req.decryptedPayload)) {
      op.req.decryptedPayloadObject = JSON.parse(op.req.decryptedPayload);
    }
    return ok(op.req.decryptedPayload);
  }

  handlePre<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>) {
    return promise(async resolve => {
      let allPassed = true;
      if (op.api.pre?.length > 0) {
        for (const preType of op.api.pre) {
          const preFunc = this.preHandler.byType[preType];
          if (!preFunc) { continue; }
          const passed = await preFunc.apply(this.preHandler, [op]);
          if (!passed) { allPassed = false; break; }
        }
      }
      resolve(allPassed);
    });
  }

  handlePost<Params = HttpParams, Returns = any>(op: HttpOp<Params, Returns>) {
    return promise(async resolve => {
      let allPassed = true;
      if (op.api.post) {
        for (const postType of op.api.post) {
          const postFunc = this.postHandler.byType[postType];
          if (!postFunc) { continue; }
          const passed = await postFunc.apply(this.postHandler, [op]);
          if (!passed) { allPassed = false; break; }
        }
      }
      resolve(allPassed);
    });
  }

  private pathResolve(path: string, newApi: HttpServerShimApi = null): HttpPathResolution {
    const paths = path.split('/');
    if (paths[0] === '') { paths.shift(); }
    const paramCollector = {};
    let node = this.pathTree;
    for (const pathSlot of paths) {
      const slot = decodeURIComponent(pathSlot.split('?')[0].split('#')[0]);
      if (slot === '__apidef__') { return null; }
      const isParam = slot.startsWith(':');
      if (node[slot]) {
        node = node[slot];
        continue;
      }
      const paramDef = node['?param-name?'];
      if (paramDef) {
        if (newApi && isParam && paramDef.slot !== slot) {
          throw new Error(`Cannot register a parameter slot ${slot}, ` +
                          `parameter ${paramDef.slot} has been registered by ${paramDef.registeredPath}`);
        }
        paramCollector[paramDef.name] = slot;
        node = paramDef.nextNode;
        continue;
      }
      if (newApi) {
        const nextNode = {};
        if (isParam) {
          node['?param-name?'] = { nextNode, slot, name: slot.substr(1), registeredPath: path };
        }
        node[slot] = nextNode;
        node = node[slot];
      } else {
        return null;
      }
    }
    if (!node) { return null; }
    if (newApi) {
      if (node.__apidef__ && node.__apidef__.methods[newApi.method]) {
        throw new Error(`Cannot register api at ${newApi.method} ${path}, another api is already registered`);
      }
      if (!node.__apidef__) {
        node.__apidef__ = {
          type: 'api',
          path,
          registeredPath: path,
          methods: {},
          params: {},
        } as HttpPathResolution;
      }
      node.__apidef__.methods[newApi.method] = newApi;
      return node.__apidef__;
    }
    const registeredDef = node.__apidef__ as HttpPathResolution;
    if (!registeredDef) {
      return null;
    }
    return {
      type: 'api',
      path,
      methods: registeredDef.methods,
      registeredPath: registeredDef.registeredPath,
      params: paramCollector,
    } as HttpPathResolution;
  }

  private destroyAllWorkers() {
    const proms: Promise<any>[] = [];
    for (const workerClass of Object.keys(this.workerFleet)) {
      const fleet = this.workerFleet[workerClass];
      for (const worker of fleet.workers) {
        const terminationProm = worker.terminate();
        proms.push(terminationProm);
        ProcessExit.gracefulExitPromises.push(terminationProm);
      }
    }
    this.workerFleet = {};
    return PromUtil.allSettled(proms);
  }

}

export class HttpRequest<Params = HttpParams, Returns = any> {
  op: HttpOp<Params, Returns>;
  res: HttpResponse<Params, Returns>;
  data: any;
  body: string = null;
  bodyRaw: Buffer = null;
  headers: {[headerName: string]: string} = {};
  params: Params;
  encryptedPayload: string;
  decryptedPayload: string;
  decryptedPayloadObject: object | any[];
  decryptedApiTarget: HttpServerShimApi<HttpParams, any>;
  t = Date.now();
  constructor(op: HttpOp<Params, Returns>) {
    this.op = op;
  }
  getHeader(headerName: string): string {
    switch (this.op.server.config.type) {
      case HttpBaseLib.EXPRESS:
        return this.op.oriReq.header(headerName);
      default:
        return null;
    }
  }
}

export class HttpResponse<Params = HttpParams, Returns = any> {
  op: HttpOp<Params, Returns>;
  req: HttpRequest<Params, Returns>;
  headers: {[headerName: string]: string} = {};
  t = -1;
  dt = -1;
  ended = false;
  output = [];
  endingPayload: string | Buffer = '';
  endingPayloadRaw: string | Buffer = '';
  statusCode: number = 200;
  appErrorCode: number | string = 'GENERIC_ERROR';
  returnValue?: Returns;
  private onends: (() => any)[] = [];
  constructor(op: HttpOp<Params, Returns>) {
    this.op = op;
  }
  get onend() { return this.onends; }
  send(payload: string) {
    if (this.ended) { return; }
    this.op.oriRes.send(payload);
    this.output.push(payload);
    return this;
  }
  end(payload: string, returnValue?: Returns) {
    if (this.ended) { return; }
    this.ended = true;
    this.t = Date.now();
    this.dt = this.t - this.req.t;
    for (const onend of this.onends) { try { if (onend) { onend(); } } catch (e) {} }
    this.endingPayload = payload;
    this.output.push(payload);
    if (returnValue !== undefined) { this.returnValue = returnValue; }
    return this;
  }
  status(num: number) {
    this.statusCode = num;
    return this;
  }
  returnCached(code: number, cached: string) {
    this.statusCode = code;
    return this.end(cached);
  }
  returnNotOk(code: number, message: any = '') {
    let statusName = 'unclassified_server_error';
    switch (code) {
      case 400: statusName = 'bad_request'; break;
      case 401: statusName = 'unauthorized'; break;
      case 404: statusName = 'not_found'; break;
      case 500: statusName = 'internal_server_error'; break;
    }
    const resObj: any = {status: statusName, message };
    if (!message && this.op.errors.length > 0) {
      const e = this.op.errors[0].e;
      message = e.message;
      if (this.op.server.config.debug.showErrorStack) { resObj.stackTrace = e.stack; }
    }
    this.statusCode = code;
    return this.end(JSON.stringify(resObj));
  }

  okJsonPreserialized(serial: string) { return `{"status":"ok","result":${serial}}`; }
  okJsonString(obj: any) { return JSON.stringify({ status: 'ok', result: obj }); }
  returnJsonPreserialized(serialized: string, original?: Returns) {
    this.end(`{"status":"ok","result":${serialized}}`);
    return original;
  }
  returnJson(obj: Returns) { 
    this.end(JSON.stringify({ status: 'ok', result: obj }), obj);
    return obj;
  }
}

export class HttpPathResolution {
  type: 'api' | 'resource';
  path: string;
  methods: {[method: string]: HttpServerShimApi};
  registeredPath: string;
  params: {[paramName: string]: string};
}

export interface ErrorObject {
  op: HttpOp;
  t: number;
  e: Error;
  errorMessage: string;
  httpStatusCode: number;
  appErrorCode: number | string;
}

export class HttpOp<Params = HttpParams, Returns = any> {
  method: HttpMethod;
  params: Params;
  req: HttpRequest<Params, Returns>;
  res: HttpResponse<Params, Returns>;
  error: ErrorObject = null;
  errors: ErrorObject[] = [];
  secureChannel: SecureChannel;
  cache: HttpCacheOp<Params, Returns>;
  pendingSequential: Promise<any>[] = [];
  pendingParallel: Promise<any>[] = [];
  user: {
    username: string;
    publicKeys: string[];
    roles: string[];
    rolesApplicable: string[];
  };
  fromInternal: boolean;
  constructor(
    public server: HttpServerShim,
    public api: HttpServerShimApi<Params, Returns>,
    public oriReq: any = null,
    public oriRes: any = null,
  ) {
    this.params = {} as any;
    this.req = new HttpRequest<Params, Returns>(this);
    this.req.params = this.params;
    this.res = new HttpResponse<Params, Returns>(this);
    this.res.req = this.req;
    this.req.res = this.res;
    this.cache = new HttpCacheOp<Params, Returns>(this);
  }
  raise(result: Result, statusCode?: number): Result;
  raise(error: Error, statusCode?: number): Result;
  raise(statusCode: number, errorCode: keyof typeof HttpShimCodeEnum, message?: string): Result;
  raise(...args): Result {
    if (typeof args[0] === 'number') {
      const [ statusCode, errorCode, message ] = args as [number, keyof typeof HttpShimCodeEnum, string];
      if (!this.res.ended) { this.res.returnNotOk(statusCode, message); }
      return HttpShimCode.error(errorCode, message, { statusCode });
    } else {
      if (args[0] instanceof Error) {
        args[0] = errorResult(args[0]);
      }
      let [ result, statusCode ] = args as [ Result, number ];
      if (result.ok) {
        if (!statusCode) { statusCode = result.statusCode ? result.statusCode : 200; }
        if (!this.res.ended) { this.res.status(statusCode).returnJson(result.data); }
      } else {
        if (!statusCode) { statusCode = result.statusCode ? result.statusCode : 500; }
        if (!this.res.ended) { this.res.returnNotOk(statusCode, result.message); }
      }
      return result;
    }
  }
  returnJson(obj: Returns) {
    let status = 'ok';
    let result = obj;
    if (obj && (obj as any).isResultKind) {
      const res = (obj as any as Result);
      if (res.bad) { 
        status = 'error';
        result = res.message as any;
      } else {
        result = res.data;
      }
      if (res.statusCode) { this.res.status(res.statusCode); }
    }
    if (status === 'error') {
      return this.res.end(JSON.stringify({ status, message: result, server: this.server.config.name }), obj);
    } else {
      return this.res.end(JSON.stringify({ status, result, server: this.server.config.name }), obj);
    }
  }
  setResponse(endingPayload?: string | Buffer) {
    if (endingPayload) { this.res.endingPayload = endingPayload; }
  }
  addSequentialProcess(proc: Promise<any>) {
    this.pendingSequential.push(proc);
    return proc;
  }
  waitFor(resolver: (resolve) => void) {
    const proc = new Promise(resolver);
    this.pendingSequential.push(proc);
    return proc;
  }
  async run(fromInternal = false) {
    this.fromInternal = fromInternal;
    const preRes = await this.server.handlePre(this);
    if (preRes) {
      await this.server[this.api.handlerName](this);
      for (const prom of this.pendingSequential) {
        await Promise.resolve(prom);
      }
    }
    await this.server.handlePost(this);
    if (this.secureChannel) {
      this.res.endingPayloadRaw = this.res.endingPayload;
      this.res.endingPayload = JSON.stringify({
        status: 'ok',
        format: 'json',
        encrypted: true,
        payload: this.secureChannel.createWrappedPayload(this.res.endingPayload),
      });
    }
    this.finish();
  }
  private finish(): null {
    switch (this.server.config.type) {
      case HttpBaseLib.EXPRESS:
        this.oriRes.status(this.res.statusCode).end(this.res.endingPayload);
        return null;
      default:
        throw new Error(`Unknown base http library type: ${this.server.config.type}`);
    }
  }
}

export class PreHandler {
  byType: {[preType: string]: (op: HttpOp) => Promise<boolean> } = {};
  constructor() {
    this.byType = {
      [ReqProcessor.DECRYPT]: this.optionalDecrypt,
      [ReqProcessor.AUTH]: this.auth,
      [ReqProcessor.BASIC]: this.basic,
    };
  }
  async auth(op: HttpOp) {
    return promise<boolean>(async resolve => {
      const srvConfig = op.server.config;
      if (srvConfig.security.noauth) { return resolve(true); }
      switch (srvConfig.type) {
        case HttpBaseLib.EXPRESS:
          const authData: string = op.oriReq.headers.authorization;
          const apiRoleBook = op.server.apiAccess[op.api.handlerName];
          if (!op.fromInternal && apiRoleBook?.['deny-all']) {
            op.returnJson(HttpShimCode.error('AUTH_HEADER_SIGNED_BUT_API_DENIES_ALL',
                    `API '${op.api.method} ${op.api.fullpath}' is set to deny-all`));
          }
          if (authData) {
            if (authData.startsWith('Bearer ')) { // bearer token scheme
              const headerText = authData.split('Bearer ')[1];
              if (headerText.startsWith('SIGNED.')) {
                const [ signedType, scheme, payloadBase64, sigBase64, publicKey ] = headerText.split('.');
                if (scheme === 'ECC_4Q') {
                  let found = false;
                  for (const authServerKey of Object.keys(op.server.authServers)) {
                    if (op.server.authServers[authServerKey].publicKey === publicKey) {
                      found = true;
                      break;
                    }
                  }
                  if (!found) {
                    op.returnJson(HttpShimCode.error('AUTH_HEADER_SIGNED_BUT_PUBLIC_KEY_NOT_FOUND'));
                    return resolve(false);
                  }
                  const verifyResult = SecureHandshake.verifyStamp({ payload: payloadBase64, sig: sigBase64 }, publicKey);
                  if (verifyResult.bad) {
                    op.returnJson(verifyResult);
                    return resolve(false);
                  }
                  try {
                    const roleData = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));  
                    op.user = {
                      username: roleData.name,
                      publicKeys: roleData.publicKey,
                      roles: roleData.server[op.server.config.name],
                      rolesApplicable: null,
                    };
                    let targetRoleKey: string[];
                    if (apiRoleBook && !apiRoleBook['allow-all']) {
                      targetRoleKey = Object.keys(apiRoleBook);
                      const rolesApplicable: string[] = [];
                      for (const role of op.user.roles) {
                        if (apiRoleBook[role]) {
                          rolesApplicable.push(role);
                        }
                      }
                      op.user.rolesApplicable = rolesApplicable;
                      if (!op.user.rolesApplicable?.length) {
                        op.returnJson(HttpShimCode.error('AUTH_HEADER_SIGNED_ROLE_UNAUTHORZIED_FOR_API',
                              `API '${op.api.method} ${op.api.fullpath}' as user '${op.user.username}' with roles [${op.user.roles.join(', ')}] ` +
                              `has no authorizable match for the API requiring [${targetRoleKey.join(', ')}]`));
                        return resolve(false);
                      }
                    }
                  } catch (e) {
                    op.returnJson(HttpShimCode.error('AUTH_HEADER_SIGNED_NO_ROLES_MAP'));
                    return resolve(false);
                  }
                  return resolve(true);
                }
              } else if (headerText.startsWith('SYMNT_HASH.')) {
                
              }
            }
            op.returnJson(HttpShimCode.error('AUTH_HEADER_NOT_VALID'));
            return resolve(false);
          } else {
            op.returnJson(HttpShimCode.error('AUTH_HEADER_NOT_FOUND'));
            return resolve(false);
          }
          break;
      }
    });
  }
  async basic(op: HttpOp) {
    return promise<boolean>(async resolve => {
      switch (op.server.config.type) {
        case HttpBaseLib.EXPRESS:
          op.oriRes.header('Content-Type', 'application/json');
          // op.oriRes.header('Access-Control-Allow-Origin', '*');
          // op.oriRes.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
          let errored = false;
          const chunks: Buffer[] = [];
          op.oriReq.on('data', chunk => {
            chunks.push(chunk);
          });
          op.oriReq.on('end', () => {
            try {
              op.req.params = op.oriReq.params ? op.oriReq.params : {};
              let queryParamNames;
              if (op.oriReq.query && (queryParamNames = Object.keys(op.oriReq.query)).length > 0) {
                for (const queryParamName of queryParamNames) {
                  op.req.params[queryParamName] = op.oriReq.query[queryParamName];
                }
              }
              op.req.bodyRaw = Buffer.concat(chunks);
              const bod = op.req.body = op.req.bodyRaw.toString();
              if (op.oriReq.headers['encrypted-api']) {
                op.req.encryptedPayload = bod;
                const prepareResult = op.server.prepareEncryptedOperation(op);
                if (prepareResult.bad) {
                  op.raise(prepareResult);
                  return resolve(false);
                }
              } else {
                op.params = op.req.params;
                op.req.body = op.req.bodyRaw.toString();
                if (isJsonString(op.req.body)) {
                  try {
                    op.req.data = JSON.parse(op.req.body);
                    if (typeof op.req.data === 'object' && !Array.isArray(op.req.data)) {
                      Object.assign(op.req.params, op.req.data);
                    }
                  } catch (e) {
                    console.error('BAD_JSON', e);
                  }
                }
              }
              resolve(true);
            } catch (e) {
              console.error(e);
            }
          });
          op.oriReq.on('error', e => {
            console.error(e);
            errored = true;
            resolve(false);
          });
          break;
      }
    });
  }
  async optionalDecrypt(op: HttpOp) {
    return new Promise<boolean>(resolve => {

    });
  }
}

export class PostHandler {
  byType: {[postType: string]: (op: HttpOp) => Promise<boolean> } = {};
  constructor() {
    this.byType = {
      [ReqProcessor.BASIC]: this.basic,
      [ReqProcessor.ENCRYPT]: this.optionalEncrypt,
    };
  }
  async basic(op: HttpOp) {
    return new Promise<boolean>(resolve => {
      switch (op.server.config.type) {
        case HttpBaseLib.EXPRESS:
          resolve(true);
          break;
      }
    });
  }
  async optionalEncrypt(op: HttpOp) {
    return new Promise<boolean>(resolve => {
      switch (op.server.config.type) {
        case HttpBaseLib.EXPRESS:
          resolve(true);
          break;
      }
    });
  }
}

export enum CacheParser {
  JSON = 'JSON'
}

export class CacheDef<T = any> {
  path: string;
  class: Class<T>;
  keys: { name: string; type: 'param' | 'fixed'; }[] = null;
  keysExceptLast: { name: string; type: 'param' | 'fixed'; }[] = null;
  lastKey: { name: string; type: 'param' | 'fixed'; } = null;
  serializer: CacheParser;
  maxOld: number = 0;
  matchExactly: boolean = false;
  defStack: string = '';
  constructor(init?: Partial<CacheDef<T>>) {
    if (init) { Object.assign(this, init); }
    if (this.path.indexOf('/') >= 0) {
      this.keys = [];
      const keys = this.path.split('/').slice(1);
      for (const keyname of keys) {
        if (keyname.startsWith(':')) {
          this.keys.push({ name: keyname.split(':')[1], type: 'param' });
        } else {
          this.keys.push({ name: keyname, type: 'fixed' });
        }
      }
      this.lastKey = this.keys[this.keys.length - 1];
      this.keysExceptLast = this.keys.slice(0, -1);
    }
    if (!this.serializer) { this.serializer = CacheParser.JSON; }
  }
}

export interface CacheAccessOption {
  version?: number | string;
  pathParams?: {[name: string]: string};
  serialized?: string | Buffer;
  serializedResponse?: string | Buffer;
  matchExactly?: boolean;
}

export class CacheEntry<T = any> {
  hasValue?: boolean;
  value: T;
  rootNode: any;
  version: number | string;
  serialized?: string | Buffer;
  serializedResponse?: string | Buffer;
  hits: number;
  def: CacheDef<T>;
  constructor(init?: Partial<CacheEntry>) { if (init) { Object.assign(this, init); } }
  asResponse(): string | Buffer {
    if (this.serializedResponse) { return this.serializedResponse; }
  }
  asSerialized(): string | Buffer { return this.serialized; }
  getData(option?: CacheAccessOption) {
    const nav = this.keyNavigate(option);
    return nav.target[nav.key] as T;
  }
  keyNavigate(option?: CacheAccessOption) {
    if (this.def.keys) {
      if (!this.rootNode) { this.rootNode = {}; }
      let node = this.rootNode;
      for (const keyInfo of this.def.keysExceptLast) {
        const key = this.resolvePathKey(keyInfo, option);
        if (!node[key]) { node[key.name] = {}; }
        node = node[key];
      }
      const lastKeyStr = this.resolvePathKey(this.def.lastKey, option);
      return { key: lastKeyStr, target: node as any };
    } else {
      return { key: 'value', target: this as any };
    }
  }
  resolvePathKey(keyInfo: { name: string; type: 'param' | 'fixed'; }, opt?: CacheAccessOption) {
    let key;
    if (keyInfo.type === 'fixed') {
      key = keyInfo.name;
    } else {
      if (!opt?.pathParams) {
        throw new Error(`Cannot naviagate cache path '${this.def.path}'. param not given`);
      }
      const paramValue = opt?.pathParams?.[keyInfo.name];
      if (!paramValue) {
        throw new Error(`Cannot naviagate cache path '${this.def.path}'. param '${keyInfo.name}' not found`);
      }
      key = paramValue;
    }
    if (!key) {
      throw new Error(`Cannot naviagate cache path '${this.def.path}; Params = ${opt.pathParams}`);
    }
    return key;
  }
}


export class HttpCacheOp<Params = HttpParams, Returns = any> {
  constructor(public op: HttpOp<Params, Returns>) {}
  async handler<T>(cacheDef: CacheDef<T>, option: CacheAccessOption,
                   dataResolver: (resolve: (data: T) => void) => void) {
    if (!option) { option = {}; }
    if (!option.pathParams) { option.pathParams = {}; }
    if (this.op.req.params) {
      Object.assign(option.pathParams, this.op.req.params);
    }
    const entry = this.cacheEntryGet(cacheDef, option);
    const matched = entry ? true : false;
    return this.op.addSequentialProcess(new Promise<void>(procResolve => {
      const resolve = (data: T, cacheEntry?: CacheEntry<T>) => {
        if (matched && cacheEntry?.serializedResponse) {
            this.op.setResponse(cacheEntry.serializedResponse as string);
            return procResolve();
        }
        let dataString;
        let responseString;
        switch (cacheDef.serializer) {
          case CacheParser.JSON:
            dataString = option.serialized = JSON.stringify(data);
            responseString = option.serializedResponse = this.op.res.okJsonPreserialized(dataString);
            break;
        }
        this.cacheSet(cacheDef, data, option);
        this.op.setResponse(responseString);
        return procResolve();
      };
      if (matched) {
        resolve(entry.getData(option), entry);
      } else {
        dataResolver(resolve);
      }
    }));
  }
  cacheEntryGet(cacheDef: CacheDef, option?: CacheAccessOption) {
    const cacheData = this.op.server.cacheData[cacheDef.path];
    if (!cacheData || !cacheData.hasValue) { return null; }
    const matchExactly = cacheDef.matchExactly ? true : (option.matchExactly ? true : false);
    if (matchExactly) {
      if (option && option.version && option.version !== cacheData.version) {
        return null; // looking to match time/version exactly, but didn't match.
      }
    } else {
      if (cacheData.def.maxOld !== 0 && // 0 means no expiry
          Date.now() - (cacheData.version as number) > cacheData.def.maxOld) {
        return null; // too old
      }
    }
    ++cacheData.hits;
    return cacheData;
  }
  cacheSet<T>(cacheDef: CacheDef<T>, value: T, option?: CacheAccessOption) {
    if (!this.op.server.cacheData[cacheDef.path]) {
      throw new Error(`Cache key '${cacheDef.path}' is not defined ahead-of-time for this server.`);
    }
    const cacheData = this.op.server.cacheData[cacheDef.path];
    const setter = cacheData.keyNavigate(option);
    setter.target[setter.key] = value;
    if (option?.version) {
      cacheData.version = option.version;
    } else {
      cacheData.version = Date.now();
    }
    if (option?.serialized) {
      cacheData.serialized = option.serialized;
    }
    if (option?.serializedResponse) {
      cacheData.serializedResponse = option.serializedResponse;
    }
    cacheData.hasValue = true;
    return cacheData;
  }
  cacheUnset(cacheDef: CacheDef) {
    const cacheData = this.op.server.cacheData[cacheDef.path];
    if (cacheData) { cacheData.hasValue = false; }
    return cacheData;
  }
}

function expressHandler(server: HttpServerShim, api: HttpServerShimApi) {
  return async (oriReq, oriRes) => {
    const op = new HttpOp(server, api, oriReq, oriRes);
    op.method = oriReq.method;
    await op.run();
  };
}

function isJsonString(str: string) {
  return (str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'));
}
