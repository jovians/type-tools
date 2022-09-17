/* Jovian (c) 2020, License: MIT */
import { ixConfig } from './ix.config';
import { Entity } from './ix.entity';
import { HalfLifed } from './ix.halflifed';

interface HotBlock {
  last: number;
  threshold: number;
  tracker: HalfLifed;
  passed: boolean;
}

export function hotblock(bindTarget: any, lockName: string, threshold: number = ixConfig.hotblock.threshold,
                         initialValue: number = 0, halflife: number = ixConfig.hotblock.halflife) {
  if (!bindTarget) { return null; }
  const hbkey = `__ixe_hotblock_${lockName}`;
  let hbObj = bindTarget[hbkey] as HotBlock;
  if (!hbObj) {
    hbObj = {
      tracker: new HalfLifed({ hl: halflife, v: initialValue }),
      last: 0,
      threshold,
      passed: false
    };
    if (bindTarget instanceof Entity) {
      bindTarget.lcManage(hbObj.tracker);
    }
    Object.defineProperty(bindTarget, hbkey, { value: hbObj });
  }
  if (hbObj.tracker.value <= hbObj.threshold) {
    hbObj.passed = true;
    hbObj.last = Date.now();
    hbObj.tracker.add(1);
  } else {
    hbObj.passed = false;
  }
  return hbObj;
}

/** HotBlockInit: allow first one, and every roughly 1 second after */
export function hbiLong(bindTarget: any, lockName: string) { return hotblock(bindTarget, lockName, 4, 4); }
/** HotBlockInit: allow first one, and every roughly 0.5 second after */
export function hbi(bindTarget: any, lockName: string) { return hotblock(bindTarget, lockName, 9, 9); }
