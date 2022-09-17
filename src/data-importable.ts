/* Jovian (c) 2020, License: MIT */

import { ClassLineage, ClassLineageSettings } from './class-lineage';
import { Context } from './context';
import { PropertiesController, PropertiesManagementOptions, PropertyControlLayer } from './properties-controller';
import { settingsInitialize, TypeToolsBase, TypeToolsExtension, TypeToolsExtensionData } from './type-tools';
import { Class, PartialCustom } from './type-transform';

export class DataImportableSettings extends ClassLineageSettings {
  static extensionDataImportable = 'DataImportable';
  extensionDataImportable = DataImportableSettings.extensionDataImportable;
  constructor(init?: Partial<DataImportableSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export class DataImportableExtensionData implements TypeToolsExtensionData {
  beforeimports: ((data: any) => {})[];
  afterimports: ((target: any) => {})[];
  import: (data: any, skel?: any, assignOnly?: boolean) => any;
}

export class DataImportable implements TypeToolsExtension {
  static getExtensionData(target: any, settings = DataImportableSettings): DataImportableExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionDataImportable, settings);
  }
  static typeCheck(target: any, settings = DataImportableSettings): boolean {
    return target && !!DataImportable.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = DataImportableSettings) {
    if (!TypeToolsBase.checkContext(DataImportable)) { return false; }
    if (!DataImportable.getExtensionData(target, settings)) {
      PropertiesController.implementOn(target);
      const manageOptions: PropertiesManagementOptions = { alwaysFront: true, order: 0 };
      const type: Class<any> = ClassLineage.typeOf(target);
      const skel = TypeToolsBase.getSkeleton(type);
      if (!skel) { throw new Error(`Type skeleton for ${type.name} not defined; this could be from duplicate models definitions`); }
      const keys = (skel as any).__tt_keys ? (skel as any).__tt_keys : Object.keys(skel);
      const descriptorsRubric: PartialCustom<any, Partial<PropertyControlLayer>> = {};
      keys.forEach(key => {
        const prop = skel[key];
        if (TypeToolsBase.typeCheck(prop)) {
          if (prop._get_args) {
            descriptorsRubric[key] = { set: (value, e) => {
              if (value && value.constructor.name === 'Object') {
                e.transformValue(prop._stencil(target, value));
              }
            } }
          } else {
            descriptorsRubric[key] = { set: (value, e) => {
              if (value && value.constructor.name === 'Object') {
                const cast = Context.cast(value, ClassLineage.typeOf(prop));
                if (cast) { e.transformValue(cast); }
              }
            } }
          }
        }
      });
      PropertiesController.manage(target, manageOptions, descriptorsRubric);
      const extension: DataImportableExtensionData = {
        beforeimports: [],
        afterimports: [],
        import(data: any, skel?: any, assignOnly?: boolean) {
          if (!data) { data = {}; }
          if (!assignOnly) {
            for (const beforeimport of extension.beforeimports) { beforeimport(data); }
          }
          TypeToolsBase.topCancel = TypeToolsBase.topError = null;
          const sourceType = Context.beforeDefCurrent ? Context.beforeDefCurrent : Context.current ? Context.current : null;
          if (!skel) { skel = sourceType ? TypeToolsBase.getSkeleton(sourceType) : target; }
          const keys = (skel as any).__tt_keys ? (skel as any).__tt_keys : Object.keys(skel);
          let error: Error;
          let canceled = false;
          let prevValues: any;
          if (assignOnly) {
            for (const memberName of keys) {
              let propValue = data[memberName];
              if (propValue !== undefined) {
                const skelData = skel[memberName];
                if (skelData && TypeToolsBase.typeCheck(skelData)) {
                  if (skelData._get_args) {
                    propValue = skelData._stencil(target, propValue);
                  } else if (propValue && propValue.constructor.name === 'Object') {
                    const cast = Context.cast(propValue, ClassLineage.typeOf(skelData));
                    if (cast) { propValue = cast; }
                  }
                }
                try {
                  target[memberName] = propValue;
                  if (TypeToolsBase.topError) { error = TypeToolsBase.topError; break; }
                  if (TypeToolsBase.topCancel) { canceled = true; break; }
                } catch (e) { error = e; break; }
              }
            }
          } else {
            prevValues = {};
            for (const memberName of keys) {
              let propValue = data[memberName];
              if (propValue !== undefined) {
                const skelData = skel[memberName];
                if (skelData && TypeToolsBase.typeCheck(skelData)) {
                  if (skelData._get_args) {
                    propValue = skelData._stencil(target, propValue);
                  } else if (propValue && propValue.constructor.name === 'Object') {
                    const cast = Context.cast(propValue, ClassLineage.typeOf(skelData));
                    if (cast) { propValue = cast; }
                  }
                }
                try {
                  prevValues[memberName] = target[memberName];
                  target[memberName] = propValue;
                  if (TypeToolsBase.topError) { error = TypeToolsBase.topError; break; }
                  if (TypeToolsBase.topCancel) { canceled = true; break; }
                } catch (e) { error = e; break; }
              }
            }
          }
          if (assignOnly) { if (error) { throw error; } else { return target; } }
          if (error || canceled) { // revert to previous values on error;
            for (const memberName of Object.keys(prevValues)) {
              try { target[memberName] = prevValues[memberName]; } catch (e) {}
            }
            if (error && Context.throwErrors) { throw error; }
            return null;
          } else {
            if (data._meta) { TypeToolsBase.addMetaProperty(target, data._meta, true); }
            for (const afterimport of extension.afterimports) { afterimport(data); }
          }
          return target;
        }
      };
      TypeToolsBase.addExtension(target, settings.extensionDataImportable, extension);
    }
    return true;
  }

  settings: DataImportableSettings;

  constructor(settings?: Partial<DataImportableSettings>) {
    this.settings = settingsInitialize(DataImportableSettings, settings);
  }

  getExtensionData(target: any) { return DataImportable.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return DataImportable.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return DataImportable.implementOn(target, this.settings as any); }
}
