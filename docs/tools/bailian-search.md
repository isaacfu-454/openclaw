---
summary: "Bailian web search via Alibaba Bailian Web Search MCP"
read_when:
  - You want to use Bailian for web_search
  - You need a DASHSCOPE_API_KEY
  - You want AI-synthesized search answers or structured results
title: "Bailian Search"
---

# Bailian Search

OpenClaw supports Bailian as a `web_search` provider, using Alibaba Bailian Web
Search over MCP. It can return AI-synthesized answers with citations or a
structured result list.

## Get an API key

<Steps>
  <Step title="Create a key">
    Get an API key from [Alibaba Bailian](https://bailian.console.aliyun.com/)
    or DashScope.
  </Step>
  <Step title="Store the key">
    Set `DASHSCOPE_API_KEY`, `MODELSTUDIO_API_KEY`, or `QWEN_API_KEY` in the
    Gateway environment, or configure via:

    ```bash
    openclaw configure --section web
    ```

  </Step>
</Steps>

When you choose **Bailian Web Search** during `openclaw onboard` or
`openclaw configure --section web`, OpenClaw also asks which response mode you
want:

- `answer` -- AI-synthesized answer with citations
- `results` -- structured titles, URLs, and snippets

## Config

```json5
{
  plugins: {
    entries: {
      bailian: {
        config: {
          webSearch: {
            apiKey: "sk-...", // optional if DASHSCOPE_API_KEY / MODELSTUDIO_API_KEY / QWEN_API_KEY is set
            mode: "answer", // or "results"
          },
        },
      },
    },
  },
  tools: {
    web: {
      search: {
        provider: "bailian",
      },
    },
  },
}
```

**Environment alternative:** set `DASHSCOPE_API_KEY`, `MODELSTUDIO_API_KEY`, or
`QWEN_API_KEY` in the Gateway environment. For a gateway install, put it in
`~/.openclaw/.env`.

If you omit `mode`, OpenClaw defaults to `answer`.

## How it works

Bailian search uses the Bailian Web Search MCP endpoint directly from the
bundled provider runtime. Unlike the older skill wrapper approach, the built-in
provider does not require `bash`, `curl`, or `jq` inside your OpenClaw
container.

## Supported parameters

Bailian search supports `query` and `count`.

`count` controls how many search hits Bailian requests upstream. In `answer`
mode, OpenClaw still returns one synthesized answer with citations. In
`results` mode, OpenClaw returns structured results when Bailian exposes them,
and falls back to a single wrapped textual result if Bailian only returns
answer-style text for the query.

Provider-specific filters like `country`, `language`, `freshness`, and date
filters are not currently supported.

## Related

- [Web Search overview](/tools/web) -- all providers and auto-detection
- [Kimi Search](/tools/kimi-search) -- AI-synthesized answers via Moonshot web search
- [Gemini Search](/tools/gemini-search) -- AI-synthesized answers via Google grounding
