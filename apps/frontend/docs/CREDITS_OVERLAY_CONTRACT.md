# Credits Overlay (OBS) — contracts

This document describes the **frontend expectations** for the new Credits (Титры) overlay.

## Browser Source URLs
- Memes overlay (existing): `/overlay/t/:token`
- Credits overlay (new): `/overlay/credits/t/:token`

Both also support legacy `/overlay/:channelSlug` style joins via `join:channel` (optional/back-compat).

## REST (settings / token)
### Get token + saved settings
`GET /streamer/credits/token`

Response:
```json
{
  "token": "string",
  "creditsStyleJson": "string|null"
}
```

### Save settings
`POST /streamer/credits/settings`

Body:
```json
{
  "creditsStyleJson": "string"
}
```

### Rotate token (invalidate leaked link)
`POST /streamer/credits/token/rotate`

Response:
```json
{ "token": "string" }
```

## Socket.io (overlay runtime)
### Join
Client emits on connect:
- `join:overlay` with `{ "token": "string" }`
or
- `join:channel` with `"channelSlug"`

### Config
Server emits:
- `credits:config` with `{ "creditsStyleJson": "string|null" }`

### Data
Server emits:
- `credits:state` with:
```json
{
  "chatters": [{ "name": "string" }],
  "donors": [{ "name": "string", "amount": 123, "currency": "RUB" }]
}
```

Incremental updates are optional for MVP (`credits:update`), the frontend supports full state replacement via `credits:state`.

## creditsStyleJson schema (MVP)
```json
{
  "sectionsOrder": ["donors", "chatters"],
  "showDonors": true,
  "showChatters": true,

  "fontFamily": "system|inter|roboto|...",
  "fontSize": 26,
  "fontWeight": 800,
  "fontColor": "#ffffff",

  "bgOpacity": 0.18,
  "blur": 6,
  "radius": 20,
  "shadowBlur": 90,
  "shadowOpacity": 0.6,

  "scrollSpeed": 48,
  "sectionGapPx": 24,
  "lineGapPx": 8,
  "fadeInMs": 600
}
```


