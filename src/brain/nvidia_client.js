/**
 * FORGE — Brain Provider Adapter
 *
 * Public contract intentionally preserved:
 * generateBlueprint()
 * generateScript()
 * generateSceneCode()
 * validateScene()
 *
 * The old single-Kimi transport is replaced by the dynamic API pool in
 * api_router.js. The router decides provider, model, concurrency and reasoning
 * level automatically for every request.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { RESPONSE_SCHEMAS } from './forge_schemas.js';
import { callApiWithLocalRetry, getApiPoolSummary, chooseReasoning, reportApiFailure } from './api_router.js';
import { guardRawModelText, guardParsedOutput, guardSceneCode } from './output_firewall.js';

const MODE_OUTPUT_CAPS = {
  blueprint: 64000,
  script: 48000,
  scene_code: 48000,
  validate: 16000,
};

const MAX_STRUCTURED_ATTEMPTS = Math.max(
  1,
  Number(process.env.FORGE_STRUCTURED_ATTEMPTS || 3)
);

const MAX_INPUT_CHARS = {
  blueprint: 160000,
  script: 360000,
  scene_code: 160000,
  validate: 220000,
};

const PROMPTS = {
  blueprint: fs.readFileSync(path.resolve('./prompts/blueprint_system_prompt.txt'), 'utf8'),
  script: fs.readFileSync(path.resolve('./prompts/script_system_prompt.txt'), 'utf8'),
  scene_code: fs.readFileSync(path.resolve('./prompts/scene_code_system_prompt.txt'), 'utf8'),
  validate: fs.readFileSync(path.resolve('./prompts/validate_system_prompt.txt'), 'utf8'),
};

function toJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      const types = {
        OBJECT: 'object', ARRAY: 'array', STRING: 'string', INTEGER: 'integer',
        NUMBER: 'number', BOOLEAN: 'boolean', NULL: 'null',
      };
      out[key] = types[value] || value.toLowerCase();
    } else if (key === 'nullable' && value === true) {
      continue;
    } else {
      out[key] = toJsonSchema(value);
    }
  }
  if (schema.nullable === true) {
    out.type = Array.isArray(out.type)
      ? [...out.type, 'null']
      : [out.type || 'null', 'null'];
  }
  return out;
}

function schemaFor(mode) {
  const source = RESPONSE_SCHEMAS[mode];
  if (!source) throw new Error(`No structured output schema registered for mode: ${mode}`);
  return toJsonSchema(source);
}

function sceneCountRange(durationSeconds) {
  if (durationSeconds <= 60) return { min: 6, max: 8 };
  if (durationSeconds <= 120) return { min: 8, max: 12 };
  if (durationSeconds <= 300) return { min: 12, max: 22 };
  if (durationSeconds <= 600) return { min: 20, max: 42 };
  return { min: 35, max: 100 };
}

function validateBlueprintSemantics(blueprint, targetDurationSeconds) {
  if (!blueprint?.video_meta) throw new Error('Blueprint missing video_meta');
  if (!blueprint?.style_manifest) throw new Error('Blueprint missing style_manifest');
  if (!Array.isArray(blueprint.scenes) || blueprint.scenes.length === 0) {
    throw new Error('Blueprint has no scenes');
  }

  const scenes = blueprint.scenes;
  const range = sceneCountRange(targetDurationSeconds);
  if (scenes.length < range.min || scenes.length > range.max) {
    throw new Error(`Blueprint scene count ${scenes.length} outside ${range.min}-${range.max}`);
  }
  if (Number(blueprint.video_meta.total_duration_seconds) !== Number(targetDurationSeconds)) {
    throw new Error('Blueprint duration does not equal requested duration');
  }
  if (Number(blueprint.video_meta.total_scenes) !== scenes.length) {
    throw new Error('Blueprint total_scenes does not equal scenes.length');
  }

  let cursor = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const expectedId = i + 1;
    if (scene.scene_id !== expectedId) throw new Error(`Scene IDs must be sequential: expected ${expectedId}`);
    if (!Number.isInteger(scene.duration_seconds) || scene.duration_seconds < 1) {
      throw new Error(`Scene ${scene.scene_id} has invalid duration_seconds`);
    }
    if (scene.start_second !== cursor) {
      throw new Error(`Scene ${scene.scene_id} starts at ${scene.start_second}s; expected ${cursor}s`);
    }
    if (scene.end_second !== scene.start_second + scene.duration_seconds) {
      throw new Error(`Scene ${scene.scene_id} has inconsistent timing`);
    }
    cursor = scene.end_second;
  }

  if (cursor !== targetDurationSeconds) {
    throw new Error(`Scene durations sum to ${cursor}s, expected ${targetDurationSeconds}s`);
  }

  const canvas = blueprint.style_manifest.canvas;
  if (canvas.width !== 1920 || canvas.height !== 1080 || canvas.fps !== 60) {
    throw new Error('Blueprint canvas must remain 1920x1080 at 60fps');
  }
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function repairScriptMetadata(script, blueprint) {
  if (!script || !Array.isArray(script.scenes)) return script;

  // word_count is derived data. Never spend an API retry on a model's arithmetic
  // mistake. Recompute it deterministically from the narration text.
  let total = 0;
  for (const scene of script.scenes) {
    const actual = countWords(scene.narration_text);
    scene.word_count = actual;
    total += actual;

    const blueprintScene = blueprint?.scenes?.find(s => s.scene_id === scene.scene_id);
    if (blueprintScene) {
      // Scene duration is also blueprint-owned metadata. The model must not be
      // allowed to drift it by a few tenths of a second.
      scene.duration_seconds = Number(blueprintScene.duration_seconds);
    }
  }
  if (script.script_meta) {
    script.script_meta.total_word_count = total;
    script.script_meta.estimated_speaking_duration_seconds = Math.max(1, Math.round(total / (140 / 60)));
  }
  return script;
}

function buildRecoveryFeedback(err, attempt, mode) {
  const message = String(err?.message || 'unknown validation error').slice(0, 1200);
  const code = String(err?.code || 'VALIDATION_ERROR');
  const rules = {
    script: [
      'Do not change the blueprint scene IDs or scene order.',
      'word_count and script_meta.total_word_count are derived metadata; calculate them exactly from narration text.',
      'duration_seconds must exactly match the blueprint scene duration.',
      'Return the complete JSON object, not a patch and not a partial response.',
    ],
    blueprint: [
      'Keep scene IDs sequential and make scene timing contiguous from 0 to the requested duration.',
      'Return the complete JSON object, not a patch.',
    ],
    scene_code: [
      'Return executable scene source only inside the JSON code field.',
      'Do not use Markdown fences or conversational text.',
      'Return the complete JSON object, not a patch.',
      'If the previous failure is REPETITIVE_GARBAGE, discard the previous code completely and regenerate the scene from scratch.',
      'Never copy, echo, loop, or repeat the same phrase, sentence, JSX block, or canvas drawing block to fill tokens.',
      'Every repeated visual operation must be intentional and driven by a loop over distinct data, not duplicated garbage text.',
      'Prefer a compact, complete, deterministic component over a huge answer. Correctness and renderability are more important than code length.',
      'Before returning, mentally check: one default export, valid imports, balanced braces, no Markdown, no meta text, no placeholders, no repeated garbage.',
    ],
    validate: [
      'Return the complete JSON object matching the contract.',
    ],
  }[mode] || ['Return the complete JSON object matching the contract.'];

  return [
    `FORGE SMART RECOVERY ${attempt}`,
    `Previous failure code: ${code}`,
    `Previous failure: ${message}`,
    'Fix the exact failure above before returning output.',
    ...rules,
    'Output exactly one JSON object. No Markdown. No commentary.',
  ].join('\n');
}

function validateScriptSemantics(script, blueprint, options = {}) {
  if (!script?.script_meta) throw new Error('Script missing script_meta');
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) throw new Error('Script has no scenes');

  const blueprintIds = new Set(blueprint.scenes.map(s => s.scene_id));
  const scriptIds = script.scenes.map(s => s.scene_id);
  if (scriptIds.length !== blueprintIds.size) throw new Error('Script scene count does not match blueprint');
  if (new Set(scriptIds).size !== scriptIds.length) throw new Error('Script contains duplicate scene_id values');
  for (const id of scriptIds) if (!blueprintIds.has(id)) throw new Error(`Script contains unknown scene_id ${id}`);

  let actualTotalWords = 0;
  for (const scene of script.scenes) {
    const blueprintScene = blueprint.scenes.find(s => s.scene_id === scene.scene_id);
    const actualWords = countWords(scene.narration_text);
    actualTotalWords += actualWords;
    if (Number(scene.word_count) !== actualWords) {
      throw new Error(`Scene ${scene.scene_id} word_count mismatch: declared ${scene.word_count}, actual ${actualWords}`);
    }
    if (Math.abs(Number(scene.duration_seconds) - Number(blueprintScene.duration_seconds)) > 0.5) {
      throw new Error(`Scene ${scene.scene_id} narration duration does not match blueprint scene duration`);
    }
    if (actualWords === 0) throw new Error(`Scene ${scene.scene_id} has empty narration`);
  }

  const declared = Number(script.script_meta.total_word_count);
  if (declared !== actualTotalWords) throw new Error(`Script total_word_count mismatch: declared ${declared}, actual ${actualTotalWords}`);

  const targetDuration = Number(blueprint.video_meta.total_duration_seconds);
  const wpm = actualTotalWords / (targetDuration / 60);
  const minWpm = Number(options.minWpm || 45);
  const maxWpm = Number(options.maxWpm || 190);
  if (wpm < minWpm || wpm > maxWpm) {
    throw new Error(`Script speaking pace ${wpm.toFixed(1)} WPM is outside safe ${minWpm}-${maxWpm} WPM range for ${targetDuration}s`);
  }
}


function buildDeterministicSceneFallback(sceneSpec, scriptScene, styleManifest, waveformAvailable) {
  const safeJson = value => JSON.stringify(String(value ?? '').slice(0, 1400));
  const sceneId = Number(sceneSpec?.scene_id || 1);
  const title = safeJson(sceneSpec?.title || `Scene ${sceneId}`);
  const narration = safeJson(scriptScene?.narration_text || sceneSpec?.concept || '');
  const palette = styleManifest?.palette || {};
  const bg = safeJson(palette.background || '#07111f');
  const primary = safeJson(palette.primary || '#f5f7ff');
  const accent = safeJson(palette.accent || '#65d8ff');
  const secondary = safeJson(palette.secondary || '#7f8cff');
  const surface = safeJson(palette.surface || '#12243a');
  const particle = safeJson(palette.particle || '#9be7ff');
  const reactivity = Number(styleManifest?.animation_personality?.waveform_reactivity ?? 0.6);
  const safeReactivity = Number.isFinite(reactivity) ? Math.max(0, Math.min(1, reactivity)) : 0.6;
  const visualElements = Array.isArray(sceneSpec?.key_visual_elements)
    ? sceneSpec.key_visual_elements.slice(0, 4).map(safeJson)
    : [];
  const elementsLiteral = `[${visualElements.join(', ')}]`;

  return `import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { useEffect, useMemo, useRef } from 'react';

const BG = ${bg};
const PRIMARY = ${primary};
const ACCENT = ${accent};
const SECONDARY = ${secondary};
const SURFACE = ${surface};
const PARTICLE = ${particle};
const WAVEFORM_REACTIVITY = ${safeReactivity};
const TITLE = ${title};
const NARRATION = ${narration};
const ELEMENTS = ${elementsLiteral};

function seededRandom(seed) {
  let s = Math.abs(Math.floor(seed)) || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export default function Scene${sceneId}(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const canvasRef = useRef(null);
  const waveform = Array.isArray(props?.waveform) ? props.waveform : [];
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const wave = waveform[frame] || {
    amplitude: 0.15,
    peak: 0.2,
    smoothed: 0.18,
    is_onset: false,
    bands: { sub_bass: 0.1, bass: 0.15, mid: 0.18, high: 0.1 },
    energy: 0.18,
    brightness: 0.2,
    warmth: 0.2
  };
  const amp = Number(wave.amplitude) || 0;
  const smooth = Number(wave.smoothed) || 0;
  const bass = Number(wave?.bands?.bass) || 0;
  const mid = Number(wave?.bands?.mid) || 0;
  const high = Number(wave?.bands?.high) || 0;
  const onset = Boolean(wave.is_onset);

  const particles = useMemo(() => {
    const rand = seededRandom(${sceneId} * 1009 + 41);
    return Array.from({ length: 70 }, (_, i) => ({
      x: rand() * 1920,
      y: rand() * 1080,
      size: rand() * 3 + 1,
      speed: rand() * 0.7 + 0.15,
      phase: rand() * Math.PI * 2,
      alpha: rand() * 0.45 + 0.15,
      drift: (rand() - 0.5) * 0.7
    }));
  }, []);

  const intro = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90, mass: 0.8 },
    from: 0,
    to: 1
  });
  const titleScale = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 13, stiffness: 120, mass: 0.7 },
    from: 1.12,
    to: 1
  });
  const fadeIn = interpolate(frame, [0, Math.min(20, durationInFrames / 4)], [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOutStart = Math.max(0, durationInFrames - 20);
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const masterOpacity = Math.min(fadeIn, fadeOut);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 1920, 1080);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, 1920, 1080);

    const gradient = ctx.createRadialGradient(960, 500, 80, 960, 540, 900);
    gradient.addColorStop(0, SURFACE + 'bb');
    gradient.addColorStop(0.55, BG + 'cc');
    gradient.addColorStop(1, BG);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1920, 1080);

    const pulse = 1 + bass * WAVEFORM_REACTIVITY * 0.35;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const x = (p.x + frame * p.speed + Math.sin(frame * 0.012 + p.phase) * 28) % 1920;
      const y = (p.y + Math.sin(frame * 0.009 + p.phase) * 24 + frame * p.drift * 0.12) % 1080;
      const r = p.size * (1 + amp * WAVEFORM_REACTIVITY * 0.7);
      ctx.beginPath();
      ctx.globalAlpha = p.alpha * (0.7 + smooth * 0.8);
      ctx.fillStyle = PARTICLE;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const ringR = 150 + bass * WAVEFORM_REACTIVITY * 100;
    ctx.save();
    ctx.translate(960, 470);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 32 + mid * 55;
    ctx.strokeStyle = ACCENT + '88';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = SECONDARY + '55';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, ringR + 55 + high * 35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.18 + high * 0.12;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    for (let x = 0; x <= 1920; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1080);
      ctx.stroke();
    }
    for (let y = 0; y <= 1080; y += 90) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1920, y);
      ctx.stroke();
    }
    ctx.restore();

    if (${Boolean(waveformAvailable)}) {
      ctx.save();
      ctx.strokeStyle = ACCENT + '99';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const width = 900;
      const left = 510;
      const baseY = 950;
      for (let i = 0; i < width; i += 3) {
        const idx = Math.max(0, frame - width + i);
        const d = waveform[idx] || {};
        const value = Number(d.mid ?? d.amplitude ?? 0) || 0;
        const x = left + i;
        const y = baseY - value * 90;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const barWidth = 220 + mid * 180;
    ctx.save();
    ctx.fillStyle = ACCENT + '44';
    ctx.fillRect(850 - barWidth / 2, 100, barWidth, 5);
    ctx.restore();
  }, [frame, particles, waveform, waveform.length]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      background: BG,
      opacity: masterOpacity
    }}>
      <canvas ref={canvasRef} width={1920} height={1080}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute',
        left: 120,
        right: 120,
        top: 210,
        transform: \`scale(\${titleScale}) translateY(\${(1 - intro) * 24}px)\`,
        color: PRIMARY,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 800,
        fontSize: 78,
        lineHeight: 1.05,
        letterSpacing: '-0.02em',
        textShadow: \`0 0 \${28 + mid * 40}px \${ACCENT}\`,
        textAlign: 'center'
      }}>
        {TITLE}
      </div>
      <div style={{
        position: 'absolute',
        left: 190,
        right: 190,
        top: 640,
        color: PRIMARY,
        opacity: 0.86,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 30,
        lineHeight: 1.35,
        textAlign: 'center'
      }}>
        {NARRATION.slice(0, 260)}
      </div>
      <div style={{
        position: 'absolute',
        left: 150,
        bottom: 120,
        color: SECONDARY,
        opacity: 0.7,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 18,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        textAlign: 'center',
        width: 1620
      }}>
        {ELEMENTS.join('  •  ')}
      </div>
      <div style={{
        position: 'absolute',
        inset: 0,
        border: \`2px solid \${ACCENT}33\`,
        pointerEvents: 'none'
      }} />
    </div>
  );
}
`;
}

function validateSceneCodeResult(result, sceneId) {
  if (!result?.code) throw new Error(`Scene ${sceneId}: no code returned`);
  if (typeof result.code !== 'string') throw new Error(`Scene ${sceneId}: code is not a string`);
  if (result.code.length < 100) throw new Error(`Scene ${sceneId}: code too short`);
  if (result.code.length > 180000) throw new Error(`Scene ${sceneId}: code unexpectedly large`);
}

function parseJsonObject(rawText) {
  const cleaned = String(rawText || '').trim();
  guardRawModelText(cleaned, 'structured');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const e = new Error(`Model returned malformed JSON: ${err.message}`);
    e.code = 'MALFORMED_JSON';
    e.retryable = true;
    throw e;
  }
  return parsed;
}

function buildSchemaInstruction(mode) {
  return [
    'FORGE OUTPUT CONTRACT',
    'Return exactly ONE JSON object matching this schema.',
    'No Markdown. No code fences. No commentary. No explanation outside the JSON object.',
    JSON.stringify(schemaFor(mode)),
    'END FORGE OUTPUT CONTRACT',
  ].join('\n');
}

function localSceneValidation(code, sceneSpec, waveformAvailable) {
  const critical_errors = [];
  const warnings = [];
  const text = String(code || '');

  if (!text.trim()) critical_errors.push({ type: 'empty_code', line_hint: '0', description: 'Scene code is empty.' });
  if (!/export\s+default\s+/.test(text)) {
    critical_errors.push({ type: 'missing_default_export', line_hint: 'unknown', description: 'Scene must have a default export.' });
  }
  if (!/\bfrom\s+['"]remotion['"]/.test(text)) {
    critical_errors.push({ type: 'missing_remotion_import', line_hint: 'imports', description: 'Scene must import from Remotion.' });
  }
  if (!/\b(AbsoluteFill|Sequence|useCurrentFrame|interpolate|spring)\b/.test(text)) {
    warnings.push({ type: 'weak_remotion_usage', line_hint: 'unknown', description: 'No common Remotion animation primitive was detected.' });
  }

  const forbidden = [
    [/\bchild_process\b/, 'child_process'],
    [/\b(?:fs|fs\/promises)\b/, 'filesystem'],
    [/\bprocess\.env\b/, 'process.env'],
    [/\bprocess\.exit\b/, 'process.exit'],
  ];
  for (const [rx, label] of forbidden) {
    if (rx.test(text)) {
      critical_errors.push({
        type: 'forbidden_runtime_api',
        line_hint: 'unknown',
        description: `Scene references forbidden runtime API: ${label}`,
      });
    }
  }

  if (waveformAvailable && sceneSpec?.requires_particles && !/waveform/i.test(text)) {
    warnings.push({
      type: 'waveform_not_obvious',
      line_hint: 'unknown',
      description: 'Audio is available but waveform usage was not detected in the scene code.',
    });
  }

  // Lightweight structural sanity check. It intentionally ignores string
  // contents so visual text containing braces does not cause false failures.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [a, b] of pairs) {
    let depth = 0;
    for (const ch of stripped) {
      if (ch === a) depth++;
      else if (ch === b) depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) {
      critical_errors.push({
        type: 'unbalanced_syntax',
        line_hint: 'unknown',
        description: `Unbalanced ${a}${b} delimiters detected.`,
      });
    }
  }

  return {
    valid: critical_errors.length === 0,
    critical_errors,
    warnings,
    estimated_complexity_achieved: Math.min(10, Math.max(1, Number(sceneSpec?.complexity_level || 5))),
    waveform_reactivity_implemented: !waveformAvailable || /waveform/i.test(text),
    render_confidence: critical_errors.length === 0 ? (warnings.length ? 'medium' : 'high') : 'low',
    auto_fixable: critical_errors.length > 0,
    fix_instructions: critical_errors.length
      ? critical_errors.map(e => e.description).join(' ')
      : null,
  };
}

async function generateStructured(userMessage, mode, validator = null, maxTokensOverride = null, complexity = 0, repairContext = {}) {
  const maxTokens = maxTokensOverride ?? MODE_OUTPUT_CAPS[mode];
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_STRUCTURED_ATTEMPTS; attempt++) {
    let message = `${userMessage}\n\n${buildSchemaInstruction(mode)}`;

    if (attempt > 1) {
      message += `\n\n${buildRecoveryFeedback(lastError, attempt, mode)}`;
    }

    let response = null;
    try {
      if (message.length > (MAX_INPUT_CHARS[mode] || 200000)) {
        const err = new Error(`${mode} input exceeds its safety budget`);
        err.code = 'INPUT_TOO_LARGE';
        err.retryable = false;
        throw err;
      }

      const selectedReasoning = chooseReasoning(mode, {
        complexity,
        inputChars: message.length,
        retry: attempt - 1,
      });

      log(`  API router: mode=${mode}, target_reasoning=${selectedReasoning}, attempt=${attempt}/${MAX_STRUCTURED_ATTEMPTS}`);

      response = await callApiWithLocalRetry({
        systemPrompt: PROMPTS[mode],
        userMessage: message,
        mode,
        maxTokens,
        complexity,
      }, 1);

      const result = parseJsonObject(response.content);
      guardParsedOutput(result, mode);
      if (mode === 'script' && repairContext?.blueprint) repairScriptMetadata(result, repairContext.blueprint);
      if (validator) validator(result);
      if (mode === 'scene_code') {
        result.code = guardSceneCode(result.code);
        const local = localSceneValidation(result.code, null, false);
        if (!local.valid) {
          const e = new Error(`Scene code firewall rejected output: ${local.critical_errors.map(x => x.description).join(' | ')}`);
          e.code = 'SCENE_CODE_FIREWALL';
          e.retryable = true;
          throw e;
        }
      }
      log(`  API router: ${response.api.id} / ${response.api.provider} / ${response.api.model} / reasoning=${response.api.reasoning}`);
      return result;
    } catch (err) {
      lastError = err;
      if (response?.api?.id && ![401, 403].includes(err?.status)) {
        reportApiFailure(response.api.id, err);
      }
      log(`  ${mode} attempt ${attempt}/${MAX_STRUCTURED_ATTEMPTS} failed: ${err.message}`);

      // 401/403 are permanent for the selected slot, not for the whole job.
      // The router disables that slot and the next structured attempt must use another slot.
      const permanentForJob = err?.retryable === false && ![401, 403].includes(err?.status) &&
        !['MALFORMED_JSON', 'SPECIAL_TOKEN_GARBAGE', 'GARBAGE_OUTPUT', 'SCENE_CODE_FIREWALL', 'SCENE_LOCAL_VALIDATION'].includes(err?.code);

      if (permanentForJob || attempt === MAX_STRUCTURED_ATTEMPTS) break;
    }
  }

  if (mode === 'scene_code' && repairContext?.sceneSpec) {
    log(`  Scene ${repairContext.sceneSpec.scene_id}: AI recovery exhausted; using deterministic safe scene fallback.`);
    return {
      code: buildDeterministicSceneFallback(
        repairContext.sceneSpec,
        repairContext.scriptScene,
        repairContext.styleManifest,
        repairContext.waveformAvailable
      ),
      _fallback: true,
      _fallbackReason: String(lastError?.message || 'unknown AI failure').slice(0, 500),
    };
  }

  throw new Error(
    `FORGE ${mode} failed after ${MAX_STRUCTURED_ATTEMPTS} controlled attempts: ${lastError?.message || 'unknown error'}`
  );
}

export function getBrainPoolStatus() {
  return getApiPoolSummary();
}

export async function generateBlueprint(userPrompt, style, targetDurationSeconds, factsBrief) {
  const userMessage = JSON.stringify({
    mode: 'blueprint',
    prompt: userPrompt,
    requested_style: style,
    target_duration_seconds: targetDurationSeconds,
    scene_budget: sceneCountRange(targetDurationSeconds),
    research_brief: factsBrief.brief_text,
    research_meta: {
      categories: factsBrief.categories,
      total_facts: factsBrief.total_facts,
      sources: factsBrief.sources_used,
    },
  });

  const blueprint = await generateStructured(
    userMessage,
    'blueprint',
    result => validateBlueprintSemantics(result, targetDurationSeconds),
    null,
    8
  );

  if (!blueprint.style_manifest.animation_personality) {
    blueprint.style_manifest.animation_personality = {};
  }
  if (typeof blueprint.style_manifest.animation_personality.waveform_reactivity !== 'number') {
    blueprint.style_manifest.animation_personality.waveform_reactivity = 0.6;
  }
  blueprint.total_scenes = blueprint.scenes.length;
  return blueprint;
}

export async function generateScript(blueprint, factsBrief, recoveryHint = '') {
  const userMessage = JSON.stringify({
    mode: 'script',
    blueprint,
    research_brief: factsBrief.brief_text,
    duration_recovery: recoveryHint || null,
  });
  return generateStructured(
    userMessage,
    'script',
    result => validateScriptSemantics(result, blueprint),
    null,
    6,
    { blueprint }
  );
}

export async function generateSceneCode(sceneSpec, scriptScene, styleManifest, sceneIndex, waveformAvailable) {
  const durationFrames = sceneSpec.duration_seconds * styleManifest.canvas.fps;
  const userMessage = JSON.stringify({
    mode: 'scene_code',
    scene_spec: sceneSpec,
    narration_text: scriptScene?.narration_text || '',
    emphasis_words: scriptScene?.emphasis_words || [],
    style_manifest: styleManifest,
    duration_frames: durationFrames,
    scene_index: sceneIndex,
    waveform_available: waveformAvailable,
    waveform_reactivity: styleManifest.animation_personality?.waveform_reactivity || 0.6,
  });

  const result = await generateStructured(
    userMessage,
    'scene_code',
    value => validateSceneCodeResult(value, sceneSpec.scene_id),
    null,
    Number(sceneSpec.complexity_level || 5),
    {
      sceneSpec,
      scriptScene,
      styleManifest,
      waveformAvailable,
    }
  );

  const local = localSceneValidation(result.code, sceneSpec, waveformAvailable);
  if (!local.valid) {
    const err = new Error(
      `Scene ${sceneSpec.scene_id} failed local validation: ${local.critical_errors.map(e => e.type).join(', ')}`
    );
    err.code = 'SCENE_LOCAL_VALIDATION';
    err.retryable = true;
    throw err;
  }

  return result.code;
}

export async function validateScene(sceneCode, sceneSpec, waveformAvailable) {
  // Deliberately local and deterministic. AI validation was a major latency
  // multiplier and duplicated checks that can be enforced by the renderer.
  return localSceneValidation(sceneCode, sceneSpec, waveformAvailable);
}

export const __test = {
  schemaFor,
  parseJsonObject,
  localSceneValidation,
  buildDeterministicSceneFallback,
  getBrainPoolStatus,
};
