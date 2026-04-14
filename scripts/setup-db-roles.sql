-- =============================================================================
-- PostgreSQL: Настройка ролей для защиты от удаления данных
-- =============================================================================
-- Запускать под суперюзером на production.
--
-- Два юзера:
--   delovoy_app    — для приложения (SELECT, INSERT, UPDATE, без DELETE на критичных таблицах)
--   delovoy_admin  — для миграций (полные права)
-- =============================================================================

-- 1. Создаём роли (если не существуют)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'delovoy_app') THEN
    CREATE ROLE delovoy_app WITH LOGIN PASSWORD 'CHANGE_ME_APP_PASSWORD';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'delovoy_admin') THEN
    CREATE ROLE delovoy_admin WITH LOGIN PASSWORD 'CHANGE_ME_ADMIN_PASSWORD';
  END IF;
END
$$;

-- 2. delovoy_admin — полные права
GRANT ALL PRIVILEGES ON DATABASE delovoy_park TO delovoy_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO delovoy_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO delovoy_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO delovoy_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO delovoy_admin;

-- 3. delovoy_app — SELECT, INSERT, UPDATE (без DELETE)
GRANT USAGE ON SCHEMA public TO delovoy_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO delovoy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO delovoy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO delovoy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO delovoy_app;

-- 4. DELETE разрешаем только на таблицах где Prisma делает cascade/cleanup
GRANT DELETE ON "Session" TO delovoy_app;
GRANT DELETE ON "VerificationToken" TO delovoy_app;
GRANT DELETE ON "Account" TO delovoy_app;
GRANT DELETE ON "AdminPermission" TO delovoy_app;

-- 5. Trigger на критичных таблицах — логируем попытки DELETE
CREATE OR REPLACE FUNCTION prevent_delete_and_log()
RETURNS TRIGGER AS $$
BEGIN
  RAISE WARNING 'DELETE attempted on protected table % by %. Use soft delete (SET deletedAt) instead.',
    TG_TABLE_NAME, current_user;
  RETURN NULL; -- Отменяем DELETE
END;
$$ LANGUAGE plpgsql;

-- Применяем trigger к критичным таблицам
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['Booking', 'Resource', 'Order', 'MenuItem', 'RentalContract', 'Tenant', 'FinancialTransaction']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS prevent_delete_%I ON %I; CREATE TRIGGER prevent_delete_%I BEFORE DELETE ON %I FOR EACH ROW WHEN (current_user = ''delovoy_app'') EXECUTE FUNCTION prevent_delete_and_log()',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END
$$;

-- =============================================================================
-- Использование:
--   DATABASE_URL      → postgresql://delovoy_app:password@host/delovoy_park
--   DATABASE_URL_ADMIN → postgresql://delovoy_admin:password@host/delovoy_park
-- =============================================================================
