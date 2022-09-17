import { isNodeJs } from '../util/env.util';

declare var window: any;
declare var process: any;

export const globalRoot = isNodeJs ? process : window;

const applicationTarget = {
  PROFILE: (isNodeJs && process.env.APPLICATION_PROFILE) ? process.env.APPLICATION_PROFILE : 'test',
};
if (!globalRoot.APP) { globalRoot.APP = applicationTarget; }

export const APP = new Proxy(globalRoot.APP as typeof applicationTarget, {});

export function setApplicationProfile(newProfile: string) {
  globalRoot.APP.PROFILE = newProfile;
}

export function getApplicationProfile() {
  return globalRoot.APP.PROFILE;
}

export function envVar<T = string>(envVar: string, defaultValue?: T): T {
  if (defaultValue === null || defaultValue === undefined) {
    return process.env[envVar] ? process.env[envVar] as unknown as T : defaultValue;
  }
  if (typeof defaultValue === 'number') {
    return process.env[envVar] ? parseInt(process.env[envVar], 10) as unknown as T : defaultValue;
  } if (typeof defaultValue === 'boolean') {
    return process.env[envVar] ? (['true', 'yes', '1', 'on', 'enable', 'enabled'].indexOf(process.env[envVar].toLocaleLowerCase()) >= 0) as unknown as T : defaultValue;
  }  else if (typeof defaultValue === 'object') {
    return process.env[envVar] ? JSON.parse(process.env[envVar]) as unknown as T : defaultValue;
  }
  return process.env[envVar] ? process.env[envVar] as unknown as T : defaultValue;
}
