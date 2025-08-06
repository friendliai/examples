# How to retain HuggingFace cache on node-local storage

> [!NOTE]
> This feature is available for Friendli Container v1.10.26 or later.

You can use the `cacheHostPath` option to designate the directory on the node for caching model checkpoints downloaded from the Hugging Face Model Hub.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  model:
    huggingFace:
      repository: meta-llama/Llama-3.1-8B-Instruct
      cacheHostPath: /var/cache/huggingface  # <- The directory on the node for retaining Hugging Face cache.

      # "token:" section is not needed if the model is
      # a public one.
      token:
        name: hf-secret
        key: token

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

Using the above configuration, the checkpoint will be downloaded to `/var/cache/huggingface` directory on the node, and future pods on the same node will re-use the model without downloading it again.

> [!CAUTION]
> There is no mechanism to prevent multiple pods in the same node from simultaneously writing to the same directory.
> Additionally, because there is no mechanism to enforce a size limit on the cache directory, we strongly recommend implementing proper monitoring for the node's filesystem usage.
