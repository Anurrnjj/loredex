import "./load-env";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { bucket, getS3, presignUpload } from "../src/lib/s3";

/**
 * Creates the bucket and smoke-tests that presigned uploads actually work.
 *
 * Note on CORS: MinIO does not implement the S3 `PutBucketCors` API — it is
 * configured on the *server* via `MINIO_API_CORS_ALLOW_ORIGIN` (see the
 * compose files). If you later switch to Cloudflare R2 or AWS S3, CORS moves
 * back to a bucket policy you set in their console or via PutBucketCors.
 *
 * Getting this wrong is the classic failure: presigned uploads are issued by
 * the app but PUT cross-origin from the browser, so a missing CORS rule shows
 * up as an opaque network error that looks nothing like a config problem.
 */

async function main() {
  try {
    await getS3().send(new HeadBucketCommand({ Bucket: bucket() }));
    console.log(`✓ bucket "${bucket()}" exists`);
  } catch {
    await getS3().send(new CreateBucketCommand({ Bucket: bucket() }));
    console.log(`✓ created bucket "${bucket()}"`);
  }

  // Server-side write, the path the worker uses for cached previews.
  const probeKey = "_loredex/健全性-probe.txt";
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: probeKey,
      Body: "ok",
      ContentType: "text/plain",
    }),
  );
  console.log("✓ server-side write works");

  // Presigned write, the path the browser uses for uploads. Exercising it here
  // catches signature/checksum mismatches at setup time rather than on the
  // user's first upload.
  const url = await presignUpload(probeKey, "text/plain");
  const res = await fetch(url, {
    method: "PUT",
    body: "ok",
    headers: { "content-type": "text/plain" },
  });
  if (!res.ok) {
    throw new Error(
      `presigned PUT failed: ${res.status} ${await res.text()}`,
    );
  }
  console.log("✓ presigned upload works");

  await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: probeKey }));

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log(
    `\nReminder: MinIO must allow CORS from ${origin} via\n` +
      `MINIO_API_CORS_ALLOW_ORIGIN in the compose file.`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("storage init failed:", err);
    process.exit(1);
  },
);
