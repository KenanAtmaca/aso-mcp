import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadConfig,
  saveConfig,
  validateCredentials,
} from "../data-sources/app-store-connect.js";

export function registerConnectSetup(server: McpServer) {
  server.tool(
    "connect_setup",
    "Configure and validate App Store Connect credentials",
    {
      issuerId: z
        .string()
        .min(1)
        .describe("App Store Connect Issuer ID"),
      apiKeyId: z
        .string()
        .min(1)
        .describe("App Store Connect API Key ID"),
      privateKeyPath: z
        .string()
        .min(1)
        .describe("Path to .p8 private key file"),
    },
    async ({ issuerId, apiKeyId, privateKeyPath }) => {
      try {
        const config = { issuerId, apiKeyId, privateKeyPath };

        // Validate credentials with a test API call
        await validateCredentials(config);

        // Save config for future use
        saveConfig(config);

        const result = {
          status: "success",
          message: "App Store Connect credentials validated and saved.",
          config: {
            issuerId,
            apiKeyId,
            privateKeyPath,
            configPath: "~/.aso-mcp/connect-config.json",
          },
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}
