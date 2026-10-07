// Generates the web push key pair (VAPID) once per environment (the user,
// 2026-10-04: phone and browser push replaced LINE).
//
//   pnpm push:vapid-keys
//
// Put the public key in WEB_PUSH_VAPID_PUBLIC_KEY for the API and the worker,
// and the private key in WEB_PUSH_VAPID_PRIVATE_KEY for the worker only, in a
// protected environment file or the encrypted parameter store — never in
// source control or chat. Changing the pair later makes every device turn
// notifications on again, so generate it once and keep it.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const webpush = require("web-push");
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
process.stdout.write(
  [
    "Web push key pair. Store both now; this is the only time they are shown.",
    `WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`,
    `WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`,
    "",
  ].join("\n"),
);
