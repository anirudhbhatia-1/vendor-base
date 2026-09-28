DELETE FROM marketplace.role_capabilities
 WHERE capability_key = 'admin.control.dashboard_read'
   AND role_key IN ('DELIVERY_OPERATOR','CATALOGUE_MODERATOR','VENDOR_ONBOARDING_OPERATOR',
                    'VENDOR_ONBOARDING_REVIEWER','VENDOR_PUBLICATION_OPERATOR',
                    'VENDOR_PUBLICATION_REVIEWER');
