import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/cadastro", "/recuperar-senha", "/redefinir-senha", "/convite", "/privacidade", "/f", "/forms"];

/**
 * Redireciona visitantes sem cookie de sessão para o login.
 * A validação real da sessão e das permissões acontece no servidor (layouts e API).
 * Formulários públicos (/forms/…) podem ser incorporados apenas nos domínios autorizados.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/forms/") && pathname !== "/forms/embed.js") {
    const res = NextResponse.next();
    const slug = pathname.split("/")[2]?.toLowerCase() ?? "";
    let policy = "frame-ancestors 'self'";
    try {
      const { allowedDomainsFor, frameAncestors } = await import("@/server/embedDomains");
      const domains = /^[a-z0-9-]{3,60}$/.test(slug) ? await allowedDomainsFor(slug) : null;
      if (domains) policy = frameAncestors(domains);
    } catch {
      // Sem banco: só o próprio CRM pode incorporar.
    }
    res.headers.set("Content-Security-Policy", policy);
    return res;
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("crmlabs_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|icon.svg|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|woff2?)$).*)"],
};
