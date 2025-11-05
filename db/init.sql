CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    source text NOT NULL check (source IN ('internal', 'external')),
    ref_id VARCHAR(100),
    description TEXT,
    data JSONB NOT NULL DEFAULT '{}'::JSONB,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    location_name TEXT,
    location_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT events_external_unique UNIQUE (source, ref_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_events_natural_all
ON events (
  lower(btrim(title)),
  starts_at,
  ends_at,
  round(latitude::numeric, 5),
  round(longitude::numeric, 5)
);

CREATE INDEX IF NOT EXISTS ix_events_starts_at  ON events(starts_at);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, event_id)
);

-- Comments table: store user comments for events
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure a simple mock user exists for development
INSERT INTO users (username, password_hash)
SELECT 'mockuser', 'mock-password'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'mockuser');