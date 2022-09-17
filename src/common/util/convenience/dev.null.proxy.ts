export const proxyParameterFunctionToNull = new Proxy({} as any, {
  get: () => {
    return () => new Promise<any>(resolve => { resolve(null); });
  },
});

export const proxyParameterPromiseToNull = new Proxy({} as any, {
  get: () => {
    return new Promise<any>(resolve => { resolve(null); });
  },
});