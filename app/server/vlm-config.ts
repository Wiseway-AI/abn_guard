function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

export function isOpenAiEndpoint(url: string) {
  try {
    return new URL(url).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

/** The VLM is usable once it has an endpoint; OpenAI has no default model, so it also needs VLM_MODEL. */
export function vlmConfigured() {
  const url = clean(process.env.VLM_API_URL);
  return Boolean(url) && (!isOpenAiEndpoint(url) || Boolean(clean(process.env.VLM_MODEL)));
}
