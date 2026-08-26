CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

ALTER TABLE "Hotel"
ADD COLUMN "geoPoint" public.geography(Point, 4326)
GENERATED ALWAYS AS (
  public.ST_SetSRID(public.ST_MakePoint("lng", "lat"), 4326)::public.geography
) STORED;

CREATE INDEX "Hotel_geoPoint_gist_idx"
ON "Hotel" USING GIST ("geoPoint");
