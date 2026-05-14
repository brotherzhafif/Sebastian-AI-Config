---
name: firecrawl
description: Firecrawl web search and scraping.
---

# firecrawl

Firecrawl gives AI agents fast, reliable web context with search, scraping, and interaction tools.

## Setup
```bash
export FIRECRAWL_API_KEY=fc-ef30cf5079bb4d6688843f586063028a
```

## Usage
- POST /search: discover pages by query.
- POST /scrape: extract clean markdown from a URL.
- POST /interact: perform browser actions (clicks, forms).

## Example (Scrape)
curl -X POST https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
