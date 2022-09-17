/* Jovian (c) 2020, License: MIT */

import { settingsInitialize, TypeToolsBase, TypeToolsExtension, TypeToolsExtensionData,
          TypeToolsSettings, isModelCollection, isFunction, List, Dict } from './type-tools';
import { DataImportable } from './data-importable';
import { PropertiesController, PropertiesControllerSettings, PropertiesManagementOptions,
         PropertyAccessEvent, PropertyAccessTrace, PropertyControlLayer } from './properties-controller';
import { Class, PartialCustom, PartialCustomWith, PartialSettings } from './type-transform';
import { Context } from './context';
import { ClassLineage } from './class-lineage';
import { typeFullName } from './upstream/common.iface';

export class ValidatableSettings extends PropertiesControllerSettings {
  static extensionValidatable = 'Validatable';
  extensionValidatable = ValidatableSettings.extensionValidatable;
  constructor(init?: Partial<ValidatableSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export type ValidatableSetter = (value: any, e?: PropertyAccessEvent) => any;

export interface ValidatableOptions {
  init?: any;
  throwOnValidationError?: boolean; // default true
  trackErrors?: boolean;
  prepend?: boolean;
}

export class ValidatableExtensionData implements TypeToolsExtensionData {
  options?: ValidatableOptions;
  errors?: PropertyAccessTrace[];
  cancels?: PropertyAccessTrace[];
}

export class Validatable implements TypeToolsExtension {
  static getExtensionData(target: any, settings = ValidatableSettings): ValidatableExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionValidatable, settings);
  }
  static typeCheck(target: any, settings = ValidatableSettings): boolean {
    return target && !!Validatable.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = ValidatableSettings) {
    if (!TypeToolsBase.checkContext(Validatable)) { return false; }
    if (!Validatable.getExtensionData(target, settings)) {
      DataImportable.implementOn(target);
      PropertiesController.implementOn(target, settings);
      const pcExtension = PropertiesController.getExtensionData(target, settings);
      const managedProps = pcExtension.managed;
      const extension: ValidatableExtensionData = { errors: [], cancels: [] };
      pcExtension.oncancels.push(tracer => {
        Context.validationError = tracer.trace;
        if (!Context.trackCancels) { return; }
        const reg = managedProps[tracer.e.property];
        if (reg.extension.validatable) { extension.cancels.push(tracer); }
      });
      pcExtension.onerrors.push(tracer => {
        Context.validationError = tracer.trace;
        if (!Context.trackErrors) { return; }
        const reg = managedProps[tracer.e.property];
        if (reg.extension.validatable) { extension.errors.push(tracer); }
      });
      TypeToolsBase.addExtension(target, settings.extensionValidatable, extension);
    }
    return true;
  }
  static enforce<T = any>(target: T, options: ValidatableOptions,
                          setterRubric?: PartialCustom<T, ValidatableSetter>,
                          settings = ValidatableSettings) {
    if (!Validatable.implementOn(target, settings)) { return; }
    const type: Class<T> = ClassLineage.typeOf(target);
    if (!(type as any).validationRules) { (type as any).validationRules = {}; }
    if (!options) { options = {}; }
    if (Context.current && !(Context.current as any).test) {
      const type = Context.current;
      (type as any).test = (type as any).check = (target2, throwError: boolean = false): boolean => {
        return Validatable.test(target2, type, throwError);
      }
    }
    const validatedKeys = Object.keys(setterRubric);
    const descriptorsRubric: PartialCustom<T, Partial<PropertyControlLayer>> = {};
    for (const propName of validatedKeys) {
      (type as any).validationRules[propName] = setterRubric[propName];
      descriptorsRubric[propName] = { set: setterRubric[propName] };
    }
    const manageOptions: PropertiesManagementOptions = {};
    if (options.prepend) { manageOptions.prepend = true; }
    PropertiesController.manage(target, manageOptions, descriptorsRubric, settings);
    const managedProps = PropertiesController.getExtensionData(target, settings).managed;
    for (const propName of validatedKeys) {
      if (managedProps[propName]) {
        managedProps[propName].extension.validatable = true;
      }
    }
    DataImportable.getExtensionData(target).import(options.init);
  }

  static check<T = any>(data: any, againstType: Class<T>, throwError = false) {
    return Validatable.test(data, againstType, throwError);
  }

