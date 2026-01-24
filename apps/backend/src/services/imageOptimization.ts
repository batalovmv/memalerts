import sharp from 'sharp';

export async function optimizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
