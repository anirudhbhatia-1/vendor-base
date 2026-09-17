-- A configuration version cannot be deleted — the history is append-only and
-- the lifecycle trigger only permits moving forward — so retiring the policy
-- means superseding it, which is what retiring one means in this model anyway.
UPDATE marketplace.configuration_versions
   SET status = 'SUPERSEDED',
       effective_until = effective_from + interval '1 second',
       superseded_at = clock_timestamp(),
       updated_at = clock_timestamp()
 WHERE configuration_key = 'finance.financial_policy'
   AND scope_kind = 'GLOBAL' AND scope_reference = 'global'
   AND status = 'ACTIVE';
