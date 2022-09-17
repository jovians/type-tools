export function taggedTemplateCollapse(strArr: TemplateStringsArray, args: any[]): string {
  const strs: string[] = [];
  for (let i = 0; i < strArr.length; ++i) {
    if (i === strArr.length - 1) {
      strs.push(strArr[i]);
    } else {
      strs.push(strArr[i]);
      strs.push(`${args[i]}`);
    }
  }
  return strs.join('');
}

export function toBe<T = any>(strArr: TemplateStringsArray, ...args: any[]): T {
  return taggedTemplateCollapse(strArr, args) as any as T;
}
