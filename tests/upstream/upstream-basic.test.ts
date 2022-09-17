import { echo } from 'lugger/ritz.default';
import { testDefine } from 'ritz2';
import { msleep } from 'ritz2/ritz.default';
import { UpstreamDatastoreMongo } from '../../nodejs/upstream/mongodb/mongodb';
import { push, Upstream } from '../../src';
import { TestClass } from './upstream.odm';

const localMongoDsConfig = {
  path: 'local', 
  endpoint: {
    type: 'mongo',
    endpoint: 'localhost',
    credentials: { endpoint: 'localhost:27017' },
  },
};

testDefine({ runAlone: true }, `Upstream should honor sparse index with null`); {
  Upstream.forTest.purge();
  Upstream.add(new UpstreamDatastoreMongo(localMongoDsConfig));
  Upstream.admin(TestClass).dropCollection();
  Upstream.admin(TestClass).recreateIndexes();
  push(new TestClass);
  push(new TestClass);
  msleep (1);
}
