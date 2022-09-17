import { deepCopy, promise, ReturnCodeFamily } from "../../src/common/globals.ix";
import { DestorClient, getDestorClient } from "../http/destor/destor.client";

// enum SecretResolverCodeEnum {
//   SECRET_RESOLVER_TARGET_NOT_FOUND,
// }
// export const SecretResolverCode = ReturnCodeFamily('SecretResolverCode', SecretResolverCodeEnum);

export namespace SecretManager {
  export function resolve<T = any>(obj: T, destorClient?: DestorClient) {
    return promise<T>(async (resolve, reject) => {
      if (obj && typeof obj === 'object') { obj = deepCopy(obj); }
      const client = destorClient ? destorClient : await getDestorClient();
      const list = getResolvableWithinObject(obj);
      const targetsList = [].concat(...list.map(a => a.targets));
      const resolvedMap = await client.resolve(targetsList);
      for (const targetInfo of list) {
        if (targetInfo.targets.length === 1 && targetInfo.content === `<${targetInfo.targets[0]}>`) {
          const resolvedInfo = resolvedMap[targetInfo.targets[0]];
          if (!resolvedInfo || resolvedInfo.error) {
            continue;
          }
          if (targetInfo.parent) {
            targetInfo.parent[targetInfo.index] = resolvedInfo.value;  
          } else {
            obj = resolvedInfo.value as any;
          }
          continue;
        }
        let text = targetInfo.content;
        for (const targetStub of targetInfo.targets) {
          const stub = `<${targetStub}>`;
          const resolvedInfo = resolvedMap[targetStub];
          if (!resolvedInfo || resolvedInfo.error) {
            continue;
          }
          try {
            const value = ['string', 'number', 'boolean'].indexOf(typeof resolvedInfo.value) >= 0 ?
                          resolvedInfo.value + '' : JSON.stringify(resolvedInfo.value);
            while (text.indexOf(stub) >= 0) { text = text.replace(stub, value); }
          } catch (e) {
            continue;
          }
        }
        if (targetInfo.parent) {
          targetInfo.parent[targetInfo.index] = text;  
        } else {
          obj = text as any;
        }
      }
      resolve(obj);
    });
  }
}

function getResolvableWithinObject(obj: any, parent?: any, index?: number | string,
                                   collector: {content: string; parent: any, index: number | string, targets: string[] }[] = []) {
  const objtype = typeof obj;
  if (obj && objtype === 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; ++i) {
        getResolvableWithinObject(obj[i], obj, i, collector);
      }
    } else {
      for (const prop of Object.keys(obj)) {
        getResolvableWithinObject(obj[prop], obj, prop, collector);
      }
    }
  } else if (objtype === 'string') {
    const str = obj as string;
    if (str.indexOf('<config.') >= 0 || str.indexOf('<secret.') >= 0) {
      collector.push({ content: str, parent, index, targets: extractResolvableString(str) })
    }
  }
  return collector;
}

function extractResolvableString(content: string) {
  let idx = 0;
  const targets: string[] = [];
  while (true) {
    let configPos = content.indexOf('<config.', idx);
    let secretPos = content.indexOf('<secret.', idx);
    if (configPos === -1 && secretPos === -1) { return targets; }
    if (configPos > secretPos) {
      const enderPos = content.indexOf('>', configPos);
      targets.push(content.slice(configPos + 1, enderPos));
      idx = enderPos + 1;
    } else {
      const enderPos = content.indexOf('>', secretPos);
      targets.push(content.slice(secretPos + 1, enderPos));
      idx = enderPos + 1;
    }
  }
}
