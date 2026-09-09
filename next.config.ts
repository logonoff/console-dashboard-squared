import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Only produce the standalone bundle when building inside Docker.
  // Set by the Dockerfile builder stage; omit for local dev/CI builds.
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
};

export default nextConfig;
