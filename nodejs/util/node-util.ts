export function pathNavigate(path: string[], store: any) {
  if (!path || !store) { return store; }
  let at = store;
  for (const pathname of path) {
    at = at[pathname];
    if (at === undefined) { break; }
  }
  if (at === undefined) {
    return null;
  }
  return at;
}
