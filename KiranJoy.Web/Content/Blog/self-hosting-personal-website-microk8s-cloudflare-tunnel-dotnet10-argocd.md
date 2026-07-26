---
title: "How I Self-Host My Personal Website on a MicroK8s Home Lab with Cloudflare Tunnel, .NET 10, and ArgoCD"
lead: "A practical walkthrough of the stack behind your-domain.com — 3-node HA MicroK8s cluster, Cloudflare Tunnel for zero-trust ingress, .NET 10 static site generation with BlazorStatic, multi-stage Docker build with Pagefind search, and GitOps via ArgoCD."
published: 2025-07-26
tags: [home-lab, kubernetes, microk8s, cloudflare-tunnel, dotnet, blazor, argocd, gitops, self-hosting]
authors:
    - name: "Kiran Joy"
---

> **The philosophy**: Personal projects are deliberate practice for professional engineering. This isn't about saving $5/month on hosting — it's about running production-grade infrastructure at home so the patterns, failures, and operational scars translate directly to work.

---

## The Stack at a Glance

| Layer | Technology | Why |
|-------|------------|-----|
| **Hardware** | 3× Lenovo ThinkCentre M710q/M73 (i3/i5, 16GB RAM, 465GB–1TB SSD) | Cheap, quiet, low power, x86 — real Kubernetes, not toy clusters |
| **Kubernetes** | MicroK8s 1.30+ (HA, 3 control planes) | Vanilla K8s, Canonical-backed, snap-managed, HA in ~1 hour |
| **Ingress** | Cloudflare Tunnel (`cloudflared`) | Zero open ports, DDoS protection, free TLS, works behind CGNAT |
| **App** | .NET 10 + BlazorStatic → static HTML/CSS/JS | Zero runtime, trivial to cache, deploys anywhere nginx runs |
| **Search** | Pagefind (client-side, zero infra) | Static search index built at deploy time |
| **Container** | Multi-stage Dockerfile (SDK → Node → nginx) | Reproducible, cached layers, <50MB final image |
| **GitOps** | ArgoCD + GitHub Actions → ghcr.io | Push to main → image builds → ArgoCD syncs → live |
| **Observability** | Umami (self-hosted analytics), structured logs | No Google Analytics, full data ownership |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            INTERNET                                         │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ HTTPS (Cloudflare edge)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE TUNNEL                                    │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────────────┐  │
│  │  DNS:       │    │  cloudflared     │    │  No open ports on router   │  │
│  │  domain.com ────►  (daemonset)   ────►      No public IP needed       │  │
│  │  www        │    │  outbound only   │    │  DDoS/WAF included free    │  │
│  └─────────────┘    └──────────────────┘    └────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ HTTP (internal)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MICROK8S HA CLUSTER (3 NODES)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                          │
│  │ control-1   │  │ control-2   │  │ control-3   │  ← 3 control planes      │
│  │ (worker)    │  │ (worker)    │  │ (worker)    │  ← also schedulable      │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                          │
│         │                │                │                                 │
│         └────────────────┼────────────────┘                                 │
│                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        INGRESS-NGINX (DaemonSet)                     │   │
│  │  • TLS termination (Cloudflare certs)                                │   │
│  │  • Rate limiting, caching headers                                    │   │
│  │  • Routes → my-web-app Service                                       │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                           │
│                                 ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     my-web-app Deployment                            │   │
│  │  • 2 replicas (anti-affinity across nodes)                           │   │
│  │  • nginx:alpine serving static files                                 │   │
│  │  • Pagefind search index in /pagefind                                │   │
│  │  • Health: /healthz, Ready: /ready                                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 │                                           │
│                    ┌────────────┴────────────┐                              │
│                    ▼                         ▼                              │
│            ┌─────────────┐           ┌─────────────┐                        │
│            │  ArgoCD     │           │  Umami      │                        │
│            │  (GitOps)   │           │  Analytics  │                        │
│            └─────────────┘           └─────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. The Cluster: MicroK8s HA on Commodity Hardware

