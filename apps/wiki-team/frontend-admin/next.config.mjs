/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow running under Node within Bun monorepo (ADR 008 principled deviation)
  // Next.js requires Node runtime; Bun is used for package management only.
  experimental: {
    typedRoutes: false,
  },
  // Proxy API calls to backend server during dev
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
