-- Sloppy D1 schema.
--
-- Tags are stored as (post, author, tag, install, ts) TUPLES rather than as
-- counters. That is the one piece of scale insurance worth paying for now: it
-- costs nothing today and it means trust weighting, decay curves and
-- reporter-reputation can all be computed retroactively, off data already
-- collected, instead of requiring a schema migration and a cold start.

CREATE TABLE IF NOT EXISTS tags (
  post_id     TEXT    NOT NULL,
  author_id   TEXT,
  author_kind TEXT    NOT NULL DEFAULT 'unknown',
  site        TEXT    NOT NULL,
  tag         TEXT    NOT NULL,
  install_id  TEXT    NOT NULL,
  text_hash   TEXT    NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (post_id, install_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tags_author_ts ON tags (author_id, ts);
CREATE INDEX IF NOT EXISTS idx_tags_ts        ON tags (ts);
CREATE INDEX IF NOT EXISTS idx_tags_site_ts   ON tags (site, ts);
CREATE INDEX IF NOT EXISTS idx_tags_install   ON tags (install_id, ts);
-- Identical text posted by many accounts is the repost / karma-farm signal,
-- and it is computable without the server ever holding the text.
CREATE INDEX IF NOT EXISTS idx_tags_hash      ON tags (text_hash);

-- Proposed by the nightly rollup, rebuilt wholesale each run. NOT served to
-- anyone: crossing a threshold makes you a candidate, nothing more.
CREATE TABLE IF NOT EXISTS author_candidates (
  author_id          TEXT    NOT NULL,
  site               TEXT    NOT NULL,
  kind               TEXT    NOT NULL DEFAULT 'unknown',
  tag                TEXT    NOT NULL,
  flagged_posts      INTEGER NOT NULL,
  distinct_reporters INTEGER NOT NULL,
  window_end         INTEGER NOT NULL,
  PRIMARY KEY (author_id, site)
);

CREATE INDEX IF NOT EXISTS idx_candidates_site ON author_candidates (site);

-- Approved authors. This is what the snapshot serves, and NOTHING writes to it
-- automatically - a row appears here only because a person put it here.
--
-- Promoting an author hides everything they post for everyone subscribed to
-- that tag. It is the one action in this system that can damage somebody's
-- livelihood, and it does not happen because a counter crossed a threshold.
CREATE TABLE IF NOT EXISTS authors (
  author_id          TEXT    NOT NULL,
  site               TEXT    NOT NULL,
  kind               TEXT    NOT NULL DEFAULT 'unknown',
  tag                TEXT    NOT NULL,
  flagged_posts      INTEGER NOT NULL,
  distinct_reporters INTEGER NOT NULL,
  window_end         INTEGER NOT NULL,
  approved_at        INTEGER,
  approved_by        TEXT,
  note               TEXT,
  PRIMARY KEY (author_id, site)
);

CREATE INDEX IF NOT EXISTS idx_authors_site ON authors (site);

-- Decisions, including rejections and appeals upheld. Sticky on purpose: a
-- rejected candidate that reappeared every night would guarantee that somebody
-- eventually approves it by accident, and an appeal that had to be re-argued
-- every time the rollup ran would not be an appeal at all.
CREATE TABLE IF NOT EXISTS author_decisions (
  author_id  TEXT    NOT NULL,
  site       TEXT    NOT NULL,
  decision   TEXT    NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at INTEGER NOT NULL,
  decided_by TEXT,
  note       TEXT,
  PRIMARY KEY (author_id, site)
);

-- A custom tag stays private to the person who coined it until enough distinct
-- installs have independently used it. Without this, one user inventing
-- "corporate-mad-libs" would push a tag into everybody else's settings screen.
CREATE TABLE IF NOT EXISTS tag_promotions (
  tag              TEXT PRIMARY KEY,
  distinct_installs INTEGER NOT NULL,
  promoted_at      INTEGER
);
