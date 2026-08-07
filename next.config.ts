/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb', // Allows large CSV uploads
    },
  },
};
module.exports = nextConfig;