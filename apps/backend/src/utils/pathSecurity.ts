import path from 'path';
import fs from 'fs';

/**
 * Sanitize filename by removing path traversal sequences and dangerous characters
 * @param filename Original filename
 * @returns Sanitized filename safe for use
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename: must be a non-empty string');
  }

  // Remove path traversal sequences
  let sanitized = filename
    .replace(/\.\./g, '') // Remove .. sequences
    .replace(/[\/\\]/g, '_') // Replace path separators with underscore
    .replace(/[<>:"|?*]/g, '_') // Replace dangerous characters on Windows
    .trim();

  // Remove leading/trailing dots and spaces (Windows doesn't allow these)
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Ensure filename is not empty after sanitization
  if (!sanitized || sanitized.length === 0) {
    throw new Error('Invalid filename: empty after sanitization');
  }

  // Limit filename length (255 bytes is typical filesystem limit)
  if (Buffer.from(sanitized).length > 255) {
    const ext = path.extname(sanitized);
    const nameWithoutExt = sanitized.slice(0, -(ext.length || 0));
    const maxNameLength = 255 - Buffer.from(ext).length;
    sanitized = nameWithoutExt.slice(0, maxNameLength) + ext;
  }

  return sanitized;
}

/**
 * Validate that a file path is within the allowed directory
 * Prevents path traversal attacks by ensuring the resolved path
 * is within the base directory
 * 
 * @param filePath Path to validate (can be relative or absolute)
 * @param baseDir Base directory that the path must be within
 * @returns Resolved absolute path if valid, throws error if invalid
 */
export function validatePathWithinDirectory(
  filePath: string,
  baseDir: string = process.cwd()
): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path: must be a non-empty string');
  }

  // Resolve base directory to absolute path
  const resolvedBaseDir = path.resolve(baseDir);
  
  // Resolve the file path (handles both relative and absolute paths)
  const resolvedFilePath = path.resolve(baseDir, filePath);
  
  // Normalize paths (remove .., ., etc.)
  const normalizedBaseDir = path.normalize(resolvedBaseDir);
  const normalizedFilePath = path.normalize(resolvedFilePath);
  
  // Check if resolved path is within base directory
  // Use path.relative to check if file is within base
  const relativePath = path.relative(normalizedBaseDir, normalizedFilePath);
  
  // If relative path starts with .., it's outside the base directory
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(
      `Path traversal detected: ${filePath} resolves outside allowed directory ${baseDir}`
    );
  }
  
  return normalizedFilePath;
}

/**
 * Safely join paths and validate the result is within base directory
 * @param baseDir Base directory
 * @param filePath File path to join
 * @returns Resolved absolute path if valid
 */
export function safePathJoin(baseDir: string, filePath: string): string {
  // First sanitize the file path component
  const sanitized = sanitizeFilename(path.basename(filePath));
  
  // Join paths
  const joinedPath = path.join(baseDir, sanitized);
  
  // Validate the result is within base directory
  return validatePathWithinDirectory(joinedPath, baseDir);
}

/**
 * Extract and sanitize file extension from filename
 * @param filename Original filename
 * @returns Sanitized extension (without dot) or empty string
 */
export function getSafeExtension(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return '';
  }
  
  const ext = path.extname(filename).toLowerCase();
  // Remove dot and sanitize
  return sanitizeFilename(ext.slice(1));
}

