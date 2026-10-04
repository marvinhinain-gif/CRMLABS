import type { Metadata, Viewport } from "next";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: { default: "CRMLABS", template: "%s · CRMLABS" },
  description: "Relacionamentos que viram resultados.",
  robots: { index: false, follow: false },
  applicationName: "CRMLABS",
  appleWebApp: { capable: true, title: "CRMLABS", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#008A65", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: "Poppins, sans-serif", borderRadius: 16 } }} />
      </body>
    </html>
  );
}
