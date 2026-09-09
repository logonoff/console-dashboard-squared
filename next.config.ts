import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Produces a self-contained .next/standalone bundle for Docker deployment.
  output: "standalone",
};

export default nextConfig;
