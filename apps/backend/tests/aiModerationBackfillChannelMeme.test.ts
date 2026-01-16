import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { processOneSubmission } from '../src/jobs/aiModerationSubmissions.js';
import { configureFfmpegPaths } from '../src/utils/media/configureFfmpeg.js';
import {
  createChannel,
  createChannelMeme,
  createFileHash,
  createMemeAsset,
  createSubmission,
  createUser,
} from './factories/index.js';

configureFfmpegPaths();

function rand(): string {
  return Math.random().toString(16).slice(2);
}

function getFfmpegPath(): string {
  const installer = ffmpegInstaller as { path?: unknown };
  const p = typeof installer.path === 'string' ? installer.path : '';
  if (!p) throw new Error('ffmpeg binary not available');
  return p;
}

function runFfmpeg(args: string[]): void {
  const ffmpegPath = getFfmpegPath();
  const res = spawnSync(ffmpegPath, args, { stdio: 'pipe' });
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString() : '';
    throw new Error(`ffmpeg failed: ${stderr}`);
  }
}

async function writeValidWebm(localPath: string): Promise<bigint> {
  runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:d=1',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-shortest',
    '-c:v',
    'libvpx',
    '-crf',
    '10',
    '-b:v',
    '500k',
    '-c:a',
    'libvorbis',
    '-b:a',
    '64k',
    localPath,
  ]);
  const stat = await fs.promises.stat(localPath);
  return BigInt(stat.size);
}

describe('AI moderation backfill into ChannelMeme', () => {
  it('processes approved upload submissions and copies aiAuto* + searchText into ChannelMeme', async () => {
    const channel = await createChannel({
      slug: `ch_${rand()}`,
      name: `Channel ${rand()}`,
      defaultPriceCoins: 100,
    });

    const user = await createUser({
      displayName: `Streamer ${rand()}`,
      role: 'streamer',
      hasBetaAccess: false,
      channelId: channel.id,
    });

    const fileName = `ai-${rand()}.webm`;
    const fileUrl = `/uploads/memes/${fileName}`;
    const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
    const localPath = path.join(uploadsRoot, 'memes', fileName);
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    const fileSize = await writeValidWebm(localPath);

    const fileHash = `hash_${rand()}`;

    // MemeAsset.fileHash has a FK to FileHash.hash in this project.
    await createFileHash({
      hash: fileHash,
      filePath: fileUrl,
      referenceCount: 1,
      fileSize,
      mimeType: 'video/webm',
    });

    const memeAsset = await createMemeAsset({
      type: 'video',
      fileUrl,
      fileHash,
      durationMs: 1000,
      createdByUserId: user.id,
    });

    const channelMeme = await createChannelMeme({
      channelId: channel.id,
      memeAssetId: memeAsset.id,
      status: 'approved',
      title: 'Initial title',
      priceCoins: 100,
      addedByUserId: user.id,
      approvedByUserId: user.id,
      approvedAt: new Date(),
    });

    const submissionData = {
      channelId: channel.id,
      submitterUserId: user.id,
      title: 'nsfw test',
      type: 'video',
      fileUrlTemp: fileUrl,
      sourceKind: 'upload',
      status: 'approved',
      memeAssetId: memeAsset.id,
      fileHash,
      durationMs: 1000,
      aiStatus: 'pending',
    } satisfies Prisma.MemeSubmissionCreateInput;
    const submission = await createSubmission(submissionData);

    await processOneSubmission(submission.id);

    const updated = await prisma.channelMeme.findUnique({
      where: { id: channelMeme.id },
      select: { aiAutoDescription: true, aiAutoTagNamesJson: true, searchText: true },
    });

    expect(typeof updated?.aiAutoDescription).toBe('string');
    expect(Array.isArray(updated?.aiAutoTagNamesJson)).toBe(true);
    expect(typeof updated?.searchText).toBe('string');

    // Cleanup file best-effort (avoid polluting workspace in repeated test runs).
    try {
      await fs.promises.unlink(localPath);
    } catch {
      // ignore
    }
  });
});
