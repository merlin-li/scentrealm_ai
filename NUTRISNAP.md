# 一餐热量 NutriSnap 后端与云端记录

独立 `/api/nutrisnap/*` 路由，复用 Next.js/Vercel 与 mysql2。MySQL 5.7 数据库 `smart_device`；仅操作 `nutrisnap_*`，不改现有 `ai72_*` 业务表。

## 当前数据库

2026-09-25 已执行 `sql/nutrisnap.sql`，新增四张表：

| 表 | 用途 |
| --- | --- |
| nutrisnap_users | UUID 用户ID；AppID + OpenID 唯一身份；首次及最近登录时间；昵称预留字段 |
| nutrisnap_sessions | 随机256位令牌的SHA-256摘要；两小时有效；退出时撤销 |
| nutrisnap_meals | 按用户隔离的饮食记录、服务器计算热量、版本号及删除标记 |
| nutrisnap_usage | 数据库共享的每分钟/每日识别请求额度 |

没有保存手机号、微信 session_key、照片或原始登录 code。用户昵称目前为空，未实现头像昵称编辑。会话身份不依赖签名密钥，老签名票据失效后客户端重新微信登录即可；不再需要 NUTRISNAP_SESSION_SECRET。

## Vercel 配置与部署

1. 设置 `NUTRISNAP.env.example` 的环境变量。`MYSQL_PASSWORD` 必须配置于 Vercel；本机 `.env.local` 不会自动同步到云端。
2. 设置一餐热量的 `NUTRISNAP_WECHAT_SECRET`（不是千问密钥）、`NUTRISNAP_VISION_API_KEY`；AppID 为 `wx7dd5a13a9e867182`。
3. 重新部署 Next.js。函数时长：登录/退出15秒、记录30秒、识别45秒；模型超时35秒。
4. 微信后台 request 合法域名添加 `https://ai.qiweiwangguo.com`，上传新版小程序。
5. 真机登录、保存一餐，另一设备登录同一微信身份查看。服务端网络必须能连到 RDS：若 Vercel 连通失败，检查 RDS访问白名单和部署地区；不要直接开放所有IP作为默认修复。

本机后端目录可能自动选择旧 Node；构建请使用 Node 22/24。已配置的 MySQL 凭据只存本地 `.env.local`，不提交 Git。公开示例文件只有空密码。

## API（全部 POST + JSON）

- `/login`：`{code}`，返回 `{token,expiresAt,user:{id,nickname}}`。通过微信 code2Session 验证后创建/复用用户及服务端会话。
- `/logout`：Bearer token，撤销本会话。离线退出会删除客户端会话；若撤销请求失败，旧服务端会话仍会在两小时后到期。
- `/recognize`：Bearer token + `{image:"纯base64"}`，返回 `{items,source:"ai"}`。二进制图片不超过3MB，以满足Vercel请求体限制。
- `/records`：Bearer token，支持：
  - `{action:"list",cursor?}`：返回最多100条 `{records,nextCursor}`；小程序会继续读取后续页。
  - `{action:"save",record}`：创建时客户端提供稳定ID，更新时携带revision；返回 `{record}`。
  - `{action:"delete",id,revision}`：删除一条记录。
  - `{action:"clear",confirm:"DELETE_ALL_MY_MEALS"}`：清空当前用户记录。
  - `{action:"import",records:[...]}`：每批最多100条，事务导入；重复ID不覆盖已有记录或复活已删除记录。

记录格式：`{id,date,meal,time,source,items:[{name,grams,kcal100}],revision?}`。热量服务端重算；任何客户端 userId 都不会用于授权。日期范围2000年起至北京时间今天。409表示另一设备已修改/删除，请同步后重新打开编辑；失败草稿留在当前页面。删除标记用于避免旧设备/旧本机记录重试时复活，当前版本不提供用户恢复入口。

## 客户端行为

未登录继续保存本机记录。登录后读取账号云端记录，保存成功后再更新本机缓存。未登录记录不会自动归属新账号，用户在“我的”确认导入。导入保留原本机副本，重复执行不会重复创建。退出后显示未登录本机记录，不展示上个账号缓存。云端缓存按账号ID隔离。

断网读取显示上次缓存和同步错误；断网保存保留当前编辑内容，不显示“云端成功”。并发修改使用版本检查，不静默覆盖。尚未实现离线写入队列或账号注销。

## 识别额度

每用户每分钟最多5次、每日默认50次（`NUTRISNAP_DAILY_RECOGNITION_LIMIT` 可设1–500），MySQL事务原子更新，Vercel多实例共享。配额按有效图片识别尝试计数，上游失败也计一次，以约束重试成本。日界线为北京时间。过期会话/配额在该用户后续登录/识别时清理；停用用户的过期数据可后续添加定时清理任务。

## 验证与迁移

- `node --test tests/nutrisnap.test.cjs`：模拟接口单测，不消耗真实额度。
- `node --env-file=.env.local tests/nutrisnap-db.integration.cjs`：显式真实数据库测试，创建本次唯一测试AppID下的用户，finally级联清理。
- `node --env-file=.env.local scripts/nutrisnap-migrate.cjs`：仅新增/验证表，支持重复运行；不会在请求或Vercel启动时自动迁移。

已通过真实MySQL的用户复用、会话摘要/撤销、跨用户隔离、增改删、幂等保存、并发版本冲突、分页、导入事务、删除标记和共享额度测试，测试数据已清理。真实微信登录仍需服务器配置AppSecret并在微信真机验证。
