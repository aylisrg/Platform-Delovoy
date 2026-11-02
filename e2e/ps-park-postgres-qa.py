"""Local PostgreSQL invariants only; does not run the Prisma application.

Requires the disposable, network-isolated container play-park-local-qa,
database play_park_qa, and the repository's SQL migrations applied via psql.
Run: python3 e2e/ps-park-postgres-qa.py
The container is disposable; this script never connects to a host DB.
"""
import concurrent.futures
import subprocess
import time
import uuid

CMD = ["docker", "-H", "unix:///var/run/docker.sock", "exec", "-i",
       "play-park-local-qa", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
       "-U", "postgres", "-d", "play_park_qa"]
prefix = "local-qa-" + uuid.uuid4().hex
passed = 0


def sql(statement, check=True):
    result = subprocess.run(CMD, input=statement, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def scalar(statement):
    return sql(statement).stdout.strip()


def ok(name):
    global passed
    passed += 1
    print("PASS " + name, flush=True)


def parallel(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(lambda s: sql(s, check=False), statements))


assert scalar("SELECT current_database()") == "play_park_qa"
assert subprocess.check_output([
    "docker", "-H", "unix:///var/run/docker.sock", "inspect", "--format",
    "{{.HostConfig.NetworkMode}}", "play-park-local-qa"
], text=True).strip() == "none"


def payment(pid, key, provider="NULL"):
    return f'''INSERT INTO "Payment" (id,"subjectType","subjectId","moduleSlug",amount,
      description,"idempotenceKey","providerPaymentId","updatedAt")
      VALUES ('{pid}','BOOKING','{prefix}-booking','ps-park',1000,
      'Local QA fixture','{key}',{provider},now());'''


key = prefix + "-same-key"
results = parallel([payment(prefix + "-payment-a", key), payment(prefix + "-payment-b", key)])
assert sorted(r.returncode for r in results) == [0, 3]
assert 'Payment_idempotenceKey_key' in next(r.stderr for r in results if r.returncode)
assert scalar(f'''SELECT count(*) FROM "Payment" WHERE "idempotenceKey"='{key}' ''') == "1"
ok("concurrent Payment inserts keep one idempotence key")

provider = prefix + "-provider"
sql(payment(prefix + "-provider-a", prefix + "-key-a", f"'{provider}'"))
result = sql(payment(prefix + "-provider-b", prefix + "-key-b", f"'{provider}'"), check=False)
assert result.returncode and "Payment_providerPaymentId_key" in result.stderr
ok("providerPaymentId uniqueness")

lock_key = prefix + ":ps-park:table:2030-01-10"
holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtext('{lock_key}')::bigint);\n\\echo LOCKED\nSELECT pg_sleep(2); COMMIT;\n")
holder.stdin.close()
while holder.stdout.readline().strip() != "LOCKED":
    if holder.poll() is not None:
        raise AssertionError("lock holder exited")
start = time.monotonic()
assert scalar(f"SELECT pg_try_advisory_xact_lock(hashtext('{lock_key}:gazebos')::bigint)") == "t"
assert scalar(f"SELECT pg_try_advisory_xact_lock(hashtext('{lock_key}')::bigint)") == "f"
sql(f"BEGIN; SELECT pg_advisory_xact_lock(hashtext('{lock_key}')::bigint); COMMIT;")
assert time.monotonic() - start > 1
assert holder.wait() == 0
ok("same slot serializes; independent module key does not share the lock")


def booking(bid, module="ps-park", start="10:00", end="12:00"):
    return f'''INSERT INTO "Booking" (id,"moduleSlug","resourceId",date,"startTime","endTime","updatedAt")
    VALUES ('{bid}','{module}','{prefix}-table','2030-01-10','2030-01-10 {start}',
    '2030-01-10 {end}',now());'''


results = parallel([booking(prefix + "-booking"), booking(prefix + "-overlap")])
assert sorted(r.returncode for r in results) == [0, 3]
rejected = next(r.stderr for r in results if r.returncode)
# Concurrent exclusion-index inserts can also be resolved by PostgreSQL's
# deadlock detector (40P01). Both reject one writer and retain a single slot.
assert "booking_no_overlap" in rejected or "40P01" in rejected, rejected
assert scalar(f'''SELECT count(*) FROM "Booking" WHERE "resourceId"='{prefix}-table' ''') == "1"
ok("concurrent overlapping PENDING bookings rejected by database")
sql(booking(prefix + "-gazebo", module="gazebos"))
sql(booking(prefix + "-adjacent", start="12:00", end="13:00"))
ok("gazebo scope and adjacent half-open slot remain independent")
sql(f'''UPDATE "Booking" SET status='CANCELLED' WHERE "moduleSlug"='ps-park'
        AND "resourceId"='{prefix}-table' AND "startTime"='2030-01-10 10:00';''')
