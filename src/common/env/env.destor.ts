import { TrustedPublicKey } from "../security/security.common";
import { globalRoot } from "./env.profile";

export interface DestorUrlEntry {
  url: string, 
  token?: string;
  trust?: TrustedPublicKey;
}

const destorTarget = {
  LIST: destorParseFromSerializedFormat(process.env.DESTOR_LIST) ?
            destorParseFromSerializedFormat(process.env.DESTOR_LIST) : []
};
if (!globalRoot.DESTOR) { globalRoot.DESTOR = destorTarget; }

export const DESTOR = new Proxy(globalRoot.DESTOR as typeof destorTarget, {});

export function destorParseFromSerializedFormat(v: string): DestorUrlEntry[] {
  if (!v || typeof v !== 'string') { return null; }
  v = v.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    return JSON.parse(v);
  }
  try {
    return JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
  } catch (e) {
    const message = `unexpected serialized destor input format, only JSON or Base64 are allowed. Supplied value:\n${v}`;
    e.message = message;
    console.error(e);
  }
}
