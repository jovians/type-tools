import { AsyncWorkerClient, AsyncWorkerExecutor } from '../nodejs/proc/async.worker.proc';
import { dp } from '../src';

export class TestWorkerClient extends AsyncWorkerClient {
  static workerFile = __filename;
  constructor(workerData: any) { super(workerData, { workerFile: __filename }); }
}

export class TestWorkerLogic extends AsyncWorkerExecutor {
  constructor(workerData: any) {
    super(workerData);
    dp('initialized', __filename);
  }
}

if (process.env.WORKER_DATA_BASE64) {
  const workerData = JSON.parse(Buffer.from(process.env.WORKER_DATA_BASE64, 'base64').toString('utf8'));
  if (workerData.workerFile === __filename) {
    new TestWorkerLogic(workerData).getSelf();
  }
}
