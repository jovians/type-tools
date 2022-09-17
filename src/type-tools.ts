/* Jovian (c) 2020, License: MIT */

import { Context, runtimeLocation } from './context';
import { Class, _ } from './type-transform';
import { typeFullName } from './upstream/common.iface';
import { dp } from './common/util/env.util';

const typeCaches = {};
const stackTraces = {};
const skeletonInstances = {};
const sampleInstances = {};

export const refHead = '$ref';

export class TypeToolsSettings {
  static typeToolsKey = '__type_tools';
  typeToolsKey = TypeToolsSettings.typeToolsKey;
  constructor(init?: Partial<TypeToolsSettings>) {
    if (init) { Object.assign(this, init); }
  }
}

// tslint:disable-next-line: no-empty-interface
export interface TypeToolsExtensionData {}

export interface TypeToolsExtension {
  getExtensionData: (target: any) => TypeToolsExtensionData;
  implementOn: (target: any) => void;
  typeCheck: (target: any) => boolean;
  settings: TypeToolsSettings;
}

export class TypeToolsBase {
  static topError: Error;
  static topCancel: Error;
  static slowResolveContext = false;
  static getExtension(target: any, extensionName: string, settings = TypeToolsSettings) {
    if (!target) {
      if (Context.throwErrors) {
        throw TypeToolsBase.reusedTrace(
          'TypeToolsBase.getExtension',
            `Cannot get TypeToolsBase extension '${extensionName}' from a null target instance.`);
      }
      return null;
    }
    const allExtensions = target[settings.typeToolsKey];
    return allExtensions ? allExtensions[extensionName] : null;
  }
  static isInitialized(target: any, settings = TypeToolsSettings) {
    const allExtensions = target[settings.typeToolsKey];
    return allExtensions ? allExtensions.initialized : null;
  }
  static setInitialized(target: any, value: boolean, settings = TypeToolsSettings) {
    const allExtensions = target[settings.typeToolsKey];
    if (allExtensions) { allExtensions.initialized = value; }
  }
  static typeCheck(target: any, settings = TypeToolsSettings) {
    if (!target) { return false; }
    return target[settings.typeToolsKey] || target['_get_args'] || target['_tt_define'] ? true : false;
  }
  static addExtension(target: any, extensionName: string, extension: any, settings = TypeToolsSettings) {
    let allExtensions = target[settings.typeToolsKey];
    if (!allExtensions) { allExtensions = TypeToolsBase.init(target, settings); }
    allExtensions[extensionName] = extension;
  }
  // TODO removeExtension
  static checkContext(type?: Class<any>) {
    if (Context.location !== 'all' && runtimeLocation !== Context.location) { return false; }
    if (type && Context.disabledExtensions[typeFullName(type)]) { return false; }
    if (!Context.current) {
      throw TypeToolsBase.reusedTrace(
          'TypeToolsBase.checkContext',
            `TypeToolsBase library features must be accessed within 'defineFor' block.`, true);
    }
    return true;
  }
  static getSkeleton<T = any>(type: Class<T>): T {
    const typename = typeFullName(type);
    let inst = skeletonInstances[typename];
    if (!inst) {
      skeletonInstances[typename] = {};
      const gettingSkelPrev = Context.gettingSkeleton;
      Context.gettingSkeleton = true;
      const defineDisabledPrev = Context.defineDisabled;
      try {
        Context.defineDisabled = true;
        inst = skeletonInstances[typename] = new type();
        Object.defineProperty(skeletonInstances[typename], '__tt_keys', { value: Object.keys(skeletonInstances[typename]) });
      } catch (e) {}
      Context.gettingSkeleton = gettingSkelPrev;
      Context.defineDisabled = defineDisabledPrev;
    }
    return inst as T;
  }
  static getSampleInstance<T = any>(type: Class<T>): T {
    const typename = typeFullName(type);
    let inst = sampleInstances[typename];
    if (!inst) {
      sampleInstances[typename] = {};
      const gettingSamplePrev = Context.gettingSampleInstance;
      Context.gettingSampleInstance = true;
      try {
        inst = sampleInstances[typename] = new type();
        Object.defineProperty(sampleInstances[typename], '__tt_keys', { value: Object.keys(sampleInstances[typename]) });
      } catch (e) {
        throw e;
      }
      Context.gettingSampleInstance = gettingSamplePrev;
    }
    return inst as T;
  }
  static typeCacheSet(type: Class<any>, key: string, value?: any) {
    const typename = typeFullName(type);
    let inst = typeCaches[typename];
    if (!inst) { inst = typeCaches[typename] = {}; }
    inst[key] = value;
  }
  static typeCacheGet(type: Class<any>, key: string) {
    const typename = typeFullName(type);
    let inst = typeCaches[typename];
    if (!inst) { inst = typeCaches[typename] = {}; }
    return inst[key];
  }
  static memberTrackParent(member: any, parent: any, override = false) {
    if (!member) { return; }
    if (typeof member === 'object') {
      const tp = member[TypeToolsSettings.typeToolsKey];
      if (tp) {
        if (tp.parent) {
          if (override) { tp.parent = parent; }
          return;
        } else {
          tp.parent = parent;
        }
      } else if (!tp) {
        for (const key of Object.keys(member)) {
          if (member[key]) { TypeToolsBase.memberTrackParent(member[key], parent, override); }
        }
      }
    } else if (Array.isArray(member)) {
      for (const member2 of member) {
        TypeToolsBase.memberTrackParent(member2, parent, override);
      }
    }
  }
  static init(target: any, settings = TypeToolsSettings) {
    if (!target[settings.typeToolsKey]) {
      Object.defineProperty(target, settings.typeToolsKey, { value: {} });
    }
    return target[settings.typeToolsKey];
  }
  static reusedTrace(locationName: string, message?: string, isStatic = false): Error {
    if (!message) { message = ''; }
    let trace: Error = stackTraces[locationName];
    if (!trace) { trace = stackTraces[locationName] = new Error(message); }
    if (!isStatic) { trace.message = message; }
    TypeToolsBase.topError = trace;
    return trace;
  }
  static trace(locationName: string, message?: string): Error {
    let trace = stackTraces[locationName];
    if (!trace) { trace = stackTraces[locationName] = new Error(message); }
    TypeToolsBase.topError = trace;
    return trace;
  }
  static addMetaProperty(target: any, metaKVM?: any, reset = false) {
    if (!target) { return; }
    if (!target._meta) {
      Object.defineProperty(target, '_meta', { value: {}, configurable: true, writable: true});
    }
    if (reset) { target._meta = {};  }
    if (metaKVM) {
      for (const key of Object.keys(metaKVM)) {
        target._meta[key] = metaKVM[key];
      }
    }
    return target._meta;
  }

