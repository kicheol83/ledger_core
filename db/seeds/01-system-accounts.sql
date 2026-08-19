

INSERT INTO accounts (type, currency, user_id)
VALUES
    ('SYSTEM', 'UZS', NULL),
    ('SYSTEM', 'KRW', NULL),
    ('SYSTEM', 'USD', NULL)
ON CONFLICT DO NOTHING;

SELECT id, type, currency, status FROM accounts WHERE type = 'SYSTEM' ORDER BY currency;
