CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    source text NOT NULL check (source IN ('internal', 'external')),
    ref_id VARCHAR(100),
    description TEXT,
    data JSONB NOT NULL DEFAULT '{}'::JSONB,
    starts_at TIMESTAMP,
    ends_at TIMESTAMP,
    location_name TEXT,
    location_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    calendar_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT events_external_unique UNIQUE (source, ref_id)
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INT,
    external_source TEXT,
    external_ref_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bookmarks_one_target CHECK (
        (event_id IS NOT NULL AND external_source IS NULL AND external_ref_id IS NULL)
        OR
        (event_id IS NULL AND external_source IS NOT NULL AND external_ref_id IS NOT NULL)
    ),
    CONSTRAINT bookmarks_unique_internal UNIQUE (user_id, event_id),
    CONSTRAINT bookmarks_unique_external UNIQUE (user_id, external_source, external_ref_id)
);