-- Phase 7.7: the one group summary state that had no words.
--
-- A checkout group's state is derived from its orders at read time
-- (processing, partially accepted, active, partially completed, completed,
-- partially cancelled, cancelled). Six of the seven had labels since 0049;
-- the seventh -- some shops have accepted, others have not answered yet --
-- had none, because nothing derived it.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('state.partially_accepted', 'customer', 'SHARED', 'Lifecycle state label: PARTIALLY_ACCEPTED')
ON CONFLICT DO NOTHING;
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('state.partially_accepted', 'en', 'Some stores confirmed'),
  ('state.partially_accepted', 'hi', 'कुछ दुकानों ने पुष्टि की')
ON CONFLICT DO NOTHING;
