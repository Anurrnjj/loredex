# Deploying Loredex

Target: **Oracle Cloud Always Free** (4 ARM cores, 24 GB RAM, free with no
expiry). An AWS mapping is in the appendix.

The whole stack is five containers on one VM: Caddy, Postgres, MinIO, the web
server, and the extraction worker. Only Caddy is exposed to the internet.

---

## Before you start

You need:

- A domain you control (two DNS records: the app and the storage host)
- A Clerk account (free tier covers 10,000 monthly active users)
- An Oracle Cloud account

**A warning worth having up front:** Oracle's free ARM capacity is genuinely
scarce in popular regions, and signup rejects some cards. Confirm you can
actually launch the VM before you build anything around it. If you get "Out of
capacity", retry later or pick a different home region — the region is fixed
once chosen.

---

## 1. Provision the VM

In the Oracle Cloud console → **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Shape | **Ampere A1 Flex**, 4 OCPU / 24 GB |
| Image | Ubuntu 22.04 (**arm64**) |
| Boot volume | 50 GB |
| SSH key | Generate and **download it now** |

The private key is not recoverable after creation. Save it before you leave the
page.

Then **Storage → Block Volumes → Create**: 150 GB, attach it to the instance as
`/dev/oracleoci/oraclevdb`, and mount it at `/data`.

```bash
sudo mkfs.ext4 /dev/oracleoci/oraclevdb
sudo mkdir -p /data
echo '/dev/oracleoci/oraclevdb /data ext4 defaults,_netdev,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir -p /data/postgres /data/minio /data/backups
```

## 2. Open the ports — both firewalls

Oracle has **two** layers, and missing the second one is the classic time sink.

**Layer 1 — VCN Security List** (console → Networking → VCN → Security Lists):
add ingress rules for TCP 80 and 443 from `0.0.0.0/0`. Leave 22 restricted to
your own IP.

**Layer 2 — the OS firewall.** Oracle's Ubuntu images ship with iptables rules
that drop traffic even when the security list allows it. Symptom: the port
scans as closed and Caddy's certificate request times out, with nothing in any
log to explain it.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER   # log out and back in for this to take effect
sudo systemctl enable --now docker
```

## 4. DNS

Two `A` records pointing at the VM's public IP:

```
loredex.yourdomain.com     A    <vm-ip>
s3.loredex.yourdomain.com  A    <vm-ip>
```

The second one matters. Presigned uploads and downloads go **directly** from
the browser to MinIO, so the storage host needs to be publicly reachable and
have its own certificate. Routing it through the app would defeat the purpose.

Wait for propagation before first start (`dig +short loredex.yourdomain.com`) —
Caddy's ACME challenge fails if the records are not live yet, and it then backs
off before retrying.

## 5. Set up Clerk for production

Clerk gives you two instances. The `pk_test_` keys you developed against work
only on localhost.

1. Clerk dashboard → your app → **Create production instance**.
2. Add the CNAME records it lists (`clerk`, `accounts`, plus DKIM records for
   its emails) to your DNS. Propagation is usually minutes.
3. Copy the `pk_live_` / `sk_live_` keys.
4. **Webhooks → Add endpoint**: `https://loredex.yourdomain.com/api/webhooks/clerk`,
   subscribed to `user.created`, `user.updated`, `user.deleted`.
5. Copy that endpoint's signing secret. **It differs from the development
   one** — reusing the dev secret makes every webhook fail signature
   verification, and users then exist in Clerk but not in your database.

## 6. Deploy

```bash
git clone <your-repo> loredex && cd loredex
cp .env.example .env
nano .env      # fill in the production values below
chmod 600 .env
```

`.env` on the server needs:

```ini
APP_DOMAIN=loredex.yourdomain.com
S3_DOMAIN=s3.loredex.yourdomain.com

POSTGRES_USER=loredex
POSTGRES_PASSWORD=<long random string>
POSTGRES_DB=loredex

S3_BUCKET=loredex
S3_ACCESS_KEY=<long random string>
S3_SECRET_KEY=<long random string>
S3_REGION=us-east-1

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...

MAX_UPLOAD_BYTES=536870912
```

`DATABASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, and `NEXT_PUBLIC_APP_URL`
are derived from these in `docker-compose.prod.yml`; you do not set them by
hand.

Generate secrets with `openssl rand -base64 32`.

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

The first build takes 10–20 minutes on Ampere — LibreOffice is a large
install. Then:

```bash
docker compose -f docker-compose.prod.yml exec web node jobs/migrate.js
docker compose -f docker-compose.prod.yml exec web node jobs/init-storage.js
```

## 7. Verify

```bash
curl https://loredex.yourdomain.com/api/health
# {"status":"ok","checks":{"database":"ok","storage":"ok"}}
```

Then in a browser:

1. Sign up. Confirm the webhook landed:
   `docker compose -f docker-compose.prod.yml exec postgres psql -U loredex -d loredex -c 'select id,email from users;'`
   An empty table means the webhook is misconfigured — check the URL and that
   you used the **production** signing secret.
2. Upload a Markdown file, a PDF, and a zip. Watch each go
   `Queued → Extracting → Ready`.
3. Search for a word that appears **inside** one of them, not in its filename.
4. Open a document; check the browser devtools Network tab shows the file
   request going to `s3.loredex.yourdomain.com`, not through the app.
5. Set a document to Public, open its `/p/<id>` link in a private window.

---

## Operations

### Backups

```bash
sudo tee /usr/local/bin/loredex-backup.sh > /dev/null <<'EOF'
#!/bin/bash
set -euo pipefail
cd /home/ubuntu/loredex
STAMP=$(date +%Y%m%d-%H%M%S)

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U loredex loredex | gzip > /data/backups/db-$STAMP.sql.gz

tar czf /data/backups/minio-$STAMP.tar.gz -C /data minio

find /data/backups -name '*.gz' -mtime +7 -delete
EOF
sudo chmod +x /usr/local/bin/loredex-backup.sh

# 3am daily
echo "0 3 * * * root /usr/local/bin/loredex-backup.sh" | sudo tee /etc/cron.d/loredex-backup
```

Also enable Oracle's block-volume backup policy in the console — that covers
the case where the VM itself is gone.

**Restore one before you trust it.** An untested backup is a guess:

```bash
gunzip -c /data/backups/db-<stamp>.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U loredex -d loredex_restore_test
```

### Updating

```bash
cd loredex && git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml exec web node jobs/migrate.js
```

Run migrations after the new image is up — they are written to be additive, so
the old container tolerates the new schema during the brief overlap.

### Logs

```bash
docker compose -f docker-compose.prod.yml logs -f web worker
```

Log rotation is configured in the compose file (10 MB × 3 per service).
Without it, logs eventually fill the boot disk.

### Monitoring

Point any uptime monitor at `https://loredex.yourdomain.com/api/health`. It
returns 503 if Postgres or MinIO is unreachable, so a dependency failure pages
you instead of surfacing later as confusing 500s.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Uploads fail with a network error and no status code | MinIO CORS. `MINIO_API_CORS_ALLOW_ORIGIN` must exactly match your app origin, scheme included. |
| Signature errors on upload/download | `S3_PUBLIC_ENDPOINT` must be the host the *browser* uses. Signing with `http://minio:9000` produces a signature the storage server rejects. |
| Users in Clerk but not in the database | Wrong webhook signing secret (dev vs production), or the endpoint URL is wrong. |
| Caddy cannot get a certificate | DNS not propagated, or the OS iptables rules from step 2 were skipped. |
| `.pptx` uploads fail extraction | LibreOffice OOM. Check `docker compose logs worker`; raise the worker's `mem_limit`. |
| Everything stuck on "Queued" | The worker container is not running. `docker compose ps`. |

---

## Appendix — the same stack on AWS

The compose file and ports are unchanged; only the managed pieces move.

| Oracle | AWS |
|---|---|
| Ampere A1 (4 core / 24 GB, free forever) | EC2 `t4g.small` — free tier is `t3.micro` at 1 GB, too small for Postgres + LibreOffice together |
| Postgres container | RDS Postgres `db.t4g.micro`, or keep the container |
| MinIO container | S3 bucket — delete the service, set `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT` to the S3 URL, set `S3_FORCE_PATH_STYLE=false`, drop the `s3` block from the Caddyfile |
| VCN Security List | Security Group (only one firewall layer — no iptables step) |
| Block volume | EBS |

Because storage is the S3 API either way, moving to S3 is environment variables
and deleting a service — no application code changes.

AWS free tier expires after 12 months; budget roughly $15–25/month after that.
Oracle's does not expire.
