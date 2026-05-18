#!/usr/bin/env bash
# E2E 抽籤 + 票券驗證完整鏈路
# 用法: bash e2e-lottery-ticket.sh
set -euo pipefail

BASE="https://cets.alanh.uk"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0
TOTAL=0

ok() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); printf "  ${GREEN}✓${NC} %s\n" "$1"; }
err() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); printf "  ${RED}✗${NC} %s: %s\n" "$1" "$2"; }

_gen_token() {
    python3 -c "
import jwt, os, time
print(jwt.encode({
    'sub': '$1', 'jti': 'e2e-' + str(time.monotonic_ns()),
    'iat': int(time.time()), 'exp': int(time.time()) + 7200,
    'iss': 'https://cets.alanh.uk'
}, os.environ['CETS_JWT_SIGNING_KEY'], algorithm='HS256', headers={'kid': 'v1'}))
"
}

ADMIN_TOKEN=$(_gen_token "01E2EADMINTSMCROLEXXXXXXXX")
EMP_TOKEN=$(_gen_token   "01E2EEMPLOYEETSMCROLEXXXXX")
VER_TOKEN=$(_gen_token   "01E2EVERIFIERTSMCROLEXXXXX")
HDR_ADMIN="Authorization: Bearer $ADMIN_TOKEN"
HDR_EMP="Authorization: Bearer $EMP_TOKEN"
HDR_VER="Authorization: Bearer $VER_TOKEN"

_curl() {
    local m="$1" p="$2" h="${3:-}" d="${4:-}"
    local x=()
    [[ -n "$h" ]] && x+=("-H" "$h")
    [[ -n "$d" ]] && x+=("-d" "$d")
    curl -sk -X "$m" "${BASE}${p}" -H "Content-Type: application/json" "${x[@]}" 2>/dev/null
}

# ═══════════════════════════════════════════════════════════════════════════
# Step 1-4: 建立活動 + 場次 + 票種 + 發布
# ═══════════════════════════════════════════════════════════════════════════
echo "═══ Step 1-4: 建立活動鏈路 ═══"

