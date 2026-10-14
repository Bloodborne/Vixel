#!/bin/sh
# Vixel Server 容器入口：PUID/PGID（群晖 Container Manager 习惯）支持。
#
#   - 以 root 启动（默认）：把 vixel 用户改成 PUID/PGID（默认 1000:1000），
#     只 chown /data（库挂载点 /photos 永远不动 —— 原文件只读），然后降权执行。
#   - 以 --user 启动：直接执行（此时 PUID/PGID 不生效，/data 权限由用户自备）。
#   - 附加组：compose 里 group_add（如群晖 administrators = 101）给的组降权后保留 ——
#     群晖共享文件夹常只授权给某个用户组，进程只有主组 PGID 就读不到照片。
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

  # Docker 给 root 进程的附加组（group_add），去掉 root 自己的 0
  extra_groups="$(id -G | tr ' ' '\n' | grep -vx 0 | grep -vx "$PGID" | paste -sd, -)"
  echo "[entrypoint] running as uid=$PUID gid=$PGID${extra_groups:+ groups=$extra_groups}"
  if [ -n "$extra_groups" ]; then
    exec setpriv --reuid "$PUID" --regid "$PGID" --groups "$extra_groups" "$@"
  fi
  exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups "$@"
fi

exec "$@"
