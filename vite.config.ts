import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

const appVersion =
  process.env.GITHUB_SHA?.slice(0, 12) ??
  execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
  }).trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    {
      name: "build-version-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: appVersion }),
        });
      },
    },
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three/, maxSize: 350_000 },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8057,
    strictPort: true,
  },
});
