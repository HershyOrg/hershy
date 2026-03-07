import { readFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';

import dotenv from 'dotenv';
import AcpClient, {
  AcpContractClientV2,
  AcpJobPhases,
  FareAmount,
  baseAcpConfigV2,
  baseSepoliaAcpConfigV2
} from '@virtuals-protocol/acp-node';
import { decryptAccessGrantPayload } from '../src/accessGrant.mjs';

dotenv.config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`missing required env: ${name}`);
  }
  return String(value).trim();
}

function parseNetwork(networkName) {
  const normalized = String(networkName || 'base-sepolia').trim().toLowerCase();
  if (normalized === 'base') {
    return baseAcpConfigV2;
  }
  if (normalized === 'base-sepolia') {
    return baseSepoliaAcpConfigV2;
  }
  throw new Error(`unsupported ACP_NETWORK: ${networkName}`);
}

function phaseName(phase) {
  for (const [name, value] of Object.entries(AcpJobPhases)) {
    if (Number.isInteger(value) && value === phase) {
      return name;
    }
  }
  return `UNKNOWN(${phase})`;
}

async function loadRequirement(pathArg, buyerEncryptionPubkey) {
  if (!pathArg) {
    return {
      mode: 'template',
      template: process.env.ACP_DEFAULT_TEMPLATE || 'simple-counter',
      user_id: `buyer-${Date.now()}`,
      auto_start: true,
      wait_ready: true,
      ready_timeout_sec: 300,
      access: {
        server_id: process.env.ACP_ACCESS_SERVER_ID || 'session-default',
        requester_x25519_pubkey: buyerEncryptionPubkey,
        requested_endpoints: [
          '/watcher/watching-state',
          '/watcher/varState/btc_price'
        ],
        session_ttl_sec: Number.parseInt(process.env.ACP_ACCESS_SESSION_TTL_SEC || '600', 10)
      }
    };
  }

  const content = await readFile(pathArg, 'utf8');
  const parsed = JSON.parse(content);
  if (!parsed.access) {
    parsed.access = {
      server_id: process.env.ACP_ACCESS_SERVER_ID || 'session-default',
      requester_x25519_pubkey: buyerEncryptionPubkey,
      requested_endpoints: ['/watcher/watching-state'],
      session_ttl_sec: Number.parseInt(process.env.ACP_ACCESS_SESSION_TTL_SEC || '600', 10)
    };
  }
  return parsed;
}

async function main() {
  const buyerPrivateKey = requiredEnv('BUYER_WHITELISTED_WALLET_PRIVATE_KEY');
  const buyerSessionEntityKeyId = Number.parseInt(
    requiredEnv('BUYER_SESSION_ENTITY_KEY_ID'),
    10
  );
  const buyerAgentWalletAddress = requiredEnv('BUYER_AGENT_WALLET_ADDRESS');
  const sellerAgentWalletAddress = requiredEnv('SELLER_AGENT_WALLET_ADDRESS');
  const jobPriceUsd = Number.parseFloat(process.env.JOB_PRICE_USD || '0.01');

  const acpConfig = parseNetwork(process.env.ACP_NETWORK);

  const contractClient = await AcpContractClientV2.build(
    buyerPrivateKey,
    buyerSessionEntityKeyId,
    buyerAgentWalletAddress,
    acpConfig
  );

  const acpClient = new AcpClient({
    acpContractClient: contractClient
  });
  await acpClient.init();

  const buyerEncryptionKeyPair = generateKeyPairSync('x25519');
  const buyerEncryptionPubkey = buyerEncryptionKeyPair.publicKey.export({ format: 'jwk' }).x;
  const requirement = await loadRequirement(process.argv[2], buyerEncryptionPubkey);
  const fareAmount = new FareAmount(jobPriceUsd, acpClient.acpContractClient.config.baseFare);

  const jobId = await acpClient.initiateJob(
    sellerAgentWalletAddress,
    requirement,
    fareAmount
  );

  console.log(`[BUYER] initiated job id=${jobId}`);

  let paymentTriggered = false;
  const maxWaitMs = 10 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const job = await acpClient.getJobById(jobId);
    if (!job) {
      throw new Error(`job ${jobId} not found`);
    }

    console.log(`[BUYER] phase=${phaseName(job.phase)} memos=${job.memos.length}`);

    if (job.phase === AcpJobPhases.NEGOTIATION && !paymentTriggered) {
      await job.payAndAcceptRequirement('payment sent by buyer_test script');
      paymentTriggered = true;
      console.log('[BUYER] payment sent');
    }

    const deliverable = await job.getDeliverable();
    if (deliverable) {
      console.log('[BUYER] deliverable received:');
      console.log(JSON.stringify(deliverable, null, 2));

      if (deliverable?.access?.encrypted_payload) {
        const decryptedAccess = decryptAccessGrantPayload({
          encryptedPayload: deliverable.access.encrypted_payload,
          recipientPrivateKey: buyerEncryptionKeyPair.privateKey
        });
        console.log('[BUYER] decrypted access grant:');
        console.log(JSON.stringify(decryptedAccess, null, 2));
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error('timeout waiting for deliverable');
}

main().catch((error) => {
  console.error(`[BUYER] fatal: ${error.stack || error.message}`);
  process.exit(1);
});
