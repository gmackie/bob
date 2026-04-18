import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@gmacko/ui", "@gmacko/models", "@gmacko/contracts"],
  async rewrites() {
    return [
      {
        source: "/rpc",
        destination: "http://localhost:3001/rpc",
      },
      {
        source: "/api/chat/stream",
        destination: "http://localhost:3001/api/chat/stream",
      },
    ];
  },
};

export default config;