  static addPredefine<T>(type: Class<T>, predefiner: (target: any) => void, prepend: boolean = false) {
    if (!(type as any).predefines) { (type as any).predefines = []; }
    if (prepend) {
      (type as any).predefines.shift(predefiner);
    } else {
      (type as any).predefines.push(predefiner);
    }
  }

  static addPostdefine<T>(type: Class<T>, postdefiner: (target: any) => void, prepend: boolean = false) {
    if (!(type as any).postdefines) { (type as any).postdefines = []; }
    if (prepend) {
      (type as any).postdefines.shift(postdefiner);
    } else {
      (type as any).postdefines.push(postdefiner);
    }
  }

  settings: TypeToolsSettings;

  constructor(settings?: Partial<TypeToolsSettings>) {
    if (!settings) {
      this.settings = TypeToolsSettings as any;
    } else {
      this.settings = Object.assign(new TypeToolsSettings(), settings);
    }
  }

  addExtension(target: any, extension: any) {
    return TypeToolsBase.addExtension(target, extension, this.settings as any);
  }
  getExtension(target: any) {
    return TypeToolsBase.getExtension(target, this.settings as any);
  }
  init(target: any) {
    return TypeToolsBase.init(target, this.settings as any);
  }
}

// tslint:disable-next-line: callable-types
export function settingsInitialize<T = TypeToolsSettings>(type: Class<T>, init?: Partial<T>) {
  if (!init) {
    return type as any as T; // return class itself; which has default static members
  } else {
    return Object.assign(new type(), init);
  }
}

export class UnknownClass { unknown = true; }

export class DataAddress {
  protocol: string;
  domain: string;
  path: string;
  accessor: string;
  serialize(){
    return `${this.protocol}://${this.domain}${this.path}${this.accessor ? '?a=' + this.accessor : ''}`;
  }
}

