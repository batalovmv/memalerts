# Single Source of Truth Migration

Goal: fully shift reads and writes to `ChannelMeme` + `MemeAsset`, and retire legacy `Meme` usage.

## Scope
- Current source of truth: `ChannelMeme` + `MemeAsset`
- Legacy compatibility: `Meme` (back-compat for older read paths)

## Phases
1) **Inventory & guardrails**
   - Confirm dual-write touchpoints in `docs/dual-write-inventory.md`.
   - Keep `audit:consistency` green for 7 days on prod.
   - Add runtime metric for `legacy_meme_reads_total` once a read-switch is introduced.

2) **Read path migration**
   - Replace `prisma.meme.*` reads in:
     - streamer/admin `memes` list
     - viewer stats rollups
     - overlay preview fetches
   - Use `ChannelMeme` + `MemeAsset` joins instead, maintaining `legacyMemeId` only for external IDs.

3) **Write path migration**
   - Stop creating new `Meme` rows in:
     - submission approval
     - pool activation materialization
     - meme update/delete flows
   - Keep `legacyMemeId` nullable and only for legacy lookups.

4) **Backfill & validation**
   - Ensure `scripts/backfill-meme-assets.ts` is run for any pre-migration data.
   - Re-run `pnpm audit:consistency` and compare counts:
     - `Meme` vs `ChannelMeme` (by `legacyMemeId`)
     - `MemeAsset` coverage for all channel memes

5) **Cutover**
   - Remove `Meme` reads from codebase.
   - Remove dual-write logic (legacy `Meme` writes).
   - Keep legacy ID mapping only at the API boundary if needed.

6) **Cleanup**
   - Drop legacy `Meme` table once all consumers are migrated.
   - Remove legacy fields from DTOs (if no longer used by clients).

## Risks and Mitigations
- **Read-after-write consistency:** route writes to primary DB only.
- **Legacy clients:** keep `legacyMemeId` in payloads until frontend cutover.
- **Audit gaps:** automate `audit:consistency` in CI (already done).

## Exit Criteria
- No `prisma.meme` reads or writes in runtime paths.
- `audit:consistency` passes for 2 consecutive releases.
- Legacy `Meme` table can be dropped safely.
