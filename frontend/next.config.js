/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Determine the backend URL. Fallback to localhost:4000 if not specified.
    // If NEXT_PUBLIC_API_BASE_URL is set, we still use it for the rewrite target.
    const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`, // Proxy to Backend
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`, // Proxy to Backend
      },
    ];
  },
};
module.exports = nextConfig;
