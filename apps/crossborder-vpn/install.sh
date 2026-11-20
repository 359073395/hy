#!/usr/bin/env bash
# 跑量众创跨境VPN系统部署脚本（兼容 Harvey 一键脚本 11 应用 #124）。
# 数据目录 ./data 与管理员账号密码、节点池、飞书配置、已上传安装包在更新与卸载后均完整保留。
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/crossborder-vpn}"
APP_PORT="${APP_PORT:-18800}"
HY_REF="${HY_REF:-main}"
REPOSITORY="359073395/hy"
WORK_DIR=""

die() { printf '%s\n' "$*" >&2; exit 1; }

env_value() {
    [ -f "$APP_DIR/.env" ] || return 0
    sed -n "s/^${1}=//p" "$APP_DIR/.env" | tail -n 1
}

set_env_value() {
    local key="$1" value="$2" temporary
    temporary=$(mktemp "$APP_DIR/.env.XXXXXX")
    awk -v key="$key" -v value="$value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$APP_DIR/.env" > "$temporary"
    chmod 600 "$temporary"
    mv -f "$temporary" "$APP_DIR/.env"
}

compose() {
    docker compose --project-name crossborder-vpn --project-directory "$APP_DIR" \
        --env-file "$APP_DIR/.env" -f "$APP_DIR/compose.yaml" "$@"
}

