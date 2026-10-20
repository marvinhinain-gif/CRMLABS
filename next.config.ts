import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
const securityHeaders = [{ key: "X-Frame-Options", value: "DENY" }, ...baseHeaders];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "nodemailer"],
  async headers() {
    return [
      // Todo o CRM: não pode ser incorporado em outros sites.
      { source: "/((?!forms/|previa-formulario/).*)", headers: securityHeaders },
      // Prévia do editor de formulários: só dentro do próprio CRM.
      { source: "/previa-formulario/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, ...baseHeaders] },
      // Formulários públicos: incorporáveis; os domínios autorizados vêm do proxy (frame-ancestors).
      { source: "/forms/:path*", headers: baseHeaders },
    ];
  },
};

export default nextConfig;