I wrote the [Day 1](/blog/how-to-build-a-high-availability-kubernetes-home-lab-with-microk8s-and-ubuntu-server-day-1) and [Day 2](/blog/how-to-enable-and-expose-kubernetes-dashboard-using-microk8s-in-your-home-lab-day-2) posts covering the cluster build. The short version:

```bash
# On each of 3 nodes (Ubuntu 24.04 LTS):
sudo snap install microk8s --classic --channel=1.30/stable
sudo usermod -a -G microk8s $USER
sudo chown -R $USER ~/.kube
# reboot, then on first node:
microk8s add-node  # gives a token
# on other nodes:
microk8s join <token>

# Enable core addons:
microk8s enable ingress metallb dns ha-cluster
```

**Why MicroK8s over k3s/k0s/Talos?**
- Vanilla upstream Kubernetes (no downstream patches)
- Snap = automatic security updates, rollback, confinement
- HA clustering is a first-class command, not a hack
- Canonical support path if I ever need it

**Hardware reality check**: 3× ThinkCentre M710q (~$80 each on eBay) = 12 vCPU, 48GB RAM, 1.4TB SSD total. Runs the cluster + PostgreSQL + this site with headroom.

---

## 2. Ingress: Cloudflare Tunnel Instead of MetalLB + Public IP

My Day 1 post used MetalLB with a public IP. That works, but:

- Requires static IP or DDNS
- Opens ports on home router (security surface)
- No DDoS protection
- CGNAT breaks it entirely for many ISPs

**Cloudflare Tunnel solves all of this:**

```yaml
# deploy/k8s/cloudflared-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: ingress-nginx
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cloudflared
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      containers:
      - name: cloudflared
        image: cloudflare/cloudflared:latest
        args:
        - tunnel
        - run
        - --token=${TUNNEL_TOKEN}
        env:
        - name: TUNNEL_TOKEN
          valueFrom:
            secretKeyRef:
              name: cloudflare-tunnel-token
              key: token
        securityContext:
          runAsNonRoot: true
          runAsUser: 65534
          allowPrivilegeEscalation: false
```

**Setup:**
1. Cloudflare Dashboard → Zero Trust → Networks → Tunnels → Create tunnel
2. Copy token → store as K8s secret
3. Add DNS records (CNAME `www` → tunnel, CNAME `@` → tunnel)
4. Tunnel connects **outbound only** — no router config, no public IP

**Trade-off**: Adds ~50ms latency (Cloudflare edge → home). For a personal blog, irrelevant. For API latency-sensitive work, I'd keep MetalLB + public IP for those services.

---

## 3. The App: .NET 10 + BlazorStatic = Zero-Runtime Static Site

```xml
<!-- KiranJoy.Web/KiranJoy.Web.csproj -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="BlazorStatic" Version="1.0.0-beta.17" />
  </ItemGroup>

  <ItemGroup>
    <None Update="Content/**/*">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>

  <ItemGroup>
    <Watch Include="Content/**/*" />
  </ItemGroup>
</Project>
```

```csharp
// Program.cs — the entire "backend"
using BlazorStatic;
using Microsoft.AspNetCore.Builder;
using KiranJoy.Web.Components;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseStaticWebAssets();

builder.Services.AddBlazorStaticService(opt => {
    opt.ShouldGenerateSitemap = true;
    opt.SiteUrl = WebsiteKeys.SiteUrl;
})
.AddBlazorStaticContentService<BlogFrontMatter>(opt => {
    // opt.ContentPath = "Content/Blog"; // default
});

builder.Services.AddRazorComponents();

var app = builder.Build();

if (!app.Environment.IsDevelopment()) {
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseStaticFiles();
app.UseAntiforgery();
app.MapRazorComponents<App>();

// GENERATES static files to KiranJoy.Web/output/ on shutdown
app.UseBlazorStaticGenerator(shutdownApp: !app.Environment.IsDevelopment());

app.Run();

public static class WebsiteKeys {
    public const string SiteUrl = "https://your-domain.com";
    public const string GitHubRepo = "https://github.com/<your-github-user>/<your-repo>";
    // ... social links, Umami config, etc.
}
```

