/* Jovian (c) 2020, License: MIT */

import { promise } from "./common/globals.ix";

export type PartialAny<T> = { [P in keyof T]?: any; };

export type PartialCustom<T, S = any> = { [P in keyof T]?: S; };

export type PartialCustomWith<T, S, A> = PartialCustom<T, S> & A;

export type FullCustom<T, S = any> = { [P in keyof T]: S; };

export type FullRequire<T> = { [P in keyof T]: T[P]; };

export type HasNoExtraProp<Base, Operand> = 
  (keyof Base | keyof Operand) extends keyof Base
    ? keyof Base extends (keyof Base | keyof Operand)
      ? 'true'
    : 'false'
  : 'false'

export type GetFormerIfNoExtraProp<Base, Operand> = HasNoExtraProp<Base, Operand> extends 'true' ? Base : Impossible<keyof Base>;
export type GetLatterIfNoExtraProp<Base, Operand> = HasNoExtraProp<Base, Operand> extends 'true' ? Operand : Impossible<keyof Operand>;

export interface PartialSettings {
  settings?: any;
}

export type Intersect<A, B> = {
  [P in keyof A & keyof B]: A[P] | B[P];
}
export type Impossible<K extends keyof any> = {
  [P in K]: never;
};
export type NoExtra<T, U extends T = T> = U & Impossible<Exclude<keyof U, keyof T>>;

export type RequireProp<T extends {}, K extends keyof T> = Omit<T, K> & {
  [MK in K]-?: NonNullable<T[MK]>
};

// tslint:disable-next-line: callable-types
export interface Class<T> {
  new (...args): T;
  name: string;
}

export type ClassStaticTemplate<T, StaticTemplate> = Class<T> & StaticTemplate;

// tslint:disable-next-line: callable-types
export interface InitiableClass<T> {
  new (init: Partial<T>, ...args): T;
  name: string;
}

// https://stackoverflow.com/a/58715632
export type Unshift<H, T extends readonly any[]> =
    ((arg: H, ...argN: T) => void) extends ((...r: infer R) => void) ? R : never;

export type Push<T extends readonly any[], V> = Unshift<any, T> extends infer A ?
    { [K in keyof A]: K extends keyof T ? T[K] : V } : never;

export type AddFunctionArg<F extends (...args) => any, ExtraParam> =
    (...args: Extract<Push<Parameters<F>, ExtraParam>, readonly any[]>)
        => ReturnType<F>;

// https://stackoverflow.com/a/54986490
export function autoImplement<T>(): new () => T {
  return class { } as any;
}

// tslint:disable-next-line: class-name
export class _ { a = 0; }

// tslint:disable-next-line: max-line-length
export type TypedSpreader<A1= _, A2= _, A3= _, A4= _, A5= _, A6= _, A7= _, A8= _, A9= _, A10= _, A11= _, A12= _, A13= _, A14= _, A15= _, A16= _, END= _>
  = A1 extends _ ? []
  : A2 extends _ ? [A1]
  : A3 extends _ ? [A1, A2]
  : A4 extends _ ? [A1, A2, A3]
  : A5 extends _ ? [A1, A2, A3, A4]
  : A6 extends _ ? [A1, A2, A3, A4, A5]
  : A7 extends _ ? [A1, A2, A3, A4, A5, A6]
  : A8 extends _ ? [A1, A2, A3, A4, A5, A6, A7]
  : A9 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8]
  : A10 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9]
  : A11 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10]
  : A12 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11]
  : A13 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12]
  : A14 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13]
  : A15 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14]
  : A16 extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15]
  : END extends _ ? [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14, A15, A16]
  : any[];

export type MergeClass<Source, NewProps> = {
  [U in (keyof Source | keyof NewProps)]:
    U extends keyof NewProps ? NewProps[U]
    : U extends keyof Source ? Source[U]
    : string;
}

export type MergeClassPartial<Source, NewProps> = {
  [U in (keyof Source | keyof NewProps)]?:
    U extends keyof NewProps ? NewProps[U]
    : U extends keyof Source ? Source[U]
    : string;
}

export type PromiseCollapse<A0> =
  A0 extends Promise<Promise<Promise<Promise<Promise<infer X>>>>> ? X
    : A0 extends Promise<Promise<Promise<Promise<infer X>>>> ? X
    : A0 extends Promise<Promise<Promise<infer X>>> ? X
    : A0 extends Promise<Promise<infer X>> ? X
    : A0 extends Promise<infer X> ? X : A0;

export type TaggedTemplateSelfChain<T, S extends any[] = any[]> = T & ((strArr: TemplateStringsArray, ...args: S) => TaggedTemplateSelfChain<T>);

export function punchGrab<T = any>(res: T): PromiseCollapse<T> {
  return promise(async (resolve, reject) => {
    try {
      while ((res as any)?.then) { (res as any) = await res; }
      return resolve(res);
    } catch (e) {
      return reject(e);
    }
  }) as any;
}

export type configBoolean = true | false | 1 | 0;
export type configTrue = true | 1;
export type configFalse = false | 0;

export function as<T>(v?: any) {
  return v as T;
}

type RequiredType = boolean | Class<any>;
export const required: RequiredType = true;
