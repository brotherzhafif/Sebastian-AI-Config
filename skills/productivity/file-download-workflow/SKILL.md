---
name: file-download-workflow
description: Workflow standar untuk menangani permintaan unduhan file oleh pengguna.
---

## Proven File Download Workflow
1. **Search Discovery:** Always start by using Firecrawl (via `web_search` or `firecrawl`) to find the direct source URL.
2. **Download Method:** Use `curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"` to ensure redirects are followed.
3. **Storage:** Save the file to `/home/ubuntu/downloads/` (create directory if needed).
4. **Verification:** Run `file <filename>` to confirm it is a valid file. See `references/download-debug.md` for troubleshooting file validation failures.
5. **Delivery:** Send the file using `MEDIA:/absolute/path/to/file`.
6. **Trigger:** Whenever user asks to "search file in internet", this workflow is the mandatory procedure.
