-- Phase 11 exit gate: support proposes a protected refund and finance
-- approves it (implementation.md §13.2 scenario 11; PRD 7.3 "support may
-- propose but not solely approve").
--
-- Until audit run 82 only finance operators could propose a refund, so a
-- support agent resolving a customer's case had no way to start one: the
-- case's REFUNDED resolution needs an approved refund on the order, and the
-- person who owns the case could not ask for it. Approval stays with finance
-- approvers, and a refund is never approved by the person who proposed it.
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('SUPPORT_AGENT', 'admin.finance.refund_propose')
ON CONFLICT DO NOTHING;
