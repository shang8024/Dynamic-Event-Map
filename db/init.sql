CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    google_id VARCHAR(255) UNIQUE,
    picture VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100) DEFAULT 'Other',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_natural_all ON events (
    lower(btrim(title)),
    starts_at,
    ends_at,
    round(latitude::numeric, 5),
    round(longitude::numeric, 5)
);
CREATE INDEX IF NOT EXISTS ix_events_starts_at ON events(starts_at);
CREATE TABLE IF NOT EXISTS bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, event_id)
);
-- Comments table: store user comments for events
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Create a system user for external event imports
INSERT INTO profiles (username, password_hash)
VALUES ('system', 'system-password') ON CONFLICT (username) DO NOTHING;