-- Only daily aggregate counts. No IP address, visitor ID, page URL or precise location.
CREATE TABLE IF NOT EXISTS daily_pageviews (
    day_jst TEXT NOT NULL CHECK (length(day_jst) = 10),
    prefecture TEXT NOT NULL CHECK (length(prefecture) BETWEEN 1 AND 16),
    views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (day_jst, prefecture)
) WITHOUT ROWID;
