/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Campaign images are uploaded through server actions (Vercel caps requests at 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  // The alert email template is read from disk at runtime.
  outputFileTracingIncludes: { '/**': ['./emails/**'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
        ]
      }
    ];
  }
};

export default nextConfig;
