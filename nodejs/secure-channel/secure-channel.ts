/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import { FourQ, DiffieHellmanKeyPair, CryptoScheme } from '@jovian/fourq';
import * as crypto from 'crypto';
import { AccessHeaderObject, AuthHeaderObject, AuthSignatureData, AuthSigning, ResolvableEntry, SecureChannelBaseParams, SecureChannelPayload, SecureChannelPeer, SecureChannelResponse, SecureChannelResponseExtraInfo, SecureChannelTypes } from '../../src/common/security/security.common';
import { ok, passthru, Result, ReturnCodeFamily, Unum } from '../../src/common/util/enum.util';
import { punchGrab } from '../../src/type-transform';

const verticalBarBuffer = Buffer.from('|', 'ascii');

enum SecureChannelCodeEnum {
  CONTACT_INITIATION_FAILURE,
  CONTACT_INITIATION_TOKEN_NOT_FOUND,
  CONTACT_INITIATION_BAD_RESULT,
  CONTACT_INITIATION_NULL_RESPONSE,
  BAD_CHANNEL_ID_CLIENT,
  TRUSTED_PEER_MISMATCH_CLIENT,
  TRUSTED_PEER_MISMATCH_SERVER,
  TRUST_STAMP_VERIFICACTION_FAILURE_CLIENT,
  TRUST_STAMP_VERIFICACTION_FAILURE_SERVER,
  ACCESSOR_TIME_WINDOW_EXCEEDED,
  ACCESSOR_TOKEN_HASH_MISMATCH,
  SYM_NONCE_TIME_HASH_TIME_WINDOW_EXCEEDED,
  SYM_NONCE_TIME_HASH_TOKEN_HASH_MISMATCH,
  AUTH_NO_SIGNING_KEY,
  AUTH_NO_PUBLIC_KEY,
  AUTH_NO_SIG_DATA_OBJECT,
  AUTH_NO_SIG_DATA,
  AUTH_NO_SIG_PAYLOAD,
  AUTH_BAD_PUBLIC_KEY,
  AUTH_BAD_SIG_DATA,
  AUTH_BAD_SIGNATURE,
  AUTH_BAD_SIG_PAYLOAD,
  AUTH_BAD_SIGNING_KEY,
}
export const SecureChannelCode = ReturnCodeFamily('SecureChannelCode', SecureChannelCodeEnum);

export interface SecureChannelInitFlow extends SecureChannelBaseParams {
  channelId?: string;
  initiateContact: (authHeader: string) => Promise<Result<SecureChannelResponse>>,
}

export interface SecureChannelAnswerFlow extends SecureChannelBaseParams {
  channelId?: string;
  authHeader: string;
  timeWindow?: number;
}

export async function resolveEntry<T = string>(context: string, resolver: ResolvableEntry<T>, key?: string, returnNullOnNotFound = false): Promise<T> {
  const resolverAny: any = resolver;
  if (!resolverAny) { return null; }
  if (typeof resolverAny === 'string') {
    if (key === null || key === undefined) {
      return resolverAny as any as T;
    } else {
      throw new Error(`Unable to resolve entry ${context} from direct string value entry when key '${key}' is given`);
    }
  }
  if (!resolverAny.getter && !resolverAny.list) {
    if (key === null || key === undefined) {
      return resolver as T;
    } else {
      throw new Error(`Unable to resolve entry ${context} from direct object value entry when key '${key}' is given`);
    }
  }
  if (!key && resolverAny?.list) {
    const keys = Object.keys(resolverAny.list);
    if (keys.length > 0) {
      const entry = resolverAny.list[keys[0]];
      if (entry?.value === undefined) {
        return entry;
      } else {
        return entry.value;
      }
    }
  }
  if (!key) { key = 'default'; }
  if (resolverAny.getter) {
    return await punchGrab(resolverAny.getter(key));
  } else if (resolverAny.list[key]) {
    if (resolverAny.list[key].getter) {
      return await punchGrab(resolverAny.list[key].getter(key));
    } else {
      if (resolverAny.list[key].value === undefined) {
        return (resolverAny.list[key] as any as T);
      } else {
        return resolverAny.list[key].value;
      }
    }
  }
  if (returnNullOnNotFound) {
    return null;
  } else {
    throw new Error(`Unable to resolve entry '${context}'  with key '${key}' from entry mapping: ${JSON.stringify(resolver, null, 4)}`);
  }
}

