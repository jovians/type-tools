/* Jovian (c) 2020, License: MIT */

export function completeConfig<T>(targetConfig: Partial<T>, defaultConfig: Partial<T>, directAssign = false, depth = 0): T {
  // clone both configs for base depth
  if (depth === 0) {
    if (targetConfig && typeof targetConfig === 'object' || Array.isArray(targetConfig)) {
      if (!directAssign) {
        targetConfig = JSON.parse(JSON.stringify(targetConfig));
      }
    }
    if (defaultConfig && typeof defaultConfig === 'object' || Array.isArray(defaultConfig)) {
      defaultConfig = JSON.parse(JSON.stringify(defaultConfig));
    }
  }
  if (targetConfig === null || targetConfig === undefined) {
    return defaultConfig as T;
  }
  if (defaultConfig) {
    if (Array.isArray(defaultConfig)) {
      return targetConfig as T;
    } else if (typeof defaultConfig === 'object') {
      for (const key of Object.keys(defaultConfig)) {
        targetConfig[key] = completeConfig(targetConfig[key], defaultConfig[key], false, depth + 1);
      }
    }
  }
  return targetConfig as T;
}