export const proxiedObjectsHandler: {[typeName: string]: (args) => ProxyHandler<any>} = {
  List: (args) => {
    let enabled = true;
    const data: any = {};
    const nudge = (o, p, v?) => {
      if (!args.parent || !args.prop) { return; }
      Context.validationError = null;
      try {
        args.parent[args.prop] = args.parent[args.prop];
      } catch (e) { Context.validationError = e; }
      if (Context.validationError) { // revert on validation error
        const e = Context.validationError;
        Context.validationError = null;
        if (isNaN(p)) {
          if (data.prev && data.prev.p === p) {
            const old = data.prev.v;
            const len = old.len;
            enabled = false;
            o.length = len;
            for (let i = 0; i < len; ++i) { o[i] = old[i]; }
            while (o.length > 0 && isUndef(o[o.length - 1])) { o.pop(); }
            while (o.length > 0 && isUndef(o[0])) { o.shift(); }
            enabled = true;
          }
        } else {
          if (data.prevSet && data.prevSet.p === p) {
            enabled = false;
            o.length = data.prevSet.len;
            o[p] = data.prevSet.v;
            while (o.length > 0 && isUndef(o[o.length - 1])) { o.pop(); }
            while (o.length > 0 && isUndef(o[0])) { o.shift(); }
            enabled = true;
          }
        }
      }
    };
    return {
      set(o, p, v) {
        data.prevSet = {p, v: o[p], len: o.length};
        if (args.type && v && v.constructor.name === 'Object') {
          const cast = Context.cast(v, args.type);
          if (cast) { v = cast; }
        }
        o[p] = v;
        if (enabled) { nudge(o, p, v); }
        data.prevSet = null;
        return true;
      },
      get(o, p) {
        if (p === '_get_args') { return args; }
        if (p === '_get_args_type') { return args.type; }
        if (p === '_stencil') {
          return (newTarget: any, newData: any) => {
            return new List(JSON.parse(JSON.stringify(newData)), newTarget, args.prop, args.type, args.order);
          };
        }
        if (p === '_set_args') { return props => { Object.assign(args, props); }; }
        switch(p) {
          case 'push':
          case 'pop':
          case 'reverse':
          case 'shift':
          case 'unshift':
          case 'splice':
          case 'sort':
            return (...a) => {
              if (args.type) {
                if (p === 'push' || p === 'unshift') {
                  if (a[0] && a[0].constructor.name === 'Object') {
                    const cast = Context.cast(a[0], args.type);
                    if (cast) { a[0] = cast; }
                  }
                }
                if (p === 'splice' && a.length > 2) {
                  for (let i = 2; i < a.length; ++i) {
                    if (a[i] && a[i].constructor.name === 'Object') {
                      const cast = Context.cast(a[i], args.type);
                      if (cast) { a[i] = cast; }
                    } 
                  }
                }
              }
              data.prev = {p, v: o.concat([])};
              const result = o[p].apply(o, a);
              if (enabled) { nudge(o, p); }
              data.prev = null;
              return result;
            };
        }
        return o[p];
      },
      deleteProperty(o, p) {
        if (enabled) { nudge(o, p); }
        return true;
      }
    } as any;
  },
  Dict: (args) => {
    if (!args.rubric) { args.rubric = {}; }
    let enabled = true;
    const data: any = {};
    const nudge = (o, p, v?) => {
      if (!args.parent || !args.prop) { return; }
      Context.validationError = null;
      try {
        args.parent[args.prop] = args.parent[args.prop];
      } catch (e) { Context.validationError = e; }
      if (Context.validationError) { // revert on validation error
        const e = Context.validationError;
        Context.validationError = null;
        if (data.prevSet && data.prevSet.p === p) {
          enabled = false;
          o[p] = data.prevSet.v;
          enabled = true;
        }
      }
    };
    return {
      set(o, p, v){
        data.prevSet = {p, v: o[p], len: o.length};
        if (args.rubric[p] && v && v.constructor.name === 'Object') {
          const cast = Context.cast(v, args.rubric[p]);
          if (cast) { v = cast; }
        }
        o[p] = v;
        if (enabled) { nudge(o, p, v); }
        data.prevSet = null;
        return true;
      },
      get(o, p) {
        if (p === '_get_args') { return args; }
        if (p === '_get_args_rubric') { return args.rubric; }
        if (p === '_stencil') {
          return (newTarget: any, newData: any) => {
            return new Dict(JSON.parse(JSON.stringify(newData)), newTarget, args.prop, args.rubric);
          };
        }
        if (p === '_set_args') { return props => { Object.assign(args, props); }; }
        if (p === '_nudge') { return () => { if (enabled) { nudge(o, p); } }; }
        return o[p];
      },
      deleteProperty(o, p) {
        if (enabled) { nudge(o, p); }
        return true;
      }
    };
  },
};

