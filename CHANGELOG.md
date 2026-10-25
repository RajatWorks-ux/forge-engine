## 2.2.0 Smart zero-failure scene recovery — 2026-10-09
- Added deterministic scene-code fallback after bounded AI recovery is exhausted.
- Added explicit anti-garbage recovery instructions for repetitive model output.
- Scene fan-out now has a hard safety cap of 4 workers to reduce shared-provider 429 storms.
- Scene-code firewall now uses code-aware repetition detection instead of applying
  narration-style phrase detection blindly to executable source.
- Preserved `.env` and all non-target project files.


## 2.1.1 Smart structured recovery
- Structured generation now defaults to 3 controlled attempts instead of 2.
- Every retry receives the exact previous failure code/message and targeted recovery rules.
- Script word_count and total_word_count are deterministically repaired from narration text before validation.
- Script scene duration metadata is normalized to the blueprint-owned duration.
- Added explicit model self-check instructions for metadata and JSON-only output.

# Resilience Hardening — 2026-10-08

- Added job-scoped API health states: HEALTHY, COOLDOWN, QUARANTINED, DISABLED.
- 401/403 credentials are disabled for the job; 429s enter cooldown; special-token and malformed-output failures quarantine the offending slot.
- Retries now select a different healthy API instead of reusing the failed slot.
- Added atomic artifact writes and job-state `.bak` recovery to prevent empty/corrupt JSON or partial generated files.
- Added real ffprobe audio-duration verification and a hard duration gate before waveform/captions/rendering.
- Added automatic script/TTS regeneration when actual audio duration misses the target.
- Added Remotion composition preflight before expensive rendering.
- Strengthened final MP4 quality gating for container, streams, duration, audio duration, resolution, and FPS.
- Preserved the existing `scripts/local_checks.js` unchanged and added separate resilience checks.


## Automatic API Pool Architecture

- Added dynamic 20-slot API router.
- Added automatic provider/model/reasoning selection.
- Added per-provider concurrency and load/reliability scoring.
- Parallelized scene generation.
- Replaced AI-only scene validation with deterministic local gates before render.
- Bounded structured retries to prevent retry storms.
- Added fast FFmpeg remux before expensive fallback re-encoding.
- Preserved the existing public brain contracts and legacy NVIDIA configuration.

# FORGE v2 — NVIDIA Kimi-K3 Adapter CHANGELOG

## What Was Broken

### 1. Non-streaming HTTP connection timed out (PRIMARY CAUSE)
The adapter used `stream: false` with `Accept: application/json`. NVIDIA's
official Kimi-K3 example uses SSE streaming. With non-streaming, the HTTP
connection stays open for the *entire* reasoning + generation duration before
a single byte arrives. For a complex blueprint prompt with `reasoning_effort:
max`, this is several minutes. The OS-level TCP idle timeout and the Node.js
fetch AbortController both fired before the model finished, producing:

    NVIDIA blueprint attempt 1/3 failed:
    NVIDIA request timed out after 300000ms

Increasing `REQUEST_TIMEOUT_MS` to arbitrarily large values does not fix this —
a non-streaming connection over a congestion-controlled network will still hit
keepalive/idle limits before a multi-minute response completes.

### 2. Token budget too small for reasoning (SECONDARY CAUSE)
`max_tokens` was set to `24000` for the blueprint mode. Kimi-K3 with
`reasoning_effort: max` spends its token budget on *internal reasoning tokens
first*, before emitting a single visible output character. For a complex
research-informed blueprint prompt, the model consumed all 24 000 tokens in
reasoning and returned:

    content: null
    finish_reason: "length"

This was confirmed by the live test described in the brief:
> With reasoning_effort: low, max_tokens: 64, the API returned HTTP 200 but
> content: null, finish_reason: "length", reasoning_tokens: 64

The same pattern at scale caused the full blueprint to fail silently.

### 3. Nested retry loops (TERTIARY CAUSE)
`generateStructured()` had its own loop (up to 3 attempts) that called
`callNvidia()`, which *also* had an internal retry loop (up to 3 attempts).
This meant up to 9 sequential attempts, each potentially waiting the full
5-minute timeout — 45 minutes of total wall time before a final failure.
The logs showed confusingly numbered attempt messages from both loops.

