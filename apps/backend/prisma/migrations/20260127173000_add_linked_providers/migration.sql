ALTER TABLE "ChannelViewerEconomy"
ADD COLUMN "linkedProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
