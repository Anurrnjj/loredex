import { randomUUID } from "node:crypto";
import { z } from "zod";

import { UnauthorizedError, requireUserId } from "@/lib/auth";
import { env } from "@/lib/env";
import { guessMimeType } from "@/lib/file-kinds";
import { buildStorageKey, presignUpload } from "@/lib/s3";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative(),
});

/**
 * Issues a presigned PUT so the browser uploads bytes *directly* to storage.
 *
 * The app never sees the file. A 300 MB zip costs this route nothing, and
 * there is no request-body limit or execution timeout to work around.
 *
 * The document ID is minted here rather than on completion so the storage key
 * is already namespaced correctly and an abandoned upload leaves one orphaned
 * object under a known prefix instead of a stray file at the bucket root.
 */
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: "Not signed in" }, { status: 401 });
    }
    throw err;
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { filename, contentType, sizeBytes } = parsed.data;
  const maxBytes = env().MAX_UPLOAD_BYTES;
  if (sizeBytes > maxBytes) {
    return Response.json(
      {
        error: `File is too large. The limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
      },
      { status: 413 },
    );
  }

  const documentId = randomUUID();
  const mimeType = guessMimeType(filename, contentType);
  const storageKey = buildStorageKey(userId, documentId, filename);
  const uploadUrl = await presignUpload(storageKey, mimeType);

  return Response.json({ documentId, storageKey, uploadUrl, mimeType });
}
