import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export function resumeStorage(config) {
  if (!config.bucket) return null;
  const client = new S3Client({
    endpoint: config.endpoint, region: config.region, forcePathStyle: config.pathStyle,
    credentials: config.credentials, maxAttempts: 3
  });
  const scope = (key) => ({ Bucket: config.bucket, Key: key });
  return {
    put(key, bytes, mime) {
      return client.send(new PutObjectCommand({ ...scope(key), Body: bytes, ContentType: mime }),
        { abortSignal: AbortSignal.timeout(45_000) });
    },
    get(key, signal = AbortSignal.timeout(45_000)) {
      return client.send(new GetObjectCommand(scope(key)), { abortSignal: signal });
    },
    remove(key) {
      return client.send(new DeleteObjectCommand(scope(key)), { abortSignal: AbortSignal.timeout(30_000) });
    }
  };
}
