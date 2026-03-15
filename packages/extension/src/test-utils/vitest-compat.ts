import { vi } from "vitest";

type ModuleFactory = () => unknown | Promise<unknown>;

const mockedModules = new Set<string>();

type BunStyleMock = typeof vi.fn & {
  module: (specifier: string, factory: ModuleFactory) => void;
  restore: () => void;
};

export const mock = Object.assign(
  ((implementation?: Parameters<typeof vi.fn>[0]) => vi.fn(implementation)) as typeof vi.fn,
  {
    module(specifier: string, factory: ModuleFactory) {
      mockedModules.add(specifier);
      vi.doMock(specifier, factory as never);
    },
    restore() {
      vi.clearAllMocks();
      vi.restoreAllMocks();

      for (const specifier of mockedModules) {
        vi.doUnmock(specifier);
      }

      mockedModules.clear();
      vi.resetModules();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    },
  },
) as BunStyleMock;
