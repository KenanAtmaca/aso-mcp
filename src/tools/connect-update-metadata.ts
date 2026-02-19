import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadConfig,
  updateMetadata,
} from "../data-sources/app-store-connect.js";
import { deleteCache } from "../cache/sqlite-cache.js";
import { CHAR_LIMITS } from "../utils/constants.js";

export function registerConnectUpdateMetadata(server: McpServer) {
  server.tool(
    "connect_update_metadata",
    "Update ASO metadata fields in App Store Connect with character limit validation and diff output",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store Connect app ID"),
      locale: z
        .string()
        .default("tr")
        .describe("Locale code — accepts both Apple format ('en-US') and country code ('us')"),
      name: z
        .string()
        .optional()
        .describe("App name / title for this locale (max 30 chars)"),
      subtitle: z
        .string()
        .optional()
        .describe("New subtitle (max 30 chars)"),
      keywords: z
        .string()
        .optional()
        .describe("New keywords (max 100 chars, comma-separated, no spaces)"),
      description: z
        .string()
        .optional()
        .describe("New description (max 4000 chars)"),
      promotionalText: z
        .string()
        .optional()
        .describe("New promotional text (max 170 chars)"),
      whatsNew: z
        .string()
        .optional()
        .describe("New what's new text (max 4000 chars)"),
      supportUrl: z
        .string()
        .optional()
        .describe("Support URL for this locale"),
      marketingUrl: z
        .string()
        .optional()
        .describe("Marketing URL for this locale"),
    },
    async ({ appId, locale, name, subtitle, keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl }) => {
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

        // Validate character limits before making any API calls
        const warnings: string[] = [];
        const errors: string[] = [];

        if (name !== undefined && name.length > CHAR_LIMITS.TITLE) {
          errors.push(
            `Name exceeds ${CHAR_LIMITS.TITLE} char limit (${name.length} chars)`
          );
        }
        if (subtitle !== undefined && subtitle.length > CHAR_LIMITS.SUBTITLE) {
          errors.push(
            `Subtitle exceeds ${CHAR_LIMITS.SUBTITLE} char limit (${subtitle.length} chars)`
          );
        }
        if (keywords !== undefined) {
          if (keywords.length > CHAR_LIMITS.KEYWORD_FIELD) {
            errors.push(
              `Keywords exceed ${CHAR_LIMITS.KEYWORD_FIELD} char limit (${keywords.length} chars)`
            );
          }
          if (keywords.includes(", ")) {
            warnings.push(
              "Keywords contain spaces after commas. App Store keywords should be comma-separated without spaces."
            );
          }
        }
        if (
          description !== undefined &&
          description.length > CHAR_LIMITS.DESCRIPTION
        ) {
          errors.push(
            `Description exceeds ${CHAR_LIMITS.DESCRIPTION} char limit (${description.length} chars)`
          );
        }
        if (
          promotionalText !== undefined &&
          promotionalText.length > CHAR_LIMITS.PROMOTIONAL_TEXT
        ) {
          errors.push(
            `Promotional text exceeds ${CHAR_LIMITS.PROMOTIONAL_TEXT} char limit (${promotionalText.length} chars)`
          );
        }
        if (whatsNew !== undefined && whatsNew.length > CHAR_LIMITS.WHATS_NEW) {
          errors.push(
            `What's New exceeds ${CHAR_LIMITS.WHATS_NEW} char limit (${whatsNew.length} chars)`
          );
        }

        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "validation_failed",
                    errors,
                    warnings,
                    message: "Fix character limit violations before updating.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Check if any fields are provided
        const updates = { name, subtitle, keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl };
        const hasUpdates = Object.values(updates).some((v) => v !== undefined);
        if (!hasUpdates) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No metadata fields provided to update. Specify at least one of: name, subtitle, keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl.",
              },
            ],
            isError: true,
          };
        }

        const { before, after } = await updateMetadata(
          config,
          appId,
          locale,
          updates
        );

        // Invalidate cached metadata and localizations for this app
        deleteCache(`connect-metadata:${appId}:%`);
        deleteCache(`connect-localizations:${appId}`);

        // Build diff
        const diff: Record<string, { before: string | null; after: string | null }> = {};
        if (name !== undefined) {
          diff.name = { before: before.name ?? null, after: after.name ?? null };
        }
        if (subtitle !== undefined) {
          diff.subtitle = { before: before.subtitle, after: after.subtitle };
        }
        if (keywords !== undefined) {
          diff.keywords = { before: before.keywords, after: after.keywords };
        }
        if (description !== undefined) {
          diff.description = {
            before: before.description,
            after: after.description,
          };
        }
        if (promotionalText !== undefined) {
          diff.promotionalText = {
            before: before.promotionalText,
            after: after.promotionalText,
          };
        }
        if (whatsNew !== undefined) {
          diff.whatsNew = { before: before.whatsNew, after: after.whatsNew };
        }
        if (supportUrl !== undefined) {
          diff.supportUrl = { before: before.supportUrl, after: after.supportUrl };
        }
        if (marketingUrl !== undefined) {
          diff.marketingUrl = { before: before.marketingUrl, after: after.marketingUrl };
        }

        const result = {
          status: "success",
          locale: after.locale,
          diff,
          warnings: warnings.length > 0 ? warnings : undefined,
          characterLimits: {
            subtitle: { used: after.subtitleLength, max: CHAR_LIMITS.SUBTITLE },
            keywords: {
              used: after.keywordsLength,
              max: CHAR_LIMITS.KEYWORD_FIELD,
            },
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
