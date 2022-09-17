/* Jovian (c) 2020, License: MIT */

import { base58Encode } from "./base58.util";
import { ClassSettings } from "./env.util";
import { utilSha512 } from "./sha512.util";
import { spot } from "./stack.util";

export type MessageConstructor = (...args) => string;

interface EnumInfo {
  name: string;
  code: string;
  message: string;
  codeNumeric?: number;
}

interface EnumErrorHistory {
  firstSource: string, first: Error, last: Error, history: Error[]
}

function getEnumData(e: EnumType) {
  if (!(e as any).__enum_data) { Object.defineProperty(e, '__enum_data', { value: {} }); }
  if (!(e as any).__error_history) { Object.defineProperty(e, '__error_history', { value: {} }); }
  return (e as any).__enum_data as unknown as { [key: string]: EnumInfo };
}

function getEnumErrorHistory(e: EnumType) {
  if (!(e as any).__enum_data) { Object.defineProperty(e, '__enum_data', { value: {} }); }
  if (!(e as any).__error_history) { Object.defineProperty(e, '__error_history', { value: {} }); }
  return (e as any).__error_history as unknown as { [key: string]: EnumErrorHistory };
}

export class EnumType {
  static prefix = 'X_';
  static genericSuccessCode = 'X__SUCCESS_GENERIC';
  static reuseErrorObject = true;
  static protectedSettings = ClassSettings.protect(this);
  constructor(...init: {[name: string]: any;}[]) {
    this.SUCCESS = this.add('SUCCESS', 'generic success', null, EnumType.genericSuccessCode);
    const keysMap = {};
    const collisions = [];
    for (let i = 0; i < init.length; ++i) {
      const enumObj = init[i];
      if (!enumObj) { continue; }
      for (const name of Object.keys(enumObj)) {
        if (name === 'SUCCESS') { continue; }
        const firstChar = name.charCodeAt(0);
        const isNumeric = (firstChar >= 48 && firstChar <= 57);
        if (!isNumeric) {
          if (keysMap[name]) { collisions.push(name); continue; }
          this[name] = this.add(name);
          keysMap[name] = enumObj;
        }
      }
    }
    if (collisions.length > 0) {
      throw new Error(`enumJoin failed due to collisions: ${collisions.join(', ')}`)
    }
  }
  SUCCESS = '';
  add(name: string, message?: string, codeNumeric?: number, codeOverride?: string) {
    // roughly the same entropy as 10-byte long
    const code = codeOverride ? codeOverride : EnumType.prefix + base58Encode(utilSha512(name)).substring(0, 14);
    const enumData = getEnumData(this);
    const enumInfo: EnumInfo = { name, code, message, codeNumeric };
    const prevReg = enumData[name] || enumData[code];
    if (prevReg) {
      const regInfo = codeNumeric >= 0 ? `${name}:${codeNumeric}` : name;
      const numericInfo = codeNumeric >= 0 ? `, numeric=${codeNumeric}` : '';
      throw new Error(`Cannot add '${regInfo}' to this enum; already registered ` +
                      `with '${prevReg.name}' (code=${prevReg.code}${numericInfo})`);
    }
    if (!enumData[name]) { enumData[name] = enumInfo; }
    if (!enumData[code]) { enumData[code] = enumInfo; }
    return code;
  }
  addErrorHistory(e: Error, code: string) {
    const name = this.getByCode(code).name;
    const historyData = getEnumErrorHistory(this);
    const source = spot(e);
    let errorCodeHistory = historyData[code];
    if (!errorCodeHistory) {
      errorCodeHistory = historyData[code] = { firstSource: source, first: null, last: null, history: [] };
    }
    if ((this as any).uniqueMode && source !== errorCodeHistory.firstSource) {
      throw new Error(
        `Cannot use the same error enum code (${name}) again ` +
        `in a different source location. ` +
        `(uniqueMode=1, firstSource=${errorCodeHistory.firstSource}, currentSource=${source})`
      );
    }
    if (!errorCodeHistory.first) { errorCodeHistory.first = e; }
    errorCodeHistory.last = e;
    if (!(this as any).__error_reuse?.enabled) {
      errorCodeHistory.history.push(e);
    }
  }
  setErrorObjectReuse(v: boolean) {
    if (!(this as any).__error_reuse) {
      Object.defineProperty(this, '__error_reuse', { value: { enabled: v } });
    }
    (this as any).__error_reuse.enabled = v;
  }
  getByName(name: string) {
    const enumData = getEnumData(this);
    return enumData[name];
  }
  getByCode(code: string | number) {
    const enumData = getEnumData(this);
    return enumData[code];
  }
  getMessage(code: string | number) {
    const enumData = getEnumData(this);
    return enumData[code]?.message;
  }
  getErrorHistory(code: string) {
    const historyData = getEnumErrorHistory(this);
    return historyData[code];
  }
  ok<DataType = any, MetaInfoType = any>(
    data?: DataType,
    misc?: Partial<GenericResult<DataType, MetaInfoType>>,
  ) {
    if (!misc.code) { misc.code = EnumType.genericSuccessCode; }
    if (!misc.codeName) { misc.codeName = this.getByCode(misc.code).name; }
    return okResult<DataType, MetaInfoType>(data, misc);
  }
  error<DataType = any, MetaInfoType = any>(
    codeName: keyof this,
    errorOverride?: string | MessageConstructor | Error,
    misc?: Partial<GenericResult<DataType, MetaInfoType>>,
  ) {
    // Takes about ~0.5ms for reuseErrorObject disabled (500ms per 1,000) as 'new Error' is costly due to stack generation.
    // Takes about ~1us for reuseErrorObject enabled (1000ms per 1,000,000)
    const info = this.getByName(codeName as string);
    const code = info.code;
    let reusableError: Error;
    if((this as any).__error_reuse?.enabled) {
      reusableError = this.getErrorHistory(info.code)?.first;
      // if (reusableError) { reusableError = Object.assign({}, reusableError); }
    }
    let error: Error;
    let message: string;
    if (errorOverride instanceof Error) {
      if (!errorOverride.message) { errorOverride.message = ''; }
      message = `[${codeName as string}::${code}] ${errorOverride.message}`
      error = reusableError ? reusableError : new Error(errorOverride.message);
      this.addErrorHistory(error, code);
      error.stack = errorOverride.stack;
    } else {
      if (errorOverride) {
        message = typeof errorOverride === 'string' ? errorOverride : errorOverride();
      } else {
        message = info.message;
      }
      if (!message) { message = ''; }
      message = `[${codeName as string}::${code}] ${message}`;
      error = reusableError ? reusableError : new Error(message);
      this.addErrorHistory(error, code);
    }
    const baseObj: any = {};
    if ((this as any).codeFamily) { baseObj.codeFamily = (this as any).codeFamily; }
    Object.assign(baseObj, { codeName, code, message });
    if (reusableError) { reusableError.message = message; }
    Object.assign(baseObj, misc);
    return errorResult<DataType, MetaInfoType>(error, baseObj);
  }
}

