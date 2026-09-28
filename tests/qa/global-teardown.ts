import { cleanup, closeDemo } from "./fixtures";

/** Leave the demo database exactly as it was (set QA_KEEP=1 to inspect what a run created). */
export default async function globalTeardown() {
  if (!process.env.QA_KEEP) await cleanup();
  await closeDemo();
}
