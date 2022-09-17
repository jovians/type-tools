/* Jovian (c) 2020, License: MIT */

import { Context } from './context';
import { TypeToolsBase, TypeToolsExtensionData, TypeToolsExtension, TypeToolsSettings, settingsInitialize } from './type-tools';
import { PartialAny } from './type-transform';

export class EphemeralsSettings extends TypeToolsSettings {
  static extensionEphemerals = 'Ephemerals';
  extensionEphemerals = EphemeralsSettings.extensionEphemerals;
  constructor(init?: Partial<EphemeralsSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export class EphemeralsExtensionData implements TypeToolsExtensionData {
  [prop: string]: { source: any, data: any };
}

export class Ephemerals implements TypeToolsExtension {
  static debugData: { ignoredKey: string, source: any, data?: any }[] = [];
  static debugDataCollect = false;
  // tslint:disable-next-line: callable-types
  static getExtensionData(target: any, settings = EphemeralsSettings): EphemeralsExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionEphemerals, settings);
  }
  static typeCheck(target: any, settings = EphemeralsSettings): boolean {
    return target && !!Ephemerals.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = EphemeralsSettings) {
    if (!TypeToolsBase.checkContext(Ephemerals)) { return false; }
    if (!Ephemerals.getExtensionData(target, settings)) {
      const extension: EphemeralsExtensionData = {};
      if (!target.toJSONs) {
        Object.defineProperty(target, 'toJSONs', { value: [] });
        Object.defineProperty(target.toJSONs, 'debugTrail', { value: [], writable: true });
      }
      target.toJSONs.push({
        source: settings.extensionEphemerals,
        transform: (data, originalTarget) => {
          const filteredCopy = {};
          for (const prop of Object.keys(data)) {
            const ignoreInfo = extension[prop];
            if (ignoreInfo) {
              if (Ephemerals.debugDataCollect) {
                Ephemerals.debugData.push({
                  ignoredKey: prop,
                  source: ignoreInfo.source,
                  data: ignoreInfo.data
                });
              }
            } else {
              const value = data[prop];
              if (typeof value !== 'function') {
                filteredCopy[prop] = data[prop];
              }
            }
          }
          if (Context.serializeMeta && data._meta) {
            (filteredCopy as any)._meta = data._meta;
          }
          return filteredCopy;
        }
      });
      if (!target.toJSON) {
        Object.defineProperty(target, 'toJSON', { value: () => {
          let data = target;
          target.toJSONs.debugTrail = [];
          for (const toJSON of target.toJSONs) {
            const newlyTransformed = toJSON.transform(data, target);
            target.toJSONs.debugTrail.push({ source: toJSON.source, before: data, after: newlyTransformed });
            data = newlyTransformed;
          }
          return data;
        } });
      }
      TypeToolsBase.addExtension(target, EphemeralsSettings.extensionEphemerals, extension);
    }
    return true;
  }
  static of<T = any>(target: T, properties: PartialAny<T>, settings = EphemeralsSettings) {
    if(!Ephemerals.implementOn(target, settings)) { return; }
    const ephemerals: EphemeralsExtensionData = Ephemerals.getExtensionData(target, settings);
    for (const propName of Object.keys(properties)) {
      const ephemeralPropRubric = properties[propName];
      if (ephemeralPropRubric) { // truthy
        // ignoreInfo
        ephemerals[propName] = { source: target, data: ephemeralPropRubric };
      } else {
        ephemerals[propName] = null;
      }
    }
  }

  settings: EphemeralsSettings;

  constructor(settings?: Partial<EphemeralsSettings>) {
    this.settings = settingsInitialize(EphemeralsSettings, settings);
  }

  getExtensionData(target: any) { return Ephemerals.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return Ephemerals.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return Ephemerals.implementOn(target, this.settings as any); }

  of<T = any>(target: T, properties: PartialAny<T>) {
    return Ephemerals.of(target, properties, this.settings as any);
  }
}