export class SecureHandshake {
  static getIdentityFrom(privateKey: string) {
    return FourQ.generateIdentity(Buffer.from(privateKey, 'base64'));
  }
  static getPublicKeyFrom(privateKey: string) {
    return FourQ.generateIdentity(Buffer.from(privateKey, 'base64')).publicKeySchnorr.toString('base64');
  }
  static fromJSON(json: string) {
    const a = new SecureChannel();
    return a.fromJSONObject(JSON.parse(json));
  }
  static getLengthBytesUInt32LE(length: number) {
    const lengthBytes = Buffer.alloc(4);
    lengthBytes.writeUInt32LE(length, 0);
    return lengthBytes;
  }
  static parseLengthBytesUInt32LE(lengthBytes: Buffer) {
    return lengthBytes.readUInt32LE();
  }
  static getAccessorBody(user: string, baseToken: string | Buffer, nonceHex?: string, joiner = '.') {
    let timeHex = Date.now().toString(16);
    if (timeHex.length % 2 === 1) { timeHex = '0' + timeHex; }
    if (!nonceHex) { nonceHex = randHex(16); }
    if (!user) { user = 'internal'; }
    const accessorParts = [user, timeHex, nonceHex];
    const accessorBuffer = Buffer.from(user, 'ascii');
    const nonceBuffer = Buffer.from(nonceHex, 'hex');
    const timeBuffer = Buffer.from(timeHex, 'hex');
    const baseTokenBuffer = typeof baseToken === 'string' ? Buffer.from(baseToken, 'ascii') : baseToken;
    const accessorSecret = saltedSha512(baseTokenBuffer, accessorBuffer);
    const oneTimeHash = saltedSha512(accessorSecret, timeBuffer, nonceBuffer).toString('base64');
    accessorParts.push(oneTimeHash);
    return accessorParts.join(joiner);
  }
  static getAccessorHeader(user: string,
                      ecdhPubKeyB64: string,
                      baseToken: string | Buffer,
                      signing?: AuthSigning,
                      channelExpire?: number,
                      nonceHex?: string): Result<string> {
    let sigPart = '';
    if (signing) {
      const signingResult = SecureHandshake.signStamp(signing.private);
      if (signingResult.bad) { return passthru(signingResult); }
      sigPart = Buffer.from([
        signing.type,
        signingResult.data.payload,
        signing.public,
        signingResult.data.sig
      ].join('_'), 'utf8').toString('base64');
    }
    const accessorHeader = [
      `Accessor !!!!.${SecureHandshake.getAccessorBody(user, baseToken, nonceHex)}`,
      ecdhPubKeyB64,
      channelExpire ? channelExpire : 0,
      sigPart,
    ].join('_');
    let lengthRemainder = accessorHeader.length;
    const totalContentLength3 = lengthRemainder % 256;
    lengthRemainder = (lengthRemainder - totalContentLength3) / 256;
    const totalContentLength2 = lengthRemainder % 256;
    lengthRemainder = (lengthRemainder - totalContentLength2) / 256;
    const totalContentLength1 = lengthRemainder % 256;
    const contentLength = Buffer.from([totalContentLength1, totalContentLength2, totalContentLength3]).toString('base64');
    const accessorHeaderWithLengthBytes = accessorHeader.replace('!!!!', contentLength);
    return ok(accessorHeaderWithLengthBytes);
  }
  static parseAccessor(accessorExpression: string): AccessHeaderObject {
    const accessorData = accessorExpression.split('.');
    const headerLength = getLengthFromBytesOfHashContent(accessorData[0], 'Accessor');
    const accessor = accessorData[1];
    const accessorBuffer = Buffer.from(accessor, 'ascii');
    const timeHex = accessorData[2];
    const timestamp = parseInt(timeHex, 16);
    const nonceHex = accessorData[3];
    const nonceBuffer = Buffer.from(nonceHex, 'hex');
    const timeBuffer = Buffer.from(timeHex, 'hex');
    const oneTimeHash = accessorData[4];
    return  { headerLength, accessorBuffer, timeHex, timeBuffer, timestamp, nonceHex, nonceBuffer, oneTimeHash };
  }
  static parseAuthHeader(authHeader: string): AuthHeaderObject {
    const authChunks = authHeader.split('_');
    const accessor = SecureHandshake.parseAccessor(authChunks[0]);
    const [
      payloadB64,
      signerPubKeyB64,
      signatureB64,
    ] = authChunks[3] ?
      Buffer.from(authChunks[3], 'base64').toString('utf8').split('_') :
      [null, null, null];
    return {
      accessorExpression: authChunks[0],
      peerEcdhPublicKey: authChunks[1],
      expires: authChunks[2] ? parseInt(authChunks[2], 10) : 0,
      sigPart: authChunks[3],
      peerSignaturePublicKey: signerPubKeyB64,
      peerSignature: signatureB64,
      peerSignaturePayload: payloadB64,
      ...accessor,
    };
  }
  static symNonceTimeHash(baseToken: string | Buffer, user: string = 'internal') {
    const hashedContent = `!!!!_${this.getAccessorBody(user, baseToken, null, '_')}`;
    let lengthRemainder = hashedContent.length;
    const totalContentLength3 = lengthRemainder % 256;
    lengthRemainder = (lengthRemainder - totalContentLength3) / 256;
    const totalContentLength2 = lengthRemainder % 256;
    lengthRemainder = (lengthRemainder - totalContentLength2) / 256;
    const totalContentLength1 = lengthRemainder % 256;
    const contentLength = Buffer.from([totalContentLength1, totalContentLength2, totalContentLength3]).toString('base64');
    const encryptedContentWithLengthBytes = hashedContent.replace('!!!!', contentLength);
    return encryptedContentWithLengthBytes;
  }
  static symNonceTimeHashHeader(baseToken: string | Buffer, user: string = 'internal') {
    return `Bearer SYMNT_HASH.${this.symNonceTimeHash(baseToken, user)}`;
  }
  static symNonceTimeVerify(hashedText: string, baseToken: string | Buffer, timeWindow = 5000) {
    const accessorData = hashedText.split('_');
    const headerLength = getLengthFromBytesOfHashContent(accessorData[0]);
    const hashedContent = accessorData[1];
    const hashedContentBuffer = Buffer.from(hashedContent, 'ascii');
    const timeHex = accessorData[2];
    const nonceHex = accessorData[3];
    const nonceBuffer = Buffer.from(nonceHex, 'hex');
    const timeBuffer = Buffer.from(timeHex, 'hex');
    const oneTimeHash = accessorData[4];
    const t = parseInt(timeHex, 16);
    if (Math.abs(Date.now() - t) > timeWindow) {
      return SecureChannelCode.error('SYM_NONCE_TIME_HASH_TIME_WINDOW_EXCEEDED');
    }
    const baseTokenBuffer = typeof baseToken === 'string' ? Buffer.from(baseToken, 'ascii') : baseToken;
    const accessorSecret = saltedSha512(baseTokenBuffer, hashedContentBuffer);
    const expectedHash = saltedSha512(accessorSecret, timeBuffer, nonceBuffer).toString('base64');
    if (oneTimeHash !== expectedHash) {
      return SecureChannelCode.error('SYM_NONCE_TIME_HASH_TOKEN_HASH_MISMATCH');
    }
    return ok(true);
  }
  static verifyAuthHeaderSignature(sigObj: {peerSignaturePublicKey: string; peerSignature: string; peerSignaturePayload: string;}) {
    return SecureHandshake.verifyStamp({ payload: sigObj.peerSignaturePayload, sig: sigObj.peerSignature }, sigObj.peerSignaturePublicKey);
  }
  static verifyAccessor(accessorExpression: string, baseToken: string | Buffer, timeWindow = 5000): Result<AccessHeaderObject> {
    const accessor = SecureHandshake.parseAccessor(accessorExpression);
    const t = parseInt(accessor.timeHex, 16);
    if (Math.abs(Date.now() - t) > timeWindow) {
      return SecureChannelCode.error('ACCESSOR_TIME_WINDOW_EXCEEDED');
    }
    const baseTokenBuffer = typeof baseToken === 'string' ? Buffer.from(baseToken, 'ascii') : baseToken;
    const accessorSecret = saltedSha512(baseTokenBuffer, accessor.accessorBuffer);
    const expectedHash = saltedSha512(accessorSecret, accessor.timeBuffer, accessor.nonceBuffer).toString('base64');
    if (accessor.oneTimeHash !== expectedHash) {
      return SecureChannelCode.error('ACCESSOR_TOKEN_HASH_MISMATCH');
    }
    return ok(accessor);
  }
  static timeAuth() {
    return 'proof-of-authenticity__t:gaia:ms:' + Date.now();
  }
  static signStamp(signingKey: string | Buffer): Result<AuthSignatureData> {
    if (!signingKey) { return SecureChannelCode.error('AUTH_NO_SIGNING_KEY'); }
    const payload = SecureHandshake.timeAuth();
    const payloadBuffer = Buffer.from(payload, 'ascii');
    const signingKeyBuffer = typeof signingKey === 'string' ? Buffer.from(signingKey, 'base64') : signingKey;
    if (!signingKeyBuffer || signingKeyBuffer.length !== 32) {
      return SecureChannelCode.error('AUTH_BAD_SIGNING_KEY', `Signing key must be 32 bytes`);
    }
    const signature = FourQ.sign(payloadBuffer, signingKeyBuffer);
    return ok({
      payload: payloadBuffer.toString('base64'),
      sig: signature.data.toString('base64')
    });
  }
  static verifyStamp(sigData: AuthSignatureData, publicKey: string | Buffer): Result<boolean> {
    if (!sigData) { return SecureChannelCode.error('AUTH_NO_SIG_DATA_OBJECT', 'No signature data object'); }
    if (!publicKey) { return SecureChannelCode.error('AUTH_NO_PUBLIC_KEY', 'No public key'); }
    if (!sigData.sig) { return SecureChannelCode.error('AUTH_NO_SIG_DATA', 'No signature'); }
    if (!sigData.payload) { return SecureChannelCode.error('AUTH_NO_SIG_PAYLOAD', 'No signed message'); }
    const publicKeyBuffer = typeof publicKey === 'string' ? Buffer.from(publicKey, 'base64') : publicKey;
    if (!publicKeyBuffer || publicKeyBuffer.length !== 32) {
      return SecureChannelCode.error('AUTH_BAD_PUBLIC_KEY', 'Public key must be 32 bytes');
    }
    const sigBuffer = Buffer.from(sigData.sig, 'base64');
    if (!sigBuffer || sigBuffer.length !== 64) {
      return SecureChannelCode.error('AUTH_BAD_SIG_DATA', 'Signature must be 64 bytes');
    }
    const payloadBuffer = Buffer.from(sigData.payload, 'base64');
    if (!payloadBuffer) {
      return SecureChannelCode.error('AUTH_BAD_SIG_PAYLOAD', 'Malformed payload; base64 decode failed');
    }
    const valid = FourQ.verify(sigBuffer, payloadBuffer, publicKeyBuffer);
    return ok(valid);
  }
}

