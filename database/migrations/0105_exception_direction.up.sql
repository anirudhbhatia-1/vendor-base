-- 9.8: an exception's history says who spoke and what operations told the
-- partner to do.
--
-- Until audit run 63 a resolution row carried only its state: an operator's
-- "return it to the store" was indistinguishable from a partner's own "I
-- tried again" except by which states each may write, and the instruction
-- itself had nowhere to live -- the partner read a word, or nothing.

ALTER TABLE marketplace.partner_exception_events
  ADD COLUMN actor_kind text,
  ADD COLUMN actor_id uuid,
  ADD COLUMN instruction text,
  ADD CONSTRAINT partner_exception_actor_kind_allowed CHECK
    (actor_kind IS NULL OR actor_kind IN ('delivery_partner', 'admin', 'system')),
  ADD CONSTRAINT partner_exception_actor_shape CHECK
    ((actor_kind IS NULL) = (actor_id IS NULL)),
  ADD CONSTRAINT partner_exception_instruction_shape CHECK
    (instruction IS NULL OR length(instruction) BETWEEN 1 AND 500);
