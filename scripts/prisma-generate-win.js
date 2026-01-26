const { execSync } = require('child_process');

const maxRetries = 5;
const delayMs = 2000;

async function runWithRetry() {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      console.log(`Attempt ${i + 1}/${maxRetries}...`);
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('Success!');
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Failed, retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

runWithRetry().catch((error) => {
  console.error(error);
  process.exit(1);
});
