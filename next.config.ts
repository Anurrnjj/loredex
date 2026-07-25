import type { NextConfig } from "next";

// Note: `output: "standalone"` produces the minimal server bundle the
// production image copies. Without it the image needs the whole node_modules
// tree, which roughly triples its size.

const nextConfig: NextConfig = {
  output: "standalone",

  // These are only ever imported by the worker, and bundling them breaks
  // their runtime require() of native/optional files.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx", "yauzl"],
};

export default nextConfig;
