import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig = {
  output: "standalone",
  transpilePackages: ["@linear-clone/api", "@linear-clone/auth", "@linear-clone/db", "@linear-clone/shared", "@linear-clone/i18n"],
  serverExternalPackages: ["@neondatabase/serverless"],
  eslint: {
    // Allow production builds to complete even with ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow production builds to complete even with type errors
    ignoreBuildErrors: false,
  },
};

export default withNextIntl(nextConfig);
