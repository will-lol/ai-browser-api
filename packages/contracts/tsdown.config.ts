import { defineConfig } from "tsdown/config";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  sourcemap: true,
  tsconfig: "tsconfig.build.json",
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
});
