# KiranJoy.Web — Kubernetes / Argo CD helper

This folder contains example Dockerfile, Kubernetes manifests and an Argo CD `Application` manifest to deploy `KiranJoy.Web` to your homelab cluster.

Steps to use:

1. Build the container image from the repository root (adjust registry):

```bash
# from repo root (c:\repos\kiranjoy)
docker build -f tmp/kiranjoy/Dockerfile -t YOUR_REGISTRY/kiranjoy-web:latest .
docker push YOUR_REGISTRY/kiranjoy-web:latest
```

2. Update `deployment.yaml` and replace `YOUR_REGISTRY/kiranjoy-web:latest` with the built image.

3. Copy the `kiranjoy` folder into your `homelabv3` repository (for example `homelabv3/kiranjoy`) and commit.

4. Create the namespace in the cluster (once):

```bash
kubectl create namespace kiranjoy-prod || true
```

5. From Argo CD UI create an Application that points to `homelabv3` repo and path `kiranjoy` (or apply `argocd-application.yaml` into the `argocd` namespace).

6. Ensure your DNS/hosts points `kiranjoy.local` to your ingress loadbalancer IP, or update `ingress.yaml` host to match your environment.

Notes:
- The manifests use `traefik` as ingress class to match your existing apps; change if you use another ingress controller.
- If you use a local registry (microk8s, kind), push image there and update the image name accordingly.
