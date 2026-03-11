declare module "bun:test" {
  export const beforeEach: typeof import("node:test").beforeEach;
  export const afterEach: typeof import("node:test").afterEach;
  export const describe: typeof import("node:test").describe;
  export const it: typeof import("node:test").it;
  export const mock: {
    module: (specifier: string, factory: () => unknown) => void;
    restore: () => void;
  };
}
