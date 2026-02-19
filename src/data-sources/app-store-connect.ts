import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import os from "os";
import { withRateLimit } from "../utils/rate-limiter.js";
import { RATE_LIMITS } from "../utils/constants.js";
import { countryToLocale } from "../utils/localization.js";
import type {
  ConnectConfig,
  ConnectAppInfo,
  ConnectLocalization,
  ConnectLocalizationSummary,
  ConnectMetadataUpdate,
} from "../types/index.js";

const RL = RATE_LIMITS["app-store-connect"];
const BASE_URL = "https://api.appstoreconnect.apple.com";
const CONFIG_DIR = path.join(os.homedir(), ".aso-mcp");
const CONFIG_PATH = path.join(CONFIG_DIR, "connect-config.json");

// ─── Config Management ───

export function loadConfig(): ConnectConfig | null {
  // Try env vars first
  const issuerId = process.env.ASC_ISSUER_ID;
  const apiKeyId = process.env.ASC_KEY_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;

  if (issuerId && apiKeyId && privateKeyPath) {
    return { issuerId, apiKeyId, privateKeyPath };
  }

  // Try config file
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(raw) as ConnectConfig;
    }
  } catch {
    // ignore
  }

  return null;
}

export function saveConfig(config: ConnectConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ─── JWT Token Generation (with caching) ───

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;
let cachedTokenConfigKey = "";

function generateToken(config: ConnectConfig): string {
  const configKey = `${config.issuerId}:${config.apiKeyId}`;
  const now = Math.floor(Date.now() / 1000);

  // Reuse cached token if valid (with 2 min safety margin)
  if (
    cachedToken &&
    cachedTokenConfigKey === configKey &&
    now < cachedTokenExpiry - 120
  ) {
    return cachedToken;
  }

  const privateKey = fs.readFileSync(config.privateKeyPath, "utf-8");

  const payload = {
    iss: config.issuerId,
    iat: now,
    exp: now + 20 * 60,
    aud: "appstoreconnect-v1",
  };

  cachedToken = jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: {
      alg: "ES256",
      kid: config.apiKeyId,
      typ: "JWT",
    },
  });
  cachedTokenExpiry = payload.exp;
  cachedTokenConfigKey = configKey;

  return cachedToken;
}

// ─── HTTP Wrapper ───

