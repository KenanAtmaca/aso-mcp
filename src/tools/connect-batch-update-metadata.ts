import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadConfig,
  updateMetadata,
} from "../data-sources/app-store-connect.js";
import { deleteCache } from "../cache/sqlite-cache.js";
import { CHAR_LIMITS } from "../utils/constants.js";

export function registerConnectBatchUpdateMetadata(server: McpServer) {
  server.tool(
    "connect_batch_update_metadata",
    "Batch update ASO metadata for multiple locales in one call. Ideal for localization workflows.",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store Connect app ID"),
      updates: z
        .array(
          z.object({
            locale: z.string().describe("Locale code (e.g. 'en-US', 'tr', 'de')"),
            name: z.string().optional().describe("App name / title (max 30 chars)"),
            subtitle: z.string().optional().describe("Subtitle (max 30 chars)"),
            keywords: z.string().optional().describe("Keywords (max 100 chars)"),
            description: z.string().optional().describe("Description (max 4000 chars)"),
            promotionalText: z.string().optional().describe("Promotional text (max 170 chars)"),
            whatsNew: z.string().optional().describe("What's new (max 4000 chars)"),
            supportUrl: z.string().optional().describe("Support URL"),
            marketingUrl: z.string().optional().describe("Marketing URL"),
          })
        )
        .min(1)
        .max(40)
        .describe("Array of locale updates"),
    },
    async ({ appId, updates }) => {
      try {
        const config = loadConfig();
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: App Store Connect credentials not configured. Use connect_setup tool first.",
              },
            ],
            isError: true,
          };
        }

        // Validate all updates before making any API calls
        const validationErrors: string[] = [];
        for (const update of updates) {
          const prefix = `[${update.locale}]`;
          if (update.name !== undefined && update.name.length > CHAR_LIMITS.TITLE) {
            validationErrors.push(`${prefix} Name exceeds ${CHAR_LIMITS.TITLE} chars (${update.name.length})`);
          }
          if (update.subtitle !== undefined && update.subtitle.length > CHAR_LIMITS.SUBTITLE) {
            validationErrors.push(`${prefix} Subtitle exceeds ${CHAR_LIMITS.SUBTITLE} chars (${update.subtitle.length})`);
          }
          if (update.keywords !== undefined && update.keywords.length > CHAR_LIMITS.KEYWORD_FIELD) {
            validationErrors.push(`${prefix} Keywords exceed ${CHAR_LIMITS.KEYWORD_FIELD} chars (${update.keywords.length})`);
          }
          if (update.description !== undefined && update.description.length > CHAR_LIMITS.DESCRIPTION) {
            validationErrors.push(`${prefix} Description exceeds ${CHAR_LIMITS.DESCRIPTION} chars (${update.description.length})`);
          }
          if (update.promotionalText !== undefined && update.promotionalText.length > CHAR_LIMITS.PROMOTIONAL_TEXT) {
            validationErrors.push(`${prefix} Promotional text exceeds ${CHAR_LIMITS.PROMOTIONAL_TEXT} chars (${update.promotionalText.length})`);
          }
          if (update.whatsNew !== undefined && update.whatsNew.length > CHAR_LIMITS.WHATS_NEW) {
            validationErrors.push(`${prefix} What's New exceeds ${CHAR_LIMITS.WHATS_NEW} chars (${update.whatsNew.length})`);
          }
        }

        if (validationErrors.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { status: "validation_failed", errors: validationErrors },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Process each locale sequentially (API may not handle concurrent writes well)
        const results: {
          locale: string;
          status: "success" | "error";
          error?: string;
          fieldsUpdated?: string[];
        }[] = [];

        for (const update of updates) {
          const { locale, ...fields } = update;
          const hasFields = Object.values(fields).some((v) => v !== undefined);
          if (!hasFields) {
            results.push({ locale, status: "error", error: "No fields provided" });
            continue;
          }

          try {
            await updateMetadata(config, appId, locale, fields);
            const updatedFields = Object.keys(fields).filter(
              (k) => (fields as any)[k] !== undefined
            );
            results.push({ locale, status: "success", fieldsUpdated: updatedFields });
          } catch (error: any) {
            results.push({ locale, status: "error", error: error.message });
          }
        }

        // Invalidate cache
        deleteCache(`connect-metadata:${appId}:%`);
        deleteCache(`connect-localizations:${appId}`);

        const succeeded = results.filter((r) => r.status === "success").length;
        const failed = results.filter((r) => r.status === "error").length;

        const result = {
          status: failed === 0 ? "success" : succeeded > 0 ? "partial" : "failed",
          totalLocales: updates.length,
          succeeded,
          failed,
          results,
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
