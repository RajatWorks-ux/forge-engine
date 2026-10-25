/**
 * FORGE provider compatibility entrypoint.
 *
 * The original pipeline imports this filename, so it is intentionally retained.
 * The actual provider implementation is now NVIDIA Kimi-K3 in nvidia_client.js.
 */
export {
  generateBlueprint,
  generateScript,
  generateSceneCode,
  validateScene,
  getBrainPoolStatus,
  __test,
} from './nvidia_client.js';
