import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",

      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },

      manifest: {
        name: "RideForge",
        short_name: "RideForge",
        theme_color: "#1A56DB",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0c0f",
        icons: [],

        share_target: {
          action: "/share-handler",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [
              {
                name: "files",
                accept: [".fit", "application/octet-stream"],
              },
            ],
          },
        },
      },
    }),
  ],
});
