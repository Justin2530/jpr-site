import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js loads its own worker build at runtime; keep it out of the bundle.
  serverExternalPackages: ["unpdf"],
  async redirects() {
    return [{ source: "/clients/:path*", destination: "/companies/:path*", permanent: false }];
  },
  experimental: {
    // Resume uploads go through server actions; the storage bucket caps files at 10MB.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
