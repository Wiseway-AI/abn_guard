import { clearManagedSessionCookie, clearSessionCookie } from "../../../server/session";

export async function POST(request: Request) {
  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookie(request));
  headers.append("Set-Cookie", clearManagedSessionCookie(request));
  return Response.json({ ok: true }, { headers });
}
