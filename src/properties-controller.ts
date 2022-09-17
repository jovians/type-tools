/* Jovian (c) 2020, License: MIT */

import { settingsInitialize, TypeToolsBase, TypeToolsExtension, TypeToolsExtensionData, TypeToolsSettings, UnknownClass } from './type-tools';
import { Class, PartialCustom } from './type-transform';
import { ClassLineage } from './class-lineage';
import { Context } from './context';
import { typeFullName } from './upstream/common.iface';

export class PropertiesControllerSettings extends TypeToolsSettings {
  static disabledGlobally = false;
  static extensionPropertiesController = 'PropertiesController';
  extensionPropertiesController = PropertiesControllerSettings.extensionPropertiesController;
  constructor(init?: Partial<PropertiesControllerSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export class PropertyAccessTrace {
  trace: Error;
  e: PropertyAccessEvent;
}

export class PropertyAccessEvent {
  property: string;
  className: string;
  classRealPath: string;
  path: string;
  class: any;
  data: { [flagName: string]: any } = {};
  ignoredClasses: Class<any>[] = [];
  value: any;
  oldValue: any;
  thrown: boolean;
  constructor(init?: Partial<PropertyAccessEvent>) {
    if (init) { Object.assign(this, init); }
  }
  clearData() {
    this.thrown = false;
    this.data = {};
    this.ignoredClasses = [];
    this.value = null;
    this.oldValue = null;
  }
  cancel(message?: string) {
    this.data.canceled = true;
    const e = { message, name: '', stack: '' } as Error;
    this.data.cancelTrace = e;
    TypeToolsBase.topCancel = e;
    Context.anyPropertyFailed = true;
  }
  throw(message?: string) {
    this.thrown = true;
    this.data.stopped = true;
    const e = Context.throwErrors ? new Error(message) : { message, name: '', stack: '' } as Error;
    this.data.error = e;
    TypeToolsBase.topError = e;
    Context.anyPropertyFailed = true;
  }
  stopPropagation() { this.data.stopped = true; }
  transformValue(newValue: any) {
    this.value = this.data.value = newValue;
  }
  getStackTrace() { return new Error('PropertyAccessEvent Stack Trace').stack; }
  // tslint:disable-next-line: callable-types
  ignoreDefinitionsFrom<T = any>(...classes: Class<T>[]) {
    if (this.class === UnknownClass) {
      throw TypeToolsBase.reusedTrace(
        'PropertyAccessEvent.ignoreDefinitionsFrom',
          `Cannot use ignoreDefinitionsFrom when class context is not specified; ` +
          `consider using defineFor(className, () => {}) block when defining properties rubric.`);
    }
    for (const cls of classes) {
      if (this.ignoredClasses.indexOf(cls) >= 0) { continue; }
      this.ignoredClasses.push(cls);
    }
  }
}

export class PropertyControlLayer {
  get: (value, e: PropertyAccessEvent) => any;
  set: (newValue, e: PropertyAccessEvent) => any;
  change: (oldValue, newValue, e: PropertyAccessEvent) => void;
  throwError: boolean = true;
  constructor(init?: Partial<PropertyControlLayer>) {
    if (init) { Object.assign(this, init); }
  }
}

export class PropertyController {
  property: string;
  valueKeeper: { value: any };
  getters: ((value, e: PropertyAccessEvent) => any)[];
  setters: ((newValue, e: PropertyAccessEvent) => any)[];
  changes: ((oldValue, newValue, e: PropertyAccessEvent) => void)[];
  descriptor: PropertyDescriptor;
  getError?: Error;
  setError?: Error;
  extension?: any;

  get?: boolean;
  set?: boolean;

  constructor(init?: Partial<PropertyController>) {
    if (init) { Object.assign(this, init); }
  }

  orderHandlers() {
    this.getters = this.orderHandler(this.getters);
    this.setters = this.orderHandler(this.setters);
    this.changes = this.orderHandler(this.changes);
  }

  orderHandler(handlers: any[]) {
    const fronts = [];
    const middles = [];
    const backs = [];
    for (const handler of handlers) {
      if (handler.alwaysFront) {
        fronts.push(handler);
      } else if (handler.alwaysBack) {
        backs.push(handler);
      } else {
        middles.push(handler);
      }
    }
    fronts.sort((a, b) => a.order - b.order);
    backs.sort((a, b) => a.order - b.order);
    return fronts.concat(middles, backs);
  }
}

export interface PropertiesManagementOptions {
  prepend?: boolean;
  alwaysFront?: boolean;
  alwaysBack?: boolean;
  order?: number;
}

export class PropertiesControllerExtensionData implements TypeToolsExtensionData {
  managed: { [propName: string]: PropertyController };
  errors?: PropertyAccessTrace[];
  cancels?: PropertyAccessTrace[];
  onerrors: ((tracer: PropertyAccessTrace) => any)[];
  oncancels: ((tracer: PropertyAccessTrace) => any)[];
  onpropertychanges?: ((propName: string, oldValue: any, newValue: any, immediate?: boolean) => any)[];
}

export class PropertiesController implements TypeToolsExtension {
  static getExtensionData(target: any, settings = PropertiesControllerSettings): PropertiesControllerExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionPropertiesController, settings);
  }
  static typeCheck(target: any, settings = PropertiesControllerSettings): boolean {
    return target && !!PropertiesController.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = PropertiesControllerSettings) {
    if (!TypeToolsBase.checkContext(PropertiesController)) { return false; }
    if (!PropertiesController.getExtensionData(target, settings)) {
      const extension: PropertiesControllerExtensionData = {
        managed: {},
        errors: [],
        cancels: [],
        onerrors: [],
        oncancels: [],
        onpropertychanges: [],
      };
      TypeToolsBase.addExtension(target, settings.extensionPropertiesController, extension);
      Object.defineProperty(extension, '__meta_ignore', { value: { get: false, set: false } });
    }
    return true;
  }
  static manage<T = any>(target: T, options: PropertiesManagementOptions,
                         rubric: PartialCustom<T, Partial<PropertyControlLayer>>, settings = PropertiesControllerSettings) {
    if (!PropertiesController.implementOn(target, settings)) { return; }
    if (!options) { options = {}; }
    const cls = Context.current ? Context.current : (
                  TypeToolsBase.slowResolveContext ? ClassLineage.getContextSlow(target) : UnknownClass);
    const extension = PropertiesController.getExtensionData(target, settings);
    const errors: Error[] = [];
    const orderBroken = options.alwaysFront || options.alwaysBack;
    if (orderBroken) {
      if (options.order === undefined || options.order === null) { options.order = 5; }
    }
    const targetProps = Object.keys(rubric);
    for (const propName of targetProps) {
      const propRubric: PropertyControlLayer = rubric[propName];
      let reg: PropertyController = extension.managed[propName];
      const typename = typeFullName(cls);
      const accessMeta = new PropertyAccessEvent({
        property: propName,
        className: typename,
        classRealPath: typeFullName(cls),
        path: typename + '.' + propName,
        class: cls,
      });
      if (propRubric.get) { (propRubric.get as any).e = accessMeta; }
      if (propRubric.set) { (propRubric.set as any).e = accessMeta; }
      if (propRubric.change) { (propRubric.change as any).e = accessMeta; }
      if (propRubric.throwError === false) { (propRubric.set as any).dontThrow = true; }
      if (reg) {
        if (propRubric.get) {
          if (options.prepend) { reg.getters.unshift(propRubric.get);
          } else { reg.getters.push(propRubric.get); }
        }
        if (propRubric.set) {
          if (options.prepend) { reg.setters.unshift(propRubric.set);
          } else { reg.setters.push(propRubric.set); }
        }
        if (propRubric.change) {
          if (options.prepend) { reg.changes.unshift(propRubric.change);
          } else { reg.changes.push(propRubric.change); }
        }
      } else {
        const proxiedValue = { value: target[propName] };
        reg = extension.managed[propName] = new PropertyController({
          property: propName,
          valueKeeper: proxiedValue,
          getters: [],
          setters: [],
          changes: [],
          descriptor: null,
          getError: null,
          setError: null,
          extension: {},
        });
        if (propRubric.get) {
          if (options.prepend) { reg.getters.unshift(propRubric.get);
          } else { reg.getters.push(propRubric.get); }
        }
        if (propRubric.set) {
          if (options.prepend) { reg.setters.unshift(propRubric.set);
          } else { reg.setters.push(propRubric.set); }
        }
        if (propRubric.change) {
          if (options.prepend) { reg.changes.unshift(propRubric.change);
          } else { reg.changes.push(propRubric.change); }
        }
        reg.descriptor = {
          get() {
            if (Context.disabled || PropertiesControllerSettings.disabledGlobally) {
              return proxiedValue.value;
            }
            let value = proxiedValue.value;
            const ignoredClasses = {};
            for (const getter of reg.getters) {
              const evt = (getter as any).e as PropertyAccessEvent;
              if (ignoredClasses[typeFullName(evt.class)] 
                  || Context.getter.ignoredClasses[typeFullName(evt.class)]) { continue; }
              evt.clearData();
              evt.value = value;
              const result = getter(value, evt);
              if (evt.data.value !== undefined) { value = evt.data.value; }
              if (evt.ignoredClasses.length > 0) {
                for (const ignoredClass of evt.ignoredClasses) { ignoredClasses[typeFullName(ignoredClass)] = true; }
              }
              if (result === false || evt.data.canceled) { break; }
              if (evt.data.stopped) { break; }
            }
            return value;
          },
          set(newValue) {
            reg.setError = null;
            const oldValue = proxiedValue.value;
            if (Context.disabled || PropertiesControllerSettings.disabledGlobally) {
              proxiedValue.value = newValue;
              return newValue;
            }
            let errorTrace: PropertyAccessTrace;
            let cancelTrace: PropertyAccessTrace;
            let throwErrorDetected = Context.throwErrors;
            let ignoredClasses = {};
            for (const setter of reg.setters) {
              const evt = (setter as any).e as PropertyAccessEvent;
              try {
                if (ignoredClasses[typeFullName(evt.class)] 
                  || Context.getter.ignoredClasses[typeFullName(evt.class)]) { continue; }
                evt.clearData();
                evt.oldValue = oldValue;
                evt.value = newValue;
                const result = setter(newValue, evt);
                if (evt.data.value !== undefined) { newValue = evt.data.value; }
                if (evt.ignoredClasses.length > 0) {
                  for (const ignoredClass of evt.ignoredClasses) { ignoredClasses[typeFullName(ignoredClass)] = true; }
                }
                if (result === false || evt.data.canceled) {
                  Context.anyPropertyFailed = true;
                  newValue = proxiedValue.value;
                  cancelTrace = {
                    e: evt,
                    trace: evt.data.cancelTrace ? evt.data.cancelTrace : TypeToolsBase.reusedTrace(evt.path),
                  };
                  break;
                }
                if (evt.data.stopped) {
                  if (evt.data.error) {
                    errorTrace = { e: evt, trace: evt.data.error };
                  }
                  break;
                }
              } catch (e) {
                if ((setter as any).dontThrow) { throwErrorDetected = false; }
                Context.anyPropertyFailed = true;
                TypeToolsBase.topError = e;
                errorTrace = { trace: e, e: evt, };
                break;
              }
            }
            if (cancelTrace) {
              if (Context.trackCancels) { extension.cancels.push(cancelTrace); }
              for (const oncancel of extension.oncancels) { oncancel(cancelTrace); }
              return oldValue;
            }
            if (errorTrace) {
              reg.setError = errorTrace.trace;
              if (Context.trackErrors) { extension.errors.push(errorTrace); }
              for (const onerror of extension.onerrors) { onerror(errorTrace); }
              if (throwErrorDetected) { throw errorTrace.trace; }
              return oldValue;
            } else {
              ignoredClasses = {};
              proxiedValue.value = newValue;
              const subtreeProp = (oldValue && oldValue._get_args) || (newValue && newValue._get_args);
              if (oldValue !== newValue || subtreeProp) {
                for (const onvaluechange of reg.changes) {
                  const e = (onvaluechange as any).e as PropertyAccessEvent;
                  if (ignoredClasses[typeFullName(e.class)] 
                      || Context.change.ignoredClasses[typeFullName(e.class)]) { continue; }
                  e.clearData();
                  onvaluechange(oldValue, newValue, e);
                  if (e.ignoredClasses.length > 0) {
                    for (const ignoredClass of e.ignoredClasses) { ignoredClasses[typeFullName(ignoredClass)] = true; }
                  }
                  if (e.data.stopped) { break; }
                }
              }
              for (const onpropertychange of extension.onpropertychanges) {
                onpropertychange(reg.property, oldValue, newValue, true);
              }
              return newValue;
            }
          },
        };
        try { // prevent non-configurable property from throwing error
          Object.defineProperty(target, propName, reg.descriptor);
        } catch (e) {
          delete extension.managed[propName]; // revert registration no failure
          errors.push(e);
          continue;
        }
      }
      if (orderBroken) { reg.extension.orderBroken = true; }
    }
    for (const propName of targetProps) {
      let reg: PropertyController = extension.managed[propName];
      if (reg && reg.extension.orderBroken) { reg.orderHandlers(); }
    }
    return errors;
  }

  static getErrorTracesOf(target: any, settings = PropertiesControllerSettings) {
    const extension = PropertiesController.getExtensionData(target, settings);
    return extension.errors;
  }

  static getCancelTracesOf(target: any, settings = PropertiesControllerSettings) {
    const extension = PropertiesController.getExtensionData(target, settings);
    return extension.cancels;
  }

  settings: PropertiesControllerSettings;

  constructor(settings?: Partial<PropertiesControllerSettings>) {
    this.settings = settingsInitialize(PropertiesControllerSettings, settings);
  }

  getExtensionData(target: any) { return PropertiesController.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return PropertiesController.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return PropertiesController.implementOn(target, this.settings as any); }

  manage<T = any>(target: T, options: PropertiesManagementOptions, rubric: PartialCustom<T, Partial<PropertyControlLayer>>) {
    return PropertiesController.manage(target, options, rubric, this.settings as any);
  }
}
