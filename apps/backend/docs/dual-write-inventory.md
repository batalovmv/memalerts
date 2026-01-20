# Dual-write inventory and source of truth

Source of truth: `MemeAsset` + `ChannelMeme`.

Legacy `Meme` rows are maintained only for back-compat (activations, rollups, older read paths).
All dual writes must be transactional to avoid partial state. Consistency is audited via
`npm run audit:consistency`.

## Dual-write touchpoints

- `src/controllers/submission/createSubmission.ts`
  - Owner auto-approve: creates `Meme` + `MemeAsset` + `ChannelMeme` (also restore path).
- `src/controllers/submission/importMeme.ts`
  - Owner auto-approve: creates `Meme` + `MemeAsset` + `ChannelMeme` (also restore path).
- `src/controllers/submission/createPoolSubmission.ts`
  - Owner auto-approve: creates `ChannelMeme` + legacy `Meme` for an existing `MemeAsset`.
- `src/services/approveSubmissionInternal.ts`
  - Approve submission: creates `Meme` + `MemeAsset` + `ChannelMeme`.
- `src/controllers/admin/submissions.ts`
  - Pool submission approve: creates `ChannelMeme` + legacy `Meme`.
- `src/controllers/admin/memes.ts`
  - Update/delete: mutates `ChannelMeme` + legacy `Meme`.
- `src/controllers/viewer/activation.ts`
  - Pool-all activation materializes `ChannelMeme` + legacy `Meme` (on-demand).
- `scripts/backfill-meme-assets.ts`
  - Migration bridge: backfills `MemeAsset` + `ChannelMeme` from legacy `Meme`.
