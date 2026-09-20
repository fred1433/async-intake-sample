import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The live run reads the sample media from disk: keep them in the function bundle.
  outputFileTracingIncludes: {
    "/api/rerun": ["./public/sample/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
