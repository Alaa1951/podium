import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * A self-contained server bundle: `.next/standalone` carries its own minimal
   * node_modules, so the app runs on any plain Node host without installing the
   * dependency tree there. `server.js` at the repo root is the entrypoint.
   */
  output: "standalone",

  // The version banner is free reconnaissance.
  poweredByHeader: false,
  compress: true,

  // Source maps would ship the server logic to anyone who opens devtools.
  productionBrowserSourceMaps: false,

  /*
   * The MariaDB driver is a native-ish package loaded through the Prisma
   * adapter. Keeping it external means output-file-tracing copies it into the
   * standalone bundle rather than trying to bundle it.
   */
  serverExternalPackages: ["mariadb", "@prisma/adapter-mariadb"],

  // The brand marks are small, fixed PNGs served from /public; the optimizer
  // adds a dependency and a cache for nothing.
  images: { unoptimized: true },

  // Nothing here is public: this app holds competitor data behind a sign-in.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
