import { hash, fail } from './core.mjs';
import path from 'node:path';
export function validateUpload(filename, mime, bytes, max = 10485760) {
    if (!Buffer.isBuffer(bytes) || !bytes.length)
        fail(422, 'EMPTY_FILE', 'Upload a non-empty file.');
    if (bytes.length > max)
        fail(413, 'FILE_TOO_LARGE', 'Invoice exceeds the upload size limit.');
    if (typeof filename !== 'string')
        fail(422, 'FILENAME_REQUIRED', 'Send the original filename in X-Filename.');
    const name = path.basename(filename.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 180), ext = path.extname(name).toLowerCase();
    let actual;
    if (ext === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-')
        actual = 'application/pdf';
    else if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        actual = 'image/png';
    else if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        actual = 'image/jpeg';
    else if (ext === '.xlsx' && bytes.subarray(0, 4).equals(Buffer.from([80,75,3,4])))
        actual = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === '.csv' && !bytes.includes(0) && !bytes.toString('utf8').includes('\ufffd'))
        actual = 'text/csv';
    else if (ext === '.txt' && !bytes.includes(0) && !bytes.toString('utf8').includes('\ufffd'))
        actual = 'text/plain';
    else
        fail(415, 'UNSUPPORTED_FILE', 'Extension and signature must match PDF, PNG, JPEG, XLSX or UTF-8 CSV/TXT. XLS, XLSM and XLSB are not accepted.');
    if (mime?.split(';')[0] !== actual)
        fail(415, 'MIME_MISMATCH', 'Content-Type must match the actual uploaded file.');
    return { name, mime: actual, size: bytes.length, sha256: hash(bytes) };
}
export async function createStorage(config) {
    const sdk = await import('@aws-sdk/client-s3');
    const client = new sdk.S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle, maxAttempts: 2 });
    const send = (cmd, ms = 30000) => client.send(cmd, { abortSignal: AbortSignal.timeout(ms) });
    return {
        async check() {
            const r = await send(new sdk.GetBucketVersioningCommand({ Bucket: config.bucket }), 5000);
            if (r.Status !== 'Enabled')
                throw Error('Enable S3 bucket versioning before starting the API or worker.');
            if (config.production) {
                const p = await send(new sdk.GetPublicAccessBlockCommand({ Bucket: config.bucket }), 5000);
                if (!['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every(k => p.PublicAccessBlockConfiguration?.[k] === true))
                    throw Error('All four S3 public-access blocks must be enabled.');
                await send(new sdk.GetBucketEncryptionCommand({ Bucket: config.bucket }), 5000);
            }
            return true;
        },
        async put(key, bytes, mime) { const r = await send(new sdk.PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: mime, ChecksumSHA256: Buffer.from(hash(bytes), 'hex').toString('base64'), Metadata: { sha256: hash(bytes) } })); if (!r.VersionId || r.VersionId === 'null')
            throw Error('Object version ID missing. Bucket versioning is required.'); return { versionId: r.VersionId }; },
        async get(key, versionId, maxBytes = config.maxUploadBytes) {
            if (!versionId || versionId === 'null')
                throw Error('An immutable object version is required.');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            let body;
            try {
                const r = await client.send(new sdk.GetObjectCommand({ Bucket: config.bucket, Key: key, VersionId: versionId }), { abortSignal: controller.signal });
                body = r.Body;
                if (Number(r.ContentLength) > maxBytes)
                    throw Error('Stored object exceeds the size limit.');
                const chunks = [];
                let size = 0;
                for await (const chunk of body) {
                    size += chunk.length;
                    if (size > maxBytes)
                        throw Error('Stored object exceeds the size limit.');
                    chunks.push(Buffer.from(chunk));
                }
                return Buffer.concat(chunks);
            }
            finally {
                clearTimeout(timer);
                body?.destroy?.();
            }
        },
        async head(key) { const r = await send(new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: key }), 5000); return { versionId: r.VersionId, size: r.ContentLength, sha256: r.Metadata?.sha256 }; },
        close() { client.destroy(); }
    };
}
