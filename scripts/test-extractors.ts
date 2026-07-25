import "./load-env";

import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as XLSX from "xlsx";

import { detectKind } from "../src/lib/file-kinds";
import { extract } from "../src/worker/extractors";

const execFileAsync = promisify(execFile);

/**
 * Exercises every extractor against a real generated file of each type.
 * Run with `pnpm tsx scripts/test-extractors.ts`.
 *
 * This is a smoke test, not a unit test suite — the point is to catch "this
 * format silently produces empty text", which is the failure mode that makes a
 * document quietly unsearchable.
 */
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "loredex-test-"));
  let failures = 0;

  async function check(
    label: string,
    filename: string,
    buffer: Buffer,
    mustContain: string,
  ) {
    const kind = detectKind(filename);
    try {
      const result = await extract(buffer, filename, kind);
      const hit = result.text.toLowerCase().includes(mustContain.toLowerCase());
      const status = hit ? "PASS" : "FAIL";
      if (!hit) failures++;
      console.log(
        `${status}  ${label.padEnd(22)} kind=${kind.padEnd(9)} ` +
          `chars=${String(result.text.length).padStart(6)} ` +
          `${result.pageCount ? `pages=${result.pageCount} ` : ""}` +
          `${result.preview ? `preview=${result.preview.ext} ` : ""}` +
          `${result.zipEntries ? `entries=${result.zipEntries.length}` : ""}`,
      );
      if (!hit) {
        console.log(`      expected to find "${mustContain}"`);
        console.log(`      got: ${result.text.slice(0, 200)}`);
      }
    } catch (err) {
      failures++;
      console.log(`FAIL  ${label.padEnd(22)} threw: ${err}`);
    }
  }

  // --- markdown
  await check(
    "markdown",
    "docker-notes.md",
    Buffer.from(
      "# Docker notes\n\nUse a multi stage build to keep images small.\n",
    ),
    "multi stage",
  );

  // --- code
  await check(
    "code (Dockerfile)",
    "Dockerfile",
    Buffer.from("FROM node:20-slim\nRUN apt-get update\n"),
    "node:20-slim",
  );

  // --- xlsx
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["service", "port"],
      ["postgres", 5432],
      ["minio", 9000],
    ]),
    "Ports",
  );
  await check(
    "xlsx",
    "ports.xlsx",
    Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })),
    "postgres",
  );

  // --- zip containing a Dockerfile (the headline case)
  const zipPath = join(dir, "project.zip");
  const srcDir = join(dir, "project");
  await execFileAsync("mkdir", ["-p", srcDir]);
  await writeFile(
    join(srcDir, "Dockerfile"),
    "FROM caddy:2-alpine\nCOPY Caddyfile /etc/caddy/Caddyfile\n",
  );
  await writeFile(join(srcDir, "README.md"), "# Old project\nCaddy setup.\n");
  await execFileAsync("zip", ["-rq", zipPath, "project"], { cwd: dir });
  await check(
    "zip (inner content)",
    "project.zip",
    await readFile(zipPath),
    "caddy:2-alpine",
  );

  // --- docx and pdf via LibreOffice, when available
  let haveSoffice = true;
  try {
    await execFileAsync("soffice", ["--version"], { timeout: 60_000 });
  } catch {
    haveSoffice = false;
  }

  if (haveSoffice) {
    const htmlPath = join(dir, "guide.html");
    await writeFile(
      htmlPath,
      "<h1>Prompt guide</h1><p>Always specify the output format explicitly.</p>",
    );

    // Converting *from* HTML needs the filter named explicitly — bare "docx"
    // makes LibreOffice pick a Writer/Web filter and silently emit nothing.
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--convert-to",
        "docx:MS Word 2007 XML",
        "--outdir",
        dir,
        htmlPath,
      ],
      { timeout: 180_000 },
    );
    await check(
      "docx",
      "guide.docx",
      await readFile(join(dir, "guide.docx")),
      "output format",
    );

    await execFileAsync(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", dir, htmlPath],
      { timeout: 180_000 },
    );
    await check(
      "pdf",
      "guide.pdf",
      await readFile(join(dir, "guide.pdf")),
      "output format",
    );

    // .odt exercises the LibreOffice subprocess path — the same
    // convertWithLibreOffice -> extractPdf route that .pptx and the legacy
    // binary formats take. Impress has no importer for our HTML fixture, so
    // this stands in for pptx rather than duplicating the conversion.
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--convert-to",
        "odt:writer8",
        "--outdir",
        dir,
        htmlPath,
      ],
      { timeout: 180_000 },
    );
    await check(
      "odt (soffice path)",
      "guide.odt",
      await readFile(join(dir, "guide.odt")),
      "output format",
    );
  } else {
    console.log(
      "SKIP  docx/pdf/pptx        soffice not on PATH (installed in the " +
        "production image; install libreoffice locally to cover these)",
    );
  }

  await rm(dir, { recursive: true, force: true });

  console.log(
    failures === 0
      ? "\nAll extractor checks passed."
      : `\n${failures} extractor check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
