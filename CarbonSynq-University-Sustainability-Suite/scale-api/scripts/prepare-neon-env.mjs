/** Run only on the operator's machine. No provider/network calls. */
import { readFile, writeFile, lstat, rename, mkdir, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readEnvText, prepareNeonEnv, renderEnv, safeFailure } from './neon-env-lib.mjs';
const target = new URL('../.env', import.meta.url), lock = new URL('../.env.prepare.lock/', import.meta.url);
let acquired = false, temporary;
try {
  if (process.argv.length > 2) throw Object.assign(Error('No command-line credentials are accepted. Edit scale-api/.env locally.'), { code: 'ENV_SETUP' });
  try { await lstat(target); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(target, await readFile(new URL('../.env.neon.example', import.meta.url)), { flag: 'wx', mode: 0o600 });
  }
  await mkdir(lock, { mode: 0o700 }); acquired = true;
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(Error('Refusing to replace a symlink or non-file environment path.'), { code: 'ENV_SETUP' });
  const previous = await readFile(target, 'utf8'), prepared = prepareNeonEnv(readEnvText(previous)), next = renderEnv(previous, prepared);
  if (previous === next) {
    console.log('Neon environment is already prepared. Existing secrets were preserved. No database was contacted.');
  } else {
    temporary = new URL('../.env.preparing-' + randomBytes(8).toString('hex'), import.meta.url);
    await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
    if (await readFile(target, 'utf8') !== previous) throw Object.assign(Error('.env changed during preparation. Retry after closing other editors.'), { code: 'ENV_SETUP' });
    await rename(temporary, target); temporary = undefined;
    console.log('Prepared scale-api/.env with dedicated-role URLs and random local secrets. No secrets printed; no database contacted. Next: npm run env:check');
  }
} catch (error) {
  console.error(safeFailure(error));
  process.exitCode = 1;
} finally {
  if (temporary) await unlink(temporary).catch(() => {});
  if (acquired) await rmdir(lock).catch(() => {});
}
