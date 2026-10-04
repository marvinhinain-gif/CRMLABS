import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/cadastro", "/recuperar-senha", "/redefinir-senha", "/convite", "/privacidade"];

/**
 * Redireciona visitantes sem cookie de sessão para o login.
 * A validação real da sessão e das permissões acontece no servidor (layouts e API).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
  matcher: ["/((?!api|_next|icon.svg|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|woff2?)$).*)"],
};
