import { createHash } from 'node:crypto';
import Ajv from 'ajv';

import { listTemplates } from './templates.mjs';

const templateNames = listTemplates().map((template) => template.name);

export const requirementSchema = {
  $id: 'hershy.program.instance.requirement.v1',
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['template', 'custom'],
      default: 'template'
    },
    template: {
      type: 'string',
      enum: templateNames
    },
    user_id: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      pattern: '^[a-zA-Z0-9._:-]+$'
    },
    auto_start: {
      type: 'boolean',
      default: true
    },
    wait_ready: {
      type: 'boolean',
      default: true
    },
    ready_timeout_sec: {
      type: 'integer',
      minimum: 10,
      maximum: 3600,
      default: 300
    },
    custom_program: {
      type: 'object',
      additionalProperties: false,
      required: ['dockerfile', 'src_files'],
      properties: {
        dockerfile: {
          type: 'string',
          minLength: 1
        },
        src_files: {
          type: 'object',
          minProperties: 1,
          additionalProperties: {
            type: 'string'
          }
        }
      }
    },
    access: {
      type: 'object',
      additionalProperties: false,
      required: ['server_id', 'requester_x25519_pubkey', 'requested_endpoints'],
      properties: {
        server_id: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          pattern: '^[a-zA-Z0-9._:-]+$'
        },
        requester_x25519_pubkey: {
          type: 'string',
          minLength: 40,
          maxLength: 120,
          pattern: '^[A-Za-z0-9_-]+$'
        },
        requested_endpoints: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          uniqueItems: true,
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 180,
            pattern: '^/[a-zA-Z0-9._:/*-]+$'
          }
        },
        session_ttl_sec: {
          type: 'integer',
          minimum: 30,
          maximum: 604800
        }
      }
    },
    meta: {
      type: 'object',
      additionalProperties: true
    }
  },
  required: ['mode', 'user_id', 'auto_start', 'wait_ready', 'ready_timeout_sec', 'access'],
  allOf: [
    {
      if: {
        properties: {
          mode: {
            const: 'template'
          }
        }
      },
      then: {
        required: ['template']
      }
    },
    {
      if: {
        properties: {
          mode: {
            const: 'custom'
          }
        }
      },
      then: {
        required: ['custom_program']
      }
    }
  ]
};

export const deliverableSchema = {
  $id: 'hershy.program.instance.deliverable.v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'status',
    'request',
    'program',
    'links',
    'access',
    'checksums',
    'timestamps'
  ],
  properties: {
    version: {
      type: 'string'
    },
    status: {
      type: 'string',
      enum: ['created', 'ready', 'error']
    },
    request: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'template', 'user_id', 'auto_start', 'wait_ready', 'ready_timeout_sec'],
      properties: {
        mode: {
          type: 'string',
          enum: ['template', 'custom']
        },
        template: {
          type: 'string'
        },
        user_id: {
          type: 'string'
        },
        auto_start: {
          type: 'boolean'
        },
        wait_ready: {
          type: 'boolean'
        },
        ready_timeout_sec: {
          type: 'integer'
        },
        src_file_count: {
          type: 'integer'
        }
      }
    },
    program: {
      type: 'object',
      additionalProperties: false,
      required: ['program_id', 'build_id', 'state', 'proxy_url'],
      properties: {
        program_id: {
          type: 'string'
        },
        build_id: {
          type: 'string'
        },
        state: {
          type: 'string'
        },
        proxy_url: {
          type: 'string'
        },
        image_id: {
          type: 'string'
        },
        container_id: {
          type: 'string'
        },
        error_msg: {
          type: 'string'
        }
      }
    },
    links: {
      type: 'object',
      additionalProperties: false,
      required: ['status_url', 'logs_url', 'source_url', 'watcher_proxy_base'],
      properties: {
        status_url: { type: 'string' },
        logs_url: { type: 'string' },
        source_url: { type: 'string' },
        watcher_proxy_base: { type: 'string' },
        stop_url: { type: 'string' },
        restart_url: { type: 'string' }
      }
    },
    access: {
      type: 'object',
      additionalProperties: false,
      required: [
        'server_id',
        'server_mode',
        'requested_endpoints',
        'session_ttl_sec',
        'issued_at',
        'expires_at',
        'encrypted_payload',
        'checksums'
      ],
      properties: {
        server_id: { type: 'string' },
        server_mode: {
          type: 'string',
          enum: ['persistent', 'session']
        },
        requested_endpoints: {
          type: 'array',
          items: { type: 'string' }
        },
        session_ttl_sec: { type: 'integer', minimum: 0 },
        issued_at: { type: 'string' },
        expires_at: {
          type: ['string', 'null']
        },
        encrypted_payload: {
          type: 'object',
          additionalProperties: false,
          required: [
            'alg',
            'key_format',
            'ephemeral_public_key',
            'salt',
            'iv',
            'aad',
            'ciphertext',
            'tag'
          ],
          properties: {
            alg: { type: 'string' },
            key_format: { type: 'string' },
            ephemeral_public_key: { type: 'string' },
            salt: { type: 'string' },
            iv: { type: 'string' },
            aad: { type: 'string' },
            ciphertext: { type: 'string' },
            tag: { type: 'string' }
          }
        },
        checksums: {
          type: 'object',
          additionalProperties: false,
          required: ['encrypted_payload_sha256'],
          properties: {
            encrypted_payload_sha256: { type: 'string' }
          }
        }
      }
    },
    checksums: {
      type: 'object',
      additionalProperties: false,
      required: ['requirement_sha256', 'source_sha256'],
      properties: {
        requirement_sha256: {
          type: 'string'
        },
        source_sha256: {
          type: 'string'
        }
      }
    },
    timestamps: {
      type: 'object',
      additionalProperties: false,
      required: ['created_at', 'delivered_at'],
      properties: {
        created_at: { type: 'string' },
        delivered_at: { type: 'string' }
      }
    }
  }
};

