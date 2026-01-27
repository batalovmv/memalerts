# Access control matrix

Short map of sensitive endpoints and the access checks they must enforce.

## Submissions (viewer-facing)

| Endpoint | Who can access | Ownership / scope check |
| --- | --- | --- |
| `POST /submissions` | viewer (or streamer/admin for own channel) | channel exists; if streamer/admin uses owner bypass only when `req.channelId === channelId` |
| `POST /submissions/import` | viewer (or streamer/admin for own channel) | channel exists; owner bypass only when `req.channelId === channelId` |
| `POST /submissions/pool` | viewer (or streamer/admin for own channel) | channel exists; owner bypass only when `req.channelId === channelId` |
| `GET /submissions/mine` + `GET /submissions` | viewer | filter by `submitterUserId = req.userId` |
| `POST /submissions/:id/resubmit` | viewer | `submitterUserId === req.userId` |

## Streamer moderation (channel-scoped)

| Endpoint | Who can access | Ownership / scope check |
| --- | --- | --- |
| `GET /streamer/submissions` | streamer/admin | filter by `channelId = req.channelId` |
| `POST /streamer/submissions/:id/approve` | streamer/admin | submission `channelId === req.channelId` |
| `POST /streamer/submissions/:id/reject` | streamer/admin | submission `channelId === req.channelId` |
| `POST /streamer/submissions/:id/needs-changes` | streamer/admin | submission `channelId === req.channelId` |
| `PATCH /streamer/memes/:id` | streamer/admin | channel meme `channelId === req.channelId` |
| `DELETE /streamer/memes/:id` | streamer/admin | channel meme `channelId === req.channelId` |
| `POST /streamer/memes/:id/ai/regenerate` | streamer/admin | channel meme `channelId === req.channelId` |
| `PATCH /streamer/channel/settings` | streamer/admin | channel is `req.channelId` |
| `GET /streamer/promotions` | streamer/admin | filter by `channelId = req.channelId` |
| `POST /streamer/promotions` | streamer/admin | create with `channelId = req.channelId` |
| `PATCH /streamer/promotions/:id` | streamer/admin | promotion `channelId === req.channelId` |
| `DELETE /streamer/promotions/:id` | streamer/admin | promotion `channelId === req.channelId` |
| `GET /streamer/overlay/*` | streamer/admin | overlay token/state scoped to `req.channelId` |
| `POST /streamer/overlay/*` | streamer/admin | overlay token/state scoped to `req.channelId` |
| `POST /streamer/bot/*` + `/bots/*` | streamer/admin | channel is `req.channelId` |

## Owner routes (admin-only)

| Endpoint | Who can access | Ownership / scope check |
| --- | --- | --- |
| `/owner/*` | admin only | role check (`admin`) before handler |

## Auth token expectations (streamer/admin)

- `/streamer/*` assumes the JWT contains `channelId`; if missing, handlers return `MISSING_CHANNEL_ID`.
