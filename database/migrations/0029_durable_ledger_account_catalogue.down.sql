ALTER TABLE marketplace.ledger_accounts
  ADD CONSTRAINT ledger_accounts_vendor_location_id_fkey
    FOREIGN KEY (vendor_location_id) REFERENCES marketplace.vendor_locations (vendor_location_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT ledger_accounts_partner_user_id_fkey
    FOREIGN KEY (partner_user_id) REFERENCES marketplace.users (user_id)
    ON DELETE RESTRICT;
