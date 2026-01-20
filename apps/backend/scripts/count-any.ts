import { execSync } from 'child_process';

const anyCount = execSync('grep -r ": any" src/ | wc -l', { encoding: 'utf-8' }).trim();
const asAnyCount = execSync('grep -r "as any" src/ | wc -l', { encoding: 'utf-8' }).trim();

const anyTotal = Number.parseInt(anyCount, 10) + Number.parseInt(asAnyCount, 10);

console.log(`Current : any count: ${anyCount}`);
console.log(`Current as any count: ${asAnyCount}`);
console.log(`Total: ${anyTotal}`);
