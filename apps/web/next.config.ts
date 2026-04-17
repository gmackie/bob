import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@gmacko/ui", "@gmacko/models", "@gmacko/api", "@gmacko/db"],
};

export default config;
