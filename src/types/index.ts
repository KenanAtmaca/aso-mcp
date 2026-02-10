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
