import { sameOriginRequest } from "../../server/email-auth.ts";
import { loginRateLimit, recordLoginFailure, recordRouteError } from "../../server/monitoring.ts";
import { createManagedSessionCookie } from "../../server/session.ts";

type ManagedAccount = {
  id: string;
  username: string;
  companyName: string;
  password: string;
  setupComplete: boolean;
  unlimitedAbns: boolean;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function safeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index] ^ rightHash[index];
  return difference === 0;
}

function managedAccounts(): ManagedAccount[] {
  return [
    {
      id: "administrator",
      username: clean(process.env.ADMIN_USERNAME).toLowerCase() || "admin",
      companyName: "Administrator",
      password: process.env.ADMIN_PASSWORD ?? "",
      setupComplete: true,
      unlimitedAbns: true,
    },
    {
      id: "managed-bow",
      username: "bow",
      companyName: "BOW",
      password: process.env.BOW_PASSWORD ?? "",
      setupComplete: false,
      unlimitedAbns: true,
    },
    {
      id: "managed-gcgf",
      username: "gcgf",
      companyName: "GCGF",
      password: process.env.GCGF_PASSWORD ?? "",
      setupComplete: false,
      unlimitedAbns: true,
    },
    {
      id: "managed-jiaqi",
      username: "jiaqi",
      companyName: "Jiaqi",
      password: process.env.JIAQI_PASSWORD ?? "",
      setupComplete: false,
      unlimitedAbns: true,
    },
  ];
}

export async function POST(request: Request) {
  try {
    if (!sameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const body = (await request.json()) as { username?: string; password?: string };
    const username = clean(body.username).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const rateLimit = await loginRateLimit(request, "managed_signin", username, 8, 15 * 60);
    if (!rateLimit.allowed) {
      await recordLoginFailure(request, "managed account", username, rateLimit.actorHash, true);
      return Response.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 });
    }
    const account = managedAccounts().find((item) => item.username === username);

    if (!account || !account.password || !(await safeEqual(password, account.password))) {
      await recordLoginFailure(request, "managed account", username, rateLimit.actorHash);
      return Response.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return Response.json({
      authenticated: true,
      account: {
        id: account.id,
        username: account.username,
        companyName: account.companyName,
        setupComplete: account.setupComplete,
        unlimitedAbns: account.unlimitedAbns,
      },
    }, { headers: { "Set-Cookie": await createManagedSessionCookie(account.id, request) } });
  } catch (error) {
    await recordRouteError(request, "managed_signin_error", error);
    return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 400 });
  }
}
