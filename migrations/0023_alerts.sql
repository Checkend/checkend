-- Migration 0023: alert channels on webhooks (Slack, Discord, GitHub issues, email) and spikes.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- recipients: email addresses (JSON) for the email format. spike_threshold: issue.spike fires
-- when the events of an issue in the current hour go above it. webhook_deliveries.data: extra
-- facts of a delivery (the spike count).

ALTER TABLE webhooks ADD COLUMN recipients TEXT;
ALTER TABLE webhooks ADD COLUMN spike_threshold INTEGER;
ALTER TABLE webhook_deliveries ADD COLUMN data TEXT;
