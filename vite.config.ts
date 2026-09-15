import { defineConfig } from "vite";

export default defineConfig({
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