**Content lives as Markdown with front matter:**

```markdown
<!-- Content/Blog/my-post.md -->
---
title: "How to Build a HA Kubernetes Home Lab"
lead: "The journey of a novice..."
published: 2024-07-02
tags: [home-lab, kubernetes, microk8s]
authors:
  - name: "Kiran Joy"
---

> Now, before anyone comments...

## Goals
...
```

**Why not Next.js? Or a full CMS (Ghost, WordPress, Umbraco)?**

Honestly: I wanted to *experiment* with running a pure static site in production — to see if the claimed performance gains and operational simplicity actually materialize, and to learn the pattern by living with it.

The .NET/BlazorStatic choice was secondary:
- I'm a .NET engineer — and I am  using my IDE as my CMS (VS Code in this case).
- Blazor components for interactive islands (search, theme toggle) without a JS framework. As a C# developer it is the easiest choice for me.
- Single language, single toolchain, single CI pipeline.

**The experiment hypothesis**: *"A static site on nginx behind Cloudflare Tunnel will be faster, cheaper, and simpler to operate than any dynamic alternative — and I'll learn the pattern by running it."*

**Verdict so far**: True. Sub-50ms TTFB globally (Cloudflare edge cache), zero patching, zero database, zero runtime exploits. The "build once, serve everywhere" model holds up.

**Output**: Pure static files in `MyWebApp.Web/output/` — HTML, CSS, JS, WebAssembly (only for interactive components), images. No server, no database, no runtime.

---

## 4. Multi-Stage Dockerfile: Build → Search Index → Serve

```dockerfile
# deploy/Dockerfile
# STAGE 1: Build the static site with .NET 10 SDK
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy everything (includes .git for version info if needed)
COPY . ./

# Remove launchSettings.json to force Production env
# (BlazorStaticGenerator only runs in non-Development)
RUN rm -f MyWebApp.Web/Properties/launchSettings.json

# Generate static site into MyWebApp.Web/output
ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://127.0.0.1:5000
RUN dotnet run --project MyWebApp.Web/MyWebApp.Web.csproj --configuration Release --no-launch-profile

# STAGE 2: Build Pagefind search index
FROM node:20-alpine AS search
WORKDIR /site
COPY --from=build /src/MyWebApp.Web/output ./
# Pagefind: zero-config, client-side search, ~100KB JS
RUN npx -y pagefind --site . --glob "**/*.html"

# STAGE 3: Runtime — nginx serving static files
FROM nginx:alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=search /site /usr/share/nginx/html
EXPOSE 80
```

**Key details:**

| Stage | Purpose | Size |
|-------|---------|------|
| `build` | .NET 10 SDK, runs `dotnet run` → generates `output/` | ~200MB (throwaway) |
| `search` | Node + Pagefind, builds search index into `output/pagefind/` | ~50MB (throwaway) |
| `runtime` | nginx:alpine + final site | **~25MB** |

**nginx.conf highlights:**

```nginx
# deploy/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # gzip for text assets
    gzip on;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # Immutable cache for Blazor framework files
    location /_framework/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Pagefind search index
    location /pagefind/ {
        expires 1d;
        add_header Cache-Control "public";
    }

    # Static assets
    location ~* \.(css|js|woff2|svg|png|jpg|ico|webp|wasm)$ {
        expires 30d;
        add_header Cache-Control "public";
    }

    # Pretty URLs: /post-name → /post-name.html → /post-name/index.html
    location / {
        try_files $uri $uri.html $uri/index.html $uri/ =404;
    }

    error_page 404 /404.html;
}
```

---

## 5. GitOps: GitHub Actions → ghcr.io → ArgoCD

### CI: Build & Push Multi-Arch Image

