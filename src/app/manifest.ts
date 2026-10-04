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
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
