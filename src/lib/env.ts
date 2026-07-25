import { z } from "zod";

/**
 * Validated environment. Importing this module fails fast at boot with a
 * readable message rather than surfacing `undefined` deep inside a request.
 *
 * Only server-side variables belong here. `NEXT_PUBLIC_*` values are inlined
 * at build time and must be referenced directly as `process.env.NEXT_PUBLIC_X`.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  // The endpoint the *browser* uses for presigned URLs. Differs from
  // S3_ENDPOINT in production, where the app reaches MinIO over the internal
  // compose network but the browser reaches it through Caddy.
  S3_PUBLIC_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),

  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(536_870_912),
});

let cached: z.infer<typeof serverSchema> | undefined;

export function env() {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }

  cached = parsed.data;
  return cached;
}