```yaml
# .github/workflows/ci-deploy.yml
name: CI Build and Deploy

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  IMAGE_NAME: my-web-app
  REGISTRY: ghcr.io

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    outputs:
      image_sha: ${{ steps.vars.outputs.IMAGE_SHA }}
    steps:
    - uses: actions/checkout@v4

    - name: Login to GHCR
      uses: docker/login-action@v3
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Set image tags
      id: vars
      run: |
        REG_OWNER=${{ secrets.REGISTRY_OWNER }}
        if [ -z "$REG_OWNER" ]; then REG_OWNER=${{ github.repository_owner }}; fi
        echo "IMAGE_SHA=${REGISTRY}/${REG_OWNER}/${IMAGE_NAME}:${GITHUB_SHA}" >> $GITHUB_OUTPUT
        echo "IMAGE_LATEST=${REGISTRY}/${REG_OWNER}/${IMAGE_NAME}:latest" >> $GITHUB_OUTPUT

    - name: Build and push (multi-arch for ARM64 homelab)
      uses: docker/build-push-action@v5
      with:
        context: .
        file: deploy/Dockerfile
        push: true
        platforms: linux/amd64,linux/arm64
        tags: |
          ${{ steps.vars.outputs.IMAGE_SHA }}
          ${{ steps.vars.outputs.IMAGE_LATEST }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

### CD: ArgoCD Application

```yaml
# deploy/argocd-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-web-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: "https://github.com/<your-github-user>/<your-repo>"
    targetRevision: main
    path: deploy/k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: my-app-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
```

### K8s Manifests (deploy/k8s/)

```yaml
# deploy/k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: my-app-prod
---
# deploy/k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-web-app
  namespace: my-app-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-web-app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: my-web-app
      annotations:
        # Forces rollout on image tag change
        argocd.argoproj.io/sync-wave: "10"
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values: [my-web-app]
              topologyKey: kubernetes.io/hostname
      containers:
      - name: my-web-app
        image: ghcr.io/<your-github-user>/my-web-app:latest
        imagePullPolicy: Always
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: "50m"
            memory: "64Mi"
          limits:
            cpu: "200m"
            memory: "128Mi"
        livenessProbe:
          httpGet:
            path: /healthz
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 80
          initialDelaySeconds: 3
          periodSeconds: 5
---
# deploy/k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: my-web-app
  namespace: my-app-prod
spec:
  selector:
    app: my-web-app
  ports:
  - port: 80
    targetPort: 80
---
# deploy/k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-web-app
  namespace: my-app-prod
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"  # if using cert-manager
spec:
  ingressClassName: public
  tls:
  - hosts:
    - your-domain.com
    - www.your-domain.com
    secretName: my-web-app-tls
  rules:
  - host: your-domain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-web-app
            port:
              number: 80
  - host: www.your-domain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-web-app
            port:
              number: 80
```

**Flow:**
```
git push origin main
    │
    ▼
GitHub Actions: build multi-arch image → push to ghcr.io/<your-org>/<your-image>:<sha> + :latest
    │
    ▼
ArgoCD (polling every 3 min): detects new image tag in deployment.yaml
    │
    ▼
ArgoCD: rolling update (2 replicas, maxSurge=1, maxUnavailable=0)
    │
    ▼
Health checks pass → traffic shifts → old pods terminate
    │
    ▼
Site updated. Zero downtime. Rollback = `argocd app rollback <app-name> <revision>`
```

---

## 6. Observability: Umami Analytics (Self-Hosted)

While Umami is self hosted, the admin interface is not exposed publicly.

```yaml
# deploy/k8s/umami-deployment.yaml (simplified)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: umami
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: umami
  template:
    metadata:
      labels:
        app: umami
    spec:
      containers:
      - name: umami
        image: ghcr.io/umami-software/umami:postgresql-latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: umami-db
              key: url
        - name: HASH_SALT
          valueFrom:
            secretKeyRef:
              name: umami-secrets
              key: hash-salt
        ports:
        - containerPort: 3000
