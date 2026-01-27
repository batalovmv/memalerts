-- Repoint beta S3 URLs to shared prod prefix.
-- Safe no-op when paths are already correct.

UPDATE "FileHash"
SET "filePath" = replace("filePath", '/twitchmemes/beta/', '/twitchmemes/prod/')
WHERE "filePath" LIKE '%/twitchmemes/beta/%';

UPDATE "MemeAsset"
SET "fileUrl" = replace("fileUrl", '/twitchmemes/beta/', '/twitchmemes/prod/')
WHERE "fileUrl" LIKE '%/twitchmemes/beta/%';

UPDATE "MemeAssetVariant"
SET "fileUrl" = replace("fileUrl", '/twitchmemes/beta/', '/twitchmemes/prod/')
WHERE "fileUrl" LIKE '%/twitchmemes/beta/%';
