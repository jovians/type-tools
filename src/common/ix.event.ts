/* Jovian (c) 2020, License: MIT */
import { Subject } from 'rxjs';
import { Entity, MajorScope } from './ix.entity';

export class Event {
  name: string;
  entity: Entity;
  appliesTo: {[ixId: string]: Entity} = {};
  scope: MajorScope;
  data: any;
  constructor(name: string, data?: any, entity?: Entity) {
    this.name = name;
    this.data = data;
    if (entity) {
      this.entity = entity;
      this.scope = entity.ixMajorScope;
    }
  }
}
const eventSubject = new Subject<Event>();
export function eventCast(evtName: string, evtData: any, sourceEntity?: Entity) {
  const e = new Event(evtName, evtData, sourceEntity);
  if (!e.appliesTo) { e.appliesTo = {}; }
  if (sourceEntity) { e.appliesTo[sourceEntity.ixId] = sourceEntity; }
  eventSubject.next(e);
}
export const event$ = eventSubject.asObservable();
