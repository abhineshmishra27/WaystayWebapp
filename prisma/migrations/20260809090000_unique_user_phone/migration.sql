-- Keep the phone number on the oldest account when legacy/test data contains
-- duplicates. PostgreSQL permits multiple NULL values in a unique index.
WITH ranked_phones AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "phone"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS phone_rank
  FROM "User"
  WHERE "phone" IS NOT NULL
)
UPDATE "User"
SET "phone" = NULL
FROM ranked_phones
WHERE "User"."id" = ranked_phones."id"
  AND ranked_phones.phone_rank > 1;

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
