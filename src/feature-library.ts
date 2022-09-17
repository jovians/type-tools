/* Jovian (c) 2020, License: MIT */

import { ClassLineage } from './class-lineage';
import { Context } from './context';
import { Derivables, DerivablesMetadata,  } from './derivables';
import { DataImportable } from './data-importable';
import { Ephemerals, } from './ephemerals';
import { PropertiesController, PropertyAccessEvent,  } from './properties-controller';
import { isFunction, TypeToolsBase } from './type-tools';
import { Class, _, TypedSpreader, PartialCustom, PartialCustomWith, PartialSettings, InitiableClass } from './type-transform';
import { CommonValidations, CommonValidationsNamedImpl, Validatable, ValidatableSetter, ValidatationNamedType,  } from './validatable';
import { Upstream } from './upstream';
import { typeFullName } from './upstream/common.iface';
import { dp, dp3 } from './common/globals.ix';

export class TypeToolsLibrary {
  currentContext = Context;
  validatable = Validatable;
  ephemerals = Ephemerals;
  derivables = Derivables;
  propertiesController = PropertiesController;
  classLineage = ClassLineage;
  importable = DataImportable;
  upstream = Upstream;
  initialize = <T>(target: T, init: Partial<T>) => {
    DataImportable.implementOn(target);
    DataImportable.getExtensionData(target).import(init);
  };
  enforce = perPropDefine;
  client = {
    validatable: Validatable,
    ephemerals: Ephemerals,
    derivables: Derivables,
    propertiesController: PropertiesController,
    upstream: Upstream,
  };
  server ={
    validatable: Validatable,
    ephemerals: Ephemerals,
    derivables: Derivables,
    propertiesController: PropertiesController,
    upstream: Upstream,
  };
  validate = Validatable.test;
  config = {
    disable() { Context.disabled = true; },
    ennable() { Context.disabled = false; },
    disableThrow() { Context.throwErrors = false; },
    enableThrow() { Context.throwErrors = false; },
    disableExtensions(...extClasses: Class<any>[]) {
      for (const cls of extClasses) { Context.disabledExtensions[typeFullName(cls)] = cls; }
    },
    enableExtensions(...extClasses: Class<any>[]): any {
      for (const cls of extClasses) { if (Context.disabledExtensions[typeFullName(cls)]) { delete Context.disabledExtensions[typeFullName(cls)]; } }
    },
    disableClasses(...classes: Class<any>[]): any {
      for (const cls of classes) { Context.disabledClasses[typeFullName(cls)] = cls; }
    },
    enableClasses(...classes: Class<any>[]): any {
      for (const cls of classes) { if (Context.disabledClasses[typeFullName(cls)]) { delete Context.disabledClasses[typeFullName(cls)]; } }
    },
    disableGettersFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { Context.getter.ignoredClasses[typeFullName(cls)] = cls; }
    },
    enableGettersFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { if (Context.getter.ignoredClasses[typeFullName(cls)]) { delete Context.getter.ignoredClasses[typeFullName(cls)]; } }
    },
    disableSettersFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { Context.setter.ignoredClasses[typeFullName(cls)] = cls; }
    },
    enableSettersFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { if (Context.setter.ignoredClasses[typeFullName(cls)]) { delete Context.setter.ignoredClasses[typeFullName(cls)]; } }
    },
    disableOnValueChangesFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { Context.change.ignoredClasses[typeFullName(cls)] = cls; }
    },
    enableOnValueChangesFrom(...classes: Class<any>[]): any {
      for (const cls of classes) { if (Context.change.ignoredClasses[typeFullName(cls)]) { delete Context.change.ignoredClasses[typeFullName(cls)]; } }
    },
  };
}

export const TypeTools = new Proxy(new TypeToolsLibrary(), {
  get(target, prop) {
    switch (prop) {
      case 'client': Context.location = 'client'; break;
      case 'server': Context.location = 'server'; break;
      default: Context.location = 'all'; break;
    }
    return target[prop];
  }
});

