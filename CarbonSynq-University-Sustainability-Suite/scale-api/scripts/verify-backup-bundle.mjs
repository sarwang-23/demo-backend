import {verifyBundle} from '../src/operations/backup.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/verify-backup-bundle.mjs /private/path/to/bundle');
console.log(JSON.stringify(await verifyBundle(process.argv[2]),null,2));
