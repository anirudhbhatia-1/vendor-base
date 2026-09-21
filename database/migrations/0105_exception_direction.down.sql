ALTER TABLE marketplace.partner_exception_events
  DROP CONSTRAINT partner_exception_instruction_shape,
  DROP CONSTRAINT partner_exception_actor_shape,
  DROP CONSTRAINT partner_exception_actor_kind_allowed,
  DROP COLUMN instruction,
  DROP COLUMN actor_id,
  DROP COLUMN actor_kind;
