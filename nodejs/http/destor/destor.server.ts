/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import { passthru, passthruError, ReturnCodeFamily } from '../../../src/common/globals.ix';
import { HttpServerShim, HTTP, HttpBaseLib, HttpOp, ReqProcessor, ParamDef, HttpOpType } from '../http.shim';
import * as fs from 'fs';
import { HttpCode } from '../http.models';
import { envVar } from '../../../src/common/env/env.profile';
import { as, required } from '../../../src/type-transform';
import { parseProperties } from '../../../src/common/util/convenience/properties.parse';
import { pathNavigate } from '../../util/node-util';
import { SecureChannelTypes } from '../../../src/common/security/security.common';

const scopeName = `destor;pid=${process.pid}`;

enum DestorCodeEnum {
  DESTOR_RESOLVE_CONFIG_APP_PROFILE_NOT_FOUND,
  DESTOR_AUTH_SERVER_APP_PROFILE_NOT_FOUND,
  DESTOR_SECRET_NOT_FOUND,
}
export const DestorCode = ReturnCodeFamily('DestorCode', DestorCodeEnum);

let localData;
let destorData;

function getConf() {
  localData = parseProperties(fs.readFileSync(process.env.DESTOR_SERVER_CONFIG_FILE, 'utf8'));
  destorData = localData.destor;
  return localData;
}

export class DestorServer extends HttpServerShim {

  dataResolution: 'local-file' | 'remote' = envVar('DESTOR_SERVER_DATA_RESOLUTION', 'local-file');
  
  constructor() {
    super({
      name: 'destor',
      type: HttpBaseLib.EXPRESS,
      scopeName,
      security: {
        accessor: { required: true, baseToken: process.env.DESTOR_SERVER_BASE_TOKEN },
        secureChannel: { enabled: true, required: true, encryption: SecureChannelTypes.ECC_4Q, signingKey: process.env.DESTOR_SERVER_SIGNING_KEY },
      },
      startOptions: { port: process.env.DESTOR_SERVER_PORT ? parseInt(process.env.DESTOR_SERVER_PORT, 10) : 17070 },
      skipConfigSecretResolution: true,
    });
    this.apiVersion = 'v1';
    this.apiPath = this.configGlobal.destor.basePath;
    this.addDefaultProcessor(ReqProcessor.BASIC);
    getConf();
    if (this.dataResolution === 'local-file') {
      setInterval(() => { try { getConf() } catch (e) { console.error(e); } }, 30000);
    }
  }

  @HTTP.GET(`/`, { rootMount: true })
  async rootProofOfAuthenticity(op: HttpOp) {
    const accessorResult = this.checkAccessor(op); if (accessorResult.bad) { return passthruError(accessorResult); }
    const stamp = await this.stamp();
    return op.res.returnJson({ ...stamp });
  }

  getResolvConfig_iface = {
    path: `/resolve-config/:env`,
    description: ``,
    params: {
      env: { required, type: `string`, default: as<string>(), description: `` },
      targets: { required, type: `string`, default: as<string>(), description: `` },
    },
    returns: { type: `{[key: string]: {value: any, error?: string}}`,
               default: as<{[key: string]: {value: any, error?: string}}>() },
  };
  @HTTP.GET(`/resolve-config/:env`, { rootMount: true })
  async getResolveConfig(op: HttpOpType<typeof this.getResolvConfig_iface>) {
    const targets = op.params.targets.split('|').map(target => {
      target = target.trim();
      while (target.startsWith('<') && target.endsWith('>')) { target = target.slice(1, -1); }
      return target;
    });
    if (this.dataResolution === 'local-file') {
      if (!localData?.profiles?.[op.params.env]) {
        return op.raise(DestorCode.error('DESTOR_RESOLVE_CONFIG_APP_PROFILE_NOT_FOUND',
                        `application profile env '${op.params.env}' not found on destor config`));
      }
      const result: {[key: string]: {value: any, error?: string}} = {};
      for (const targetStr of targets) {
        const lit = targetStr.split('?:');
        const targetPathStr = lit[0]?.trim();
        const defaultValueDef = lit[1]?.trimStart();
        let defaultValue: any;
        if (defaultValueDef) {
          if (defaultValueDef.indexOf(':') >= 0) {
            const dfLit = defaultValueDef.split(':');
            const dfType = dfLit[0];
            const dfValueStr = dfLit.slice(1).join(':');
            if (dfType === 'number') {
              defaultValue = +dfValueStr;
            } else if (dfType === 'boolean') {
              defaultValue = dfValueStr.toLowerCase() === 'true' ? true : false;
            } else if (dfType === 'string') {
              defaultValue = dfValueStr;
            }
          } else {
            defaultValue = defaultValueDef;
          }
        }
        const targetPath = targetPathStr.split('.');
        if (targetPath[0] !== 'config' && targetPath[0] !== 'secret') {
          result[targetStr] = { value: null, error: `resolvable path must start with 'config' or 'secret', got '${targetPath[0]}'` };
          continue;
        }
        let resolved = pathNavigate(targetPath, localData?.profiles?.[op.params.env]);
        if (resolved === null) { resolved = pathNavigate(targetPath, localData?.global); }
        const resObj: {value: any, error?: string} = { value: resolved };
        if (resolved === null) {
          if (defaultValueDef) {
            resObj.value = defaultValue;
          } else {
            resObj.error = `not_found`;
          }
        }
        result[targetStr] = resObj;
      }
      op.returnJson(result);
    }
  }

  getAuthServer_iface = {
    path: `/auth-servers/:env`,
    description: ``,
    params: {
      env: { required, type: `string`, default: as<string>(), description: `` },
    },
    returns: { type: `{[name: string]: { url: string, type: string, publicKey: string }}`,
               default: as<{[name: string]: { url: string, type: string, publicKey: string }}>() },
  };

  @HTTP.GET(`/auth-servers/:env`, { rootMount: true })
  async getAuthServer(op: HttpOpType<typeof this.getAuthServer_iface>) {
    if (this.dataResolution === 'local-file') {
      if (!localData?.profiles?.[op.params.env]) {
        return op.raise(DestorCode.error('DESTOR_AUTH_SERVER_APP_PROFILE_NOT_FOUND',
                        `application profile env '${op.params.env}' not found on destor config`));
      }
      let data = pathNavigate(['config', 'authServers'], localData?.profiles?.[op.params.env]);
      if (data === null) { data = pathNavigate(['config', 'authServers'], localData?.global); }
      return op.returnJson(data);
    }
  }

}
