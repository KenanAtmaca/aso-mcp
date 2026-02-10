declare module "app-store-scraper" {
  interface SearchOptions {
    term: string;
    num?: number;
    page?: number;
    country?: string;
    lang?: string;
  }

  interface AppOptions {
    id?: number;
    appId?: string;
    country?: string;
    ratings?: boolean;
  }

  interface SimilarOptions {
    id: number;
    country?: string;
  }

  interface ReviewOptions {
    id: number;
    country?: string;
    page?: number;
    sort?: number;
  }

  interface RatingOptions {
    id: number;
    country?: string;
  }

  interface SuggestOptions {
    term: string;
  }

  interface AppResult {
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
    [key: string]: any;
  }

  interface Store {
    search(options: SearchOptions): Promise<AppResult[]>;
    app(options: AppOptions): Promise<AppResult>;
    similar(options: SimilarOptions): Promise<AppResult[]>;
    reviews(options: ReviewOptions): Promise<any[]>;
    ratings(options: RatingOptions): Promise<any>;
    suggest(options: SuggestOptions): Promise<string[]>;
    sort: {
      RECENT: number;
      HELPFUL: number;
    };
  }

  const store: Store;
  export = store;
}

declare module "aso" {
  interface AsoClient {
    scores(keyword: string): Promise<{ traffic: number; difficulty: number }>;
    suggest(options: {
      strategy: any;
      appId: string;
      num?: number;
    }): Promise<string[]>;
    CATEGORY: any;
    SIMILAR: any;
    COMPETITION: any;
  }

  interface AsoFactory {
    (store: string, options?: { country?: string }): AsoClient;
    CATEGORY: any;
    SIMILAR: any;
    COMPETITION: any;
  }

  const aso: AsoFactory;
  export = aso;
}
