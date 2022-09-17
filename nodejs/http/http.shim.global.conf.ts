
export interface ServerConstDataGlobal {
  http?: {
    securityHeaders?: {
      profile: 'allow-all' | string;
      allowRequestOrigin: '*' | string;
      allowRequestHeaders: '*' | string;
    }
  };
  api?: {
    basePath: '/api' | string;
  };
  destor?: {
    basePath: '/api-destor' | string;
  };
  auth?: {
    basePath: '/api-auth' | string;
  };
  ext?: {
    basePath: '/api-ext' | string;
  };
}