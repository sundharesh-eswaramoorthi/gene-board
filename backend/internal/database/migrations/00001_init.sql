-- +goose Up
-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- +goose StatementEnd

CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,          -- always stored lower-cased
    name          TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key           TEXT        NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    type          TEXT        NOT NULL DEFAULT 'scrum' CHECK (type IN ('scrum', 'kanban')),
    lead_id       BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    issue_counter BIGINT      NOT NULL DEFAULT 0,       -- last issued number; used to build issue keys
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
    project_id BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       TEXT        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

-- Workflow statuses == board columns, per project.
CREATE TABLE statuses (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    category   TEXT        NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
    position   INTEGER     NOT NULL,
    wip_limit  INTEGER     CHECK (wip_limit IS NULL OR wip_limit > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX statuses_project_name_idx ON statuses (project_id, lower(name));
CREATE INDEX statuses_project_position_idx ON statuses (project_id, position);

CREATE TABLE labels (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    color      TEXT        NOT NULL DEFAULT '#6B778C' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX labels_project_name_idx ON labels (project_id, lower(name));

CREATE TABLE sprints (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id   BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    goal         TEXT        NOT NULL DEFAULT '',
    state        TEXT        NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'completed')),
    start_date   DATE,
    end_date     DATE,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX sprints_project_idx ON sprints (project_id, state);
-- At most one active sprint per project.
CREATE UNIQUE INDEX sprints_one_active_idx ON sprints (project_id) WHERE state = 'active';

CREATE TABLE issues (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id   BIGINT           NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    number       BIGINT           NOT NULL,
    key          TEXT             NOT NULL UNIQUE,      -- "<PROJECT KEY>-<number>", immutable
    type         TEXT             NOT NULL CHECK (type IN ('epic', 'story', 'task', 'bug', 'subtask')),
    summary      TEXT             NOT NULL,
    description  TEXT             NOT NULL DEFAULT '',  -- Markdown
    status_id    BIGINT           NOT NULL REFERENCES statuses (id) ON DELETE RESTRICT,
    priority     TEXT             NOT NULL DEFAULT 'medium'
                                  CHECK (priority IN ('highest', 'high', 'medium', 'low', 'lowest')),
    assignee_id  BIGINT           REFERENCES users (id) ON DELETE SET NULL,
    reporter_id  BIGINT           REFERENCES users (id) ON DELETE SET NULL,
    parent_id    BIGINT           REFERENCES issues (id) ON DELETE SET NULL,
    sprint_id    BIGINT           REFERENCES sprints (id) ON DELETE SET NULL,
    story_points DOUBLE PRECISION CHECK (story_points IS NULL OR (story_points >= 0 AND story_points <= 1000)),
    due_date     DATE,
    rank         TEXT COLLATE "C" NOT NULL,             -- fractional index; byte-wise ordering
    resolved_at  TIMESTAMPTZ,                           -- set while status category = 'done'
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    UNIQUE (project_id, number)
);
CREATE INDEX issues_project_rank_idx ON issues (project_id, rank);
CREATE INDEX issues_status_idx ON issues (status_id);
CREATE INDEX issues_sprint_idx ON issues (sprint_id);
CREATE INDEX issues_parent_idx ON issues (parent_id);
CREATE INDEX issues_assignee_idx ON issues (assignee_id);
CREATE INDEX issues_reporter_idx ON issues (reporter_id);
CREATE INDEX issues_updated_idx ON issues (project_id, updated_at DESC);
CREATE INDEX issues_summary_trgm_idx ON issues USING gin (summary gin_trgm_ops);

CREATE TABLE issue_labels (
    issue_id BIGINT NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    label_id BIGINT NOT NULL REFERENCES labels (id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, label_id)
);
CREATE INDEX issue_labels_label_idx ON issue_labels (label_id);

CREATE TABLE issue_links (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type       TEXT        NOT NULL CHECK (type IN ('blocks', 'relates', 'duplicates', 'clones')),
    source_id  BIGINT      NOT NULL REFERENCES issues (id) ON DELETE CASCADE,  -- outward side ("GB-1 blocks GB-2": source = GB-1)
    target_id  BIGINT      NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    created_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source_id <> target_id),
    UNIQUE (type, source_id, target_id)
);
CREATE INDEX issue_links_target_idx ON issue_links (target_id);

CREATE TABLE comments (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_id   BIGINT      NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    author_id  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_issue_idx ON comments (issue_id, created_at);

-- Audit / history log. issue_key is denormalised so history survives issue deletion.
CREATE TABLE activities (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id BIGINT      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    issue_id   BIGINT      REFERENCES issues (id) ON DELETE SET NULL,
    issue_key  TEXT,
    actor_id   BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    action     TEXT        NOT NULL,
    field      TEXT,
    old_value  TEXT,
    new_value  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activities_project_idx ON activities (project_id, created_at DESC);
CREATE INDEX activities_issue_idx ON activities (issue_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS issue_links;
DROP TABLE IF EXISTS issue_labels;
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS sprints;
DROP TABLE IF EXISTS labels;
DROP TABLE IF EXISTS statuses;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
