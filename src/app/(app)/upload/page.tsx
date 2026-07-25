import { UploadDropzone } from "@/components/upload-dropzone";
import { requireUserId } from "@/lib/auth";
import { collectionOptions } from "@/lib/queries";

export const metadata = { title: "Upload" };

export default async function UploadPage() {
  const userId = await requireUserId();
  const collections = await collectionOptions(userId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Upload</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Loredex reads what is inside each file, so you can find it later by
          its contents rather than its name.
        </p>
      </header>

      <UploadDropzone collections={collections} />
    </main>
  );
}