E=$(_curl POST "/api/v1/admin/events" "$HDR_ADMIN" '{"title":"E2E Lottery-Ticket","description":"full chain test","allowed_sites":["HSINCHU"]}')
EVENT_ID=$(echo "$E" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
[[ -n "$EVENT_ID" ]] && ok "event: $EVENT_ID" || { err "建立活動" "$E"; exit 1; }

NOW=$(date +%s)
ft() { date -d "@$1" "+%Y-%m-%dT%H:%M:%S+08:00"; }

# DB constraint: reg_open < reg_close <= lottery < waitlist <= starts < ends
# 先設 starts_at 在未來（constraint 通過），抽籤後 DB update 改到過去
cat > /tmp/sess.json <<EOF
{
    "title": "E2E Session", "venue": "Hall A",
    "starts_at": "$(ft $((NOW+1900)))",
    "ends_at": "$(ft $((NOW+7200)))",
    "registration_opens_at": "$(ft $((NOW-3600)))",
    "registration_closes_at": "$(ft $((NOW+1800)))",
    "lottery_at": "$(ft $((NOW+1800)))",
    "waitlist_close_at": "$(ft $((NOW+1850)))",
    "confirmation_deadline_hours": 1
}
EOF

S=$(_curl POST "/api/v1/admin/events/${EVENT_ID}/sessions" "$HDR_ADMIN" "$(cat /tmp/sess.json)")
SESSION_ID=$(echo "$S" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
[[ -n "$SESSION_ID" ]] && ok "session: $SESSION_ID" || { err "新增場次" "$S"; exit 1; }

T=$(_curl POST "/api/v1/admin/sessions/${SESSION_ID}/ticket-types" "$HDR_ADMIN" '{"name":"一般票","quota":2}')
TT_ID=$(echo "$T" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
[[ -n "$TT_ID" ]] && ok "ticket_type: $TT_ID" || { err "新增票種" "$T"; exit 1; }

P=$(_curl POST "/api/v1/admin/events/${EVENT_ID}/publish" "$HDR_ADMIN")
[[ "$(echo "$P" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")" == "PUBLISHED" ]] && ok "發布成功" || { err "發布" "$P"; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: 三人報名
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 5: 三人報名 ═══"

B="{\"session_id\":\"$SESSION_ID\",\"ticket_type_id\":\"$TT_ID\"}"
RA=$(_curl POST "/api/v1/registrations" "$HDR_ADMIN" "$B")
RE=$(_curl POST "/api/v1/registrations" "$HDR_EMP" "$B")
RV=$(_curl POST "/api/v1/registrations" "$HDR_VER" "$B")
RA_ID=$(echo "$RA" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
RE_ID=$(echo "$RE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
RV_ID=$(echo "$RV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

[[ -n "$RA_ID" ]] && ok "Admin 報名: $RA_ID" || { err "Admin 報名" "$RA"; exit 1; }
[[ -n "$RE_ID" ]] && ok "Employee 報名: $RE_ID" || { err "Employee 報名" "$RE"; exit 1; }
[[ -n "$RV_ID" ]] && ok "Verifier 報名: $RV_ID" || { err "Verifier 報名" "$RV"; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════
# Step 6: DB 更新（關閉報名 + 抽籤時間改過去 + 活動時間改驗票時窗）
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 6: DB 直連更新 ═══"

PG_OUT=$(ssh -n cets-vm "kubectl exec -n cets deploy/cets-cnpg-rw-pooler -- env PGPASSWORD=\$(kubectl get secret -n cets cets-cnpg-app -o jsonpath='{.data.password}' | base64 -d) psql -h localhost -U app -d cets -c \"UPDATE sessions SET status = 'REGISTRATION_CLOSED', registration_closes_at = NOW() - INTERVAL '2 minutes', lottery_at = NOW() - INTERVAL '1 minute' WHERE id = '$SESSION_ID';\" 2>&1" 2>&1)

if echo "$PG_OUT" | grep -q "UPDATE 1"; then
    ok "status → REGISTRATION_CLOSED, lottery_at 改過去"
else
    err "DB update 失敗" "$PG_OUT"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 7: 等待抽籤完成（輪詢 registration status，不用監看 job log）
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 7: 等待抽籤完成 ═══"

_get_reg_status() {
    local hdr="$1" rid="$2"
    local res=$(_curl GET "/api/v1/me/registrations" "$hdr")
    echo "$res" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for item in d.get('items',[]):
    if item.get('id') == '$rid':
        print(item.get('status',''))
        break
"
}

WAIT_START=$(date +%s)
while true; do
    SA=$(_get_reg_status "$HDR_ADMIN" "$RA_ID")
    SE=$(_get_reg_status "$HDR_EMP"   "$RE_ID")
    SV=$(_get_reg_status "$HDR_VER"   "$RV_ID")

    if [[ "$SA" != "REGISTERED" && "$SE" != "REGISTERED" && "$SV" != "REGISTERED" ]]; then
        ok "抽籤完成（$SA / $SE / $SV）"
        break
    fi

    ELAPSED=$(($(date +%s) - WAIT_START))
    if [[ $ELAPSED -gt 180 ]]; then
        err "等待抽籤超時" "180 秒未處理（$SA / $SE / $SV）"
        exit 1
    fi
    printf "  ⏳ %d 秒...（%s / %s / %s）\r" "$ELAPSED" "$SA" "$SE" "$SV"
    sleep 5
done

# ═══════════════════════════════════════════════════════════════════════════
# Step 8: 驗證抽籤結果
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 8: 驗證抽籤結果 ═══"

SA=$(_get_reg_status "$HDR_ADMIN" "$RA_ID")
SE=$(_get_reg_status "$HDR_EMP"   "$RE_ID")
SV=$(_get_reg_status "$HDR_VER"   "$RV_ID")

echo "  Admin: $SA | Employee: $SE | Verifier: $SV"

_valid_post_lottery() { [[ "$1" == "WON" || "$1" == "WAITLISTED" || "$1" == "LOST" || "$1" == "CONFIRMED" ]]; }

if _valid_post_lottery "$SA"; then ok "Admin ($SA)"; else err "Admin 異常" "status=$SA"; fi
if _valid_post_lottery "$SE"; then ok "Employee ($SE)"; else err "Employee 異常" "status=$SE"; fi
if _valid_post_lottery "$SV"; then ok "Verifier ($SV)"; else err "Verifier 異常" "status=$SV"; fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 9: 改活動時間到驗票時窗
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 9: 改活動時間到驗票時窗 ═══"

PG2=$(ssh -n cets-vm "kubectl exec -n cets deploy/cets-cnpg-rw-pooler -- env PGPASSWORD=\$(kubectl get secret -n cets cets-cnpg-app -o jsonpath='{.data.password}' | base64 -d) psql -h localhost -U app -d cets -c \"UPDATE sessions SET waitlist_close_at = NOW() - INTERVAL '30 seconds', starts_at = NOW() - INTERVAL '30 seconds', ends_at = NOW() + INTERVAL '30 minutes' WHERE id = '$SESSION_ID';\" 2>&1" 2>&1)

if echo "$PG2" | grep -q "UPDATE 1"; then
    ok "活動時間改到驗票時窗"
else
    err "時間更新失敗" "$PG2"
    exit 1
fi

# Step 9b: 清 Redis 快取（DB 直改後快取仍為舊值，需 evict）
REDIS_DEL=$(ssh -n cets-vm "kubectl exec -n cets deploy/cets-redis -- redis-cli -a \$(kubectl get secret -n cets cets-redis -o jsonpath='{.data.redis-password}' | base64 -d) DEL session:$SESSION_ID 2>&1" 2>&1)
if echo "$REDIS_DEL" | grep -qE '^[0-9]+$'; then
    ok "Redis 快取已清除"
else
    err "Redis 快取清除失敗" "$REDIS_DEL"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 10: WON 者 confirm
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 10: WON 者確認領票 ═══"

WON_ID=""
WON_HDR=""
WON_NAME=""
if [[ "$SA" == "WON" ]]; then WON_ID="$RA_ID"; WON_HDR="$HDR_ADMIN"; WON_NAME="Admin"; fi
if [[ "$SE" == "WON" && -z "$WON_ID" ]]; then WON_ID="$RE_ID"; WON_HDR="$HDR_EMP"; WON_NAME="Employee"; fi
if [[ "$SV" == "WON" && -z "$WON_ID" ]]; then WON_ID="$RV_ID"; WON_HDR="$HDR_VER"; WON_NAME="Verifier"; fi

if [[ -z "$WON_ID" ]]; then
    err "找不到 WON 者" ""
    exit 1
fi

CONF=$(_curl POST "/api/v1/registrations/${WON_ID}/confirm" "$WON_HDR")
TS=$(echo "$CONF" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
if [[ "$TS" == "ISSUED" ]]; then
    ok "$WON_NAME confirm → ISSUED"
else
    err "confirm 失敗" "$CONF"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 11: QR + 驗票
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 11: QR Code + 核銷 ═══"

TICKETS=$(_curl GET "/api/v1/me/tickets" "$WON_HDR")
TICKET_ID=$(echo "$TICKETS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for item in d.get('items',[]):
    if item.get('session_id') == '$SESSION_ID':
        print(item.get('id',''))
        break
")
[[ -z "$TICKET_ID" ]] && { err "找不到 ticket" "$TICKETS"; exit 1; }
ok "ticket_id: $TICKET_ID"

QR=$(_curl GET "/api/v1/me/tickets/${TICKET_ID}/qr" "$WON_HDR")
QR_PAYLOAD=$(echo "$QR" | python3 -c "import sys,json; print(json.load(sys.stdin).get('qr_payload',''))")
[[ -n "$QR_PAYLOAD" && "$QR_PAYLOAD" != "null" ]] && ok "QR payload 長度 ${#QR_PAYLOAD}" || { err "QR 失敗" "$QR"; exit 1; }

VBODY="$(python3 -c "import json; print(json.dumps({'qr_payload':'$QR_PAYLOAD','device_id':'test-scanner-01'}))")"
V1=$(_curl POST "/api/v1/verify/ticket" "$HDR_VER" "$VBODY")
USED_AT=$(echo "$V1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('used_at',''))")
[[ -n "$USED_AT" && "$USED_AT" != "null" ]] && ok "驗票成功 → used_at=$USED_AT" || { err "驗票失敗" "$V1"; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════
# Step 12: 重複驗票阻擋
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 12: 重複驗票阻擋 ═══"

V2_HTTP=$(curl -sk -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/v1/verify/ticket" -H "Content-Type: application/json" -H "$HDR_VER" -d "$VBODY" 2>/dev/null)
if [[ "$V2_HTTP" == "409" || "$V2_HTTP" == "400" ]]; then
    ok "重複驗票被拒 → HTTP $V2_HTTP"
else
    err "重複驗票未被阻擋" "HTTP=$V2_HTTP"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 13: 清理
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ Step 13: 清理 ═══"

CAN=$(_curl POST "/api/v1/admin/events/${EVENT_ID}/cancel" "$HDR_ADMIN" '{"reason":"E2E cleanup"}')
CS=$(echo "$CAN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
if [[ "$CS" == "CANCELLED" ]]; then
    ok "活動已取消"
else
    err "取消失敗" "$CAN"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════"
printf "  E2E 抽籤+票券驗證: ${GREEN}Pass %d${NC} / ${RED}Fail %d${NC} / Total %d\n" "$PASS" "$FAIL" "$TOTAL"
echo "═══════════════════════════════════════════════════"

[[ $FAIL -gt 0 ]] && exit 1
