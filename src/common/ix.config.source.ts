/* Jovian (c) 2020, License: MIT */

import { BehaviorSubject, Observable } from 'rxjs';
import { Class } from '../type-transform';

export class ConfigSource<T> {
  private configData: T;
  private configBehaviorSubject: BehaviorSubject<T>;
  private configObservable$: Observable<T>;
  constructor(configClass: Class<T>, configPartialData: Partial<T>) {
    this.configData = new configClass(configPartialData);
    this.configBehaviorSubject = new BehaviorSubject<T>(this.configData);
  }
  getConfigData() { return this.configData; }
  get config() { return this.configData; }
  get change$() {
    if (!this.configObservable$) {
      this.configObservable$ = this.configBehaviorSubject.asObservable();
    }
    return this.configObservable$;
  }
}