export class SecureChannel {

  type: SecureChannelTypes;
  channelId: string;
  channelIdLength: number;
  peerInfo: SecureChannelPeer = { ecdhPublicKey: null };
  signing: AuthSigning = null;
  localKeyPair: DiffieHellmanKeyPair;
  sharedSecret: Buffer = null;
  expires: number = 0;
  pregeneratedNonce: Buffer;
  lastActive: number;

  constructor(
    type?: SecureChannelTypes,
    channelId?: string,
    peerInfo?: SecureChannelPeer,
    localKeypair?: DiffieHellmanKeyPair,
    signing?: AuthSigning
  ) {
    this.type = type ? type : SecureChannelTypes.DEFAULT;
    this.channelId = !channelId || channelId === 'generate' ? FourQ.randomBytes(16).toString('base64') : channelId;
    this.channelIdLength = this.channelId.length;
    this.signing = signing;
    if (this.signing && this.signing.private && !this.signing.public) {
      this.signing.public = FourQ.ecdhGenerateFromSeed(Buffer.from(this.signing.private, 'base64')).publicKey.toString('base64');
    }
    this.refreshNonce();
    if (peerInfo) { this.fromPeerPublicKey(peerInfo, localKeypair); }
    this.lastActive = Date.now();
  }

  fromPeerPublicKey(peerInfo: SecureChannelPeer, localKeypair?: DiffieHellmanKeyPair) {
    this.peerInfo = peerInfo; // Buffer.from(peerPubKeyB64, 'base64');
    this.localKeyPair = localKeypair ? localKeypair : FourQ.ecdhGenerateKeyPair();
    if (this.peerInfo.ecdhPublicKey.length === 32) {
      this.sharedSecret = FourQ.getSharedSecret(this.localKeyPair.secretKey, this.peerInfo.ecdhPublicKey);
    }
    return this;
  }

