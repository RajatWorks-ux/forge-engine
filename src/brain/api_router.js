/**
 * FORGE — Dynamic API Brain Router
 *
 * Health-aware, job-scoped failover for up to 20 OpenAI-compatible API slots.
 * The router owns transport reliability; callers own semantic retries.
 */

import 'dotenv/config';

const DEFAULT_NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const MAX_SLOTS = Math.max(1, Math.min(100, Number(process.env.FORGE_API_SLOTS || 20)));
const CONFIGURED_GLOBAL_CONCURRENCY = Math.max(0, Number(process.env.FORGE_GLOBAL_CONCURRENCY || 0));
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.FORGE_API_TIMEOUT_MS || 1_800_000));
const DEFAULT_LEVELS = ['low', 'medium', 'high', 'max'];
const MAX_RETRY_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.FORGE_API_RETRY_ATTEMPTS || 2)));

const state = {
  slots: new Map(),
  initialized: false,
  globalActive: 0,
  currentJobId: null,
  jobStartedAt: 0,
};

function truthy(v, fallback = true) {
  if (v == null || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

function normalizeBase(base, provider) {
  if (base) return String(base).replace(/\/+$/, '');
  const defaults = {
    nvidia: DEFAULT_NVIDIA_BASE,
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    together: 'https://api.together.xyz/v1',
    mistral: 'https://api.mistral.ai/v1',
  };
  return defaults[String(provider || '').toLowerCase()] || DEFAULT_NVIDIA_BASE;
}

function placeholderKey(key) {
  if (!key) return true;
  const s = String(key).trim();
  return !s || s.includes('YOUR_') || s.includes('PASTE_YOUR_') || s.includes('PLACEHOLDER') || s === 'sk-...';
}

function parseLevels(raw, provider) {
  if (raw) {
    const levels = String(raw).split(',').map(x => x.trim().toLowerCase())
      .filter(x => DEFAULT_LEVELS.includes(x));
    if (levels.length) return [...new Set(levels)];
  }
  return String(provider).toLowerCase() === 'nvidia' ? ['low', 'high', 'max'] : DEFAULT_LEVELS;
}

function readSlots() {
  const slots = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const id = String(i).padStart(2, '0');
    let key = process.env[`FORGE_API_${id}_KEY`]?.trim();
    const enabled = truthy(process.env[`FORGE_API_${id}_ENABLED`], true);
    if (i === 1 && placeholderKey(key)) {
      const legacy = process.env.NVIDIA_API_KEY?.trim();
      if (!placeholderKey(legacy)) key = legacy;
    }
    if (!enabled || placeholderKey(key)) continue;

    const provider = (process.env[`FORGE_API_${id}_PROVIDER`] || 'nvidia').trim().toLowerCase();
    const model = (process.env[`FORGE_API_${id}_MODEL`] || '').trim() ||
      (provider === 'nvidia' ? (process.env.NVIDIA_MODEL?.trim() || 'moonshotai/kimi-k3') : '');
    if (!model) continue;

    const maxConcurrency = Math.max(1, Number(process.env[`FORGE_API_${id}_CONCURRENCY`] || 1));
    slots.push({
      id: `api_${id}`,
      index: i,
      key,
      provider,
      model,
      base: normalizeBase(process.env[`FORGE_API_${id}_BASE`]?.trim(), provider),
      maxConcurrency,
      levels: parseLevels(process.env[`FORGE_API_${id}_REASONING_LEVELS`], provider),
      weight: Math.max(1, Number(process.env[`FORGE_API_${id}_WEIGHT`] || 1)),
      active: 0,
      totalRequests: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      state: 'HEALTHY',
      cooldownUntil: 0,
      lastFailureAt: 0,
      lastFailureCode: null,
      lastFailureMessage: null,
    });
  }
  return slots;
}

function ensureInitialized() {
  if (state.initialized) return;
  for (const slot of readSlots()) state.slots.set(slot.id, slot);
  state.initialized = true;
}

export function beginApiJob(jobId) {
  ensureInitialized();
  state.currentJobId = String(jobId || `job_${Date.now()}`);
  state.jobStartedAt = Date.now();
  for (const slot of state.slots.values()) {
    slot.active = 0;
    slot.state = 'HEALTHY';
    slot.cooldownUntil = 0;
    slot.consecutiveFailures = 0;
    slot.lastFailureAt = 0;
    slot.lastFailureCode = null;
    slot.lastFailureMessage = null;
  }
  return getApiPoolSummary();
}

export function endApiJob() {
  state.currentJobId = null;
  state.jobStartedAt = 0;
}

export function refreshApiPool() {
  if (state.globalActive !== 0) throw new Error('Cannot refresh FORGE API pool while requests are active.');
  state.slots.clear();
  state.initialized = false;
  ensureInitialized();
  return getApiPoolSummary();
}

export function getApiPoolSummary() {
  ensureInitialized();
  const now = Date.now();
  return [...state.slots.values()].map(s => ({
    id: s.id,
    provider: s.provider,
    model: s.model,
    base: s.base,
    active: s.active,
    maxConcurrency: s.maxConcurrency,
    reasoningLevels: s.levels,
    totalRequests: s.totalRequests,
    successes: s.successes,
    failures: s.failures,
    consecutiveFailures: s.consecutiveFailures,
    state: s.state === 'QUARANTINED' ? 'QUARANTINED' : (s.cooldownUntil > now ? 'COOLDOWN' : s.state),
    cooldownUntil: s.cooldownUntil || null,
    lastFailureCode: s.lastFailureCode,
  }));
}

export function getAvailableApiCount() {
  ensureInitialized();
  return state.slots.size;
}

function getGlobalLimit() {
  if (CONFIGURED_GLOBAL_CONCURRENCY > 0) return CONFIGURED_GLOBAL_CONCURRENCY;
  const total = [...state.slots.values()].reduce((sum, s) => sum + s.maxConcurrency, 0);
  return Math.max(1, Math.min(16, total || 1));
}

function distanceToSupported(desired, levels) {
  const order = ['low', 'medium', 'high', 'max'];
  const target = Math.max(0, order.indexOf(desired));
  return Math.min(...levels.map(level => Math.abs(order.indexOf(level) - target)));
}

export function chooseReasoning(mode, options = {}) {
  if (options.force && DEFAULT_LEVELS.includes(options.force)) return options.force;
  const policy = String(process.env.FORGE_REASONING_POLICY || 'auto').toLowerCase();
  if (policy !== 'auto' && DEFAULT_LEVELS.includes(policy)) return policy;
  const complexity = Number(options.complexity || 0);
  const inputChars = Number(options.inputChars || 0);
  const retry = Number(options.retry || 0);
  if (mode === 'validate') return 'low';
  if (retry > 0) return complexity >= 8 ? 'high' : 'medium';
  if (mode === 'blueprint') return complexity >= 8 ? 'max' : 'high';
  if (mode === 'script') return inputChars > 180_000 ? 'medium' : 'high';
  if (mode === 'scene_code') return complexity >= 8 ? 'high' : 'medium';
  return 'medium';
}

function isUsable(slot, now, excluded) {
  if (excluded?.has(slot.id)) return false;
  if (slot.state === 'DISABLED' || slot.state === 'QUARANTINED') {
    if (slot.cooldownUntil > now && slot.state === 'QUARANTINED') return false;
    if (slot.state === 'DISABLED') return false;
    slot.state = 'HEALTHY';
  }
  if (slot.cooldownUntil > now) return false;
  return slot.active < slot.maxConcurrency;
}

function scoreSlot(slot, desiredLevel, mode) {
  const now = Date.now();
  if (!isUsable(slot, now)) return -Infinity;
  const levelDistance = distanceToSupported(desiredLevel, slot.levels);
  const capacity = (slot.maxConcurrency - slot.active) / slot.maxConcurrency;
  const reliability = 1 / (1 + slot.consecutiveFailures * 0.6 + slot.failures * 0.03);
  const successBonus = Math.min(8, slot.successes * 0.15);
  const modeBonus = mode === 'scene_code' && slot.maxConcurrency > 1 ? 1.5 : 0;
  return capacity * 100 + slot.weight * 5 + reliability * 10 + successBonus - levelDistance * 8 + modeBonus;
}

async function acquireSlot(mode, desiredLevel, excluded = new Set()) {
  ensureInitialized();
  if (!state.slots.size) throw new Error('No usable FORGE API slots found. Configure at least one FORGE_API_XX_KEY.');

  while (state.globalActive >= getGlobalLimit()) await sleep(100);

  while (true) {
    const candidates = [...state.slots.values()]
      .map(slot => ({ slot, score: scoreSlot(slot, desiredLevel, mode) }))
      .filter(x => Number.isFinite(x.score) && !excluded.has(x.slot.id))
      .sort((a, b) => b.score - a.score);

    if (candidates.length) {
      const slot = candidates[0].slot;
      slot.active++;
      slot.totalRequests++;
      state.globalActive++;
      return slot;
    }

    const activeOrCooling = [...state.slots.values()].filter(s => s.state !== 'DISABLED' && s.state !== 'QUARANTINED');
    if (!activeOrCooling.length) {
      throw new Error('FORGE API pool exhausted: every configured slot is disabled/quarantined for this job.');
    }

    const now = Date.now();
    const nextWake = Math.min(...activeOrCooling.map(s => s.cooldownUntil || now + 250));
    const waitMs = Math.max(100, Math.min(5000, nextWake - now));
    await sleep(waitMs);
  }
}

function nearestLevel(desired, levels) {
  if (levels.includes(desired)) return desired;
  const order = ['low', 'medium', 'high', 'max'];
  const target = order.indexOf(desired);
  return [...levels].sort((a, b) => Math.abs(order.indexOf(a) - target) - Math.abs(order.indexOf(b) - target))[0] || levels[0];
}

function isReasoningUnsupported(status, text) {
  return (status === 400 || status === 422) && /reasoning_effort|reasoning effort|unsupported.*reason/i.test(String(text || ''));
}

function classifyFailure(err) {
  const status = Number(err?.status || 0);
  const code = String(err?.code || '').toUpperCase();
  if (status === 401 || status === 403) return { state: 'DISABLED', cooldownMs: 0, reason: `HTTP_${status}` };
  if (status === 429) return { state: 'COOLDOWN', cooldownMs: 45_000, reason: 'RATE_LIMIT' };
  if (code === 'SPECIAL_TOKEN_GARBAGE' || code === 'GARBAGE_OUTPUT' || code === 'MALFORMED_JSON') {
    return { state: 'QUARANTINED', cooldownMs: 90_000, reason: code };
  }
  if (code === 'OUTPUT_TRUNCATED' || code === 'EMPTY_OUTPUT' || code === 'TOKEN_BUDGET_EXHAUSTED') {
    return { state: 'COOLDOWN', cooldownMs: 20_000, reason: code };
  }
  if (status >= 500 || status === 408 || status === 409 || code.includes('TIMEOUT') || code.includes('NETWORK')) {
    return { state: 'COOLDOWN', cooldownMs: 15_000, reason: status ? `HTTP_${status}` : code || 'NETWORK' };
  }
  if (err?.retryable !== false) return { state: 'COOLDOWN', cooldownMs: 15_000, reason: code || 'RETRYABLE_ERROR' };
  return { state: 'HEALTHY', cooldownMs: 0, reason: code || `HTTP_${status || 'UNKNOWN'}` };
}

export function reportApiFailure(apiId, err) {
  ensureInitialized();
  const slot = state.slots.get(apiId);
  if (!slot) return;
  const c = classifyFailure(err);
  slot.failures++;
  slot.consecutiveFailures++;
  slot.lastFailureAt = Date.now();
  slot.lastFailureCode = c.reason;
  slot.lastFailureMessage = String(err?.message || '').slice(0, 300);
  slot.state = c.state;
  slot.cooldownUntil = c.cooldownMs ? Date.now() + c.cooldownMs : 0;
}

export function reportApiSuccess(apiId) {
  ensureInitialized();
  const slot = state.slots.get(apiId);
  if (!slot) return;
  slot.successes++;
  slot.consecutiveFailures = 0;
  slot.state = 'HEALTHY';
  slot.cooldownUntil = 0;
  slot.lastFailureCode = null;
  slot.lastFailureMessage = null;
}

function releaseSlot(slot) {
  slot.active = Math.max(0, slot.active - 1);
  state.globalActive = Math.max(0, state.globalActive - 1);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function consumeSse(response, slotId) {
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(new Error(`${slotId} API returned no readable SSE body`), { code: 'EMPTY_RESPONSE', retryable: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = 'UNKNOWN';
  let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(raw); } catch { continue; }
      const choice = chunk?.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
      const piece = choice.delta?.content;
      if (typeof piece === 'string' && piece) {
        if (/<\|[^>]{0,120}\|>/.test(piece)) {
          throw Object.assign(new Error(`${slotId} emitted special-token garbage`), {
            code: 'SPECIAL_TOKEN_GARBAGE', retryable: true, apiId: slotId,
          });
        }
        content += piece;
      }
    }
  }
  if (!content.trim()) {
    throw Object.assign(new Error(`${slotId}: empty visible output (finish_reason=${finishReason})`), {
      code: finishReason === 'length' ? 'TOKEN_BUDGET_EXHAUSTED' : 'EMPTY_OUTPUT',
      retryable: finishReason !== 'length',
      apiId: slotId,
    });
  }
  if (finishReason === 'length') {
    throw Object.assign(new Error(`${slotId}: output truncated by token limit`), { code: 'OUTPUT_TRUNCATED', retryable: true, apiId: slotId });
  }
  return { content: content.trim(), finishReason, usage };
}

export async function callApiOnce({ systemPrompt, userMessage, mode, maxTokens, complexity = 0, retry = 0, excludedApiIds = [] }) {
  const inputChars = String(userMessage || '').length;
  const desired = chooseReasoning(mode, { complexity, inputChars, retry });
  const excluded = new Set(excludedApiIds);
  const slot = await acquireSlot(mode, desired, excluded);
  let providerSucceeded = false;
  try {
    let reasoning = nearestLevel(desired, slot.levels);
    let includeReasoning = reasoning != null;

    for (let providerAttempt = 1; providerAttempt <= 2; providerAttempt++) {
      const body = {
        model: slot.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        temperature: mode === 'scene_code' ? 0.35 : mode === 'validate' ? 0.1 : 0.7,
        max_tokens: maxTokens,
        seed: 0,
        stream: true,
      };
      if (includeReasoning) body.reasoning_effort = reasoning;

      let response;
      try {
        response = await fetchWithTimeout(`${slot.base}/chat/completions`, {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${slot.key}` },
          body: JSON.stringify(body),
        }, REQUEST_TIMEOUT_MS);
      } catch (err) {
        const e = new Error(`${slot.id} ${slot.provider} network error: ${err.name === 'AbortError' ? 'request timeout' : err.message}`);
        e.apiId = slot.id;
        e.code = err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        e.retryable = true;
        reportApiFailure(slot.id, e);
        throw e;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (providerAttempt === 1 && isReasoningUnsupported(response.status, text)) {
          includeReasoning = false;
          continue;
        }
        const err = new Error(`${slot.id} ${slot.provider} HTTP ${response.status}: ${text.slice(0, 800)}`);
        err.apiId = slot.id;
        err.status = response.status;
        err.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        reportApiFailure(slot.id, err);
        throw err;
      }

      try {
        const result = await consumeSse(response, slot.id);
        providerSucceeded = true;
        reportApiSuccess(slot.id);
        return { content: result.content, finishReason: result.finishReason, tokenInfo: result.usage,
          api: { id: slot.id, provider: slot.provider, model: slot.model, reasoning } };
      } catch (err) {
        reportApiFailure(slot.id, err);
        throw err;
      }
    }
  } finally {
    releaseSlot(slot);
  }
}

export async function callApiWithLocalRetry(args, maxAttempts = MAX_RETRY_ATTEMPTS) {
  const bounded = Math.max(1, Math.min(5, Number(maxAttempts) || MAX_RETRY_ATTEMPTS));
  let lastError = null;
  const excluded = new Set();
  for (let attempt = 1; attempt <= bounded; attempt++) {
    try {
      return await callApiOnce({ ...args, retry: attempt - 1, excludedApiIds: [...excluded] });
    } catch (err) {
      lastError = err;
      if (err?.apiId) excluded.add(err.apiId);
      if (err?.status === 401 || err?.status === 403 || err?.code === 'SPECIAL_TOKEN_GARBAGE' || err?.code === 'GARBAGE_OUTPUT') {
        // The router already quarantined/disabled the slot. Never immediately select it again.
      }
      const permanent = err?.retryable === false || [400, 401, 402, 403, 404, 422].includes(err?.status) || err?.code === 'TOKEN_BUDGET_EXHAUSTED';
      if (permanent && err?.status !== 429) {
        // 401/403 is permanent for this slot, but the job may still recover on another slot.
        if (err?.status === 401 || err?.status === 403) {
          if (attempt < bounded) continue;
        }
        break;
      }
      if (attempt < bounded) {
        await sleep(err?.status === 429 ? 1000 : 250);
      }
    }
  }
  throw new Error(`FORGE API pool failed after ${bounded} controlled attempts: ${lastError?.message || 'unknown error'}`);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
