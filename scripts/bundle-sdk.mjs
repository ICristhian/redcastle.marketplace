import { build } from "esbuild";

// Generate a first-party module from pinned npm dependencies.
// Never include service-role secrets or environmental credentials in this bundle.
await build({
  entryPoints: ["scripts/supabase-sdk-entry.mjs"],
  outfile: "public/js/vendor/supabase.mjs",
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  bundle: true,
  minify: true,
  legalComments: "linked",
  sourcemap: false,
  logLevel: "info",
});
