/*
 * Copyright 2014-2021 Jovian, all rights reserved.
 */

export class GanymedeLogger {
  info(...args) {
    // tslint:disable-next-line: no-console
    console['log'](...args);
  }
  debug(...args) {
    // tslint:disable-next-line: no-console
    console.debug(...args);
  }
  error(...args) {
    // tslint:disable-next-line: no-console
    console.error(...args);
  }
}

const log = new GanymedeLogger();
export function getDefaultLogger() { return log; }
