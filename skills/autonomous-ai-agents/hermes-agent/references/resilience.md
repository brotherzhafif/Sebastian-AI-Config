# Resilience and Fallback Patterns for Hermes

When agents encounter frequent `429 Too Many Requests` or `Resource Exhausted` errors, rely on a layered fallback strategy rather than simple retries.

## 1. Application-Level Configuration (~/.hermes/config.yaml)
Enable `fallback_models` to provide automated failover paths when the default model hits rate limits.

```yaml
model:
  default: <primary-model>
  fallback_models:
    - <backup-model-1>
    - <backup-model-2>
  api_max_retries: 5
  fallback_providers:
    - <provider-1>
    - <provider-2>
```

## 2. Proxy/Router Strategy (LiteLLM router.yaml)
If using an external LiteLLM proxy:
- **Routing Strategy**: Change from `latency-based-routing` to `fallback`. Latency-based strategies often prioritize "hot" keys that are more likely to be throttled. `fallback` ensures a deterministic order, hitting primary keys first and strictly failing over only when necessary.
- **Retry Logic**: Set `num_retries` to at least 5 for resilient background tasks (e.g., cron jobs).

```yaml
router_settings:
  routing_strategy: "fallback"
  num_retries: 5
```

## 3. Implementation Workflow
1. Identify the frequency of 429 errors in logs.
2. If using multiple API keys for the same provider, ensure they are listed in the `model_list` of `router.yaml`.
3. If errors persist, add a high-capacity model (e.g., Groq/Llama or a paid Anthropic model) as the final fallback in the list.
4. Restart the proxy process to apply changes.