  getSecureChannelResponse(extraInfo?: SecureChannelResponseExtraInfo): Result<SecureChannelResponse> {
    const sigResult = SecureHandshake.signStamp(this.signing.private);
    if (sigResult.bad) { return passthru(sigResult); }
    return ok({
      ...sigResult.data,
      channelId: this.channelId,
      ecdhPublicKey: this.localKeyPair.publicKey.toString('base64'),
      signaturePublicKey: this.signing.public,
      extra: extraInfo,
    } as SecureChannelResponse);
  }

  refreshNonce() {
    this.pregeneratedNonce = FourQ.randomBytes(32);
  }

  fromJSONObject(src: any) {
    this.type = src.type;
    this.channelId = src.channelId;
    this.peerInfo = {
      ecdhPublicKey: src.peerPublicKeyB64 ? Buffer.from(src.peerPublicKeyB64, 'base64') : null,
      signaturePublicKey: src.peerSignaturePublicKeyB64 ? Buffer.from(src.peerSignaturePublicKeyB64, 'base64') : null,
      iden: src.peerIden,
      data: src.peerData,
    };
    this.localKeyPair = {
      isDH: true,
      type: CryptoScheme.FourQ,
      publicKey: src.localKeyPairPublicKeyB64 ? Buffer.from(src.localKeyPairPublicKeyB64, 'base64') : null,
      secretKey: src.localKeyPairPublicKeyB64 ? Buffer.from(src.localKeyPairSecretKeyB64, 'base64') : null,
    };
    if (src.sharedSecretB64) {
      this.sharedSecret = Buffer.from(src.sharedSecretB64, 'base64');
    } else {
      this.fromPeerPublicKey(this.peerInfo, this.localKeyPair.publicKey ? this.localKeyPair : null);
    }
    this.expires = src.expires;
    return this;
  }

