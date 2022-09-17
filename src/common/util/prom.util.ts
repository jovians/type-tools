/* Jovian (c) 2020, License: MIT */
export class Promise2<T = any> implements Promise<T> {
  pending: boolean;
  value: T;
  error: Error;
  get [Symbol.toStringTag]() { return `Promise`; }
  constructor(
    executor: (resolve: (value?: T) => any, reject: (error?: Error) => any) => any,
    onFinalize?: (e?: Error, value?: T) => any) {
    let pending: boolean = false;
    let error: Error;
    let value: T;
    const prom: any = (this as any)._original_promise = new Promise<T>((resolve, reject) => {
      const resolveWrapper = (r?) => {
        if (prom) { prom.pending = false; prom.value = r; }
        pending = false; value = r;
        let onFinalizeProm: Promise<any>;
        if (onFinalize) {
          try { onFinalizeProm = onFinalize(null, r); } catch (e2) { console.error(e2); }
        }
        if (onFinalizeProm?.then) {
          onFinalizeProm.catch(e3 => console.error(e3)).finally(() => resolve(r));
        } else {
          resolve(r);
        }
      };
      const rejectWrapper = (e) => {
        if (!e) { e = new Error(`Unnamed reject`); }
        if (prom) { prom.pending = false; prom.error = e; }
        pending = false; error = e;
        let onFinalizeProm: Promise<any>;
        if (onFinalize) {
          try { onFinalizeProm = onFinalize(e, null); } catch (e2) { console.error(e2); }
        }
        if (onFinalizeProm?.then) {
          onFinalizeProm.catch(e3 => console.error(e3)).finally(() => reject(e));
        } else {
          reject(e);
        }
      };
      try {
        const res = executor(
          resolveWrapper,
          rejectWrapper,
        );
        if (res && res.then) { res.catch(e2 => rejectWrapper(e2)); }
      } catch (e) {
        rejectWrapper(e);
      }
    });
    if (!pending) {
      prom.pending = pending;
      prom.value = value;
      if (error) { prom.error = error; }
    } else {
      prom.pending = true;
    }
    return prom as any;
  }
  then<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
    return null as any;
  }
  catch<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<T | TResult> {
    return null as any;
  }
  finally(onfinally?: () => void): Promise<T> {
    return null as any;
  }
}

export function promise<T = any>(
  executor: (resolve: (value?: T) => any, reject: (error?: Error) => any) => any,
  onFinalize?: (e?: Error, value?: T) => any
): Promise2<T> {
  return new Promise2<T>(executor, onFinalize);
}

export namespace PromUtil {

  export function withFinalizer<T = any>(promise: Promise<T>,
                                         finalizer: (result: T | Error, isError?: boolean, index?: number | string) => any,
                                         index?: number | string) {
    promise.then(r => finalizer(r, false, index)).catch(e => finalizer(e, true, index));
    return promise;
  }

  export function allSettled<T = any>(
      promises: Promise<T>[],
      onIndividualFinish?: <T>(result: T | Error, isError?: boolean, index?: number | string) => any,
  ) {
    return new Promise<(T | Error)[]>(resolve => {
      const results: (T | Error)[] = [];
      if (promises.length === 0) { return resolve(results); }
      (results as any)._onIndividualFinishErrors = [];
      results.length = promises.length;
      let handledCount = 0;
      const finalizer = (result: T | Error, isError?: boolean, i?: number | string) => {
        results[i] = result;
        ++handledCount;
        if (onIndividualFinish) {
          try {
            onIndividualFinish(result, isError, i);
          } catch (e) {
            (results as any)._onIndividualFinishErrors.push(e);
          }
        }
        if (handledCount >= promises.length) { resolve(results); }
      };
      for (let i = 0; i < promises.length; ++i) { withFinalizer(promises[i], finalizer, i); }
    });
  }

  export interface PromiseResult<T> {
    data: T;
    error: Error;
  }

  export function allAsorted<T = any>(promises: Promise<T>[]) {
    return new Promise<{ results: PromiseResult<T>[]; valids: T[]; errors: Error[]; }>(async resolve => {
      const results: PromiseResult<T>[] = [];
      results.length = promises.length;
      const valids: T[] = [];
      const errors: Error[] = [];
      let handledCount = 0;
      const finalizer = (result: T | Error, isError?: boolean, i?: number | string) => {
        results[i] = {
          data: isError ? null : result as T,
          error: isError ? result as Error : null
        };
        ++handledCount;
        if (handledCount >= promises.length) {
          for (const r of results) {
            if (!r.error) { valids.push(r.data); } else { errors.push(r.error); }
          }
          resolve({ results, valids, errors });
        }
      };
      for (let i = 0; i < promises.length; ++i) { withFinalizer(promises[i], finalizer, i); }
    });
  }

}
