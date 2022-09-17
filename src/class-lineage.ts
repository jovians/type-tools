/* Jovian (c) 2020, License: MIT */

import { Context } from './context';
import { TypeToolsBase, TypeToolsExtensionData, TypeToolsExtension, TypeToolsSettings, settingsInitialize } from './type-tools';
import { Class } from './type-transform';
import { typeFullName } from './upstream/common.iface';

interface AncestorInfo {
  lastCommonAncestor: Class<any>;
  commonAncestors: Class<any>[];
  travel: number;
  distance: number;
  levelCompare: number;
  levelDifference: number;
  senior: any;
  junior: any;
}

const lcaCache: {[className: string]: AncestorInfo; } = {};
const lineageCache: {[className: string]: any} = {};

export class ClassLineageSettings extends TypeToolsSettings {
  static extensionClassLineage = 'ClassLineage';
  extensionEphemerals = ClassLineageSettings.extensionClassLineage;
  constructor(init?: Partial<ClassLineageSettings>) {
    super(init);
    if (init) { Object.assign(this, init); }
  }
}

export class ClassLineageExtensionData implements TypeToolsExtensionData {
  lineage: Class<any>[] = [];
}

export class ClassLineage implements TypeToolsExtension {
  static noCache = false;
  static getExtensionData(target: any, settings = ClassLineageSettings): ClassLineageExtensionData {
    return TypeToolsBase.getExtension(target, settings.extensionClassLineage, settings);
  }
  static typeCheck(target: any, settings = ClassLineageSettings): boolean {
    return target && !!ClassLineage.getExtensionData(target, settings);
  }
  static implementOn(target: any, settings = ClassLineageSettings) {
    if (!TypeToolsBase.checkContext(ClassLineage)) { return false; }
    if (!ClassLineage.getExtensionData(target, settings)) {
      const extension = new ClassLineageExtensionData();
      TypeToolsBase.addExtension(target, ClassLineageSettings.extensionClassLineage, extension);
    }
    return true;
  }
  static mapOut<T = any>(target: T, settings = ClassLineageSettings) {
    if (!ClassLineage.implementOn(target, settings)) { return; }
    const lineage = ClassLineage.of(target);
    ClassLineage.getExtensionData(target, settings).lineage = lineage;
    return lineage;
  }
  static mapOf<T>(target: T) {
    return ClassLineage.of(target, null, null, true) as unknown as {[parentName: string]: Class<any>};
  }
  static of<T = any>(target: T, topDown = true, getAsNames = false, getAsMap = false): Class<any>[] {
    const useCache = !ClassLineage.noCache;
    const lineage: Class<any>[] = [];
    const targetIsClass = !!(target as any).prototype && !!(target as any).constructor.name;
    if (targetIsClass) { // is Class<T>
      if (useCache) {
        const cached = lineageCache[typeFullName(target as any)];
        if (cached) {
          if (getAsMap) { return cached.mapped; }
          if (getAsNames) {
            return topDown ? cached.topDownNames : cached.bottomUpNames;
          } else {
            return topDown ? cached.topDown : cached.bottomUp;
          }
        }
      }
      target = TypeToolsBase.getSampleInstance(target as unknown as Class<any>);
    }
    let node = Object.getPrototypeOf(target);
    const topType = node.constructor;
    if (useCache) {
      const cached2 = lineageCache[typeFullName(topType as any)];
      if (cached2) {
        if (getAsMap) { return cached2.mapped; }
        if (getAsNames) {
          return topDown ? cached2.topDownNames : cached2.bottomUpNames;
        } else {
          return topDown ? cached2.topDown : cached2.bottomUp;
        }
      }
    }
    while (node && node.constructor.name !== 'Object') {
      lineage.push(node.constructor);
      node = Object.getPrototypeOf(node);
    }
    const mapped = {};
    for (const cls of lineage) { mapped[typeFullName(cls)] = cls; }
    const result = {
      topDown: lineage.reverse(),
      bottomUp: lineage,
      topDownNames: lineage.reverse().map(a => typeFullName(a)),
      bottomUpNames: lineage.map(a => typeFullName(a)),
      mapped
    };
    if (useCache) {
      lineageCache[typeFullName(topType as any)] = result;
    }
    if (getAsMap) { return result.mapped as any; }
    if (getAsNames) {
      return topDown ? result.topDownNames as any : result.bottomUpNames as any;
    } else {
      return topDown ? result.topDown : result.bottomUp;
    }
  }
  static typeOf<T = any>(target: T): Class<T> {
    return ClassLineage.of(target, false)[0];
  }
  static parentOf<T = any>(target: T): Class<any> {
    const parentClass = ClassLineage.of(target, false)[1];
    return parentClass ? parentClass : null;
  }
  static parentNameOf<T = any>(target: T): string {
    const parentClass = ClassLineage.of(target, false)[1];
    return parentClass ? typeFullName(parentClass) : null;
  }
  static namesOf<T = any>(target: T, topDown = true): string[] {
    return ClassLineage.of(target, topDown, true) as unknown as string[];
  }
  static commonAncestorsInfo<T1 = any, T2 = any>(target1: T1, target2: T2): AncestorInfo {
    const lineage1 = ClassLineage.of(target1, true);
    const lineage2 = ClassLineage.of(target2, true);
    const key = typeFullName(lineage1[0]) + ':' + typeFullName(lineage2[0]);
    if (!ClassLineage.noCache) {
      const cache = lcaCache[key];
      if (cache) { return cache; }
    }
    let travel = 0;
    let closestMatch: AncestorInfo;
    for (let i = 0; i < lineage1.length; ++i) {
      const parent1 = lineage1[i];
      for (let j = 0; j < lineage2.length; ++j) {
        const parent2 = lineage2[j];
        if (parent1 === parent2) {
          const commonAncestors = lineage2.slice(j);
          const levelCompare = j - i;
          const levelDifference = Math.abs(levelCompare);
          const distance = i + j;
          const senior = (levelDifference === 0) ? null : (i > j) ? target2 : target1;
          const junior = (levelDifference === 0) ? null : (i < j) ? target2 : target1;
          if (!closestMatch || closestMatch.travel > travel) {
            closestMatch = {
              commonAncestors,
              lastCommonAncestor: parent1,
              senior,
              junior,
              distance,
              travel,
              levelCompare,
              levelDifference,
            };
          }
        }
      }
      ++travel;
    }
    if (!closestMatch) {
      closestMatch = {
        commonAncestors: [],
        lastCommonAncestor: null,
        senior: null,
        junior: null,
        distance: Infinity,
        travel: Infinity,
        levelCompare: NaN,
        levelDifference: NaN,
      };
    }
    if (!ClassLineage.noCache) {
      lcaCache[key] = closestMatch;
    }
    return closestMatch;
  }
  static lastCommonAncestor<T1 = any, T2 = any>(target1: T1, target2: T2): Class<any> {
    return ClassLineage.commonAncestorsInfo(target1, target2).lastCommonAncestor;
  }
  static areRelated<T1 = any, T2 = any>(target1: T1, target2: T2): boolean {
    return ClassLineage.commonAncestorsInfo(target1, target2).lastCommonAncestor !== null;
  }
  static recentConstructorName() {
    try {
      return new Error().stack.split('\n')
                .filter(line => line.indexOf('at new ') >= 0)[0]
                .trim().split(' ')[2];
    } catch (e) { return null; }
  }
  static getContextSlow(target: any) {
    const name = ClassLineage.recentConstructorName();
    const lineage = ClassLineage.of(target);
    for (const parent of lineage) {
      if (name === parent.name) {
        return parent;
      }
    }
    return null;
  }

  settings: ClassLineageSettings;

  constructor(settings?: Partial<ClassLineageSettings>) {
    this.settings = settingsInitialize(ClassLineageSettings, settings);
  }

  getExtensionData(target: any) { return ClassLineage.getExtensionData(target, this.settings as any); }
  typeCheck(target: any) { return ClassLineage.typeCheck(target, this.settings as any); }
  implementOn(target: any) { return ClassLineage.implementOn(target, this.settings as any); }

  mapOut<T = any>(target: T) {
    return ClassLineage.mapOut(target, this.settings as any);
  }
}

Context.lineageMap = (a: any) => {
  return ClassLineage.of(a, null, null, true) as any;
}

Context.lineageHas = (a: any, type: Class<any>) => {
  const map =  ClassLineage.of(a, null, null, true) as any;
  return (map && map[typeFullName(type)]) ? true : false;
}
