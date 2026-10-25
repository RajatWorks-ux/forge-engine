/**
 * FORGE — Structured Output Schemas
 *
 * These schemas preserve the baseline FORGE data contract. The NVIDIA Kimi-K3 adapter
 * converts the transport type spelling to standard JSON Schema at request time.
 * The client also performs semantic validation after generation.
 */

const STRING = { type: 'STRING' };
const INTEGER = { type: 'INTEGER' };
const NUMBER = { type: 'NUMBER' };
const BOOLEAN = { type: 'BOOLEAN' };

const stringArray = (minItems = 0, maxItems = 20) => ({
  type: 'ARRAY',
  minItems,
  maxItems,
  items: STRING,
});

const sceneType = {
  type: 'STRING',
  enum: [
    'intro',
    'concept_reveal',
    'deep_dive',
    'data_visual',
    'timeline',
    'diagram',
    'transition',
    'climax',
    'conclusion',
    'outro',
  ],
};

export const BLUEPRINT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    video_meta: {
      type: 'OBJECT',
      properties: {
        title: STRING,
        topic: STRING,
        total_duration_seconds: INTEGER,
        total_scenes: INTEGER,
        target_audience: STRING,
        content_rating: {
          type: 'STRING',
          enum: ['general', 'educational_adult', 'documentary'],
        },
        pacing: {
          type: 'STRING',
          enum: ['slow_cinematic', 'moderate_educational', 'fast_dynamic', 'variable'],
        },
        research_coverage: {
          type: 'OBJECT',
          properties: {
            has_historical_data: BOOLEAN,
            has_current_data: BOOLEAN,
            has_scientific_data: BOOLEAN,
            has_statistics: BOOLEAN,
            has_future_implications: BOOLEAN,
            key_facts_count: INTEGER,
          },
          required: [
            'has_historical_data',
            'has_current_data',
            'has_scientific_data',
            'has_statistics',
            'has_future_implications',
            'key_facts_count',
          ],
        },
      },
      required: [
        'title',
        'topic',
        'total_duration_seconds',
        'total_scenes',
        'target_audience',
        'content_rating',
        'pacing',
        'research_coverage',
      ],
    },

    style_manifest: {
      type: 'OBJECT',
      properties: {
        palette: {
          type: 'OBJECT',
          properties: {
            background: STRING,
            primary: STRING,
            accent: STRING,
            secondary: STRING,
            surface: STRING,
            particle: STRING,
          },
          required: ['background', 'primary', 'accent', 'secondary', 'surface', 'particle'],
        },
        typography: {
          type: 'OBJECT',
          properties: {
            heading_font: STRING,
            body_font: STRING,
            heading_weight: INTEGER,
            body_weight: INTEGER,
            heading_size_base: NUMBER,
            body_size_base: NUMBER,
          },
          required: [
            'heading_font',
            'body_font',
            'heading_weight',
            'body_weight',
            'heading_size_base',
            'body_size_base',
          ],
        },
        visual_language: {
          type: 'STRING',
          enum: [
            'particle_cosmos',
            'geometric_sharp',
            'fluid_organic',
            'data_manifold',
            'abstract_kinetic',
            'cinematic_dark',
            'typographic_storm',
          ],
        },
        animation_personality: {
          type: 'OBJECT',
          properties: {
            speed: {
              type: 'STRING',
              enum: ['glacial', 'slow', 'medium', 'fast', 'explosive'],
            },
            easing: STRING,
            transition_style: {
              type: 'STRING',
              enum: ['cut', 'fade', 'slide', 'morph', 'shatter', 'dissolve'],
            },
            complexity: { type: 'INTEGER', minimum: 1, maximum: 10 },
            waveform_reactivity: { type: 'NUMBER', minimum: 0, maximum: 1 },
          },
          required: ['speed', 'easing', 'transition_style', 'complexity', 'waveform_reactivity'],
        },
        canvas: {
          type: 'OBJECT',
          properties: {
            width: INTEGER,
            height: INTEGER,
            fps: INTEGER,
            background_treatment: {
              type: 'STRING',
              enum: ['solid', 'gradient_subtle', 'noise_texture', 'scanlines'],
            },
          },
          required: ['width', 'height', 'fps', 'background_treatment'],
        },
      },
      required: ['palette', 'typography', 'visual_language', 'animation_personality', 'canvas'],
    },

    scenes: {
      type: 'ARRAY',
      minItems: 5,
      maxItems: 100,
      items: {
        type: 'OBJECT',
        properties: {
          scene_id: INTEGER,
          scene_type: sceneType,
          title: STRING,
          duration_seconds: INTEGER,
          start_second: INTEGER,
          end_second: INTEGER,
          concept: STRING,
          research_facts_used: stringArray(0, 12),
          visual_approach: STRING,
          key_visual_elements: stringArray(1, 12),
          animation_sequence: stringArray(1, 10),
          waveform_effects: stringArray(0, 8),
          transition_in: STRING,
          transition_out: STRING,
          complexity_level: { type: 'INTEGER', minimum: 1, maximum: 10 },
          requires_3d: BOOLEAN,
          requires_particles: BOOLEAN,
          requires_diagram: BOOLEAN,
          requires_text_animation: BOOLEAN,
          narration_cue: STRING,
        },
        required: [
          'scene_id',
          'scene_type',
          'title',
          'duration_seconds',
          'start_second',
          'end_second',
          'concept',
          'research_facts_used',
          'visual_approach',
          'key_visual_elements',
          'animation_sequence',
          'waveform_effects',
          'transition_in',
          'transition_out',
          'complexity_level',
          'requires_3d',
          'requires_particles',
          'requires_diagram',
          'requires_text_animation',
          'narration_cue',
        ],
      },
    },
  },
  required: ['video_meta', 'style_manifest', 'scenes'],
};