  static testProp<T, S extends keyof T>(ruleType: Class<T>, propname: S, value: T[S], thisArg?: T): boolean {
    if (!(ruleType as any).validationRules) { return true; }
    const setterRubric: ValidatableSetter = (ruleType as any).validationRules[propname];
    const e = new PropertyAccessEvent({
      property: propname as string,
      className: ruleType.name,
      classRealPath: typeFullName(ruleType),
      path: ruleType.name + '.' + (propname as string),
      class: ruleType,
      value,
    });
    let passed = true;
    try {
      setterRubric.apply(thisArg, [value, e]);
    } catch (e) { passed = false; }
    if (e.thrown || e.data.canceled) { passed = false; }
    return passed;
  }

  static test<T = any>(data: any, againstType: Class<T>, throwError = false) {
    if (!data) {
      if (throwError) {
        throw TypeToolsBase.reusedTrace(
          'Validatable.validate::null_data',
            'Cannot validate null data', true);
      } else { return false; }
    }
    const inst = TypeToolsBase.getSampleInstance(againstType);
    let isValType = true;
    const extBase = inst[TypeToolsSettings.typeToolsKey];
    if (!extBase) { isValType = false; }
    const valExt = extBase ? extBase[ValidatableSettings.extensionValidatable] : null;
    if (!valExt) { isValType = false; }
    if (!isValType) {
      if (throwError) {
        throw TypeToolsBase.reusedTrace(
          'Validatable.validate::not_validatable',
            `${typeFullName(againstType)} type is not validatable.`);
      } else { return false; }
    }
    const skel = TypeToolsBase.getSkeleton(againstType);
    const throwErrorsSaved = Context.throwErrors;
    const trackErrorsSaved = Context.trackErrors;
    const trackCancelsSaved = Context.trackCancels;
    Context.throwErrors = Context.trackErrors = Context.trackCancels = false;
    let error;
    try {
      DataImportable.getExtensionData(inst).import(data, skel, true);
    } catch (e) { error = e; }
    Context.throwErrors = throwErrorsSaved;
    Context.trackErrors = trackErrorsSaved;
    Context.trackCancels = trackCancelsSaved;
    if (TypeToolsBase.topError) {
      if (throwError) { throw TypeToolsBase.topError; }
      return false;
    }
    if (TypeToolsBase.topCancel) { return false; }
    return true;
  }

  // tslint:disable-next-line: callable-types
  static convertInto<T = any>(type: Class<T>, data: Partial<T>, throwOnError: boolean = true): T {
    let validatableData;
    try {
      return validatableData = new type(data) as T;
    } catch (e) {
      if (throwOnError) { throw e; }
      return null;
    }
  }

  static errorsOf(target: any, settings = ValidatableSettings) {
    const extension = Validatable.getExtensionData(target, settings);
    return extension.errors;
  }

  static cancelsOf(target: any, settings = ValidatableSettings) {
    const extension = Validatable.getExtensionData(target, settings);
    return extension.cancels;
  }

  static resultOf(target: any, settings = ValidatableSettings) {
    const extension = Validatable.getExtensionData(target, settings);
    return extension.errors.length === 0 && extension.cancels.length === 0;
  }

  settings: ValidatableSettings;

  constructor(settings?: Partial<ValidatableSettings>) {
    this.settings = settingsInitialize(ValidatableSettings, settings);
  }

  getExtensionData(target: any) { return Validatable.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return Validatable.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return Validatable.implementOn(target, this.settings as any); }

  enforce<T = any>(target: T, options: ValidatableOptions, setterRubric?: PartialCustom<T, ValidatableSetter>) {
    return Validatable.enforce(target, options, setterRubric, this.settings as any);
  }
  // tslint:disable-next-line: callable-types
  convertInto<T = any>(type: Class<T>, data: Partial<T>, throwOnError: boolean = true) {
    return Validatable.convertInto(type, data, throwOnError);
  }
  test<T = any>(data: any, againstType: Class<T>, throwError = false) {
    return Validatable.test(data, againstType, throwError);
  }

}

Context.cast = <T>(a: any, type: Class<T>) => {
  const unlockedSaved = Context.defineOnUnlock;
  Context.defineOnUnlock = true;
  const cast = Validatable.convertInto(type, a, false);
  Context.defineOnUnlock = unlockedSaved;
  return cast;
};

export interface ToStringable {
  toString: () => string;
}

export type ValidatationNamedType = string | ToStringable | ((e: PropertyAccessEvent, value?: any) => any);