sql(booking(prefix + "-replacement"))
ok("cancelled reservation releases its slot")

pid = scalar(f'''SELECT id FROM "Payment" WHERE "idempotenceKey"='{key}' ''')
cas = f'''WITH applied AS (
 UPDATE "Payment" SET status='SUCCEEDED' WHERE id='{pid}' AND status IN ('PENDING','WAITING_FOR_CAPTURE')
 RETURNING id,amount
) INSERT INTO "FinancialTransaction" (id,"moduleSlug",type,"bookingId","totalAmount",
 "performedById","performedByName",description)
 SELECT '{prefix}-ledger','ps-park','ONLINE_PAYMENT','{prefix}-replacement',amount,
 'local-qa','QA','Local QA fixture' FROM applied;'''
results = parallel([cas, cas])
assert all(r.returncode == 0 for r in results)
assert scalar(f'''SELECT count(*) FROM "FinancialTransaction" WHERE id='{prefix}-ledger' ''') == "1"
assert scalar(f'''SELECT "totalAmount"=1000 FROM "FinancialTransaction" WHERE id='{prefix}-ledger' ''') == "t"
ok("concurrent payment CAS admits one ledger insert")

rollback_id = prefix + "-rollback"
sql(payment(rollback_id, rollback_id + "-key"))
result = sql(f'''BEGIN; UPDATE "Payment" SET status='SUCCEEDED' WHERE id='{rollback_id}';
 INSERT INTO "FinancialTransaction" (id,"moduleSlug",type,"totalAmount","performedById","performedByName",description)
 VALUES ('{rollback_id}','ps-park','ONLINE_PAYMENT',1000,'qa','QA','Rollback fixture');
 SELECT 1/0; COMMIT;''', check=False)
assert result.returncode != 0
assert scalar(f'''SELECT status FROM "Payment" WHERE id='{rollback_id}' ''') == "PENDING"
assert scalar(f'''SELECT count(*) FROM "FinancialTransaction" WHERE id='{rollback_id}' ''') == "0"
ok("payment and ledger roll back together on transaction failure")

# Actual PostgreSQL row-lock protocol used by the reservation success handler.
# Exercise both orders against a concurrent manager cancellation. This is still
# SQL protocol QA, not execution of the Prisma service.
for first in ("payment", "cancel"):
    bid = prefix + "-credit-race-" + first
    sql(booking(bid, start="16:00" if first == "payment" else "17:00", end="17:00" if first == "payment" else "18:00"))
    cancel = f'''UPDATE "Booking" SET status='CANCELLED' WHERE id='{bid}';'''
    lock = f'''SELECT 1 FROM "Booking" WHERE id='{bid}' FOR UPDATE;'''
    credit = f'''UPDATE "Booking" SET
        status=CASE WHEN status='PENDING' THEN 'CONFIRMED'::"BookingStatus" ELSE status END,
        metadata=jsonb_build_object('onlinePaidAmount','1000.00') WHERE id='{bid}';
        INSERT INTO "FinancialTransaction" (id,"moduleSlug",type,"bookingId","totalAmount","performedById","performedByName",description)
        VALUES ('{bid}-ledger','ps-park','ONLINE_PAYMENT','{bid}',1000,'qa','QA','Credit race fixture');'''
    holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write("BEGIN; " + (lock if first == "payment" else cancel) + "\n\\echo LOCKED\nSELECT pg_sleep(0.5);\n" + (credit if first == "payment" else "") + " COMMIT;\n")
    holder.stdin.close()
    while holder.stdout.readline().strip() != "LOCKED":
        if holder.poll() is not None:
            raise AssertionError("credit-race holder exited")
    sql("BEGIN; " + (cancel if first == "payment" else lock + credit) + " COMMIT;")
    assert holder.wait() == 0
    assert scalar(f'''SELECT status || ':' || (metadata->>'onlinePaidAmount') FROM "Booking" WHERE id='{bid}' ''') == "CANCELLED:1000.00"
    assert scalar(f'''SELECT count(*) FROM "FinancialTransaction" WHERE id='{bid}-ledger' ''') == "1"
    ok(first + " before concurrent cancellation/success preserves accepted credit")
print(f"PostgreSQL invariants: {passed} passed, 0 failed; application Prisma path NOT exercised.")