export class GenericResult<DataType = any, MetaInfoType = any> {
  static lastError: GenericResult = null;
  static lastOk: GenericResult = null;

  status: 'ok' | 'error';
  /** Hashed unique code string (e.g. X_ABCDEF12346789 | ... ) */
  code: string;
  /** Name of return code (e.g. SUCCESS | FAILURE_CODE_2 | ... ) */
  codeName?: string;
  /** Numeric representation of return code (e.g. 200 | 404 | ... ) */
  statusCode?: number;
  codeFamily?: string;
  data?: DataType;
  meta?: MetaInfoType;
  message?: string;
  otherResults?: {
    list?: GenericResult[];
    byIndex?: {[indexKey: string]: GenericResult[]};
  };
  info?: any;
  private errorObject?: Error;

  constructor(init?: Partial<GenericResult<DataType, MetaInfoType>>) {
    if (init) { Object.assign(this, init); }
    if ((init as any).errorStack) {
      this.errorObject = new Error((init as any).errorMessage);
      this.errorObject.stack = (init as any).errorStack;
    }
  }

  get ok() { return this.status === 'ok'; }
  get good() { return this.status === 'ok'; }
  get passed() { return this.status === 'ok'; }
  get bad() { return this.status !== 'ok'; }
  get failed() { return this.status !== 'ok'; }
  get error() {
    if (this.status !== 'ok') {
      return this.errorObject ? this.errorObject : (true as unknown as Error);
    } else {
      return this.errorObject;
    }
  }
  set error(e: Error) { this.errorObject = e; }

