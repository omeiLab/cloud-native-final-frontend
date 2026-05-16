#!/usr/bin/env bash
# CETS E2E API 驗證 script — 對 https://cets.alanh.uk 打 API 驗證
# 用法: ./e2e-test.sh
set -euo pipefail

BASE="https://cets.alanh.uk"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

# ── JWT 產生(用 python3) ────────────────────────────────────────────────────
ADMIN_TOKEN=$(python3 -c "
import jwt, os, time
print(jwt.encode({
    'sub': '01E2EADMINTSMCROLEXXXXXXXX',
    'jti': 'e2e-admin-$(date +%s)',
    'iat': int(time.time()),
    'exp': int(time.time()) + 3600,
    'iss': 'https://cets.alanh.uk'
}, os.environ['CETS_JWT_SIGNING_KEY'], algorithm='HS256', headers={'kid': 'v1'}))
")

EMPLOYEE_TOKEN=$(python3 -c "
import jwt, os, time
print(jwt.encode({
    'sub': '01E2EEMPLOYEETSMCROLEXXXXX',
    'jti': 'e2e-emp-$(date +%s)',
    'iat': int(time.time()),
    'exp': int(time.time()) + 3600,
    'iss': 'https://cets.alanh.uk'
}, os.environ['CETS_JWT_SIGNING_KEY'], algorithm='HS256', headers={'kid': 'v1'}))
")

VERIFIER_TOKEN=$(python3 -c "
import jwt, os, time
print(jwt.encode({
    'sub': '01E2EVERIFIERTSMCROLEXXXXX',
    'jti': 'e2e-vfr-$(date +%s)',
    'iat': int(time.time()),
    'exp': int(time.time()) + 3600,
    'iss': 'https://cets.alanh.uk'
}, os.environ['CETS_JWT_SIGNING_KEY'], algorithm='HS256', headers={'kid': 'v1'}))
")

# ── Helpers ─────────────────────────────────────────────────────────────────
check() {
    local name="$1" method="$2" path="$3" expected="$4" token="${5:-}"
    local headers=()
    if [[ -n "$token" ]]; then
        headers+=("-H" "Authorization: Bearer $token")
    fi
    if [[ "$method" == "POST" || "$method" == "PATCH" ]]; then
        headers+=("-H" "Content-Type: application/json")
    fi

    TOTAL=$((TOTAL + 1))
    local http_code body
    http_code=$(curl -sk -o /tmp/e2e_body.json -w "%{http_code}" \
        -X "$method" "${BASE}${path}" "${headers[@]}" 2>/dev/null)
    body=$(cat /tmp/e2e_body.json)

    if [[ "$http_code" == "$expected" ]]; then
        PASS=$((PASS + 1))
        printf "  ${GREEN}PASS${NC}  [%s] %s %s → %s\n" "$name" "$method" "$path" "$http_code"
    else
        FAIL=$((FAIL + 1))
        printf "  ${RED}FAIL${NC}  [%s] %s %s → %s (expect %s)\n" "$name" "$method" "$path" "$http_code" "$expected"
        echo "        body: $(echo "$body" | python3 -c 'import sys,json; print(json.dumps(json.load(sys.stdin), indent=2)[:200])' 2>/dev/null || echo "$body")"
    fi
}

# ── 1. Health ───────────────────────────────────────────────────────────────
echo ""
echo "═══ 1. Health ═══"
check "health"     "GET" "/health"  "200"
check "readyz"     "GET" "/readyz"  "200"

# ── 2. Auth /me ─────────────────────────────────────────────────────────────
echo ""
echo "═══ 2. Auth /me ═══"
check "me-admin"      "GET" "/api/v1/auth/me"  "200" "$ADMIN_TOKEN"
check "me-employee"   "GET" "/api/v1/auth/me"  "200" "$EMPLOYEE_TOKEN"
check "me-verifier"   "GET" "/api/v1/auth/me"  "200" "$VERIFIER_TOKEN"
check "me-no-token"   "GET" "/api/v1/auth/me"  "401"
check "me-bad-token"  "GET" "/api/v1/auth/me"  "401" "" "bad"

# ── 3. OIDC ─────────────────────────────────────────────────────────────────
echo ""
echo "═══ 3. OIDC ═══"
check "oidc-authorize" "GET" "/api/v1/auth/oidc/authorize-url" "200"

# ── 4. Create Event (Admin) ─────────────────────────────────────────────────
echo ""
echo "═══ 4. Event CRUD ═══"

# Create event
EVENT_JSON=$(curl -sk -X POST "${BASE}/api/v1/admin/events" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"E2E Shell Test","description":"shell script test","allowed_sites":["HSINCHU"]}' 2>/dev/null)
EVENT_ID=$(echo "$EVENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Created event: $EVENT_ID"
TOTAL=$((TOTAL + 1))
if [[ -n "$EVENT_ID" && "$EVENT_ID" != "null" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [create-event] POST /api/v1/admin/events → 201\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [create-event] POST /api/v1/admin/events\n"
    echo "        body: $EVENT_JSON"
fi

# Add session
SESSION_JSON=$(curl -sk -X POST "${BASE}/api/v1/admin/events/${EVENT_ID}/sessions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "title":"Shell Session","venue":"Room A",
        "starts_at":"2027-02-01T09:00:00+08:00","ends_at":"2027-02-01T17:00:00+08:00",
        "registration_opens_at":"2026-04-01T00:00:00+08:00","registration_closes_at":"2026-12-31T23:59:59+08:00",
        "lottery_at":"2026-12-31T23:59:59+08:00","waitlist_close_at":"2027-01-07T23:59:59+08:00",
        "confirmation_deadline_hours":24
    }' 2>/dev/null)
SESSION_ID=$(echo "$SESSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Created session: $SESSION_ID"
TOTAL=$((TOTAL + 1))
if [[ -n "$SESSION_ID" && "$SESSION_ID" != "null" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [add-session] POST /api/v1/admin/events/{id}/sessions → 201\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [add-session] POST /api/v1/admin/events/{id}/sessions\n"
fi

# Add ticket type
TT_JSON=$(curl -sk -X POST "${BASE}/api/v1/admin/sessions/${SESSION_ID}/ticket-types" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"一般票","quota":2}' 2>/dev/null)
TT_ID=$(echo "$TT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Created ticket_type: $TT_ID"
TOTAL=$((TOTAL + 1))
if [[ -n "$TT_ID" && "$TT_ID" != "null" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [add-ticket-type] POST /api/v1/admin/sessions/{id}/ticket-types → 201\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [add-ticket-type] POST /api/v1/admin/sessions/{id}/ticket-types\n"
fi

# Publish
PUB_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X POST \
    "${BASE}/api/v1/admin/events/${EVENT_ID}/publish" \
    -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null)
TOTAL=$((TOTAL + 1))
if [[ "$PUB_CODE" == "200" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [publish] POST /api/v1/admin/events/{id}/publish → 200\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [publish] POST /api/v1/admin/events/{id}/publish → %s (expect 200)\n" "$PUB_CODE"
fi

# ── 5. Employee Event List ──────────────────────────────────────────────────
echo ""
echo "═══ 5. Event List ═══"
check "list-events-emp"  "GET" "/api/v1/events"  "200" "$EMPLOYEE_TOKEN"
check "list-events-all"  "GET" "/api/v1/events?scope=all"  "200" "$ADMIN_TOKEN"

# ── 6. Registration ─────────────────────────────────────────────────────────
echo ""
echo "═══ 6. Registration ═══"

# Register
REG_JSON=$(curl -sk -X POST "${BASE}/api/v1/registrations" \
    -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"${SESSION_ID}\",\"ticket_type_id\":\"${TT_ID}\"}" 2>/dev/null)
REG_ID=$(echo "$REG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
REG_STATUS=$(echo "$REG_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
TOTAL=$((TOTAL + 1))
if [[ "$REG_STATUS" == "REGISTERED" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [register] POST /api/v1/registrations → 201 (status=REGISTERED)\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [register] POST /api/v1/registrations → status=$REG_STATUS\n"
    echo "        body: $REG_JSON"
fi

# Duplicate registration
DUP_CODE=$(curl -sk -o /tmp/e2e_body.json -w "%{http_code}" -X POST \
    "${BASE}/api/v1/registrations" \
    -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"${SESSION_ID}\",\"ticket_type_id\":\"${TT_ID}\"}" 2>/dev/null)
TOTAL=$((TOTAL + 1))
if [[ "$DUP_CODE" == "409" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [dup-reg] POST /api/v1/registrations → 409\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [dup-reg] POST /api/v1/registrations → %s (expect 409)\n" "$DUP_CODE"
fi

# List my registrations
check "my-registrations"  "GET" "/api/v1/me/registrations"  "200" "$EMPLOYEE_TOKEN"

# Cancel registration
CANCEL_CODE=$(curl -sk -o /dev/null -w "%{http_code}" -X DELETE \
    "${BASE}/api/v1/registrations/${REG_ID}" \
    -H "Authorization: Bearer $EMPLOYEE_TOKEN" 2>/dev/null)
TOTAL=$((TOTAL + 1))
if [[ "$CANCEL_CODE" == "200" ]]; then
    PASS=$((PASS + 1))
    printf "  ${GREEN}PASS${NC}  [cancel] DELETE /api/v1/registrations/{id} → 200\n"
else
    FAIL=$((FAIL + 1))
    printf "  ${RED}FAIL${NC}  [cancel] DELETE /api/v1/registrations/{id} → %s (expect 200)\n" "$CANCEL_CODE"
fi

# ── 7. Notifications ────────────────────────────────────────────────────────
echo ""
echo "═══ 7. Notifications ═══"
check "list-notifications"  "GET" "/api/v1/notifications"  "200" "$EMPLOYEE_TOKEN"
check "unread-count"        "GET" "/api/v1/notifications/unread-count"  "200" "$EMPLOYEE_TOKEN"

# ── 8. Tickets ──────────────────────────────────────────────────────────────
echo ""
echo "═══ 8. Tickets ═══"
check "my-tickets"   "GET" "/api/v1/me/tickets"  "200" "$EMPLOYEE_TOKEN"
check "verify-empty" "POST" "/api/v1/verify/ticket"  "400" "$VERIFIER_TOKEN"

# ── 9. Admin ────────────────────────────────────────────────────────────────
echo ""
echo "═══ 9. Admin ═══"
check "admin-dashboard"  "GET" "/api/v1/admin/events/${EVENT_ID}/dashboard"  "200" "$ADMIN_TOKEN"
check "admin-reg-list"   "GET" "/api/v1/admin/events/${EVENT_ID}/registrations"  "200" "$ADMIN_TOKEN"
check "admin-sites"      "GET" "/api/v1/admin/sites/employee-count?sites=HSINCHU,TAINAN"  "200" "$ADMIN_TOKEN"

# Employee cannot access admin
check "emp-no-admin"  "GET" "/api/v1/admin/events/${EVENT_ID}/dashboard"  "403" "$EMPLOYEE_TOKEN"

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
printf "  Total: %d  ${GREEN}Pass: %d${NC}  ${RED}Fail: %d${NC}\n" "$TOTAL" "$PASS" "$FAIL"
echo "═══════════════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
