/* Jovian (c) 2020, License: MIT */

import { spotfull, StackUtilSourceMapEnv } from "./stack.util";

declare var process;
declare var window;

export const isNodeJs = (typeof process !== 'undefined') && (process.release.name === 'node');

export const debugLogHead = `\n-------------------------------- DEBUG_LOG_START --------------------------------\n`;
export const debugLogTail = `\n--------------------------------  DEBUG_LOG_END  --------------------------------\n`;

const colorWhite = '\x1b[37m%s\x1b[0m';
const colorYellow = '\x1b[33m%s\x1b[0m';
const colorGray = '\x1b[90m%s\x1b[0m';
const colorEnd = `\x1b[0m`;
export const dpColor = {
  colorEnabled: false,
  color: colorWhite,
  metaColorEnabled: isNodeJs,
  metaColor: colorGray,
  end: colorEnd,
};

export const ansiColorMap = {
  // black: { fg: 30, bg: 40 }
  white: { fg: 37, bg: 47, normal: colorWhite },
  yellow: { fg: 33, bg: 43, normal: colorYellow },
};

// function getColor(color)

function dpDisplay(source: string, color: keyof typeof ansiColorMap, sectioned: boolean, args: any[]) {
  let activeColor: string;
  if (color && !activeColor) { activeColor = ansiColorMap?.[color]?.normal; }
  if (!activeColor) { activeColor = dpColor.color; }
  sectioned ? console.group() : null;
  if (!StackUtilSourceMapEnv.isBrowser) {
    dpColor.metaColorEnabled ? 
      console.log(dpColor.metaColor, `${sectioned ? debugLogHead : ''}src: ${source}${sectioned ? '\n' : ''}`, dpColor.end)
      : console.log(`${sectioned ? debugLogHead : ''}src: ${source}${sectioned ? '\n' : ''}`);
    console.group();
  } else {
    console.group(`${sectioned ? debugLogHead : ''}src: ${source}${sectioned ? '\n' : ''}`);
  }
  dpColor.colorEnabled ?
    console.log(activeColor, ...args, dpColor.end)
    : console.log(...args);
  console.groupEnd();
  dpColor.metaColorEnabled ? 
    console.log(dpColor.metaColor, `${sectioned ? debugLogTail : ''}`, dpColor.end)
    : sectioned ? console.log(debugLogTail) : null;
  sectioned ? console.groupEnd() : null;
}

const dptRegistry: {[name: string]: { start?: number; iterationCount?: number } } = {};

/**
 * Debug print timer
 */
export function dpt(name?: string, iterationCount?: number, ...args) {
  if (!name) { name = 'unnamed'; }
  const t = Date.now();
  if (!dptRegistry[name]) {
    dptRegistry[name] = { start: t, iterationCount };
    args.unshift(`dpt timer '${name}' started`);
    dpDisplay(spotfull(new Error, 2), null, false, args);
  } else {
    const reg = dptRegistry[name];
    const startT = reg.start;
    const iterationCount = reg.iterationCount;
    delete dptRegistry[name];
    const delta = t - startT;
    const perItemDuration = iterationCount ? ` (${delta * 1000 / iterationCount} us/count)` : '';
    args.unshift(`dpt timer '${name}' ended; total ${delta} ms taken${perItemDuration}`);
    dpDisplay(spotfull(new Error, 2), null, false, args);
  }
}


/**
 * Debug print
 */
export function dpa(...args) { dpDisplay(new Error().stack, null, false, args); }

/**
 * Debug print
 */
export function dp(...args) { dpDisplay(spotfull(new Error, 2), null, false, args); }

/**
 * Debug print
 */
export function dp2(...args) { dpDisplay(spotfull(new Error, 3), null, false, args); }

/**
 * Debug print
 */
export function dp3(...args) { dpDisplay(spotfull(new Error, 4), null, false, args); }

/**
 * Debug print
 */
export function dp4(...args) { dpDisplay(spotfull(new Error, 5), null, false, args); }

/**
 * Debug print section
 */
export function dphead(headerSectionName: string) {
  const sectionDivider = '================================================================';
  dpDisplay(spotfull(new Error, 2), null, false, [
    colorYellow,
    `${sectionDivider}\n\n    ${headerSectionName}\n\n${sectionDivider}`,
    colorEnd,
  ]);
}

let displayClassSettings = false;
let showClassSettingsStack = false;
let withinClassSettingsCall = false;
const classSettingsSources: Error[] = [];
export const ClassSettings = {
  display: () => {
    displayClassSettings = true;
    const e = new Error(`[ClassSetting] display`);
    showClassSettingsStack ? dp2(e) : dp2(e.message);
  },
  showStack: () => {
    displayClassSettings = true;
    showClassSettingsStack = true;
    const e = new Error(`[ClassSettings] showStack`);
    classSettingsSources.push(e);
    dp2(e);
  },
  set: (fn: Function) => {
    if (withinClassSettingsCall) {
      throw new Error(`[ClassSettings] Cannot ClassSettings.set within ClassSettings.set`);
    }
    withinClassSettingsCall = true;
    if (displayClassSettings) {
      const e = new Error(`[ClassSettings] modified: ${fn}`);
      classSettingsSources.push(e);
      showClassSettingsStack ? dp2(e) : dp2(e.message);
    }
    let settingError: Error;
    try { fn(); } catch (e) { settingError = e; }
    withinClassSettingsCall = false;
    if (settingError) { throw settingError; }
  },
  protect: <T>(type: T, ...settings: (keyof T)[]) => {
    const protectedList: (keyof T)[] = [];
    if (settings.length === 0) { settings = Object.keys(type) as any; }
    for (const setting of settings) {
      const settingValue = type[setting] as any;
      if (settingValue && settingValue.call && settingValue.apply) { continue; }
      protectSetting(type, setting);
      protectedList.push(setting);
    }
    return protectedList;
  }
};
Object.freeze(ClassSettings);

function protectSetting<T>(type: T, setting: keyof T) {
  let settingValue = type[setting];
  const typename = (type as any).name;
  const settingPath = typename ? `${typename}.${String(setting)}` : setting;
  Object.defineProperty(type, setting, {
    get() { return settingValue; },
    set(newValue) {
      if (!withinClassSettingsCall) {
        throw new Error(`[ClassSettings] Cannot change protected config '${String(settingPath)}' outside ClassSettings.set`);
      }
      settingValue = newValue;
    },
  });
}
