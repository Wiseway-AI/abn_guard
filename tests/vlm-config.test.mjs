import assert from "node:assert/strict";
import test from "node:test";

import { isOpenAiEndpoint, vlmConfigured } from "../app/server/vlm-config.ts";

function withEnv(values, run) {
  const saved = { VLM_API_URL: process.env.VLM_API_URL, VLM_MODEL: process.env.VLM_MODEL };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("recognises the OpenAI API host only", () => {
  assert.equal(isOpenAiEndpoint("https://api.openai.com/v1/chat/completions"), true);
  assert.equal(isOpenAiEndpoint("https://api.openai.com.evil.example/v1/chat/completions"), false);
  assert.equal(isOpenAiEndpoint("https://abc.ngrok-free.app/v1/chat/completions"), false);
  assert.equal(isOpenAiEndpoint("not a url"), false);
});

test("OpenAI needs an explicit model; self-hosted endpoints fall back to the default", () => {
  withEnv({ VLM_API_URL: undefined, VLM_MODEL: undefined }, () => assert.equal(vlmConfigured(), false));
  withEnv({ VLM_API_URL: "https://api.openai.com/v1/chat/completions", VLM_MODEL: undefined }, () => assert.equal(vlmConfigured(), false));
  withEnv({ VLM_API_URL: "https://api.openai.com/v1/chat/completions", VLM_MODEL: "gpt-test" }, () => assert.equal(vlmConfigured(), true));
  withEnv({ VLM_API_URL: "https://abc.ngrok-free.app/v1/chat/completions", VLM_MODEL: undefined }, () => assert.equal(vlmConfigured(), true));
});
