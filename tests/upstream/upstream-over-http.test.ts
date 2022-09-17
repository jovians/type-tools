import { testDefine } from 'ritz2';
import { msleep } from 'ritz2/ritz.default';
import { echo } from 'lugger/ritz.default';
import { UpstreamDatastoreMongoOverHttp } from '../../nodejs/upstream/mongodb/mongodb-over-http';
import { push, Upstream, UpstreamDatastoreConfig, UpstreamHttpDatastore, UpstreamHttpDatastoreCredentials } from '../../src';
import { TestClass } from './upstream.odm';

const httpMongoDsConfig: UpstreamDatastoreConfig<UpstreamHttpDatastoreCredentials> = {
  path: 'local', 
  endpoint: {
    type: 'http',
    endpoint: `http://localhost:${UpstreamDatastoreMongoOverHttp.defaultPort}/api/v1`,
    credentials: { authHeaders: {} },
  },
};

testDefine({ runAlone: true }, `Upstream should honor sparse index with null over http`); {
  Upstream.forTest.purge();
  const server = new UpstreamDatastoreMongoOverHttp();
  server.start();
  Upstream.add(new UpstreamHttpDatastore(httpMongoDsConfig));
  Upstream.admin(TestClass).dropCollection();
  Upstream.admin(TestClass).recreateIndexes();
  const a = new TestClass;
  const b = new TestClass;
  push(a);
  push(b);
  a.prop1 = 'test1';
  b.prop1 = 'test1';
  msleep (1000);
}