  isResultKind() { return true; }
  toJSON() {
    return {
      status: this.status ? this.status : 'error',
      code: this.code,
      codeName: this.codeName,
      codeFamily: this.codeFamily,
      statusCode: this.statusCode,
      data: this.data,
      meta: this.meta,
      message: this.message,
      errorMessage: this.errorObject ? this.errorObject.message : null,
      errorStack: this.errorObject ? this.errorObject.message : null,
    };
  }
  toString() { return JSON.stringify(this); }
}

export { GenericResult as Result };

export function okResult<DataType = any, MetaInfoType = any>(data: DataType, misc?: Partial<GenericResult<DataType, MetaInfoType>>) {
  const init: Partial<GenericResult<DataType, MetaInfoType>> = { status: 'ok', data, code: EnumType.genericSuccessCode };
  if (misc) { Object.assign(init, misc); }
  const okres = new GenericResult<DataType, MetaInfoType>(init);
  GenericResult.lastError = null;
  GenericResult.lastOk = okres;
  return okres;
}

export { okResult as ok };

export function partialOkResult<DataType = any, MetaInfoType = any>(data: DataType, misc: Partial<GenericResult<DataType, MetaInfoType>>) {
  return okResult(data, misc);
}

export { partialOkResult as partialOk };

export function errorResult<DataType = any, MetaInfoType = any>(error?: Error, misc?: Partial<GenericResult<DataType, MetaInfoType>>) {
  const init: Partial<GenericResult<DataType, MetaInfoType>> = { status: 'error', error };
  if (misc) { Object.assign(init, misc); }
  const eres = new GenericResult<DataType, MetaInfoType>(init);
  GenericResult.lastError = eres;
  GenericResult.lastOk = null;
  return eres;
}

export function passthruResult<DataType = any, MetaInfoType = any>(obj?: GenericResult<DataType, MetaInfoType>): GenericResult {
  if (!obj) { return passthruCurrent(); }
  return obj as unknown as GenericResult;
}

export { passthruResult as passthru };

export { passthruResult as passthruError };

export function passthruCurrent<DataType = any, MetaInfoType = any>(): GenericResult {
  let obj;
  if (GenericResult.lastError) { obj = GenericResult.lastError; }
  else if (GenericResult.lastOk) { obj = GenericResult.lastOk; }
  if (!obj) {
    throw new Error(`Cannot passthru result that is null`);
  }
  return obj as unknown as GenericResult;
}

type un = unknown;
type errorType<CodeName> = <DataType = any, MetaInfoType = any>
                              (codeName: CodeName,
                               errorOverride?: string | MessageConstructor | Error,
                               misc?: Partial<GenericResult<DataType, MetaInfoType>>)
                                => GenericResult<DataType, MetaInfoType>;

/**
 * Constructs Enum object from many enum-like objects
 * 
 * e.g.
 * 
 * ```typescript
 * enum MyErrorCodesEnum {
 *   MY_ERROR_CODE,
 * }
 * enum MyErrorCodesEnumSecond {
 *   MY_ERROR_CODE2,
 * }
 * const AllErrorCodes = EnumJoin(MyErrorCodesEnum, MyErrorCodesEnumSecond)
 * AllErrorCodes.MY_ERROR_CODE // some unique error hash
 * AllErrorCodes.MY_ERROR_CODE2 // some unique error hash
 * ```
 * 
 * @param a... enum-like objects
 * @returns conjoined Enum object
 */
