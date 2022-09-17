/* Jovian (c) 2020, License: MIT */

export class StackUtilSourceMapEnv {
  static isBrowser = false;
  static isTypescript = false;
}

export function spot(e = new Error(), step = 2) {
  let source: string;
  if (e.stack.startsWith('Error') && !StackUtilSourceMapEnv.isTypescript) { // js error
    const targetLine = e.stack.split('\n')[step];
    if (!targetLine) { return null; }
    if (targetLine.charAt(targetLine.length - 1) === ')'){
      source = targetLine.split('/').pop().split(')')[0];
    } else {
      source = targetLine.split('/').pop();
    }
  } else { // source-map ts error
    let stack: string;
    if (StackUtilSourceMapEnv.isBrowser) {
      const stackLit = e.stack.split('\n    at');
      stackLit.shift();
      stack = '\n    at' + stackLit.join('\n    at');
    } else {
      const stackLit = e.stack.split('\nError');
      stackLit.shift();
      stack = stackLit.join('\nError');
    }
    const targetLine = stack.split('\n')[step];
    if (!targetLine) { return null; }
    if (targetLine.charAt(targetLine.length - 1) === ')'){
      source = targetLine.split('/').pop().split(')')[0];
    } else {
      source = targetLine.split('/').pop();
    }
  }
  return source;
}

export function spotfull(e = new Error(), step = 2) {
  let source: string;
  if (e.stack.startsWith('Error') && !StackUtilSourceMapEnv.isTypescript) { // js error
    const targetLine = e.stack.split('\n')[step];
    if (!targetLine) { return null; }
    if (targetLine.charAt(targetLine.length - 1) === ')'){
      source = targetLine.split('(')[1].split(')')[0];
    } else {
      source = targetLine.split('at ')[1];
    }
  } else { // source-map ts error
    let stack: string;
    if (StackUtilSourceMapEnv.isBrowser) {
      const stackLit = e.stack.split('\n    at');
      stackLit.shift();
      stack = '\n    at' + stackLit.join('\n    at');
    } else {
      const stackLit = e.stack.split('\nError');
      stackLit.shift();
      stack = stackLit.join('\nError');
    }
    const targetLine = stack.split('\n')[step];
    if (!targetLine) { return null; }
    if (targetLine.charAt(targetLine.length - 1) === ')'){
      source = targetLine.split('(')[1].split(')')[0];
    } else {
      source = targetLine.split('at ')[1];
    }
  }
  return source;
}