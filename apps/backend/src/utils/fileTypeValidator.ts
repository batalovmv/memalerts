import fs from 'fs';

/**
 * Magic bytes (file signatures) for video formats
 * These are the actual bytes at the start of files that identify their real type
 */
const MAGIC_BYTES: Record<string, number[][]> = {
  'video/mp4': [
    [0x00, 0x00, 0x00, -1, 0x66, 0x74, 0x79, 0x70], // MP4 (ISO Base Media)
    [-1, -1, -1, -1, 0x66, 0x74, 0x79, 0x70], // MP4 variant
    [0x66, 0x74, 0x79, 0x70], // MP4 (ftyp at position 4)
  ],
  'video/webm': [
    [0x1a, 0x45, 0xdf, 0xa3], // WebM/Matroska
  ],
  'video/x-matroska': [
    [0x1a, 0x45, 0xdf, 0xa3], // Matroska/MKV
  ],
  'video/x-msvideo': [
    [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x41, 0x56, 0x49, 0x20], // AVI (RIFF...AVI )
  ],
  'video/quicktime': [
    [0x00, 0x00, 0x00, -1, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], // QuickTime/MOV
    [-1, -1, -1, -1, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], // QuickTime variant
  ],
};

/**
 * Read first bytes from file to check magic bytes
 */
async function readFileHeader(filePath: string, length: number = 12): Promise<Buffer> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await fd.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await fd.close();
  }
}

/**
 * Check if buffer matches a magic byte pattern
 * -1 in pattern means "any value" (wildcard)
 */
function matchesMagicBytes(buffer: Buffer, pattern: number[]): boolean {
  if (buffer.length < pattern.length) {
    return false;
  }

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== -1 && buffer[i] !== pattern[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Detect file type by checking magic bytes (file signatures)
 * This validates the actual file content, not just the MIME type header
 * 
 * @param filePath Path to the file
 * @returns Detected MIME type or null if unknown/invalid
 */
export async function detectFileTypeByMagicBytes(filePath: string): Promise<string | null> {
  try {
    const header = await readFileHeader(filePath, 12);
    
    // Check each known file type
    for (const [mimeType, patterns] of Object.entries(MAGIC_BYTES)) {
      for (const pattern of patterns) {
        if (matchesMagicBytes(header, pattern)) {
          return mimeType;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error reading file header for magic bytes check:', error);
    return null;
  }
}

/**
 * Validate that file's actual content matches the declared MIME type
 * 
 * @param filePath Path to the uploaded file
 * @param declaredMimeType MIME type declared in the upload (from HTTP header)
 * @returns Object with validation result
 */
export async function validateFileContent(
  filePath: string,
  declaredMimeType: string
): Promise<{ valid: boolean; error?: string; detectedType?: string }> {
  // Only validate video files
  if (!declaredMimeType.startsWith('video/')) {
    return { valid: false, error: 'Only video files are allowed' };
  }

  const detectedType = await detectFileTypeByMagicBytes(filePath);
  
  if (!detectedType) {
    return {
      valid: false,
      error: 'File type could not be determined from file content. File may be corrupted or invalid.',
    };
  }

  // Check if detected type matches declared type
  // Allow some flexibility (e.g., webm and x-matroska are related)
  const typeMatches =
    detectedType === declaredMimeType ||
    (detectedType === 'video/x-matroska' && declaredMimeType === 'video/webm') ||
    (detectedType === 'video/webm' && declaredMimeType === 'video/x-matroska');

  if (!typeMatches) {
    return {
      valid: false,
      error: `File type mismatch: declared as ${declaredMimeType}, but file content indicates ${detectedType}. This may indicate a malicious file.`,
      detectedType,
    };
  }

  return { valid: true, detectedType };
}