  toJSON() {
    return JSON.stringify({
      type: this.type,
      channelId: this.channelId,
      peerIden: this.peerInfo.iden,
      peerData: this.peerInfo.data,
      peerPublicKeyB64: this.peerInfo.ecdhPublicKey ? this.peerInfo.ecdhPublicKey.toString('base64') : null,
      peerSignaturePublicKeyB64: this.peerInfo.signaturePublicKey ? this.peerInfo.signaturePublicKey.toString('base64') : null,
      localKeyPairPublicKeyB64: this.localKeyPair ? this.localKeyPair.publicKey.toString('base64') : null,
      localKeyPairSecretKeyB64: this.localKeyPair ? this.localKeyPair.secretKey.toString('base64') : null,
      sharedSecretB64: this.sharedSecret ? this.sharedSecret.toString('base64') : null,
      expires: this.expires,
    });
  }

  createTcpPayload(payload: Buffer) {
    const sharedKey64Bytes = Buffer.concat([this.pregeneratedNonce, this.sharedSecret]);
    const keyHash = crypto.createHash('sha512').update(sharedKey64Bytes).digest();
    const payloadLength = 4 + 32 + payload.length;
    const lengthBytes = SecureHandshake.getLengthBytesUInt32LE(payloadLength);
    const tcpPayload = Buffer.concat([lengthBytes, this.pregeneratedNonce, FourQ.xorCryptSHA512(keyHash, payload)]);
    // const tcpPayload = Buffer.concat([lengthBytes, this.pregeneratedNonce, payload]);
    this.refreshNonce();
    return tcpPayload;
  }

  decryptTcpPayload(tcpPayload: Buffer) {
    const nonce = tcpPayload.slice(4, 36);
    const encryptedPayload = tcpPayload.slice(36);
    return this.decryptPayload(encryptedPayload, nonce);
  }

  createWrappedPayloadFromBuffer(payload: Buffer) {
    this.lastActive = Date.now();
    const sharedKey64Bytes = Buffer.concat([this.pregeneratedNonce, this.sharedSecret]);
    const keyHash = crypto.createHash('sha512').update(sharedKey64Bytes).digest();
    const wrapped: SecureChannelPayload = {
      __scp: true,
      c: this.channelId,
      n: this.pregeneratedNonce.toString('base64'),
      p: FourQ.xorCryptSHA512(keyHash, payload).toString('base64'),
    };
    this.refreshNonce();
    return wrapped;
  }

