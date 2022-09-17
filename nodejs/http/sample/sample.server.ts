/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import { toBe } from '../../../src/common/globals.ix';
import { SecureChannelTypes } from '../../../src/common/security/security.common';
import { getDestorClient } from '../destor/destor.client';
import { HttpServerShim, HTTP, HttpBaseLib, HttpOp, ReqProcessor } from '../http.shim';

const scopeName = `authsrv;pid=${process.pid}`;

const roles = {
  ADMIN: 1,
  // ADDDDDDD: 2,
};

export class SampleServer extends HttpServerShim<typeof roles> {

  constructor() {
    super({
      name: 'sample-server',
      type: HttpBaseLib.EXPRESS,
      scopeName,
      security: {
        accessor: { required: false, baseToken: '<secret.sampleServer.default.token>' },
        secureChannel: { enabled: true, required: false, encryption: SecureChannelTypes.ECC_4Q, signingKey: '<secret.sampleServer.default.signingKey>' },
      },
      startOptions: { port: toBe`<secret.sampleServer.default.port ?: number:17082>` },
    });
    this.apiVersion = 'v1';
    this.apiPath = this.configGlobal.api.basePath;
    this.addDefaultProcessor(ReqProcessor.BASIC, ReqProcessor.AUTH);
  }

  test() {}

  @HTTP.GET(`/terminal-in`)
  @HTTP.ACCESS({ ADMIN: 1 })
  terminalIn(op: HttpOp) {
    op.res.returnJson({ data: op.req.data, params: op.req.params, headers: op.req.headers });
  }

}
