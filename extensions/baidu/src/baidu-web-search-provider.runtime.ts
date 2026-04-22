import {
  buildSearchCacheKey,
  buildUnsupportedSearchFilterResponse,
  DEFAULT_SEARCH_COUNT,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readNumberParam,
  readProviderEnvValue,
  readStringParam,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  type SearchConfigRecord,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const BAIDU_WEB_SEARCH_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search";

type BaiduConfig = {
  apiKey?: unknown;
};

type BaiduReference = {
  type?: unknown;
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  content?: unknown;
};

type BaiduSearchResponse = {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  references?: BaiduReference[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function resolveBaiduConfig(searchConfig?: SearchConfigRecord): BaiduConfig {
  const baidu = searchConfig?.baidu;
  return isRecord(baidu) ? (baidu as BaiduConfig) : {};
}

export function resolveBaiduApiKey(config?: BaiduConfig): string | undefined {
  return (
    readConfiguredSecretString(config?.apiKey, "tools.web.search.baidu.apiKey") ??
    readProviderEnvValue(["BAIDU_API_KEY"])
  );
}

function sanitizeBaiduErrorDetail(value: string): string {
  return value
    .replace(/Bearer\s+[^\s",]+/giu, "Bearer ***")
    .replace(/("apiKey"\s*:\s*")[^"]+(")/giu, "$1***$2");
}

function missingBaiduKeyPayload() {
  return {
    error: "missing_baidu_api_key",
    message:
      "web_search (baidu) needs an API key. Set BAIDU_API_KEY in the Gateway environment, or configure plugins.entries.baidu.config.webSearch.apiKey.",
    docs: "https://docs.openclaw.ai/tools/baidu-search",
  };
}

export function mapBaiduSearchResults(
  references: BaiduReference[] | undefined,
): Array<{ title: string; url: string; snippet?: string }> {
  if (!Array.isArray(references)) {
    return [];
  }

  return references.flatMap((entry) => {
    if (normalizeString(entry.type) && normalizeString(entry.type) !== "web") {
      return [];
    }
    const url = normalizeString(entry.url);
    const title = normalizeString(entry.title) ?? url ?? "Baidu result";
    const snippet = normalizeString(entry.snippet) ?? normalizeString(entry.content);

    if (!url || !snippet) {
      return [];
    }

    return [{ title, url, snippet }];
  });
}

async function runBaiduSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
}): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  return withTrustedWebSearchEndpoint(
    {
      url: BAIDU_WEB_SEARCH_ENDPOINT,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: params.query }],
          search_source: "baidu_search_v2",
          resource_type_filter: [{ type: "web", top_k: params.count }],
        }),
      },
    },
    async (response) => {
      if (!response.ok) {
        const detail = sanitizeBaiduErrorDetail((await response.text()) || response.statusText);
        throw new Error(`Baidu Search API error (${response.status}): ${detail}`);
      }

      let data: BaiduSearchResponse;
      try {
        data = (await response.json()) as BaiduSearchResponse;
      } catch (error) {
        throw new Error(`Baidu Search API returned invalid JSON: ${String(error)}`, {
          cause: error,
        });
      }

      if (data.code !== undefined) {
        const detail = sanitizeBaiduErrorDetail(
          normalizeString(data.message) ?? normalizeString(data.msg) ?? "Unknown API error",
        );
        throw new Error(`Baidu Search API error: ${detail}`);
      }

      return mapBaiduSearchResults(data.references);
    },
  );
}

export async function executeBaiduWebSearch(
  args: Record<string, unknown>,
  searchConfig?: SearchConfigRecord,
): Promise<Record<string, unknown>> {
  const unsupportedResponse = buildUnsupportedSearchFilterResponse(args, "baidu");
  if (unsupportedResponse) {
    return unsupportedResponse;
  }

  const baiduConfig = resolveBaiduConfig(searchConfig);
  const apiKey = resolveBaiduApiKey(baiduConfig);
  if (!apiKey) {
    return missingBaiduKeyPayload();
  }

  const query = readStringParam(args, "query", { required: true });
  const count =
    readNumberParam(args, "count", { integer: true }) ?? searchConfig?.maxResults ?? undefined;
  const resolvedCount = resolveSearchCount(count, DEFAULT_SEARCH_COUNT);
  const cacheKey = buildSearchCacheKey(["baidu", query, resolvedCount]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) {
    return cached;
  }

  const start = Date.now();
  const results = await runBaiduSearch({
    query,
    count: resolvedCount,
    apiKey,
    timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
  });
  const payload = {
    query,
    provider: "baidu",
    count: results.length,
    tookMs: Date.now() - start,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "baidu",
      wrapped: true,
    },
    results: results.map((entry) =>
      Object.assign(
        { title: wrapWebContent(entry.title, `web_search`), url: entry.url },
        entry.snippet ? { snippet: wrapWebContent(entry.snippet, `web_search`) } : {},
      ),
    ),
  };
  writeCachedSearchPayload(cacheKey, payload, resolveSearchCacheTtlMs(searchConfig));
  return payload;
}

export const __testing = {
  resolveBaiduApiKey,
  mapBaiduSearchResults,
  sanitizeBaiduErrorDetail,
} as const;