  createWrappedPayload(payload: string | Buffer) {
    if (typeof payload === 'string') {
      return this.createWrappedPayloadFromBuffer(Buffer.from(payload, 'utf8'));
    } else {
      return this.createWrappedPayloadFromBuffer(payload);
    }
  }

  createWrappedPayloadObject(obj: any) {
    return this.createWrappedPayloadFromBuffer(Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  createWrappedPayloadString(obj: any) {
    return JSON.stringify(this.createWrappedPayloadObject(obj));
  }

  createWrappedPayloadBase64(obj: any) {
    return Buffer.from(this.createWrappedPayloadString(obj), 'utf8').toString('base64');
  }

  decryptPayload(payloadBytes: Buffer, nonce: Buffer) {
    this.lastActive = Date.now();
    const sharedKey64Bytes = Buffer.concat([nonce, this.sharedSecret]);
    const keyHash = crypto.createHash('sha512').update(sharedKey64Bytes).digest();
    return FourQ.xorCryptSHA512(keyHash, payloadBytes);
  }

  decryptSecureChannelPayloadObject(wrapped: SecureChannelPayload, outputEncoding = 'utf8') {
    const nonce = Buffer.from(wrapped.n, 'base64');
    const payloadEnc = Buffer.from(wrapped.p, 'base64');
    const decoded = this.decryptPayload(payloadEnc, nonce);
    switch (outputEncoding) {
      case 'utf8': {
        return decoded.toString('utf8');
      }
      default: {
        return decoded;
      }
    }
  }

  decryptSecureChannelPayload(wrapped: SecureChannelPayload) {
    return this.decryptSecureChannelPayloadObject(wrapped) as Buffer;
  }

  decryptSecureChannelPayloadIntoString(wrapped: SecureChannelPayload) {
    return this.decryptSecureChannelPayloadObject(wrapped, 'utf8') as string;
  }

  decryptPayloadBase64(payloadStrB64: string) {
    const payload = this.parseWrappedPayloadString(Buffer.from(payloadStrB64, 'base64').toString('utf8'));
    return this.parseSecureChannelPayloadIntoObject(payload);
  }

  parseSecureChannelPayloadIntoObject(wrapped: SecureChannelPayload) {
    return JSON.parse(this.decryptSecureChannelPayloadIntoString(wrapped));
  }

  parseWrappedPayloadString(payloadStr: string) {
    return JSON.parse(payloadStr) as SecureChannelPayload;
  }

  parseWrappedPayloadBase64(payloadStrB64: string) {
    return this.parseWrappedPayloadString(Buffer.from(payloadStrB64, 'base64').toString('utf8'));
  }

}

export function saltedXorCrypt(payload: Buffer, secret: Buffer, ...salts: Buffer[]) {
  return FourQ.xorCryptSHA512(saltedSha512(secret, ...salts), payload);
}

export function saltedSha512(message: Buffer, ...salts: Buffer[]) {
  const sharedKey64Bytes = Buffer.concat([...salts, message]);
  return crypto.createHash('sha512').update(sharedKey64Bytes).digest() as Buffer;
}

export function saltedDomainSha512(message: Buffer, domain: Buffer, ...salts: Buffer[]) {
  const sharedKey64Bytes = Buffer.concat([domain, verticalBarBuffer, ...salts, verticalBarBuffer, message]);
  return crypto.createHash('sha512').update(sharedKey64Bytes).digest() as Buffer;
}

export function randHex(length: number) {
  const characters = '0123456789abcdef';
  const str = [];
  for (let i = 0; i < length; ++i) {
    str.push(characters[Math.floor(Math.random() * 16)]);
  }
  return str.join('');
}

export async function initiateSecureChannel(initiatorFlow: SecureChannelInitFlow): Promise<Result<SecureChannel>> {
  const ecdhKeypair = FourQ.ecdhGenerateKeyPair();
  const channelMyPubkey = ecdhKeypair.publicKey.toString('base64');
  const user = initiatorFlow.user ? initiatorFlow.user : 'user';
  let token: string;
  try {
    token = await resolveEntry('token', initiatorFlow.token);
  } catch (e) { return SecureChannelCode.error('CONTACT_INITIATION_TOKEN_NOT_FOUND', e); }
  const authHeader = SecureHandshake.getAccessorHeader(user, channelMyPubkey, token, initiatorFlow.signing, initiatorFlow.expire);
  let initiateContactResult: Result<SecureChannelResponse>;
  try {
    initiateContactResult = await initiatorFlow.initiateContact(authHeader.data);
  } catch (e) { return SecureChannelCode.error('CONTACT_INITIATION_FAILURE', e); }
  if (initiateContactResult.bad) {
    return SecureChannelCode.error('CONTACT_INITIATION_BAD_RESULT', initiateContactResult.error);
  }
  const response = initiateContactResult.data;
  if (!response) { return SecureChannelCode.error('CONTACT_INITIATION_NULL_RESPONSE'); }
  if (!response.channelId || !response.channelId.length || response.channelId.length > 128) {
    return SecureChannelCode.error('BAD_CHANNEL_ID_CLIENT', response.channelId);
  }
  let trusted = await resolveEntry('trust', initiatorFlow.trust);
  if (!trusted) { trusted = await resolveEntry('trust', initiatorFlow.trust, response.signaturePublicKey);}
  if (trusted) {
    if (trusted.publicKey !== response.signaturePublicKey) {
      return SecureChannelCode.error('TRUSTED_PEER_MISMATCH_CLIENT', 
              `Peer with public key '${response.signaturePublicKey}' is not found on trust list.`);
    }
    const valid = SecureHandshake.verifyStamp(response, response.signaturePublicKey);
    if (!valid) { return SecureChannelCode.error('TRUST_STAMP_VERIFICACTION_FAILURE_CLIENT'); }
  }
  const peerInfo: SecureChannelPeer = {
    ecdhPublicKey: Buffer.from(response.ecdhPublicKey, 'base64'),
    signaturePublicKey: Buffer.from(response.signaturePublicKey, 'base64'),
  };
  const channel = new SecureChannel(SecureChannelTypes.ECC_4Q, initiatorFlow.channelId, peerInfo, ecdhKeypair, initiatorFlow.signing);
  return ok(channel);
}

export async function answerSecureChannel(answererFlow: SecureChannelAnswerFlow): Promise<Result<SecureChannel>> {
  const timeWindow = answererFlow.timeWindow ? answererFlow.timeWindow : 5000;
  const ecdhKeypair = FourQ.ecdhGenerateKeyPair();
  const authInfo = SecureHandshake.parseAuthHeader(answererFlow.authHeader);
  const token = await resolveEntry('token', answererFlow.token);
  const accessData = SecureHandshake.verifyAccessor(authInfo.accessorExpression, token, timeWindow);
  if (accessData.bad) { return passthru(accessData); }
  if (answererFlow.trust) {
    const trusted = await resolveEntry('trust', answererFlow.trust, authInfo.peerSignaturePublicKey);
    if (!trusted) {
      return SecureChannelCode.error('TRUSTED_PEER_MISMATCH_SERVER',
                  `Peer with public key '${authInfo.peerSignaturePublicKey}' is not found on trust list.`);
    }
    if (!SecureHandshake.verifyAuthHeaderSignature(authInfo)) {
      return SecureChannelCode.error('TRUST_STAMP_VERIFICACTION_FAILURE_SERVER');
    }
  }
  const peerEcdhPublicKey = Buffer.from(authInfo.peerEcdhPublicKey, 'base64');
  const peerInfo: SecureChannelPeer = { ecdhPublicKey: peerEcdhPublicKey, signaturePublicKey: Buffer.from(authInfo.peerSignaturePublicKey, 'base64') };
  const channel = new SecureChannel(SecureChannelTypes.ECC_4Q, answererFlow.channelId, peerInfo, ecdhKeypair, answererFlow.signing);
  return ok(channel);
}

function getLengthFromBytesOfHashContent(chunk: string, front = '') {
  const lengthBytes = front ? chunk.split(`${front} `)[1].substring(0, 4) : chunk.substring(0, 4);
  let headerLength;
  if (lengthBytes === '!!!!') {
    headerLength = 0;
  } else {
    const lengthBuffer = Buffer.from(lengthBytes, 'base64');
    headerLength = lengthBuffer[0] * 65536 + lengthBuffer[1] * 256 + lengthBuffer[2];
  }
  return headerLength;
}
