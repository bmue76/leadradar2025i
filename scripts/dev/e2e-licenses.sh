#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

if [[ -z "${OWNER_ID:-}" ]]; then
  echo "ERROR: OWNER_ID env var missing. Example:"
  echo "  export OWNER_ID=\"<TENANT_OWNER_USER_ID>\""
  exit 1
fi

if [[ -z "${TENANT_SLUG:-}" ]]; then
  echo "ERROR: TENANT_SLUG env var missing. Example:"
  echo "  export TENANT_SLUG=\"<your-tenant-slug>\""
  exit 1
fi

echo "== LeadRadar 1.3 E2E Smoke =="
echo "BASE_URL=$BASE_URL"
echo "OWNER_ID=$OWNER_ID"
echo "TENANT_SLUG=$TENANT_SLUG"
echo

# Helper: parse JSON response and extract a value safely (supports {data:{...}} or {...})
json_get() {
  local expr="$1"
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);const d=(j&&typeof j==='object'&&'data'in j)?j.data:j;const v=($expr)(d);process.stdout.write((v===undefined||v===null)?'':String(v));}catch(e){process.stdout.write('');}});"
}

echo "---- 1) GET /api/admin/v1/packages (expect 200) ----"
curl -sS -i -H "x-user-id: $OWNER_ID" "$BASE_URL/api/admin/v1/packages" | sed -n '1,40p'
echo

echo "---- 2) POST /api/admin/v1/orders (PKG_30) -> creates Order + LicenseKey(PENDING) ----"
ORDER_RESP="$(curl -sS -i -H "x-user-id: $OWNER_ID" -H "content-type: application/json" -d "{\"packageCode\":\"PKG_30\"}" "$BASE_URL/api/admin/v1/orders")"
echo "$ORDER_RESP" | sed -n '1,80p'
echo

ORDER_ID="$(echo "$ORDER_RESP" | tail -n 1 | json_get "(d)=>d.order && d.order.id")"
LICENSE_KEY="$(echo "$ORDER_RESP" | tail -n 1 | json_get "(d)=>d.licenseKey && d.licenseKey.key")"

if [[ -z "$ORDER_ID" || -z "$LICENSE_KEY" ]]; then
  echo "ERROR: Could not extract ORDER_ID or LICENSE_KEY from response."
  echo "ORDER_ID='$ORDER_ID' LICENSE_KEY='$LICENSE_KEY'"
  exit 1
fi

echo "Extracted ORDER_ID=$ORDER_ID"
echo "Extracted LICENSE_KEY=$LICENSE_KEY"
echo

echo "---- 3) Mobile activate with PENDING key -> PAYMENT_PENDING (402) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$LICENSE_KEY\",\"platform\":\"IOS\",\"deviceUid\":\"DEV123\",\"deviceMeta\":{\"appVersion\":\"1.0\"}}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,80p'
echo

echo "---- 4) POST /api/admin/v1/orders/$ORDER_ID/mark-paid -> Order PAID + Payment SUCCEEDED + Key ISSUED ----"
curl -sS -i -H "x-user-id: $OWNER_ID" -X POST \
  "$BASE_URL/api/admin/v1/orders/$ORDER_ID/mark-paid" | sed -n '1,120p'
echo

echo "---- 5) Mobile activate with ISSUED key -> ACTIVE (200) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$LICENSE_KEY\",\"platform\":\"IOS\",\"deviceUid\":\"DEV123\",\"deviceMeta\":{\"appVersion\":\"1.0\"}}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,120p'
echo

echo "---- 6) Mobile activate same device again -> idempotent (200) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$LICENSE_KEY\",\"platform\":\"IOS\",\"deviceUid\":\"DEV123\"}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,120p'
echo

echo "---- 7) Mobile activate different device -> KEY_ALREADY_BOUND (409) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$LICENSE_KEY\",\"platform\":\"IOS\",\"deviceUid\":\"DEV999\"}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,120p'
echo

echo "---- 8) Create PROMO key (script) ----"
PROMO_OUT="$(npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" scripts/dev/create-promo-key.ts 30)"
echo "$PROMO_OUT"
PROMO_KEY="$(echo "$PROMO_OUT" | grep -E '^PROMO_KEY:' | awk '{print $2}' | tr -d '\r')"

if [[ -z "$PROMO_KEY" ]]; then
  echo "ERROR: Could not extract PROMO_KEY from script output."
  exit 1
fi

echo "Extracted PROMO_KEY=$PROMO_KEY"
echo

echo "---- 9) Mobile activate PROMO without tenantSlug -> TENANT_REQUIRED (400) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$PROMO_KEY\",\"platform\":\"ANDROID\",\"deviceUid\":\"PDEV1\"}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,120p'
echo

echo "---- 10) Mobile activate PROMO with tenantSlug -> redeem + ACTIVE (200) ----"
curl -sS -i -H "content-type: application/json" \
  -d "{\"licenseKey\":\"$PROMO_KEY\",\"tenantSlug\":\"$TENANT_SLUG\",\"platform\":\"ANDROID\",\"deviceUid\":\"PDEV1\"}" \
  "$BASE_URL/api/mobile/v1/activate" | sed -n '1,160p'
echo

echo "== DONE =="
