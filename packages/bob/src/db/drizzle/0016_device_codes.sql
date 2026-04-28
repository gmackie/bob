CREATE TABLE "device_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_code" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_code" varchar(16) NOT NULL,
  "api_key" text,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "device_codes_device_code_unique" ON "device_codes" ("device_code");
CREATE UNIQUE INDEX "device_codes_user_code_unique" ON "device_codes" ("user_code");
