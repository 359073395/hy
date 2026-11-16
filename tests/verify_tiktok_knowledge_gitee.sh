#!/usr/bin/env bash
# Dedicated disposable CI runner only: exercise actual Gitee files and image attachments.
set -Eeuo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Run this disposable integration test as root'; exit 1; }
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
app_source="$repo/apps/tiktok-knowledge"
guard="$repo/tests/tiktok_knowledge_gitee_guard.py"
requested_ref="${SOURCE_REF:-main}"
[[ "$requested_ref" =~ ^[a-zA-Z0-9._/-]+$ ]] || { echo 'Invalid source reference'; exit 1; }
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/tiktok-gitee-test.XXXXXX")
results="$app_source/test-results/gitee-installer"
mkdir -p "$results" "$work/bin"
export APP_DIR="$work/install"
export TIKTOK_REAL_CURL TIKTOK_REAL_DOCKER TIKTOK_GUARD_LOG
TIKTOK_REAL_CURL=$(command -v curl)
TIKTOK_REAL_DOCKER=$(command -v docker)
TIKTOK_GUARD_LOG="$work/network.log"
: > "$TIKTOK_GUARD_LOG"
phase=setup
resolved_ref=''
install_loads=0
update_loads=0

redact() {
    python3 - "$1" "$APP_DIR/.env" "$work/admin-setup.json" <<'PY'
import json, pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text(errors='replace')
env = pathlib.Path(sys.argv[2])
if env.exists():
    for line in env.read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator and value and any(word in key for word in ('TOKEN', 'PASSWORD', 'SECRET')):
            text = text.replace(value, '[REDACTED]')
setup = pathlib.Path(sys.argv[3])
if setup.exists():
    value = json.loads(setup.read_text()).get('password', '')
    if value:
        text = text.replace(value, '[REDACTED]')
text = re.sub(r'CI-[A-Za-z0-9-]+', '[TEST TOKEN]', text)
text = re.sub(r'("(?:token|token_custom|tokenCustom|password|cookie|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"', r'\1"[REDACTED]"', text, flags=re.I)
print(text, end='')
PY
}

finish() {
    local status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then
        printf 'Gitee installer verification failed in phase: %s\n' "$phase"
        for raw in "$work"/*.log; do
            [ -f "$raw" ] || continue
            redact "$raw" > "$results/${raw##*/}" || true
        done
        if [ -f "$APP_DIR/compose.yaml" ]; then
            "$TIKTOK_REAL_DOCKER" compose --project-name tiktok-knowledge --project-directory "$APP_DIR" \
                --env-file "$APP_DIR/.env" -f "$APP_DIR/compose.yaml" logs --no-color --tail=80 > "$work/runtime.log" 2>&1 || true
            redact "$work/runtime.log" > "$results/runtime.log" || true
        fi
    fi
    python3 - "$results/gitee-results.json" "$status" "$phase" "$requested_ref" "$resolved_ref" "$install_loads" "$update_loads" <<'PY'
import json, pathlib, sys
path, status, phase, requested, resolved, install_loads, update_loads = sys.argv[1:]
pathlib.Path(path).write_text(json.dumps({
    'passed': status == '0', 'phase': phase, 'requestedRef': requested, 'resolvedRef': resolved,
    'source': 'gitee', 'platform': 'linux/amd64', 'installDockerLoads': int(install_loads),
    'updateDockerLoads': int(update_loads), 'githubDownloadCallsBlocked': True,
    'registryPullCallsBlocked': True, 'composeUpRequiresPullNever': True,
    'scope': 'Installer downloads and Docker calls; runner setup and Docker Engine installation are outside this test',
}, indent=2) + '\n')
PY
    cp "$TIKTOK_GUARD_LOG" "$results/network-calls.log"
    chmod -R a+rX "$results"
    if [ -f "$APP_DIR/compose.yaml" ]; then
        "$TIKTOK_REAL_DOCKER" compose --project-name tiktok-knowledge --project-directory "$APP_DIR" \
            --env-file "$APP_DIR/.env" -f "$APP_DIR/compose.yaml" down --remove-orphans >/dev/null 2>&1 || true
    fi
    exit "$status"
}
trap finish EXIT

run_step() {
    phase="$1"; shift
    "$@" > "$work/$phase.log" 2>&1
    printf 'PASS %s\n' "$phase"
}

