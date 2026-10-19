-- Only daily aggregate counts. No IP address, visitor ID, page URL or precise location.
CREATE TABLE IF NOT EXISTS daily_pageviews (
    day_jst TEXT NOT NULL CHECK (length(day_jst) = 10),
    prefecture TEXT NOT NULL CHECK (length(prefecture) BETWEEN 1 AND 16),
    views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (day_jst, prefecture)
) WITHOUT ROWID;

-- Browser-side daily deduplication; only aggregate counts reach this table.
CREATE TABLE IF NOT EXISTS daily_unique_browsers (
    day_jst TEXT NOT NULL CHECK (length(day_jst) = 10),
    prefecture TEXT NOT NULL CHECK (length(prefecture) BETWEEN 1 AND 16),
    browsers INTEGER NOT NULL DEFAULT 0 CHECK (browsers >= 0),
    PRIMARY KEY (day_jst, prefecture)
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS daily_access_summary AS
SELECT p.day_jst, p.prefecture, p.views, COALESCE(u.browsers, 0) AS unique_browsers
FROM daily_pageviews p
LEFT JOIN daily_unique_browsers u USING (day_jst, prefecture)
UNION ALL
SELECT u.day_jst, u.prefecture, 0 AS views, u.browsers AS unique_browsers
FROM daily_unique_browsers u
WHERE NOT EXISTS (
    SELECT 1 FROM daily_pageviews p
    WHERE p.day_jst = u.day_jst AND p.prefecture = u.prefecture
);
