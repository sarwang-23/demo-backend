import net from 'node:net';
import { Worker } from 'node:worker_threads';
// ClamD is unauthenticated. Keep this connection on a private network only.
export function scanWithClamd(bytes, { clamHost, clamPort, scanTimeoutMs = 45000 }) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: clamHost, port: clamPort });
        let response = '';
        let settled = false;
        const finish = (error, value) => { if (settled)
            return; settled = true; clearTimeout(wall); socket.destroy(); error ? reject(error) : resolve(value); };
        const wall = setTimeout(() => finish(Error('SCAN_TIMEOUT')), scanTimeoutMs);
        socket.setTimeout(scanTimeoutMs, () => finish(Error('SCAN_TIMEOUT')));
        socket.on('error', e => finish(e));
        socket.on('close', () => { if (!settled)
            finish(Error('SCAN_CONNECTION_CLOSED')); });
        socket.on('connect', async () => {
            try {
                const write = buffer => new Promise((res, rej) => socket.write(buffer, e => e ? rej(e) : res()));
                await write(Buffer.from('zINSTREAM\0'));
                for (let i = 0; i < bytes.length; i += 65536) {
                    const chunk = bytes.subarray(i, i + 65536), n = Buffer.alloc(4);
                    n.writeUInt32BE(chunk.length);
                    await write(n);
                    await write(chunk);
                }
                await write(Buffer.alloc(4));
            }
            catch (e) {
                finish(e);
            }
        });
        socket.on('data', chunk => {
            response += chunk.toString('utf8');
            if (response.length > 4096)
                return finish(Error('SCAN_RESPONSE_TOO_LARGE'));
            if (!response.includes('\0') && !response.includes('\n'))
                return;
            const result = response.replace(/[\0\r\n]/g, '').trim();
            if (result === 'stream: OK')
                finish(null, { status: 'CLEAN', engine: 'ClamAV INSTREAM' });
            else if (/^stream: .+ FOUND$/.test(result))
                finish(null, { status: 'INFECTED', engine: 'ClamAV INSTREAM' });
            else
                finish(Error('SCAN_UNAVAILABLE_OR_LIMIT_EXCEEDED'));
        });
    });
}
export function extractBounded(bytes, mime, timeoutMs = 8000) {
    return new Promise(resolve => {
        const thread = new Worker(new URL('./extract-thread.mjs', import.meta.url), { workerData: { bytes, mime }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
        let settled = false;
        const finish = result => { if (settled)
            return; settled = true; clearTimeout(timer); thread.terminate(); resolve(result); };
        const fallback = () => finish({ method: 'MANUAL_REVIEW', fields: {}, warnings: ['Automatic text extraction was unavailable. Enter and review actual consumption manually.'], needsHumanReview: true, ocrAvailable: false });
        const timer = setTimeout(fallback, timeoutMs);
        thread.on('message', finish);
        thread.on('error', fallback);
        thread.on('exit', () => { if (!settled)
            fallback(); });
    });
}
