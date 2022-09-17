/* Jovian (c) 2020, License: MIT */

export const runtimeLocation = (new Function('try {return this===global;}catch(e){return false;}'))() ?
                                'server' : 'client';

// tslint:disable-next-line: callable-types
interface Class<T> { new (...args): T; }
export const Context = {
  location: 'all' as 'all' | 'client' | 'server',
  online: true,
  onlineUpstream: {} as { [className: string]: { online: boolean; } },
  throwErrors: true,
  trackErrors: true,
  trackCancels: true,
  disabled: false,
  disabledClasses: {} as { [className: string]: Class<any> },
  disabledExtensions: {} as { [extName: string]: Class<any> },
  defineDisabled: false,
  target: null as any,
  current: null as Class<any>,
  beforeDefCurrent: null as Class<any>,
  gettingSkeleton: false,
  gettingSampleInstance: false,
  getter: { ignoredClasses: {} as { [className: string]: Class<any> } },
  setter: { ignoredClasses: {} as { [className: string]: Class<any> } },
  change: { ignoredClasses: {} as { [className: string]: Class<any> } },
  beforeDefinition: {} as { [className: string]: ((inst: any) => any)[] },
  serializeMeta: false,
  validationError: null as Error,
  anyPropertyFailed: false,
  lineageMap: null as (a: any) => {[implementType: string]: Class<any>},
  lineageHas: null as (a: any, type: Class<any>) => boolean,
  cast: null as <T>(a: any, type: Class<T>) => T,
  defineOnUnlock: false,
  throwErrorsForCommonValidations: false,
  beforeSuper: false,
};
