# Data classification, consent, retention, and deletion

**Scope:** company-local synthetic environment. Real personal data remains prohibited.

| Data class | Purpose | Permitted viewers | Consent/legal basis | Company-test retention | Deletion procedure |
|---|---|---|---|---|---|
| Synthetic customer identity/profile | Authentication and preferences | Customer; scoped support admin | Explicit test participation | 30 days after last session | Revoke sessions, remove optional profile/preferences, retain redacted financial/audit references |
| Synthetic address/location | Serviceability and fulfilment rehearsal | Customer; assigned order actors only | Explicit address save | Active order + 30 days | Deactivate address; purge coordinates after obligations close |
| Vendor/partner evidence references | Eligibility rehearsal | Applicant; assigned reviewer | Explicit submission | Case closure + 90 days | Delete protected object, retain checksum/review outcome |
| Order/custody history | Fulfilment and dispute evidence | Owning customer/vendor/partner; scoped admin | Contract rehearsal | 180 days | Anonymize optional notes; immutable transition facts remain |
| Financial ledger and reconciliation | Conservation and audit | Finance-scoped admins; owning statement recipient | Contract rehearsal | 7 years in production; 180 days locally | Never mutate ledger; detach synthetic identity during test reset |
| Support/trust/incident evidence | Resolution and safety | Assigned support/trust roles | Operational necessity | 180 days after closure | Protected evidence deletion; immutable action metadata remains |
| Analytics events | Funnel and reliability measurement | Product/operations aggregate readers | Test participation | 90 days | Delete user-linked events or irreversibly aggregate |

Deletion requests must be authenticated, recorded as an auditable support case, checked for open orders, custody, disputes and legal holds, then executed by a separate approver. Local resets may erase all synthetic records. Production periods require legal approval before activation.