export function defineOn<T>(target: T, asType: InitiableClass<T>, definer: (typetools: TypeToolsLibrary) => any) {
  if (target && !(target as any)._tt_define) {
    Object.defineProperty(target, '_tt_define', { value: {} as any });
  }
  if (Context.disabled || Context.defineDisabled) { return; }
  const typename = typeFullName(asType);
  if (Context.disabledClasses[typename]) { return; }
  const contextCurrentSaved = Context.current;
  if (contextCurrentSaved && !Context.defineOnUnlock) {
    throw TypeToolsBase.reusedTrace(
      'TypeToolsLibrary.defineOn',
        'defineOn cannot be called again within defineOn block.', true);
  }
  Context.target = target;
  if (Context.beforeDefinition[typename]) {
    const beforeDevCtxSaved = Context.beforeDefCurrent;
    Context.beforeDefCurrent = asType;
    for (const predef of Context.beforeDefinition[typename]) {
      try {
        predef(target);
      } catch (e) {
        if ((predef as any).onerror) { try { (predef as any).onerror(e); } catch (e2) {} }
      }
    }
    Context.beforeDefCurrent = beforeDevCtxSaved;
    Context.beforeDefinition[typename] = null;
  }
  let error;
  Context.current = asType;
  if ((asType as any).predefines) {
    for (const predefiner of (asType as any).predefines) {
      try { predefiner(target); } catch (e) { }
    }
  }
  try { definer(TypeTools); } catch (e) { error = e; }
  if ((asType as any).postdefines) {
    for (const postdefiner of (asType as any).postdefines) {
      try { postdefiner(target); } catch (e) { }
    }
  }
  Context.current = contextCurrentSaved;
  if (error) { throw error; }
}

export function ModelDef<T, S extends InitiableClass<T>>(target: T, type: S, init: Partial<T>, rubric?: PartialCustom<T, PerPropRubric>) {
  // dp('ModelDef on', type.name, target.constructor.name)
  if (!(target as any).__model_defs) { Object.defineProperty(target, '__model_defs', { value: {} }); }
  const modeldef = (target as any).__model_defs;
  if (modeldef[type.name]) {
    throw new Error(`Cannot have multiple model definitions for ${type.name}`);
  }
  modeldef[type.name] = type;
  defineOn(target, type, lib => {
    const options: any = {};
    if (init) { options.init = init; }
    lib.enforce(target, options, rubric);
    if (type === target.constructor) { // only top extended class can have upstream
      if (Upstream.hasUpstream(target.constructor as Class<T>)) {
        lib.upstream.setupOn(target, type);
      }
    }
  });
}

export function ephemeral() {}

export interface PerPropRubric {
  ephemeral?: any;
  derive?: (...a: any[]) => any;
  validate?: (commonValidations: typeof CommonValidations) => ValidatationNamedType[];
  listOf?: Class<any>;
  dictOf?: {[key: string]: Class<any>};
}

