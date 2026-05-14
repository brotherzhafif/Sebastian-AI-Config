## Media Delivery via WhatsApp
- **Native Media Constraints**: Native `MEDIA:/path` delivery in `send_message` often fails on WhatsApp bridges due to protocol restrictions.
- **Workaround**: If native delivery fails, provide a direct URL to the resource or use markdown image embeds `![alt](url)` which the gateway's rendering layer can often pass through if the platform supports it.
- **Fallback**: Always attempt image URL delivery if native file attachment returns a warning.
