# WhatsApp Messaging Troubleshooting

## Common Error: jidDecode
- **Error**: `Cannot destructure property 'user' of 'jidDecode(...)' as it is undefined.`
- **Cause**: Attempting to send messages to phone numbers directly using an ID format that the bridge bridge does not currently support for initiating new sessions.
- **Resolution**:
    1. Always prefer using the active chat session ID (e.g., `70729588568201@lid`) for the current user to avoid bridge decoding errors.
    2. If messaging a new contact, they must be in the contact list or have existing chat history.
    3. Do not attempt to force format numbers as `@s.whatsapp.net` unless specifically required by the bridge documentation, as it often fails on standard WhatsApp multi-device bridges.