async function apiRequest(
  config: ConnectConfig,
  endpoint: string,
  method: string = "GET",
  body?: object
): Promise<any> {
  return withRateLimit("app-store-connect", RL, async () => {
    const token = generateToken(config);
    const url = `${BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `App Store Connect API error: ${res.status} ${res.statusText}`;
      try {
        const parsed = JSON.parse(errorBody);
        if (parsed.errors?.[0]?.detail) {
          errorMsg += ` — ${parsed.errors[0].detail}`;
        }
      } catch {
        // ignore parse error
      }
      throw new Error(errorMsg);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  });
}

// ─── Public API Functions ───

export async function validateCredentials(
  config: ConnectConfig
): Promise<boolean> {
  // Check .p8 file exists
  if (!fs.existsSync(config.privateKeyPath)) {
    throw new Error(
      `Private key file not found: ${config.privateKeyPath}`
    );
  }

  // Test API call — list apps (limit 1)
  await apiRequest(config, "/v1/apps?limit=1");
  return true;
}

export async function getApp(
  config: ConnectConfig,
  bundleId: string
): Promise<ConnectAppInfo> {
  // Find app by bundle ID
  const appsResponse = await apiRequest(
    config,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId,primaryLocale&limit=1`
  );

  const app = appsResponse.data?.[0];
  if (!app) {
    throw new Error(`App not found for bundle ID: ${bundleId}`);
  }

  // Get latest editable version (PREPARE_FOR_SUBMISSION)
  let versionId: string | null = null;
  let versionState: string | null = null;

  try {
    const versionsResponse = await apiRequest(
      config,
      `/v1/apps/${app.id}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`
    );

    const version = versionsResponse.data?.[0];
    if (version) {
      versionId = version.id;
      versionState = version.attributes?.appStoreState ?? null;
    }
  } catch {
    // No editable version — not a fatal error
  }

  return {
    id: app.id,
    bundleId: app.attributes.bundleId,
    name: app.attributes.name,
    primaryLocale: app.attributes.primaryLocale ?? "en-US",
    versionId,
    versionState,
  };
}

export async function getMetadata(
  config: ConnectConfig,
  appId: string,
  locale: string = "tr"
): Promise<ConnectLocalization> {
  const resolvedLocale = countryToLocale(locale);

  // Fetch app info localizations (name + subtitle)
  let name: string | null = null;
  let subtitle: string | null = null;
  let appInfoLocalizationId: string | null = null;

  try {
    const appInfosResponse = await apiRequest(
      config,
      `/v1/apps/${appId}/appInfos`
    );
    const allInfos = appInfosResponse.data ?? [];
    const editableInfo = allInfos.find(
      (info: any) => info.attributes?.appStoreState !== "READY_FOR_SALE"
    );
    const appInfoId = editableInfo?.id ?? allInfos[0]?.id;

    if (appInfoId) {
      const locResponse = await apiRequest(
        config,
        `/v1/appInfos/${appInfoId}/appInfoLocalizations?filter[locale]=${resolvedLocale}`
      );
      const loc = locResponse.data?.[0];
      if (loc) {
        appInfoLocalizationId = loc.id;
        name = loc.attributes?.name ?? null;
        subtitle = loc.attributes?.subtitle ?? null;
      }
    }
  } catch {
    // App info not available
  }

  // Fetch version localizations (keywords, description, etc.)
  let keywords: string | null = null;
  let description: string | null = null;
  let promotionalText: string | null = null;
  let whatsNew: string | null = null;
  let supportUrl: string | null = null;
  let marketingUrl: string | null = null;
  let versionLocalizationId: string | null = null;

  try {
    // Get the editable version
    const versionsResponse = await apiRequest(
      config,
      `/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`
    );
    const versionId = versionsResponse.data?.[0]?.id;

    if (versionId) {
      const verLocResponse = await apiRequest(
        config,
        `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?filter[locale]=${resolvedLocale}`
      );
      const verLoc = verLocResponse.data?.[0];
      if (verLoc) {
        versionLocalizationId = verLoc.id;
        keywords = verLoc.attributes?.keywords ?? null;
        description = verLoc.attributes?.description ?? null;
        promotionalText = verLoc.attributes?.promotionalText ?? null;
        whatsNew = verLoc.attributes?.whatsNew ?? null;
        supportUrl = verLoc.attributes?.supportUrl ?? null;
        marketingUrl = verLoc.attributes?.marketingUrl ?? null;
      }
    }
  } catch {
    // Version localizations not available
  }

  return {
    locale: resolvedLocale,
    name,
    nameLength: name?.length ?? 0,
    subtitle,
    subtitleLength: subtitle?.length ?? 0,
    keywords,
    keywordsLength: keywords?.length ?? 0,
    description,
    descriptionLength: description?.length ?? 0,
    promotionalText,
    promotionalTextLength: promotionalText?.length ?? 0,
    whatsNew,
    whatsNewLength: whatsNew?.length ?? 0,
    supportUrl,
    marketingUrl,
    appInfoLocalizationId,
    versionLocalizationId,
  };
}

// ─── Helper: Get App Info ID ───

async function getAppInfoId(
  config: ConnectConfig,
  appId: string
): Promise<string | null> {
  try {
    const response = await apiRequest(
      config,
      `/v1/apps/${appId}/appInfos`
    );
    const appInfos = response.data ?? [];
    // Prefer editable appInfo (not READY_FOR_SALE) for creating new localizations
    const editable = appInfos.find(
      (info: any) => info.attributes?.appStoreState !== "READY_FOR_SALE"
    );
    return editable?.id ?? appInfos[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Helper: Get Editable Version ID ───

async function getEditableVersionId(
  config: ConnectConfig,
  appId: string
): Promise<string | null> {
  try {
    const response = await apiRequest(
      config,
      `/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`
    );
    return response.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Create Localization (POST) ───

async function createAppInfoLocalization(
  config: ConnectConfig,
  appInfoId: string,
  locale: string,
  attributes: { name?: string; subtitle?: string }
): Promise<string> {
  const response = await apiRequest(
    config,
    "/v1/appInfoLocalizations",
    "POST",
    {
      data: {
        type: "appInfoLocalizations",
        attributes: {
          locale,
          ...attributes,
        },
        relationships: {
          appInfo: {
            data: { type: "appInfos", id: appInfoId },
          },
        },
      },
    }
  );
  return response.data.id;
}

async function createVersionLocalization(
  config: ConnectConfig,
  versionId: string,
  locale: string,
  attributes: Record<string, string>
): Promise<string> {
  const response = await apiRequest(
    config,
    "/v1/appStoreVersionLocalizations",
    "POST",
    {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: {
          locale,
          ...attributes,
        },
        relationships: {
          appStoreVersion: {
            data: { type: "appStoreVersions", id: versionId },
          },
        },
      },
    }
  );
  return response.data.id;
}

// ─── Decode HTML Entities ───

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function sanitizeUpdates(updates: ConnectMetadataUpdate): ConnectMetadataUpdate {
  const sanitized: ConnectMetadataUpdate = {};
  for (const [key, value] of Object.entries(updates)) {
    sanitized[key as keyof ConnectMetadataUpdate] =
      value !== undefined ? decodeHtmlEntities(value) : undefined;
  }
  return sanitized;
}

// ─── Update Metadata ───

export async function updateMetadata(
  config: ConnectConfig,
  appId: string,
  locale: string = "tr",
  updates: ConnectMetadataUpdate
): Promise<{ before: ConnectLocalization; after: ConnectLocalization }> {
  const resolvedLocale = countryToLocale(locale);

  // Sanitize: decode any HTML entities before sending to ASC API
  updates = sanitizeUpdates(updates);

  // Get current metadata
  const before = await getMetadata(config, appId, locale);

  // ─── Update/Create App Info Localization (name + subtitle) ───
  const appInfoAttrs: { name?: string; subtitle?: string } = {};
  if (updates.name !== undefined) appInfoAttrs.name = updates.name;
  if (updates.subtitle !== undefined) appInfoAttrs.subtitle = updates.subtitle;

  if (Object.keys(appInfoAttrs).length > 0) {
    if (before.appInfoLocalizationId) {
      // PATCH existing
      await apiRequest(
        config,
        `/v1/appInfoLocalizations/${before.appInfoLocalizationId}`,
        "PATCH",
        {
          data: {
            type: "appInfoLocalizations",
            id: before.appInfoLocalizationId,
            attributes: appInfoAttrs,
          },
        }
      );
    } else {
      // CREATE new app info localization — 'name' is required by the API
      const appInfoId = await getAppInfoId(config, appId);
      if (!appInfoId) {
        throw new Error(
          `Could not find appInfo for app "${appId}". Cannot create localization.`
        );
      }
      if (!appInfoAttrs.name) {
        throw new Error(
          `Cannot create new localization for "${resolvedLocale}" without a name. ` +
            `Provide the 'name' parameter when adding a new locale.`
        );
      }
      await createAppInfoLocalization(config, appInfoId, resolvedLocale, appInfoAttrs);
    }
  }

  // ─── Update/Create Version Localization (keywords, description, etc.) ───
  const versionFields: Record<string, string> = {};
  if (updates.keywords !== undefined) versionFields.keywords = updates.keywords;
  if (updates.description !== undefined)
    versionFields.description = updates.description;
  if (updates.promotionalText !== undefined)
    versionFields.promotionalText = updates.promotionalText;
  if (updates.whatsNew !== undefined) versionFields.whatsNew = updates.whatsNew;
  if (updates.supportUrl !== undefined) versionFields.supportUrl = updates.supportUrl;
  if (updates.marketingUrl !== undefined) versionFields.marketingUrl = updates.marketingUrl;

  if (Object.keys(versionFields).length > 0) {
    if (before.versionLocalizationId) {
      // PATCH existing
      await apiRequest(
        config,
        `/v1/appStoreVersionLocalizations/${before.versionLocalizationId}`,
        "PATCH",
        {
          data: {
            type: "appStoreVersionLocalizations",
            id: before.versionLocalizationId,
            attributes: versionFields,
          },
        }
      );
    } else {
      // CREATE new version localization
      const versionId = await getEditableVersionId(config, appId);
      if (!versionId) {
        throw new Error(
          `No PREPARE_FOR_SUBMISSION version found for app "${appId}". ` +
            `Create a new version in App Store Connect first.`
        );
      }
      await createVersionLocalization(
        config,
        versionId,
        resolvedLocale,
        versionFields
      );
    }
  }

  // Get updated metadata
  const after = await getMetadata(config, appId, locale);
  return { before, after };
}

export async function listLocalizations(
  config: ConnectConfig,
  appId: string
): Promise<ConnectLocalizationSummary[]> {
  const summaries: ConnectLocalizationSummary[] = [];
  const localeMap = new Map<string, Partial<ConnectLocalizationSummary>>();

  // Get app info localizations
  try {
    const appInfosResponse = await apiRequest(
      config,
      `/v1/apps/${appId}/appInfos`
    );
    const allInfos = appInfosResponse.data ?? [];
    const editableInfo = allInfos.find(
      (info: any) => info.attributes?.appStoreState !== "READY_FOR_SALE"
    );
    const appInfoId = editableInfo?.id ?? allInfos[0]?.id;

    if (appInfoId) {
      const locResponse = await apiRequest(
        config,
        `/v1/appInfos/${appInfoId}/appInfoLocalizations`
      );
      for (const loc of locResponse.data ?? []) {
        const locale = loc.attributes?.locale;
        if (!locale) continue;
        localeMap.set(locale, {
          locale,
          hasSubtitle: !!loc.attributes?.subtitle,
          appInfoLocalizationId: loc.id,
        });
      }
    }
  } catch {
    // ignore
  }

  // Get version localizations
  try {
    const versionsResponse = await apiRequest(
      config,
      `/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`
    );
    const versionId = versionsResponse.data?.[0]?.id;

    if (versionId) {
      const verLocResponse = await apiRequest(
        config,
        `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
      );
      for (const loc of verLocResponse.data ?? []) {
        const locale = loc.attributes?.locale;
        if (!locale) continue;
        const existing: Partial<ConnectLocalizationSummary> = localeMap.get(locale) ?? { locale };
        existing.hasKeywords = !!loc.attributes?.keywords;
        existing.hasDescription = !!loc.attributes?.description;
        existing.hasPromotionalText = !!loc.attributes?.promotionalText;
        existing.hasWhatsNew = !!loc.attributes?.whatsNew;
        existing.versionLocalizationId = loc.id;
        localeMap.set(locale, existing);
      }
    }
  } catch {
    // ignore
  }

  for (const [, entry] of localeMap) {
    summaries.push({
      locale: entry.locale!,
      hasSubtitle: entry.hasSubtitle ?? false,
      hasKeywords: entry.hasKeywords ?? false,
      hasDescription: entry.hasDescription ?? false,
      hasPromotionalText: entry.hasPromotionalText ?? false,
      hasWhatsNew: entry.hasWhatsNew ?? false,
      appInfoLocalizationId: entry.appInfoLocalizationId ?? null,
      versionLocalizationId: entry.versionLocalizationId ?? null,
    });
  }

  return summaries.sort((a, b) => a.locale.localeCompare(b.locale));
}