python3 "$guard" --self-test
for tool in curl docker; do
    cat > "$work/bin/$tool" <<EOF
#!/usr/bin/env bash
exec python3 "$guard" "$tool" "\$@"
EOF
    chmod 755 "$work/bin/$tool"
done
export PATH="$work/bin:$PATH"
version=$(tr -d '\r\n' < "$app_source/VERSION")
for image in "ghcr.io/359073395/tiktok-knowledge:$version" postgres:17-alpine postgrest/postgrest:v16.5; do
    if docker image inspect "$image" >/dev/null 2>&1; then
        echo 'Fresh-image precondition failed: the runner must not have the three application images'
        exit 1
    fi
done
node - "$work/admin-setup.json" <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
fs.writeFileSync(process.argv[2], JSON.stringify({action:'create', username:'gitee-ci-admin', password:crypto.randomBytes(24).toString('hex')}), {mode:0o600});
JS

unset TIKTOK_SOURCE TIKTOK_GITEE_REPOSITORY TIKTOK_BUNDLE_BASE TIKTOK_BUNDLE_DIR TIKTOK_IMAGE
run_step install env TIKTOK_SOURCE=gitee TIKTOK_GITEE_REPOSITORY=hy91/hy \
    ADMIN_SETUP_FILE="$work/admin-setup.json" SITE_URL=https://existing-domain.example \
    bash "$app_source/install.sh" --install --ref "$requested_ref"
resolved_ref=$(cat "$APP_DIR/SOURCE_REF")
[[ "$resolved_ref" =~ ^[0-9a-f]{40}$ ]]
grep -qx 'TIKTOK_SOURCE=gitee' "$APP_DIR/.env"
grep -qx 'TIKTOK_GITEE_REPOSITORY=hy91/hy' "$APP_DIR/.env"
grep -qx 'SITE_URL=https://existing-domain.example' "$APP_DIR/.env"
install_loads=$(grep -c $'^docker\tload$' "$TIKTOK_GUARD_LOG")
[ "$install_loads" -eq 1 ]
grep -q 'gitee.com/hy91/hy/releases/download/.*full.sha256' "$TIKTOK_GUARD_LOG"
grep -q 'gitee.com/hy91/hy/releases/download/.*part-000' "$TIKTOK_GUARD_LOG"
run_step install-health curl --fail --silent http://127.0.0.1:8791/api/health
run_step install-password node "$app_source/tests/check-installed-admin.mjs" "$work/admin-setup.json"
cd "$app_source"
run_step seed-synthetic-data node --env-file="$APP_DIR/.env" tests/integration.mjs
cp "$APP_DIR/.env" "$work/before.env"
printf 'gitee-update-preserves-file\n' > "$APP_DIR/data/gitee-verification-probe.txt"
sha256sum "$APP_DIR/data/gitee-verification-probe.txt" > "$work/probe.sha256"
cp "$TIKTOK_GUARD_LOG" "$results/install-network-calls.log"
: > "$TIKTOK_GUARD_LOG"

# No TIKTOK_* environment variables: the installed script must reuse persisted Gitee settings.
run_step update bash "$APP_DIR/install.sh" --update --ref "$resolved_ref"
cmp "$work/before.env" "$APP_DIR/.env"
sha256sum --check "$work/probe.sha256" > "$work/probe.log"
[ -s "$APP_DIR/backups/latest-pre-update/database.dump" ]
[ "$(cat "$APP_DIR/SOURCE_REF")" = "$resolved_ref" ]
update_loads=$(grep -c $'^docker\tload$' "$TIKTOK_GUARD_LOG" || true)
[ "$update_loads" -eq 0 ]
grep -q "gitee.com/hy91/hy/raw/$resolved_ref/" "$TIKTOK_GUARD_LOG"
if grep -q '^blocked' "$TIKTOK_GUARD_LOG"; then echo 'A forbidden network call was attempted'; exit 1; fi
run_step update-health curl --fail --silent http://127.0.0.1:8791/api/health
run_step update-password node "$app_source/tests/check-installed-admin.mjs" "$work/admin-setup.json"
run_step verify-preserved-data node --env-file="$APP_DIR/.env" tests/integration.mjs --after-restart
cp test-results/api-results.json "$results/api-results.json"
phase=complete
printf 'PASS Gitee install and update preserved administrator access, domain, environment, members, knowledge, exams and data probe\n'
