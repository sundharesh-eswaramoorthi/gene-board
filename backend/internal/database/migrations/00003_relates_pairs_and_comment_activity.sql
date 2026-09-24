-- Two guards around issue links and the activity log.
--
-- "relates" links are symmetric, so B relates A duplicates A relates B (SPEC §5 Links: 409).
-- The service checks both directions, but two requests linking one pair from opposite sides
-- at the same moment both passed that check. This index makes the later insert fail with a
-- unique violation (409). Pairs linked twice before it existed keep their older link.
--
-- comment.created rows now reference their comment, and the activity lists show a preview of
-- the comment's current body (queries/activities.sql). An edited comment's old text and a
-- deleted comment's text (also when its issue is deleted) are then no longer readable in the
-- history, so the previews these rows stored are removed.

-- +goose Up
DELETE FROM issue_links l
USING issue_links o
WHERE l.type = 'relates' AND o.type = 'relates'
  AND l.source_id = o.target_id AND l.target_id = o.source_id
  AND l.id > o.id;
CREATE UNIQUE INDEX issue_links_relates_pair_idx
    ON issue_links (LEAST(source_id, target_id), GREATEST(source_id, target_id))
    WHERE type = 'relates';

ALTER TABLE activities ADD COLUMN comment_id BIGINT REFERENCES comments (id) ON DELETE SET NULL;
CREATE INDEX activities_comment_idx ON activities (comment_id) WHERE comment_id IS NOT NULL;
-- A comment and its comment.created row are written in one transaction (or backdated
-- together by the seed), so they carry the same created_at.
UPDATE activities a
SET comment_id = c.id
FROM comments c
WHERE a.action = 'comment.created'
  AND c.issue_id = a.issue_id
  AND c.created_at = a.created_at
  AND c.author_id IS NOT DISTINCT FROM a.actor_id;
UPDATE activities SET new_value = NULL WHERE action = 'comment.created';

-- +goose Down
UPDATE activities a SET new_value = left(c.body, 200) FROM comments c WHERE c.id = a.comment_id;
ALTER TABLE activities DROP COLUMN comment_id;
DROP INDEX issue_links_relates_pair_idx;
