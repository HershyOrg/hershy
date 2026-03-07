import { AcpJobPhases } from '@virtuals-protocol/acp-node';

import { HershyHostClient } from './hostClient.mjs';
import {
  buildEncryptedAccessGrant,
  validateAndNormalizeAccessRequest
} from './accessGrant.mjs';
import {
  deliverableSchema,
  parseRequirement,
  requirementSchema,
  sha256Json,
  validateDeliverable
} from './schemas.mjs';
import { listTemplates, loadTemplate } from './templates.mjs';

const PHASE_NAME_BY_ID = Object.entries(AcpJobPhases)
  .filter(([, value]) => Number.isInteger(value))
  .reduce((acc, [name, value]) => {
    acc.set(value, name);
    return acc;
  }, new Map());

function phaseName(phaseId) {
  return PHASE_NAME_BY_ID.get(phaseId) || `UNKNOWN(${phaseId})`;
}

function nowIso() {
  return new Date().toISOString();
}

function trimTo(str, maxLength) {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength - 3)}...`;
}

function buildProgramSourceChecksum(source) {
  return sha256Json({
    dockerfile: source.dockerfile,
    src_files: source.src_files
  });
}

function buildLinks(hostUrl, programId) {
  const encoded = encodeURIComponent(programId);
  const base = `${hostUrl}/programs/${encoded}`;

  return {
    status_url: base,
    logs_url: `${base}/logs`,
    source_url: `${base}/source`,
    watcher_proxy_base: `${base}/proxy/watcher`,
    stop_url: `${base}/stop`,
    restart_url: `${base}/restart`
  };
}

function pickSampleAccessServer(wsServerRegistry) {
  const servers = Object.values(wsServerRegistry || {});
  if (servers.length === 0) {
    return {
      id: 'session-default',
      mode: 'session'
    };
  }

  const sessionServer = servers.find((server) => server.mode === 'session');
  return sessionServer || servers[0];
}

export class SellerRuntime {
  constructor(config, { accessGatewaySessionStore } = {}) {
    this.config = config;
    this.accessGatewaySessionStore = accessGatewaySessionStore || null;
    this.hostClient = new HershyHostClient({
      baseUrl: config.hostUrl,
      pollIntervalMs: config.hostPollIntervalMs,
      apiToken: config.hostApiToken
    });

    this.startedAt = Date.now();
    this.requestHandledJobIds = new Set();
    this.deliveredJobIds = new Set();
    this.transactionInFlight = new Map();
    this.lastTaskAt = null;
  }

  getHealth() {
    return {
      status: 'ok',
      started_at: new Date(this.startedAt).toISOString(),
      uptime_sec: Math.floor((Date.now() - this.startedAt) / 1000),
      host_url: this.config.hostUrl,
      default_template: this.config.defaultTemplate,
      templates: listTemplates().map((template) => template.name),
      stats: {
        request_handled_jobs: this.requestHandledJobIds.size,
        delivered_jobs: this.deliveredJobIds.size,
        transaction_in_flight: this.transactionInFlight.size,
        last_task_at: this.lastTaskAt
      },
      ws_server_registry: Object.values(this.config.wsServerRegistry || {}).map((server) => ({
        id: server.id,
        mode: server.mode,
        ws_url: server.ws_url,
        default_ttl_sec: server.default_ttl_sec,
        max_ttl_sec: server.max_ttl_sec
      }))
    };
  }

  getCatalog() {
    return {
      service: 'hershy-program-instance-v1',
      description: 'Provision and return a Hershy program instance through Host API',
      host_url: this.config.hostUrl,
      templates: listTemplates(),
      ws_server_registry: Object.values(this.config.wsServerRegistry || {}).map((server) => ({
        id: server.id,
        mode: server.mode,
        ws_url: server.ws_url,
        default_ttl_sec: server.default_ttl_sec,
        max_ttl_sec: server.max_ttl_sec
      })),
      requirement_schema: requirementSchema,
      deliverable_schema: deliverableSchema
    };
  }

  getSample() {
    const sampleServer = pickSampleAccessServer(this.config.wsServerRegistry);
    const sampleSessionTtl =
      sampleServer.mode === 'session'
        ? sampleServer.default_ttl_sec || this.config.accessSessionDefaultTtlSec
        : 0;
    const sampleAccessRequirement = {
      server_id: sampleServer.id,
      requester_x25519_pubkey: 'CATEStRT-G5BC05cAzZq2yYolc2Xih3MBSirLSk9YAE',
      requested_endpoints: ['/watcher/watching-state', '/watcher/varState/btc_price']
    };
    if (sampleServer.mode === 'session') {
      sampleAccessRequirement.session_ttl_sec = sampleSessionTtl;
    }

    return {
      requirement: {
        mode: 'template',
        template: this.config.defaultTemplate,
        user_id: 'acp-buyer-demo',
        auto_start: true,
        wait_ready: true,
        ready_timeout_sec: 300,
        access: sampleAccessRequirement,
        meta: {
          buyer_note: 'sample request'
        }
      },
      deliverable: {
        version: '1.0.0',
        status: 'ready',
        request: {
          mode: 'template',
          template: this.config.defaultTemplate,
          user_id: 'acp-buyer-demo',
          auto_start: true,
          wait_ready: true,
          ready_timeout_sec: 300,
          src_file_count: 3
        },
        program: {
          program_id: 'acp-buyer-demo-build-xxxx-1234abcd',
          build_id: 'build-xxxx',
          state: 'Ready',
          proxy_url: 'http://localhost:19001',
          image_id: 'sha256:...',
          container_id: 'abcdef...',
          error_msg: ''
        },
        links: {
          status_url: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd`,
          logs_url: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd/logs`,
          source_url: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd/source`,
          watcher_proxy_base: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd/proxy/watcher`,
          stop_url: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd/stop`,
          restart_url: `${this.config.hostUrl}/programs/acp-buyer-demo-build-xxxx-1234abcd/restart`
        },
        access: {
          server_id: sampleServer.id,
          server_mode: sampleServer.mode,
          requested_endpoints: ['/watcher/watching-state', '/watcher/varState/btc_price'],
          session_ttl_sec: sampleSessionTtl,
          issued_at: nowIso(),
          expires_at: sampleServer.mode === 'session' ? nowIso() : null,
          encrypted_payload: {
            alg: 'X25519-HKDF-SHA256-AES-256-GCM',
            key_format: 'x25519-raw-base64url',
            ephemeral_public_key: '...',
            salt: '...',
            iv: '...',
            aad: '...',
            ciphertext: '...',
            tag: '...'
          },
          checksums: {
            encrypted_payload_sha256: '...'
          }
        },
        checksums: {
          requirement_sha256: '...',
          source_sha256: '...'
        },
        timestamps: {
          created_at: nowIso(),
          delivered_at: nowIso()
        }
      }
    };
  }

  async onNewTask(job, memoToSign) {
    void memoToSign;
    const phase = job.phase;
    const currentPhaseName = phaseName(phase);

    this.lastTaskAt = nowIso();
    console.log(`[ACP] job=${job.id} phase=${currentPhaseName}`);

    if (phase === AcpJobPhases.REQUEST) {
      await this.handleRequestPhase(job);
      return;
    }

    if (phase === AcpJobPhases.TRANSACTION) {
      await this.handleTransactionPhase(job);
      return;
    }

    if (phase === AcpJobPhases.NEGOTIATION) {
      console.log(`[ACP] job=${job.id} negotiation state reached; waiting payment acceptance.`);
      return;
    }

    if (phase === AcpJobPhases.EVALUATION || phase === AcpJobPhases.COMPLETED) {
      console.log(`[ACP] job=${job.id} terminal flow state=${currentPhaseName}`);
      return;
    }

    console.log(`[ACP] job=${job.id} phase=${currentPhaseName} ignored`);
  }

  async handleRequestPhase(job) {
    if (this.requestHandledJobIds.has(job.id)) {
      return;
    }

    const parsed = parseRequirement(job.requirement, {
      defaultTemplate: this.config.defaultTemplate,
      defaultUserId: `acp-job-${job.id}`,
      autoStartDefault: this.config.autoStartDefault,
      waitReadyDefault: this.config.waitReadyDefault,
      readyTimeoutSecDefault: this.config.readyTimeoutSecDefault
    });

    if (!parsed.ok) {
      const reason = trimTo(`invalid requirement: ${parsed.error}`, 240);
      await job.reject(reason);
      this.requestHandledJobIds.add(job.id);
      console.log(`[ACP] job=${job.id} rejected: ${reason}`);
      return;
    }

    const requirement = parsed.requirement;
    const accessValidation = validateAndNormalizeAccessRequest(requirement.access, {
      wsServerRegistry: this.config.wsServerRegistry
    });
    if (!accessValidation.ok) {
      const reason = trimTo(`invalid access requirement: ${accessValidation.error}`, 240);
      await job.reject(reason);
      this.requestHandledJobIds.add(job.id);
      console.log(`[ACP] job=${job.id} rejected: ${reason}`);
      return;
    }

    await job.accept(
      `accepted: template=${
        requirement.mode === 'template' ? requirement.template : 'custom'
      }, auto_start=${requirement.auto_start}`
    );

    this.requestHandledJobIds.add(job.id);
    console.log(`[ACP] job=${job.id} accepted`);
  }

  async handleTransactionPhase(job) {
    if (this.deliveredJobIds.has(job.id)) {
      return;
    }

    if (this.transactionInFlight.has(job.id)) {
      await this.transactionInFlight.get(job.id);
      return;
    }

    const task = this.executeProvisionFlow(job)
      .then(() => {
        this.deliveredJobIds.add(job.id);
      })
      .finally(() => {
        this.transactionInFlight.delete(job.id);
      });

    this.transactionInFlight.set(job.id, task);
    await task;
  }

  async executeProvisionFlow(job) {
    const parsed = parseRequirement(job.requirement, {
      defaultTemplate: this.config.defaultTemplate,
      defaultUserId: `acp-job-${job.id}`,
      autoStartDefault: this.config.autoStartDefault,
      waitReadyDefault: this.config.waitReadyDefault,
      readyTimeoutSecDefault: this.config.readyTimeoutSecDefault
    });

    if (!parsed.ok) {
      throw new Error(`cannot execute transaction with invalid requirement: ${parsed.error}`);
    }

    const requirement = parsed.requirement;
    const requirementHash = sha256Json(requirement);

    const source = await this.resolveProgramSource(requirement);
    const sourceHash = buildProgramSourceChecksum(source);

    const createPayload = {
      user_id: requirement.user_id,
      dockerfile: source.dockerfile,
      src_files: source.src_files
    };

    console.log(
      `[ACP] job=${job.id} provisioning mode=${requirement.mode} template=${source.template_name} requirement_sha=${requirementHash.slice(0, 12)}`
    );

    let created;
    try {
      created = await this.hostClient.createProgram(createPayload);
    } catch (error) {
      await this.notifyFailure(job, `program creation failed: ${error.message}`);
      throw error;
    }

    let finalState;
    try {
      if (requirement.auto_start) {
        await this.hostClient.startProgram(created.program_id);
      }

      if (requirement.auto_start && requirement.wait_ready) {
        finalState = await this.hostClient.waitUntilReady(
          created.program_id,
          requirement.ready_timeout_sec * 1000
        );
      } else {
        finalState = await this.hostClient.getProgram(created.program_id);
      }
    } catch (error) {
      await this.notifyFailure(job, `program startup failed: ${error.message}`);
      throw error;
    }

    let encryptedAccessGrant;
    try {
      encryptedAccessGrant = buildEncryptedAccessGrant({
        jobId: job.id,
        programId: created.program_id,
        accessRequest: requirement.access,
        wsServerRegistry: this.config.wsServerRegistry,
        tokenIssuer: this.config.accessTokenIssuer,
        tokenSigningKey: this.config.accessTokenSigningKey,
        gatewayWsUrl: this.config.accessGatewayWsPublicUrl,
        gatewayHttpUrl: this.config.accessGatewayHttpPublicUrl,
        gatewaySessionRegistrar: this.buildGatewaySessionRegistrar()
      });
    } catch (error) {
      await this.notifyFailure(job, `access grant creation failed: ${error.message}`);
      throw error;
    }

    const deliverable = {
      version: '1.0.0',
      status: String(finalState.state).toLowerCase() === 'ready' ? 'ready' : 'created',
      request: {
        mode: requirement.mode,
        template: source.template_name,
        user_id: requirement.user_id,
        auto_start: requirement.auto_start,
        wait_ready: requirement.wait_ready,
        ready_timeout_sec: requirement.ready_timeout_sec,
        src_file_count: Object.keys(source.src_files).length
      },
      program: {
        program_id: created.program_id,
        build_id: created.build_id,
        state: finalState.state,
        proxy_url: finalState.proxy_url || created.proxy_url,
        image_id: finalState.image_id || '',
        container_id: finalState.container_id || '',
        error_msg: finalState.error_msg || ''
      },
      links: buildLinks(this.config.hostUrl, created.program_id),
      access: encryptedAccessGrant,
      checksums: {
        requirement_sha256: requirementHash,
        source_sha256: sourceHash
      },
      timestamps: {
        created_at: created.created_at,
        delivered_at: nowIso()
      }
    };

    const deliverableValidation = validateDeliverable(deliverable);
    if (!deliverableValidation.ok) {
      throw new Error(`deliverable schema validation failed: ${deliverableValidation.error}`);
    }

    await job.deliver(deliverable);

    console.log(
      `[ACP] job=${job.id} delivered program=${created.program_id} state=${finalState.state}`
    );
  }

  buildGatewaySessionRegistrar() {
    if (
      !this.config.accessGatewayEnabled ||
      !this.accessGatewaySessionStore ||
      !this.config.accessGatewayWsPublicUrl
    ) {
      return undefined;
    }

    return ({
      grantId,
      programId,
      serverId,
      requestedEndpoints,
      requesterX25519Pubkey,
      issuedAtSec,
      expiresAtSec
    }) =>
      this.accessGatewaySessionStore.registerSession({
        sessionId: grantId,
        programId,
        serverId,
        requestedEndpoints,
        requesterX25519Pubkey,
        issuedAtSec,
        expiresAtSec,
        gatewayWsUrl: this.config.accessGatewayWsPublicUrl,
        gatewayHttpUrl: this.config.accessGatewayHttpPublicUrl
      });
  }

  async resolveProgramSource(requirement) {
    if (requirement.mode === 'custom') {
      if (!this.config.allowCustomSource) {
        throw new Error('custom program source is disabled (ACP_ALLOW_CUSTOM_SOURCE=false)');
      }

      return {
        template_name: 'custom',
        dockerfile: requirement.custom_program.dockerfile,
        src_files: requirement.custom_program.src_files
      };
    }

    return loadTemplate(requirement.template, {
      baseDir: this.config.templateBaseDir
    });
  }

  async notifyFailure(job, message) {
    const trimmed = trimTo(message, 240);
    try {
      await job.createNotification(`[hershy-acp-seller] ${trimmed}`);
    } catch (notifyError) {
      console.error(
        `[ACP] job=${job.id} failed to send notification: ${notifyError.message}`
      );
    }
  }
}
