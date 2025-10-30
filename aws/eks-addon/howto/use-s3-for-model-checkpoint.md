# How to use AWS S3 as Base Model Source

> [!NOTE]
> This feature is available for Friendli Container v1.10.26 or later.
> This feature is not available if your cluster is using AWS Fargate or EKS hybrid nodes.

You can use AWS S3 as the source for base model checkpoint, rather than Hugging Face Model Hub.
The feature depends on [Mountpoint for Amazon S3 CSI driver](https://docs.aws.amazon.com/eks/latest/userguide/s3-csi.html), and you need to configure the S3 CSI driver first.

## 1️⃣ Configure S3 CSI driver

> [!NOTE]
> You can find the detailed instruction from the [Amazon EKS user guide](https://docs.aws.amazon.com/eks/latest/userguide/s3-csi-create.html).

Open ["Create policy" page](https://us-east-1.console.aws.amazon.com/iam/home#/policies/create) at IAM console and select JSON policy editor to enter the following content.

```json
{
   "Version": "2012-10-17",
   "Statement": [
        {
            "Sid": "MountpointFullBucketAccess",
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::<BUCKET NAME HERE>"
            ]
        },
        {
            "Sid": "MountpointFullObjectAccess",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": [
                "arn:aws:s3:::<BUCKET NAME HERE>/*"
            ]
        }
   ]
}
```

After creating the policy, use [eksctl command line tool](https://docs.aws.amazon.com/en_us/eks/latest/userguide/getting-started-eksctl.html) to create IAM role and Kubernetes ServiceAccount, replacing `<REGION>` with the AWS region your cluster resides and `<NAME>` with the EKS cluster name. Use the ARN of the policy you created above for `<POLICY ARN>`.

```sh
eksctl create iamserviceaccount \
    --name s3-csi-driver-sa \
    --namespace kube-system \
    --region <REGION> \
    --cluster <CLUSTER> \
    --attach-policy-arn <POLICY ARN> \
    --approve \
    --role-name <NEW ROLE NAME> \
    --role-only
```

You can now install the Mountpoint for Amazon S3 CSI driver.

- Open [Amazon EKS console](https://console.aws.amazon.com/eks/home#/clusters) and choose the cluster that you want to configure.
- Select the “Add-ons” tab and click “Get more add-ons”.
- Under the section “Amazon EKS-addons”, check “Mountpoint for Amazon S3 CSI Driver”, and click “Next”.
- Select the IAM role you created above and click “Next”, Review your settings, and click “Create”

## 2️⃣ Create PersistentVolumeClaim Referencing the S3 bucket.

We provide a convenience feature to quickly configure a PersistentVolumeClaim referencing your S3 bucket.

You can create the following resource, replacing `<REGION OF YOUR BUCKET>` with the bucket region (e.g. `us-east-1`) and `<NAME OF YOUR BUCKET>` with the bucket name.

```yaml
apiVersion: friendli.ai/v1alpha1
kind: S3Volume
metadata:
  namespace: default
  name: s3vol-example
spec:
  bucketRegion: <REGION OF YOUR BUCKET>
  bucketName: <NAME OF YOUR BUCKET>
```

After creating the resource, you can find the PersistentVolumeClaim corresponding to the S3Volume resource you just created.

```sh
$ kubectl get pvc
NAME            STATUS   VOLUME                                                        CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
s3vol-example   Bound    s3volume-s3vol-example-f0cdb314-e85a-461f-8016-1d36b1d65483   1Pi        ROX                           <unset>                 48m
```

## 3️⃣ Use the PersistentVolumeClaim to Launch FriendliDeployment

```yaml
apiVersion: friendli.ai/v1alpha1
kind: FriendliDeployment
metadata:
  namespace: default
  name: friendlideployment-sample
spec:
  model:
    persistentVolumeClaim:
      claimName: s3vol-example    # The name of Persistent Volume Claim(PVC)
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

Using the above configuration, the pod will mount the Persistent Volume claimed by `s3vol-example` and use the base model found under the `openr1-distill-7b` directory.
