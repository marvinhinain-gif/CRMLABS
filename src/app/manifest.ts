import type { MetadataRoute } from "next";

/** Permite "Adicionar à tela de início" no celular, abrindo como aplicativo. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRMLABS",
    short_name: "CRMLABS",
    description: "Relacionamentos que viram resultados.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#008A65",
    lang: "pt-BR",
    id: "/dashboard",
    scope: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
