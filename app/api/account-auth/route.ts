type ManagedAccount = {
  id: string;
  username: string;
  companyName: string;
  password: string;
  setupComplete: boolean;
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
    },
    {
      id: "managed-bow",
      username: "bow",
      companyName: "BOW",
      password: process.env.BOW_PASSWORD ?? "",
      setupComplete: false,
    },
    {
      id: "managed-gcgf",
      username: "gcgf",
      companyName: "GCGF",
      password: process.env.GCGF_PASSWORD ?? "",
      setupComplete: false,
    },
  ];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = clean(body.username).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const account = managedAccounts().find((item) => item.username === username);

    if (!account || !account.password || !(await safeEqual(password, account.password))) {
      return Response.json({ error: "Username or password is incorrect." }, { status: 401 });
    }

    return Response.json({
      authenticated: true,
      account: {
        id: account.id,
        username: account.username,
        companyName: account.companyName,
        setupComplete: account.setupComplete,
      },
    });
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable." }, { status: 400 });
  }
}
