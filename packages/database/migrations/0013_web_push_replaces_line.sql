-- Phone and browser push notifications replace LINE (the user, 2026-10-04).
-- Nothing was deployed, so there is no real LINE data to keep: the LINE
-- connection, login-attempt and webhook tables go, and so do LINE delivery
-- rows and their outbox jobs. In-app notifications are untouched.
DELETE FROM "outbox_jobs" WHERE "job_type" = 'LINE_NOTIFICATION';
--> statement-breakpoint
DELETE FROM "notifications" WHERE "channel" = 'LINE';
--> statement-breakpoint
ALTER TYPE "notification_channel" RENAME TO "notification_channel_old";
--> statement-breakpoint
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'PUSH');
--> statement-breakpoint
ALTER TABLE "notifications"
  ALTER COLUMN "channel" TYPE "notification_channel"
  USING "channel"::text::"notification_channel";
--> statement-breakpoint
DROP TYPE "notification_channel_old";
--> statement-breakpoint
DROP TABLE "line_webhook_events";
--> statement-breakpoint
DROP TABLE "line_auth_attempts";
--> statement-breakpoint
DROP TABLE "line_connections";
--> statement-breakpoint
DROP TYPE "line_connection_state";
--> statement-breakpoint
-- One row per phone or browser a person turned notifications on for. The
-- endpoint is the push service's address for that device; p256dh and auth
-- are the device's public keys for encrypting what is sent to it. A device
-- the push service reports gone (404/410) is deleted.
CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" varchar(255) NOT NULL,
  "auth" varchar(255) NOT NULL,
  "device_label" varchar(120),
  "last_success_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_unique" ON "push_subscriptions" ("endpoint");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
