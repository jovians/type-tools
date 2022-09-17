/* Jovian (c) 2020, License: MIT */

import { settingsInitialize, TypeToolsBase, TypeToolsExtension, TypeToolsExtensionData } from './type-tools';
import { DataImportable } from './data-importable';
import { PropertiesController, PropertiesControllerSettings } from './properties-controller';
import { Class, PartialCustom } from './type-transform';
import { ClassLineage } from './class-lineage';
import { Context } from './context';
import { typeFullName } from './upstream/common.iface';

export class DerivablesSettings extends PropertiesControllerSettings {
  static extensionDerivables = 'Derivables';
  extensionDerivables = DerivablesSettings.extensionDerivables;
  constructor(init?: Partial<DerivablesSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export interface DerivablesMetadata<T> {
  from?: PartialCustom<T, any>;
  derive: () => any;
}

export interface DerivablesOptions {
  derive?: boolean
}

export class DerivablesExtensionData implements TypeToolsExtensionData {
  rubric: { [propName: string]: { from: string[], longHand: boolean, derive:() => any; } };
  triggers: { [propName: string]: { list: string[], guard: {[propName:string]: boolean}} };
}

export class Derivables implements TypeToolsExtension {
  static maxInitialIterations = 5;
  static getExtensionData(target: any, settings = DerivablesSettings): DerivablesExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionDerivables, settings);
  }
  static typeCheck(target: any, settings = DerivablesSettings): boolean {
    return target && !!Derivables.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = DerivablesSettings): boolean {
    if (!TypeToolsBase.checkContext(Derivables)) { return false; }
    if (!Derivables.getExtensionData(target, settings)) {
      DataImportable.implementOn(target);
      PropertiesController.implementOn(target, settings);
      const pcExtension = PropertiesController.getExtensionData(target, settings);
      const extension: DerivablesExtensionData = { rubric: {}, triggers: {} };
      pcExtension.onpropertychanges.push((propName, oldValue, newValue, immediate) => {
        const trigger = extension.triggers[propName];
        if (!trigger) { return; }
        for (const targetDerivedPropName of trigger.list) {
          const rubric = extension.rubric[targetDerivedPropName];
          let result;
          if (rubric.longHand) { // long-hand doesn't require props;
            result = rubric.derive.apply(target);
          } else {
            result = rubric.derive.apply(target, rubric.from.map(a => target[a]));
          }
          if (result !== undefined) {
            target[targetDerivedPropName] = result;
          }
        }
      });
      TypeToolsBase.addExtension(target, settings.extensionDerivables, extension);
    }
    return true;
  }
  static of<T = any>(target: T, options: DerivablesOptions,
                      deriveRubric: PartialCustom<T, ((...props:any[]) => any) | DerivablesMetadata<T>>,
                      settings = DerivablesSettings) {
    if (!Derivables.implementOn(target, settings)) { return; }
    if (!options) { options = {}; }
    const extension = Derivables.getExtensionData(target, settings);
    const type = ClassLineage.typeOf(target);
    const cacheKeyPrefix = DerivablesSettings.extensionDerivables + '::' +
                          (Context.current ? typeFullName(Context.current) + '::' : '');
    const derivablesKeys = Object.keys(deriveRubric);
    for (const propName of derivablesKeys) {
      const rubric = deriveRubric[propName];
      let cached = TypeToolsBase.typeCacheGet(type, cacheKeyPrefix + propName);
      let from;
      if (cached) {
        from = cached.from;
      } else {
        const longHand = (rubric as any).derive ? true : false;
        if (!longHand) {
          from = (rubric + '').split('\n')[0].split('(')[1].split(')')[0].split(',').map(a => a.trim());
        } else {
          from = Object.keys((rubric as DerivablesMetadata<T>).from);
        }
        cached = { from, longHand };
        const skel = TypeToolsBase.getSkeleton(type);
        for (const prop of from) {
          let msg = null;
          if (skel[prop] === undefined) {
            msg = `Derivable property '${propName}' cannot derive a non-member property '${prop}'`
          }
          if (prop === propName) {
            msg = `Derivable property '${propName}' cannot be derived from itself.'`
          }
          if (msg) {
            const e = new Error(msg);
            if (Context.throwErrors) { throw e; }
            from.length = 0;
            break;
          }
        }
        TypeToolsBase.typeCacheSet(type, cacheKeyPrefix + propName, cached); 
      }
      if (from.length > 0) {
        extension.rubric[propName] = {
          from: cached.from,
          longHand: cached.longHand,
          derive: cached.longHand ? rubric.derive : rubric
        };
        for (const sourcePropName of from) {
          let trigger = extension.triggers[sourcePropName];
          if (!trigger) { trigger = extension.triggers[sourcePropName] = { list:[], guard: {} }; }
          if (!trigger.guard[propName]) {
            trigger.list.push(propName);
            trigger.guard[propName] = true;
          }
        }
      }
    }
    // const descriptorsRubric: PartialCustom<T, Partial<PropertyControlLayer>> = {};
    // for (const propName of derivablesKeys) {
    //   descriptorsRubric[propName] = { set(newValue, e) { e.stopPropagation(); } };
    // }
    // // EXTENSION_ORDER_DEF
    // const manageOptions: PropertiesManagementOptions = { alwaysFront: true, order: 1 };
    // PropertiesController.manage(target, manageOptions, descriptorsRubric, settings);
    // const managedProps = PropertiesController.getExtensionData(target, settings).managed;
    // for (const propName of derivablesKeys) {
    //   if (managedProps[propName]) {
    //     managedProps[propName].extension.derivables = true;
    //   }
    // }
    // Initialize the derived ones
    let iteration = 0;
    let changed: any = { __first: true };
    while (Object.keys(changed).length > 0 && iteration < Derivables.maxInitialIterations) {
      changed = {};
      ++iteration;
      for (const targetDerivedPropName of derivablesKeys) {
        const rubric = extension.rubric[targetDerivedPropName];
        if (!rubric) { continue; }
        let result;
        if (rubric.longHand) { // long-hand doesn't require props;
          result = rubric.derive.apply(target);
        } else {
          result = rubric.derive.apply(target, rubric.from.map(a => target[a]));
        }
        if (target[targetDerivedPropName] !== result) {
          target[targetDerivedPropName] = result;
          changed[targetDerivedPropName] = true;
        }
      }
    }
    if (iteration >= Derivables.maxInitialIterations) { // something circular is going on.
      if (Context.throwErrors) {
        throw new Error(`Derivable keeps changing after ${iteration} iterations [keys=${Object.keys(changed).join(', ')}]. `);
      }
    }
  }

  settings: DerivablesSettings;

  constructor(settings?: Partial<DerivablesSettings>) {
    this.settings = settingsInitialize(DerivablesSettings, settings);
  }

  getExtensionData(target: any) { return Derivables.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return Derivables.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return Derivables.implementOn(target, this.settings as any); }

}
