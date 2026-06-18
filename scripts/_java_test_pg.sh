#!/usr/bin/env bash
# Throwaway Postgres for local Java @QuarkusTest runs / Sonar coverage scans,
# WITHOUT touching the shared e2e stack DB. Creates the per-repo *_test databases.
#
# Why: Terrio Quarkus services use %test datasource
# jdbc:postgresql://localhost:5432/<db>_test with DevServices disabled
# (INFRA-TEST-001). Locally :5432 is often occupied by another project, so
# @QuarkusTest fails. This dedicated container on :5460 (ble_dev/secret) lets tests
# run via JDBC override. Flyway needs ITS OWN username/password (does NOT inherit the
# datasource creds) — omitting them yields "Username and password must be defined
# when a JDBC URL is provided in the Flyway configuration".
#
# Usage:
#   bash _java_test_pg.sh up      # start container + create *_test DBs
#   bash _java_test_pg.sh down    # remove container
#
# Then run a repo with the override (example: core-registry):
#   mvn -B -ntp \
#     -Dquarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5460/ble_core_test \
#     -Dquarkus.datasource.username=ble_dev -Dquarkus.datasource.password=secret \
#     -Dquarkus.flyway.jdbc-url=jdbc:postgresql://localhost:5460/ble_core_test \
#     -Dquarkus.flyway.username=ble_dev -Dquarkus.flyway.password=secret verify
#
# notification-service additionally reads ${TEST_DB_URL} — also pass
#   -DTEST_DB_URL=jdbc:postgresql://localhost:5460/ble_notification_test
set -u
NAME=terrio-java-test-pg
DBS="ble_identity_test ble_core_test ble_gamification_test ble_notification_test ble_cashback_test ble_ingestion_test"
case "${1:-up}" in
  up)
    docker run -d --name "$NAME" -e POSTGRES_USER=ble_dev -e POSTGRES_PASSWORD=secret \
      -e POSTGRES_DB=ble -p 5460:5432 postgres:16-alpine >/dev/null 2>&1
    for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U ble_dev >/dev/null 2>&1 && break; sleep 1; done
    for db in $DBS; do docker exec "$NAME" psql -U ble_dev -d ble -c "CREATE DATABASE $db OWNER ble_dev" 2>/dev/null; done
    echo "[$NAME] up on :5460 — DBs: $DBS"
    ;;
  down)
    docker rm -f "$NAME" 2>/dev/null
    echo "[$NAME] removed"
    ;;
  *)
    echo "usage: $0 up|down"; exit 2
    ;;
esac
