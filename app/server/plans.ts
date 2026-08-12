export const PLAN_KEYS = ["free", "starter"] as const;
export type PlanKey = typeof PLAN_KEYS[number];

export const PLANS: Record<PlanKey, { name: string; monthlyAud: number; abnLimit: number; priceEnv?: string }> = {
  free: { name: "Free", monthlyAud: 0, abnLimit: 10 },
  starter: { name: "Starter", monthlyAud: 9.9, abnLimit: 200, priceEnv: "STRIPE_STARTER_PRICE_ID" },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.includes(value as PlanKey);
}

export function priceIdForPlan(plan: Exclude<PlanKey, "free">) {
  return process.env[PLANS[plan].priceEnv ?? ""]?.trim() ?? "";
}

export function planForPriceId(priceId: string): PlanKey {
  if (priceId && priceId === priceIdForPlan("starter")) return "starter";
  return "free";
}
