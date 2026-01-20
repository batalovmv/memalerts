# Code review checklist

## Logging safety

- Do not log sensitive data in structured logs.
- Forbidden fields: `tokens`, `cookies`, `rawBody`, `PII` (email addresses).
