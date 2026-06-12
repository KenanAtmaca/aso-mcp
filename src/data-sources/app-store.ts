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

export async function getSuggestions(
  term: string,
  country: string = "tr"
): Promise<string[]> {
  // app-store-scraper's suggest() returns [{ term: "..." }] objects, not
  // strings, and supports country via the X-Apple-Store-Front header.
  // Normalize to plain strings so callers never leak objects into keyword pools.
  const raw = await withRateLimit("app-store-scraper", RL, () =>
    store.suggest({ term, country })
  );
  return (raw ?? [])
    .map((s: any) => (typeof s === "string" ? s : s?.term || ""))
    .filter((s: string) => s.length > 0);
}
