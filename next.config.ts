import type { NextConfig } from "next";

const isProductionBuild = process.env.NODE_ENV === "production";
const devHost = process.env.TAURI_DEV_HOST || "localhost";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  assetPrefix: isProductionBuild ? undefined : `http://${devHost}:3000`,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
