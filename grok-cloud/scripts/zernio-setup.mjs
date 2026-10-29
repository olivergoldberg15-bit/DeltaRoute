// Lists the X accounts connected in the owner's Zernio workspace and the values to set in Vercel.
// Needs ZERNIO_API_KEY in the environment. Prints ids and handles only, never the key.
import {pathToFileURL} from 'node:url';
import {zernioXAccounts} from '../src/zernio.mjs';
export function setupLines(accounts) {
  if (!accounts.length) return ['No X account is connected in Zernio yet. Connect the bot\'s X account in the Zernio dashboard, then run this again.'];
  return accounts.flatMap(a => [`@${a.username}:`, `  ZERNIO_ACCOUNT_ID=${a.accountId}`, `  X_BOT_ID=${a.xUserId}`, `  X_BOT_HANDLE=${a.username}`]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.ZERNIO_API_KEY) throw new Error('Set ZERNIO_API_KEY first.');
  for (const line of setupLines(await zernioXAccounts(process.env))) console.log(line);
}
