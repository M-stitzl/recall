import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Das gemeinsame Zod-Schema liegt als TypeScript-Quelle im Workspace.
  transpilePackages: ["@recall/schema"],
  cacheComponents: true,
  partialPrefetching: true,
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
