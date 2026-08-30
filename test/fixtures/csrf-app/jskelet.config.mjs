/**
 * CSRF testlerinin kalıbı: token katmanı açık, bir webhook ucu muaf.
 */
export default {
  security: {
    cookieSecret: "kalip-sirri",
    csrf: {
      token: true,
      allowedOrigins: ["https://admin.example.com"],
      exclude: ["/webhook/:path*"],
    },
  },
};
