import type { NextConfig } from "next";

// ngrok tunnel hostnames, so the dev server can be shared over a public URL.
const TUNNELS = ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev", "*.ngrok.io"];

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  allowedDevOrigins: TUNNELS,
  // 3 MB so company logos can be uploaded (the logo itself is capped at 1 MB).
  experimental: { serverActions: { allowedOrigins: TUNNELS, bodySizeLimit: "3mb" } },
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
