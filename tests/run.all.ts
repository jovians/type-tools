import { ProcessExit } from '../nodejs';
import { AuthServer, DestorServer } from '../nodejs';
import { ClassSettings, Upstream } from '../src';
import { DESTOR } from '../src/common/env/env.destor';
import { TestConfig } from 'ritz2';
import * as creds from './test.secrets.json';
import './upstream/upstream-basic.test';
import './upstream/upstream-over-http.test';

// ClassSettings.set(() => { Upstream.showOperationErrors = true; });

TestConfig.prepareBeforeAnyTest(async () => {
  process.env.DESTOR_SERVER_CONFIG_FILE = 'tests/destor.properties';
  process.env.DESTOR_SERVER_BASE_TOKEN = creds.baseToken;
  process.env.DESTOR_SERVER_SIGNING_KEY = creds.fourq.privateKey;
  const destor = new DestorServer();
  await destor.start();
  
  DESTOR.LIST = [
    { url: 'http://localhost:17070', token: creds.baseToken,
    trust: { type: 'ECC_4Q', publicKey: creds.fourq.publicKey } },
  ];
  
  process.env.AUTH_SERVER_CONFIG_FILE = 'tests/auth.properties';
  process.env.AUTH_SERVER_APP_PROFILE = 'test';
  const authServer = new AuthServer();
  await authServer.start();

  process.env.UPSTREAM_MONGO_HTTP_SERVER_KEY = 'upstreamHttpServer';
});
