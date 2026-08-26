ALTER TABLE "Location" ADD COLUMN "state" TEXT;

UPDATE "Location" SET "state" = 'Karnataka'
WHERE "id" IN ('loc_city_bengaluru', 'loc_locality_koramangala', 'loc_airport_bengaluru');

UPDATE "Location" SET "state" = 'Maharashtra'
WHERE "id" = 'loc_city_mumbai';

UPDATE "Location" location
SET "state" = hotel_state."state"
FROM (
  SELECT "locationId", MIN("state") AS "state"
  FROM "Hotel"
  WHERE "locationId" IS NOT NULL AND TRIM("state") <> ''
  GROUP BY "locationId"
) hotel_state
WHERE location."id" = hotel_state."locationId"
  AND location."state" IS NULL;

INSERT INTO "Location" (
  "id",
  "name",
  "normalizedName",
  "type",
  "state",
  "parentLocationId",
  "latitude",
  "longitude",
  "radiusKm"
)
VALUES
  (
    'loc_locality_koramangala_1st_block',
    'Koramangala 1st Block',
    'koramangala 1st block',
    'LOCALITY',
    'Karnataka',
    'loc_city_bengaluru',
    12.9279,
    77.6271,
    2
  ),
  (
    'loc_landmark_forum_mall_koramangala',
    'Forum Mall',
    'forum mall',
    'LANDMARK',
    'Karnataka',
    'loc_locality_koramangala',
    12.9345,
    77.6113,
    3
  );

INSERT INTO "LocationAlias" ("id", "alias", "normalizedAlias", "locationId")
VALUES
  (
    'alias_koramangala_1st_block',
    'Koramangala 1st Block',
    'koramangala 1st block',
    'loc_locality_koramangala_1st_block'
  ),
  (
    'alias_forum_mall',
    'Forum Mall',
    'forum mall',
    'loc_landmark_forum_mall_koramangala'
  ),
  (
    'alias_forum_koramangala',
    'Forum Koramangala',
    'forum koramangala',
    'loc_landmark_forum_mall_koramangala'
  ),
  (
    'alias_nexus_forum_mall',
    'Nexus Forum Mall',
    'nexus forum mall',
    'loc_landmark_forum_mall_koramangala'
  );
