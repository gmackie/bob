CREATE TYPE "public"."device_flow_status" AS ENUM('pending', 'approved', 'denied', 'consumed', 'expired');--> statement-breakpoint
CREATE TABLE "device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_code" varchar(16) NOT NULL,
	"status" "device_flow_status" DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"tenant_id" uuid,
	"api_key_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_codes_status_idx" ON "device_codes" USING btree ("status");