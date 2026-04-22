import { withEnv } from "openclaw/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createBaiduWebSearchProvider } from "./baidu-web-search-provider.js";
import { __testing } from "./baidu-web-search-provider.runtime.js";

describe("baidu web search provider", () => {
  it("exposes setup-visible metadata and selection config", () => {
    const provider = createBaiduWebSearchProvider();
    if (!provider.applySelectionConfig) {
      throw new Error("Expected applySelectionConfig to be defined");
    }

    const applied = provider.applySelectionConfig({});

    expect(provider.id).toBe("baidu");
    expect(provider.label).toBe("Baidu Web Search");
    expect(provider.credentialPath).toBe("plugins.entries.baidu.config.webSearch.apiKey");
    expect(provider.envVars).toEqual(["BAIDU_API_KEY"]);
    expect(provider.onboardingScopes).toEqual(["text-inference"]);
    expect(applied.plugins?.entries?.baidu?.enabled).toBe(true);
  });

  it("uses configured apiKey before env fallback", () => {
    expect(__testing.resolveBaiduApiKey({ apiKey: "configured-key" })).toBe("configured-key");

    withEnv({ BAIDU_API_KEY: "env-key" }, () => {
      expect(__testing.resolveBaiduApiKey({ apiKey: "configured-key" })).toBe("configured-key");
    });
  });

  it("falls back to BAIDU_API_KEY", () => {
    withEnv({ BAIDU_API_KEY: "env-key" }, () => {
      expect(__testing.resolveBaiduApiKey({})).toBe("env-key");
    });
  });

  it("maps Baidu references into structured results and drops incomplete entries", () => {
    expect(
      __testing.mapBaiduSearchResults([
        {
          type: "web",
          title: "OpenClaw",
          url: "https://openclaw.ai",
          snippet: "OpenClaw docs",
        },
        {
          type: "image",
          title: "Image",
          url: "https://example.com/image",
          snippet: "Ignored",
        },
        {
          type: "web",
          title: "Missing snippet",
          url: "https://example.com/no-snippet",
        },
        {
          title: "Fallback type",
          url: "https://example.com/fallback",
          content: "Uses content when snippet is missing",
        },
      ]),
    ).toEqual([
      {
        title: "OpenClaw",
        url: "https://openclaw.ai",
        snippet: "OpenClaw docs",
      },
      {
        title: "Fallback type",
        url: "https://example.com/fallback",
        snippet: "Uses content when snippet is missing",
      },
    ]);
  });

  it("redacts bearer tokens from API error detail", () => {
    expect(
      __testing.sanitizeBaiduErrorDetail(
        'bad request Authorization: Bearer secret-token {"apiKey":"super-secret"}',
      ),
    ).toBe('bad request Authorization: Bearer *** {"apiKey":"***"}');
  });
});
