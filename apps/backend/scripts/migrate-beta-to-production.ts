/**
 * Migration script to merge data from beta database (memalerts_beta) into production database (memalerts)
 *
 * This script:
 * 1. Merges users by twitchUserId (keeps production user, merges beta data)
 * 2. Merges wallets (sums balances for same channels, creates new wallets for different channels)
 * 3. Preserves transaction history (redemptions, activations) from beta
 *
 * Usage:
 *   DATABASE_URL_BETA=postgresql://... DATABASE_URL=postgresql://... tsx scripts/migrate-beta-to-production.ts
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const productionDb = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const betaDb = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_BETA,
    },
  },
});

interface MigrationStats {
  usersMerged: number;
  usersCreated: number;
  walletsMerged: number;
  walletsCreated: number;
  redemptionsMigrated: number;
  activationsMigrated: number;
  errors: string[];
}

async function migrateBetaToProduction() {
  const stats: MigrationStats = {
    usersMerged: 0,
    usersCreated: 0,
    walletsMerged: 0,
    walletsCreated: 0,
    redemptionsMigrated: 0,
    activationsMigrated: 0,
    errors: [],
  };

  console.log('🚀 Starting migration from beta to production database...\n');

  try {
    // Step 1: Get all users from beta database
    console.log('📋 Step 1: Fetching users from beta database...');
    const betaUsers = await betaDb.user.findMany({
      include: {
        wallets: true,
        channel: true,
      },
    });
    console.log(`   Found ${betaUsers.length} users in beta database\n`);

    // Step 2: Merge users by twitchUserId
    console.log('👥 Step 2: Merging users...');
    for (const betaUser of betaUsers) {
      try {
        // Check if user exists in production by twitchUserId
        const existingUser = await productionDb.user.findUnique({
          where: { twitchUserId: betaUser.twitchUserId },
          include: { wallets: true },
        });

        if (existingUser) {
          // User exists in production - production data has priority
          console.log(`   User exists in production: ${existingUser.displayName} (${betaUser.twitchUserId})`);
          console.log(`     Production data will be preserved, beta data will only supplement missing information`);

          // Update user data - ONLY if production is missing the data
          // Production data has absolute priority
          const updateData: { profileImageUrl?: string | null; hasBetaAccess?: boolean } = {};

          // Only update profileImageUrl if production doesn't have it but beta does
          if (!existingUser.profileImageUrl && betaUser.profileImageUrl) {
            updateData.profileImageUrl = betaUser.profileImageUrl;
            console.log(`     Adding profileImageUrl from beta`);
          }

          // Grant beta access if beta user has it (this is safe to merge)
          if (!existingUser.hasBetaAccess && betaUser.hasBetaAccess) {
            updateData.hasBetaAccess = true;
            console.log(`     Granting beta access from beta user`);
          }

          // Only update if there's something to update
          if (Object.keys(updateData).length > 0) {
            await productionDb.user.update({
              where: { id: existingUser.id },
              data: updateData,
            });
          } else {
            console.log(`     No updates needed - production data is complete`);
          }

          // Merge wallets - production balance has priority, but we'll take maximum
          for (const betaWallet of betaUser.wallets) {
            const existingWallet = await productionDb.wallet.findUnique({
              where: {
                userId_channelId: {
                  userId: existingUser.id,
                  channelId: betaWallet.channelId,
                },
              },
            });

            if (existingWallet) {
              // Wallet exists - take maximum balance (production priority, but if beta has more, use it)
              // This handles edge case where beta user might have earned more during testing
              const maxBalance = Math.max(existingWallet.balance, betaWallet.balance);
              if (maxBalance !== existingWallet.balance) {
                console.log(
                  `     Updating wallet for channel ${betaWallet.channelId}: ${existingWallet.balance} -> ${maxBalance} (beta had ${betaWallet.balance})`
                );
                await productionDb.wallet.update({
                  where: { id: existingWallet.id },
                  data: {
                    balance: maxBalance,
                  },
                });
                stats.walletsMerged++;
              } else {
                console.log(
                  `     Wallet for channel ${betaWallet.channelId} already has higher/equal balance (${existingWallet.balance} >= ${betaWallet.balance})`
                );
              }
            } else {
              // Wallet doesn't exist in production - create it from beta
              // Use upsert to handle race conditions and old schema constraints
              console.log(
                `     Creating wallet for channel ${betaWallet.channelId} with balance ${betaWallet.balance} (not in production)`
              );
              try {
                await productionDb.wallet.upsert({
                  where: {
                    userId_channelId: {
                      userId: existingUser.id,
                      channelId: betaWallet.channelId,
                    },
                  },
                  update: {}, // If exists, don't update
                  create: {
                    userId: existingUser.id,
                    channelId: betaWallet.channelId,
                    balance: betaWallet.balance,
                  },
                });
                stats.walletsCreated++;
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                // If wallet was created by another process or constraint issue, check if it exists now
                if (message.includes('Unique constraint')) {
                  const existingWalletNow = await productionDb.wallet.findUnique({
                    where: {
                      userId_channelId: {
                        userId: existingUser.id,
                        channelId: betaWallet.channelId,
                      },
                    },
                  });
                  if (existingWalletNow) {
                    console.log(`     Wallet already exists (created concurrently or old schema), skipping`);
                  } else {
                    // Try to find by userId only (old schema might have unique on userId)
                    const walletByUserId = await productionDb.wallet.findFirst({
                      where: { userId: existingUser.id },
                    });
                    if (walletByUserId) {
                      console.log(
                        `     User already has a wallet (old schema constraint), skipping new wallet creation`
                      );
                    } else {
                      throw error;
                    }
                  }
                } else {
                  throw error;
                }
              }
            }
          }

          // Migrate redemptions
          const betaRedemptions = await betaDb.redemption.findMany({
            where: { userId: betaUser.id },
          });

          for (const redemption of betaRedemptions) {
            // Check if redemption already exists
            const existingRedemption = await productionDb.redemption.findUnique({
              where: { twitchRedemptionId: redemption.twitchRedemptionId },
            });

            if (!existingRedemption) {
              await productionDb.redemption.create({
                data: {
                  channelId: redemption.channelId,
                  userId: existingUser.id,
                  twitchRedemptionId: redemption.twitchRedemptionId,
                  pointsSpent: redemption.pointsSpent,
                  coinsGranted: redemption.coinsGranted,
                  status: redemption.status,
                  createdAt: redemption.createdAt,
                },
              });
              stats.redemptionsMigrated++;
            }
          }

          // Migrate activations
          const betaActivations = await betaDb.memeActivation.findMany({
            where: { userId: betaUser.id },
          });

          for (const activation of betaActivations) {
            // Check if activation already exists (by memeId + userId + createdAt)
            const existingActivation = await productionDb.memeActivation.findFirst({
              where: {
                userId: existingUser.id,
                memeId: activation.memeId,
                createdAt: activation.createdAt,
              },
            });

            if (!existingActivation) {
              await productionDb.memeActivation.create({
                data: {
                  channelId: activation.channelId,
                  userId: existingUser.id,
                  memeId: activation.memeId,
                  coinsSpent: activation.coinsSpent,
                  status: activation.status,
                  createdAt: activation.createdAt,
                },
              });
              stats.activationsMigrated++;
            }
          }

          stats.usersMerged++;
        } else {
          // User doesn't exist - create new user
          console.log(`   Creating new user: ${betaUser.displayName} (${betaUser.twitchUserId})`);

          const newUser = await productionDb.user.create({
            data: {
              twitchUserId: betaUser.twitchUserId,
              displayName: betaUser.displayName,
              profileImageUrl: betaUser.profileImageUrl,
              role: betaUser.role,
              channelId: betaUser.channelId,
              twitchAccessToken: betaUser.twitchAccessToken,
              twitchRefreshToken: betaUser.twitchRefreshToken,
              hasBetaAccess: betaUser.hasBetaAccess,
              createdAt: betaUser.createdAt,
            },
          });

          // Create wallets for new user
          for (const betaWallet of betaUser.wallets) {
            await productionDb.wallet.create({
              data: {
                userId: newUser.id,
                channelId: betaWallet.channelId,
                balance: betaWallet.balance,
              },
            });
            stats.walletsCreated++;
          }

          // Migrate redemptions
          const betaRedemptions = await betaDb.redemption.findMany({
            where: { userId: betaUser.id },
          });

          for (const redemption of betaRedemptions) {
            await productionDb.redemption.create({
              data: {
                channelId: redemption.channelId,
                userId: newUser.id,
                twitchRedemptionId: redemption.twitchRedemptionId,
                pointsSpent: redemption.pointsSpent,
                coinsGranted: redemption.coinsGranted,
                status: redemption.status,
                createdAt: redemption.createdAt,
              },
            });
            stats.redemptionsMigrated++;
          }

          // Migrate activations
          const betaActivations = await betaDb.memeActivation.findMany({
            where: { userId: betaUser.id },
          });

          for (const activation of betaActivations) {
            await productionDb.memeActivation.create({
              data: {
                channelId: activation.channelId,
                userId: newUser.id,
                memeId: activation.memeId,
                coinsSpent: activation.coinsSpent,
                status: activation.status,
                createdAt: activation.createdAt,
              },
            });
            stats.activationsMigrated++;
          }

          stats.usersCreated++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const errorMsg = `Error processing user ${betaUser.displayName} (${betaUser.twitchUserId}): ${message}`;
        console.error(`   ❌ ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    console.log('\n✅ Migration completed!\n');
    console.log('📊 Migration Statistics:');
    console.log(`   Users merged: ${stats.usersMerged}`);
    console.log(`   Users created: ${stats.usersCreated}`);
    console.log(`   Wallets merged: ${stats.walletsMerged}`);
    console.log(`   Wallets created: ${stats.walletsCreated}`);
    console.log(`   Redemptions migrated: ${stats.redemptionsMigrated}`);
    console.log(`   Activations migrated: ${stats.activationsMigrated}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
      stats.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
  } catch (error: unknown) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await productionDb.$disconnect();
    await betaDb.$disconnect();
  }
}

// Run migration
// Check if running as main module (ES modules way)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate-beta-to-production.ts');

if (isMainModule) {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL_BETA) {
    console.error('❌ ERROR: DATABASE_URL_BETA environment variable is required');
    console.error('   This should point to the beta database (memalerts_beta)');
    process.exit(1);
  }

  migrateBetaToProduction()
    .then(() => {
      console.log('\n✨ Migration script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateBetaToProduction };

