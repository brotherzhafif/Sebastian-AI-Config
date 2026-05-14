---
name: cronjob-management
description: Manage automated reminders and scheduled tasks.
---
# Cron Job Management

This skill handles automated scheduling for Tuan Zhafif Raditya H.

## Workflow

### Scheduling Rules
- **Specific Date/Time:** Always set `repeat: once`. The task will automatically be removed by the system after execution.
- **Interval-based (Daily/Weekly/Monthly):** Set `repeat: forever` only when explicitly requested (e.g., "setiap hari", "tiap Jumat").

## Pitfalls
- Do not keep expired 'once' jobs in the list; ensure the system cleans them up.
- Verify the `deliver` parameter. For Tuan Zhafif's personal notifications outside this chat, use the WhatsApp/Fonnte integration. For messages meant for this chat, use `origin`.
