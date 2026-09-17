# Native authentication migration TODO

`POST /auth/password/verify` is deprecated and retained only for existing native clients that
still authenticate with a phone identifier and password. It is not used by any web application.

Before removing the endpoint:

1. inventory native releases that still call it;
2. move role-based native users to Supabase email/password and customers to OTP sessions;
3. verify active native versions no longer send password-verification traffic;
4. announce and enforce a removal release; and
5. remove password credentials and the endpoint in a reviewed, reversible migration.

The endpoint returns the standard HTTP `Deprecation: true` and `Warning: 299` headers. No removal
date is advertised until the native-client inventory has been completed.
