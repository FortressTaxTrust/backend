CREATE TYPE relationship_enum AS ENUM ('spouse', 'child', 'dependent');
CREATE TYPE user_type_enum AS ENUM ('client', 'prospect');
CREATE TYPE subscription_status_enum AS ENUM ('active', 'canceled', 'paused', 'expired');
CREATE TYPE case_study_status_enum AS ENUM ('draft', 'completed');

CREATE TABLE user_type (
    id BIGSERIAL PRIMARY KEY,
    type user_type_enum NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NULL,
    personal_documents JSON,
    paid_status BOOLEAN DEFAULT FALSE,
    user_type_id BIGINT REFERENCES user_type(id),
    related_to_user_id BIGINT REFERENCES users(id),
    relationship_type relationship_enum,
    cognito_id TEXT NOT NULL UNIQUE,
    secondary_email TEXT,
    fax TEXT,
    ssn TEXT UNIQUE,
    important_notes TEXT,
    date_of_birth DATE,
    phone TEXT,
    mailing_street TEXT,
    mailing_city TEXT,
    mailing_state TEXT,
    mailing_zip TEXT,
    mailing_country TEXT,
    signup TEXT DEFAULT 'incomplete' NOT NULL,
    confirmation_status TEXT DEFAULT 'not-confirmed' NOT NULL,
    signup_draft JSON, 
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) NOT NULL,
    zoho_account_id BIGINT NULL,
    account_name TEXT NOT NULL,
    account_type TEXT,
    description TEXT,
    client_note TEXT,
    phone TEXT,
    fax TEXT,
    billing_street TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_country TEXT,
    billing_code TEXT,
    work_drive_link TEXT,
    overseer_officer TEXT,
    tin TEXT,
    trustee TEXT,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    date_created TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    prospect_folder_link TEXT
);

CREATE TABLE subscription (
    id BIGSERIAL PRIMARY KEY,
    square_plan_id TEXT NULL,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NULL,
    duration_days INTEGER NULL,
    metadata JSON,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE user_subscription (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) NOT NULL,
    subscription_id BIGINT REFERENCES subscription(id) NOT NULL,
    square_subscription_id TEXT,
    dtu TIMESTAMPTZ,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    status subscription_status_enum NOT NULL,
    raw_square_payload JSON,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE folders (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    user_id BIGINT REFERENCES users(id) NULL,
    account_id BIGINT REFERENCES accounts(id) NULL,
    parent_id BIGINT REFERENCES folders(id) NULL,
    metadata JSONB,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    folder_id BIGINT REFERENCES folders(id) NULL,
    user_id BIGINT REFERENCES users(id) NULL,
    account_id BIGINT REFERENCES accounts(id) NULL,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    metadata JSON,
    upload_status TEXT DEFAULT 'pending' NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE case_studies (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content JSONB NOT NULL,
    status case_study_status_enum NOT NULL,
    metadata JSONB,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE document_upload_logs (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES documents(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    user_id BIGINT,
    account_id BIGINT,
    suggested_path TEXT,
    category TEXT,
    confidence NUMERIC(3,2),
    status TEXT DEFAULT 'pending', -- pending | completed | failed
    reasoning TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO user_type (type, enabled) VALUES ('prospect', TRUE), ('client', TRUE);
ALTER TABLE accounts ALTER COLUMN user_id DROP NOT NULL;
CREATE TABLE accounts_users (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    permissions JSONB,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (user_id, account_id)
);

ALTER TABLE user_subscription ADD COLUMN cancel_at_period_end BOOLEAN DEFAULT FALSE NOT NULL, ADD COLUMN no_expiry BOOLEAN DEFAULT FALSE, ADD COLUMN last_payment_status TEXT NULL, ADD COLUMN last_payment_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS square_customers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    square_customer_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (user_id, square_customer_id)
);
CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    square_payment_id TEXT UNIQUE,
    amount NUMERIC(12,2),
    currency CHAR(3),
    status TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT,
    square_entity_id TEXT,
    payload JSONB,
    received_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_square_customers_user_id ON square_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscription_square_id ON user_subscription(square_subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
CREATE TABLE payment_methods (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  square_card_id TEXT NOT NULL, 
  last_4 TEXT,
  brand TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN DEFAULT FALSE,
  metadata JSONB NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE subscription ADD COLUMN benefits TEXT[];
ALTER TABLE accounts DROP COLUMN IF EXISTS user_id;
DROP TYPE subscription_status_enum CASCADE;
