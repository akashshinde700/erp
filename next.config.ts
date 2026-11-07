import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // Type errors are real errors: the app must compile cleanly before it ships.
  // Standalone demo folders under examples/ and mini-services/ are excluded
  // from tsconfig.json because they depend on optional socket.io packages that
  // are intentionally not part of the ERP runtime.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Don't advertise the framework; nginx in front adds no HSTS, so set it here.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // nginx already sends X-Content-Type-Options and Referrer-Policy; don't double them.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
