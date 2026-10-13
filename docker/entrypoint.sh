#!/bin/sh
# Vixel Server 容器入口：PUID/PGID（群晖 Container Manager 习惯）支持。
#
#   - 以 root 启动（默认）：把 vixel 用户改成 PUID/PGID（默认 1000:1000），
#     只 chown /data（库挂载点 /photos 永远不动 —— 原文件只读），然后降权执行。
#   - 以 --user 启动：直接执行（此时 PUID/PGID 不生效，/data 权限由用户自备）。
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  current_gid="$(id -g vixel)"
  current_uid="$(id -u vixel)"
  [ "$current_gid" = "$PGID" ] || groupmod -o -g "$PGID" vixel
  [ "$current_uid" = "$PUID" ] || usermod -o -u "$PUID" vixel

  # 只有属主不对时才递归 chown（大数据目录每次启动都递归会很慢）
  data_dir="${VIXEL_DATA_DIR:-/data}"
  if [ -d "$data_dir" ]; then
    owner="$(stat -c '%u:%g' "$data_dir")"
    if [ "$owner" != "$PUID:$PGID" ]; then
      chown -R "$PUID:$PGID" "$data_dir"
    fi
  fi

  exec setpriv --reuid "$PUID" --regid "$PGID" --init-groups "$@"
fi

exec "$@"
