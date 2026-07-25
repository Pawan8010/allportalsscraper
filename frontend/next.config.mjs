/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep production builds away from the dev server's live `.next` cache.
  // Running `next build` while `next dev` is open otherwise replaces dev
  // assets and can leave the browser requesting a missing `polyfills.js`.
  distDir: process.env.NODE_ENV === "production" ? ".next-production" : ".next",
  async rewrites() {
    const backendOrigin = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:4000";
    return [
      {
        source: "/backend-api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
  // NOTE: `output: "standalone"` was removed here on purpose. Next refuses to
  // serve a standalone build through `next start` ("next start does not work
  // with output: standalone"), so `npm run build && npm start` bound port 3000
  // and then failed every request with "Cannot find module
  // ./vendor-chunks/next.js". frontend/Dockerfile runs `npm start` as well, so
  // nothing actually consumed the standalone output.
  //
  // Re-add it only together with `CMD ["node", ".next/standalone/server.js"]`
  // and the static/public copies that standalone mode requires.
};

export default nextConfig;
