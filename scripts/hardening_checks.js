/** FORGE resilience checks — no real network/API calls. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';

process.env.FORGE_API_SLOTS = '3';
process.env.FORGE_API_01_KEY = 'local-01';
process.env.FORGE_API_01_PROVIDER = 'nvidia';
process.env.FORGE_API_01_MODEL = 'model-01';
process.env.FORGE_API_02_KEY = 'local-02';
process.env.FORGE_API_02_PROVIDER = 'nvidia';
process.env.FORGE_API_02_MODEL = 'model-02';
process.env.FORGE_API_03_KEY = 'local-03';
process.env.FORGE_API_03_PROVIDER = 'nvidia';
process.env.FORGE_API_03_MODEL = 'model-03';

const router = await import('../src/brain/api_router.js?hardening=' + Date.now());
const { writeJson } = await import('../src/utils/fs_helpers.js');
const { saveJobState, loadJobState } = await import('../src/utils/job_state.js');
const { guardSceneCode, __test: firewallTest } = await import('../src/brain/output_firewall.js');
const { __test: brainTest } = await import('../src/brain/nvidia_client.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); process.exitCode = 1; }
}

console.log('\nFORGE hardening checks\n' + '─'.repeat(60));
router.beginApiJob('hardening-job');

await test('403 disables only the failed API slot', () => {
  router.reportApiFailure('api_01', Object.assign(new Error('auth'), { status: 403 }));
  const slot = router.getApiPoolSummary().find(x => x.id === 'api_01');
  assert.equal(slot.state, 'DISABLED');
});

await test('429 puts the failed API into cooldown', () => {
  router.reportApiFailure('api_02', Object.assign(new Error('rate'), { status: 429 }));
  const slot = router.getApiPoolSummary().find(x => x.id === 'api_02');
  assert.equal(slot.state, 'COOLDOWN');
});

await test('special-token garbage quarantines the slot', () => {
  router.reportApiFailure('api_03', Object.assign(new Error('garbage'), { code: 'SPECIAL_TOKEN_GARBAGE', retryable: true }));
  const slot = router.getApiPoolSummary().find(x => x.id === 'api_03');
  assert.equal(slot.state, 'QUARANTINED');
});

await test('new job resets transient slot health without changing env', () => {
  router.endApiJob();
  router.beginApiJob('hardening-job-2');
  assert.ok(router.getApiPoolSummary().every(x => x.state === 'HEALTHY'));
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hardening-'));
const jobDir = path.join(temp, 'job');
fs.mkdirSync(jobDir, { recursive: true });

await saveJobState(jobDir, { id: 'job-1', status: 'running', value: 1 });
await saveJobState(jobDir, { id: 'job-1', status: 'running', value: 2 });
await test('job state survives an intentionally corrupted primary file', () => {
  fs.writeFileSync(path.join(jobDir, 'job.json'), '{corrupt');
  const recovered = loadJobState(jobDir);
  return Promise.resolve(recovered).then(value => assert.equal(value.value, 1));
});

await test('atomic JSON writer refuses empty serialized data', () => {
  assert.throws(() => writeJson(path.join(temp, 'empty.json'), undefined));
});


await test('scene-code firewall uses code-aware repetition protection', () => {
  const normalCode = `export default function Scene1(){\n  for (let i=0;i<30;i++){\n    ctx.beginPath();\n    ctx.arc(i*10, 100, 4, 0, Math.PI*2);\n    ctx.fill();\n  }\n}\n` + ' '.repeat(0);
  assert.doesNotThrow(() => firewallTest.sceneCodeRepetitionScore(normalCode));
});

await test('deterministic scene fallback is complete and render-safe', () => {
  const code = brainTest.buildDeterministicSceneFallback(
    { scene_id: 7, title: 'Closing Card', key_visual_elements: ['signal', 'discovery'] },
    { narration_text: 'A concise closing narration.' },
    {
      palette: {
        background: '#07111f', primary: '#f5f7ff', accent: '#65d8ff',
        secondary: '#7f8cff', surface: '#12243a', particle: '#9be7ff'
      },
      animation_personality: { waveform_reactivity: 0.6 },
      canvas: { fps: 60 }
    },
    true
  );
  guardSceneCode(code);
  assert.match(code, /export default function Scene7/);
  assert.match(code, /from 'remotion'/);
  assert.doesNotMatch(code, /child_process|process\.env|process\.exit/);
});

fs.rmSync(temp, { recursive: true, force: true });
if (process.exitCode) {
  console.error('HARDENING CHECKS FAILED');
  process.exit(1);
}
console.log(`HARDENING CHECKS PASS (${passed} tests)`);
