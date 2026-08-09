UPDATE "User" SET "email" = LOWER(TRIM("email"));

CREATE UNIQUE INDEX "User_email_lower_key" ON "User"(LOWER("email"));