export const SCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    script_meta: {
      type: 'OBJECT',
      properties: {
        total_word_count: INTEGER,
        estimated_speaking_duration_seconds: INTEGER,
        voice_style: {
          type: 'STRING',
          enum: ['documentary', 'educational', 'storytelling', 'journalistic'],
        },
        tone: {
          type: 'STRING',
          enum: ['authoritative', 'conversational', 'dramatic', 'scientific', 'poetic'],
        },
        fact_density: {
          type: 'STRING',
          enum: ['high', 'medium', 'low'],
        },
        research_utilization: STRING,
      },
      required: [
        'total_word_count',
        'estimated_speaking_duration_seconds',
        'voice_style',
        'tone',
        'fact_density',
        'research_utilization',
      ],
    },
    scenes: {
      type: 'ARRAY',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'OBJECT',
        properties: {
          scene_id: INTEGER,
          narration_text: STRING,
          word_count: INTEGER,
          duration_seconds: NUMBER,
          speaking_pace: {
            type: 'STRING',
            enum: ['slow', 'normal', 'fast'],
          },
          emphasis_words: stringArray(0, 20),
          pause_after_seconds: { type: 'NUMBER', minimum: 0, maximum: 2 },
          facts_cited: stringArray(0, 12),
        },
        required: [
          'scene_id',
          'narration_text',
          'word_count',
          'duration_seconds',
          'speaking_pace',
          'emphasis_words',
          'pause_after_seconds',
          'facts_cited',
        ],
      },
    },
  },
  required: ['script_meta', 'scenes'],
};

// Scene code is intentionally a one-field envelope. The runtime firewall validates
// the executable source separately so the model cannot hide unsafe code in metadata.
export const SCENE_CODE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    code: STRING,
  },
  required: ['code'],
};

export const VALIDATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    valid: BOOLEAN,
    critical_errors: {
      type: 'ARRAY',
      maxItems: 30,
      items: {
        type: 'OBJECT',
        properties: {
          type: STRING,
          line_hint: STRING,
          description: STRING,
        },
        required: ['type', 'line_hint', 'description'],
      },
    },
    warnings: {
      type: 'ARRAY',
      maxItems: 30,
      items: {
        type: 'OBJECT',
        properties: {
          type: STRING,
          line_hint: STRING,
          description: STRING,
        },
        required: ['type', 'line_hint', 'description'],
      },
    },
    estimated_complexity_achieved: { type: 'INTEGER', minimum: 1, maximum: 10 },
    waveform_reactivity_implemented: BOOLEAN,
    render_confidence: {
      type: 'STRING',
      enum: ['high', 'medium', 'low'],
    },
    auto_fixable: BOOLEAN,
    fix_instructions: { type: 'STRING', nullable: true },
  },
  required: [
    'valid',
    'critical_errors',
    'warnings',
    'estimated_complexity_achieved',
    'waveform_reactivity_implemented',
    'render_confidence',
    'auto_fixable',
    'fix_instructions',
  ],
};

export const RESPONSE_SCHEMAS = {
  blueprint: BLUEPRINT_SCHEMA,
  script: SCRIPT_SCHEMA,
  scene_code: SCENE_CODE_SCHEMA,
  validate: VALIDATE_SCHEMA,
};