export class List<T = any> extends Array<T> {
  static currentOp: string = null;
  static stencil<T>(list: List<T>, newData: any, newTarget?: any): List<T> {
    if (!newTarget) { newTarget = (list as any)._get_args.parent; }
    return (list as any)._stencil(newTarget, newData) as List<T>;
  }
  static check(list: List, type?: Class<any>, disallowNull = false): boolean {
    if (list === null || list === undefined) { return true; }
    if (!list) { return false; }
    if (!Array.isArray(list)) { return false; }
    if (!type) { type = (list as any)._get_args_type; }
    for (const el of list) {
      if (List.checkElement(el, type, disallowNull)) { continue; }
      return false;
    }
    return true;
  }
  static checkElement(el: any, type?: Class<any>, disallowNull = false) {
    if (!disallowNull && (el === undefined || el === null)) { return true; }
    // if (el._get_args_type) { return List.check(el, el._get_args_type, disallowNull); }
    if (typeof el === 'string') {
      if (type && el.startsWith(`${refHead}.${typeFullName(type)}:`)) { return true;
      } else if (el.startsWith(`${refHead}:`)) { return true;
      } else { return false; }
    } 
    if (type && Context.lineageHas(el, type)) {
      if ((type as any).check && !(type as any).check(el)) { return false; }
      return true;
    }
    return false;
  }
  constructor(init?: Array<T>, parent?: any, prop?: string, type?: Class<any>, order: number = 1) {
    super();
    const prox = new Proxy(this, proxiedObjectsHandler.List({parent, prop, type, order}) as any);
    if (init && Array.isArray(init)) {
      prox.length = init.length;
      for (let i = 0; i < init.length; ++i) { prox[i] = init[i]; }
    }
    return prox;
  }
}

export class Dict<T = any> {
  static currentOp: string = null;
  static typed<T>(a: Dict<T>) { return a as unknown as Partial<T>; }
  static stencil<T>(dict: Dict<T>, newData: any, newTarget?: any): Dict<T> {
    if (!newTarget) { newTarget = (dict as any)._get_args.parent; }
    return (dict as any)._stencil(newTarget, newData) as Dict<T>;
  }
  static check(dict: Dict, rubric?: {[propName: string]: Class<any>}, disallowNull = false): boolean {
    if (dict === null || dict === undefined) { return true; }
    if (!dict) { return false; }
    if (!(dict as any)._get_args_rubric) { return false; }
    if (!rubric) { rubric = (dict as any)._get_args_rubric; }
    for (const key of Object.keys(dict)) {
      if (!rubric[key]) { continue; }
      if (Dict.checkElement(dict[key], rubric ? rubric[key] : null, disallowNull)) { continue; }
      return false;
    }
    return true;
  }
  static checkElement(el: any, type?: Class<any>, disallowNull = false) {
    if (!disallowNull && (el === undefined || el === null)) { return true; }
    if (el._get_args_rubric) { return Dict.check(el, el._get_args_rubric, disallowNull); }
    if (typeof el === 'string') {
      if (type && el.startsWith(`${refHead}.${typeFullName(type)}:`)) { return true;
      } else if (el.startsWith(`${refHead}:`)) { return true;
      } else { return false; }
    } 
    if (type && Context.lineageHas(el, type)) {
      if ((type as any).check && !(type as any).check(el)) { return false; }
      return true;
    }
    return false;
  }
  [key: string]: any;
  constructor(init?: T, parent?: any, prop?: string, rubric?: {[propName: string]: Class<any>}) {
    const prox = new Proxy(this, proxiedObjectsHandler.Dict({parent, prop, rubric}) as any);
    if (init) { Object.assign(this, init); }
    return prox;
  }
}

export function ModelList<T>(type?: Class<T>, init?: Array<T>, parent?: any, prop?: string, order: number = 1) {
  if (!init) { init = []; }
  return new List(init, parent, prop, type, order);
}

export function ModelDict<T>(init?: T, parent?: any, prop?: string, rubric?: {[propName: string]: Class<any>}) {
  return new Dict(init, parent, prop, rubric) as T;
}

// TODO
export class Ref<T> {
  type: Class<T>;
  address: string;
  constructor(type: Class<T>, address?: string) {
    this.type = type;
    this.address = address;
  }
  dereference(): T {
    // TODO
    return;
  }
  toJSON() {
    return { $ref: this.address };
  }
}

export function isUndef(a){ return a === undefined || a === null; }

export function isFunction(a) { return a && a.apply && a.call; }

export function isArray(a) { return Array.isArray(a); }

export function isObject(a) { return a && typeof a === 'object'; }

export function isModelInstance(a) { return a && typeof a === 'object' && TypeToolsBase.typeCheck(a); }

export function isModelCollection(a) { return a && typeof a === 'object' && TypeToolsBase.typeCheck(a) && a._get_args; }
