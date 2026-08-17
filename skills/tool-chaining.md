---
name: tool-chaining
version: 1.0
description: Automatic skill loading based on intent detection in user prompts
trigger_keywords:
  - cron
  - ringkas
  - arsip
  - debug
  - search
  - session
  - file
  - terminal
---

# Tool Chaining - Auto Load Skills

## Intent Mapping

| Intent Pattern | Skills to Load |
|----------------|----------------|
| `cron\|jadwal\|remind` | cronjob-management, llm-wiki |
| `ringkas\|summary\|summarize` | llm-wiki, global-memory-manager |
| `arsip\|archive\|memory` | llm-wiki, global-memory-manager, zhafif-memory |
| `debug\|error\|troubleshoot` | systematic-debugging, hermes-agent |
| `cari\|search\|find.*session` | global-memory-manager, llm-wiki |
| `file\|baca\|tulis` | llm-wiki (for markdown query) |
| `terminal\|jalankan\|run\|command` | hermes-agent (bash/terminal usage) |

## Implementation Hook

Pasang di prompt processor:
```javascript
if (prompt.match(/cron|ringkas|arsip|debug|search|file|terminal/i)) {
  injectSkills(['tool-chaining']);
}
```

## Usage Examples

- "Buat cron ringkas percakapan kemarian" → auto load `cronjob-management` + `llm-wiki` + `global-memory-manager`
- "Cari session kemaren tentang cron" → auto load `global-memory-manager`