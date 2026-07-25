import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "./env";

/**
 * S3 access. Points at MinIO today; pointing it at Cloudflare R2 or AWS S3 is
 * an env-var change only — nothing in this file is MinIO-specific beyond
 * `forcePathStyle`, which real S3 tolerates being false.
 */

function makeClient(endpoint: string) {
  const e = env();
  return new S3Client({
    region: e.S3_REGION,
    endpoint,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY,
      secretAccessKey: e.S3_SECRET_KEY,
    },
    // Recent AWS SDK versions attach CRC32 checksum headers to every request.
    // MinIO rejects those with an opaque `NotImplemented`, and they also break
    // presigned PUTs (the browser can't reproduce the header the signature
    // covers). Only send checksums where the API genuinely requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const globalForS3 = globalThis as unknown as {
  loredexS3?: S3Client;
  loredexS3Public?: S3Client;
};

/*
 * Both clients are built lazily and cached.
 *
 * This must not happen at module scope: `next build` imports every route to
 * collect its metadata, and constructing a client there would read `env()` and
 * fail the build unless runtime secrets were baked into the image. Secrets
 * belong at runtime, so the clients are created on first use instead.
 */

/** For server-side reads/writes, over the internal network in production. */
export function getS3(): S3Client {
  return (globalForS3.loredexS3 ??= makeClient(env().S3_ENDPOINT));
}

/**
 * For minting URLs the *browser* will hit. In production the app reaches MinIO
 * at `http://minio:9000` but the browser must reach it at
 * `https://s3.yourdomain.com` — signing with the wrong host produces a
 * signature the storage server rejects.
 */
function getS3Public(): S3Client {
  return (globalForS3.loredexS3Public ??= makeClient(env().S3_PUBLIC_ENDPOINT));
}

export function bucket(): string {
  return env().S3_BUCKET;
}

/** Presigned PUT so the browser uploads bytes directly to storage. */
export function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 900,
) {
  return getSignedUrl(
    getS3Public(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

/**
 * Presigned GET. Short-lived by design: the URL is handed out only after an
 * access check, and a leaked one expires quickly.
 */
export function presignDownload(
  key: string,
  opts: { filename?: string; inline?: boolean; expiresIn?: number } = {},
) {
  const disposition = opts.filename
    ? `${opts.inline ? "inline" : "attachment"}; filename="${opts.filename.replace(/"/g, "")}"`
    : undefined;

  return getSignedUrl(
    getS3Public(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: opts.expiresIn ?? 300 },
  );
}

/** Server-side read, used by the worker to pull a file for extraction. */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
  );
  if (!res.Body) throw new Error(`Empty object body for key ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** Server-side write, used by the worker to cache converted previews. */
export async function putObject(
  key: string,
  body: Buffer | string,
  contentType: string,
) {
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string) {
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Storage keys are namespaced by owner so a bucket listing stays navigable
 * and a per-user purge is a prefix delete.
 */
export function buildStorageKey(
  ownerId: string,
  documentId: string,
  filename: string,
) {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  return `docs/${ownerId}/${documentId}/${safe}`;
}

export function buildPreviewKey(documentId: string, ext: string) {
  return `previews/${documentId}/preview.${ext}`;
}