validate_origin() {
    [[ "$1" =~ ^https?://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?$ ]]
}

cleanup() {
    if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}

require_runtime() {
    [ "$(id -u)" -eq 0 ] || die "请使用 root 运行安装器。"
    for tool in docker curl openssl python3 tar; do
        command -v "$tool" >/dev/null || die "缺少 $tool，请先安装 Docker Compose、curl、openssl、tar 和 python3。"
    done
    docker compose version >/dev/null || die "需要 Docker Compose v2。"
    docker info >/dev/null 2>&1 || die "Docker 服务未运行。"
    mkdir -p "$APP_DIR" "$APP_DIR/data"
    APP_DIR=$(cd "$APP_DIR" && pwd -P)
    trap cleanup EXIT
}

prompt_admin_credentials() {
    local force_prompt="${1:-0}"
    local cur_user cur_pass cur_company input_user input_pass input_company
    cur_user="${VPN_ADMIN_USER:-$(env_value VPN_ADMIN_USER)}"
    cur_pass="${VPN_ADMIN_PASSWORD:-$(env_value VPN_ADMIN_PASSWORD)}"
    cur_company="${VPN_COMPANY_NAME:-$(env_value VPN_COMPANY_NAME)}"
    cur_company="${cur_company:-跑量众创 · 内部专线 VPN}"

    if [ "$force_prompt" = "0" ] && [ -n "$cur_pass" ]; then
        return 0
    fi

    if [ -t 0 ]; then
        echo ""
        echo "------------------------------------------------------------"
        echo "🔐 配置跑量众创跨境VPN 管理员后台登录账号与密码"
        echo "------------------------------------------------------------"
        read -r -e -p "请输入管理员登录账号 [${cur_user:-admin}]: " input_user
        cur_user="${input_user:-${cur_user:-admin}}"
        while true; do
            read -r -s -p "请设置管理员登录密码 (不能为空): " input_pass
            echo ""
            if [ -n "$input_pass" ]; then
                cur_pass="$input_pass"
                break
            fi
            echo "❌ 密码不能为空，请重新输入。"
        done
        if [ "$force_prompt" = "0" ]; then
            read -r -e -p "请输入首页显示公司名称 [${cur_company}]: " input_company
            if [ -n "${input_company:-}" ]; then
                cur_company="$input_company"
            fi
        fi
    else
        cur_user="${cur_user:-admin}"
        if [ -z "$cur_pass" ]; then
            cur_pass="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)"
            echo "⚠️ 非交互部署已自动生成管理员密码: $cur_pass"
        fi
    fi

    set_env_value "VPN_ADMIN_USER" "$cur_user"
    set_env_value "VPN_ADMIN_PASSWORD" "$cur_pass"
    set_env_value "VPN_COMPANY_NAME" "$cur_company"
}

fetch_app_bundle() {
    local source repository bundle_url compose_url ver_url local_dir
    source="${CBVPN_SOURCE:-$(env_value CBVPN_SOURCE)}"
    source="${source:-${HY_SOURCE:-github}}"
    repository="${CBVPN_GITEE_REPOSITORY:-$(env_value CBVPN_GITEE_REPOSITORY)}"
    repository="${repository:-hy91/hy}"
    local_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    WORK_DIR=$(mktemp -d)
    if [ -f "$local_dir/crossborder-vpn-vps.tar.gz" ] && [ -f "$local_dir/compose.yaml" ]; then
        cp -f "$local_dir/compose.yaml" "$APP_DIR/compose.yaml"
        [ -f "$local_dir/install.sh" ] && cp -f "$local_dir/install.sh" "$APP_DIR/install.sh" && chmod +x "$APP_DIR/install.sh" || true
        [ -f "$local_dir/VERSION" ] && cp -f "$local_dir/VERSION" "$APP_DIR/VERSION" || true
        rm -rf "$APP_DIR/app_src"
        mkdir -p "$APP_DIR/app_src"
        tar -xzf "$local_dir/crossborder-vpn-vps.tar.gz" -C "$APP_DIR/app_src"
        return 0
    fi

    if [ "$source" = gitee ]; then
        compose_url="https://gitee.com/$repository/raw/$HY_REF/apps/crossborder-vpn/compose.yaml"
        bundle_url="https://gitee.com/$repository/raw/$HY_REF/apps/crossborder-vpn/crossborder-vpn-vps.tar.gz"
        ver_url="https://gitee.com/$repository/raw/$HY_REF/apps/crossborder-vpn/VERSION"
    else
        compose_url="https://raw.githubusercontent.com/$REPOSITORY/$HY_REF/apps/crossborder-vpn/compose.yaml"
        bundle_url="https://raw.githubusercontent.com/$REPOSITORY/$HY_REF/apps/crossborder-vpn/crossborder-vpn-vps.tar.gz"
        ver_url="https://raw.githubusercontent.com/$REPOSITORY/$HY_REF/apps/crossborder-vpn/VERSION"
    fi

    curl -fsSL --retry 3 --connect-timeout 15 --max-time 60 "$compose_url" -o "$WORK_DIR/compose.yaml" || die "下载 compose.yaml 失败: $compose_url"
    curl -fsSL --retry 3 --connect-timeout 15 --max-time 180 "$bundle_url" -o "$WORK_DIR/app.tar.gz" || die "下载源码压缩包失败: $bundle_url"
    curl -fsSL --retry 2 --connect-timeout 10 --max-time 30 "$ver_url" -o "$WORK_DIR/VERSION" || printf '%s\n' "1.1.0" > "$WORK_DIR/VERSION"

    cp -f "$WORK_DIR/compose.yaml" "$APP_DIR/compose.yaml"
    cp -f "$WORK_DIR/VERSION" "$APP_DIR/VERSION"
    if [ "${BASH_SOURCE[0]}" != "$APP_DIR/install.sh" ]; then
        cp -f "${BASH_SOURCE[0]}" "$APP_DIR/install.sh" && chmod +x "$APP_DIR/install.sh" || true
    fi
    rm -rf "$APP_DIR/app_src"
    mkdir -p "$APP_DIR/app_src"
    tar -xzf "$WORK_DIR/app.tar.gz" -C "$APP_DIR/app_src"
}

sync_admin_into_container() {
    local user pwd comp payload
    user="$(env_value VPN_ADMIN_USER)"
    pwd="$(env_value VPN_ADMIN_PASSWORD)"
    comp="$(env_value VPN_COMPANY_NAME)"
    payload=$(python3 -c 'import json,sys; print(json.dumps({"username":sys.argv[1],"password":sys.argv[2],"company_name":sys.argv[3]}, ensure_ascii=False))' "${user:-admin}" "${pwd:-}" "${comp:-跑量众创 · 内部专线 VPN}")
    printf '%s\n' "$payload" | compose exec -T app python3 /app/run_admin_hub.py --set-admin --stdin-json >/dev/null
}

wait_healthy() {
    local i
    for i in $(seq 1 40); do
        if docker inspect --format '{{.State.Health.Status}}' crossborder-vpn 2>/dev/null | grep -q '^healthy$'; then
            return 0
        fi
        sleep 2
    done
    return 1
}

deploy() {
    local is_update=0
    [ -f "$APP_DIR/.env" ] && is_update=1
    touch "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"

    if [ -z "$(env_value APP_PORT)" ]; then
        set_env_value "APP_PORT" "$APP_PORT"
    fi
    prompt_admin_credentials 0
    fetch_app_bundle

    local ver
    ver="$(head -n 1 "$APP_DIR/VERSION" 2>/dev/null || echo '1.1.0')"
    set_env_value "APP_VERSION" "$ver"

    echo "==> 正在构建并启动 跑量众创跨境VPN 容器 (首次构建会预装 Mihomo / Xray / sing-box 三大内核，请稍候)..."
    compose build --pull
    compose up -d --remove-orphans
    wait_healthy || die "服务启动超时，请检查: docker logs crossborder-vpn"
    sync_admin_into_container

    echo ""
    if [ "$is_update" -eq 1 ]; then
        echo "✅ 跑量众创跨境VPN系统已更新至 v$ver（全部节点、激活码、飞书配置与域名均已保留）！"
    else
        echo "✅ 跑量众创跨境VPN系统安装成功！"
    fi
    echo "   管理员账号: $(env_value VPN_ADMIN_USER)"
    echo "   官网与下载首页: /"
    echo "   管理员控制台:   /admin"
    echo "   手机端订阅门户: /portal"
}

manage_admin_account() {
    [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/compose.yaml" ] || die "请先安装应用。"
    prompt_admin_credentials 1
    sync_admin_into_container
    echo "✅ 管理员账号密码已实时更新并生效！"
}

admin_status() {
    [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"
    compose exec -T app python3 /app/run_admin_hub.py --admin-status
}

set_origin() {
    local origin="$1"
    [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/compose.yaml" ] || die "请先安装应用。"
    if [ -n "$origin" ]; then
        validate_origin "$origin" || die "域名地址格式无效：$origin"
    fi
    set_env_value "SITE_URL" "$origin"
    if docker inspect --format '{{.State.Running}}' crossborder-vpn 2>/dev/null | grep -q '^true$'; then
        compose exec -T app python3 /app/run_admin_hub.py --set-domain "$origin" >/dev/null || true
    fi
    echo "✅ 主后台域名已更新为: ${origin:-<已清除>}"
}

main() {
    local ACTION="${1:---install}"
    [ "$#" -eq 0 ] || shift
    local origin=""
    if [ "$ACTION" = --set-domain ]; then
        [ "$#" -gt 0 ] || die "用法：--set-domain https://你的域名"
        origin="$1"; shift
    fi
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --ref) [ "$#" -ge 2 ] || die "--ref 缺少参数"; HY_REF="$2"; shift 2 ;;
            *) die "未知参数：$1" ;;
        esac
    done
    require_runtime
    case "$ACTION" in
        --install|--update) deploy ;;
        --admin-account) manage_admin_account ;;
        --admin-status) admin_status ;;
        --set-domain) set_origin "$origin" ;;
        --clear-domain) set_origin '' ;;
        --status) [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"; compose ps ;;
        --logs) [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"; compose logs --tail 100 -f app ;;
        --uninstall)
            [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"
            compose down
            printf '应用容器已卸载。全部节点、激活码、飞书配置与安装包保留在 %s/data，重装可恢复。\n' "$APP_DIR"
            ;;
        *) die "支持 --install、--update、--uninstall、--status、--logs、--set-domain、--clear-domain、--admin-account、--admin-status" ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
