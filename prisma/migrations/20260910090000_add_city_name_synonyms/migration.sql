-- Alternate, historic and colloquial city names travellers type into the route search.
--
-- These cannot be reached by fuzzy matching: "Madras" and "Chennai" share no trigrams and
-- sit nine edits apart, so the only way a search for one finds the other is to record it.
-- Joined on "normalizedName" rather than hard-coded ids because city rows are created with
-- MD5-derived ids by the canonical-locations migration.

INSERT INTO "LocationAlias" ("id", "alias", "normalizedAlias", "locationId")
SELECT
  CONCAT('alias_syn_', MD5(CONCAT(synonym.alias, '|', location."id"))),
  synonym.alias,
  synonym.normalized_alias,
  location."id"
FROM (
  VALUES
    ('Madras', 'madras', 'chennai'),
    ('New Delhi', 'new delhi', 'delhi'),
    ('Dilli', 'dilli', 'delhi'),
    ('Delhi NCR', 'delhi ncr', 'delhi'),
    ('NCR', 'ncr', 'delhi'),
    ('Panaji', 'panaji', 'goa'),
    ('Panjim', 'panjim', 'goa'),
    ('Secunderabad', 'secunderabad', 'hyderabad'),
    ('Bhagyanagar', 'bhagyanagar', 'hyderabad'),
    ('Pink City', 'pink city', 'jaipur'),
    ('Cochin', 'cochin', 'kochi'),
    ('Ernakulam', 'ernakulam', 'kochi'),
    ('Lakhnau', 'lakhnau', 'lucknow'),
    ('Poona', 'poona', 'pune')
) AS synonym(alias, normalized_alias, city_normalized_name)
JOIN "Location" location
  ON location."normalizedName" = synonym.city_normalized_name
 AND location."type" = 'CITY'
ON CONFLICT ("normalizedAlias", "locationId") DO NOTHING;
