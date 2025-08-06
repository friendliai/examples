# How to use Kubernetes Persistent Volume as Base Model Source

> [!NOTE]
> This feature is available for Friendli Container v1.10.26 or later.

You can use Kubernetes Persistent Volume as the source for base model checkpoint, rather than Hugging Face Model Hub.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  model:
    persistentVolumeClaim:
      claimName: my-volume-pvc    # The name of Persistent Volume Claim(PVC)
      subPath: openr1-distill-7b  # Optional sub path

  resources:

    nodeSelector:
      # Use the name of the node group you want to use.
      eks.amazonaws.com/nodegroup: <NODE GROUP NAME>

    numGPUs: 1
    requests:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
    limits:
      cpu: "6"
      ephemeral-storage: 30Gi
      memory: 25Gi
  deploymentStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  service:
    inferencePort: 6000
```

Using the above configuration, the pod will mount the Persistent Volume claimed by `my-volume-pvc` and use the base model found under the `openr1-distill-7b` directory.
