# 一键安装与维护

在 Harvey 主菜单进入 **11 应用系统 → 123 TikTok 知识系统**。应用菜单沿用安装、更新、卸载、域名、状态和日志操作。

首次安装会拉取发布镜像，自动启动网站、PostgreSQL 和内部数据接口，并生成管理员登录令牌。访问服务器的 `8791` 端口登录，在管理后台导入私有知识包，再新增或批量导入员工。安装目录为 `/opt/tiktok-knowledge`。

如果 GHCR 拉取失败，安装器会按服务器架构下载 GitHub Release 中的 amd64 或 arm64 镜像包，校验 SHA256 后导入 Docker。

## 域名访问

将域名解析到服务器后，在应用菜单选择 **5 添加域名访问**。脚本复用现有 Nginx 和证书功能，并同步网站的访问地址配置。已用于其他网站的域名会被拒绝覆盖。选择 **6 删除域名访问** 时只操作与此应用关联的反向代理配置。

## 更新与数据

选择 **2 更新** 会使用对应版本的发布镜像。更新前自动保存数据库及配置到 `backups/latest-pre-update`，成功后保留这一份更新前恢复包。新应用健康检查失败会尝试恢复旧应用镜像和旧配置。

应用的数据目录分别为 `data` 和 `postgres`。更新保留这些目录，菜单 **3 卸载** 也会保留全部数据和配置，随后重新安装可以继续使用。

更新前恢复包包含数据库和配置。完整迁移到另一台服务器还需要复制 `data` 中的图片、视频及知识资源。备份文件和 `.env` 含私有数据，应存放在自己的安全位置。

首次安装输出的管理员令牌也保存在 `.env` 的 `ADMIN_TOKEN` 中。应用初始化后，在后台修改的人员权限和知识内容继续以数据库为准。

## 导出与完整备份

超级管理员在「管理后台 → 数据与备份」可以导出人员、考核记录、题库、章节与历史、素材清单、审计日志和全部数据库表。人员与考核记录提供 CSV 和 JSON，其他数据提供 JSON。

“下载完整备份”生成 `.tar.gz` 文件，包含 PostgreSQL 数据库、图片、视频和正文资源。数据库中包括人员访问令牌、权限、考试答卷、题目快照和正文历史。备份生成期间，写操作会等待数据库快照和附件归档完成。

完整备份用于恢复应用数据。目标服务器的 `.env`、域名、端口和数据库连接配置继续由该服务器的安装配置提供。迁移时先在目标服务器安装同版本或更高版本应用，再上传完整备份并运行恢复命令。恢复完成后使用备份中的原管理员令牌登录。

```bash
bash /opt/tiktok-knowledge/install.sh --restore /root/tiktok-knowledge-backup.tar.gz
```

恢复需要 Python 3。安装器先校验归档路径、数据库格式、应用版本和每个文件的 SHA256，再暂停应用与内部数据接口，保存一份 `backups/latest-pre-restore` 恢复前备份，随后恢复数据库及附件。健康检查失败时会尝试回滚到恢复前的数据。恢复前备份也包含当时的部署配置。

## 命令行维护

```bash
bash /opt/tiktok-knowledge/install.sh --update
bash /opt/tiktok-knowledge/install.sh --status
bash /opt/tiktok-knowledge/install.sh --logs
bash /opt/tiktok-knowledge/install.sh --set-domain https://learn.example.com
bash /opt/tiktok-knowledge/install.sh --restore /root/tiktok-knowledge-backup.tar.gz
bash /opt/tiktok-knowledge/install.sh --uninstall
```

`--set-domain` 更新应用的站点配置，域名解析和 HTTPS 反代由菜单中的域名操作完成。需要固定源代码版本时，在安装或更新命令后追加 `--ref <40位提交SHA>`。对应的 `VERSION` 必须已有同版本发布镜像。

开发者可以用 `APP_DIR`、`APP_PORT`、`SITE_URL` 和 `TIKTOK_IMAGE` 环境变量指定初始部署参数。已有安装会继续使用 `.env` 中的端口、访问地址和凭据。