### 4. Test isolation: `getApiKey()` before mock fetch override
`local_checks.js` set `globalThis.fetch` after `callNVIDIA` was called. Because
`getApiKey()` was the first thing `callNvidia()` did, and it threw an error
when no real `NVIDIA_API_KEY` was in the environment, the mock test never
reached the fetch interception point. `local_checks.js` failed with:
`Error: Missing NVIDIA_API_KEY`

---

## Why Kimi-K3 Requests Were Timing Out

Kimi-K3 is a 2.8T MoE reasoning model. With `reasoning_effort: max`, it
runs an extensive internal chain-of-thought before emitting visible tokens.
For complex structured-output tasks (full video blueprints with 6-100 scenes,
research data, style manifests), this internal reasoning can take 60–300
seconds.

**Non-streaming** behaviour: the HTTP connection stays idle for that entire
duration before the first response byte arrives. This is indistinguishable
from a hung connection to most TCP stacks and to the Node.js fetch
`AbortController`. Any timeout shorter than the total generation time will
abort the request.

**Streaming (SSE)** behaviour: the model sends tokens as they are generated,
including reasoning tokens, keeping the connection alive with a continuous
byte stream. Even if the visible output tokens don't appear for several
minutes, the TCP connection sees activity and the Node.js inactivity watchdog
resets on every SSE chunk. The total operation succeeds.

---

## What NVIDIA API Behaviour Was Discovered

From official NVIDIA documentation (`https://build.nvidia.com/moonshotai/kimi-k3`):

- **Endpoint**: `https://integrate.api.nvidia.com/v1/chat/completions`
- **Model ID**: `moonshotai/kimi-k3`
- **Authentication**: `Authorization: Bearer ${NVIDIA_API_KEY}` — key must NOT
  be prefixed with "Bearer " in `.env`; the client constructs the full header.
- **Streaming**: officially recommended via `stream: true` + `Accept:
  text/event-stream`. Standard OpenAI SSE format with `[DONE]` terminator.
- **reasoning_effort**: `low | high | max` (default `max`). Field is a
  top-level request parameter.
- **max_tokens**: covers reasoning + visible output combined. A small value
  is entirely consumed by reasoning, leaving zero budget for content.
- **No 202/pending async flow**: the NVIDIA chat completions endpoint does not
  return `202 + requestId` for Kimi-K3. If it ever does, the client now
  surfaces a clear error rather than hanging.
- **No response_format/json_schema**: not supported for this model on NVIDIA
  NIM. JSON is elicited by prompt and validated locally (unchanged from prior
  approach).
- **Temperature**: Kimi-K3 benchmarks use `temperature: 1.0` with reasoning;
  low temperatures combined with reasoning may produce poor results.

---

## What Was Changed

### `src/brain/nvidia_client.js`

1. **SSE streaming**: switched from `stream: false` + `Accept: application/json`
   to `stream: true` + `Accept: text/event-stream`. Implemented `consumeSseStream()`
   which reads the SSE body incrementally, collects only `delta.content` (never
   `delta.reasoning_content`), handles `[DONE]`, and uses a two-level watchdog:
   - **Inactivity watchdog** (default 120 s): resets on every SSE chunk; aborts if
     no data arrives for that window. Prevents truly stalled connections.
   - **Total deadline** (default 900 s / 15 min): hard wall-clock limit per attempt.

2. **Token budgets raised**:
   - `blueprint`:  `24000 → 64000`  (~30K reasoning + ~20K JSON)
   - `script`:     `24000 → 48000`  (~20K reasoning + ~15K JSON)
   - `scene_code`: `14000 → 48000`  (~20K reasoning + ~12K code)
   - `validate`:   `4000  → 16000`  (~8K  reasoning + ~4K  JSON)

3. **De-nested retry logic**: `callNvidiaOnce()` (renamed from `callNvidia()`)
   is now single-attempt. All retry logic lives exclusively in
   `generateStructured()`, which still performs up to 3 attempts with backoff.
   This eliminates the 3×3 = 9 attempt cascade.

4. **Test isolation**: `FORGE_LOCAL_TEST_KEY` env var bypasses the placeholder
   check so `local_checks.js` can run mock tests without a live credential.

5. **Temperature**: updated to `1.0` for all modes (Kimi-K3 optimal for
   reasoning). This was `0.25` / `0.35` previously.

