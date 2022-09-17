/* Jovian (c) 2020, License: MIT */

export function autoUnsub(component: any) {
  if (component && component.__rx_subs) {
    for (const sub of component.__rx_subs) {
      if (sub && sub.unsubscribe && sub.unsubscribe.call) {
        sub.unsubscribe();
      }
    }
  }
}