export function perPropDefine<T>(target: T, options: any, rubric: PartialCustom<T, PerPropRubric>) {
  if (!rubric) { rubric = {}; }
  let type = Context.current;
  if (!options) { options = {}; }
  if (!type) { type = ClassLineage.typeOf(target); }
  let propList = TypeToolsBase.typeCacheGet(type, 'propList');
  let ephemMap = TypeToolsBase.typeCacheGet(type, 'propEphem');
  let featuresMap = TypeToolsBase.typeCacheGet(type, 'featuresMap');
  let featuresMapMissing = featuresMap ? false : true;
  if (!featuresMap) {
    featuresMap = {
      validatable: false,
      derivables: false,
      ephemerals: false,
    };
  }
  if (!propList) {
    propList = Object.keys(rubric);
    TypeToolsBase.typeCacheSet(type, 'propList', propList);
  }
  const validatableRubric: PartialCustom<T, ValidatableSetter> = {};
  const ephemeralsRubric: PartialCustom<T, any> = ephemMap ? ephemMap : {};
  const derivablesRubric: PartialCustom<T, ((...props:any[]) => any) | DerivablesMetadata<T>> = {};
  propList.forEach(propName => {
    const propDef: PerPropRubric = rubric[propName];
    const preValidations: ValidatationNamedType[] = [];
    if (!propDef) { return; }
    if (propDef.ephemeral !== undefined) {
      if (featuresMapMissing) { featuresMap.ephemerals = true; }
      if (!ephemMap) { ephemeralsRubric[propName] = propDef.ephemeral; }
    }
    if (propDef.derive) {
      if (featuresMapMissing) { featuresMap.derivables = true; }
      derivablesRubric[propName] = propDef.derive;
    }
    if (propDef.listOf) {
      target[propName]._set_args({ parent: target, prop: propName, type: propDef.listOf });
      const propSkel = TypeToolsBase.getSkeleton(type)[propName];
      if (!propSkel._get_args.parent) { propSkel._set_args({ parent: target, prop: propName, type: propDef.listOf }); }
      preValidations.push(CommonValidations.notNull);
      preValidations.push(CommonValidations.list);
      if (!propDef.validate) { propDef.validate = () => []; }
    }
    if (propDef.dictOf) {
      target[propName]._set_args({ parent: target, prop: propName, rubric: propDef.dictOf });
      const propSkel = TypeToolsBase.getSkeleton(type)[propName];
      if (!propSkel._get_args.parent) { propSkel._set_args({ parent: target, prop: propName, rubric: propDef.dictOf }); }
      preValidations.push(CommonValidations.notNull);
      preValidations.push(CommonValidations.dict);
      if (!propDef.validate) { propDef.validate = () => []; }
    }
    if (propDef.validate) {
      if (featuresMapMissing) { featuresMap.validatable = true; }
      const list = propDef.validate(CommonValidations);
      if (preValidations.length > 0) {
        for (let i = preValidations.length - 1; i >= 0; --i) {
          list.unshift(preValidations[i]);
        }
      }
      validatableRubric[propName] = (value: any, e: PropertyAccessEvent) => {
        let result;
        for (const validation of list) {
          if (!validation) { continue; }
          if (isFunction(validation)) { // functional
            const funcName = (validation as Function).name;
            result = (validation as Function)(e, e.value);
            if (result === false || e.data.canceled || e.data.stopped) {
              if (!e.thrown && !e.data.canceled) {
                const criteria = e.data.criteria ? '::' + e.data.criteria : '';
                if (Context.throwErrorsForCommonValidations) {
                  e.throw(`Validation.function.${funcName}${criteria}`);
                } else {
                  e.cancel(`Validation.function.${funcName}${criteria}`);
                }
              }
              return result;
            }
          } else { // common
            const commonValidationName = validation + '';
            const validator = CommonValidationsNamedImpl[commonValidationName];
            if (validator) {
              result = validator(e, e.value);
              if (result === false || e.data.canceled || e.data.stopped) {
                if (!e.thrown && !e.data.canceled) {
                  if (Context.throwErrorsForCommonValidations) {
                    e.throw(`Validation.common.${commonValidationName}`);
                  } else {
                    e.cancel(`Validation.common.${commonValidationName}`);
                  }
                }
                return result;
              }
            }
          }
        }
        return result;
      }
    }
  });
  if (!ephemMap) {
    TypeToolsBase.typeCacheSet(type, 'propEphem', ephemMap);
  }
  if (featuresMapMissing) {
    TypeToolsBase.typeCacheSet(type, 'featuresMap', featuresMap);
  }
  Validatable.enforce(target, {}, validatableRubric);
  Ephemerals.of(target, ephemeralsRubric);
  Derivables.of(target, {}, derivablesRubric);
  if (options.init && type === target.constructor && !Context.beforeSuper) {
    DataImportable.getExtensionData(target).import(options.init);
  }
}

export function beforeDefinitionOf<T = any>(type: Class<T>, predefiner: (inst: T) => any, onerror?: (e: Error) => any) {
  const typename = typeFullName(type);
  if (Context.disabled || Context.disabledClasses[typename] || Context.gettingSkeleton) { return; }
  if (!Context.beforeDefinition[typename]) { Context.beforeDefinition[typename] = []; }
  Context.beforeDefinition[typename].unshift(predefiner);
  if (onerror) { (predefiner as any).onerror = onerror; }
}

export function beforeSuper
  <A1= _, A2= _, A3= _, A4= _, A5= _, A6= _, A7= _, A8= _, A9= _, A10= _, A11= _, A12= _, A13= _, A14= _, A15= _, A16= _>(
    predefiner: () => any, args: TypedSpreader<A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16>) {
  const saved = Context.beforeSuper;
  Context.beforeSuper = true;
  predefiner();
  Context.beforeSuper = saved;
  return args;
}

export function superArgs
  <A1= _, A2= _, A3= _, A4= _, A5= _, A6= _, A7= _, A8= _, A9= _, A10= _, A11= _, A12= _, A13= _, A14= _, A15= _, A16= _>(
  ...args: TypedSpreader<A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16>) {
  return args;
}
