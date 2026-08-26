CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.waystay_unaccent(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent', input)
$$;

CREATE OR REPLACE FUNCTION public.waystay_normalize(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT TRIM(LOWER(REGEXP_REPLACE(public.waystay_unaccent(input), '[^A-Za-z0-9]+', ' ', 'g')))
$$;

CREATE OR REPLACE FUNCTION public.waystay_hotel_search_vector(
  hotel_name TEXT,
  hotel_address TEXT,
  hotel_city TEXT,
  hotel_state TEXT,
  hotel_pincode TEXT
)
RETURNS TSVECTOR
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    SETWEIGHT(TO_TSVECTOR('simple', public.waystay_unaccent(COALESCE(hotel_name, ''))), 'A') ||
    SETWEIGHT(TO_TSVECTOR('simple', public.waystay_unaccent(COALESCE(hotel_address, ''))), 'B') ||
    SETWEIGHT(TO_TSVECTOR('simple', public.waystay_unaccent(COALESCE(hotel_city, ''))), 'B') ||
    SETWEIGHT(TO_TSVECTOR('simple', public.waystay_unaccent(COALESCE(hotel_state, ''))), 'C') ||
    SETWEIGHT(TO_TSVECTOR('simple', public.waystay_unaccent(COALESCE(hotel_pincode, ''))), 'B')
$$;

CREATE INDEX "Location_normalizedName_trgm_idx"
ON "Location" USING GIN ("normalizedName" public.gin_trgm_ops);

CREATE INDEX "LocationAlias_normalizedAlias_trgm_idx"
ON "LocationAlias" USING GIN ("normalizedAlias" public.gin_trgm_ops);

CREATE INDEX "Hotel_name_trgm_idx"
ON "Hotel" USING GIN (public.waystay_normalize("name") public.gin_trgm_ops);

CREATE INDEX "Hotel_address_trgm_idx"
ON "Hotel" USING GIN (public.waystay_normalize("address") public.gin_trgm_ops);

CREATE INDEX "Hotel_city_trgm_idx"
ON "Hotel" USING GIN (public.waystay_normalize("city") public.gin_trgm_ops);

CREATE INDEX "Hotel_state_trgm_idx"
ON "Hotel" USING GIN (public.waystay_normalize("state") public.gin_trgm_ops);

CREATE INDEX "Hotel_search_fts_idx"
ON "Hotel" USING GIN (
  public.waystay_hotel_search_vector("name", "address", "city", "state", "pincode")
);
