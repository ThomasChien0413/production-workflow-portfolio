CREATE TABLE "template_client_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"template_id" uuid NOT NULL,
	"version_id" uuid,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_client_mutations" ADD CONSTRAINT "template_client_mutations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_client_mutations" ADD CONSTRAINT "template_client_mutations_template_id_sheet_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sheet_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_client_mutations" ADD CONSTRAINT "template_client_mutations_version_id_sheet_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."sheet_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_client_mutations_actor_key_unique" ON "template_client_mutations" USING btree ("actor_user_id","client_mutation_id");--> statement-breakpoint
CREATE INDEX "template_client_mutations_template_idx" ON "template_client_mutations" USING btree ("template_id");
