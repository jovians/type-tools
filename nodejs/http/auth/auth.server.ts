/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import { parseProperties, parsePropertyValue, toBe } from '../../../src/common/globals.ix';
import { as, required } from '../../../src/type-transform';
import { SecureHandshake } from '../../secure-channel/secure-channel';
import { HttpServerShim, HTTP, HttpBaseLib, HttpOp, ReqProcessor, HttpOpType } from '../http.shim';
import * as fs from 'fs';
import { pathNavigate } from '../../util/node-util';
import { httpRest } from '../http.models';
import { APP, envVar } from '../../../src/common/env/env.profile';
import { SecureChannelTypes } from '../../../src/common/security/security.common';

// AUTH_SERVER_APP_PROFILE
// AUTH_SERVER_CONFIG_FILE
// AUTH_SERVER_DATA_RESOLUTION

const scopeName = `authsrv;pid=${process.pid}`;

const appProfile = APP.PROFILE;

const roles = {
  ADMIN: 99,
  NO_AUTH: 0,
};

let localData;
function getConf() {
  localData = parseProperties(fs.readFileSync(process.env.AUTH_SERVER_CONFIG_FILE as string, 'utf8'));
  return localData;
}

export class AuthServer extends HttpServerShim<typeof roles> {

  dataResolution: 'local-file' | 'remote' = envVar('AUTH_SERVER_DATA_RESOLUTION', 'local-file');
  publicKey: string;

  constructor() {
    super({
      name: 'auth-server',
      env: appProfile,
      type: HttpBaseLib.EXPRESS,
      scopeName,
      security: {
        accessor: { required: false, baseToken: '<secret.authServers.default.token>', },
        secureChannel: { enabled: true, required: false, encryption: SecureChannelTypes.ECC_4Q, signingKey: '<secret.authServers.default.signingKey>' },
      },
      startOptions: { port: toBe`<config.authServers.default.port ?: number:17071>` },
      skipAuthServerResolution: true,
    });
    this.apiVersion = 'v1';
    this.apiPath = this.configGlobal.api.basePath;
    this.addDefaultProcessor(ReqProcessor.BASIC);
    getConf();
    if (this.dataResolution === 'local-file') {
      setInterval(() => { try { getConf() } catch (e) { console.error(e); } }, 30000);
    }
  }

  afterConfigResolution() {
    this.publicKey = SecureHandshake.getPublicKeyFrom(this.config.security.secureChannel.signingKey);
  }

  getAuthentication_iface = {
    path: `/authenticate`,
    rootMount: true,
    description: ``,
    params: {
      type: { type: `string`, default: as<string>() },
      servers: { required, type: `string`, default: as<string>() },
      apiKey: { required, type: `string`, default: as<string>() },
    },
    returns: { type: '{refreshToken: string}', default: as<{refreshToken: string}>() },
  };

  @HTTP.METHODS(httpRest, `/authenticate`, { rootMount: true })
  async getAuthentication(op: HttpOpType<typeof this.getAuthentication_iface>) {
    if (this.dataResolution === 'local-file') {
      const path = ['secret', 'authServers', 'apiKey', op.params.apiKey];
      const servers = op.params.servers.split(',')
      let resolved: string = pathNavigate(path, localData?.profiles?.[this.config.env]);
      if (resolved === null) { resolved = pathNavigate(path, localData?.global); }
      if (resolved) {
        const infoAll = parsePropertyValue(resolved);
        const server = {};
        Object.keys(infoAll.server).forEach(serverName => {
          if (servers.indexOf(serverName) >= 0) {
            server[serverName] =  infoAll.server[serverName];
          }
        });
        const info = {
          username: infoAll.username,
          publicKey: infoAll.publicKey,
          baseRoles: infoAll.baseRoles,
          server,
        };
        const rolesPayload = JSON.stringify(info);
        const stamp = await this.stamp(rolesPayload, 'utf8');
        const auth = `SIGNED.ECC_4Q.${stamp.payload}.${stamp.sig}.${this.publicKey}`;
        op.returnJson({ refreshToken: auth });
      }
    }
  }

}
