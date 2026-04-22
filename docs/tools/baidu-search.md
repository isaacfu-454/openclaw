---
summary: "Baidu web search via Baidu Qianfan web search"
read_when:
  - You want to use Baidu for web_search
  - You need a BAIDU_API_KEY
  - You want structured Baidu search results inside OpenClaw
title: "Baidu Search"
---

# Baidu Search

OpenClaw supports Baidu as a `web_search` provider, using Baidu Qianfan web
search to return structured titles, URLs, and snippets.

## Get an API key

<Steps>
  <Step title="Create a key">
    Create or manage your API key in the [Baidu Qianfan Console](https://console.bce.baidu.com/qianfan/ais/console/apiKey).
  </Step>
  <Step title="Store the key">
    Set `BAIDU_API_KEY` in the Gateway environment, or configure it through:

    ```bash
    openclaw configure --section web
    ```

  </Step>
</Steps>

## Config

```json5
{
  plugins: {
    entries: {
      baidu: {
        config: {
          webSearch: {
            apiKey: "bce-v3/...", // optional if BAIDU_API_KEY is set
          },
        },
      },
    },
  },
  tools: {
    web: {
      search: {
        provider: "baidu",
      },
    },
  },
}
```

Environment alternative: set `BAIDU_API_KEY` in the Gateway environment. For a
gateway install, put it in `~/.openclaw/.env`.

## How it works

The bundled Baidu provider calls the Baidu Qianfan web search endpoint directly
from the plugin runtime. It does not rely on a workspace skill script, local
`config.json`, or shell tooling.

## Supported parameters

Baidu search supports the standard `web_search` parameters `query` and `count`.

`count` is capped at 10 because OpenClaw's shared `web_search` contract clamps
provider result counts to that range.

Provider-specific filters like `country`, `language`, `freshness`, and date
filters are not currently supported.

## Related

- [Web Search overview](/tools/web) - all providers and auto-detection
- [Bailian Search](/tools/bailian-search) - Alibaba Bailian web search with AI-answer mode
- [Brave Search](/tools/brave-search) - structured results with country and language filters