const ajv = new Ajv({
  allErrors: true,
  useDefaults: true,
  strict: false
});

const validateRequirementFn = ajv.compile(requirementSchema);
const validateDeliverableFn = ajv.compile(deliverableSchema);

function cloneObject(raw) {
  return JSON.parse(JSON.stringify(raw));
}

function readableAjvErrors(errors) {
  if (!errors || errors.length === 0) {
    return 'unknown validation error';
  }

  return errors
    .map((error) => {
      const where = error.instancePath || '/';
      return `${where} ${error.message}`.trim();
    })
    .join('; ');
}

export function parseRequirement(rawRequirement, defaults = {}) {
  let parsed;

  if (typeof rawRequirement === 'string') {
    try {
      parsed = JSON.parse(rawRequirement);
    } catch (error) {
      return {
        ok: false,
        error: `requirement must be valid JSON string: ${error.message}`
      };
    }
  } else if (rawRequirement && typeof rawRequirement === 'object') {
    parsed = cloneObject(rawRequirement);
  } else {
    parsed = {};
  }

  if (!parsed.mode) {
    parsed.mode = parsed.custom_program ? 'custom' : 'template';
  }

  if (!parsed.template && parsed.mode === 'template') {
    parsed.template = defaults.defaultTemplate;
  }

  if (!parsed.user_id) {
    parsed.user_id = defaults.defaultUserId || 'acp-user';
  }

  if (parsed.auto_start === undefined) {
    parsed.auto_start = defaults.autoStartDefault;
  }

  if (parsed.wait_ready === undefined) {
    parsed.wait_ready = defaults.waitReadyDefault;
  }

  if (parsed.ready_timeout_sec === undefined) {
    parsed.ready_timeout_sec = defaults.readyTimeoutSecDefault;
  }

  const valid = validateRequirementFn(parsed);
  if (!valid) {
    return {
      ok: false,
      error: readableAjvErrors(validateRequirementFn.errors)
    };
  }

  return {
    ok: true,
    requirement: parsed
  };
}

export function validateDeliverable(deliverable) {
  const valid = validateDeliverableFn(deliverable);
  if (!valid) {
    return {
      ok: false,
      error: readableAjvErrors(validateDeliverableFn.errors)
    };
  }

  return {
    ok: true
  };
}

export function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function getTemplateNames() {
  return [...templateNames];
}
