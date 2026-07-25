import { config } from "dotenv";

/**
 * Side-effect module: loads .env.local then .env.
 *
 * Must be the *first* import in any script that touches `src/lib/env.ts`.
 * ES module imports are evaluated in order, and `env()` reads `process.env`
 * when its module is first imported — so importing this later is too late.
 */
config({ path: ".env.local" });
config({ path: ".env" });
