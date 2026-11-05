#!/usr/bin/env bash
# One-time setup for a single-node Kubernetes cluster without a StorageClass.
set -euo pipefail

manifest_url="https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.37/deploy/local-path-storage.yaml"

kubectl apply -f "$manifest_url"
kubectl -n local-path-storage rollout status deployment/local-path-provisioner --timeout=300s

# Keep the PV data on the node if its PVC is ever deleted by mistake.
kubectl patch storageclass local-path --type=merge -p '{"reclaimPolicy":"Retain"}'

echo "StorageClass local-path is ready. Persistent data will live on this node under /opt/local-path-provisioner."
