/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import * as axios from 'axios';
import { DiffieHellmanKeyPair, FourQ } from '@jovian/fourq';
import { v4 as uuidv4 } from 'uuid';

import { initiateSecureChannel, resolveEntry, SecureChannel, SecureHandshake } from './secure-channel';
import { ok, errorResult, promise, Result } from '../../src/common/globals.ix';
import { HTTP } from '../http/http.shim';
import { SecureChannelBaseParams, SecureChannelResponse, TrustedPublicKey } from '../../src/common/security/security.common';

export interface SecureHttpCommConfig extends SecureChannelBaseParams {
  user: string;
  endpoint: string;
  encryptedChannelPath?: string;
  encryptedApiPath?: string;
  defaultTimeout?: number;
  defaultChannelExpire?: number;
  revealPath?: boolean;
}

export interface SecureRequest {
  id?: string;
  method?: string;
  path: string;
  body?: string;
  headers?: {[name: string]: string};
  timeout?: number;
  revealPath?: boolean;
}

export class SecureHttpComm {
  pending: Promise<boolean>;
  config: SecureHttpCommConfig;
  channel: SecureChannel;
  trustResolved?: TrustedPublicKey;
  tokenResolved?: string;
  channelPublicKeyBase64?: string;
  error: Error;
  errors: Error[] = [];

  constructor(config: SecureHttpCommConfig) {
    if (!config.encryptedChannelPath) { config.encryptedChannelPath = HTTP.SHIM.ROOT_API_NEW_CHANNEL; }
    if (!config.encryptedApiPath) { config.encryptedApiPath = HTTP.SHIM.ROOT_API_SECURE_API; }
    if (!config.defaultTimeout) { config.defaultTimeout = 3600; }
    if (!config.defaultChannelExpire && config.defaultChannelExpire !== 0) { config.defaultChannelExpire = 3600; }
    this.config = config;
    this.pending = this.initialize();
  }

  pushError(e: Error) {
    this.error = e;
    this.errors.push(e);
  }

  getAccessorHeader(token: string, channelPubKeyB64: string, channelExp?: number) {
    const headerResult = SecureHandshake.getAccessorHeader(this.config.user, channelPubKeyB64, token, this.config.signing);
    return headerResult?.data;
  }

  initialize() {
    const stackTrace = new Error();
    const config = this.config;
    return promise(async (resolve, reject) => {
      const channelInitResult = await initiateSecureChannel({
        ...config,
        initiateContact: async (authHeader: string) => {
          try {
            const res = await axios.default.get(`${config.endpoint}${config.encryptedChannelPath}`, {
              timeout: 7000, headers: { Accessor: authHeader }
            });
            (res.request as any).stackTrace = stackTrace;
            if (res.status !== 200) { return errorResult(new Error(`Not valid stamp`)); }
            const trust = this.trustResolved = await resolveEntry('trust', config.trust);
            this.tokenResolved = await resolveEntry('token', config.token);
            const pubkey = trust ? Buffer.from(trust.publicKey, 'base64') : null;
            const secureChannelResponse: SecureChannelResponse = res.data.result;
            if (config.trust) {
              const validResult = SecureHandshake.verifyStamp(secureChannelResponse, pubkey);
              if (!validResult || validResult.bad || !validResult.data) {
                return errorResult(new Error(`Not valid stamp`));
              }
            }
            return ok(secureChannelResponse);
          } catch (e) {
            console.error(e.message, stackTrace);
            return errorResult(e);
          }
        }
      });
      if (channelInitResult.ok) {
        this.channel = channelInitResult.data;
        this.channelPublicKeyBase64 = this.channel.localKeyPair.publicKey.toString('base64');
      } else {
        console.error(channelInitResult)
      }
      this.pending = null;
      resolve(true);
    });
  }

  async waitForChannel() {
    if (this.pending) {
      const res = await this.pending;
      if (!res) { return false; }
    }
    return true;
  }

