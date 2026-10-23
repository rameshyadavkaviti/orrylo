/** @type {import("next").NextConfig} */
// Keep public assets in the deployment build; rebuild after adding public/logo.png.
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
