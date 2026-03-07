import dotenv from 'dotenv';

import AcpClient, {
  AcpContractClientV2,
  baseAcpConfigV2,
  baseSepoliaAcpConfigV2
} from '@virtuals-protocol/acp-node';

import { loadConfig } from './config.mjs';
import { createAccessGatewaySessionStore } from './accessGatewaySessionStore.mjs';
import { startResourceServer } from './resourceServer.mjs';
import { SellerRuntime } from './seller.mjs';

dotenv.config();

function resolveAcpConfig(networkName) {
  const normalized = String(networkName || '').trim().toLowerCase();
  if (normalized === 'base') {
    return baseAcpConfigV2;
  }
  if (normalized === 'base-sepolia' || normalized === '') {
    return baseSepoliaAcpConfigV2;
  }

  throw new Error(`unsupported ACP_NETWORK '${networkName}' (supported: base-sepolia, base)`);
}

async function main() {
  const config = loadConfig(process.env);
  const acpConfig = resolveAcpConfig(config.acpNetwork);
  const accessGatewaySessionStore = createAccessGatewaySessionStore();

  const contractClient = await AcpContractClientV2.build(
    config.walletPrivateKey,
    config.sessionEntityKeyId,
    config.sellerAgentWalletAddress,
    acpConfig
  );

  const sellerRuntime = new SellerRuntime(config, {
    accessGatewaySessionStore
  });

  const acpClient = new AcpClient({
    acpContractClient: contractClient,
    onNewTask: (job, memoToSign) => {
      sellerRuntime
        .onNewTask(job, memoToSign)
        .catch((error) => {
          console.error(
            `[ACP] task handler failure job=${job?.id} phase=${job?.phase}: ${error.message}`
          );
        });
    }
    // onEvaluate intentionally omitted for auto-approval flow
  });

  await acpClient.init(config.skipSocketConnection);

  let resourceServer;
  if (config.resourceServerPort > 0) {
    resourceServer = startResourceServer({
      port: config.resourceServerPort,
      getHealth: () => sellerRuntime.getHealth(),
      getCatalog: () => sellerRuntime.getCatalog(),
      getSample: () => sellerRuntime.getSample(),
      accessGateway: {
        enabled: config.accessGatewayEnabled,
        tokenSigningKey: config.accessTokenSigningKey,
        wsServerRegistry: config.wsServerRegistry,
        hostBaseUrl: config.hostUrl,
        hostApiToken: config.hostApiToken,
        sessionStore: accessGatewaySessionStore
      }
    });

    console.log(
      `[ACP] resource server listening on 0.0.0.0:${config.resourceServerPort}`
    );
    if (config.accessGatewayEnabled) {
      console.log(
        `[ACP] access gateway enabled ws=${config.accessGatewayWsPublicUrl} http=${config.accessGatewayHttpPublicUrl || '(not set)'}`
      );
    }
  }

  console.log('[ACP] seller runtime started');
  console.log(`[ACP] network=${config.acpNetwork} host=${config.hostUrl}`);
  console.log(
    `[ACP] wallet=${config.sellerAgentWalletAddress} entityKeyId=${config.sessionEntityKeyId}`
  );
  console.log(
    `[ACP] ws_servers=${Object.values(config.wsServerRegistry)
      .map((server) => `${server.id}:${server.mode}`)
      .join(', ')}`
  );

  const shutdown = async () => {
    console.log('[ACP] shutdown requested');
    if (resourceServer) {
      await new Promise((resolve) => resourceServer.close(resolve));
    }
    accessGatewaySessionStore.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`[ACP] fatal: ${error.stack || error.message}`);
  process.exit(1);
});
