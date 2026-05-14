---
name: messaging-gateway
description: Managing messaging platforms (WhatsApp, Telegram, Discord), home channels, and connection troubleshooting.
---

# Messaging Gateway

This skill manages messaging platform configurations and troubleshooting for Hermes Agent.

### Proactive Messaging Policy
- **User Preference**: Zhafif prefers concise, direct responses without conversational filler.
- **Workflow Update**: For WhatsApp, always prioritize informing the user about the "existing chat history" requirement immediately.
- **Media Delivery**: All files (images/documents) requested by the user MUST be downloaded to `~/downloads/` and sent as a native attachment (MEDIA:/path). NEVER send only a link if an attachment is possible.
- **Tone & Persona**: Maintain the persona of an elegant, gagah, and berwibawa butler. Keep communication efficient and professional.
- **Gratis Policy**: Prioritize 100% free, open-source, or self-hosted workarounds for all features (e.g., voice-over-IP/calling alternatives).

- **Status Reporting**: When requested (e.g., "cek status"), use the standardized health/AI report format defined in the agent memory.

### Workflow Web Scraping (User-Specific)
- **Primary Approach:** Prioritize `User-Agent` simulation in every request to mimic human traffic and bypass basic bot detection.
- **Dynamic Content:** If static `curl` or `wget` fails due to JavaScript rendering:
  1. Do NOT attempt to force parsing.
  2. Switch to official platform APIs (e.g., YouTube Data API v3, XML Feeds) as the primary, most stable method.
  3. If APIs are unavailable, utilize `browser` tool with explicit waiting times, though acknowledge that high-security sites (like YouTube/GitHub) may still block bot-like patterns.
- **Authentication:** Do NOT request account credentials (Gmail, passwords, cookies) from the user for scraping purposes.
- **Workflow for YouTube:** 
  1. Extract Channel ID via URL/About page analysis.
  2. Use public XML feeds (`youtube.com/feeds/videos.xml?channel_id=ID`) for metadata and video lists.
  3. For deep analysis, leverage the `youtube-content` skill to extract transcripts/summaries instead of downloading raw video files.
  4. If automated downloading is required, leverage a user-hosted local worker (server/PC) with Nginx proxying to avoid cloud datacenter IP blacklisting.
- **Downloads:** If a download is mandatory, follow `file-download-workflow`. If `yt-dlp` fails due to authentication, inform the user immediately rather than attempting repeated bot-style hacks that trigger security blocks.
- **Dynamic/JS Rendering:** Static scraping tools (curl/wget) fail against modern sites (YouTube, GitHub).
    - *Rule:* Always use `browser` tools first. If they fail, simulate `User-Agent` with `curl` headers. If that still fails, assume `JavaScript` dependency.
    - *Bypass:* Use official APIs (YouTube Data API v3) whenever possible instead of scraping.
- **Bot Detection & Datacenters:** YouTube blocks requests from known datacenter IPs (like Oracle/AWS/GCP).
    - *Solution:* If server-side `yt-dlp` fails due to "Signature solving" or "Bot detection", do NOT continue trying server-side workarounds. The only reliable solution is a local worker on a residential IP using a `FastAPI` + `yt-dlp` backend, proxied via Nginx.
- **Nginx Configuration:** When exposing a custom Python/FastAPI backend to Nginx, ensure:
    1. Python script binds to `0.0.0.0` (not `127.0.0.1`).
    2. Proxy pass in Nginx is configured to point to the correct internal port.
    3. Proper ownership (`www-data`) and permissions for directories.

## References
- [WhatsApp Troubleshooting](references/whatsapp-troubleshooting.md): Documentation on common bridge errors like `jidDecode`.
- **TTS Credentialing**: Never rely solely on `config.yaml` for API keys (e.g., ElevenLabs). If a service fails despite `config.yaml` settings, use the agent's dedicated credential store or environment variables. Always verify with a test call after saving.
