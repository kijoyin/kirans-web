# Blinko

Blinko is a self-hosted note-taking and bookmarking application.

## TrueNAS NFS Setup

### 0. PostgreSQL Database Setup

Blinko requires a PostgreSQL database. Create a database and user:

```sql
-- Connect to your PostgreSQL server (10.85.89.176)
CREATE DATABASE blinko_prod;
CREATE USER blinko WITH PASSWORD 'blinko';
GRANT ALL PRIVILEGES ON DATABASE blinko_prod TO blinko;
```

Then update the `database-url` in `secrets.yaml`:
```powershell
# Create the connection string
$dbUrl = "postgresql://blinko:blinko@10.85.89.176:5432/blinko_prod"

# Base64 encode it
$dbUrlBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dbUrl))

# Copy this value to secrets.yaml
echo $dbUrlBase64
```

### 1. Create NFS Share on TrueNAS

1. **Create Dataset**:
   - Navigate to **Storage** → **Pools**
   - Select your pool and click **Add Dataset**
   - Name: `k8s/blinko` (your path: `/mnt/Primary/k8s/blinko`)
   - Click **Save**

2. **Create NFS Share**:
   - Navigate to **Sharing** → **Unix Shares (NFS)**
   - Click **Add**
   - Path: `/mnt/Primary/k8s/blinko`
   - Description: `Blinko Kubernetes Storage`
   - Click **Submit**

3. **Configure NFS Share Settings**:
   - Click the **Edit** icon on your new share
   - Under **Advanced Options**:
     - Maproot User: `root`
     - Maproot Group: `root`
     - Networks: Add your Kubernetes cluster network (e.g., `10.0.0.0/8` or be more specific)
   - Click **Save**

4. **Enable NFS Service**:
   - Navigate to **Services**
   - Find **NFS** and toggle it **ON**
   - Click the **Configure** icon (wrench) for NFS:
     - Enable NFSv4: ✓
     - Click **Save**

5. **Set Permissions** (via SSH or Shell):
   ```bash
   chmod 777 /mnt/Primary/k8s/blinko
   chown nobody:nogroup /mnt/Primary/k8s/blinko
   ```

### 2. Update Kubernetes Configuration

Update `deployment.yaml` with your TrueNAS details:

```yaml
nfs:
  server: YOUR_TRUENAS_IP  # e.g., 192.168.1.100
  path: /mnt/pool/k8s/blinko  # Your NFS share path
```

## Deployment

### Prerequisites

1. **PostgreSQL Database** (see step 0 above)
2. Complete the TrueNAS NFS setup above
3. Update the NFS server IP in `deployment.yaml` (currently set to 192.168.1.221)
4. Update both secrets in `secrets.yaml`:
   - NextAuth secret
   - Database URL

### Update Secrets (Important!)

**1. Generate NextAuth secret:**

**1. Generate NextAuth secret:**

```powershell
# Generate a random secret
$secret = openssl rand -base64 32

# Base64 encode it for Kubernetes
$secretBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($secret))

# Display - copy this value to secrets.yaml (nextauth-secret)
echo $secretBase64
```

**2. Generate Database URL secret:**

```powershell
# Replace with your actual database password
$dbUrl = "postgresql://blinko:blinko@10.85.89.176:5432/blinko_prod"

# Base64 encode it
$dbUrlBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dbUrl))

# Display - copy this value to secrets.yaml (database-url)
echo $dbUrlBase64
```

Update both values in `secrets.yaml`.

Update the `nextauth-secret` value in `secrets.yaml` with the output.

### Deploy via ArgoCD UI (Recommended)

**Important: Install NFS client on Kubernetes nodes first!**

SSH into each Kubernetes node and install NFS utilities:
```bash
# On nodes: 10.85.89.10, 10.85.89.175, and 10.85.89.176
sudo apt-get update
sudo apt-get install -y nfs-common
```

Create application in ArgoCD UI at http://argocd.local:

1. Click **+ NEW APP**
2. Fill in the details:
   - **Application Name**: `blinko`
   - **Project**: `default`
   - **Sync Policy**: `Automatic`
     - ✓ Prune Resources
     - ✓ Self Heal
   - **Repository URL**: `https://github.com/kijoyin/homelabv3`
   - **Revision**: `main`
   - **Path**: `blinko`
   - **Cluster URL**: `https://kubernetes.default.svc`
   - **Namespace**: `blinko-prod`
3. Click **CREATE**

ArgoCD will automatically sync and deploy all resources.

### Alternative: Direct Deploy

```bash
kubectl apply -f blinko/
```

### Access

- **URL**: https://blinko.local
- **Namespace**: blinko-prod
- **Port**: 1111

## Configuration

- **Database**: PostgreSQL (10.85.89.176:5432)
- **Storage**: 5Gi NFS PersistentVolume (hosted on TrueNAS)
- **Resources**:
  - Requests: 256Mi RAM, 100m CPU
  - Limits: 1Gi RAM, 1000m CPU

### Environment Variables

- `NODE_ENV`: production
- `NEXTAUTH_SECRET`: Authentication secret (stored in Kubernetes secret)
- `NEXTAUTH_URL`: Base URL for the application
- `DATABASE_URL`: PostgreSQL connection string (stored in Kubernetes secret)

### NFS Mount Options

- `nfsvers=4.1`: Use NFSv4.1 protocol
- `hard`: Retry NFS requests indefinitely
- `noatime`: Don't update access times (performance improvement)

## Troubleshooting

Check pod logs:
```bash
kubectl logs -n blinko-prod -l app=blinko
```

Check pod status:
```bash
kubectl get pods -n blinko-prod -l app=blinko
```

Describe pod for events:
```bash
kubectl describe pod -n blinko-prod -l app=blinko
```
