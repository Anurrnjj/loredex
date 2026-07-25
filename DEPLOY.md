# Deploying Loredex — a step-by-step guide

This guide assumes you have never deployed a server application before. It
explains not just *what* to type but *where* to type it and *why*.

Target: **Oracle Cloud Always Free** — 4 ARM CPU cores, 24 GB RAM, free forever
with no expiry date. An AWS version is in the appendix at the end.

**Expect this to take 2–3 hours** the first time, most of it waiting for things
to install. There is no rush; nothing here is fragile once it works.

---

## How to read this guide

Every command block is labelled with where it runs:

> 💻 **ON YOUR LAPTOP** — the terminal on your own computer
> ☁️ **ON THE SERVER** — the terminal *after* you have SSH'd into the cloud VM

Mixing these up is the single most common beginner mistake. If a command fails
with "file not found", check which machine you are on first.

After each section there is a **✅ Checkpoint** — do not move on until it
passes. Debugging one broken step is easy; debugging five at once is not.

### Words you will see

| Term | What it means |
|---|---|
| **VM / instance** | The rented computer in Oracle's data centre. Same idea as your laptop, but it has no screen and you control it by typing. |
| **SSH** | The way you log into that computer from your laptop's terminal. |
| **Container** | A packaged, isolated program. Loredex runs as five of them. |
| **Docker Compose** | The tool that starts all five together and connects them. |
| **DNS / A record** | The phone book of the internet. An A record maps `loredex.yoursite.com` to your server's IP address. |
| **Reverse proxy** | The thing (here, Caddy) that receives web traffic and forwards it to the right container. It also gets your HTTPS certificate. |
| **Environment variable** | A setting passed to a program, kept in a file called `.env` so passwords are not written into the code. |

---

## What you need before starting

1. **A domain name** you control — e.g. `yoursite.com`. You need access to
   wherever you bought it (Namecheap, Cloudflare, GoDaddy…) to add DNS records.
