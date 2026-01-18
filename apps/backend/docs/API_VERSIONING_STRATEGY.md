# API Versioning Strategy

Date: 2026-01-18

Goal: introduce versioned public API while preserving backward compatibility.

## Approach

- Add a versioned base path: `/api/v1`.
- Keep existing unversioned routes during a migration window.
- Use deprecation headers on legacy routes:
  - `Deprecation: true`
  - `Sunset: <RFC1123 date>`
  - `Link: <https://docs.twitchmemes.ru/api/v1>; rel="successor-version"`

## Migration plan

1) Introduce `/api/v1` aliases for public endpoints (read-only first).
2) Update clients (frontend, bots, overlays).
3) Enable deprecation headers on unversioned routes.
4) Track usage and remove legacy paths after the sunset date.

## Compatibility rules

- No breaking changes within a major version.
- Additive changes are allowed (new fields are optional).
- Breaking changes require a new version.

## Observability

- Log route version and client to monitor migration progress.
*** End Patch"}]} 