  async get<T = any>(reqObj: SecureRequest) {
    reqObj.method = 'GET';
    return await this.request<T>(reqObj);
  }

  async post<T = any>(reqObj: SecureRequest) {
    reqObj.method = 'POST';
    return await this.request<T>(reqObj);
  }

  async request<T = any>(reqObj: SecureRequest) {
    return promise<T>(async (resolve, reject) => {
      if (!(await this.waitForChannel())) {
        this.pushError(new Error(`Unable to get channel on endpoint ${this.config.endpoint}`));
        return resolve(null);
      }
      try {
        const timeout = reqObj.timeout ? reqObj.timeout : this.config.defaultTimeout;
        const encPayload = this.channel.createWrappedPayloadBase64({
          id: uuidv4(),
          path: reqObj.path,
          headers: reqObj.headers,
          body: reqObj.body,
        });
        const revealPath = (reqObj.revealPath || this.config.revealPath);
        const reqPath = revealPath ? reqObj.path : this.config.encryptedApiPath;
        if (!reqObj.path) { reqObj.path = '/'; }
        if (!reqObj.path.startsWith('/')) { reqObj.path = '/' + reqObj.path; }
        const authHeader = SecureHandshake.getAccessorHeader(this.config.user, this.channelPublicKeyBase64, this.tokenResolved, this.config.signing)
        const encHeaders = { 'Accessor': authHeader.data, 'Encrypted-Api': 'yes' };
        const finalPath = `${this.config.endpoint}${reqPath}`;
        const stackTrace = new Error();
        const attachResolution = (prom: Promise<axios.AxiosResponse<any, any>>) => {
          return prom.then(res => {
                        const result = this.unwrapEncryptedResponse(res, stackTrace);
                        result.statusCode = res.status;
                        resolve(result);
                      })
                     .catch(e => {
                        if (e.response) {
                          const result = errorResult(this.handleEncryptedError(e.response, e, stackTrace));
                          result.statusCode = e.response.status;
                          reject(this.handleEncryptedError(e.response, e, stackTrace));
                        } else {
                          console.error(e);
                          reject(e);
                        }
                      });
        };
        switch (reqObj.method) {
          case 'GET': {
            attachResolution(axios.default.get(finalPath, { timeout, data: encPayload, headers: encHeaders }));
            break;
          }
          case 'PUT': {
            attachResolution(axios.default.put(finalPath, encPayload, { timeout, headers: encHeaders }))
            break;
          }
          case 'POST': {
            attachResolution(axios.default.post(finalPath, encPayload, { timeout, headers: encHeaders }))
            break;
          }
          case 'PATCH': {
            attachResolution(axios.default.patch(finalPath, encPayload, { timeout, headers: encHeaders }))
            break;
          }
          case 'DELETE': {
            attachResolution(axios.default.delete(finalPath, { timeout, data: encPayload, headers: encHeaders }))
            break;
          }
        }
      } catch (e) {
        this.pushError(e);
        resolve(null);
      }
    });
  }

  private handleEncryptedError(res: axios.AxiosResponse<any, any>, e: Error, stackTrace: Error) {
    console.log(res, e);
    if (res?.request) {
      (res.request as any).stackTrace = stackTrace;
    }
    if (res?.data?.encrypted) {
      const decrypted = this.unwrapEncryptedResponse(res, stackTrace);
      return new Error(decrypted.message);
    }
    return e;
  }

  private unwrapEncryptedResponse(res: axios.AxiosResponse<any, any>, stackTrace: Error) {
    (res.request as any).stackTrace = stackTrace;
    if (!res?.data?.encrypted) { return res.data; }
    const responseText = this.channel.decryptSecureChannelPayloadIntoString(res.data.payload);
    if (res.data.headers) {
      for (const headerName of Object.keys(res.data.headers)) {
        res.headers[headerName] = res.data.headers[headerName];
      }
    }
    if (!responseText) {
      return null;
    }
    switch (res.data.format) {
      case 'json':
        return JSON.parse(responseText);
      default:
        return null;
    }
  }
}
