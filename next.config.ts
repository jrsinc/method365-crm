import type { NextConfig } from "next";

// ngrok tunnel hostnames, so the dev server can be shared over a public URL.
const TUNNELS = ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev", "*.ngrok.io"];

const nextConfig: NextConfig = {
  // scripts/update.sh builds into a separate folder (NEXT_DIST_DIR) while the live site keeps running from .next,
  // then swaps the folders only if the build succeeded.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: [],
  allowedDevOrigins: TUNNELS,
  // 5 MB: company logo uploads (logo capped at 1 MB) and quote PDFs attached to emails (capped at about 2 MB).
  experimental: { serverActions: { allowedOrigins: TUNNELS, bodySizeLimit: "5mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
