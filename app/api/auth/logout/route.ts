import { clearSessionCookie } from "../../../server/session";

export async function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
