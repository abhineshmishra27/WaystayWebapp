CREATE TYPE "LocationType" AS ENUM ('CITY', 'LOCALITY', 'LANDMARK', 'AIRPORT');

CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "parentLocationId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION,
    "boundary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocationAlias" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAlias_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Hotel" ADD COLUMN "locationId" TEXT;

CREATE INDEX "Location_normalizedName_idx" ON "Location"("normalizedName");
CREATE INDEX "Location_parentLocationId_type_idx" ON "Location"("parentLocationId", "type");
CREATE INDEX "LocationAlias_normalizedAlias_idx" ON "LocationAlias"("normalizedAlias");
CREATE UNIQUE INDEX "LocationAlias_normalizedAlias_locationId_key" ON "LocationAlias"("normalizedAlias", "locationId");
CREATE INDEX "Hotel_locationId_idx" ON "Hotel"("locationId");

ALTER TABLE "Location" ADD CONSTRAINT "Location_parentLocationId_fkey"
FOREIGN KEY ("parentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LocationAlias" ADD CONSTRAINT "LocationAlias_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Location" ("id", "name", "normalizedName", "type", "parentLocationId", "latitude", "longitude", "radiusKm")
VALUES
  ('loc_city_bengaluru', 'Bengaluru', 'bengaluru', 'CITY', NULL, 12.9716, 77.5946, 45),
  ('loc_city_mumbai', 'Mumbai', 'mumbai', 'CITY', NULL, 19.0760, 72.8777, 40),
  ('loc_locality_koramangala', 'Koramangala', 'koramangala', 'LOCALITY', 'loc_city_bengaluru', 12.9352, 77.6245, 5),
  ('loc_airport_bengaluru', 'Kempegowda International Airport', 'kempegowda international airport', 'AIRPORT', 'loc_city_bengaluru', 13.1986, 77.7066, 15);

INSERT INTO "LocationAlias" ("id", "alias", "normalizedAlias", "locationId")
VALUES
  ('alias_bengaluru', 'Bengaluru', 'bengaluru', 'loc_city_bengaluru'),
  ('alias_bangalore', 'Bangalore', 'bangalore', 'loc_city_bengaluru'),
  ('alias_bangalore_city', 'Bangalore City', 'bangalore city', 'loc_city_bengaluru'),
  ('alias_mumbai', 'Mumbai', 'mumbai', 'loc_city_mumbai'),
  ('alias_bombay', 'Bombay', 'bombay', 'loc_city_mumbai'),
  ('alias_bombay_city', 'Bombay City', 'bombay city', 'loc_city_mumbai'),
  ('alias_koramangala', 'Koramangala', 'koramangala', 'loc_locality_koramangala'),
  ('alias_koramangla', 'Koramangla', 'koramangla', 'loc_locality_koramangala'),
  ('alias_560034', '560034', '560034', 'loc_locality_koramangala'),
  ('alias_kia_full', 'Kempegowda International Airport', 'kempegowda international airport', 'loc_airport_bengaluru'),
  ('alias_kempegowda_airport', 'Kempegowda Airport', 'kempegowda airport', 'loc_airport_bengaluru'),
  ('alias_bangalore_airport', 'Bangalore Airport', 'bangalore airport', 'loc_airport_bengaluru'),
  ('alias_bengaluru_airport', 'Bengaluru Airport', 'bengaluru airport', 'loc_airport_bengaluru'),
  ('alias_kial', 'KIAL', 'kial', 'loc_airport_bengaluru'),
  ('alias_blr_airport', 'BLR Airport', 'blr airport', 'loc_airport_bengaluru');

WITH normalized_cities AS (
  SELECT
    TRIM(LOWER(REGEXP_REPLACE(TRIM("city"), '[^A-Za-z0-9]+', ' ', 'g'))) AS normalized_name,
    MIN(TRIM("city")) AS display_name,
    AVG("lat") AS latitude,
    AVG("lng") AS longitude
  FROM "Hotel"
  WHERE TRIM("city") <> ''
  GROUP BY TRIM(LOWER(REGEXP_REPLACE(TRIM("city"), '[^A-Za-z0-9]+', ' ', 'g')))
)
INSERT INTO "Location" ("id", "name", "normalizedName", "type", "latitude", "longitude", "radiusKm")
SELECT
  CONCAT('loc_city_', MD5(normalized_name)),
  display_name,
  normalized_name,
  'CITY'::"LocationType",
  latitude,
  longitude,
  45
FROM normalized_cities city
WHERE NOT EXISTS (
  SELECT 1 FROM "Location" location WHERE location."normalizedName" = city.normalized_name AND location."type" = 'CITY'
)
AND NOT EXISTS (
  SELECT 1 FROM "LocationAlias" alias WHERE alias."normalizedAlias" = city.normalized_name
);

INSERT INTO "LocationAlias" ("id", "alias", "normalizedAlias", "locationId")
SELECT
  CONCAT('alias_city_', MD5(location."id")),
  location."name",
  location."normalizedName",
  location."id"
FROM "Location" location
WHERE location."type" = 'CITY'
ON CONFLICT ("normalizedAlias", "locationId") DO NOTHING;

UPDATE "Hotel" hotel
SET "locationId" = alias."locationId"
FROM "LocationAlias" alias
JOIN "Location" location ON location."id" = alias."locationId" AND location."type" = 'CITY'
WHERE TRIM(LOWER(REGEXP_REPLACE(TRIM(hotel."city"), '[^A-Za-z0-9]+', ' ', 'g'))) = alias."normalizedAlias";

UPDATE "Hotel"
SET "locationId" = 'loc_locality_koramangala'
WHERE "pincode" = '560034'
  AND TRIM(LOWER(REGEXP_REPLACE(TRIM("city"), '[^A-Za-z0-9]+', ' ', 'g'))) IN ('bangalore', 'bengaluru');