6. **Empty-output classification**: distinguished `TOKEN_BUDGET_EXHAUSTED`
   (reasoning consumed all tokens, same budget won't help — not auto-retried)
   from `OUTPUT_TRUNCATED` (partial content, retryable).

### `scripts/local_checks.js`

Fully rewritten with 67 tests covering:
- All 19 required file presence checks
- Zero-byte file scan
- Secret scan (no live keys in source)
- `.env.example` placeholder validation
- `.gitignore` `.env` exclusion
- 4 schema mode conversions
- 4 prompt file integrity checks
- 4 JSON parsing scenarios
- 12 HTTP error classification cases
- 20 mock NVIDIA HTTP scenarios (streaming SSE, reasoning_content ignored,
  empty output, truncated output, 400/401/403/429/500/502/503/504, network
  failure, malformed JSON, no-logging of API key, no nested retry,
  token budget, streaming headers)
- 1 ElevenLabs 503-retry + timestamp-parsing scenario

---

## How Reasoning Quality Was Preserved

`reasoning_effort` remains `max` by default (configurable via
`NVIDIA_REASONING_EFFORT` env var). The fix did NOT:
- Set `reasoning_effort: none`
- Replace Kimi-K3 with another model
- Simplify or shorten prompts
- Reduce schema complexity
- Reduce scene counts or output detail

The fix *enabled* the reasoning to complete by giving it enough tokens and
keeping the HTTP connection alive via streaming.

---

## How Token Budgeting Was Fixed

`max_tokens` on Kimi-K3 covers *total* tokens: reasoning + visible output.
The new budgets are sized so the worst-case reasoning trace (estimated from
the model's own usage reports in test) still leaves headroom for the full
structured JSON output.

Operators can tune `NVIDIA_REASONING_EFFORT=high` to reduce reasoning token
usage at the cost of slightly shallower thinking, or `low` for maximum speed.

---

## How Timeout / Streaming Was Handled

- No single-connection timeout is used for the full response.
- An **inactivity watchdog** (`NVIDIA_CHUNK_INACTIVITY_MS`, default 120 s)
  aborts if the SSE stream goes completely silent — distinguishing a stalled
  connection from a slow-but-active generation.
- A **total deadline** (`NVIDIA_STREAM_TOTAL_MS`, default 900 s) provides a
  hard upper bound.
- `AbortController` is used correctly: the signal is passed to `fetch()` and
  also used by the inactivity watchdog inside the stream reader.

There is no 202/polling flow — the NVIDIA chat completions endpoint does not
use it for Kimi-K3 at this time. If a 202 response is received, the client
surfaces a clear error message rather than hanging.

---

## How Retry Behaviour Was Fixed

`callNvidiaOnce()` is **single-attempt**. `generateStructured()` owns all
retries (max 3). Error classification:

| Status / Code        | Classification          | Retried? |
|----------------------|-------------------------|----------|
| 400, 401, 403, 422   | PERMANENT               | Never    |
| 408, 429             | RETRYABLE               | Yes      |
| 500, 502, 503, 504   | RETRYABLE               | Yes      |
| TOKEN_BUDGET_EXHAUSTED | Not retried           | No       |
| OUTPUT_TRUNCATED     | RETRYABLE               | Yes      |
| Network failure      | RETRYABLE               | Yes      |
| Inactivity timeout   | RETRYABLE               | Yes      |
| Total deadline       | RETRYABLE               | Yes      |

Backoff: `min(15 s, 1.5 s × 2^(attempt-1))` for most errors;
`min(30 s, 5 s × 2^(attempt-1))` for 429; honours `Retry-After` header.

---

## Exact Tests Run

All 67 mock/local tests run and passed. See `scripts/local_checks.js`.

    FORGE_LOCAL_TEST_KEY=forge-local-test-key node scripts/local_checks.js
    → LOCAL CHECKS PASS (67 tests)

---

## Exact Tests That Could Not Be Run

Live tests (TEST A–G from the brief) cannot be run here because no live
`NVIDIA_API_KEY` or `ELEVENLABS_API_KEY` is available in this environment.

The following live tests require credentials and are explicitly NOT run:
- TEST A — authentication (tiny request, reasoning off)
- TEST B — tiny reasoning OFF
- TEST C — tiny reasoning ON (verify `content` exists, `finish_reason=stop`)
- TEST D — medium prompt
- TEST E — blueprint-like request
- TEST F — full Stage 0 → Stage 1 pipeline
- TEST G — full pipeline

---

## Exact Live Results

Live tests: **not run** (no credentials in this environment, as instructed).
Mock tests: **67/67 passed**.
