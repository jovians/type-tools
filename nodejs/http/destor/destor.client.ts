import { ok, passthru, promise, Result } from "../../../src/common/globals.ix";
import { DESTOR, DestorUrlEntry } from "../../../src/common/env/env.destor";
import { APP } from "../../../src/common/env/env.profile";
import { SecureHttpComm } from "../../secure-channel/secure-http-comm";

let resolvedDestorClient: DestorClient = null;
export function getDestorClient() {
  return promise<DestorClient>(async (resolve, reject) => {
    if (resolvedDestorClient) { return resolve(resolvedDestorClient); }
    for (const destorUrlEntry of DESTOR.LIST) {
      const client = new DestorClient(destorUrlEntry);
      const res = await client.get({ path: '/', revealPath: true, });
      return resolve(client);
    }
    return reject(new Error(`Unable to resolve active destor among:\n${JSON.stringify(DESTOR.LIST, null, 4)}`));
  }); 
}

export class DestorClient extends SecureHttpComm {
  constructor(destorUrlEntry: DestorUrlEntry) {
    super({
      user: 'internal', endpoint: destorUrlEntry.url,
      token: { list: { default: { value: destorUrlEntry.token }  }},
      trust: { list: { [destorUrlEntry.trust.publicKey]: { value: destorUrlEntry.trust }  }}
    });
  }

  async resolve(targets: string[]): Promise<{[key: string]: {value: any; error?: string}}> {
    return (await this.get({ path: `/resolve-config/${APP.PROFILE}?targets=${targets.join('|')}`})).result;
    // if (res.data === null || res.data === undefined) { return passthru(res); }
    // return ok(res.data.result);
  }

  async getAuthServers() {
    return (await this.get({ path: `/auth-servers/${APP.PROFILE}`})).result;
  }
}