2. **An Oracle Cloud account** — [signup.oraclecloud.com](https://signup.oraclecloud.com).
   It asks for a credit card to verify identity. The Always Free resources in
   this guide do not charge it.
3. **A Clerk account** — you already have one, since the app runs locally.
4. **A GitHub account** — to get your code onto the server. Free.

### ⚠️ Read this before you start

Oracle's free ARM capacity is genuinely scarce in popular regions. You may hit
**"Out of host capacity"** when creating the VM. This is normal and not your
fault — retry over a few hours, or at a quieter time of day.

Your **home region is permanent** and chosen at signup. Pick a less busy one
(e.g. not us-ashburn-1) if you have the choice, as it improves your odds.

**Confirm you can actually create the VM (Step 2) before doing anything else.**

---

## Step 1 — Put your code on GitHub

The server needs a copy of your code. The cleanest way is GitHub.

Your project is already a git repository with one commit, so you only need to
push it somewhere.

### 1a. Create an empty repository on GitHub

1. Go to [github.com/new](https://github.com/new).
2. **Repository name**: `loredex`
3. Select **Private** — your `.env` is excluded from git, but keep it private.
4. **Do not** tick "Add a README", "Add .gitignore", or "Choose a license".
   You already have those files, and adding them here causes a conflict.
5. Click **Create repository**.

GitHub then shows a page with commands. Ignore them; use the ones below.

### 1b. Push your code

> 💻 **ON YOUR LAPTOP**

```bash
cd ~/Desktop/loredex
git remote add origin https://github.com/YOUR-USERNAME/loredex.git
git branch -M main
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username.

When it asks for a password, **your GitHub account password will not work.**
GitHub requires a Personal Access Token:

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) →
   **Generate new token (classic)**.
2. **Note**: `loredex deploy`. **Expiration**: 90 days.
3. Tick the **`repo`** checkbox.
4. **Generate token**, then copy it. *It is shown only once.*
5. Paste it when git asks for a password. (It will not appear as you type —
   that is normal.)

### ✅ Checkpoint 1

Refresh your GitHub repository page. You should see your files — `README.md`,
`src/`, `Dockerfile`. If you see an empty repo, the push did not work.

---

## Step 2 — Create the server

### 2a. Create the VM

1. Log into [cloud.oracle.com](https://cloud.oracle.com).
2. Hamburger menu (☰, top left) → **Compute** → **Instances**.
3. Click **Create instance**.
4. **Name**: `loredex`
5. Under **Image and shape**, click **Edit**:
   - Click **Change image** → select **Canonical Ubuntu** → **22.04** →
     **Select image**.
   - Click **Change shape** → **Ampere** tab → **VM.Standard.A1.Flex**.
   - Set **OCPUs** to `4`. Memory auto-fills to 24 GB. → **Select shape**.

   > The **Ampere** tab matters. The default (AMD/Intel) shapes are not free at
   > this size. Ampere is ARM — which is why the Dockerfile is built for ARM.

6. Under **Networking**, leave the defaults. **"Assign a public IPv4 address"**
   must be **Yes**.
7. Under **Add SSH keys**, choose **Generate a key pair for me**, then click
   **Save private key**. It downloads a `.key` file.

   > ⚠️ **This file is your only way into the server and cannot be
   > re-downloaded.** Save it somewhere you will not lose it. Move it to
   > `~/.ssh/loredex.key` now, before you forget.

8. Click **Create**.

Wait for the state to turn from orange **PROVISIONING** to green **RUNNING**
(1–2 minutes). Then **copy the Public IP address** shown on that page — you
need it repeatedly from here on. It looks like `130.61.45.207`.

> If you get **"Out of host capacity"**: nothing you did is wrong. Wait and
> retry, as noted above.

### 2b. Add the storage disk

The free tier includes 200 GB of block storage. The VM's own 50 GB boot disk
should not hold your data.

1. ☰ → **Storage** → **Block Volumes** → **Create Block Volume**.
2. **Name**: `loredex-data`, **Size**: `150` GB. → **Create**.
3. Wait for **AVAILABLE**, then go back to your instance
   (☰ → Compute → Instances → `loredex`).
4. Scroll down to **Attached block volumes** (left-hand menu, under Resources) →
   **Attach block volume**.
5. **Volume**: `loredex-data`, **Attachment type**: *Paravirtualized*,
   **Access**: *Read/write*. → **Attach**.

### ✅ Checkpoint 2

Your instance page shows **RUNNING**, a public IP, and one attached block
volume.

---

## Step 3 — Log into the server

> 💻 **ON YOUR LAPTOP**

```bash
chmod 400 ~/.ssh/loredex.key
ssh -i ~/.ssh/loredex.key ubuntu@YOUR-SERVER-IP
```

Replace `YOUR-SERVER-IP` with the IP you copied. The username is `ubuntu` —
that is Oracle's default for Ubuntu images, not something you chose.

The first time, it asks:

```
The authenticity of host '...' can't be established.
Are you sure you want to continue connecting (yes/no)?
```

Type `yes` and press Enter.

**The `chmod 400` is required.** Without it SSH refuses the key with
"UNPROTECTED PRIVATE KEY FILE" — it will not use a key other users could read.

### ✅ Checkpoint 3

Your prompt changes to something like `ubuntu@loredex:~$`. **You are now on the
server.** Everything from here until Step 9 runs here.

To leave at any point, type `exit`. To come back, run the same `ssh` command.

---

## Step 4 — Mount the storage disk

> ☁️ **ON THE SERVER**

```bash
lsblk
```

You will see a list of disks. Find the 150 GB one — it is usually `sdb`.
`sda` is the 50 GB boot disk; **do not touch `sda`**.

```bash
sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /data
echo '/dev/sdb /data ext4 defaults,_netdev,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir -p /data/postgres /data/minio /data/backups
```

What these do, in order: format the disk, create the folder to attach it to,
record it in `/etc/fstab` so it re-attaches automatically after a reboot, attach
it now, and create the three folders your data will live in.

> `mkfs.ext4` **erases** the target disk. It is empty and new here, which is why
> this is safe. Double-check you typed `sdb`, not `sda`.

### ✅ Checkpoint 4

```bash
df -h /data
```

Shows roughly 147G available. If it shows your boot disk size instead, the
mount did not work.

---

## Step 5 — Open the firewall (both of them)

Oracle has **two independent firewalls**. Configuring only one is the most
common way to lose an afternoon: the symptom is a website that simply never
responds, with nothing in any log explaining why.

### 5a. Firewall 1 — Oracle's cloud firewall

In the Oracle web console (in your browser, not the terminal):

1. ☰ → **Networking** → **Virtual Cloud Networks**.
2. Click your VCN (probably `vcn-<date>`).
3. Left menu → **Security Lists** → click the **Default Security List**.
4. Click **Add Ingress Rules**, and add these **two** rules:

| Field | Rule 1 (HTTP) | Rule 2 (HTTPS) |
|---|---|---|
| Stateless | No | No |
| Source Type | CIDR | CIDR |
| Source CIDR | `0.0.0.0/0` | `0.0.0.0/0` |
| IP Protocol | TCP | TCP |
| Destination Port Range | `80` | `443` |

`0.0.0.0/0` means "from anywhere on the internet", which is what a public
website needs.

### 5b. Firewall 2 — the one inside Ubuntu

Oracle's Ubuntu images ship with iptables rules that silently drop this traffic
even after you have allowed it above.

> ☁️ **ON THE SERVER**

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

The last line makes the change survive a reboot. Without it, your site works
until the server restarts and then mysteriously stops.

### ✅ Checkpoint 5

```bash
sudo iptables -L INPUT -n --line-numbers | grep -E "dpt:80|dpt:443"
```

Two lines, both saying `ACCEPT`.

---

## Step 6 — Install Docker

> ☁️ **ON THE SERVER**

Copy this whole block and paste it in one go:

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
sudo usermod -aG docker $USER
sudo systemctl enable --now docker
```

That last-but-one line lets you run Docker without typing `sudo` every time —
but it only takes effect on a fresh login. So:

```bash
exit
```

then SSH back in:

> 💻 **ON YOUR LAPTOP**

```bash
ssh -i ~/.ssh/loredex.key ubuntu@YOUR-SERVER-IP
```

### ✅ Checkpoint 6

> ☁️ **ON THE SERVER**

```bash
docker run hello-world
```

Prints "Hello from Docker!". If you get "permission denied", you did not log
out and back in.

---

## Step 7 — Point your domain at the server

Decide your two addresses now. Using `yoursite.com` as an example:

- **`loredex.yoursite.com`** — the app itself
- **`s3.loredex.yoursite.com`** — file storage

> **Why two?** When you upload a file, your browser sends it *directly* to the
> storage service rather than through the app — that is what lets a 300 MB zip
> upload without straining the server. For that, storage needs its own public
> address and its own HTTPS certificate.

Go to wherever your domain is registered, find the **DNS** or **DNS Records**
section, and add two records:

| Type | Name / Host | Value / Points to | TTL |
|---|---|---|---|
| A | `loredex` | `YOUR-SERVER-IP` | Automatic |
| A | `s3.loredex` | `YOUR-SERVER-IP` | Automatic |

> **Enter the Name field exactly as shown** — just `loredex`, not the full
> `loredex.yoursite.com`. Almost every registrar appends your domain
> automatically, and typing the full name creates
> `loredex.yoursite.com.yoursite.com`.
>
> **Cloudflare users:** set the proxy toggle (the orange cloud) to **DNS only /
> grey**. Leaving it orange breaks Caddy's certificate request and file uploads.

### ✅ Checkpoint 7

Wait 5–10 minutes, then:

> 💻 **ON YOUR LAPTOP**

```bash
dig +short loredex.yoursite.com
dig +short s3.loredex.yoursite.com
```

Both must print your server's IP. **Do not continue until they do** — Caddy
will fail to get certificates and then wait a long time before retrying.

---

## Step 8 — Set up Clerk for production

The `pk_test_` keys you have been using **only work on localhost**. Production
needs a separate set.

### 8a. Create the production instance

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and select your
   application.
2. At the **top-left**, there is a dropdown showing **Development**. Click it,
   then choose **Production** (or **Create production instance**).
3. It asks for your domain. Enter: **`loredex.yoursite.com`**
4. Click **Create application** / **Deploy**.

### 8b. Add Clerk's DNS records

Clerk now shows a table of DNS records it needs — typically 4–5 CNAME records
with names like `clerk`, `accounts`, `clkmail`, and two beginning `clk._domainkey`.

Add **every one** to your registrar, the same place you added the A records in
Step 7:

- **Type**: CNAME (not A)
- **Name/Host**: exactly what Clerk shows in its "Host" column
- **Value/Target**: exactly what Clerk shows in its "Value" column

Again, Cloudflare users: **grey cloud / DNS only** for all of these.

Then click **Verify** in Clerk. Records usually verify within minutes, though
they can take longer. You can continue to Step 8c while waiting.

### 8c. Copy the production API keys

In the Clerk dashboard, still with **Production** selected at the top:

1. Left sidebar → **API keys** (sometimes under *Configure* → *API keys*).
2. Copy the **Publishable key** — it begins `pk_live_`.
3. Next to **Secret key**, click the eye/reveal icon, then copy it — it begins
   `sk_live_`.

Paste both into a scratch file for a moment. You need them in Step 9.

> If your keys still start with `pk_test_`, you are looking at the Development
> instance. Switch the dropdown at the top-left to Production.

### 8d. Add the webhook

**What a webhook is:** when someone updates their name or deletes their account
in Clerk, Clerk needs to tell your app. It does this by sending a message to a
URL you give it. Without this, Loredex still works — people can sign in and
upload — but profile changes will not sync.

1. In the Clerk dashboard, **Production** still selected, left sidebar →
   **Webhooks**. (If you do not see it, look under **Configure**.)
2. Click **Add Endpoint**.
3. In **Endpoint URL**, type exactly:

   ```
   https://loredex.yoursite.com/api/webhooks/clerk
   ```

   (Your domain, and that exact path. It must be `https://`.)

4. **Subscribe to events** — find and tick these three:
   - `user.created`
   - `user.updated`
   - `user.deleted`

   Leave everything else unticked.

5. Click **Create**.
6. You are taken to the endpoint's page. Find **Signing Secret**, click
   **reveal** / the eye icon, and copy it. It begins `whsec_`.

> ⚠️ **This signing secret is different from your development one.** It is how
> your app verifies a message genuinely came from Clerk. If you paste the dev
> secret here, every webhook is rejected and users will exist in Clerk but not
> in your database.

You now have three values to carry into the next step:

```
pk_live_...     (publishable key)
sk_live_...     (secret key)
whsec_...       (webhook signing secret)
```

### ✅ Checkpoint 8

You have all three values, and Clerk shows your domain as **Verified**. (If
verification is still pending, continue — you can revisit it before Step 10.)

---

## Step 9 — Deploy the application

> ☁️ **ON THE SERVER**

### 9a. Download your code

```bash
cd ~
git clone https://github.com/YOUR-USERNAME/loredex.git
cd loredex
```

Since the repository is private, it asks for your GitHub username and password.
**Use the Personal Access Token from Step 1b as the password**, not your real
account password.

### 9b. Generate the database and storage passwords

These are internal passwords the containers use to talk to each other. You will
never type them by hand, so make them long and random:

```bash
openssl rand -base64 24   # run this 3 times, keep each result
```

Run it three times and keep all three outputs — one for the database password,
two for storage.

### 9c. Write the configuration file

```bash
nano .env
```

`nano` is a simple text editor inside the terminal. Paste in the block below,
replacing every `...` with your real values:

```ini
# Your two addresses from Step 7 — no https://, no trailing slash
APP_DOMAIN=loredex.yoursite.com
S3_DOMAIN=s3.loredex.yoursite.com

# Database — paste your first generated password
POSTGRES_USER=loredex
POSTGRES_PASSWORD=paste-first-random-string-here
POSTGRES_DB=loredex

# File storage — paste the second and third
S3_BUCKET=loredex
S3_ACCESS_KEY=paste-second-random-string-here
S3_SECRET_KEY=paste-third-random-string-here
S3_REGION=us-east-1

# From Step 8 — these must be the pk_live_/sk_live_ production keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...

# Largest file anyone can upload, in bytes. 536870912 = 512 MB
MAX_UPLOAD_BYTES=536870912
```

**To save and exit nano:** press `Ctrl+O`, then `Enter` (writes the file), then
`Ctrl+X` (exits).

Then lock the file down so only you can read it:

```bash
chmod 600 .env
```

> You do not set `DATABASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, or
> `NEXT_PUBLIC_APP_URL`. Those are assembled automatically from the values
> above — see `docker-compose.prod.yml`.

### 9d. Build and start

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

**This takes 10–25 minutes.** It downloads Ubuntu packages and installs
LibreOffice (needed to read PowerPoint and older Office files). Scrolling text
is normal. Go and make a coffee.

If your SSH connection drops during the build, the build keeps running on the
server. Reconnect and check with `docker compose -f docker-compose.prod.yml ps`.

### 9e. Set up the database and storage

Once the build finishes:

```bash
docker compose -f docker-compose.prod.yml exec web node jobs/migrate.js
docker compose -f docker-compose.prod.yml exec web node jobs/init-storage.js
```

The first creates the database tables. The second creates the storage bucket and
verifies uploads actually work.

Expected output from the second command:

```
✓ bucket "loredex" exists
✓ server-side write works
✓ presigned upload works
```

### ✅ Checkpoint 9

```bash
docker compose -f docker-compose.prod.yml ps
```

Five services listed, all showing `Up` (postgres, minio and web also say
`healthy`). Then:

```bash
curl https://loredex.yoursite.com/api/health
```

Expected: `{"status":"ok","checks":{"database":"ok","storage":"ok"}}`

If `curl` hangs or refuses, give Caddy another minute to obtain certificates,
then check `docker compose -f docker-compose.prod.yml logs caddy`.

---

## Step 10 — Test it properly

Open **`https://loredex.yoursite.com`** in a browser.

Work through all six. Each one checks a different part of the system.

**1. HTTPS works.** There is a padlock in the address bar and no warning.

**2. Sign up.** Create an account. You should land on the search page.

**3. The webhook fired.**

> ☁️ **ON THE SERVER**

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U loredex -d loredex -c 'select id, email from users;'
```

Your email should be listed. If the table is empty, the webhook is
misconfigured — recheck the URL and that you used the **production** signing
secret. (See Troubleshooting.)

**4. Upload works.** Upload a Markdown file, a PDF, and a zip. Each should move
`Queued → Extracting → Ready`. If they stay on Queued, the worker container is
not running.

**5. Search reads inside files.** Search for a word that appears **inside** one
of those files, not in its filename. This is the whole point of the app.

**6. Sharing works.** Open a document, set Visibility to **Public**, copy the
share link, and open it in a **private/incognito window**. It should load
without signing in.

### ✅ Checkpoint 10

All six pass. **Loredex is live.** 🎉

---

## Keeping it running

### Backups

Set these up now, not later.

> ☁️ **ON THE SERVER**

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
echo "0 3 * * * root /usr/local/bin/loredex-backup.sh" | sudo tee /etc/cron.d/loredex-backup
```

This backs up the database and files at 3 AM daily, keeping 7 days.

Run it once now to confirm it works:

```bash
sudo /usr/local/bin/loredex-backup.sh && ls -lh /data/backups
```

Also enable Oracle's own volume backups: ☰ → Storage → Block Volumes → your
volume → **Backup Policy** → assign **Bronze**. That covers losing the whole VM.

> **An untested backup is a guess.** Once, restore a dump into a scratch
> database and confirm the row counts match. Better to find out now.

### Updating after you change the code

> 💻 **ON YOUR LAPTOP** — push your changes

```bash
cd ~/Desktop/loredex
git add -A && git commit -m "describe your change"
git push
```

> ☁️ **ON THE SERVER** — pull and rebuild

```bash
cd ~/loredex
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml exec web node jobs/migrate.js
```

### Watching what it is doing

```bash
# Live logs (Ctrl+C to stop watching — this does not stop the app)
docker compose -f docker-compose.prod.yml logs -f web worker

# Is everything running?
docker compose -f docker-compose.prod.yml ps

# Restart everything
docker compose -f docker-compose.prod.yml restart

# Free disk space
df -h /data
```

Log rotation is already configured, so logs cannot fill the disk.

### Uptime monitoring

Sign up for a free monitor ([uptimerobot.com](https://uptimerobot.com) works)
and point it at `https://loredex.yoursite.com/api/health` every 5 minutes. That
endpoint returns an error status if the database or storage is unreachable, so
you hear about problems before you next try to use the site.

---

## Troubleshooting

### The site does not load at all

Work through in order:

```bash
# 1. Are the containers running?
docker compose -f docker-compose.prod.yml ps

# 2. Did Caddy get a certificate?
docker compose -f docker-compose.prod.yml logs caddy | tail -30

# 3. Does DNS point here?
dig +short loredex.yoursite.com     # must equal your server IP

# 4. Is the Ubuntu firewall open? (Step 5b)
sudo iptables -L INPUT -n | grep -E "dpt:80|dpt:443"
```

The most common cause is skipping Step 5b, the second firewall.

### Uploads fail with a vague network error

Storage CORS. `MINIO_API_CORS_ALLOW_ORIGIN` in `docker-compose.prod.yml` must
match your app address **exactly**, including `https://` and with no trailing
slash. It is built from `APP_DOMAIN`, so check that line in `.env` — a stray
`https://` or `/` there is the usual culprit.

### Users can sign in, but the users table is empty

The webhook is not reaching your app, or is being rejected.

1. Clerk dashboard → **Webhooks** → click your endpoint → **Message Attempts**.
   Failed deliveries are listed with the response your server gave.
   - **404** → the URL is wrong. It must end `/api/webhooks/clerk`.
   - **400** → wrong signing secret. Re-copy it and update `.env`, then
     `docker compose -f docker-compose.prod.yml up -d`.
   - **Nothing listed** → the endpoint was created on the *Development*
     instance. Switch to Production and add it again.
2. Check your own logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs web | grep clerk-webhook
   ```

Note that people can still sign in and use the app meanwhile — the app creates
a missing user row as a fallback.

### Documents stay on "Queued" forever

The worker is not running.

```bash
docker compose -f docker-compose.prod.yml ps worker
docker compose -f docker-compose.prod.yml logs worker | tail -40
```

### A PowerPoint file fails to process

Usually LibreOffice running out of memory on a large file. Check
`docker compose -f docker-compose.prod.yml logs worker`, then raise `mem_limit`
under the `worker` service in `docker-compose.prod.yml` (default `3g`) and
restart. You have 24 GB to work with.

### "Publishable key not valid"

The `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `.env` is wrong or truncated.
Re-copy it from Clerk. Note this key is baked in **at build time**, so after
fixing it you must rebuild, not just restart:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

### I lost my SSH key

It cannot be recovered. You can attach a new key through the Oracle console
(instance → **Console connection**), or recreate the instance. This is why Step
2a says to save it immediately.

---

## Appendix — deploying to AWS instead

The application is identical; only the surrounding services change.

| Oracle | AWS equivalent |
|---|---|
| Ampere A1 (4 core / 24 GB, free forever) | EC2 `t4g.small` — the free-tier `t3.micro` has 1 GB RAM, too little for Postgres and LibreOffice together |
| Postgres container | RDS Postgres `db.t4g.micro`, or keep the container |
| MinIO container | An S3 bucket |
| VCN Security List | Security Group (only one firewall — no iptables step) |
| Block Volume | EBS volume |

To use a real S3 bucket instead of MinIO:

1. Delete the `minio` service from `docker-compose.prod.yml`.
2. Remove the `{$S3_DOMAIN}` block from the `Caddyfile`.
3. In `docker-compose.prod.yml`, set `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` to
   `https://s3.<region>.amazonaws.com`, and `S3_FORCE_PATH_STYLE` to `"false"`.
4. Set `S3_ACCESS_KEY` / `S3_SECRET_KEY` to an IAM user's credentials.
5. Add a CORS policy on the bucket allowing `PUT` and `GET` from your app
   domain — the same rule MinIO gets via `MINIO_API_CORS_ALLOW_ORIGIN`.

No application code changes, because both speak the same S3 API.

**Cost warning:** the AWS free tier expires after 12 months, after which this
setup runs roughly $15–25/month. Oracle's does not expire.
