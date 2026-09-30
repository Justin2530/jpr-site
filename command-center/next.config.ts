import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Resume uploads go through server actions; the storage bucket caps files at 10MB.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
