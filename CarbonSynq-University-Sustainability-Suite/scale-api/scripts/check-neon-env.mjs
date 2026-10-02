import { readFile } from 'node:fs/promises';
import { readEnvText, checkNeonEnv, safeFailure } from './neon-env-lib.mjs';
try {
  const env = readEnvText(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const result = checkNeonEnv(env);
  // Shell settings take precedence in both Node and Docker. Reject conflicting app keys
  // instead of validating one configuration and starting with another.
  const conflicts = Object.keys(env).filter(key => process.env[key] !== undefined && process.env[key] !== env[key]);
  if (conflicts.length) throw Object.assign(Error('Conflicting application variables are exported in this terminal. Clear them or use a clean terminal; values were not printed.'), { code: 'ENV_SETUP' });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(safeFailure(error));
  process.exitCode = 1;
}
