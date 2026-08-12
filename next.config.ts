/** @type {import('next').NextConfig} */
const nextConfig = {
  // In Next.js 15+, serverActions is stable and MUST be placed at the root level, 
  // outside of 'experimental', otherwise the size limit is ignored!
  serverActions: {
    bodySizeLimit: '100mb', 
  },
};

module.exports = nextConfig;