# GitHub Scraping Pitfalls and Workarounds

## Scraping GitHub Pages
GitHub applies strict rate-limiting and anti-bot protections to web requests.
- **Problem:** Direct `browser_navigate` or simple `curl` may time out due to CSP or JS-based rendering (asynchronous loading of repository lists).
- **Workaround (User-Agent Spoofing):** When basic requests fail, use `curl -L -H "User-Agent: Mozilla/5.0 ..."` to simulate a standard browser request.
- **Workaround (Targeting Data Endpoints):** Instead of fetching the main user page which requires rendering many components, target the repository tab endpoint directly:
  `https://github.com/USERNAME?tab=repositories`
- **Fallback (DOM Extraction):** If the page renders but contents are dynamic, use `sed` or `grep` on the raw HTML response to extract specific patterns (like `<a href="/USER/REPO" itemprop="name codeRepository">`) instead of relying on a full browser load.
