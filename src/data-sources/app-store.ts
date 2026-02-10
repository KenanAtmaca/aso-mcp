import store from "app-store-scraper";
import { withRateLimit } from "../utils/rate-limiter.js";
import { RATE_LIMITS } from "../utils/constants.js";

const RL = RATE_LIMITS["app-store-scraper"];

export async function searchApps(
  term: string,
  country: string = "tr",
  num: number = 10
): Promise<any[]> {
  return withRateLimit("app-store-scraper", RL, () =>
    store.search({ term, num, country })
  );
}

export async function getAppDetails(
  appId: string | number,
  country: string = "tr"
): Promise<any> {
  return withRateLimit("app-store-scraper", RL, () => {
    if (typeof appId === "string" && !/^\d+$/.test(appId)) {
      return store.app({ appId, country, ratings: true });
    }
    return store.app({ id: Number(appId), country, ratings: true });
  });
}

export async function getSimilarApps(
  appId: number,
  country: string = "tr"
): Promise<any[]> {
  return withRateLimit("app-store-scraper", RL, () =>
    store.similar({ id: appId, country })
  );
}

export async function getReviews(
  appId: number,
  country: string = "tr",
  page: number = 1
): Promise<any[]> {
  return withRateLimit("app-store-scraper", RL, () =>
    store.reviews({ id: appId, country, page, sort: store.sort.RECENT })
  );
}

export async function getRatings(
  appId: number,
  country: string = "tr"
): Promise<any> {
  return withRateLimit("app-store-scraper", RL, () =>
    store.ratings({ id: appId, country })
  );
}

export async function getSuggestions(term: string): Promise<string[]> {
  return withRateLimit("app-store-scraper", RL, () =>
    store.suggest({ term })
  );
}
