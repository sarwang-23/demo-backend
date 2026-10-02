/** Local object-store bootstrap: waits for the store, then enforces a private versioned bucket. Idempotent. */
import { CreateBucketCommand, GetBucketVersioningCommand, PutBucketVersioningCommand, PutPublicAccessBlockCommand, S3Client } from '@aws-sdk/client-s3';
const bucket = process.env.S3_BUCKET;
if (!bucket)
    throw Error('S3_BUCKET is required.');
const endpoint = process.env.S3_ENDPOINT;
if (!endpoint)
    throw Error('S3_ENDPOINT is required.');
const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', endpoint, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', maxAttempts: 2, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const send = (cmd, ms = 20000) => client.send(cmd, { abortSignal: AbortSignal.timeout(ms) });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const owned = ['BucketAlreadyOwnedByYou', 'BucketAlreadyExists', 'NotImplemented'];
const privacy = async () => {
    try {
        await send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
        return 'public-access-block';
    }
    catch {
        const url = endpoint.replace(/\/$/, '') + '/' + bucket + '?list-type=2', anonymous = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (anonymous.status !== 403)
            throw Error('Unsigned bucket listing was not denied with 403, so anonymous access cannot be ruled out. HTTP ' + anonymous.status + '.');
        await anonymous.body?.cancel();
        return 'unsigned-access-denied';
    }
};
let attempts = 0, lastError, result;
while (attempts < 60 && !result) {
    attempts++;
    try {
        try {
            await send(new CreateBucketCommand({ Bucket: bucket, CreateBucketConfiguration: { LocationConstraint: process.env.AWS_REGION || 'us-east-1' } }));
        }
        catch (error) {
            if (!owned.includes(error?.name))
                throw error;
        }
        await send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
        const versioning = (await send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status;
        if (versioning !== 'Enabled')
            throw Error('Bucket versioning could not be enabled.');
        const privacyProof = await privacy();
        result = { bucket, versioning, privateBy: privacyProof, anonymousAccess: false, attempts };
    }
    catch (error) {
        lastError = error;
        await sleep(2000);
    }
}
client.destroy();
if (!result) {
    console.error(JSON.stringify({ event: 'object_store_init_failed', attempts, error: lastError?.name, message: lastError?.message }));
    process.exit(1);
}
console.log(JSON.stringify({ event: 'object_store_ready', ...result }));
