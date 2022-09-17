/* Jovian (c) 2020, License: MIT */

import { Subject } from 'rxjs';
import { Entity, MajorScope } from './ix.entity';

const errorSubject = new Subject<ScopedError>();
export class ScopedError extends Error {
  meta?: any;
  entity?: Entity;
  appliesTo?: {[ixId: string]: Entity} = {};
  scope?: MajorScope;
  severity?: number;
  constructor(message: string) { super(message); }
}
export function enscope(e: Error, sourceEntity: Entity) {
  if (sourceEntity && sourceEntity.ixMajorScope) {
    (e as any).entity = sourceEntity;
    (e as any).scope = sourceEntity.ixMajorScope;
  }
  return e as ScopedError;
}
export function errorCast(e: ScopedError, sourceEntity?: Entity) {
  e = enscope(e, sourceEntity);
  errorSubject.next(e);
}
export const error$ = errorSubject.asObservable();
