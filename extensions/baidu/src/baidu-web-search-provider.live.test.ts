import { loadConfig, type OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { describe, expect, it } from "vitest";
import { isLiveTestEnabled } from "../../../src/agents/live-test-helpers.js";
import { createWebSearchTool } from "../../../src/agents/tools/web-search.js";
import { __testing as runtimeTesting } from "./baidu-web-search-provider.runtime.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const LIVE_CONFIG: OpenClawConfig = loadConfig();
const BAIDU_ENTRY = asRecord(LIVE_CONFIG.plugins?.entries?.baidu);
const BAIDU_PLUGIN_CONFIG = asRecord(BAIDU_ENTRY?.config);
const BAIDU_WEB_SEARCH_CONFIG = asRecord(BAIDU_PLUGIN_CONFIG?.webSearch);
const BAIDU_API_KEY =
  runtimeTesting.resolveBaiduApiKey({ apiKey: BAIDU_WEB_SEARCH_CONFIG?.apiKey }) ?? "";
const LIVE = isLiveTestEnabled(["BAIDU_LIVE_TEST"]);

const describeLive = LIVE && BAIDU_API_KEY.trim().length > 0 ? describe : describe.skip;

describeLive("baidu web search live", () => {
  it("returns structured results through the standard web_search tool", async () => {
    const tool = createWebSearchTool({
      config: {
        ...LIVE_CONFIG,
        plugins: {
          ...LIVE_CONFIG.plugins,
          entries: {
            ...LIVE_CONFIG.plugins?.entries,
            baidu: {
              ...BAIDU_ENTRY,
              enabled: true,
              config: {
                ...BAIDU_PLUGIN_CONFIG,
                webSearch: {
                  ...BAIDU_WEB_SEARCH_CONFIG,
                  apiKey: BAIDU_API_KEY,
                },
              },
            },
          },
        },
        tools: {
          ...LIVE_CONFIG.tools,
          web: {
            ...LIVE_CONFIG.tools?.web,
            search: {
              ...LIVE_CONFIG.tools?.web?.search,
              provider: "baidu",
            },
          },
        },
      },
    });

    expect(tool).toBeTruthy();
    const result = await tool!.execute("web-search:baidu-live", {
      query: "OpenClaw docs",
      count: 3,
    });

    const details = (result.details ?? {}) as {
      provider?: string;
      count?: number;
      error?: string;
      message?: string;
      results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
      }>;
    };

    expect(details.error, details.message).toBeUndefined();
    expect(details.provider).toBe("baidu");
    expect(Array.isArray(details.results)).toBe(true);
    expect(details.results!.length).toBeGreaterThan(0);
    expect(details.results!.length).toBeLessThanOrEqual(3);
    expect(details.count).toBe(details.results!.length);

    const first = details.results![0];
    expect(first.url?.startsWith("http")).toBe(true);
    expect((first.title?.trim().length ?? 0) > 0).toBe(true);
    expect((first.snippet?.trim().length ?? 0) > 0).toBe(true);
  }, 45_000);
});
