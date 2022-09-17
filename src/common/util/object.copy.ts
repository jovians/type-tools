
export function deepCopy(obj: any) {
  if (global.structuredClone) {
    return global.structuredClone(obj);
  } else {
    const v8 = require('v8');
    return v8.deserialize(v8.serialize(obj));
  }
}
