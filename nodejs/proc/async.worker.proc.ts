/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */
import { ChildProcess, spawn, execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { Class, ix, promise } from '../../index';
import * as os from 'os';
import { ProcessExit } from './process.exit.handler';

export type AsyncActionHandler = (payload: string, worker?: AsyncWorkerExecutor,
                                  callId?: string, action?: string) => (string | Promise<string>);
export interface AsyncActionHandlers {
  [actionName: string]: AsyncActionHandler;
}

export interface AsyncWorkerConfig {
  workerFile?: string;
  additionalEnv?: {[env: string]: string};
  disregardParentEnv?: boolean;
  nodeCommand?: string;
}

export class AsyncWorkerClient extends ix.Entity {
  static nodeArgsDefault: string[] = [
    '--enable-source-maps',
    '--max-old-space-size=262144',
  ];
  static nodeArgsActive: string[] = AsyncWorkerClient.nodeArgsDefault;
  static nullAction() {}
  workerData: any;
  proc: ChildProcess;
  responseFor = '';
  handlerMap: {[name: string]: (msg: string, name: string) => any} = {};
  invokeMap: {[callId: string]: (msg: string) => any} = {};
  initPromise: Promise<void> = null;
  initResolver: any;
  terminating = false;
  terminationResolver: () => any = null;
  terminated = false;
  duration = null;
  startTime = Date.now();
  endTime: number = null;
  onterminate: (() => any)[] = [];
  constructor(workerData: any, workerConfig: AsyncWorkerConfig) {
    super('async-worker-client');
    if (!workerData) { workerData = {}; }
    this.initPromise = new Promise<void>(resolve => { this.initResolver = resolve; });
    workerData.workerFile = workerConfig.workerFile;
    workerData.workerConfig = JSON.parse(JSON.stringify(workerConfig));
    this.workerData = workerData;
    const nodeFlags: string[] = workerData.nodeFlags ? workerData.nodeFlags : [];
    const callArgs = AsyncWorkerClient.nodeArgsActive.concat(nodeFlags, [workerConfig.workerFile]);
    const envArg: {[envVar: string]: string} = workerConfig.disregardParentEnv ? {} : {...process.env};
    if (workerConfig.additionalEnv) { Object.assign(envArg, workerConfig.additionalEnv); }
    envArg.WORKER_DATA_BASE64 = Buffer.from(JSON.stringify(workerData), 'utf8').toString('base64');
    const nodeCommand = workerConfig.nodeCommand ? workerConfig.nodeCommand : 'node';
    this.proc = spawn(nodeCommand, callArgs, {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: envArg,
    });
    this.addDefaultHandlers();
    this.proc.on('message', messageSerial => {
      const message = messageSerial as string;
      if (this.responseFor) {
        this.handleResponse(this.responseFor, message);
      } else {
        this.responseFor = message;
      }
    });
  }

  call<T = string, R = T>(action: string, payload: string = '', parser?: (response: string) => R) {
    const callId = `${action}::${uuidv4()}`;
    return new Promise<R>(async resolve => {
      if (this.terminating || this.terminated) { return resolve(null); }
      if (!payload) { payload = ''; }
      if (!parser) { parser = response => response as unknown as R; }
      await Promise.resolve(this.initPromise);
      this.invokeMap[callId] = response => {
        try {
          if (typeof response === 'string' && response.startsWith('$')) {
            switch (response) { 
              case '$__unhandled_action':
                console.warn(new Error(`Worker[${this.workerData.file}] with unhandled call request. action=${action}, callId=${callId}`));
                resolve(null);
              default: resolve(null);
            }
          }
          if (response === '' || response === null) {
            resolve(null);
          } else {
            try {
              const res = parser(response);
              resolve(res !== null ? res : null);
            } catch (e) {
              resolve(null);
            }
          }
        } catch (e) { resolve(null); }
      };
      this.proc.send(callId);
      this.proc.send(payload);
    });
  }

  import(scriptFile: string) {
    return this.call<boolean>(`$__import`, scriptFile, r => r ? true : false);
  }

  terminate(exitCode: number = 0) {
    this.call('$__terminate', exitCode + '');
    return promise(async resolve => {
      this.terminationResolver = resolve;
    });
  }

  setDefaultHandler(name: string, handler: (message: string, name: string) => any) {
    if (!name.startsWith('$')) {
      throw new Error(`Default handler name must start with $`);
    }
    this.handlerMap[name] = handler;
  }

  handleResponse(callId: string, message: string) {
    this.responseFor = '';
    if (callId.startsWith('$')) {
      const hcb = this.handlerMap[callId];
      if (hcb) {
        hcb(message, callId);
        delete this.invokeMap[callId];
      } else {
        console.warn(new Error(`Worker[${this.workerData.file}] unknown callId=${callId}`));
      }
      return;
    }
    const cb = this.invokeMap[callId];
    if (cb) { cb(message); delete this.invokeMap[callId]; }
  }

  private addDefaultHandlers() {
    this.setDefaultHandler('$__init', (message, name) => {
      if (this.initResolver) { this.initResolver(); }
      this.initResolver = this.initPromise = null;
    });
    this.setDefaultHandler('$__termination_set', (message, name) => {
      this.terminating = true;
      for (const cb2 of this.onterminate) { try { cb2(); } catch (e) {} }
    });
    this.setDefaultHandler('$__terminated', (message, name) => {
      this.terminated = true;
      this.endTime = Date.now();
      this.duration = this.endTime - this.startTime;
      if (this.terminationResolver) { this.terminationResolver(); }
    });
  }

}

export class AsyncWorkerExecutor extends ix.Entity {
  terminating = false;
  terminated = false;
  mainScope: ix.MajorScope;
  workerData: any;
  data: {[key: string]: any} = {};
  requestFor = '';
  invokeMap: {[callId: string]: (msg: string) => any} = {};
  customAction: {[actionName: string]: AsyncActionHandler} = {};
  constructor(workerData: any) {
    super('async-worker-logic');
    process.on('unhandledRejection', e => {
      // tslint:disable-next-line: no-console
      console.warn('[WARNING] UnhandledRejection:', e);
    });
    this.workerData = workerData;
    process.on('message', async messageSerial => {
      const message = messageSerial as string;
      if (this.requestFor) {
        this.handleRequest(this.requestFor, message);
      } else {
        this.requestFor = message;
      }
    });
    const scope = workerData.scopeName ? workerData.scopeName : 'unnamed_scope';
    this.mainScope = new ix.MajorScope(scope + `(${process.pid})`);
    if (workerData.coreAffinity !== null && workerData.coreAffinity !== undefined) {
      let core = workerData.coreAffinity;
      if (core === 'auto' && workerData.workerId !== null && workerData.workerId !== undefined) {
        core = (workerData.workerId % os.cpus().length) + '';
      }
      if (process.platform === 'linux') {
        execSync(`taskset -cp ${core} ${process.pid}`, {stdio: 'inherit'});
      }
    }
  }
  getSelf() { return this; }
  setAsReady() { this.returnCall('$__init'); }
  returnCall(callId: string, response?: string) {
    if (!response) { response = ''; }
    if (this.terminated) { return; }
    if (this.terminating && !callId.startsWith('$__termin')) { return; }
    process.send(callId);
    process.send(response);
    return true;
  }
  addCustomAction(actionName: string, handler: AsyncActionHandler) {
    this.customAction[actionName] = handler;
  }
  async handleRequest(callId: string, payload?: string) {
    this.requestFor = '';
    const action = callId.split('::')[0];
    switch (action) {
      case '$__terminate': {
        if (this.terminating) { break; }
        this.terminating = true;
        const exitCode = payload ? parseInt(payload, 10) : 0;
        ProcessExit.addEndingTask(this.ontermination());
        setTimeout(() => {
          ProcessExit.gracefully(exitCode, 1000, () => {
            this.returnCall('$__terminated');
            this.terminated = true;
          });
        }, 10);
        return this.returnCall('$__termination_set');
      }
      case '$__import': {
        try {
          const module = require(payload);
          if (module.workerExtension) {
            for (const actionName of Object.keys(module.workerExtension)) {
              this.addCustomAction(actionName, module.workerExtension[actionName]);
            }
          }
        } catch (e) {}
        return this.returnCall(callId, `$__import(${payload})`);
      }
    }
    const handleResultProm = this.handleAction(callId, action, payload);
    if (!handleResultProm) {
      return this.returnCall(callId, '$__unhandled_action');
    }
    const res = await handleResultProm;
    if (res) { return res; }
    if (!res && this.customAction[action]) {
      let resStr = await Promise.resolve(this.customAction[action](payload, this, callId, action));
      if (!resStr) { resStr = ''; }
      return this.returnCall(callId, resStr);
    }
    console.warn(new Error(`Worker[${this.workerData.workerFile.split('/').pop()}] with unhandled call request. action=${action}, callId=${callId}`));
  }
  async handleAction(callId: string, action: string, payload?: string): Promise<any> {}
  async ontermination() {}
}

export function startWorker(workerFile: string, logic: Class<AsyncWorkerExecutor>) {
  if (process.env.WORKER_DATA_BASE64) {
    const workerData = JSON.parse(Buffer.from(process.env.WORKER_DATA_BASE64, 'base64').toString('utf8'));
    if (workerData.workerFile === workerFile) {
      return new logic(workerData).getSelf();
    }
  }
  return false;
}

export interface AsyncWorkerFleet<T extends AsyncWorkerClient> {
  workers: T[];
}

export function workerFleetAddMember<T extends AsyncWorkerClient>(fleet: AsyncWorkerFleet<T>, workerClass: Class<T>, workerData?: {[key: string]: any; }) {
  if (!workerData) { workerData = {}; }
  const worker = new workerClass(workerData);
  fleet.workers.push(worker);
  return worker;
}
