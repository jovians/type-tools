import { PromUtil } from "../../src";
import { globalRoot } from "../../src/common/env/env.profile";

export type ProcessExitType = (
  `exit` | `SIGINT` | `SIGUSR1` | `SIGUSR2` | `uncaughtException` | `SIGTERM` | `graceful`
)
const processExitHandler = {
  allExitEvents: [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`] as ProcessExitType[],
  handlers: [] as { handler: (eventType: ProcessExitType) => any; source: Error }[],
  exiting: false,
  gracefulExitPromises: [] as Promise<any>[],
  defaultGracePeriod: 7000,
  addEndingTask: (taskPromise: Promise<any>) => { processExitHandler.gracefulExitPromises.push(taskPromise); },
  gracefully: (exitCode: number = 0, gracePeriod: number = processExitHandler.defaultGracePeriod, lastCallback?: () => any) => {
    if (!gracePeriod) { gracePeriod = processExitHandler.defaultGracePeriod; }
    if (processExitHandler.exiting) { return false; }
    processExitHandler.exiting = true;
    for (const handlerData of processExitHandler.handlers) {
      try { handlerData.handler(`graceful`); } catch (e) { console.error(e); }
    }
    PromUtil.allSettled(processExitHandler.gracefulExitPromises).finally(() => {
      if (lastCallback) { lastCallback(); }
      setTimeout(() => { process.exit(exitCode); }, 100);
    });
    setTimeout(() => {
      if (lastCallback) { lastCallback(); }
      setTimeout(() => { process.exit(exitCode); }, 100);
    }, gracePeriod);
    return true;
  },
  addHandler: (handler: (eventType: ProcessExitType) => any) => {
    processExitHandler.handlers.push({ handler, source: new Error });
    processExitHandler.allExitEvents.forEach(eventType => {
      const bound = handler.bind(null, eventType);
      process.on(eventType, () => {
        try { bound(); } catch (e) { console.error(e); }
      });
    });
  }
}

if (!globalRoot.ProcessExitHandler) { globalRoot.ProcessExitHandler = processExitHandler; }

export const ProcessExit = new Proxy(globalRoot.ProcessExitHandler as typeof processExitHandler, {});
