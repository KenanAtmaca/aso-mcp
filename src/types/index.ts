export interface KeywordScore {
  keyword: string;
  traffic: number;
  difficulty: number;
}

export interface AppDetails {
  id: number;
  appId: string;
  title: string;
  url: string;
  description: string;
  developer: string;
  developerId: string;
  score: number;
  reviews: number;
  ratings: number;
  histogram: Record<string, number>;
  price: number;
  free: boolean;
  currency: string;
  genre: string;
  genreId: string;
  icon: string;
  released: string;
  updated: string;
  version: string;
  size: string;
}

export interface CompetitorAnalysis {
  keyword: string;
  country: string;
  apps: CompetitorApp[];
  keywordGap: string[];
  commonKeywords: string[];
  metrics: {
    avgRating: number;
    avgReviews: number;
    freePercentage: number;
    topDevelopers: string[];
  };
}

export interface CompetitorApp {
  title: string;
  developer: string;
  rating: number;
  reviews: number;
  free: boolean;
  price: number;
  url: string;
  titleKeywords: string[];
}

export interface MetadataOptimization {
  current: {
    title: string;
    titleLength: number;
    subtitle?: string;
    subtitleLength?: number;
  };
  suggested: {
    title: string;
    titleLength: number;
    subtitle: string;
    subtitleLength: number;
    keywordField: string;
    keywordFieldLength: number;
  };
  warnings: string[];
  characterLimits: {
    title: { used: number; max: 30 };
    subtitle: { used: number; max: 30 };
    keywords: { used: number; max: 100 };
  };
}

export interface ReviewAnalysis {
  appId: number;
  totalReviewed: number;
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
  };
  topComplaints: string[];
  featureRequests: string[];
  keywordInsights: string[];
}

export interface CacheEntry {
  key: string;
  value: string;
  expires_at: number;
  created_at: number;
}

// ─── App Store Connect Types ───

export interface ConnectConfig {
  issuerId: string;
  apiKeyId: string;
  privateKeyPath: string;
}

export interface ConnectAppInfo {
  id: string;
  bundleId: string;
  name: string;
  primaryLocale: string;
  versionId: string | null;
  versionState: string | null;
}

export interface ConnectLocalization {
  locale: string;
  name: string | null;
  nameLength: number;
  subtitle: string | null;
  subtitleLength: number;
  keywords: string | null;
  keywordsLength: number;
  description: string | null;
  descriptionLength: number;
  promotionalText: string | null;
  promotionalTextLength: number;
  whatsNew: string | null;
  whatsNewLength: number;
  supportUrl: string | null;
  marketingUrl: string | null;
  appInfoLocalizationId: string | null;
  versionLocalizationId: string | null;
}

export interface ConnectLocalizationSummary {
  locale: string;
  hasSubtitle: boolean;
  hasKeywords: boolean;
  hasDescription: boolean;
  hasPromotionalText: boolean;
  hasWhatsNew: boolean;
  appInfoLocalizationId: string | null;
  versionLocalizationId: string | null;
}

export interface ConnectMetadataUpdate {
  name?: string;
  subtitle?: string;
  keywords?: string;
  description?: string;
  promotionalText?: string;
  whatsNew?: string;
  supportUrl?: string;
  marketingUrl?: string;
}
