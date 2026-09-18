/**
 * Minimal Next App Router fixture for migrate tests.
 */
export default {
  trailingSlash: false,
  images: {
    deviceSizes: [640, 750, 1080, 1200],
  },
  async redirects() {
    return [{ source: "/old", destination: "/new", permanent: true }];
  },
};
