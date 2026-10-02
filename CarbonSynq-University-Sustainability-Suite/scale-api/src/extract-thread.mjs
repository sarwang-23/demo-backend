import { parentPort, workerData } from 'node:worker_threads';
import { extractInvoice } from './invoice-text.mjs';
parentPort.postMessage(extractInvoice(Buffer.from(workerData.bytes), workerData.mime));
