CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" DROP CONSTRAINT "project_deploy_secret_bindings_unique";--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" ADD COLUMN "project_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_tenant_id_idx" ON "projects" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" ADD CONSTRAINT "project_deploy_secret_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_deploy_secret_bindings_project_id_idx" ON "project_deploy_secret_bindings" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" DROP COLUMN "project_slug";--> statement-breakpoint
ALTER TABLE "project_deploy_secret_bindings" ADD CONSTRAINT "project_deploy_secret_bindings_unique" UNIQUE("tenant_id","project_id","deploy_environment","deploy_env_var_name");