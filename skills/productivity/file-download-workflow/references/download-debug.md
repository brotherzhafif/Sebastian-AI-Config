# Debugging Download Failures (Reference)

- **Common Issue:** `curl` fetching HTML instead of binary (common with search engine landing pages).
- **Verification Pattern:** Always use `file <filename>` after `curl`.
- **Failure Handling:**
    - If `file` returns "HTML document" or "ASCII text": The URL was a landing page, not the resource. Re-scrape or use a more specific source.
    - If `file` returns "empty": Connection dropped or server blocked the User-Agent. Try with different headers or a direct image host (e.g., Wikimedia, Imgur, Unsplash direct links).
    - If `HTTP/2 404`: URL is dead. Do not retry; search for a fresh one.
- **Pro-tip:** For images, appending `.jpg` or `.png` to some URLs (like Imgur) sometimes forces a direct download link.
