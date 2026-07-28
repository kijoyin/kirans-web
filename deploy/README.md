# KiranJoy.Web — Kubernetes / Argo CD helper

This folder contains example Dockerfile, Kubernetes manifests and an Argo CD `Application` manifest to deploy `KiranJoy.Web` to your homelab cluster.

Steps to use:

1. Build the container image from the repository root (adjust registry):

```bash
# from repo root (c:\repos\kiranjoy)
docker build -f deploy/Dockerfile -t YOUR_REGISTRY/kiranjoy-web:latest .
docker push YOUR_REGISTRY/kiranjoy-web:latest
```

2. Update `deploy/k8s/deployment.yaml` and replace `YOUR_REGISTRY/kiranjoy-web:latest` with the built image.

3. Commit the `deploy/` folder in this repository.

4. Create the namespace in the cluster (once):

```bash
kubectl create namespace kiranjoy-prod || true
```

5. From Argo CD UI create an Application that points to this repo and path `deploy/k8s` (or apply `deploy/argocd-application.yaml` into the `argocd` namespace).

6. Ensure your DNS/hosts points `kiranjoy.local` to your ingress loadbalancer IP, or update `ingress.yaml` host to match your environment.

Notes:
- The manifests use `traefik` as ingress class to match your existing apps; change if you use another ingress controller.
- If you use a local registry (microk8s, kind), push image there and update the image name accordingly.
- `nginx.conf` first-party proxies the public parts of self-hosted **Cusdis** comments
  under `/comments` (widget assets at `/comments/js/` and the open API at
  `/comments/api/open/`). Only these public paths are exposed — the Cusdis dashboard and
  authenticated APIs stay internal. Update the upstream
  `cusdis.cusdis-prod.svc.cluster.local:3000` in `nginx.conf` to match your Cusdis
  Service name/namespace/port, and set `WebsiteKeys.CusdisAppId` to your project's App ID.
