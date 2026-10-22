import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './env';

export type PreviewJob = { photoId: string; watermarkVersion: number };
export const queueConnection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const previewQueue = new Queue<PreviewJob>('gallery-preview-v1', { connection: queueConnection });

export async function enqueuePreview(photoId: string, watermarkVersion: number) {
  await previewQueue.add('render', { photoId, watermarkVersion }, {
    jobId: `photo_${photoId}_v${watermarkVersion}`,
    attempts: 6,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 604800 }
  });
}
