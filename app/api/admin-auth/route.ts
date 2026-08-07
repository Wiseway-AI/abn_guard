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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = clean(body.username).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const expectedUsername = clean(process.env.ADMIN_USERNAME).toLowerCase() || "admin";
    const expectedPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!expectedPassword) {
      return Response.json({ error: "Administrator login is not configured." }, { status: 503 });
    }

    const [usernameMatches, passwordMatches] = await Promise.all([
      safeEqual(username, expectedUsername),
      safeEqual(password, expectedPassword),
    ]);
    if (!usernameMatches || !passwordMatches) {
      return Response.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return Response.json({ authenticated: true });
  } catch {
    return Response.json({ error: "Administrator sign-in failed." }, { status: 400 });
  }
}
