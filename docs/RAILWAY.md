# Railway deployment — ETK-KIT (working recipe)

Live deployment of PhantomRipperRMM.

| Item | Value |
|------|-------|
| Project | `ETK-KIT` (`205965a4-c708-4c61-9c00-3dbf6e43d91c`) |
| Panel service | `etk-kit` (`55b43f43-5e92-4753-bba5-ea64d08b77dc`) |
| Database | `MySQL` (`0b945374-02b9-4c43-b7f0-1eeb3b401d44`) |
| URL | https://etk-kit-production.up.railway.app |
| Admin | `operator` (password set via `ADMIN_PASS`) |
| Plan | HOBBY (1 GB RAM / 2 vCPU per container) |

## Panel environment variables

```
NODE_ENV=production
HOST=0.0.0.0
PORT=8443
JWT_SECRET=<64 hex>
ADMIN_USER=operator
ADMIN_PASS=<set yours>
C2_HOST=etk-kit-production.up.railway.app
C2_PORT=443
C2_SCHEME=https
MYSQL_URL=${{MySQL.MYSQL_URL}}      # Railway reference → internal URL
```

The panel auto-detects MySQL from `MYSQL_URL` / `DATABASE_URL` / `MYSQLHOST…`
and falls back to bundled SQLite when none is present.

## Deploy commands (CLI, account token)

```powershell
$env:RAILWAY_API_TOKEN = "<account-token>"
cd D:\PhantomRipperRMM
railway init --name ETK-KIT
railway add --database mysql
railway add --service etk-kit
railway variable set NODE_ENV=production --service etk-kit --skip-deploys
# ... (all vars above)
railway service link etk-kit
railway domain --service etk-kit --port 8443
railway up --service etk-kit --detach
```

## Gotchas solved (read before redeploying)

1. **Docker Hub rate limits (429 / 504).** Railway's shared builders hit
   `docker.io` limits. Both the MySQL service image and the panel base image
   were switched to the **AWS ECR Public mirror**:
   - MySQL → `public.ecr.aws/docker/library/mysql:8`
   - Panel base → `public.ecr.aws/docker/library/node:24-bookworm-slim`
   (Dockerfile.panel already uses the mirror.)

2. **HOBBY = 1 GB RAM.** Railway's stock MySQL starts with
   `--innodb-buffer-pool-size=1G`, which OOMs the 1 GB container. Override the
   MySQL start command:
   ```
   docker-entrypoint.sh mysqld --innodb-use-native-aio=0 --disable-log-bin \
     --performance_schema=0 --innodb-buffer-pool-size=256M --max-connections=100
   ```

3. **Railpack hijacks the build.** Railway defaults to Railpack auto-detect and
   ignores a `Dockerfile` unless told. Set the service instance `dockerfilePath`:
   ```
   serviceInstanceUpdate(input:{ dockerfilePath:"docker/Dockerfile.panel" })
   ```

4. **`serviceInstanceRedeploy` reuses the old image tag.** After changing
   `source.image`, use `serviceInstanceDeployV2` for a *fresh* deploy that
   honours the new config.

## Diagnosing failures via the API

Deployment failures surface in `deploymentEvents` → `payload.error`, not in
`deploymentLogs` (which is empty when a container dies before logging).
Example error seen: `The registry returned "504 Gateway Timeout" for the image …`.

`buildLogs(deploymentId:)` shows the Docker/Railpack build output.

## Redeploy after code changes

```powershell
$env:RAILWAY_API_TOKEN = "<account-token>"
cd D:\PhantomRipperRMM
railway up --service etk-kit --detach
```

`.railwayignore` keeps `node_modules`, `data/`, `.env` out of the upload.
