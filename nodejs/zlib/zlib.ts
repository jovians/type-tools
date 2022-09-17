/* Jovian (c) 2020, License: MIT */
declare var zlib: any;
try { zlib = require('zlib'); } catch (e) {}

export namespace ZipUtil {

  export let recentError: Error = null;

  export function zip(input: string) {
    return new Promise<string>(resolve => {
      zlib.deflate(input, (e, b) => {
        if (e) { recentError = e; return resolve(null); }
        resolve(b.toString('base64'));
      });
    });
  }

  export function unzip(input: string) {
    return new Promise<string>(resolve => {
      const inputBuffer = Buffer.from(input, 'base64');
      zlib.unzip(input, (e, b) => {
        if (e) { recentError = e; return resolve(null); }
        resolve(b.toString('utf8'));
      });
    });
  }

}