export function EnumJoin<A=un,B=un,C=un,D=un,E=un,F=un,G=un,H=un,I=un,J=un>(a:A,b?:B,c?:C,d?:D,e?:E,f?:F,g?:G,h?:H,i?:I,j?:J) {
  type CodeName = (keyof A) | (keyof B) | (keyof C) | (keyof D) | (keyof E) |
                      (keyof F) | (keyof G) | (keyof H) | (keyof I) | (keyof J);
  type FullClassEnumProps = (keyof EnumType) | 'uniqueMode' | 'codeFamily' | CodeName;
  type EnumJoined = {
    [U in FullClassEnumProps]:
      U extends 'add' ? EnumType['addErrorHistory']
      : U extends 'addErrorHistory' ? EnumType['addErrorHistory']
      : U extends 'getByName' ? EnumType['getByName']
      : U extends 'getByCode' ? EnumType['getByCode']
      : U extends 'getMessage' ? EnumType['getMessage']
      : U extends 'getErrorHistory' ? EnumType['getErrorHistory']
      : U extends 'setErrorObjectReuse' ?  EnumType['setErrorObjectReuse']
      : U extends 'uniqueMode' ? boolean
      : U extends 'codeFamily' ? string
      : U extends 'ok' ? EnumType['ok']
      /**
       * Test
       */
      : U extends 'error' ? errorType<CodeName>
      : string;
  };
  const enumObj = new EnumType(a, b, c, d, e, f, g, h, i, j) as unknown as EnumJoined;
  if (EnumType.reuseErrorObject) { enumObj.setErrorObjectReuse(true); }
  return enumObj;
}

/**
 * Constructs Enum object from enum-like objects, which makes sure that each error code is consumed in one place during runtime
 * 
 * This is to ensure that each unique error code is consume EXACTLY ONCE in
 * the codebase per constructed error code set, which will enforce unique error code for every error scenario
 * (no more vague error code that will point to multiple possible issues)
 * 
 * e.g.
 * 
 * ```typescript
 * enum MyErrorCodesEnum {
 *   MY_ERROR_CODE,
 *   ...
 * }
 * 
 * const MyErrorCodes = Unum(MyErrorCodesEnum)
 * 
 * function thisFunctionConsumesMyErrorCode() {
 *    return MyErrorCodes.error('MY_ERROR_CODE');
 * }
 * 
 * function thisFunctionAlsoConsumesMyErrorCode() {
 *    return MyErrorCodes.error('MY_ERROR_CODE');
 * }
 * 
 * thisFunctionConsumesMyErrorCode() // succeeds
 * thisFunctionConsumesMyErrorCode() // succeeds
 * thisFunctionConsumesMyErrorCode() // succeeds
 * 
 * thisFunctionAlsoConsumesMyErrorCode() // fails, MY_ERROR_CODE can only be consumed in ONE place
 * ```
 * 
 * @param a... enum-like objects
 * @returns conjoined Enum object that makes sure that each error code is consumed in one place during runtime
 */
export function Unum<A=un,B=un,C=un,D=un,E=un,F=un,G=un,H=un,I=un,J=un>(a:A,b?:B,c?:C,d?:D,e?:E,f?:F,g?:G,h?:H,i?:I,j?:J) {
  const enumObj = EnumJoin(a,b,c,d,e,f,g,h,j);
  Object.defineProperty(enumObj, 'uniqueMode', { value: true, writable: true });
  return enumObj;
}

/**
 * Constructs Enum object from many enum-like objects
 * 
 * e.g.
 * 
 * ```typescript
 * enum MyErrorCodesEnum {
 *   MY_ERROR_CODE,
 * }
 * enum MyErrorCodesEnumSecond {
 *   MY_ERROR_CODE2,
 * }
 * const AllErrorCodes = ResultEnum(MyErrorCodesEnum, MyErrorCodesEnumSecond)
 * AllErrorCodes.MY_ERROR_CODE // some unique error hash
 * AllErrorCodes.MY_ERROR_CODE2 // some unique error hash
 * ```
 * 
 * @param codeFamilyName name of this return code family enum
 * @param a... enum-like objects
 * @returns conjoined Enum object
 */
export function ReturnCodeFamily<A=un,B=un,C=un,D=un,E=un,F=un,G=un,H=un,I=un,J=un>(codeFamilyName:string,a:A,b?:B,c?:C,d?:D,e?:E,f?:F,g?:G,h?:H,i?:I,j?:J) {
  const enumObj = EnumJoin(a,b,c,d,e,f,g,h,j);
  Object.defineProperty(enumObj, 'codeFamily', { value: codeFamilyName, writable: true });
  return enumObj;
}
