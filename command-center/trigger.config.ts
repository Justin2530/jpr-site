import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev runs the jobs that outlive a Vercel function, starting with staying on each AI screening
// call so the assistant can hang up. Project "jpr-local" in the JPR organization.
export default defineConfig({
  project: "proj_xhdgeqdwtkbdmeupjrks",
  dirs: ["./src/trigger"],
  maxDuration: 1200,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