export const CommonValidations = {
  /** ```a !== null && a !== undefined``` */
  notNull: 'notNull' as 'notNull',
  /** ```a === true || a === false``` */
  boolean: 'boolean' as 'boolean',
  /** ```typeof a === 'number;``` */
  number: 'number' as 'number',
  /** ```typeof a === 'string'``` */
  string: 'string' as 'string',
  /** ```typeof a === 'object'``` */
  object: 'object' as 'object',
  /** ```Array.isArray(a)``` */
  array: 'array' as 'array',
  /** ```a && a.apply && a.call``` */
  function: 'function' as 'function',
  /** TypeTools object data model instance */
  modelInstance: 'modelInstance' as 'modelInstance',
  /** TypeTools object data model collection (List, Dict, ...) */
  modelCollection: 'modelCollection' as 'modelInstance',
  /** model instance list */
  list: 'list' as 'list',
  /** model instance dictionary (map type) */
  dict: 'dict' as 'dict',
  /** custom validator */
  custom: (validator: (e: PropertyAccessEvent, value?: any) => any) => validator,
  /** extends given class */
  extends: (type: Class<any> | string) => {
    const typename = typeof type === 'string' ? type : typeFullName(type);
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!type) { return false; }
      return value && typeof value === 'object' && ClassLineage.mapOf(value)[typename];
    }
  },
  /** does not extend given class */
  extendsNot: (type: Class<any> | string) => {
    const typename = typeof type === 'string' ? type : typeFullName(type);
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!type) { return true; }
      return !(value && typeof value === 'object' && ClassLineage.mapOf(value)[typename]);
    }
  },
  /** exactly match target class */
  class: (type: Class<any> | string) => {
    const typename = typeof type === 'string' ? type : typeFullName(type);
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!type) { return false; }
      return value && typeof value === 'object' && value.constructor.name === typename;
    }
  },
  /** match target classes */
  classIn: (...types: (Class<any> | string)[]) => {
    const typenames = types.map(t => typeof t === 'string' ? t : typeFullName(t));
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!types || types.length === 0) { return false; }
      return value && typeof value === 'object' && typenames.indexOf(value.constructor.name) >= 0;
    }
  },
  /** avoid a given class */
  classNot: (type: Class<any> | string) => {
    const typename = typeof type === 'string' ? type : typeFullName(type);
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!type) { return false; }
      return !(value && typeof value === 'object' && value.constructor.name === typename);
    }
  },
  /** avoid a given class */
  classNotIn: (...types: (Class<any> | string)[]) => {
    const typenames = types.map(t => typeof t === 'string' ? t : typeFullName(t));
    return (e: PropertyAccessEvent, value?: any): any => {
      if (!types || types.length === 0) { return true; }
      return !(value && typeof value === 'object' && typenames.indexOf(value.constructor.name) >= 0);
    }
  },
  /**
   * Ranged number (default inclusive)
   *
   * ```typescript
   * range('0,10') // between 0, 10; inclusive
   * range('0,10', '50,60', ...) // inclusive [0,10] or [50,60]
   * range('(0,10]') // between 0, 10; not including 0
   * ```
   * */
  range: (...exprs: string[]) => {
    // TODO
    // const typename = typeof type === 'string' ? type : typeFullName(type as any);
    // return (e: PropertyAccessEvent, value?: any): any => {
    //   if (!type) { return false; }
    //   return value && typeof value === 'object' && value.constructor.name === typename;
    // }
  },
  /** common email format */
  email: {
    toString: (): 'email' => 'email',
  },
  /** common phone format */
  phone: {
    toString: (): 'phone' => 'phone',
    /** intl format */
    intl: 'phone_intl',
  },
  phoneNumber: 1,
}

export const CommonValidationsNamedImpl: {[key: string]: (e, value) => any} = {
  'notNull': (e, value) => { return value !== null && value !== undefined; },
  'boolean': (e, value) => { return value === true || value === false; },
  'number': (e, value) => { return typeof value === 'number'; },
  'integer': (e, value) => { return Math.floor(value) === value; },
  'naturalNumber': (e, value) => { return value > 0 && Math.floor(value) === value; },
  'wholeNumber': (e, value) => { return value >= 0 && Math.floor(value) === value; },
  'string': (e, value) => { return typeof value === 'string'; },
  'object': (e, value) => { return typeof value === 'object'; },
  'array': (e, value) => { return Array.isArray(value); },
  'function': (e, value) => { return isFunction(value); },
  'modelInstance': (e, value) => { return TypeToolsBase.typeCheck(value); },
  'modelCollection': (e, value) => { return isModelCollection(value); },
  'list': (e, value) => { return List.check(value); },
  'dict': (e, value) => { return Dict.check(value); },
};