---
# nginx.conf proxies /stats/* to umami (see earlier)
```

**Why Umami?**
- Self-hosted, PostgreSQL-backed, GDPR-friendly
- No cookies by default, no personal data
- I own the data. No Google/Matomo/Plausible third parties.

---

## 7. What I'm Learning (Ongoing)

This site has only been live a few days. The real lessons come from operating it over time — watching how the cluster handles a power outage (oh it will go down since I have no battery back up but good to how it will recover after that), seeing what breaks when I upgrade MicroK8s. I'll update this section as those scars accumulate.


The point isn't that this architecture is perfect. It's that **I'm running it, observing it, and iterating** — the same loop that makes you better at your day job.

---

## 8. Cost Breakdown (Monthly)

| Item | Cost |
|------|------|
| Hardware (amortized 3 years) | ~$8/mo (3× $80 / 36) |
| Electricity (48GB RAM, 12 vCPU, idle ~35W) | ~$3/mo |
| Cloudflare Tunnel + DNS + CDN + WAF | **Free** |
| GitHub Actions (public repo) | **Free** |
| GHCR storage (multi-arch images) | **Free** (public) |
| Domain (your-domain.com) | ~$1/mo |
| **Total** | **~$12/mo** |

Compare: Vercel Pro ($20), Netlify Pro ($19), AWS Amplify (~$15+), DigitalOcean App Platform ($12+). And I don't get Kubernetes, GitOps, or the operational reps.

---

## 9. The "Why Bother?" Answer

> **This is not about hosting a blog. It's about self hosting, experimenting, failing and doing it all over again.**

At work, I design systems, review architecture, mentor teams. I don't `kubectl apply` daily. If I only read docs and approve PRs, I lose my edge.

This home lab is my **spike environment** (in the book sense):
- **Hypothesis**: "Can I run HA Kubernetes at home with Cloudflare Tunnel?"
- **Spike**: 3-node MicroK8s + cloudflared + ArgoCD
- **Postmortem**: What broke? (MetalLB IP conflicts, cert-manager race conditions, Pagefind WASM MIME types)
- **Pattern extracted**: "Zero-trust ingress for home services" → now a template in my work toolkit
- **Ship mode**: The blog *is* the ship repo. It runs the pattern.

**The AI angle**: Copilot wrote 80% of the Dockerfile, the GitHub Actions workflow, the ArgoCD manifest. *I* decided:
- Multi-stage with Pagefind (not Algolia/Meilisearch)
- Cloudflare Tunnel over MetalLB (threat model: home network)
- Anti-affinity + resource requests (operational maturity)
- Umami over GA (data sovereignty)

**AI writes syntax. You design, direct, supervise, and reivew. The gap is where the value lives.**

---

## 10. Repo & Resources

- **Day 1 (Cluster)**: [How to Build a HA Kubernetes Home Lab with MicroK8s](/blog/how-to-build-a-high-availability-kubernetes-home-lab-with-microk8s-and-ubuntu-server-day-1)
- **Day 2 (Dashboard)**: [Enable & Expose K8s Dashboard with MicroK8s](/blog/how-to-enable-and-expose-kubernetes-dashboard-using-microk8s-in-your-home-lab-day-2)

**Templates you can steal:**
- `deploy/Dockerfile` — multi-stage .NET static + Pagefind + nginx
- `deploy/nginx.conf` — caching, pretty URLs, Cloudflare-friendly headers
- `deploy/k8s/` — Deployment, Service, Ingress, ArgoCD Application
- `.github/workflows/ci-deploy.yml` — multi-arch build + push to GHCR

---

## Next on the Lab Roadmap

- [ ] **cert-manager + Let's Encrypt** for internal TLS (currently Cloudflare terminates)
- [ ] **Loki + Promtail** for log aggregation (replacing `kubectl logs`)

---

*This post is itself a spike artifact — written in the same Markdown + front matter pipeline it describes. The site search index includes this post. The ArgoCD deployment that published it is the same one managing the cluster it runs on. Recursion is the point.*