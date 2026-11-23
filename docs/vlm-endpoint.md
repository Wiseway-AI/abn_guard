# Private VLM endpoint

ABN Guard uses the VLM only when browser-side PDF text extraction is incomplete and the user has enabled the fallback.

## Configuration

Set these server-side variables:

```dotenv
VLM_API_URL=https://your-ngrok-host.example/v1/chat/completions
VLM_MODEL=your-local-model-name
VLM_API_KEY=optional-token
```

`VLM_API_URL` must be an HTTP(S) endpoint reachable by the ECS task. Keep `VLM_API_KEY` server-side in AWS Secrets Manager.

### OpenAI

```dotenv
VLM_API_URL=https://api.openai.com/v1/chat/completions
VLM_MODEL=<an OpenAI model ID with image input>
VLM_API_KEY=sk-...
```

When `VLM_API_URL` is on `api.openai.com`, `VLM_MODEL` is required and the request uses `max_completion_tokens` instead of `max_tokens`, omits `temperature` and `reasoning_effort`, and drops the ngrok header. Rendered invoice pages, including bank details, are then sent to OpenAI.

In AWS, all three keys live in the environment's application secret and are injected when the Terraform switch `vlm_enabled` is on. Populate the secret before enabling the switch: a task whose secret is missing a referenced key fails to start.

## Request contract

The endpoint receives an OpenAI-compatible chat-completions request. The user message contains short extracted text plus up to eight JPEG page images as `image_url` data URLs. ABN Guard adds `ngrok-skip-browser-warning: true` and, when configured, `Authorization: Bearer <VLM_API_KEY>`.

The model should return JSON in `choices[0].message.content`. A direct JSON response containing `entities` is also accepted.

```json
{
  "documentType": "invoice",
  "entities": [
    {
      "abn": "43669580401",
      "entityName": "B.O.W PROJECTS AUSTRALIA PTY LTD",
      "role": "payee",
      "location": "VIC 3061",
      "gstRegisteredClaim": true,
      "page": 1,
      "confidence": 0.96,
      "evidence": "Supplier and payment details"
    }
  ],
  "bankDetails": {
    "accountName": "B.O.W PROJECTS AUSTRALIA PTY LTD",
    "bsb": "063109",
    "accountNumber": "13111956",
    "bankName": "",
    "page": 1,
    "confidence": 0.93
  },
  "confidence": 0.95,
  "warnings": []
}
```

ABN Guard independently validates ABN checksums, field formats and confidence thresholds. VLM output is extraction evidence only; ABN and GST verification still comes from the official ABN Lookup service.
